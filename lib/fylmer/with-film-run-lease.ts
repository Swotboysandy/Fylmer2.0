import type { SupabaseClient } from "@supabase/supabase-js";

export async function withFilmRunLease<T>(
	client: SupabaseClient,
	input: { runId: string; leaseId: string },
	work: (assertActive: () => void) => Promise<T>,
) {
	const renew = async () => {
		const result = await client
			.rpc("film_run_lease", {
				p_run_id: input.runId,
				p_action: "renew",
				p_lease_id: input.leaseId,
			})
			.abortSignal(AbortSignal.timeout(10000));
		if (result.error || !result.data)
			throw new Error("The film run lease was lost or could not be renewed.");
	};
	await renew();
	let stopped = false;
	let failure: Error | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let pending = Promise.resolve();
	const assertActive = () => {
		if (failure) throw failure;
	};
	const schedule = () => {
		timer = setTimeout(() => {
			pending = renew()
				.catch(() => {
					failure = new Error(
						"The film run lease was lost or could not be renewed.",
					);
				})
				.finally(() => {
					if (!stopped && !failure) schedule();
				});
		}, 15000);
	};
	schedule();
	try {
		const result = await work(assertActive);
		stopped = true;
		clearTimeout(timer);
		await pending;
		assertActive();
		await renew();
		return result;
	} finally {
		stopped = true;
		clearTimeout(timer);
		await pending;
	}
}
