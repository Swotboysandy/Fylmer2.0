import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SloppyMessage } from "@/lib/agent/types";
import { TurnProgress } from "../turn-progress";

const parts: SloppyMessage["parts"] = [
	{
		type: "tool-read_script",
		toolCallId: "read",
		state: "output-available",
		input: {},
		output: "The script",
	},
	{
		type: "tool-set_title",
		toolCallId: "title",
		state: "input-available",
		input: { title: "A short film" },
	},
	{
		type: "tool-ask_user",
		toolCallId: "choice",
		state: "input-available",
		input: {
			question: "Which format?",
			options: [{ label: "Short" }, { label: "Feature" }],
		},
	},
];

describe("TurnProgress", () => {
	it("shows only real work with its actual state", () => {
		const markup = renderToStaticMarkup(<TurnProgress parts={parts} />);

		expect(markup).toContain("Reading the script");
		expect(markup).toContain("Naming the project");
		expect(markup).toContain("completed");
		expect(markup).toContain("in progress");
		expect(markup).not.toContain("Which format?");
		expect(markup).not.toContain("The script");
	});

	it("stays hidden before any tool starts", () => {
		expect(renderToStaticMarkup(<TurnProgress parts={[]} />)).toBe("");
	});
});
