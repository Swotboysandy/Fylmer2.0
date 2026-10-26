import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createExportProgressReporter } from "../export-progress.mjs";

let directory: string;
beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "fylmer-progress-reporter-"));
	vi.useFakeTimers();
	vi.setSystemTime(1000);
});
afterEach(() => {
	vi.useRealTimers();
	rmSync(directory, { recursive: true, force: true });
});
const current = () =>
	JSON.parse(readFileSync(join(directory, "progress.json"), "utf8"));
it("publishes measured progress atomically, throttles writes and never goes backwards", () => {
	const report = createExportProgressReporter(directory);
	report({ progress: 0 });
	expect(readdirSync(directory)).toEqual([]);
	report({ progress: 0.1 });
	expect(current()).toEqual({ progress: 0.1 });
	report({ progress: 0.2 });
	expect(current()).toEqual({ progress: 0.1 });
	vi.setSystemTime(1500);
	report({ progress: 0.3 });
	expect(current()).toEqual({ progress: 0.3 });
	vi.setSystemTime(2000);
	report({ progress: 0.2 });
	expect(current()).toEqual({ progress: 0.3 });
	expect(readdirSync(directory)).toEqual(["progress.json"]);
});
it("reserves completion for the worker's validated output", () => {
	const report = createExportProgressReporter(directory);
	report({ progress: 0.5 });
	report({ progress: 1 });
	expect(current()).toEqual({ progress: 0.99 });
});
it.each([-1, 2, NaN, Infinity])(
	"rejects invalid renderer progress %s",
	(progress) => {
		expect(() => createExportProgressReporter(directory)({ progress })).toThrow(
			"Invalid renderer progress",
		);
		expect(readdirSync(directory)).toEqual([]);
	},
);
