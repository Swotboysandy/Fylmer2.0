import {
	consumeStream,
	convertToModelMessages,
	createUIMessageStreamResponse,
	pruneMessages,
	streamText,
	toUIMessageStream,
} from "ai";
import { nanoid } from "nanoid";
import { z } from "zod";
import { sloppyInstructions } from "@/lib/agent/prompt";
import {
	toolCallsMade,
	upsertMessage,
	pruneTranscript,
} from "@/lib/agent/messages";
import { SLOPPY_TOOLS } from "@/lib/agent/tools/registry";
import type { SloppyMessage } from "@/lib/agent/types";
import { accumulateTokenUsage } from "@/lib/agent/token-usage";
import type { ModelRef } from "@/lib/connectors/types";
import type { LLMProvider } from "@/lib/providers/llm/base";
import {
	findOrCreateConversation,
	listConversationMessages,
	saveConversationMessage,
} from "./conversations";
import { logger } from "./logger";
import { CodexChatError } from "@/lib/providers/llm/codex-error";
import type { AgentModel } from "@/lib/providers/llm/agent-model";
import type { admitAgentBudget } from "./agent-budget";

const MAX_TOOL_CALLS = 30;

export const agentTurnSchema = <TModel extends ModelRef>(
	model: z.ZodType<TModel>,
) =>
	z
		.object({
			projectId: z.uuid(),
			message: z.unknown(),
		})
		.and(model);

export type AgentTurnRequest = {
	projectId: string;
	userId: string;
	recordSpend: (costUsd: number) => Promise<unknown>;
	message: SloppyMessage;
	model: string;
	llm: () => Promise<LLMProvider>;
	admitBudget?: (
		agent: AgentModel,
	) => Promise<Pick<
		NonNullable<Awaited<ReturnType<typeof admitAgentBudget>>>,
		"maxOutputTokens" | "settle" | "fail"
	> | null>;
};

/**
 * One step of a turn: the model runs until it calls a tool, and the editor comes
 * back with the result as the next request. The round trip is the loop.
 */
export async function streamAgentTurn(
	request: AgentTurnRequest,
): Promise<Response> {
	// Reading the key this turn runs on depends on nothing else here, and would
	// otherwise sit in front of the first token.
	const [llm, conversationId] = await Promise.all([
		request.llm(),
		findOrCreateConversation(request.projectId, request.userId),
	]);
	const history = await listConversationMessages(conversationId);
	const stored = history.find((row) => row.id === request.message.id);
	const incoming: SloppyMessage = {
		...request.message,
		metadata: stored?.metadata,
	};
	const messages = upsertMessage(history, incoming);
	await saveConversationMessage(conversationId, incoming);

	const carried = stored?.metadata?.workSeconds ?? 0;
	const agent = llm.agentModel(request.model);
	const {
		model,
		providerOptions,
		cachedPrefix,
		costOf,
		initialTool,
		maxOutputTokens,
	} = agent;

	const modelMessages = pruneMessages({
		messages: await convertToModelMessages(pruneTranscript(messages), {
			tools: SLOPPY_TOOLS,
			ignoreIncompleteToolCalls: true,
		}),
	});

	const budget = await request.admitBudget?.(agent);
	const startedAt = Date.now();
	const result = streamText({
		model,
		instructions: sloppyInstructions(cachedPrefix),
		messages: modelMessages,
		tools: SLOPPY_TOOLS,
		// Withdrawing the tools is what ends a runaway turn: the model has nothing
		// left to call, so it answers the user instead of looping again.
		toolChoice:
			toolCallsMade(messages) >= MAX_TOOL_CALLS
				? "none"
				: initialTool && incoming.role === "user"
					? { type: "tool", toolName: initialTool }
					: "auto",
		maxOutputTokens: budget?.maxOutputTokens ?? maxOutputTokens,
		providerOptions,
		maxRetries: 0,
		onEnd: async ({ usage }) => {
			logger.info({ usage }, "Fylmer Assistant turn usage");
			if (budget) {
				await budget
					.settle(usage)
					.catch((error) =>
						logger.error(error, "Fylmer Assistant project settlement"),
					);
				return;
			}
			// The SDK drops anything a callback throws, so a lost ledger row has to be logged here.
			await request
				.recordSpend(costOf(usage))
				.catch((error) => logger.error(error, "Fylmer Assistant turn spend"));
		},
		onError: async () => {
			await budget
				?.fail()
				.catch((error) =>
					logger.error(error, "Fylmer Assistant project failure"),
				);
		},
	});

	return createUIMessageStreamResponse({
		stream: toUIMessageStream<typeof SLOPPY_TOOLS, SloppyMessage>({
			stream: result.stream,
			tools: SLOPPY_TOOLS,
			originalMessages: messages,
			generateMessageId: nanoid,
			messageMetadata: ({ part }) => {
				if (part.type === "finish") {
					return {
						outputLimitReached: part.finishReason === "length",
						workSeconds: carried + Math.round((Date.now() - startedAt) / 1000),
						tokenUsage: accumulateTokenUsage(
							incoming.role === "assistant"
								? (stored?.metadata?.tokenUsage ?? null)
								: undefined,
							part.totalUsage,
						),
					};
				}
			},
			onEnd: ({ responseMessage }) =>
				saveConversationMessage(conversationId, responseMessage),
			onError: (error) => {
				logger.error(
					{ name: error instanceof Error ? error.name : "UnknownError" },
					"Fylmer Assistant turn",
				);
				if (error instanceof CodexChatError) return error.message;
				return "Fylmer could not finish this reply. Please retry; no generation was started by this chat request.";
			},
		}),
		consumeSseStream: consumeStream,
	});
}
