import { NextResponse } from "next/server";
import { z } from "zod";
import { createSessionRouteHandler } from "@/lib/api/route-handler";
import { ownsProject } from "@/lib/api/projects";
import { recoverLocalExport } from "@/lib/render/export-recovery";

export const POST = createSessionRouteHandler({
	schema: z.object({ projectId: z.uuid() }),
	label: "render/recover",
	handle: async ({ input, user }) => {
		if (!(await ownsProject(input.projectId)))
			return NextResponse.json(
				{ error: "Project not found." },
				{ status: 404 },
			);
		if (process.env.FYLMER_EXPORT_BACKEND !== "local")
			return NextResponse.json({ handle: null });
		return NextResponse.json({
			handle: await recoverLocalExport(user.id, input.projectId),
		});
	},
});
