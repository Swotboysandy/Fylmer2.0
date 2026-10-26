import { afterEach, expect, it, vi } from "vitest";
import { chatDecision, cpuDecisionPrompt } from "../chat-decision";
import { CodexChatError } from "../codex-error";
const run = vi.hoisted(() => vi.fn());
vi.mock("../codex-transport", () => ({ runCodexTurn: run }));
afterEach(() => {
	vi.resetAllMocks();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});
it("keeps conversation and schemas while excluding nested writer calls on CPU", () => {
	const conversation = [
		{ role: "user", content: "Keep Maya and write two shots" },
		{ role: "tool", content: "Existing script" },
	];
	const result = JSON.parse(
		cpuDecisionPrompt(
			JSON.stringify({
				conversation,
				tools: [
					{ name: "ask_user" },
					{
						name: "edit_script",
						inputSchema: { type: "object", description: "verbose" },
					},
					{ name: "write_script" },
				],
			}),
		),
	);
	expect(result.conversation).toEqual(conversation);
	expect(result.tools).toEqual([
		{ name: "ask_user" },
		{ name: "edit_script", inputSchema: { type: "object" } },
	]);
	expect(result.instructions).toContain("wait for its answer before editing");
});
it("does not switch providers unless enabled", async () => {
	vi.stubEnv("FYLMER_CHAT_CPU_FALLBACK", "0");
	run.mockRejectedValue(new CodexChatError(429, "busy"));
	await expect(
		chatDecision({ home: "disabled", model: "codex", prompt: "hi" }),
	).rejects.toThrow("busy");
});
it("backs off Codex after a rate limit and preserves the prompt", async () => {
	vi.stubEnv("FYLMER_CHAT_CPU_FALLBACK", "1");
	vi.stubEnv("FYLMER_CHAT_BASE_URL", "http://127.0.0.1:11434/v1");
	vi.stubEnv("FYLMER_CHAT_MODEL", "cpu");
	run.mockRejectedValue(new CodexChatError(429, "busy"));
	const fetcher = vi.fn().mockImplementation(async () =>
		Response.json({
			message: { content: JSON.stringify({ text: "Hello", toolCalls: [] }) },
		}),
	);
	vi.stubGlobal("fetch", fetcher);
	const input = {
		home: "cooldown",
		model: "codex",
		prompt: "existing conversation",
	};
	expect(await chatDecision(input)).toMatchObject({
		modelId: "cpu",
		text: "Hello",
	});
	await chatDecision(input);
	expect(run).toHaveBeenCalledTimes(1);
	expect(JSON.parse(fetcher.mock.calls[0][1].body).messages[0].content).toBe(
		input.prompt,
	);
});
it("does not fall back after authorization or invalid response errors", async () => {
	vi.stubEnv("FYLMER_CHAT_CPU_FALLBACK", "1");
	run.mockRejectedValue(new Error("invalid decision"));
	await expect(
		chatDecision({ home: "invalid", model: "codex", prompt: "hi" }),
	).rejects.toThrow("invalid decision");
});
