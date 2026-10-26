import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { prepareFilmRunPlan } from "./prepare-run-plan";
import { advanceFilmRun } from "./advance-film-run";

export async function tickFilmRun(
	client: SupabaseClient,
	input: { runId: string; leaseId?: string; appOrigin: string },
) {
	if (process.env.FYLMER_STAGING_GENERATION_ENABLED !== "1")
		return { kind: "paused" as const };
	z.uuid().parse(input.runId);
	let leaseId = input.leaseId;
	if (leaseId !== undefined) z.uuid().parse(leaseId);
	else {
		await prepareFilmRunPlan(client, input.runId);
		const claimed = await client
			.rpc("film_run_lease", {
				p_run_id: input.runId,
				p_action: "claim",
				p_lease_id: null,
			})
			.abortSignal(AbortSignal.timeout(10000));
		if (claimed.error) throw new Error(claimed.error.message);
		if (!claimed.data) return { kind: "unavailable" as const };
		leaseId = z.object({ lease_id: z.uuid() }).parse(claimed.data).lease_id;
	}
	let result: Awaited<ReturnType<typeof advanceFilmRun>>;
	try {
		result = await advanceFilmRun(client, { ...input, leaseId });
	} catch (error) {
		const stopped = await client.rpc("stop_film_run_coordinator", {
			p_run_id: input.runId,
			p_lease_id: leaseId,
			p_reason: "job_attention",
		});
		if (stopped.error)
			throw new AggregateError(
				[error, new Error(stopped.error.message)],
				"Film coordination failed and its stop could not be recorded.",
			);
		throw error;
	}
	if (result.kind === "review" || result.kind === "attention") {
		const stopped = await client.rpc("stop_film_run_coordinator", {
			p_run_id: input.runId,
			p_lease_id: leaseId,
			p_reason:
				result.kind === "review" ? `${result.stage}_review` : "job_attention",
		});
		if (stopped.error) throw new Error(stopped.error.message);
	}
	return { ...result, leaseId };
}
