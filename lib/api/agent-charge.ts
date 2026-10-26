import type { TokenUsage } from "@/lib/agent/token-usage";
import type { ModelRef } from "@/lib/connectors/types";
import type { AssetCostQuote } from "./asset-cost-quote";
import { claimJob, createJob, markProviderStarted, updateJob } from "./jobs";

export async function beginAgentCharge(input: {
	userId: string;
	projectId: string;
	model: ModelRef;
	quote: AssetCostQuote;
}) {
	const { id } = await createJob({
		userId: input.userId,
		projectId: input.projectId,
		connectorType: "llm",
		request: { provider: input.model.provider, model: input.model.model },
		status: "pending",
		costQuote: input.quote,
	});
	if (!(await claimJob(id)))
		throw new Error("The chat budget reservation could not be claimed.");
	try {
		await markProviderStarted(id);
	} catch (error) {
		await updateJob(id, {
			status: "failed",
			error: "Chat budget admission failed before model transmission.",
		});
		throw error;
	}
	return {
		id,
		settle: async (result: {
			costUsd?: number;
			modelId: string;
			tokenUsage: TokenUsage;
		}) => {
			const cost = result.costUsd;
			const knownCost =
				cost !== undefined &&
				Number.isFinite(cost) &&
				cost >= 0 &&
				cost < 1000000;
			await updateJob(id, {
				status: "completed",
				...(knownCost ? { cost_usd: cost } : {}),
				metadata: { modelId: result.modelId, tokenUsage: result.tokenUsage },
			});
		},
		fail: async () => {
			await updateJob(id, {
				status: "failed",
				error:
					"Chat did not complete after submission. Provider billing requires review.",
			});
		},
	};
}
