import { ANTHROPIC_LLM_MODELS } from "@/lib/connectors/llm/anthropic/models";
import type { ModelRef } from "@/lib/connectors/types";
import type { AssetCostQuote } from "./asset-cost-quote";
import { ProjectBudgetError } from "./project-budget-error";

const SOURCE = "https://platform.claude.com/docs/en/about-claude/pricing";
const REVIEWED_AT = Date.parse("2026-10-23T21:00:00Z");
const VALID_UNTIL = Date.parse("2026-10-24T21:00:00Z");
const PRICES: Record<
	string,
	{ input: number; output: number; context: number; maxOutput: number }
> = {
	"claude-opus-5": {
		input: 5,
		output: 25,
		context: 1048576,
		maxOutput: 128000,
	},
	"claude-sonnet-5": {
		input: 2,
		output: 10,
		context: 1048576,
		maxOutput: 128000,
	},
	"claude-haiku-4-5-20251001": {
		input: 1,
		output: 5,
		context: 204800,
		maxOutput: 64000,
	},
};

export type AgentCostQuote = AssetCostQuote & {
	modelId: string;
	pricingReviewedAt: string;
	inputTokenCeiling: number;
	maxOutputTokens: number;
	maxRetries: 0;
	basis: "standard-global-context-ceiling";
};

export function quoteAgentCost(
	picked: ModelRef,
	modelId: string,
	maxOutputTokens: number,
	now = Date.now(),
): AgentCostQuote {
	const model =
		ANTHROPIC_LLM_MODELS[picked.model as keyof typeof ANTHROPIC_LLM_MODELS];
	const price = Object.hasOwn(PRICES, modelId) ? PRICES[modelId] : undefined;
	if (
		!price ||
		model?.id !== modelId ||
		!["anthropic", "openslop"].includes(picked.provider)
	)
		throw new ProjectBudgetError(
			"This chat model has no verified bounded price. No model request was sent.",
		);
	if (!Number.isFinite(now) || now < REVIEWED_AT || now >= VALID_UNTIL)
		throw new ProjectBudgetError(
			"Chat pricing needs verification before another budgeted request. No model request was sent.",
		);
	if (
		!Number.isSafeInteger(maxOutputTokens) ||
		maxOutputTokens <= 0 ||
		maxOutputTokens > price.maxOutput
	)
		throw new ProjectBudgetError(
			"The chat output limit is outside this model's verified bounds. No model request was sent.",
		);
	const ceilingUsd =
		Math.ceil(
			price.context * price.input * 2 + maxOutputTokens * price.output,
		) / 1000000;
	return {
		provider: picked.provider,
		model: picked.model,
		modelId,
		ceilingUsd,
		currency: "USD",
		source: SOURCE,
		pricingReviewedAt: new Date(REVIEWED_AT).toISOString(),
		expiresAt: new Date(Math.min(now + 300000, VALID_UNTIL)).toISOString(),
		inputTokenCeiling: price.context,
		maxOutputTokens,
		maxRetries: 0,
		basis: "standard-global-context-ceiling",
	};
}
