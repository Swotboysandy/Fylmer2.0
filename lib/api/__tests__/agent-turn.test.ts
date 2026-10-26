import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	LanguageModelV3CallOptions,
	LanguageModelV3StreamPart,
	SharedV3ProviderOptions,
} from "@ai-sdk/provider";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { APICallError } from "@ai-sdk/provider";
import type { SloppyMessage } from "@/lib/agent/types";

const { conversations, provider, recordSpend } = vi.hoisted(() => ({
	conversations: {
		findOrCreateConversation: vi.fn(
			async (_projectId: string, _userId: string) => "conv-1",
		),
		listConversationMessages: vi.fn(
			async (_id: string): Promise<unknown[]> => [],
		),
		saveConversationMessage: vi.fn(
			async (_id: string, _message: unknown) => {},
		),
	},
	provider: { agentModel: vi.fn() },
	recordSpend: vi.fn(async (_costUsd: number) => {}),
}));

vi.mock("../conversations", () => conversations);

import type { LLMProvider } from "@/lib/providers/llm/base";
import { streamAgentTurn, type AgentTurnRequest } from "../agent-turn";
import { logger } from "../logger";

const USAGE = {
	inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 7, text: 7, reasoning: 0 },
};

const finish: LanguageModelV3StreamPart = {
	type: "finish",
	finishReason: { unified: "stop", raw: "end_turn" },
	usage: USAGE,
};

const TEXT_TURN: LanguageModelV3StreamPart[] = [
	{ type: "stream-start", warnings: [] },
	{ type: "text-start", id: "t0" },
	{ type: "text-delta", id: "t0", delta: "on it" },
	{ type: "text-end", id: "t0" },
	finish,
];

const asked = (text: string): SloppyMessage => ({
	id: `m-user-${text}`,
	role: "user",
	parts: [{ type: "text", text }],
});

// The SDK frames its own stream, and closes it with a [DONE] that is not JSON.
async function chunksOf(response: Response) {
	const body = await response.text();
	return body
		.split("\n\n")
		.flatMap((frame) => (frame.startsWith("data: ") ? [frame.slice(6)] : []))
		.filter((data) => data !== "[DONE]")
		.map(
			(data) => JSON.parse(data) as { type: string } & Record<string, unknown>,
		);
}

let calls: LanguageModelV3CallOptions[] = [];

async function startTurn(
	chunks: LanguageModelV3StreamPart[],
	options: {
		message?: SloppyMessage;
		model?: string;
		history?: SloppyMessage[];
		cachedPrefix?: SharedV3ProviderOptions;
		admitBudget?: AgentTurnRequest["admitBudget"];
	} = {},
) {
	if (options.history) {
		conversations.listConversationMessages.mockResolvedValue(options.history);
	}
	provider.agentModel.mockReturnValue({
		model: new MockLanguageModelV3({
			doStream: async (call) => {
				calls.push(call);
				return {
					stream: simulateReadableStream({ chunks, chunkDelayInMs: 0 }),
				};
			},
		}),
		modelId: "test-model",
		providerOptions: {},
		cachedPrefix: options.cachedPrefix ?? {},
		costOf: () => 0.42,
	});

	return streamAgentTurn({
		projectId: "p1",
		userId: "u1",
		recordSpend,
		admitBudget: options.admitBudget,
		message: options.message ?? asked("make it shorter"),
		model: options.model ?? "claude-opus-5",
		llm: async () => provider as unknown as LLMProvider,
	});
}

async function runTurn(...args: Parameters<typeof startTurn>) {
	return chunksOf(await startTurn(...args));
}

const finishSeconds = (chunks: Record<string, unknown>[]) => {
	const metadata = chunks.at(-1)?.messageMetadata as { workSeconds: number };
	return metadata.workSeconds;
};

const saved = (call: number) =>
	conversations.saveConversationMessage.mock.calls[call][1] as SloppyMessage;

beforeEach(() => {
	vi.clearAllMocks();
	calls = [];
	conversations.listConversationMessages.mockResolvedValue([]);
});

