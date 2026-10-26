import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { GenerationSnapshotSchema } from "@/lib/generation/snapshots";
import { resolveCompletedRunResult } from "./completed-run-result";

export async function commitFilmRunResult(
	client: SupabaseClient,
	runId: string,
	leaseId: string,
	nodeId: string,
	appOrigin?: string,
) {
	const binding = await client
		.from("film_run_jobs")
		.select("job_id,committed_at")
		.eq("run_id", runId)
		.eq("node_id", nodeId)
		.single();
	if (binding.error) throw new Error("Could not read the admitted film job.");
	if (binding.data.committed_at) {
		const existing = await client.rpc("commit_film_run_job", {
			p_run_id: runId,
			p_lease_id: leaseId,
			p_node_id: nodeId,
			p_bundle: null,
			p_result: null,
		});
		if (existing.error) throw new Error(existing.error.message);
		return GenerationSnapshotSchema.parse(existing.data);
	}
	const jobId = z.object({ job_id: z.uuid() }).parse(binding.data).job_id;
	const job = await client
		.from("jobs")
		.select("id,status,connector_type,request,result")
		.eq("id", jobId)
		.single();
	if (job.error) throw new Error("Could not read the completed film job.");
	const result = await resolveCompletedRunResult(
		job.data,
		appOrigin ? { client, appOrigin } : undefined,
	);
	const committed = await client.rpc("commit_film_run_job", {
		p_run_id: runId,
		p_lease_id: leaseId,
		p_node_id: nodeId,
		p_bundle: job.data.result,
		p_result: result,
	});
	if (committed.error) throw new Error(committed.error.message);
	return GenerationSnapshotSchema.parse(committed.data);
}
