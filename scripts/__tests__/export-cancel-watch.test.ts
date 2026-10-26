import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { watchExportCancellation } from "../export-cancel-watch.mjs";

let directory: string;
beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "fylmer-cancel-watch-"));
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
	rmSync(directory, { recursive: true, force: true });
});
it("delivers an existing cancellation immediately and only once", () => {
	writeFileSync(join(directory, "cancel-requested"), "");
	const cancel = vi.fn();
	const stop = watchExportCancellation(directory, cancel);
	vi.advanceTimersByTime(1000);
	expect(cancel).toHaveBeenCalledTimes(1);
	stop();
});
it("detects a request arriving during rendering", () => {
	const cancel = vi.fn();
	const stop = watchExportCancellation(directory, cancel);
	vi.advanceTimersByTime(500);
	expect(cancel).not.toHaveBeenCalled();
	writeFileSync(join(directory, "cancel-requested"), "");
	vi.advanceTimersByTime(250);
	expect(cancel).toHaveBeenCalledTimes(1);
	stop();
});
it("stops watching once the render ends", () => {
	const cancel = vi.fn();
	watchExportCancellation(directory, cancel)();
	writeFileSync(join(directory, "cancel-requested"), "");
	vi.advanceTimersByTime(1000);
	expect(cancel).not.toHaveBeenCalled();
});
