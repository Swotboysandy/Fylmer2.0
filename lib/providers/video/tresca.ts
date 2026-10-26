import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { AssetBundle } from "@/lib/api/asset-bundle";
import { decodeReferenceImage } from "@/lib/api/image-reference-bytes";
import type { ProviderJobContext } from "../base";
import {
	buildH3Workflow,
	buildH3ReferenceWorkflow,
} from "@/lib/fylmer/h3-workflow";
import { h3RenderMinutes, h3Settings } from "@/lib/fylmer/h3-settings";
import type { VideoProvider, VideoRequest, VideoPoll } from "./base";
import { compileCanvasJob } from "@/lib/fylmer/canvas-job";

const run = promisify(execFile);
const FileSchema = z.object({
	filename: z.string(),
	subfolder: z.string().default(""),
	type: z.string().default("output"),
});
const HistorySchema = z.record(
	z.string(),
	z.object({
		status: z
			.object({
				completed: z.boolean().optional(),
				status_str: z.string().optional(),
			})
			.optional(),
		outputs: z
			.record(
				z.string(),
				z.object({
					images: z.array(FileSchema).optional(),
					audio: z.array(FileSchema).optional(),
				}),
			)
			.optional(),
	}),
);

function endpoint(path: string) {
	const base = process.env.FYLMER_TRESCA_STAGING_URL;
	if (!base)
		throw new Error(
			"A separate Tresca staging worker is not connected. No GPU job was started.",
		);
	return `${base.replace(/\/$/, "")}/${path}`;
}

async function boundedBytes(response: Response, maximum: number) {
	if (!response.ok || !response.body)
		throw new Error("Tresca could not read the media file.");
	const chunks: Uint8Array[] = [];
	let length = 0;
	const reader = response.body.getReader();
	try {
		while (true) {
			const item = await reader.read();
			if (item.done) break;
			length += item.value.length;
			if (length > maximum)
				throw new Error("Media exceeds the staging size limit.");
			chunks.push(item.value);
		}
	} finally {
		await reader.cancel();
	}
	if (!length) throw new Error("Tresca returned an empty media file.");
	return Buffer.concat(chunks);
}

async function uploadReference(source: string) {
	let bytes: Buffer;
	let type: string;
	if (source.startsWith("data:")) {
		const decoded = decodeReferenceImage(source);
		bytes = decoded.bytes;
		type = decoded.contentType;
	} else {
		const allowed = (process.env.FYLMER_REFERENCE_ORIGINS ?? "")
			.split(",")
			.filter(Boolean);
		const url = new URL(source);
		if (!allowed.includes(url.origin))
			throw new Error(
				"Upload this reference to the staging media library first.",
			);
		const response = await fetch(url, {
			redirect: "error",
			signal: AbortSignal.timeout(30000),
		});
		type = response.headers.get("content-type")?.split(";")[0] ?? "";
		if (!["image/png", "image/jpeg", "image/webp"].includes(type))
			throw new Error("Tresca needs a PNG, JPEG or WebP reference.");
		bytes = await boundedBytes(response, 20 * 1024 * 1024);
	}
	const form = new FormData();
	form.append(
		"image",
		new Blob([new Uint8Array(bytes)], { type }),
		`${randomUUID()}.${type.split("/")[1]}`,
	);
	const result = await fetch(endpoint("upload/image"), {
		method: "POST",
		body: form,
		signal: AbortSignal.timeout(30000),
	});
	if (!result.ok) throw new Error("Tresca reference upload failed.");
	return z.object({ name: z.string().min(1) }).parse(await result.json()).name;
}

