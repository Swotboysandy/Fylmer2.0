import { z } from "zod";
import type { LanguageModelUsage } from "ai";

export const tokenUsageSchema = z.object({
	inputTokens: z.number().int().nonnegative().nullable(),
	outputTokens: z.number().int().nonnegative().nullable(),
});

export type TokenUsage = z.infer<typeof tokenUsageSchema>;

function addReported(previous: number | null, current: number | undefined) {
	if (
		previous === null ||
		current === undefined ||
		!Number.isSafeInteger(current) ||
		current < 0
	)
		return null;
	const total = previous + current;
	return Number.isSafeInteger(total) ? total : null;
}

export function accumulateTokenUsage(
	previous: TokenUsage | null | undefined,
	usage: Pick<LanguageModelUsage, "inputTokens" | "outputTokens">,
): TokenUsage {
	return {
		inputTokens: addReported(
			previous === undefined ? 0 : (previous?.inputTokens ?? null),
			usage.inputTokens,
		),
		outputTokens: addReported(
			previous === undefined ? 0 : (previous?.outputTokens ?? null),
			usage.outputTokens,
		),
	};
}
