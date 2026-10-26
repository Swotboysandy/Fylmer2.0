import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { workerAuthorized } from "@/lib/api/local-job-worker";
import { createServiceClient } from "@/lib/supabase/service";
import { exportDirectory } from "@/lib/render/local-export";
import { hydrateExportMedia } from "@/lib/render/hydrate-export-media";

export async function POST(request: Request) {
	const headers = { "Cache-Control": "private, no-store" };
	if (!workerAuthorized(request.headers.get("authorization")))
		return Response.json({ error: "Not found" }, { status: 404, headers });
	try {
		const input = z
			.object({ userId: z.uuid(), renderId: z.uuid() })
			.parse(await request.json());
		const queued = z
			.object({
				inputProps: z.unknown(),
				mediaOrigin: z.string().url(),
				source: z.object({ projectId: z.uuid() }),
			})
			.parse(
				JSON.parse(
					await readFile(
						join(
							exportDirectory(input.userId, input.renderId),
							"processing.json",
						),
						"utf8",
					),
				),
			);
		const props = await hydrateExportMedia(
			createServiceClient(),
			input.userId,
			queued.source.projectId,
			queued.inputProps,
			queued.mediaOrigin,
		);
		return Response.json({ inputProps: props }, { headers });
	} catch {
		return Response.json(
			{ error: "Export media could not be renewed." },
			{ status: 409, headers },
		);
	}
}
