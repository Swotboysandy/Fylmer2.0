import { apiJson, UnreachableError } from "@/lib/clients/http";
import { POLL_INTERVAL_MS } from "@/lib/providers/poll";
import { sleep } from "@/lib/utils";
import type { RenderHandle, RenderProgress } from "./render-api";
import type { Resolution } from "./resolutions";
import type { RenderLayout } from "./types";

export type RenderUpdate =
	| { status: "cancelled" }
	| { status: "rendering"; progress: number }
	| { status: "done"; url: string; size: number; recordUrl?: string };

/**
 * Starts a Lambda render and yields progress until the output is ready.
 * A render that fails upstream throws, so callers handle one error path.
 */
export async function* runRender(
	projectId: string,
	layout: RenderLayout,
	resolution: Resolution,
	signal?: AbortSignal,
	onStarted?: (handle: RenderHandle) => void,
): AsyncGenerator<RenderUpdate> {
	signal?.throwIfAborted();
	const handle = await apiJson<RenderHandle>("/api/render", {
		method: "POST",
		body: { projectId, inputProps: layout, resolution },
		...(signal ? { signal } : {}),
	});
	signal?.throwIfAborted();
	onStarted?.(handle);
	yield* observeRender(handle, signal);
}

export async function cancelRender(handle: RenderHandle, signal?: AbortSignal) {
	if (handle.bucketName !== "fylmer-local")
		throw new Error("Cancellation is unavailable for this export backend.");
	signal?.throwIfAborted();
	return apiJson<{ status: "requested" | "done" | "failed" | "cancelled" }>(
		"/api/render/cancel",
		{
			method: "POST",
			body: { renderId: handle.renderId },
			...(signal ? { signal } : {}),
		},
	);
}

export async function* observeRender(
	handle: RenderHandle,
	signal?: AbortSignal,
): AsyncGenerator<RenderUpdate> {
	signal?.throwIfAborted();
	yield { status: "rendering", progress: 0 };

	for (;;) {
		signal?.throwIfAborted();
		try {
			const result = await apiJson<RenderProgress>("/api/render/progress", {
				method: "POST",
				body: handle,
				...(signal ? { signal } : {}),
			});
			signal?.throwIfAborted();
			if (result.type === "error") throw new Error(result.message);
			if (result.type === "cancelled") {
				yield { status: "cancelled" };
				return;
			}
			if (result.type === "done") {
				yield {
					status: "done",
					url: result.url,
					size: result.size,
					...(result.recordUrl ? { recordUrl: result.recordUrl } : {}),
				};
				return;
			}
			yield { status: "rendering", progress: result.progress };
		} catch (error) {
			if (!(error instanceof UnreachableError)) throw error;
		}
		await sleep(POLL_INTERVAL_MS);
	}
}
