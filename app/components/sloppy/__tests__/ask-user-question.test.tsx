// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolUIPart } from "ai";
import type { SloppyTools } from "@/lib/agent/types";
import { AskUserQuestion } from "../ask-user-question";

const answer = vi.fn();
vi.mock("../sloppy-provider", () => ({ useSloppy: () => ({ answer }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let unmount: (() => void) | undefined;
afterEach(() => {
	unmount?.();
	unmount = undefined;
	answer.mockReset();
});

const renderQuestion = (multiple = false) => {
	const container = document.body.appendChild(document.createElement("div"));
	const root = createRoot(container);
	const part = {
		type: "tool-ask_user",
		toolCallId: "choice-1",
		state: "input-available",
		input: {
			question: "How should we deliver the film?",
			options: [
				{ label: "Separate files", description: "One per product" },
				{ label: "One video" },
			],
			multiple,
		},
	} as ToolUIPart<SloppyTools>;
	act(() => root.render(<AskUserQuestion part={part} />));
	unmount = () => {
		act(() => root.unmount());
		container.remove();
	};
	return container;
};

describe("AskUserQuestion", () => {
	it("submits the selected option", () => {
		renderQuestion();
		const dialog = document.body.querySelector('[role="dialog"]');
		const radio = dialog?.querySelector<HTMLInputElement>(
			'input[type="radio"]',
		);
		const form = dialog?.querySelector("form");
		expect(dialog).not.toBeNull();
		expect(radio).not.toBeNull();
		expect(form).not.toBeNull();
		act(() => radio?.click());
		expect(radio?.closest("label")?.className).toContain("bg-secondary/60");
		act(() =>
			form?.dispatchEvent(
				new Event("submit", { bubbles: true, cancelable: true }),
			),
		);
		expect(answer).toHaveBeenCalledWith("choice-1", ["Separate files"], false);
	});

	it("reports skipping without approving anything", () => {
		renderQuestion(true);
		const skip = [
			...document.body.querySelectorAll<HTMLButtonElement>(
				'[role="dialog"] button',
			),
		].find((button) => button.textContent === "Skip");
		act(() => skip?.click());
		expect(answer).toHaveBeenCalledWith("choice-1", [], true);
	});

	it("submits multiple selected options from the dialog", () => {
		renderQuestion(true);
		const dialog = document.body.querySelector('[role="dialog"]');
		const choices = dialog?.querySelectorAll<HTMLInputElement>(
			'input[type="checkbox"]',
		);
		act(() => {
			choices?.[0]?.click();
			choices?.[1]?.click();
		});
		act(() =>
			dialog
				?.querySelector("form")
				?.dispatchEvent(
					new Event("submit", { bubbles: true, cancelable: true }),
				),
		);
		expect(answer).toHaveBeenCalledWith(
			"choice-1",
			["Separate files", "One video"],
			false,
		);
	});
});
