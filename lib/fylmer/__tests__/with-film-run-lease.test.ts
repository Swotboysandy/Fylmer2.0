import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withFilmRunLease } from "../with-film-run-lease";

const input = { runId: "run-fixture", leaseId: "lease-fixture" };
const delay = (milliseconds: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
function fixture() {
	const renew = vi
		.fn()
		.mockResolvedValue({ data: { lease_id: input.leaseId }, error: null });
	const rpc = vi.fn(() => ({ abortSignal: renew }));
	return { renew, rpc, client: { rpc } as unknown as SupabaseClient };
}
it("renews during preprocessing longer than the sixty-second lease and clears timers", async () => {
	const { client, renew, rpc } = fixture();
	const result = withFilmRunLease(client, input, async (assertActive) => {
		await delay(70000);
		assertActive();
		return "compiled";
	});
	await vi.advanceTimersByTimeAsync(70000);
	expect(await result).toBe("compiled");
	expect(renew).toHaveBeenCalledTimes(6);
	expect(rpc).toHaveBeenCalledWith("film_run_lease", {
		p_run_id: input.runId,
		p_action: "renew",
		p_lease_id: input.leaseId,
	});
	expect(vi.getTimerCount()).toBe(0);
});
it("does not continue to pricing after a revoked lease", async () => {
	const { client, renew } = fixture();
	renew
		.mockResolvedValueOnce({ data: {}, error: null })
		.mockResolvedValueOnce({ data: null, error: null });
	const quote = vi.fn();
	const result = withFilmRunLease(client, input, async (assertActive) => {
		await delay(20000);
		assertActive();
		quote();
	}).catch((error) => error);
	await vi.advanceTimersByTimeAsync(20000);
	expect(await result).toBeInstanceOf(Error);
	expect(quote).not.toHaveBeenCalled();
	expect(vi.getTimerCount()).toBe(0);
});
it("never starts work without a renewable lease", async () => {
	const { client, renew } = fixture();
	renew.mockResolvedValue({ data: null, error: null });
	const work = vi.fn();
	await expect(withFilmRunLease(client, input, work)).rejects.toThrow(
		"lease was lost",
	);
	expect(work).not.toHaveBeenCalled();
	expect(vi.getTimerCount()).toBe(0);
});
it("clears scheduled renewals when preprocessing fails", async () => {
	const { client } = fixture();
	await expect(
		withFilmRunLease(client, input, async () => {
			throw new Error("bad media");
		}),
	).rejects.toThrow("bad media");
	expect(vi.getTimerCount()).toBe(0);
});
it("waits for an in-flight renewal and rejects its failure after work finishes", async () => {
	const { client, renew } = fixture();
	renew
		.mockResolvedValueOnce({ data: {}, error: null })
		.mockImplementationOnce(async () => {
			await delay(5000);
			return { data: null, error: null };
		});
	let settled = false;
	const result = withFilmRunLease(client, input, async () => {
		await delay(16000);
		return "compiled";
	})
		.catch((error) => error)
		.finally(() => {
			settled = true;
		});
	await vi.advanceTimersByTimeAsync(16000);
	expect(settled).toBe(false);
	await vi.advanceTimersByTimeAsync(4000);
	expect(await result).toBeInstanceOf(Error);
	expect(renew).toHaveBeenCalledTimes(2);
	expect(vi.getTimerCount()).toBe(0);
});
it("serializes slow renewals and refuses a failed final lease check", async () => {
	const { client, renew } = fixture();
	renew
		.mockResolvedValueOnce({ data: {}, error: null })
		.mockImplementationOnce(async () => {
			await delay(8000);
			return { data: {}, error: null };
		})
		.mockRejectedValueOnce(new Error("connection lost"));
	const result = withFilmRunLease(client, input, async () => {
		await delay(17000);
		return "compiled";
	}).catch((error) => error);
	await vi.advanceTimersByTimeAsync(22000);
	expect(renew).toHaveBeenCalledTimes(2);
	await vi.advanceTimersByTimeAsync(1000);
	expect(await result).toBeInstanceOf(Error);
	expect(renew).toHaveBeenCalledTimes(3);
	expect(vi.getTimerCount()).toBe(0);
});
