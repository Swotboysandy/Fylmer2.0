import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { prepareFilmRunPlan } from "../prepare-run-plan";
import { advanceFilmRun } from "../advance-film-run";
import { tickFilmRun } from "../tick-film-run";

vi.mock("../prepare-run-plan", () => ({ prepareFilmRunPlan: vi.fn() }));
vi.mock("../advance-film-run", () => ({ advanceFilmRun: vi.fn() }));
const runId = "11111111-1111-4111-8111-111111111111";
const leaseId = "22222222-2222-4222-8222-222222222222";
const input = { runId, appOrigin: "http://127.0.0.1:3055" };
const claim = vi.fn();
const rpc = vi.fn(() => ({ abortSignal: claim }));
const client = { rpc } as unknown as SupabaseClient;
beforeEach(() => {
	vi.resetAllMocks();
	vi.stubEnv("FYLMER_STAGING_GENERATION_ENABLED", "1");
	claim.mockResolvedValue({ data: { lease_id: leaseId }, error: null });
	vi.mocked(advanceFilmRun).mockResolvedValue({
		kind: "waiting",
		nodeId: "shot",
		jobId: runId,
	});
});
afterEach(() => vi.unstubAllEnvs());
it("does nothing while generation is disabled", async () => {
	vi.stubEnv("FYLMER_STAGING_GENERATION_ENABLED", "0");
	expect(await tickFilmRun(client, input)).toEqual({ kind: "paused" });
	expect(prepareFilmRunPlan).not.toHaveBeenCalled();
	expect(rpc).not.toHaveBeenCalled();
	expect(advanceFilmRun).not.toHaveBeenCalled();
});
it("prepares then claims and returns ownership for the next bounded tick", async () => {
	expect(await tickFilmRun(client, input)).toMatchObject({
		kind: "waiting",
		leaseId,
	});
	expect(prepareFilmRunPlan).toHaveBeenCalledWith(client, runId);
	expect(rpc).toHaveBeenCalledWith("film_run_lease", {
		p_run_id: runId,
		p_action: "claim",
		p_lease_id: null,
	});
	expect(advanceFilmRun).toHaveBeenCalledExactlyOnceWith(client, {
		...input,
		leaseId,
	});
});
it("reuses only the supplied lease without replanning or reclaiming", async () => {
	vi.mocked(advanceFilmRun).mockResolvedValue({ kind: "stopped" });
	expect(await tickFilmRun(client, { ...input, leaseId })).toEqual({
		kind: "stopped",
		leaseId,
	});
	expect(prepareFilmRunPlan).not.toHaveBeenCalled();
	expect(rpc).not.toHaveBeenCalled();
});
it("does not advance a run owned by another worker", async () => {
	claim.mockResolvedValue({ data: null, error: null });
	expect(await tickFilmRun(client, input)).toEqual({ kind: "unavailable" });
	expect(advanceFilmRun).not.toHaveBeenCalled();
});
it("stops before claiming when planning fails", async () => {
	vi.mocked(prepareFilmRunPlan).mockRejectedValue(new Error("review required"));
	await expect(tickFilmRun(client, input)).rejects.toThrow("review required");
	expect(rpc).not.toHaveBeenCalled();
});
it("fails closed on claim errors or malformed ownership", async () => {
	claim.mockResolvedValueOnce({
		data: null,
		error: { message: "database unavailable" },
	});
	await expect(tickFilmRun(client, input)).rejects.toThrow(
		"database unavailable",
	);
	claim.mockResolvedValueOnce({ data: { lease_id: "invalid" }, error: null });
	await expect(tickFilmRun(client, input)).rejects.toThrow();
	expect(advanceFilmRun).not.toHaveBeenCalled();
});
