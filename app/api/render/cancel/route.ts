import { NextResponse } from "next/server";
import { z } from "zod";
import { createSessionRouteHandler } from "@/lib/api/route-handler";
import { requestExportCancellation } from "@/lib/render/export-cancellation";

export const POST = createSessionRouteHandler({
	schema: z.object({ renderId: z.uuid() }),
	label: "render/cancel",
	handle: async ({ input, user }) => {
		if (process.env.FYLMER_EXPORT_BACKEND !== "local")
			return NextResponse.json(
				{ error: "Cancellation is unavailable for this export backend." },
				{ status: 409 },
			);
		try {
			const status = await requestExportCancellation(user.id, input.renderId);
			return NextResponse.json(
				{ status },
				{ status: status === "requested" ? 202 : 200 },
			);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT")
				return NextResponse.json(
					{ error: "Export not found." },
					{ status: 404 },
				);
			throw error;
		}
	},
});
