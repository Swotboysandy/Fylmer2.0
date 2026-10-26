import type { SupabaseClient } from "@supabase/supabase-js";
import { buildFilmRunPlan } from "./run-plan";
import { FilmRunPlanSchema } from "./run-plan-schema";

export async function prepareFilmRunPlan(
	client: SupabaseClient,
	runId: string,
) {
	const run = await client
		.from("film_runs")
		.select("project_id,status,plan")
		.eq("id", runId)
		.single();
	if (run.error) throw new Error("Could not read the film run.");
	if (run.data.status !== "queued")
		throw new Error("Only queued runs can be planned.");
	if (run.data.plan !== null) return FilmRunPlanSchema.parse(run.data.plan);
	const project = await client
		.from("projects")
		.select("script,store,generation")
		.eq("id", run.data.project_id)
		.single();
	if (project.error)
		throw new Error("Could not read the canonical film project.");
	const plan = buildFilmRunPlan(project.data);
	const installed = await client.rpc("install_film_run_plan", {
		p_run_id: runId,
		p_generation: project.data.generation,
		p_plan: plan,
	});
	if (installed.error) throw new Error(installed.error.message);
	return plan;
}
