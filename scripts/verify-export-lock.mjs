import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { withExportLock } from "../lib/render/export-lock.ts";

const root = await mkdtemp(join(tmpdir(), "fylmer-lock-process-"));
const lock = join(root, "admission.lock");
const moduleUrl = pathToFileURL(resolve("lib/render/export-lock.ts")).href;
const children = [];
function requester(operation) {
	const code = `import { withExportLock } from ${JSON.stringify(moduleUrl)};
import { readFile, writeFile } from 'node:fs/promises';
await withExportLock(${JSON.stringify(lock)}, async () => { ${operation} });`;
	const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
		stdio: ["ignore", "pipe", "pipe"],
	});
	children.push(child);
	return child;
}
const checks = [];
try {
	const counter = join(root, "counter");
	await writeFile(counter, "0");
	await Promise.all(
		Array.from({ length: 8 }, async () => {
			const child =
				requester(`const count = Number(await readFile(${JSON.stringify(counter)}, 'utf8'));
await new Promise(resolve => setTimeout(resolve, 50));
await writeFile(${JSON.stringify(counter)}, String(count + 1));`);
			const [code] = await once(child, "close");
			assert.equal(code, 0);
		}),
	);
	assert.equal(await readFile(counter, "utf8"), "8");
	checks.push(
		"Eight separate processes serialize the read-modify-write operation",
	);
	await assert.rejects(
		withExportLock(lock, async () => {
			throw new Error("fixture failure");
		}),
		/fixture failure/,
	);
	assert.equal(await withExportLock(lock, async () => "released"), "released");
	checks.push("A failed operation releases the kernel lock");
	const holder = requester(
		"process.stdout.write('held'); await new Promise(() => { setInterval(() => {}, 1000); });",
	);
	await once(holder.stdout, "data");
	await assert.rejects(
		withExportLock(lock, async () => "unexpected"),
		/queue is busy/,
	);
	checks.push(
		"An occupied lock times out rather than admitting another operation",
	);
	const exited = once(holder, "close");
	holder.kill("SIGKILL");
	await exited;
	assert.equal(
		await withExportLock(lock, async () => "recovered"),
		"recovered",
	);
	checks.push(
		"Killing the requesting process releases its child-held lock without deleting the lock file",
	);
	console.log(
		JSON.stringify({ checks, providerCalls: 0, temporaryOnly: true }),
	);
} finally {
	for (const child of children) {
		if (child.exitCode === null && child.signalCode === null)
			child.kill("SIGKILL");
	}
	await rm(root, { recursive: true, force: true });
}
