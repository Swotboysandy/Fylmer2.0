import { z } from "zod";
import { createSessionRouteHandler } from "@/lib/api/route-handler";
import { ownsProject } from "@/lib/api/projects";
import { createServiceClient } from "@/lib/supabase/service";

const TotalsSchema = z
	.array(
		z.object({
			committed_usd: z.number().finite().nonnegative(),
			has_uncertain: z.boolean(),
		}),
	)
	.length(1);

export const POST = createSessionRouteHandler({
	schema: z.object({ projectId: z.uuid() }),
	label: "film/budget",
	handle: async ({ input }) => {
		if (!(await ownsProject(input.projectId)))
			return Response.json({ error: "Project not found." }, { status: 404 });
		const { data, error } = await createServiceClient().rpc(
			"film_budget_totals",
			{
				p_project_id: input.projectId,
			},
		);
		if (error) throw new Error("Could not load project budget.");
		const [totals] = TotalsSchema.parse(data);
		return Response.json(
			{
				committedUsd: totals.committed_usd,
				hasUncertainCharges: totals.has_uncertain,
			},
			{ headers: { "Cache-Control": "private, no-store" } },
		);
	},
});
