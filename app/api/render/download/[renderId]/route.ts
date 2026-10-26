import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { z } from "zod";
import { createSessionParamRouteHandler } from "@/lib/api/route-handler";
import {
	exportDirectory,
	localExportProgress,
} from "@/lib/render/local-export";

export const GET = createSessionParamRouteHandler({
	schema: z.object({ renderId: z.uuid() }),
	label: "Download export",
	handle: async ({ user, params }) => {
		const progress = await localExportProgress(user.id, params.renderId);
		if (progress.type !== "done")
			return Response.json({ error: "Export not found" }, { status: 404 });
		const path = join(exportDirectory(user.id, params.renderId), "output.mp4");
		const info = await stat(path);
		return new Response(
			Readable.toWeb(
				createReadStream(path),
			) as unknown as ReadableStream<Uint8Array>,
			{
				headers: {
					"Content-Type": "video/mp4",
					"Content-Length": String(info.size),
					"Content-Disposition": 'attachment; filename="fylmer-final-cut.mp4"',
					"Cache-Control": "private, no-store",
				},
			},
		);
	},
});