export class TrescaVideo implements VideoProvider {
	async submitCanvas(document: unknown) {
		if (
			process.env.FYLMER_STAGING_GENERATION_ENABLED !== "1" ||
			process.env.FYLMER_TRESCA_GPU_APPROVED !== "1"
		)
			throw new Error("GPU generation is disabled for staging review.");
		if (!(Number(process.env.FYLMER_TRESCA_HOURLY_USD) > 0))
			throw new Error(
				"Configure the approved Tresca GPU cost before rendering.",
			);
		const { workflow } = compileCanvasJob(document);
		const response = await fetch(endpoint("prompt"), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ prompt: workflow, client_id: randomUUID() }),
			signal: AbortSignal.timeout(30000),
		});
		if (!response.ok)
			throw new Error("Tresca did not accept the saved Canvas.");
		const result = z
			.object({
				prompt_id: z.string().min(1),
				node_errors: z.record(z.string(), z.unknown()).optional(),
			})
			.parse(await response.json());
		if (Object.keys(result.node_errors ?? {}).length)
			throw new Error("The Tresca worker rejected a Canvas node.");
		return result.prompt_id;
	}
	async validate() {
		try {
			const response = await fetch(endpoint("object_info"), {
				signal: AbortSignal.timeout(10000),
			});
			if (!response.ok) throw new Error("Worker unavailable");
			const nodes = await response.json();
			if (!nodes.MiniMaxH3ImageToVideo || !nodes.SaveAudio)
				throw new Error("Missing Tresca nodes");
			return { ok: true as const };
		} catch {
			return {
				ok: false as const,
				error: "The isolated Tresca worker is not ready.",
			};
		}
	}

	async submit(request: VideoRequest) {
		if (
			process.env.FYLMER_STAGING_GENERATION_ENABLED !== "1" ||
			process.env.FYLMER_TRESCA_GPU_APPROVED !== "1"
		)
			throw new Error("GPU generation is disabled for staging review.");
		const hourly = Number(process.env.FYLMER_TRESCA_HOURLY_USD);
		if (!(hourly > 0))
			throw new Error(
				"Configure the approved Tresca GPU cost before rendering.",
			);
		endpoint("prompt");
		const input = {
			prompt: request.prompt,
			durationSeconds: request.duration ?? 5,
			width: request.width ?? 1344,
			height: request.height ?? 768,
		};
		h3Settings(input);
		const references = [
			...(request.characterAssets ?? []).flatMap((character) =>
				character.avatarUrl ? [character.avatarUrl] : [],
			),
			...(request.referenceImages ?? []),
			...(request.continuityFrames ?? []),
		];
		if (references.length > 9)
			throw new Error("Tresca accepts at most nine image references.");
		if (request.frameImage && references.length)
			throw new Error(
				"Choose either frame conditioning or identity references for this Tresca shot.",
			);
		const { workflow } = references.length
			? buildH3ReferenceWorkflow({
					...input,
					references: {
						images: await Promise.all(references.map(uploadReference)),
					},
				})
			: buildH3Workflow({
					...input,
					firstFrameName: request.frameImage
						? await uploadReference(request.frameImage)
						: undefined,
				});
		const response = await fetch(endpoint("prompt"), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ prompt: workflow, client_id: randomUUID() }),
			signal: AbortSignal.timeout(30000),
		});
		if (!response.ok) throw new Error("Tresca did not accept this workflow.");
		const result = z
			.object({
				prompt_id: z.string().min(1),
				node_errors: z.record(z.string(), z.unknown()).optional(),
			})
			.parse(await response.json());
		if (Object.keys(result.node_errors ?? {}).length)
			throw new Error("The Tresca worker rejected a workflow node.");
		return result.prompt_id;
	}

	async poll(
		jobId: string,
		request: VideoRequest & { canvasDocument?: unknown },
		context?: ProviderJobContext,
	): Promise<VideoPoll> {
		const response = await fetch(
			endpoint(`history/${encodeURIComponent(jobId)}`),
			{ signal: AbortSignal.timeout(20000) },
		);
		if (!response.ok) throw new Error("Could not read Tresca job status.");
		const history = HistorySchema.parse(await response.json())[jobId];
		if (history?.status?.status_str === "error") return { kind: "failed" };
		if (!history?.status?.completed) return { kind: "pending" };
		const video = history.outputs?.["11"]?.images?.[0];
		const audio = history.outputs?.["12"]?.audio?.[0];
		if (!video || !audio)
			throw new Error(
				"Tresca finished without both video and audio. This take is incomplete.",
			);
		const directory = await mkdtemp(join(tmpdir(), "fylmer-tresca-"));
		try {
			for (const [name, file] of [
				["video.webm", video],
				["audio.flac", audio],
			] as const) {
				const media = await fetch(
					endpoint(`view?${new URLSearchParams(file)}`),
					{ signal: AbortSignal.timeout(120000) },
				);
				await writeFile(
					join(directory, name),
					await boundedBytes(media, 512 * 1024 * 1024),
				);
			}
			const output = join(directory, "output.mp4");
			await run(
				"ffmpeg",
				[
					"-nostdin",
					"-y",
					"-i",
					join(directory, "video.webm"),
					"-i",
					join(directory, "audio.flac"),
					"-map",
					"0:v:0",
					"-map",
					"1:a:0",
					"-c:v",
					"libx264",
					"-c:a",
					"aac",
					"-movflags",
					"+faststart",
					"-shortest",
					output,
				],
				{ timeout: 180000 },
			);
			const settings =
				request.canvasDocument === undefined
					? h3Settings({
							durationSeconds: request.duration ?? 5,
							width: request.width,
							height: request.height,
						})
					: compileCanvasJob(request.canvasDocument).settings;
			const metadata = {
				jobId,
				status: "completed" as const,
				durationSec: settings.durationSeconds,
			};
			const upload = context?.storeBundle ?? AssetBundle.upload;
			const asset = await upload(
				"video",
				"tresca",
				[
					{
						key: "video",
						filename: "output.mp4",
						contentType: "video/mp4",
						data: await readFile(output),
					},
				],
				metadata,
			);
			return {
				kind: "ready",
				asset: { ...asset, metadata },
				costUsd:
					(h3RenderMinutes({
						...settings,
						durationSeconds: Math.min(15, settings.durationSeconds),
					}) *
						Number(process.env.FYLMER_TRESCA_HOURLY_USD)) /
					60,
			};
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}
}
