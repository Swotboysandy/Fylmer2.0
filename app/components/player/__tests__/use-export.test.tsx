// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast } from "sonner";
import {
	cancelRender,
	observeRender,
	runRender,
	type RenderUpdate,
} from "@/lib/render/render-client";
import { apiJson } from "@/lib/clients/http";
import type { RenderLayout } from "@/lib/render/types";
import { useExport } from "../use-export";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

vi.mock("sonner", () => ({
	toast: {
		custom: vi.fn(),
		error: vi.fn(),
		dismiss: vi.fn(),
		message: vi.fn(),
	},
}));
vi.mock("@/lib/render/render-client", () => ({
	cancelRender: vi.fn(),
	runRender: vi.fn(),
	observeRender: vi.fn(),
}));
vi.mock("@/lib/clients/http", () => ({ apiJson: vi.fn() }));
vi.mock("@/lib/project/project-provider", () => ({
	useProjectId: () => "project-1",
}));
vi.mock("../export-toast", () => ({
	ExportProgressToast: (props: { progress: number; onView: () => void }) => (
		<button data-toast={`progress ${props.progress}`} onClick={props.onView} />
	),
	ExportDoneToast: (props: {
		url: string;
		size: number;
		onView: () => void;
	}) => (
		<button
			data-toast={`done ${props.url} ${props.size}`}
			onClick={props.onView}
		/>
	),
}));

const LAYOUT = { series: [], sequences: {} } as unknown as RenderLayout;

let hook: ReturnType<typeof useExport>;
function Reader({ onRead }: { onRead: (value: typeof hook) => void }) {
	onRead(useExport());
	return null;
}

const container = document.body.appendChild(document.createElement("div"));
const toastContainer = document.body.appendChild(document.createElement("div"));
let root: Root;
let toastRoot: Root;

/** A render that reports `updates`, then stays in flight unless it `fails`. */
function renderReports(updates: RenderUpdate[], fails?: Error) {
	vi.mocked(runRender).mockImplementation(
		async function* (_project, _layout, _resolution, _signal, onStarted) {
			onStarted?.({ renderId: "active", bucketName: "fylmer-local" });
			yield* updates;
			if (fails) throw fails;
			await new Promise(() => {});
		},
	);
}

const startExport = () =>
	act(async () => {
		void hook.exportVideo(LAYOUT, "4K");
	});

/** Draws what the last `toast.custom` call would show and returns its card. */
function shownToast(): HTMLElement | null {
	const draw = vi.mocked(toast.custom).mock.lastCall?.[0];
	if (!draw) return null;
	act(() => toastRoot.render(draw("export")));
	return toastContainer.querySelector<HTMLElement>("[data-toast]");
}

beforeEach(async () => {
	vi.mocked(cancelRender)
		.mockReset()
		.mockResolvedValue({ status: "requested" });
	vi.mocked(apiJson).mockResolvedValue({ handle: null });
	root = createRoot(container);
	toastRoot = createRoot(toastContainer);
	await act(async () =>
		root.render(<Reader onRead={(read) => (hook = read)} />),
	);
	vi.clearAllMocks();
});

afterEach(() =>
	act(() => {
		root.unmount();
		toastRoot.unmount();
	}),
);

