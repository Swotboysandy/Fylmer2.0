import { renderMediaOnLambda } from "@remotion/lambda/client";
import { NextResponse } from "next/server";
import { createSessionRouteHandler } from "@/lib/api/route-handler";
import {
	getFunctionName,
	getSiteName,
	REGION,
} from "@/lib/render/lambda-config";
import { RenderRequest, type RenderHandle } from "@/lib/render/render-api";
import { renderScale } from "@/lib/render/resolutions";
import { COMPOSITION_ID } from "@/lib/render/types";
import { enqueueLocalExport } from "@/lib/render/local-export";
import { createClient } from "@/lib/supabase/server";
import { exportRequestOrigin } from "@/lib/render/export-request-origin";
import {
	ExportReviewError,
	getReviewedExport,
} from "@/lib/render/reviewed-export";

export const POST = createSessionRouteHandler({
	schema: RenderRequest,
	label: "render",
	handle: async ({ input, user, request }) => {
		let reviewed;
		try {
			reviewed = await getReviewedExport(input.projectId, input.inputProps);
		} catch (error) {
			if (error instanceof ExportReviewError)
				return NextResponse.json({ error: error.message }, { status: 409 });
			throw error;
		}
		if (process.env.FYLMER_EXPORT_BACKEND === "local") {
			return NextResponse.json(
				await enqueueLocalExport(
					user.id,
					reviewed.layout,
					input.resolution,
					reviewed.source,
					{
						client: await createClient(),
						appOrigin: exportRequestOrigin(request),
					},
				),
			);
		}
		if (process.env.FYLMER_STAGING_GENERATION_ENABLED !== "1")
			return NextResponse.json(
				{
					error:
						"Rendering is disabled in this isolated staging review. No cloud render was started.",
				},
				{ status: 409 },
			);
		const { renderId, bucketName } = await renderMediaOnLambda({
			codec: "h264",
			region: REGION,
			serveUrl: getSiteName(),
			functionName: getFunctionName(),
			composition: COMPOSITION_ID,
			inputProps: reviewed.layout,
			scale: renderScale(input.resolution),
			downloadBehavior: { type: "download", fileName: "video.mp4" },
		});

		return NextResponse.json<RenderHandle>({ renderId, bucketName });
	},
});
