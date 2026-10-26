"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { useCanvasHistory } from "@/lib/project/canvas-history-provider";

const responseSchema = z.object({
	enabled: z.boolean(),
	run: z
		.object({
			id: z.uuid(),
			status: z.enum(["queued", "paused", "cancelled", "completed", "failed"]),
			stopReason: z
				.enum(["images_review", "final_review", "job_attention"])
				.nullable(),
		})
		.nullable(),
});
type RunState = z.infer<typeof responseSchema>;
const reasons = {
	images_review: "Review the images before resuming.",
	final_review: "Review and export your final cut.",
	job_attention: "A generation job needs attention. Review it before resuming.",
};

export function FilmRunControls({
	projectId,
	canStart,
}: {
	projectId: string;
	canStart: boolean;
}) {
	const history = useCanvasHistory();
	const [state, setState] = useState<RunState | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [refreshError, setRefreshError] = useState("");
	const mutating = useRef(false);
	const revision = useRef(0);
	const startId = useRef<string | null>(null);
	useEffect(() => {
		const controller = new AbortController();
		const invalidateRequests = () => {
			revision.current++;
		};
		let timer: ReturnType<typeof setTimeout>;
		async function refresh() {
			const current = revision.current;
			try {
				if (mutating.current || document.visibilityState === "hidden") return;
				const response = await fetch("/api/film-run", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ projectId, action: "read" }),
					signal: controller.signal,
				});
				if (!response.ok) throw new Error("Could not refresh film progress.");
				const loaded = responseSchema.parse(await response.json());
				if (!controller.signal.aborted && current === revision.current) {
					setState(loaded);
					setRefreshError("");
				}
			} catch {
				if (!controller.signal.aborted && current === revision.current)
					setRefreshError(
						"Could not refresh film progress. Your run has not been restarted.",
					);
			} finally {
				if (!controller.signal.aborted) timer = setTimeout(refresh, 5000);
			}
		}
		void refresh();
		return () => {
			controller.abort();
			clearTimeout(timer);
			invalidateRequests();
		};
	}, [projectId]);
	async function act(action: "start" | "pause" | "resume" | "cancel") {
		if (mutating.current) return;
		mutating.current = true;
		const current = ++revision.current;
		setBusy(true);
		setError("");
		try {
			if (action === "start" || action === "resume")
				await history.ensureSaved();
			if (current !== revision.current) return;
			if (action === "start") startId.current ??= crypto.randomUUID();
			const runId = action === "start" ? startId.current : state?.run?.id;
			if (!runId)
				throw new Error("Refresh the project before changing this run.");
			const response = await fetch("/api/film-run", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ projectId, action, runId }),
			});
			const body = await response.json();
			if (!response.ok)
				throw new Error(
					typeof body.error === "string"
						? body.error
						: "The film run could not be updated.",
				);
			const updated = responseSchema.parse(body);
			if (current === revision.current) {
				setState(updated);
				setRefreshError("");
				if (action === "start") startId.current = null;
			}
		} catch (failure) {
			if (current === revision.current)
				setError(
					failure instanceof Error
						? failure.message
						: "The film run could not be updated.",
				);
		} finally {
			mutating.current = false;
			if (current === revision.current) setBusy(false);
		}
	}
	const run = state?.run;
	const active = run?.status === "queued" || run?.status === "paused";
	return (
		<div className="space-y-2">
			<p role="status" className="text-label text-muted-foreground">
				{!state
					? "Loading film progress…"
					: run?.stopReason
						? reasons[run.stopReason]
						: run
							? `Film run: ${run.status}`
							: "No film run started."}
			</p>
			{state && !state.enabled && (
				<p className="text-label text-muted-foreground">
					Film generation is disabled. Existing runs can still be paused or
					cancelled.
				</p>
			)}
			{(error || refreshError) && (
				<p role="alert" className="text-label text-destructive">
					{error || refreshError}
				</p>
			)}
			<div className="flex flex-wrap gap-2" aria-busy={busy}>
				{!active && (
					<Button
						size="sm"
						variant="default"
						disabled={busy || !state?.enabled || !canStart}
						onClick={() => void act("start")}
					>
						Start film
					</Button>
				)}
				{run?.status === "queued" && (
					<Button
						size="sm"
						variant="panel"
						disabled={busy}
						onClick={() => void act("pause")}
					>
						Pause run
					</Button>
				)}
				{run?.status === "paused" && run.stopReason !== "final_review" && (
					<Button
						size="sm"
						variant="default"
						disabled={busy || !state?.enabled || !canStart}
						onClick={() => void act("resume")}
					>
						Resume run
					</Button>
				)}
				{active && (
					<Button
						size="sm"
						variant="panel"
						disabled={busy}
						onClick={() => void act("cancel")}
					>
						Cancel run
					</Button>
				)}
			</div>
		</div>
	);
}
