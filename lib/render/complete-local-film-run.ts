import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";

export async function completeLocalFilmRun(
	directory: string,
	userId: string,
	renderId: string,
) {
	const files = await readdir(directory);
	if (
		!files.includes("done.json") ||
		files.includes("failed.json") ||
		files.includes("cancelled.json") ||
		!files.includes("manifest.json")
	)
		return false;
	const manifest = z
		.object({
			source: z.object({
				projectId: z.uuid(),
				approvalHash: z.string().regex(/^[a-f0-9]{32}$/),
				runId: z.uuid().optional(),
			}),
		})
		.parse(
			JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")),
		);
	if (!manifest.source.runId) return false;
	const done = z
		.object({ size: z.number().int().positive() })
		.parse(JSON.parse(await readFile(join(directory, "done.json"), "utf8")));
	const output = await stat(join(directory, "output.mp4"));
	if (!output.isFile() || output.size !== done.size)
		throw new Error(
			"The finished export file does not match its completion record.",
		);
	const result = await createServiceClient().rpc("complete_film_run_export", {
		p_run_id: manifest.source.runId,
		p_user_id: z.uuid().parse(userId),
		p_project_id: manifest.source.projectId,
		p_render_id: z.uuid().parse(renderId),
		p_approval_hash: manifest.source.approvalHash,
	});
	if (result.error)
		throw new Error(
			"Could not record the completed film run. Please retry checking the export.",
		);
	return z.boolean().parse(result.data);
}
