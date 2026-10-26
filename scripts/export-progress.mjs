import { renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function createExportProgressReporter(directory) {
	let lastProgress = 0;
	let lastWrite = -Infinity;
	return ({ progress: measured }) => {
		if (!Number.isFinite(measured) || measured < 0 || measured > 1)
			throw new Error("Invalid renderer progress");
		const progress = Math.min(measured, 0.99);
		if (progress <= lastProgress) return;
		const now = Date.now();
		if (now - lastWrite < 500 && progress < 0.99) return;
		const temporary = join(directory, "progress.tmp");
		writeFileSync(temporary, JSON.stringify({ progress }), { mode: 0o600 });
		renameSync(temporary, join(directory, "progress.json"));
		lastProgress = progress;
		lastWrite = now;
	};
}
