"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { useProjectId } from "@/lib/project/project-provider";
import {
	cancelRender,
	observeRender,
	runRender,
	type RenderUpdate,
} from "@/lib/render/render-client";
import { apiJson } from "@/lib/clients/http";
import type { RenderHandle } from "@/lib/render/render-api";
import type { Resolution } from "@/lib/render/resolutions";
import type { RenderLayout } from "@/lib/render/types";
import { ExportDoneToast, ExportProgressToast } from "./export-toast";

type ExportState =
	| { status: "idle" }
	| { status: "starting" }
	| RenderUpdate
	| { status: "error"; message: string };

const TOAST_ID = "export";
const TOAST_OPTIONS = {
	id: TOAST_ID,
	duration: Number.POSITIVE_INFINITY,
	position: "bottom-right" as const,
};

/** The export the popover shows. A toast stands in while the popover is closed. */
export function useExport() {
	const projectId = useProjectId();
	const [state, setState] = useState<ExportState>({ status: "idle" });
	const [open, setOpenState] = useState(false);
	const observer = useRef<AbortController | null>(null);
	const activeHandle = useRef<RenderHandle | null>(null);
	const [renderSession, setRenderSession] = useState<{
		controller: AbortController;
		handle: RenderHandle;
	} | null>(null);
	const cancelRequest = useRef<AbortController | null>(null);
	const [cancellation, setCancellation] = useState<{
		controller: AbortController | null;
		requested: boolean;
		error: string | null;
	}>({ controller: null, requested: false, error: null });
	const [recovered, setRecovered] = useState(false);
	const [recovery, setRecovery] = useState({ projectId, checking: true });
	const recovering = recovery.projectId !== projectId || recovery.checking;

	useEffect(() => {
		const controller = new AbortController();
		observer.current = controller;
		void (async () => {
			try {
				const { handle } = await apiJson<{ handle: RenderHandle | null }>(
					"/api/render/recover",
					{ method: "POST", body: { projectId }, signal: controller.signal },
				);
				if (controller.signal.aborted) return;
				activeHandle.current = handle;
				setRenderSession(handle ? { controller, handle } : null);
				setRecovery({ projectId, checking: false });
				if (!handle) {
					setState({ status: "idle" });
					setRecovered(false);
					return;
				}
				setRecovered(true);
				for await (const update of observeRender(handle, controller.signal)) {
					if (controller.signal.aborted) return;
					setState(update);
					if (update.status === "done" || update.status === "cancelled") break;
				}
			} catch (error) {
				if (!controller.signal.aborted)
					setState({ status: "error", message: errorMessage(error) });
			} finally {
				if (!controller.signal.aborted)
					setRecovery({ projectId, checking: false });
				if (observer.current === controller) {
					observer.current = null;
					activeHandle.current = null;
				}
			}
		})();
		return () => {
			controller.abort();
			observer.current?.abort();
			observer.current = null;
			activeHandle.current = null;
		};
	}, [projectId]);

	// Sonner restores focus when it leaves the toast list, and Radix treats that
	// as a focus-outside that dismisses the popover. Blur first so nothing listens.
	const setOpen = useCallback((next: boolean) => {
		if (next && document.activeElement instanceof HTMLElement) {
			document.activeElement.blur();
		}
		setOpenState(next);
	}, []);

	useEffect(() => {
		if (open || state.status === "idle") {
			toast.dismiss(TOAST_ID);
			return;
		}
		if (state.status === "starting" || state.status === "rendering") {
			const progress = state.status === "rendering" ? state.progress : 0;
			toast.custom(
				() => (
					<ExportProgressToast
						progress={progress}
						onView={() => setOpen(true)}
					/>
				),
				TOAST_OPTIONS,
			);
			return;
		}
		if (state.status === "done") {
			const { url, size } = state;
			toast.custom(
				(id) => (
					<ExportDoneToast
						url={url}
						size={size}
						toastId={id}
						onView={() => setOpen(true)}
					/>
				),
				TOAST_OPTIONS,
			);
			return;
		}
		if (state.status === "cancelled") {
			toast.message("Export cancelled. Your project is unchanged.", {
				id: TOAST_ID,
				position: "bottom-right",
			});
			return;
		}
		toast.error(state.message, {
			id: TOAST_ID,
			position: "bottom-right",
		});
	}, [state, open, setOpen]);

	useEffect(() => {
		return () => {
			toast.dismiss(TOAST_ID);
		};
	}, []);

	const exportVideo = async (layout: RenderLayout, resolution: Resolution) => {
		if (observer.current) return;
		const controller = new AbortController();
		observer.current = controller;
		activeHandle.current = null;
		setRecovered(false);
		setRenderSession(null);
		setState({ status: "starting" });
		try {
			for await (const update of runRender(
				projectId,
				layout,
				resolution,
				controller.signal,
				(handle) => {
					if (!controller.signal.aborted) {
						activeHandle.current = handle;
						setRenderSession({ controller, handle });
					}
				},
			)) {
				if (controller.signal.aborted) return;
				setState(update);
				if (update.status === "done" || update.status === "cancelled") break;
			}
		} catch (error) {
			if (!controller.signal.aborted)
				setState({ status: "error", message: errorMessage(error) });
		} finally {
			if (observer.current === controller) {
				observer.current = null;
				activeHandle.current = null;
			}
		}
	};

	const cancelExport = async () => {
		const controller = observer.current;
		const handle = activeHandle.current;
		if (
			!controller ||
			!handle ||
			controller.signal.aborted ||
			handle.bucketName !== "fylmer-local" ||
			cancelRequest.current === controller
		)
			return;
		cancelRequest.current = controller;
		setCancellation({ controller, requested: true, error: null });
		try {
			await cancelRender(handle, controller.signal);
		} catch (error) {
			if (observer.current === controller && !controller.signal.aborted) {
				cancelRequest.current = null;
				setCancellation({
					controller,
					requested: false,
					error: errorMessage(error),
				});
			}
		}
	};
	const active = !recovering && state.status === "rendering";
	const currentCancellation =
		active && cancellation.controller === renderSession?.controller;

	return {
		cancelExport,
		canCancel: active && renderSession?.handle.bucketName === "fylmer-local",
		cancelling: currentCancellation && cancellation.requested,
		cancelError: currentCancellation ? cancellation.error : null,
		state: recovering ? { status: "idle" as const } : state,
		recovered: !recovering && recovered,
		recovering,
		exportVideo,
		reset: () => {
			setRecovered(false);
			setState({ status: "idle" });
		},
		open,
		setOpen,
	};
}
