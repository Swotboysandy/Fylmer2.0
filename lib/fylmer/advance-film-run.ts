import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { quoteAssetCost } from "@/lib/api/asset-cost-quote";
import { FilmRunPlanSchema } from "./run-plan-schema";
import { compileFilmRunRequest } from "./compile-run-request";
import { commitFilmRunResult } from "./commit-run-result";
import { withFilmRunLease } from "./with-film-run-lease";

export async function advanceFilmRun(
	client: SupabaseClient,
	input: { runId: string; leaseId: string; appOrigin: string },
	quote: typeof quoteAssetCost = quoteAssetCost,
) {
	if (process.env.FYLMER_STAGING_GENERATION_ENABLED !== "1")
		return { kind: "paused" as const };
	z.uuid().parse(input.runId);
	z.uuid().parse(input.leaseId);
	const renewed = await client.rpc("film_run_lease", {
		p_run_id: input.runId,
		p_action: "renew",
		p_lease_id: input.leaseId,
	});
	if (renewed.error) throw new Error(renewed.error.message);
	if (!renewed.data) return { kind: "stopped" as const };
	const loaded = await client
		.from("film_runs")
		.select("user_id,project_id,plan")
		.eq("id", input.runId)
		.single();
	if (loaded.error) throw new Error("Could not load the leased film run.");
	const run = z
		.object({
			user_id: z.uuid(),
			project_id: z.uuid(),
			plan: FilmRunPlanSchema,
		})
		.parse(loaded.data);
	const linked = await client
		.from("film_run_jobs")
		.select("node_id,job_id,committed_at")
		.eq("run_id", input.runId);
	if (linked.error) throw new Error("Could not load film job bindings.");
	const bindings = z
		.array(
			z.object({
				node_id: z.string(),
				job_id: z.uuid(),
				committed_at: z.string().nullable(),
			}),
		)
		.parse(linked.data);
	const pending = bindings.filter((binding) => !binding.committed_at);
	const statuses = new Map<string, string>();
	if (pending.length) {
		const jobs = await client
			.from("jobs")
			.select("id,status")
			.in(
				"id",
				pending.map((binding) => binding.job_id),
			);
		if (jobs.error) throw new Error("Could not read film job status.");
		for (const job of z
			.array(z.object({ id: z.uuid(), status: z.string() }))
			.parse(jobs.data))
			statuses.set(job.id, job.status);
	}
	for (const binding of pending) {
		if (statuses.get(binding.job_id) !== "completed") continue;
		await commitFilmRunResult(
			client,
			input.runId,
			input.leaseId,
			binding.node_id,
			input.appOrigin,
		);
		return {
			kind: "committed" as const,
			nodeId: binding.node_id,
			jobId: binding.job_id,
		};
	}
	for (const binding of pending) {
		const status = statuses.get(binding.job_id);
		if (!["pending", "processing"].includes(status ?? ""))
			return {
				kind: "attention" as const,
				nodeId: binding.node_id,
				jobId: binding.job_id,
			};
		const dispatched = await client.rpc("dispatch_film_run_job", {
			p_run_id: input.runId,
			p_lease_id: input.leaseId,
			p_node_id: binding.node_id,
		});
		if (dispatched.error) throw new Error(dispatched.error.message);
		return {
			kind: "waiting" as const,
			nodeId: binding.node_id,
			jobId: binding.job_id,
		};
	}
	const generated = run.plan.nodes.filter((node) => node.action === "generate");
	const committed = new Set(
		bindings
			.filter((binding) => binding.committed_at)
			.map((binding) => binding.node_id),
	);
	if (generated.every((node) => committed.has(node.id)))
		return { kind: "review" as const, stage: "final" as const };
	const node = generated.find(
		(candidate) =>
			!committed.has(candidate.id) &&
			Object.values(candidate.dependsOn).every(
				(id) =>
					committed.has(id) ||
					run.plan.nodes.some(
						(dependency) =>
							dependency.id === id && dependency.action === "reuse",
					),
			),
	);
	if (!node) throw new Error("The film plan has unresolved dependencies.");
	const project = await client
		.from("projects")
		.select("generation")
		.eq("id", run.project_id)
		.eq("user_id", run.user_id)
		.single();
	if (project.error)
		throw new Error("Could not read the canonical selected takes.");
	const { priced, cost } = await withFilmRunLease(
		client,
		input,
		async (assertActive) => {
			const request = await compileFilmRunRequest(
				run.plan,
				node.id,
				project.data.generation,
				run.project_id,
				undefined,
				{ client, userId: run.user_id, appOrigin: input.appOrigin },
			);
			assertActive();
			const priced = { ...request, ...node.model };
			const cost = await quote(node.connectorType, priced);
			return { priced, cost };
		},
	);
	const admitted = await client.rpc("admit_film_run_job", {
		p_run_id: input.runId,
		p_lease_id: input.leaseId,
		p_node_id: node.id,
		p_request: priced,
		p_quote: cost,
	});
	if (admitted.error) {
		if (admitted.error.message.includes("Review the current images"))
			return { kind: "review" as const, stage: "images" as const };
		throw new Error(admitted.error.message);
	}
	const jobId = z.uuid().parse(admitted.data);
	const dispatched = await client.rpc("dispatch_film_run_job", {
		p_run_id: input.runId,
		p_lease_id: input.leaseId,
		p_node_id: node.id,
	});
	if (dispatched.error) throw new Error(dispatched.error.message);
	return { kind: "dispatched" as const, nodeId: node.id, jobId };
}
