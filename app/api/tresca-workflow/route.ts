import { z } from "zod";
import { createSessionRouteHandler } from "@/lib/api/route-handler";
import { ownsProject } from "@/lib/api/projects";
import { createServiceClient } from "@/lib/supabase/service";
import { buildH3Workflow } from "@/lib/fylmer/h3-workflow";
import { parseComfyDocument } from "@/lib/fylmer/comfy-document";
import { compileCanvasJob } from "@/lib/fylmer/canvas-job";

export const POST = createSessionRouteHandler({
	schema: z.object({
		projectId: z.uuid(),
		action: z.enum(["read", "save", "template"]),
		version: z.number().int().nonnegative().optional(),
		document: z.unknown().optional(),
		prompt: z.string().min(1).max(20000).optional(),
	}),
	label: "Tresca Canvas",
	handle: async ({ input }) => {
		if (!(await ownsProject(input.projectId)))
			return Response.json({ error: "Project not found" }, { status: 404 });
		if (input.action === "template") {
			const { workflow } = buildH3Workflow({
				prompt:
					input.prompt ?? "Describe this shot's action, lighting and sound.",
				seed: 42,
			});
			return Response.json({
				document: parseComfyDocument(workflow),
				generationEnabled: false,
			});
		}
		const client = createServiceClient();
		if (input.action === "read") {
			const { data, error } = await client
				.from("tresca_workflows")
				.select("document, version")
				.eq("project_id", input.projectId)
				.maybeSingle();
			if (error) throw new Error("Could not load the project workflow.");
			return Response.json(data ?? { document: null, version: 0 });
		}
		let document;
		try {
			document = compileCanvasJob(input.document).document;
		} catch (error) {
			return Response.json(
				{ error: error instanceof Error ? error.message : "Invalid workflow" },
				{ status: 400 },
			);
		}
		if (input.version === undefined)
			return Response.json(
				{ error: "A saved version is required." },
				{ status: 400 },
			);
		const query =
			input.version === 0
				? client
						.from("tresca_workflows")
						.insert({ project_id: input.projectId, document, version: 1 })
				: client
						.from("tresca_workflows")
						.update({
							document,
							version: input.version + 1,
							updated_at: new Date().toISOString(),
						})
						.eq("project_id", input.projectId)
						.eq("version", input.version);
		const { data, error } = await query.select("version").maybeSingle();
		if (error || !data)
			return Response.json(
				{ error: "This workflow changed elsewhere. Reload before saving." },
				{ status: 409 },
			);
		return Response.json({ document, version: data.version });
	},
});