describe("streamAgentTurn", () => {
	it("persists token-limit status while accounting for consumed tokens", async () => {
		const chunks = await runTurn([
			...TEXT_TURN.slice(0, -1),
			{ ...finish, finishReason: { unified: "length", raw: "max_tokens" } },
		]);
		expect(chunks.at(-1)?.messageMetadata).toMatchObject({
			outputLimitReached: true,
			tokenUsage: { inputTokens: 12, outputTokens: 7 },
		});
		expect(saved(1).metadata).toMatchObject({ outputLimitReached: true });
		expect(recordSpend).toHaveBeenCalledWith(0.42);
		expect(calls).toHaveLength(1);
	});
	it("clears a carried output-limit warning when continuation finishes normally", async () => {
		const previous: SloppyMessage = {
			id: "continued",
			role: "assistant",
			parts: [{ type: "text", text: "Partial" }],
			metadata: { outputLimitReached: true },
		};
		await runTurn(TEXT_TURN, { history: [previous], message: previous });
		expect(saved(1).metadata?.outputLimitReached).toBe(false);
	});
	it("rejects admission before transmitting to the model", async () => {
		await expect(
			startTurn(TEXT_TURN, {
				admitBudget: async () => {
					throw new Error("Cap exhausted");
				},
			}),
		).rejects.toThrow("Cap exhausted");
		expect(calls).toHaveLength(0);
		expect(recordSpend).not.toHaveBeenCalled();
	});
	it("settles the reserved charge without duplicate hosted booking after disconnect", async () => {
		const settle = vi.fn(async () => {});
		const fail = vi.fn(async () => {});
		const response = await startTurn(TEXT_TURN, {
			admitBudget: async () => ({ maxOutputTokens: 1234, settle, fail }),
		});
		await response.body?.cancel();
		await vi.waitFor(() => expect(settle).toHaveBeenCalledTimes(1));
		expect(calls[0].maxOutputTokens).toBe(1234);
		expect(recordSpend).not.toHaveBeenCalled();
		expect(fail).not.toHaveBeenCalled();
	});
	it("does not silently retry a failed provider request", async () => {
		const fail = vi.fn(async () => {});
		const settle = vi.fn(async () => {});
		const doStream = vi.fn(async () => {
			throw new APICallError({
				message: "Temporary provider failure",
				url: "https://example.invalid/model",
				requestBodyValues: {},
				statusCode: 503,
				isRetryable: true,
			});
		});
		provider.agentModel.mockReturnValue({
			model: new MockLanguageModelV3({ doStream }),
			providerOptions: {},
			cachedPrefix: {},
			costOf: () => 0.42,
		});
		const response = await streamAgentTurn({
			projectId: "p1",
			userId: "u1",
			recordSpend,
			message: asked("retry test"),
			model: "test-model",
			llm: async () => provider as unknown as LLMProvider,
			admitBudget: async () => ({ maxOutputTokens: 1234, settle, fail }),
		});
		const chunks = await chunksOf(response);
		expect(doStream).toHaveBeenCalledTimes(1);
		expect(chunks.some((chunk) => chunk.type === "error")).toBe(true);
		expect(recordSpend).not.toHaveBeenCalled();
		expect(fail).toHaveBeenCalledTimes(1);
		expect(settle).not.toHaveBeenCalled();
	});
	it("preserves unreported usage through the SDK stream as unknown", async () => {
		const missingUsage: LanguageModelV3StreamPart = {
			...finish,
			usage: {
				inputTokens: {
					total: undefined,
					noCache: undefined,
					cacheRead: undefined,
					cacheWrite: undefined,
				},
				outputTokens: {
					total: undefined,
					text: undefined,
					reasoning: undefined,
				},
			},
		};
		await runTurn([...TEXT_TURN.slice(0, -1), missingUsage]);
		expect(saved(1).metadata?.tokenUsage).toEqual({
			inputTokens: null,
			outputTokens: null,
		});
	});
	it("streams and persists provider-reported token counts", async () => {
		const chunks = await runTurn(TEXT_TURN);
		expect(chunks.at(-1)).toMatchObject({
			messageMetadata: { tokenUsage: { inputTokens: 12, outputTokens: 7 } },
		});
		expect(saved(1).metadata?.tokenUsage).toEqual({
			inputTokens: 12,
			outputTokens: 7,
		});
	});
	it("records what came in before asking the model", async () => {
		await runTurn(TEXT_TURN);

		expect(saved(0)).toMatchObject({
			role: "user",
			parts: [{ type: "text", text: "make it shorter" }],
		});
	});

	it("streams the reply and finishes", async () => {
		const chunks = await runTurn(TEXT_TURN);

		expect(chunks).toContainEqual(
			expect.objectContaining({ type: "text-delta", delta: "on it" }),
		);
		expect(chunks.at(-1)).toMatchObject({ type: "finish" });
	});

	it("records what the model says the turn cost", async () => {
		await runTurn(TEXT_TURN);

		expect(recordSpend).toHaveBeenCalledWith(0.42);
	});

	it("records the cost of a step the editor stopped reading", async () => {
		const response = await startTurn(TEXT_TURN);
		await response.body?.cancel();

		await vi.waitFor(() => expect(recordSpend).toHaveBeenCalledWith(0.42));
	});

	it("logs a cost it could not record", async () => {
		const error = vi.spyOn(logger, "error").mockImplementation(() => {});
		recordSpend.mockRejectedValueOnce(new Error("insert failed"));

		await runTurn(TEXT_TURN);

		await vi.waitFor(() =>
			expect(error).toHaveBeenCalledWith(
				new Error("insert failed"),
				"Fylmer Assistant turn spend",
			),
		);
	});

	it("stores the assistant message the step produced", async () => {
		await runTurn(TEXT_TURN);

		expect(saved(1)).toMatchObject({
			role: "assistant",
			parts: [{ type: "step-start" }, { type: "text", text: "on it" }],
		});
	});

	// A call answered with an error is what sends the model back round to retry.
	it("hands a call it could not read back as that call's own failure", async () => {
		const chunks = await runTurn([
			{ type: "stream-start", warnings: [] },
			{
				type: "tool-call",
				toolCallId: "call-1",
				toolName: "set_title",
				input: '{"title": <parameter name="title">Moon Cat}',
			},
			{ ...finish, finishReason: { unified: "tool-calls", raw: "tool_use" } },
		]);

		expect(chunks).toContainEqual(
			expect.objectContaining({
				type: "tool-input-error",
				toolCallId: "call-1",
				toolName: "set_title",
			}),
		);
		expect(chunks.map((chunk) => chunk.type)).not.toContain("error");
	});

	it("surfaces a tool call for the editor to run", async () => {
		const chunks = await runTurn([
			{ type: "stream-start", warnings: [] },
			{
				type: "tool-call",
				toolCallId: "call-1",
				toolName: "edit_script",
				input: JSON.stringify({ ops: [{ op: "remove", id: "n1" }] }),
			},
			{ ...finish, finishReason: { unified: "tool-calls", raw: "tool_use" } },
		]);

		expect(chunks).toContainEqual(
			expect.objectContaining({
				type: "tool-input-available",
				toolCallId: "call-1",
				toolName: "edit_script",
				input: { ops: [{ op: "remove", id: "n1" }] },
			}),
		);
	});
});

