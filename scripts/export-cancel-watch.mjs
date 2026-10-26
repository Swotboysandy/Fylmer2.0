import { existsSync } from "node:fs";
import { join } from "node:path";

export function exportCancellationRequested(directory) {
	return existsSync(join(directory, "cancel-requested"));
}

export function watchExportCancellation(directory, cancel) {
	let observed = false;
	const check = () => {
		if (!observed && exportCancellationRequested(directory)) {
			observed = true;
			cancel();
		}
	};
	check();
	const timer = setInterval(check, 250);
	timer.unref();
	return () => clearInterval(timer);
}
