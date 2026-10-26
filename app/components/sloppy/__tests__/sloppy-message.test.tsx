import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SloppyMessage } from "@/lib/agent/types";
import { AgentTurn } from "../sloppy-message";

const interrupted: SloppyMessage = {
	id: "m2",
	role: "assistant",
	parts: [
		{ type: "step-start" },
		{ type: "reasoning", text: "half a thought", state: "streaming" },
	],
};

const render = (message: SloppyMessage, streaming: boolean) =>
	renderToStaticMarkup(<AgentTurn message={message} streaming={streaming} />);

describe("AgentTurn", () => {
	it("shows a persisted output-limit warning even for a text-only reply", () => {
		const message: SloppyMessage = {
			id: "limited",
			role: "assistant",
			parts: [{ type: "text", text: "Partial scene" }],
			metadata: { outputLimitReached: true },
		};
		expect(render(message, false)).toContain(
			"output limit and may be incomplete",
		);
		expect(render(message, false)).toContain('role="status"');
		expect(render(message, true)).not.toContain(
			"output limit and may be incomplete",
		);
		expect(
			render({ ...message, metadata: { outputLimitReached: false } }, false),
		).not.toContain("output limit and may be incomplete");
	});
	it("shows reported token totals in the existing completed-turn footer", () => {
		const markup = render(
			{
				...interrupted,
				metadata: {
					workSeconds: 3,
					tokenUsage: { inputTokens: 12, outputTokens: 7 },
				},
			},
			false,
		);
		expect(markup).toContain("19 tokens");
		expect(markup).toContain("12 input tokens; 7 output tokens");
		expect(markup).toContain("Worked for 3s");
	});
	it("does not invent counts for missing provider usage", () => {
		const markup = render(
			{
				...interrupted,
				metadata: { tokenUsage: { inputTokens: null, outputTokens: 7 } },
			},
			false,
		);
		expect(markup).toContain("Token usage unavailable");
		expect(markup).not.toContain("0 tokens");
		expect(render(interrupted, false)).not.toContain("tokens");
	});
	it("does not show a completed token total during a continuing turn", () => {
		expect(
			render(
				{
					...interrupted,
					metadata: { tokenUsage: { inputTokens: 12, outputTokens: 7 } },
				},
				true,
			),
		).not.toContain("19 tokens");
	});
	it("shows a restored half-open turn as finished, not as still thinking", () => {
		const markup = render(interrupted, false);

		expect(markup).toContain("Done thinking");
		expect(markup).not.toContain("Thinking…");
		expect(markup).not.toContain("shimmer");
	});

	it("leaves the abandoned half-thought collapsed rather than expanded", () => {
		expect(render(interrupted, false)).not.toContain("half a thought");
		expect(render(interrupted, true)).toContain("half a thought");
	});

	it("still shows the turn in flight as thinking", () => {
		expect(render(interrupted, true)).toContain("Thinking…");
	});

	it("does not show raw script XML in the conversation", () => {
		const message: SloppyMessage = {
			id: "m3",
			role: "assistant",
			parts: [
				{
					type: "tool-read_script",
					toolCallId: "c1",
					state: "output-available",
					input: {},
					output: '## Script\n```xml\n<asset_voice name="Narrator" />\n```',
				},
			],
		};

		const markup = render(message, false);
		expect(markup).toContain("Script checked");
		expect(markup).not.toContain("{}");
		expect(markup).not.toContain("aria-expanded");
		expect(markup).not.toContain("asset_voice");
		expect(markup).not.toContain("## Script");
	});

	it("shows only the status while reading an empty-input script", () => {
		const message: SloppyMessage = {
			id: "m4",
			role: "assistant",
			parts: [
				{
					type: "tool-read_script",
					toolCallId: "c2",
					state: "input-available",
					input: {},
				},
			],
		};

		const markup = render(message, true);
		expect(markup).toContain("Reading the script");
		expect(markup).not.toContain("{}");
		expect(markup).not.toContain("aria-expanded");
	});
});
