import { z } from "zod";
import { createSessionRouteHandler } from "@/lib/api/route-handler";
import { createClient } from "@/lib/supabase/server";
import { preflightRunModels } from "@/lib/fylmer/preflight-run-models";
import { ProjectBudgetError } from "@/lib/api/project-budget-error";
import {
	FilmConnectionError,
	preflightRunConnections,
} from "@/lib/fylmer/preflight-run-connections";

const runSchema = z.object({
	id: z.uuid(),
	project_id: z.uuid(),
	user_id: z.uuid(),
	mode: z.enum(["directed", "autonomous"]),
	status: z.enum(["queued", "paused", "cancelled", "completed", "failed"]),
	coordinator_stop: z
		.enum(["images_review", "final_review", "job_attention"])
		.nullable(),
	updated_at: z.string(),
});

export const POST = createSessionRouteHandler({
	schema: z
		.object({
			projectId: z.uuid(),
			action: z.enum(["read", "start", "pause", "resume", "cancel"]),
			runId: z.uuid().optional(),
		})
		.strict()
		.refine((input) => input.action === "read" || input.runId !== undefined, {
			message: "A run identity is required.",
		}),
	label: "Film run",
	handle: async ({ input, user }) => {
		const headers = { "Cache-Control": "private, no-store" };
		const enabled =
			process.env.FYLMER_STAGING_GENERATION_ENABLED === "1" &&
			process.env.FYLMER_FILM_COORDINATOR_ENABLED === "1";
		if (!enabled && (input.action === "start" || input.action === "resume"))
			return Response.json(
				{
					error:
						"Film generation is currently disabled. You can still review, pause or cancel an existing run.",
				},
				{ status: 503, headers },
			);
		const client = await createClient();
		if (input.action === "start") {
			const project = await client
				.from("projects")
				.select("script,store,generation")
				.eq("id", input.projectId)
				.eq("user_id", user.id)
				.single();
			if (project.error || !project.data)
				return Response.json(
					{ error: "Film project not found." },
					{ status: 404, headers },
				);
			try {
				preflightRunModels(project.data);
				await preflightRunConnections(project.data, user.id);
			} catch (error) {
				return Response.json(
					{
						error:
							error instanceof ProjectBudgetError ||
							error instanceof FilmConnectionError
								? error.message
								: "Review and save the film script, selected media and voices before starting.",
					},
					{ status: 409, headers },
				);
			}
		}
		const { data, error } = await client.rpc("control_film_run", {
			p_project_id: input.projectId,
			p_action: input.action,
			p_run_id: input.runId ?? null,
		});
		if (error)
			return Response.json(
				{
					error: error.message.startsWith("FYLMER_RUN:")
						? error.message.slice("FYLMER_RUN:".length).trim()
						: "The film run could not be updated. Refresh and try again.",
				},
				{ status: 409, headers },
			);
		if (!data?.id) return Response.json({ run: null, enabled }, { headers });
		const run = runSchema.parse(data);
		if (run.user_id !== user.id || run.project_id !== input.projectId)
			return Response.json(
				{ error: "Film run not found." },
				{ status: 404, headers },
			);
		return Response.json(
			{
				run: {
					id: run.id,
					projectId: run.project_id,
					mode: run.mode,
					status: run.status,
					stopReason: run.coordinator_stop,
					updatedAt: run.updated_at,
				},
				enabled,
			},
			{ headers },
		);
	},
});
