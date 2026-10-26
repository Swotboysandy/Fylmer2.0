import { z } from "zod";
import { workerAuthorized } from "@/lib/api/local-job-worker";
import { exportDirectory } from "@/lib/render/local-export";
import { completeLocalFilmRun } from "@/lib/render/complete-local-film-run";

export async function POST(request: Request) {
	const headers = { "Cache-Control": "private, no-store" };
	if (!workerAuthorized(request.headers.get("authorization")))
		return Response.json({ error: "Not found" }, { status: 404, headers });
	const input = z
		.object({ userId: z.uuid(), renderId: z.uuid() })
		.safeParse(await request.json().catch(() => null));
	if (!input.success)
		return Response.json(
			{ error: "Invalid export identity" },
			{ status: 400, headers },
		);
	try {
		const recorded = await completeLocalFilmRun(
			exportDirectory(input.data.userId, input.data.renderId),
			input.data.userId,
			input.data.renderId,
		);
		return Response.json({ recorded }, { headers });
	} catch {
		return Response.json(
			{ error: "Export completion could not be recorded." },
			{ status: 503, headers },
		);
	}
}
