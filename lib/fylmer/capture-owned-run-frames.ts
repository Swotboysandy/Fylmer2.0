import { createHash } from "node:crypto";
import { mkdtemp, open, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { FrameKey } from "@/lib/connectors/video/start-frame";
import { resolveOwnedGeneratedMedia } from "./resolve-owned-generated-media";
import { readRunBundle } from "./read-run-bundle";
import { extractRunFrames } from "./extract-run-frames";

export function captureOwnedRunFrames(
	client: SupabaseClient,
	scope: { userId: string; projectId: string; appOrigin: string },
) {
	const cached = new Map<string, Promise<Record<FrameKey, string>>>();
	const capture = async (url: string) => {
		const access = await resolveOwnedGeneratedMedia(
			client,
			{ ...scope, url },
			300,
		);
		if (access.key !== "video")
			throw new Error(
				"Continuity frame extraction requires an owned video output.",
			);
		const bundle = await readRunBundle(client, access.jobId, access.reference);
		const directory = await mkdtemp(join(tmpdir(), "fylmer-owned-frames-"));
		try {
			const path = join(directory, "source.mp4");
			const response = await fetch(access.url, {
				redirect: "error",
				signal: AbortSignal.timeout(60000),
			});
			if (!response.ok || !response.body)
				throw new Error("Could not read the selected continuity video.");
			const reader = response.body.getReader();
			const file = await open(path, "wx", 0o600);
			const hash = createHash("sha256");
			let length = 0;
			try {
				if (
					Number(response.headers.get("content-length") ?? 0) >
					512 * 1024 * 1024
				)
					throw new Error("Continuity video exceeds 512 MiB.");
				while (true) {
					const next = await reader.read();
					if (next.done) break;
					length += next.value.byteLength;
					if (length > 512 * 1024 * 1024)
						throw new Error("Continuity video exceeds 512 MiB.");
					hash.update(next.value);
					await file.writeFile(next.value);
				}
			} finally {
				try {
					await reader.cancel();
				} finally {
					await file.close();
				}
			}
			if (
				!length ||
				hash.digest("hex") !== bundle.response.result.video.slice(0, 64)
			)
				throw new Error("Continuity video failed its integrity check.");
			const frames = await extractRunFrames(path, ["first", "middle", "last"]);
			return {
				first: `data:image/jpeg;base64,${frames[0].toString("base64")}`,
				middle: `data:image/jpeg;base64,${frames[1].toString("base64")}`,
				last: `data:image/jpeg;base64,${frames[2].toString("base64")}`,
			};
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	};
	return async (url: string, keys: readonly FrameKey[]) => {
		z.array(z.enum(["first", "middle", "last"]))
			.max(3)
			.parse(keys);
		if (!keys.length) return [];
		let frames = cached.get(url);
		if (!frames) {
			frames = capture(url).catch((error) => {
				cached.delete(url);
				throw error;
			});
			cached.set(url, frames);
		}
		const results = await frames;
		return keys.map((key) => results[key]);
	};
}
