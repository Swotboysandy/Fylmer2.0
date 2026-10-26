import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { exportDirectory } from "./local-export";
import type { RenderHandle } from "./render-api";

const manifestSchema = z.object({
	source: z.object({
		projectId: z.uuid(),
		approvalHash: z.string().regex(/^[a-f0-9]{32}$/),
	}),
	createdAt: z.iso.datetime(),
});

export async function recoverLocalExport(
	userId: string,
	projectId: string,
): Promise<RenderHandle | null> {
	z.uuid().parse(projectId);
	const userDirectory = dirname(exportDirectory(userId, projectId));
	let entries: string[];
	try {
		entries = await readdir(userDirectory);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
	const candidates: { renderId: string; createdAt: number; active: boolean }[] =
		[];
	for (const renderId of entries) {
		if (!z.uuid().safeParse(renderId).success) continue;
		const directory = join(userDirectory, renderId);
		try {
			const files = await readdir(directory);
			const terminal =
				files.includes("done.json") ||
				files.includes("failed.json") ||
				files.includes("cancelled.json");
			const active =
				!terminal &&
				(files.includes("pending.json") || files.includes("processing.json"));
			if (!terminal && !active) continue;
			const manifest = manifestSchema.parse(
				JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")),
			);
			if (manifest.source.projectId !== projectId) continue;
			candidates.push({
				renderId,
				createdAt: Date.parse(manifest.createdAt),
				active,
			});
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
			throw error;
		}
	}
	candidates.sort(
		(first, second) =>
			Number(second.active) - Number(first.active) ||
			second.createdAt - first.createdAt ||
			first.renderId.localeCompare(second.renderId),
	);
	const latest = candidates[0];
	return latest
		? { renderId: latest.renderId, bucketName: "fylmer-local" }
		: null;
}
