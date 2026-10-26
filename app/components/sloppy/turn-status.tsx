"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Sparkles } from "@/components/ui/icon";
import type { TokenUsage } from "@/lib/agent/token-usage";
import OrbLoader from "../orb-loader";

function StatusRow({ children }: { children: ReactNode }) {
	return (
		<div className="flex items-center gap-1.5 self-start px-1 py-0.5 text-label-xs text-muted-foreground">
			{children}
		</div>
	);
}

export function WorkingStatus({ status }: { status: string }) {
	const [elapsed, setElapsed] = useState(0);
	const reducedMotion = useReducedMotion();

	useEffect(() => {
		const id = setInterval(() => setElapsed((prev) => prev + 1), 1000);
		return () => clearInterval(id);
	}, []);

	return (
		<StatusRow>
			<OrbLoader />
			<span className="sr-only" role="status">
				{status}
			</span>
			<span className="grid" aria-hidden="true">
				<AnimatePresence initial={false}>
					<motion.span
						key={status}
						className="col-start-1 row-start-1"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={{ duration: reducedMotion ? 0 : 0.15 }}
					>
						{status}
					</motion.span>
				</AnimatePresence>
			</span>
			<span aria-hidden="true">· {elapsed}s</span>
		</StatusRow>
	);
}

export function WorkedStatus({
	seconds,
	tokenUsage,
}: {
	seconds: number | undefined;
	tokenUsage?: TokenUsage;
}) {
	const input = tokenUsage?.inputTokens;
	const output = tokenUsage?.outputTokens;
	const total =
		typeof input === "number" && typeof output === "number"
			? input + output
			: null;
	const known = total !== null && Number.isSafeInteger(total);
	return (
		<StatusRow>
			<Sparkles className="h-3 w-3 shrink-0" aria-hidden="true" />
			<span>{seconds === undefined ? "Worked" : `Worked for ${seconds}s`}</span>
			{tokenUsage && (
				<span
					className="font-numeric"
					title={
						known
							? `${input} input tokens; ${output} output tokens`
							: "The provider did not report complete token usage for this turn."
					}
				>
					·{" "}
					{known
						? `${total.toLocaleString("en-US")} tokens`
						: "Token usage unavailable"}
				</span>
			)}
		</StatusRow>
	);
}
