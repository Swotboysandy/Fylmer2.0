"use client";

import { useId, useState } from "react";
import type { ToolUIPart } from "ai";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { askUser, askUserAnswerSchema } from "@/lib/agent/tools/ask-user";
import type { SloppyTools } from "@/lib/agent/types";
import { useSloppy } from "./sloppy-provider";

export function AskUserQuestion({ part }: { part: ToolUIPart<SloppyTools> }) {
	const { answer } = useSloppy();
	const groupName = useId();
	const [selected, setSelected] = useState<number[]>([]);
	const [otherSelected, setOtherSelected] = useState(false);
	const [other, setOther] = useState("");
	const [submitted, setSubmitted] = useState(false);
	const parsed = askUser.input.safeParse(part.input);
	if (!parsed.success) return null;

	const { question, options, multiple = false } = parsed.data;
	const completed = part.state !== "input-available";
	const result =
		part.state === "output-available"
			? askUserAnswerSchema.safeParse(part.output)
			: null;
	const canSubmit =
		(selected.length > 0 || (otherSelected && other.trim().length > 0)) &&
		(!otherSelected || other.trim().length > 0);

	const choose = (index: number) => {
		setSelected((previous) =>
			multiple
				? previous.includes(index)
					? previous.filter((item) => item !== index)
					: [...previous, index]
				: [index],
		);
		if (!multiple) setOtherSelected(false);
	};

	const submit = (skipped: boolean) => {
		if (submitted) return;
		setSubmitted(true);
		answer(
			part.toolCallId,
			skipped
				? []
				: [
						...selected
							.map((index) => options[index]?.label)
							.filter((label) => label !== undefined),
						...(otherSelected ? [other.trim()] : []),
					],
			skipped,
		);
	};

	return (
		<>
			<div className="rounded-md bg-element-card px-3 py-2 text-label text-panel-fg">
				{completed
					? result?.success
						? result.data.skipped
							? "Question skipped"
							: `You chose: ${result.data.answers.join(", ")}`
						: "Question closed"
					: "Waiting for your choice"}
			</div>
			<Dialog open={!completed && !submitted}>
				<DialogContent
					showCloseButton={false}
					glow={false}
					onEscapeKeyDown={(event) => event.preventDefault()}
					onPointerDownOutside={(event) => event.preventDefault()}
				>
					<DialogHeader>
						<DialogTitle>Choose how to continue</DialogTitle>
						<DialogDescription>{question}</DialogDescription>
					</DialogHeader>
					<form
						className="flex min-h-0 flex-col gap-4"
						onSubmit={(event) => {
							event.preventDefault();
							if (canSubmit) submit(false);
						}}
					>
						<DialogBody>
							<fieldset disabled={submitted} className="flex flex-col gap-1.5">
								<legend className="sr-only">
									{multiple
										? "Choose one or more options"
										: "Choose one option"}
								</legend>
								{options.map((option, index) => (
									<label
										key={`${index}-${option.label}`}
										className={cn(
											"flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 transition-colors hover:bg-secondary/60 focus-within:bg-secondary/60",
											selected.includes(index) && "bg-secondary/60",
										)}
									>
										<input
											type={multiple ? "checkbox" : "radio"}
											name={groupName}
											checked={selected.includes(index)}
											onChange={() => choose(index)}
											className="mt-1 accent-accent"
										/>
										<span className="flex min-w-0 flex-col gap-0.5 text-label text-panel-fg">
											{option.label}
											{option.description && (
												<span className="text-label-xs text-muted-foreground">
													{option.description}
												</span>
											)}
										</span>
									</label>
								))}
								<label
									className={cn(
										"flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-label text-panel-fg transition-colors hover:bg-secondary/60 focus-within:bg-secondary/60",
										otherSelected && "bg-secondary/60",
									)}
								>
									<input
										type={multiple ? "checkbox" : "radio"}
										name={groupName}
										checked={otherSelected}
										onChange={() => {
											setOtherSelected(!otherSelected);
											if (!multiple) setSelected([]);
										}}
										className="accent-accent"
									/>
									Something else
								</label>
								{otherSelected && (
									<input
										type="text"
										value={other}
										onChange={(event) => setOther(event.target.value)}
										aria-label="Your own answer"
										placeholder="Write your answer"
										maxLength={240}
										className="w-full rounded-md bg-element-input px-3 py-2 font-body text-label text-panel-fg outline-none focus-ring"
									/>
								)}
							</fieldset>
						</DialogBody>
						<DialogFooter>
							<Button
								type="button"
								variant="panel"
								size="sm"
								onClick={() => submit(true)}
							>
								Skip
							</Button>
							<Button
								type="submit"
								variant="accent"
								size="sm"
								disabled={!canSubmit}
							>
								Continue
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</>
	);
}
