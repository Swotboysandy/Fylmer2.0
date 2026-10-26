import type { SupabaseClient } from "@supabase/supabase-js";
import { setTimeout as delay } from "node:timers/promises";
import { beforeEach, expect, it, vi } from "vitest";
import { tickFilmRun } from "../tick-film-run";
import { continueFilmRun } from "../continue-film-run";

vi.mock("../tick-film-run", () => ({ tickFilmRun: vi.fn() }));
vi.mock("node:timers/promises", () => ({ setTimeout: vi.fn() }));
const client = {} as SupabaseClient;
const input = { runId: "run", appOrigin: "http://127.0.0.1:3055" };
const waiting = {
	kind: "waiting" as const,
	leaseId: "owned-lease",
	nodeId: "shot",
	jobId: "job",
};
beforeEach(() => {
	vi.resetAllMocks();
	vi.mocked(delay).mockResolvedValue(undefined);
	vi.mocked(tickFilmRun).mockResolvedValue(waiting);
});
it("retains its lease across dispatch, wait and commit before stopping for final review", async () => {
	vi.mocked(tickFilmRun)
		.mockResolvedValueOnce({ ...waiting, kind: "dispatched" })
		.mockResolvedValueOnce(waiting)
		.mockResolvedValueOnce({ ...waiting, kind: "committed" })
		.mockResolvedValueOnce({
			kind: "review",
			stage: "final",
			leaseId: waiting.leaseId,
		});
	expect(await continueFilmRun(client, input)).toMatchObject({
		kind: "review",
		stage: "final",
	});
	expect(tickFilmRun).toHaveBeenCalledTimes(4);
	expect(tickFilmRun).toHaveBeenLastCalledWith(client, {
		...input,
		leaseId: waiting.leaseId,
	});
	expect(delay).toHaveBeenCalledTimes(3);
});
it.each([
	{ kind: "paused" },
	{ kind: "stopped", leaseId: "owned-lease" },
	{ kind: "unavailable" },
] as const)("stops without retrying $kind", async (result) => {
	vi.mocked(tickFilmRun).mockResolvedValue(result);
	expect(await continueFilmRun(client, input)).toEqual(result);
	expect(delay).not.toHaveBeenCalled();
});
it("does not retry failed jobs or skip image review", async () => {
	vi.mocked(tickFilmRun).mockResolvedValueOnce({
		...waiting,
		kind: "attention",
	});
	expect(await continueFilmRun(client, input)).toMatchObject({
		kind: "attention",
	});
	vi.mocked(tickFilmRun).mockResolvedValueOnce({
		kind: "review",
		stage: "images",
		leaseId: waiting.leaseId,
	});
	expect(await continueFilmRun(client, input)).toMatchObject({
		kind: "review",
		stage: "images",
	});
	expect(delay).not.toHaveBeenCalled();
});
it("yields ownership after a bounded pass instead of looping forever", async () => {
	expect(await continueFilmRun(client, input, { maxTicks: 2 })).toEqual({
		kind: "yielded",
		leaseId: waiting.leaseId,
		lastResult: waiting,
	});
	expect(tickFilmRun).toHaveBeenCalledTimes(2);
	expect(delay).toHaveBeenCalledExactlyOnceWith(5000, undefined, {
		signal: undefined,
	});
});
it("does not begin a stopped worker and interrupts its polling wait", async () => {
	const controller = new AbortController();
	controller.abort();
	expect(
		await continueFilmRun(client, input, { signal: controller.signal }),
	).toMatchObject({ kind: "interrupted" });
	expect(tickFilmRun).not.toHaveBeenCalled();
	const active = new AbortController();
	vi.mocked(delay).mockImplementationOnce(async () => {
		active.abort();
		throw new Error("aborted");
	});
	expect(
		await continueFilmRun(client, input, { signal: active.signal }),
	).toEqual({ kind: "interrupted", leaseId: waiting.leaseId });
	expect(tickFilmRun).toHaveBeenCalledTimes(1);
});
it("propagates unexpected failures without blind retry", async () => {
	vi.mocked(tickFilmRun).mockRejectedValueOnce(new Error("database down"));
	await expect(continueFilmRun(client, input)).rejects.toThrow("database down");
	expect(tickFilmRun).toHaveBeenCalledTimes(1);
});
it("rejects an unbounded tick request before touching the run", async () => {
	await expect(
		continueFilmRun(client, input, { maxTicks: 100 }),
	).rejects.toThrow();
	expect(tickFilmRun).not.toHaveBeenCalled();
});
