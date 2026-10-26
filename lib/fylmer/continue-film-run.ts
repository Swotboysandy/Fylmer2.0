import type { SupabaseClient } from "@supabase/supabase-js";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { tickFilmRun } from "./tick-film-run";

export async function continueFilmRun(
	client: SupabaseClient,
	input: { runId: string; leaseId?: string; appOrigin: string },
	options: { maxTicks?: number; signal?: AbortSignal } = {},
) {
	const maxTicks = z
		.number()
		.int()
		.min(1)
		.max(12)
		.parse(options.maxTicks ?? 12);
	let leaseId = input.leaseId;
	for (let tick = 0; tick < maxTicks; tick++) {
		if (options.signal?.aborted)
			return { kind: "interrupted" as const, leaseId };
		const result = await tickFilmRun(client, { ...input, leaseId });
		if ("leaseId" in result) leaseId = result.leaseId;
		if (!["waiting", "dispatched", "committed"].includes(result.kind))
			return result;
		if (tick + 1 === maxTicks)
			return { kind: "yielded" as const, leaseId, lastResult: result };
		try {
			await delay(5000, undefined, { signal: options.signal });
		} catch (error) {
			if (options.signal?.aborted)
				return { kind: "interrupted" as const, leaseId };
			throw error;
		}
	}
	throw new Error(
		"The film coordinator exhausted its tick bound unexpectedly.",
	);
}
