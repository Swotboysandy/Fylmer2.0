import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const style = {
	fill: "#ffffff",
	bold: true,
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
				id: "synthetic",
				type: "image",
				role: "foreground",
				layer: "visual",
				sceneId: "scene-1",
				sceneNumber: 1,
				prompt: "Synthetic cancellation fixture",
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
const checks = [];
for (const mode of ["before-start", "during-render"]) {
	const directory = await mkdtemp(join(tmpdir(), "fylmer-cpu-cancel-"));
	let child;
	let exited = false;
	try {
		await writeFile(join(directory, "props.json"), JSON.stringify(props));
		if (mode === "before-start")
			await writeFile(join(directory, "cancel-requested"), "");
		child = spawn(
			process.execPath,
			[
				"scripts/render-local-export-cancel-candidate.mjs",
				join(process.cwd(), "build"),
				directory,
			],
			{ detached: true, stdio: ["ignore", "ignore", "pipe"] },
		);
		let errors = "";
		child.stderr.on("data", (chunk) => {
			errors = (errors + chunk).slice(-4000);
		});
		const closed = new Promise((resolve, reject) => {
			child.once("error", reject);
			child.once("close", (code) => {
				exited = true;
				resolve(code);
			});
		});
		if (mode === "during-render") {
			const deadline = Date.now() + 180000;
			let measured = 0;
			while (Date.now() < deadline && !exited && measured === 0) {
				try {
					measured = JSON.parse(
						await readFile(join(directory, "progress.json"), "utf8"),
					).progress;
				} catch (error) {
					if (error.code !== "ENOENT") throw error;
				}
				if (!measured) await sleep(100);
			}
			assert.ok(
				measured > 0 && measured < 1,
				errors || "Renderer did not report intermediate progress",
			);
			await writeFile(join(directory, "cancel-requested"), "");
		}
		let timeout;
		const code = await Promise.race([
			closed,
			new Promise((_, reject) => {
				timeout = setTimeout(
					() =>
						reject(
							new Error(
								"Cancellation did not stop the renderer within 30 seconds",
							),
						),
					30000,
				);
			}),
		]).finally(() => clearTimeout(timeout));
		assert.notEqual(code, 0, "Cancelled render must not report success");
		assert.ok((await readdir(directory)).includes("cancel-observed"), errors);
		checks.push(`${mode}: renderer exited and acknowledged cancellation`);
	} finally {
		if (child?.pid && !exited) process.kill(-child.pid, "SIGKILL");
		await rm(directory, { recursive: true, force: true });
	}
}
console.log(JSON.stringify({ checks, syntheticOnly: true, providerCalls: 0 }));
