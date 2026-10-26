import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { requestExportCancellation } from "../export-cancellation";

const userId = randomUUID();
const renderId = randomUUID();
let root: string;
let directory: string;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "fylmer-cancel-"));
	directory = join(root, userId, renderId);
	await mkdir(directory, { recursive: true });
	vi.stubEnv("FYLMER_EXPORT_DIRECTORY", root);
});
afterEach(async () => {
	vi.unstubAllEnvs();
	await rm(root, { recursive: true, force: true });
});
it.each(["pending.json", "processing.json"])(
	"requests cancellation without releasing %s capacity",
	async (state) => {
		await writeFile(join(directory, state), "{}");
		const results = await Promise.all(
			Array.from({ length: 8 }, () =>
				requestExportCancellation(userId, renderId),
			),
		);
		expect(results).toEqual(Array(8).fill("requested"));
		expect((await readdir(directory)).sort()).toEqual(
			["cancel-requested", state].sort(),
		);
	},
);
it.each(["done", "failed", "cancelled"])(
	"preserves a terminal %s result",
	async (state) => {
		await writeFile(join(directory, `${state}.json`), "{}");
		await writeFile(join(directory, "processing.json"), "{}");
		expect(await requestExportCancellation(userId, renderId)).toBe(state);
		expect(await readdir(directory)).not.toContain("cancel-requested");
	},
);
it("cannot request cancellation for another owner", async () => {
	await writeFile(join(directory, "processing.json"), "{}");
	await expect(
		requestExportCancellation(randomUUID(), renderId),
	).rejects.toThrow();
	expect(await readdir(directory)).toEqual(["processing.json"]);
});
it("refuses an unpublished or missing job", async () => {
	await expect(requestExportCancellation(userId, renderId)).rejects.toThrow(
		"No active export",
	);
	await expect(
		requestExportCancellation(userId, randomUUID()),
	).rejects.toThrow();
});
