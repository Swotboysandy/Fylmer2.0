"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useProjectId } from "@/lib/project/project-provider";
import { FilmReviewSchema, type FilmReview } from "@/lib/fylmer/review";
import { PanelCard } from "./panel-card";
import { FilmRunControls } from "./film-run-controls";
import { FilmBudgetStatus } from "./film-budget-status";

export function FilmReviewCard() {
	const projectId = useProjectId();
	const [review, setReview] = useState<FilmReview | null>(null);
	const [capInput, setCapInput] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");

	useEffect(() => {
		const controller = new AbortController();
		fetch("/api/film-workflow", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ projectId, action: "read" }),
			signal: controller.signal,
		})
			.then(async (response) => {
				if (!response.ok)
					throw new Error(
						"Could not load project review. Try again after saving.",
					);
				const loaded = FilmReviewSchema.parse(await response.json());
				setReview(loaded);
				setCapInput(loaded.capUsd?.toString() ?? "");
			})
			.catch((failure: unknown) => {
				if (!controller.signal.aborted)
					setError(
						failure instanceof Error
							? failure.message
							: "Could not load review.",
					);
			});
		return () => controller.abort();
	}, [projectId]);

	async function save(action: string, capUsd?: number) {
		setBusy(true);
		setError("");
		try {
			const response = await fetch("/api/film-workflow", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ projectId, action, capUsd }),
			});
			if (!response.ok) {
				const body = (await response.json()) as { error?: string };
				throw new Error(
					body.error ?? "The workflow change could not be saved.",
				);
			}
			const updated = FilmReviewSchema.parse(await response.json());
			setReview(updated);
			setCapInput(updated.capUsd?.toString() ?? "");
		} catch (failure) {
			setError(
				failure instanceof Error
					? failure.message
					: "Review could not be saved.",
			);
		} finally {
			setBusy(false);
		}
	}

	const next = !review?.bible
		? { action: "bible", label: "Approve Film Bible" }
		: !review.images
			? { action: "images", label: "Next: approve images" }
			: !review.videos
				? { action: "videos", label: "Next: approve videos" }
				: { action: "final_cut", label: "Next: approve final cut" };

	return (
		<PanelCard title="Film Bible">
			<p className="text-label text-muted-foreground">
				Your characters and scenes on the canvas are your Film Bible. Save and
				review them before continuing.
			</p>
			{review && (
				<p className="text-label">
					{review.finalCut
						? "Final cut approved"
						: review.videos
							? "Videos approved"
							: review.images
								? "Images approved"
								: review.bible
									? "Film Bible approved"
									: "Ready for your review"}{" "}
					· {review.imageCount} images · {review.videoCount} videos
				</p>
			)}
			{review?.bible && (
				<>
					<div className="flex items-center justify-between gap-3">
						<label
							htmlFor="autonomous-mode"
							className="text-label text-panel-label"
						>
							Autonomous
						</label>
						<Switch
							id="autonomous-mode"
							checked={review.mode === "autonomous"}
							disabled={
								busy || (!review.capUsd && review.mode !== "autonomous")
							}
							onCheckedChange={(checked) =>
								void save(checked ? "autonomous" : "directed")
							}
						/>
					</div>
					<p className="text-label text-muted-foreground">
						Off: review each stage and choose Next. On: completed image and
						video stages are approved automatically. You still review and
						approve the final cut.
					</p>
					<div className="flex flex-wrap items-center gap-2">
						<label
							htmlFor="autonomous-cap"
							className="basis-full text-label text-panel-label"
						>
							Autonomous cap ($)
						</label>
						<Input
							id="autonomous-cap"
							type="number"
							min="0.01"
							max="10000"
							step="0.01"
							value={capInput}
							onChange={(event) => setCapInput(event.target.value)}
							className="min-w-0 flex-1"
						/>
						<Button
							size="sm"
							variant="panel"
							disabled={busy || !capInput || Number(capInput) === review.capUsd}
							onClick={() => void save("cap", Number(capInput))}
						>
							Save
						</Button>
					</div>
					<p className="text-label text-muted-foreground">
						Set a cap before turning Autonomous on. Media generation still
						starts with Generate all; no paid job starts from this toggle.
					</p>
				</>
			)}
			{review && (
				<FilmBudgetStatus
					key={`budget-${projectId}`}
					projectId={projectId}
					review={review}
				/>
			)}
			{error && (
				<p role="alert" className="text-label text-destructive">
					{error}
				</p>
			)}
			{(review?.mode !== "autonomous" || !review.bible || review.videos) && (
				<Button
					size="sm"
					variant="default"
					disabled={busy || !review || review.finalCut}
					onClick={() => void save(next.action)}
				>
					{busy ? "Saving…" : next.label}
				</Button>
			)}
			<Button
				size="sm"
				variant="panel"
				disabled={busy}
				onClick={() => void save("read")}
			>
				Refresh review
			</Button>
			<FilmRunControls
				key={projectId}
				projectId={projectId}
				canStart={Boolean(review?.bible && review.capUsd)}
			/>
		</PanelCard>
	);
}
