import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { exportDirectory } from "./local-export";

export async function requestExportCancellation(
	userId: string,
	renderId: string,
) {
	const directory = exportDirectory(userId, renderId);
	const files = await readdir(directory);
	if (files.includes("done.json")) return "done" as const;
	if (files.includes("cancelled.json")) return "cancelled" as const;
	if (files.includes("failed.json")) return "failed" as const;
	if (!files.includes("pending.json") && !files.includes("processing.json"))
		throw new Error("No active export found.");
	try {
		await writeFile(join(directory, "cancel-requested"), "", {
			flag: "wx",
			mode: 0o600,
		});
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
	return "requested" as const;
}