describe("a turn that takes more than one step", () => {
	const reading = (toolCallId: string, output: string) =>
		({
			type: "tool-read_script",
			toolCallId,
			state: "output-available",
			input: {},
			output,
		}) as const;

	/** What the editor sends back: the same message, carrying no metadata of its own. */
	const answered = (...parts: SloppyMessage["parts"]): SloppyMessage => ({
		id: "m-agent",
		role: "assistant",
		parts,
	});

	/** What the server stored for the steps before this one. */
	const recorded = (
		metadata: SloppyMessage["metadata"],
		...parts: SloppyMessage["parts"]
	): SloppyMessage[] => [
		asked("make it shorter"),
		{ id: "m-agent", role: "assistant", metadata, parts },
	];

	const spent = { workSeconds: 3 };
	it("accumulates only server-stored usage across tool steps", async () => {
		const message = {
			...answered(reading("call-1", "the script")),
			metadata: { tokenUsage: { inputTokens: 9999, outputTokens: 9999 } },
		};
		await runTurn(TEXT_TURN, {
			message,
			history: recorded(
				{ ...spent, tokenUsage: { inputTokens: 10, outputTokens: 5 } },
				reading("call-1", "the script"),
			),
		});
		expect(saved(1).metadata?.tokenUsage).toEqual({
			inputTokens: 22,
			outputTokens: 12,
		});
	});
	it("marks legacy continuation totals unknown instead of claiming a full count", async () => {
		await runTurn(TEXT_TURN, {
			message: answered(reading("call-1", "the script")),
			history: recorded(spent, reading("call-1", "the script")),
		});
		expect(saved(1).metadata?.tokenUsage).toEqual({
			inputTokens: null,
			outputTokens: null,
		});
	});

	it("adds a step's time to what the turn already worked", async () => {
		const chunks = await runTurn(TEXT_TURN, {
			message: answered(reading("call-1", "the script")),
			history: recorded(spent, reading("call-1", "the script")),
		});

		expect(finishSeconds(chunks)).toBeGreaterThanOrEqual(3);
	});

	it("runs the model the step was sent with", async () => {
		await runTurn(TEXT_TURN, {
			message: answered(reading("call-1", "the script")),
			history: recorded(spent, reading("call-1", "the script")),
			model: "claude-opus-5",
		});

		expect(provider.agentModel).toHaveBeenCalledWith("claude-opus-5");
	});

	it("does not take what a turn cost from the editor", async () => {
		const claimed: SloppyMessage = {
			...answered(reading("call-1", "the script")),
			metadata: { workSeconds: 9999 },
		};
		const chunks = await runTurn(TEXT_TURN, {
			message: claimed,
			history: recorded(spent, reading("call-1", "the script")),
		});

		expect(finishSeconds(chunks)).toBeLessThan(9999);
	});

	it("keeps every tool on offer for the rest of the turn", async () => {
		await runTurn(TEXT_TURN, {
			message: answered(reading("call-1", "the script")),
		});

		const offered = calls[0].tools?.map((tool) => tool.name);
		expect(offered).toContain("read_script");
		expect(offered).toContain("write_script");
	});

	it("keeps offering the tools while the turn is within its budget", async () => {
		await runTurn(TEXT_TURN, {
			message: answered(reading("call-1", "the script")),
		});

		expect(calls[0].toolChoice).toEqual({ type: "auto" });
	});

	it("withdraws the tools once the turn has spent its budget", async () => {
		await runTurn(TEXT_TURN, {
			message: answered(
				...Array.from({ length: 30 }, (_part, index) =>
					reading(`call-${index}`, "the script"),
				),
			),
		});

		expect(calls[0].toolChoice).toEqual({ type: "none" });
	});

	it("keeps every reading the turn in flight has taken", async () => {
		await runTurn(TEXT_TURN, {
			message: answered(
				{ type: "step-start" },
				reading("call-1", "the script as it was"),
				{ type: "step-start" },
				reading("call-2", "the script as it stands"),
			),
		});

		const sent = JSON.stringify(calls[0].prompt);
		expect(sent).toContain("the script as it was");
		expect(sent).toContain("the script as it stands");
	});

	it("drops the readings of turns that have already finished", async () => {
		await runTurn(TEXT_TURN, {
			message: asked("now make it longer"),
			history: recorded(spent, reading("call-1", "a script from last turn")),
		});

		expect(JSON.stringify(calls[0].prompt)).not.toContain(
			"a script from last turn",
		);
	});
});

describe("model selection", () => {
	// The picked name is resolved to the provider's id at the route boundary.
	it("runs the model the request names", async () => {
		await runTurn(TEXT_TURN, { model: "claude-haiku-4-5-20251001" });

		expect(provider.agentModel).toHaveBeenCalledWith(
			"claude-haiku-4-5-20251001",
		);
	});
});

describe("prompt caching", () => {
	const MARK = { anthropic: { cacheControl: { type: "ephemeral" } } };

	it("sends the standing instructions as one system block, marked as a cached prefix", async () => {
		await runTurn(TEXT_TURN, { cachedPrefix: MARK });

		const [standing, next] = calls[0].prompt;
		expect(standing).toMatchObject({ role: "system", providerOptions: MARK });
		expect(JSON.stringify(standing)).toContain("You are Fylmer Assistant");
		expect(next?.role).toBe("user");
	});
});
