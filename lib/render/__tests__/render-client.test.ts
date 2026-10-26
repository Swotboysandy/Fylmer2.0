import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiJson, UnreachableError } from "@/lib/clients/http";
import type { RenderLayout } from "../types";
import {
	cancelRender,
	observeRender,
	runRender,
	type RenderUpdate,
} from "../render-client";

vi.mock("@/lib/clients/http", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/clients/http")>()),
	apiJson: vi.fn(),
}));

const apiJsonMock = vi.mocked(apiJson);

const LAYOUT = { series: [], sequences: {} } as unknown as RenderLayout;
const HANDLE = { renderId: "r1", bucketName: "b1" };
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

/** Drains the generator while letting the poll delay elapse between yields. */
async function collect(
	updates: AsyncGenerator<RenderUpdate>,
): Promise<RenderUpdate[]> {
	const seen: RenderUpdate[] = [];
	const settled = (async () => {
		for await (const update of updates) seen.push(update);
	})().then(
		() => null,
		(err: unknown) => err,
	);
	await vi.runAllTimersAsync();
	const failure = await settled;
	if (failure) throw failure;
	return seen;
}

beforeEach(() => {
	vi.useFakeTimers();
	apiJsonMock.mockReset();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("runRender", () => {
	it("stops polling on an acknowledged cancellation without reporting an error", async () => {
		apiJsonMock.mockResolvedValueOnce({ type: "cancelled" });
		expect(await collect(observeRender(HANDLE))).toEqual([
			{ status: "rendering", progress: 0 },
			{ status: "cancelled" },
		]);
		expect(apiJsonMock).toHaveBeenCalledTimes(1);
	});
	it("exposes the queued handle before progress observation", async () => {
		const started = vi.fn();
		apiJsonMock.mockResolvedValueOnce(HANDLE);
		const updates = runRender(PROJECT_ID, LAYOUT, "720p", undefined, started);
		expect((await updates.next()).value).toEqual({
			status: "rendering",
			progress: 0,
		});
		expect(started).toHaveBeenCalledWith(HANDLE);
		expect(apiJsonMock).toHaveBeenCalledTimes(1);
		await updates.return(undefined);
	});
	it("requests cancellation without aborting observation or declaring completion", async () => {
		const controller = new AbortController();
		const handle = { renderId: "r1", bucketName: "fylmer-local" };
		apiJsonMock.mockResolvedValueOnce({ status: "requested" });
		expect(await cancelRender(handle, controller.signal)).toEqual({
			status: "requested",
		});
		expect(controller.signal.aborted).toBe(false);
		expect(apiJsonMock).toHaveBeenCalledWith("/api/render/cancel", {
			method: "POST",
			body: { renderId: "r1" },
			signal: controller.signal,
		});
	});
	it("refuses cancellation for unsupported cloud exports", async () => {
		await expect(cancelRender(HANDLE)).rejects.toThrow("unavailable");
		expect(apiJsonMock).not.toHaveBeenCalled();
	});
	it("does not send a cancellation from an abandoned observer", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			cancelRender(
				{ renderId: "r1", bucketName: "fylmer-local" },
				controller.signal,
			),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(apiJsonMock).not.toHaveBeenCalled();
	});
	it("preserves an existing export record without starting another export", async () => {
		apiJsonMock.mockResolvedValueOnce({
			type: "done",
			url: "/resumed.mp4",
			size: 128,
			recordUrl: "/api/render/record/saved-id",
		});
		const seen = await collect(observeRender(HANDLE));
		expect(seen.at(-1)).toEqual({
			status: "done",
			url: "/resumed.mp4",
			size: 128,
			recordUrl: "/api/render/record/saved-id",
		});
		expect(apiJsonMock).toHaveBeenCalledTimes(1);
		expect(apiJsonMock).toHaveBeenCalledWith("/api/render/progress", {
			method: "POST",
			body: HANDLE,
		});
	});
	it("does not queue an export when observation was already aborted", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			runRender(PROJECT_ID, LAYOUT, "720p", controller.signal).next(),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(apiJsonMock).not.toHaveBeenCalled();
	});
	it("stops future polling without cancelling the server job", async () => {
		const controller = new AbortController();
		const updates = observeRender(HANDLE, controller.signal);
		await updates.next();
		controller.abort();
		await expect(updates.next()).rejects.toMatchObject({ name: "AbortError" });
		expect(apiJsonMock).not.toHaveBeenCalled();
	});
	it("submits the layout, then polls until the output is ready", async () => {
		apiJsonMock
			.mockResolvedValueOnce(HANDLE)
			.mockResolvedValueOnce({ type: "progress", progress: 0.4 })
			.mockResolvedValueOnce({ type: "done", url: "/out.mp4", size: 1024 });

		const seen = await collect(runRender(PROJECT_ID, LAYOUT, "720p"));

		expect(seen).toEqual([
			{ status: "rendering", progress: 0 },
			{ status: "rendering", progress: 0.4 },
			{ status: "done", url: "/out.mp4", size: 1024 },
		]);
		expect(apiJsonMock).toHaveBeenNthCalledWith(1, "/api/render", {
			method: "POST",
			body: { projectId: PROJECT_ID, inputProps: LAYOUT, resolution: "720p" },
		});
		expect(apiJsonMock).toHaveBeenNthCalledWith(2, "/api/render/progress", {
			method: "POST",
			body: HANDLE,
		});
	});

	it("keeps polling when a progress request never reaches the server", async () => {
		apiJsonMock
			.mockResolvedValueOnce(HANDLE)
			.mockRejectedValueOnce(new UnreachableError(new TypeError()))
			.mockResolvedValueOnce({ type: "done", url: "/out.mp4", size: 1024 });

		const seen = await collect(runRender(PROJECT_ID, LAYOUT, "1080p"));

		expect(seen.at(-1)).toEqual({
			status: "done",
			url: "/out.mp4",
			size: 1024,
		});
		expect(apiJsonMock).toHaveBeenCalledTimes(3);
	});

	it("stops polling once the render is done", async () => {
		apiJsonMock
			.mockResolvedValueOnce(HANDLE)
			.mockResolvedValueOnce({ type: "done", url: "/out.mp4", size: 1 });

		await collect(runRender(PROJECT_ID, LAYOUT, "1080p"));

		expect(apiJsonMock).toHaveBeenCalledTimes(2);
	});

	it("throws the upstream message when the render fails", async () => {
		apiJsonMock
			.mockResolvedValueOnce(HANDLE)
			.mockResolvedValueOnce({ type: "error", message: "Render failed" });

		await expect(
			collect(runRender(PROJECT_ID, LAYOUT, "1080p")),
		).rejects.toThrow("Render failed");
	});

	it("propagates a failure to start the render", async () => {
		apiJsonMock.mockRejectedValueOnce(new Error("Unauthorized"));

		await expect(
			collect(runRender(PROJECT_ID, LAYOUT, "1080p")),
		).rejects.toThrow("Unauthorized");
	});
});
