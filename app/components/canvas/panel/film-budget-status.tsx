"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import type { FilmReview } from "@/lib/fylmer/review";

const BudgetSchema = z.object({
	committedUsd: z.number().finite().nonnegative(),
	hasUncertainCharges: z.boolean(),
});

export function FilmBudgetStatus({
	projectId,
	review,
}: {
	projectId: string;
	review: FilmReview;
}) {
	const [snapshot, setSnapshot] = useState<{
		projectId: string;
		review: FilmReview;
		budget: z.infer<typeof BudgetSchema> | null;
	} | null>(null);
	const current =
		snapshot?.projectId === projectId && snapshot.review === review;
	const budget = current ? snapshot.budget : null;
	const error = current && !budget;
	useEffect(() => {
		const controller = new AbortController();
		fetch("/api/film-budget", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ projectId }),
			signal: controller.signal,
		})
			.then(async (response) => {
				if (!response.ok) throw new Error("Budget unavailable");
				const loaded = BudgetSchema.parse(await response.json());
				if (!controller.signal.aborted)
					setSnapshot({ projectId, review, budget: loaded });
			})
			.catch(() => {
				if (!controller.signal.aborted)
					setSnapshot({ projectId, review, budget: null });
			});
		return () => controller.abort();
	}, [projectId, review]);

	if (error)
		return (
			<p role="alert" className="text-label text-destructive">
				Budget unavailable. Use Refresh review to retry; this does not mean
				spending is zero.
			</p>
		);
	if (!budget)
		return (
			<p role="status" className="text-label text-muted-foreground">
				Checking project budget…
			</p>
		);
	return (
		<>
			<p className="text-label text-muted-foreground">
				Committed:{" "}
				<span className="font-numeric">
					{new Intl.NumberFormat("en-US", {
						style: "currency",
						currency: "USD",
						maximumFractionDigits: 6,
					}).format(budget.committedUsd)}
				</span>
				. Includes recorded charges and active reservations, not just actual
				spend. Snapshot at last review refresh.
			</p>
			{budget.hasUncertainCharges && (
				<p role="status" className="text-label text-destructive">
					A provider charge needs billing review. Capped generation stays
					blocked until it is reconciled; retrying does not clear the charge.
				</p>
			)}
		</>
	);
}
