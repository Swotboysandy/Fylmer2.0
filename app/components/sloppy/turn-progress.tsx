"use client";

import { isStaticToolUIPart, type ToolUIPart } from "ai";
import { Check, Loader2, X } from "@/components/ui/icon";
import type { SloppyMessage, SloppyTools } from "@/lib/agent/types";
import { toolPresentation } from "./tool-presentation";

export function TurnProgress({ parts }: { parts: SloppyMessage["parts"] }) {
	const steps = parts.filter(
		(part): part is ToolUIPart<SloppyTools> =>
			isStaticToolUIPart(part) && part.type !== "tool-ask_user",
	);
	if (steps.length === 0) return null;

	return (
		<div className="mb-2 rounded-lg bg-secondary/40 px-3 py-2 text-label-xs text-panel-fg">
			<p className="mb-1.5 font-medium">Working on your film</p>
			<ol className="flex flex-col gap-1.5" aria-label="Current steps">
				{steps.map((part) => {
					const done = part.state === "output-available";
					const failed = part.state === "output-error";
					const { label } = toolPresentation(part);
					return (
						<li key={part.toolCallId} className="flex items-center gap-2">
							{done ? (
								<Check className="h-3 w-3 shrink-0" aria-hidden="true" />
							) : failed ? (
								<X
									className="h-3 w-3 shrink-0 text-destructive"
									aria-hidden="true"
								/>
							) : (
								<Loader2
									className="h-3 w-3 shrink-0 animate-spin motion-reduce:animate-none"
									aria-hidden="true"
								/>
							)}
							<span className="min-w-0 truncate">{label}</span>
							<span className="sr-only">
								{done ? "completed" : failed ? "failed" : "in progress"}
							</span>
						</li>
					);
				})}
			</ol>
		</div>
	);
}