describe("useExport", () => {
	it("shows acknowledged cancellation as a neutral terminal state and permits retry", async () => {
		renderReports([{ status: "cancelled" }]);
		await startExport();
		expect(hook.state).toEqual({ status: "cancelled" });
		expect(hook.canCancel).toBe(false);
		expect(toast.error).not.toHaveBeenCalled();
		expect(toast.message).toHaveBeenCalled();
		renderReports([{ status: "done", url: "/retry.mp4", size: 12 }]);
		await startExport();
		expect(hook.state.status).toBe("done");
	});
	it("requests once and keeps progress observation active until acknowledgement", async () => {
		renderReports([{ status: "rendering", progress: 0.4 }]);
		await startExport();
		expect(hook.canCancel).toBe(true);
		await act(async () => {
			await Promise.all([hook.cancelExport(), hook.cancelExport()]);
		});
		expect(cancelRender).toHaveBeenCalledTimes(1);
		expect(hook.cancelling).toBe(true);
		expect(hook.state).toEqual({ status: "rendering", progress: 0.4 });
		expect(vi.mocked(runRender).mock.lastCall?.[3]?.aborted).toBe(false);
	});
	it("allows cancellation retry without losing render progress", async () => {
		renderReports([{ status: "rendering", progress: 0.4 }]);
		await startExport();
		vi.mocked(cancelRender).mockRejectedValueOnce(
			new Error("Network unavailable"),
		);
		await act(async () => hook.cancelExport());
		expect(hook.cancelling).toBe(false);
		expect(hook.cancelError).toBe("Network unavailable");
		expect(hook.state.status).toBe("rendering");
		await act(async () => hook.cancelExport());
		expect(cancelRender).toHaveBeenCalledTimes(2);
		expect(hook.cancelError).toBeNull();
	});
	it("keeps a completed download when cancellation responds late", async () => {
		let finish: () => void = () => {};
		const finished = new Promise<void>((resolve) => {
			finish = resolve;
		});
		let respond: (value: { status: "done" }) => void = () => {};
		vi.mocked(cancelRender).mockImplementation(
			() =>
				new Promise((resolve) => {
					respond = resolve;
				}),
		);
		vi.mocked(runRender).mockImplementation(
			async function* (_project, _layout, _resolution, _signal, onStarted) {
				onStarted?.({ renderId: "active", bucketName: "fylmer-local" });
				yield { status: "rendering", progress: 0.9 };
				await finished;
				yield { status: "done", url: "/completed.mp4", size: 123 };
			},
		);
		await startExport();
		act(() => {
			void hook.cancelExport();
		});
		await act(async () => {
			finish();
		});
		await act(async () => {
			respond({ status: "done" });
		});
		expect(hook.state).toEqual({
			status: "done",
			url: "/completed.mp4",
			size: 123,
		});
		expect(hook.cancelling).toBe(false);
		expect(hook.canCancel).toBe(false);
	});
	it("finishes lookup while a recovered render is still running", async () => {
		act(() => root.render(null));
		vi.mocked(apiJson).mockResolvedValue({
			handle: { renderId: "active", bucketName: "fylmer-local" },
		});
		vi.mocked(observeRender).mockImplementation(async function* () {
			yield { status: "rendering", progress: 0.4 };
			await new Promise(() => {});
		});
		await act(async () =>
			root.render(<Reader onRead={(read) => (hook = read)} />),
		);
		expect(hook.recovering).toBe(false);
		expect(hook.recovered).toBe(true);
		expect(hook.state).toEqual({ status: "rendering", progress: 0.4 });
	});
	it("restores an existing export without starting another render", async () => {
		act(() => root.render(null));
		vi.mocked(apiJson).mockResolvedValue({
			handle: { renderId: "saved", bucketName: "fylmer-local" },
		});
		vi.mocked(observeRender).mockImplementation(async function* () {
			yield { status: "done", url: "/saved.mp4", size: 12 };
		});
		await act(async () =>
			root.render(<Reader onRead={(read) => (hook = read)} />),
		);
		expect(hook.state).toEqual({ status: "done", url: "/saved.mp4", size: 12 });
		expect(hook.recovered).toBe(true);
		expect(runRender).not.toHaveBeenCalled();
	});
	it("does not start a duplicate while recovery is unresolved", async () => {
		act(() => root.render(null));
		vi.mocked(apiJson).mockImplementation(() => new Promise(() => {}));
		await act(async () =>
			root.render(<Reader onRead={(read) => (hook = read)} />),
		);
		await startExport();
		expect(runRender).not.toHaveBeenCalled();
	});
	it("aborts observation on unmount without sending a server cancel request", async () => {
		renderReports([{ status: "rendering", progress: 0.2 }]);
		await startExport();
		const signal = vi.mocked(runRender).mock.lastCall?.[3];
		act(() => root.render(null));
		expect(signal?.aborted).toBe(true);
		expect(apiJson).not.toHaveBeenCalled();
	});
	it("starts idle with the popover closed", () => {
		expect(hook.state).toEqual({ status: "idle" });
		expect(hook.open).toBe(false);
	});

	it("follows the render from start to output", async () => {
		renderReports([
			{ status: "rendering", progress: 0.4 },
			{ status: "done", url: "/out.mp4", size: 1024 },
		]);

		await startExport();

		expect(runRender).toHaveBeenCalledWith(
			"project-1",
			LAYOUT,
			"4K",
			expect.any(AbortSignal),
			expect.any(Function),
		);
		expect(hook.state).toEqual({
			status: "done",
			url: "/out.mp4",
			size: 1024,
		});
	});

	it("shows progress in a toast while the popover is closed", async () => {
		renderReports([{ status: "rendering", progress: 0.4 }]);

		await startExport();

		expect(shownToast()?.dataset.toast).toBe("progress 0.4");
		expect(toast.custom).toHaveBeenLastCalledWith(
			expect.any(Function),
			expect.objectContaining({ id: "export" }),
		);
	});

	it("shows the output in a toast while the popover is closed", async () => {
		renderReports([{ status: "done", url: "/out.mp4", size: 1024 }]);

		await startExport();

		expect(shownToast()?.dataset.toast).toBe("done /out.mp4 1024");
	});

	it("opens the popover from the toast, which then leaves", async () => {
		renderReports([{ status: "rendering", progress: 0.4 }]);
		await startExport();
		vi.mocked(toast.dismiss).mockClear();

		const card = shownToast();
		act(() => card?.click());

		expect(hook.open).toBe(true);
		expect(toast.dismiss).toHaveBeenCalledWith("export");
	});

	it("raises no toast while the popover is open", async () => {
		renderReports([{ status: "done", url: "/out.mp4", size: 1024 }]);
		act(() => hook.setOpen(true));

		await startExport();

		expect(toast.custom).not.toHaveBeenCalled();
		expect(toast.error).not.toHaveBeenCalled();
	});

	it("turns a failed render into an error state and an error toast", async () => {
		renderReports([], new Error("Lambda timed out"));

		await startExport();

		expect(hook.state).toEqual({
			status: "error",
			message: "Lambda timed out",
		});
		expect(toast.error).toHaveBeenCalledWith(
			"Lambda timed out",
			expect.objectContaining({ id: "export" }),
		);
	});

	it("returns to idle on reset and drops the toast", async () => {
		renderReports([{ status: "done", url: "/out.mp4", size: 1024 }]);
		await startExport();
		vi.mocked(toast.dismiss).mockClear();

		act(() => hook.reset());

		expect(hook.state).toEqual({ status: "idle" });
		expect(toast.dismiss).toHaveBeenCalledWith("export");
	});

	it("drops the toast on unmount", async () => {
		renderReports([{ status: "rendering", progress: 0.4 }]);
		await startExport();
		vi.mocked(toast.dismiss).mockClear();

		act(() => root.render(null));

		expect(toast.dismiss).toHaveBeenCalledWith("export");
	});
});
