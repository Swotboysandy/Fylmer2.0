import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { CaptionStyleSchema } from "@/lib/captions/caption-style";
import { ContentTypeSchema } from "@/lib/canvas/types";
import { MOTION_EFFECTS } from "./motion-effect-names";
import { TRANSITION_TYPES } from "./transitions";
import { renderScale, type Resolution } from "./resolutions";
import type { RenderProgress } from "./render-api";
import { withExportLock } from "./export-lock";
import { completeLocalFilmRun } from "./complete-local-film-run";
import { ExportMusicRightsSchema } from "./export-music-rights";

const seconds = z.number().finite().nonnegative().max(300);
const sequence = z.object({
	start: seconds,
	duration: seconds.positive(),
	element: z
		.object({
			id: z.string().max(200),
			type: ContentTypeSchema,
			role: z.enum(["foreground", "background", "overlay", "effect"]),
			layer: z.enum(["audio", "visual"]),
			sceneId: z.string().max(200),
			sceneNumber: z.number().int().nonnegative(),
			prompt: z.string().max(20000),
			url: z.string().url().max(8000),
			durationSec: seconds,
			loops: z.number().int().min(1).max(100),
			loop: z.boolean(),
			trimToDialogue: z.boolean(),
			volume: z.number().min(0).max(10),
			motion: z.enum(MOTION_EFFECTS),
			captionTimestamps: z
				.array(
					z.object({
						text: z.string().max(1000),
						start: seconds,
						end: seconds,
					}),
				)
				.max(10000)
				.optional(),
		})
		.refine((element) => element.type === "image" || element.durationSec > 0, {
			message: "Audio and video require a positive media duration.",
		}),
});
export const ExportLayoutSchema = z.object({
	series: z.array(sequence).max(200),
	sequences: z.partialRecord(ContentTypeSchema, z.array(sequence).max(200)),
	fps: z.number().int().min(1).max(60),
	width: z.number().int().min(64).max(1920),
	height: z.number().int().min(64).max(1920),
	totalFrames: z.number().int().min(1).max(18000),
	totalDurationSec: seconds.positive(),
	transitionType: z.enum(TRANSITION_TYPES),
	transitionDurationSec: seconds.max(2),
	captionStyle: CaptionStyleSchema,
});

