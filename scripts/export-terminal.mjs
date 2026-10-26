import { readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function publishExportFailure(directory, reason) {
	const files = await readdir(directory);
	if (
		["done.json", "failed.json", "cancelled.json"].some((name) =>
			files.includes(name),
		)
	)
		return;
	const cancelled = files.includes("cancel-observed");
	const terminal = cancelled ? "cancelled.json" : "failed.json";
	await writeFile(
		join(directory, "terminal.tmp"),
		JSON.stringify({ reason: cancelled ? "Cancelled by user" : reason }),
		{ mode: 0o600 },
	);
	await rename(join(directory, "terminal.tmp"), join(directory, terminal));
}

export async function recoverInterruptedExport(directory) {
	if (!(await readdir(directory)).includes("processing.json")) return;
	await publishExportFailure(directory, "Worker restarted");
	await unlink(join(directory, "processing.json"));
}
