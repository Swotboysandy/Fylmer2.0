import {
	readdir,
	readFile,
	rename,
	writeFile,
	stat,
	unlink,
} from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout } from "node:timers/promises";
import { z } from "zod";
import {
	publishExportFailure,
	recoverInterruptedExport,
} from "./export-terminal.mjs";

const run = promisify(execFile);
const root = process.env.FYLMER_EXPORT_DIRECTORY;
if (!root || process.env.FYLMER_EXPORT_BACKEND !== "local")
	throw new Error("Local export is not configured");
const bundle = join(process.cwd(), "build");
await stat(join(bundle, "index.html"));
let stopping = false;
process.on("SIGTERM", () => {
	stopping = true;
});
process.on("SIGINT", () => {
	stopping = true;
});
let firstScan = true;
while (!stopping) {
	for (const user of await readdir(root)) {
		if (!z.uuid().safeParse(user).success) continue;
		for (const id of await readdir(join(root, user))) {
			if (!z.uuid().safeParse(id).success) continue;
			const directory = join(root, user, id);
			const files = await readdir(directory);
			if (firstScan) await recoverInterruptedExport(directory);
			if (!files.includes("pending.json") || stopping) continue;
			await rename(
				join(directory, "pending.json"),
				join(directory, "processing.json"),
			);
			try {
				const request = JSON.parse(
					await readFile(join(directory, "processing.json"), "utf8"),
				);
				const props = {
					...request.inputProps,
					width: Math.round((request.inputProps.width * request.scale) / 2) * 2,
					height:
						Math.round((request.inputProps.height * request.scale) / 2) * 2,
				};
				await writeFile(join(directory, "props.json"), JSON.stringify(props), {
					mode: 0o600,
				});
				await run(
					process.execPath,
					["scripts/render-local-export.mjs", bundle, directory],
					{ timeout: 600_000, maxBuffer: 2 * 1024 * 1024 },
				);
				const output = await stat(join(directory, "output.mp4"));
				if (!output.size) throw new Error("Empty export");
				await writeFile(
					join(directory, "done.tmp"),
					JSON.stringify({ size: output.size }),
					{ mode: 0o600 },
				);
				await rename(join(directory, "done.tmp"), join(directory, "done.json"));
			} catch (error) {
				console.error("Export failed", id, error.message);
				await publishExportFailure(directory, "Render failed");
			} finally {
				await unlink(join(directory, "processing.json"));
			}
		}
	}
	firstScan = false;
	await setTimeout(2000);
}