export function validateLocalExport(
	input: unknown,
	userId: string,
	resolution: Resolution,
	generatedOrigin?: string,
) {
	const layout = ExportLayoutSchema.parse(input);
	const scale = renderScale(resolution);
	if (
		layout.totalFrames / layout.fps > 300 ||
		layout.width * scale > 1920 ||
		layout.height * scale > 1920
	)
		throw new Error(
			"CPU export supports up to five minutes and 1920 pixels per side.",
		);
	const sequences = [
		...layout.series,
		...Object.values(layout.sequences).flat(),
	];
	if (!sequences.length || sequences.length > 200)
		throw new Error("Choose between one and 200 media clips to export.");
	const storage = new URL(
		process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalid",
	);
	for (const item of sequences) {
		const url = new URL(item.element.url);
		if (
			generatedOrigin &&
			url.origin === new URL(generatedOrigin).origin &&
			!url.username &&
			!url.password &&
			!url.search &&
			!url.hash &&
			/^\/api\/generated-media\/[a-f0-9-]{36}\/(image|video|audio)$/.test(
				url.pathname,
			)
		)
			continue;
		const prefix = `/storage/v1/object/sign/fylmer-media/${z.uuid().parse(userId)}/`;
		if (
			url.origin !== storage.origin ||
			!url.pathname.startsWith(prefix) ||
			/%|\\/.test(url.pathname) ||
			!url.searchParams.get("token") ||
			url.username ||
			url.password
		)
			throw new Error(
				"Export only accepts media uploaded to your private library.",
			);
	}
	if (/url\s*\(/i.test(JSON.stringify(layout.captionStyle)))
		throw new Error("Caption styles cannot load external content.");
	return {
		inputProps: {
			...layout,
			width: Math.round((layout.width * scale) / 2) * 2,
			height: Math.round((layout.height * scale) / 2) * 2,
		},
		scale: 1,
	};
}

export function exportDirectory(userId: string, renderId: string) {
	const root = process.env.FYLMER_EXPORT_DIRECTORY;
	if (!root) throw new Error("The CPU export worker is not configured.");
	return join(root, z.uuid().parse(userId), z.uuid().parse(renderId));
}

export async function enqueueLocalExport(
	userId: string,
	input: unknown,
	resolution: Resolution,
	source: {
		projectId: string;
		approvalHash: string;
		runId?: string;
		musicRights?: z.infer<typeof ExportMusicRightsSchema>;
	},
	privateAccess?: { client: SupabaseClient; appOrigin: string },
) {
	if (privateAccess) {
		const { hydrateExportMedia } = await import("./hydrate-export-media");
		await hydrateExportMedia(
			privateAccess.client,
			userId,
			source.projectId,
			input,
			privateAccess.appOrigin,
		);
	}
	const validated = validateLocalExport(
		input,
		userId,
		resolution,
		privateAccess?.appOrigin,
	);
	const needsRenewal = [
		...validated.inputProps.series,
		...Object.values(validated.inputProps.sequences).flat(),
	].some((item) =>
		new URL(item.element.url).pathname.startsWith("/api/generated-media/"),
	);
	const payload = {
		...validated,
		...(privateAccess && needsRenewal
			? { mediaOrigin: privateAccess.appOrigin }
			: {}),
		source: z
			.object({
				projectId: z.uuid(),
				approvalHash: z.string().regex(/^[a-f0-9]{32}$/),
				runId: z.uuid().optional(),
				musicRights: ExportMusicRightsSchema.optional(),
			})
			.parse(source),
		resolution,
		createdAt: new Date().toISOString(),
	};
	const renderId = randomUUID();
	const directory = exportDirectory(userId, renderId);
	const userDirectory = join(directory, "..");
	await mkdir(userDirectory, { recursive: true, mode: 0o700 });
	return withExportLock(join(userDirectory, "admission.lock"), async () => {
		const jobs = await readdir(userDirectory);
		let active = 0;
		for (const job of jobs) {
			if (!z.uuid().safeParse(job).success) continue;
			const files = await readdir(join(userDirectory, job));
			if (files.includes("pending.json") || files.includes("processing.json"))
				active++;
		}
		if (active >= 2)
			throw new Error(
				"Two exports are already queued. Wait for one to finish.",
			);
		await mkdir(directory, { mode: 0o700 });
		await writeFile(join(directory, "manifest.json"), JSON.stringify(payload), {
			mode: 0o600,
		});
		await writeFile(join(directory, "request.tmp"), JSON.stringify(payload), {
			mode: 0o600,
		});
		await rename(
			join(directory, "request.tmp"),
			join(directory, "pending.json"),
		);
		return { renderId, bucketName: "fylmer-local" };
	});
}

export async function localExportProgress(
	userId: string,
	renderId: string,
): Promise<RenderProgress> {
	const directory = exportDirectory(userId, renderId);
	try {
		const files = await readdir(directory);
		if (files.includes("done.json")) {
			await completeLocalFilmRun(directory, userId, renderId);
			const result = z
				.object({ size: z.number().int().positive() })
				.parse(
					JSON.parse(await readFile(join(directory, "done.json"), "utf8")),
				);
			return {
				type: "done",
				url: `/api/render/download/${renderId}`,
				size: result.size,
				...(files.includes("manifest.json")
					? { recordUrl: `/api/render/record/${renderId}` }
					: {}),
			};
		}
		if (files.includes("cancelled.json")) return { type: "cancelled" };
		if (files.includes("failed.json"))
			return {
				type: "error",
				message:
					"The export could not finish. Your project is unchanged; please retry.",
			};
		if (files.includes("progress.json")) {
			const status = z
				.object({ progress: z.number().finite().min(0).max(0.99) })
				.parse(
					JSON.parse(await readFile(join(directory, "progress.json"), "utf8")),
				);
			return { type: "progress", progress: status.progress };
		}
		return { type: "progress", progress: 0 };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT")
			return { type: "error", message: "Export not found." };
		throw error;
	}
}
