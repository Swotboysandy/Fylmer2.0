import type { LanguageModelUsage } from "ai";
import type { ModelRef } from "@/lib/connectors/types";
import { FilmReviewSchema } from "@/lib/fylmer/review";
import type { AgentModel } from "@/lib/providers/llm/agent-model";
import { accumulateTokenUsage } from "@/lib/agent/token-usage";
import { createClient } from "@/lib/supabase/server";
import { beginAgentCharge } from "./agent-charge";
import { quoteAgentCost } from "./agent-cost-quote";
import { ProjectBudgetError } from "./project-budget-error";

export async function admitAgentBudget(
	input: { userId: string; projectId: string; picked: ModelRef },
	agent: AgentModel,
) {
	const client = await createClient();
	const { data, error } = await client.rpc("film_workflow", {
		p_project_id: input.projectId,
		p_action: "read",
	});
	if (error)
		throw new ProjectBudgetError(
			"Could not verify the chat project budget. No model request was sent.",
		);
	const review = FilmReviewSchema.parse(data);
	if (review.capUsd == null && review.mode !== "autonomous") return null;
	if (review.capUsd == null)
		throw new ProjectBudgetError(
			"Set a project spending cap before autonomous chat. No model request was sent.",
		);
	const maxOutputTokens = agent.maxOutputTokens ?? 128000;
	const quote = quoteAgentCost(input.picked, agent.modelId, maxOutputTokens);
	const charge = await beginAgentCharge({
		...input,
		model: input.picked,
		quote,
	});
	let finished = false;
	return {
		maxOutputTokens,
		settleCost: async (costUsd: number) => {
			if (finished) return;
			finished = true;
			await charge.settle({
				costUsd,
				modelId: agent.modelId,
				tokenUsage: { inputTokens: null, outputTokens: null },
			});
		},
		settle: async (usage: LanguageModelUsage) => {
			if (finished) return;
			finished = true;
			const tokenUsage = accumulateTokenUsage(undefined, usage);
			const counts = [
				usage.inputTokens,
				usage.outputTokens,
				usage.inputTokenDetails.noCacheTokens,
				usage.inputTokenDetails.cacheReadTokens,
				usage.inputTokenDetails.cacheWriteTokens,
			];
			const complete =
				counts.every(
					(count) =>
						typeof count === "number" &&
						Number.isSafeInteger(count) &&
						count >= 0,
				) &&
				(usage.inputTokenDetails.noCacheTokens ?? 0) +
					(usage.inputTokenDetails.cacheReadTokens ?? 0) +
					(usage.inputTokenDetails.cacheWriteTokens ?? 0) ===
					usage.inputTokens;
			let costUsd: number | undefined;
			try {
				costUsd = complete ? agent.costOf(usage) : undefined;
			} catch {
				costUsd = undefined;
			}
			await charge.settle({ costUsd, modelId: agent.modelId, tokenUsage });
		},
		fail: async () => {
			if (finished) return;
			finished = true;
			await charge.fail();
		},
	};
}
