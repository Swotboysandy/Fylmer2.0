import { z } from "zod";
import { createSessionParamRouteHandler } from "@/lib/api/route-handler";
import { getExportRecord } from "@/lib/render/export-record";

export const GET = createSessionParamRouteHandler({
	schema: z.object({ renderId: z.uuid() }),
	label: "Download export record",
	handle: async ({ user, params }) => {
		const record = await getExportRecord(user.id, params.renderId);
		if (!record)
			return Response.json({ error: "Export not found" }, { status: 404 });
		return Response.json(record, {
			headers: {
				"Content-Disposition":
					'attachment; filename="fylmer-export-record.json"',
				"Cache-Control": "private, no-store",
				"X-Content-Type-Options": "nosniff",
			},
		});
	},
});
