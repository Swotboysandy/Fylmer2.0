import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { recoverInterruptedExport } from "../export-terminal.mjs";

let directory: string;
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "fylmer-terminal-"));
});
afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});
it.each(["done.json", "failed.json", "cancelled.json"])(
	"preserves %s and releases stale processing capacity",
	async (terminal) => {
		await writeFile(
			join(directory, terminal),
			JSON.stringify({ original: true }),
		);
		await writeFile(join(directory, "processing.json"), "{}");
		await recoverInterruptedExport(directory);
		expect(await readdir(directory)).toEqual([terminal]);
		expect(
			JSON.parse(await readFile(join(directory, terminal), "utf8")),
		).toEqual({ original: true });
	},
);
it("preserves cancellation acknowledged before worker interruption", async () => {
	await writeFile(join(directory, "processing.json"), "{}");
	await writeFile(join(directory, "cancel-observed"), "");
	await recoverInterruptedExport(directory);
	expect(await readdir(directory)).toContain("cancelled.json");
	expect(await readdir(directory)).not.toContain("processing.json");
});
it("does not misreport an unacknowledged request as cancelled", async () => {
	await writeFile(join(directory, "processing.json"), "{}");
	await writeFile(join(directory, "cancel-requested"), "");
	await recoverInterruptedExport(directory);
	expect(
		JSON.parse(await readFile(join(directory, "failed.json"), "utf8")),
	).toEqual({ reason: "Worker restarted" });
	expect(await readdir(directory)).not.toContain("cancelled.json");
});
it("leaves queued work untouched", async () => {
	await writeFile(join(directory, "pending.json"), "{}");
	await recoverInterruptedExport(directory);
	expect(await readdir(directory)).toEqual(["pending.json"]);
});
