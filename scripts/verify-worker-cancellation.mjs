import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const workspace = await mkdtemp(join(tmpdir(), "fylmer-worker-cancel-"));
const checks = [];
const style = {
	fill: "#ffffff",
	bold: false,
	italic: false,
	underline: false,
	border: null,
	background: null,
};
const props = {
	width: 854,
	height: 480,
	fps: 24,
	totalFrames: 1440,
	totalDurationSec: 60,
	transitionType: "none",
	transitionDurationSec: 0,
	sequences: {},
	captionStyle: {
		font: "inter",
		fontSize: 40,
		casing: "none",
		alignX: "center",
		alignY: "bottom",
		maxWordsPerLine: 4,
		reveal: "word",
		base: style,
		activeWord: style,
	},
	series: [
		{
			start: 0,
			duration: 60,
			element: {
				id: "fixture",
				type: "image",
				role: "foreground",
				layer: "visual",
				sceneId: "scene-1",
				sceneNumber: 1,
				prompt: "Synthetic worker fixture",
				url: `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="854" height="480"><rect width="854" height="480" fill="blue"/></svg>').toString("base64")}`,
				durationSec: 60,
				loops: 1,
				loop: false,
				trimToDialogue: false,
				volume: 1,
				motion: "none",
			},
		},
	],
};
async function waitFor(predicate, timeout = 30000) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		if (await predicate()) return;
		await sleep(100);
	}
	throw new Error("Worker fixture timed out");
}
try {
	await mkdir(join(workspace, "scripts"));
	for (const name of [
		"export-terminal.mjs",
		"export-progress.mjs",
		"export-cancel-watch.mjs",
	]) {
		await copyFile(
			join(process.cwd(), "scripts", name),
			join(workspace, "scripts", name),
		);
	}
	await copyFile(
		join(process.cwd(), "scripts/local-export-worker-cancel-candidate.mjs"),
		join(workspace, "scripts/worker.mjs"),
	);
	await copyFile(
		join(process.cwd(), "scripts/render-local-export-cancel-candidate.mjs"),
		join(workspace, "scripts/render-local-export.mjs"),
	);
	await symlink(
		join(process.cwd(), "node_modules"),
		join(workspace, "node_modules"),
	);
	await symlink(join(process.cwd(), "build"), join(workspace, "build"));
	for (const mode of [
		"pending-cancel",
		"running-cancel",
		"restart-acknowledged",
		"restart-completed",
	]) {
		const root = join(workspace, mode);
		const directory = join(root, randomUUID(), randomUUID());
		await mkdir(directory, { recursive: true });
		const restarted = mode.startsWith("restart");
		await writeFile(
			join(directory, restarted ? "processing.json" : "pending.json"),
			JSON.stringify({ inputProps: props, scale: 1 }),
		);
		if (mode === "pending-cancel")
			await writeFile(join(directory, "cancel-requested"), "");
		if (mode === "restart-acknowledged")
			await writeFile(join(directory, "cancel-observed"), "");
		if (mode === "restart-completed")
			await writeFile(join(directory, "done.json"), '{"size":123}');
		const child = spawn(process.execPath, ["scripts/worker.mjs"], {
			cwd: workspace,
			detached: true,
			env: {
				...process.env,
				FYLMER_EXPORT_DIRECTORY: root,
				FYLMER_EXPORT_BACKEND: "local",
			},
			stdio: ["ignore", "ignore", "pipe"],
		});
		let exited = false;
		let errors = "";
		child.stderr.on("data", (chunk) => {
			errors = (errors + chunk).slice(-4000);
		});
		const closed = new Promise((resolve) =>
			child.once("close", () => {
				exited = true;
				resolve();
			}),
		);
		try {
			if (mode === "running-cancel") {
				await waitFor(async () => {
					assert.equal(exited, false, errors);
					try {
						return (
							JSON.parse(
								await readFile(join(directory, "progress.json"), "utf8"),
							).progress > 0
						);
					} catch (error) {
						if (error.code === "ENOENT") return false;
						throw error;
					}
				}, 180000);
				assert.ok((await readdir(directory)).includes("processing.json"));
				await writeFile(join(directory, "cancel-requested"), "");
			}
			const terminal =
				mode === "restart-completed" ? "done.json" : "cancelled.json";
			await waitFor(async () => {
				assert.equal(exited, false, errors);
				const files = await readdir(directory);
				return files.includes(terminal) && !files.includes("processing.json");
			});
			const files = await readdir(directory);
			assert.equal(files.includes("failed.json"), false, errors);
			assert.equal(files.includes("pending.json"), false);
			if (terminal === "done.json")
				assert.equal(
					await readFile(join(directory, terminal), "utf8"),
					'{"size":123}',
				);
			else
				assert.equal(
					JSON.parse(await readFile(join(directory, terminal), "utf8")).reason,
					"Cancelled by user",
				);
			checks.push(mode);
		} finally {
			if (!exited) process.kill(-child.pid, "SIGKILL");
			await closed;
		}
	}
} finally {
	await rm(workspace, { recursive: true, force: true });
}
console.log(JSON.stringify({ checks, syntheticOnly: true, providerCalls: 0 }));
