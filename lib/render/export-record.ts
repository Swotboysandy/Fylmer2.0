import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ExportMusicRightsSchema } from "./export-music-rights";
import { exportDirectory, ExportLayoutSchema } from "./local-export";

const manifestSchema = z.object({
	createdAt: z.iso.datetime(),
	inputProps: ExportLayoutSchema,
	source: z.object({
		projectId: z.uuid(),
		approvalHash: z.string().regex(/^[a-f0-9]{32}$/),
		runId: z.uuid().optional(),
		musicRights: ExportMusicRightsSchema.optional(),
	}),
});

export async function getExportRecord(userId: string, renderId: string) {
	const directory = exportDirectory(userId, renderId);
	try {
		const done = z
			.object({ size: z.number().int().positive() })
			.parse(JSON.parse(await readFile(join(directory, "done.json"), "utf8")));
		const output = await stat(join(directory, "output.mp4"));
		if (!output.isFile() || output.size !== done.size)
			throw new Error("The export file does not match its completion record.");
		const manifest = manifestSchema.parse(
			JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")),
		);
		const layout = manifest.inputProps;
		return {
			version: 1,
			renderId,
			projectId: manifest.source.projectId,
			runId: manifest.source.runId ?? null,
			approvalHash: manifest.source.approvalHash,
			createdAt: manifest.createdAt,
			file: { name: "fylmer-final-cut.mp4", bytes: done.size },
			timeline: {
				fps: layout.fps,
				width: layout.width,
				height: layout.height,
				totalFrames: layout.totalFrames,
				durationSec: layout.totalFrames / layout.fps,
				clips: [
					...layout.series,
					...Object.values(layout.sequences).flat(),
				].map(({ element, start, duration }) => ({
					elementId: element.id,
					type: element.type,
					sceneNumber: element.sceneNumber,
					startSec: start,
					durationSec: duration,
					volume: element.volume,
				})),
			},
			music: (manifest.source.musicRights ?? []).map(
				({ elementId, declaration }) => ({
					elementId,
					declaration: declaration
						? {
								status: declaration.status,
								basis: declaration.basis,
								statement: declaration.statement,
								evidence: declaration.evidence,
								declaredAt: declaration.declaredAt,
							}
						: null,
				}),
			),
			notice:
				"This records the saved export snapshot, not independent verification of music rights, media authenticity or film quality. Media access URLs and prompts are omitted. Older exports may have no music declarations recorded.",
		};
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}
