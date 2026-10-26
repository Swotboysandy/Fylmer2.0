import { z } from "zod";
import { createSessionRouteHandler } from "@/lib/api/route-handler";
import { createClient } from "@/lib/supabase/server";
import { FilmReviewSchema, ReviewActionSchema } from "@/lib/fylmer/review";
import { ProjectBudgetError } from "@/lib/api/project-budget-error";

export const POST = createSessionRouteHandler({
	schema: z.object({
		projectId: z.uuid(),
		action: ReviewActionSchema,
		capUsd: z.number().min(0.01).max(10000).optional(),
	}),
	label: "Film review",
	handle: async ({ input }) => {
		const client = await createClient();
		if (input.action === "cap") {
			if (input.capUsd === undefined)
				return Response.json(
					{ error: "Enter a per-project spending cap." },
					{ status: 400 },
				);
			const { error: capError } = await client.rpc("set_film_autonomous_cap", {
				p_project_id: input.projectId,
				p_cap_usd: input.capUsd,
			});
			if (capError)
				return Response.json(
					{
						error:
							ProjectBudgetError.from(capError)?.message ??
							"Could not save the project spending cap.",
					},
					{ status: 409 },
				);
		}
		const { data, error } = await client.rpc("film_workflow", {
			p_project_id: input.projectId,
			p_action: input.action === "cap" ? "read" : input.action,
		});
		if (error)
			return Response.json(
				{
					error:
						"This review could not be saved. Check that the project is saved and the previous step is approved.",
				},
				{ status: 409 },
			);
		return Response.json(FilmReviewSchema.parse(data));
	},
});
