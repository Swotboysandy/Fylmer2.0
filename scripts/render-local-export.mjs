import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	makeCancelSignal,
	renderMedia,
	selectComposition,
} from "@remotion/renderer";
import { createExportProgressReporter } from "./export-progress.mjs";
import {
	exportCancellationRequested,
	watchExportCancellation,
} from "./export-cancel-watch.mjs";

const [bundle, directory] = process.argv.slice(2);
if (!bundle || !directory)
	throw new Error("Export bundle and directory required");
const inputProps = JSON.parse(
	await readFile(join(directory, "props.json"), "utf8"),
);
const browser = {
	browserExecutable:
		"/home/claudebot/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome",
	chromiumOptions: { gl: "swangle" },
	logLevel: "warn",
};
const { cancelSignal, cancel } = makeCancelSignal();
const stopWatching = watchExportCancellation(directory, cancel);
try {
	if (exportCancellationRequested(directory))
		throw new Error("renderMedia() got cancelled");
	const composition = await selectComposition({
		...browser,
		serveUrl: bundle,
		id: "VideoComposition",
		inputProps,
	});
	await renderMedia({
		cancelSignal,
		...browser,
		composition,
		serveUrl: bundle,
		inputProps,
		outputLocation: join(directory, "output.mp4"),
		codec: "h264",
		imageFormat: "jpeg",
		scale: 1,
		concurrency: 1,
		onProgress: createExportProgressReporter(directory),
	});
} catch (error) {
	if (
		exportCancellationRequested(directory) &&
		error instanceof Error &&
		/^(renderMedia|renderFrames|renderStill|stitchFramesToVideo)\(\) got cancelled$/.test(
			error.message,
		)
	) {
		await writeFile(join(directory, "cancel-observed"), "", { mode: 0o600 });
	}
	throw error;
} finally {
	stopWatching();
}
