import { z } from "zod";
import { createSessionParamRouteHandler } from "@/lib/api/route-handler";
import { createClient } from "@/lib/supabase/server";
import { generatedMediaResponse } from "@/lib/fylmer/generated-media-response";

export const GET = createSessionParamRouteHandler({
	schema: z.object({
		jobId: z.uuid(),
		key: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
	}),
	label: "Generated film media",
	handle: async ({ user, params, request }) =>
		generatedMediaResponse(
			await createClient(),
			user.id,
			params.jobId,
			params.key,
			request,
		),
});

export const HEAD = GET;
