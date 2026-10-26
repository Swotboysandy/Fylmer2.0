import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { wrapLanguageModel } from "ai";
import type { ThinkingLevel } from "@/lib/connectors/llm/enums";

export function metaProviderOptions(effort: ThinkingLevel) {
	return {
		meta: {
			thinking: { type: "adaptive", display: "summarized" },
			effort: effort === "max" ? "xhigh" : effort,
			structuredOutputMode: "outputFormat",
		},
	};
}

export const META_SPARK_MODEL_ID = "muse-spark-1.3";

export function createMetaLanguageModel(apiKey: string, modelId: string) {
	if (!apiKey.trim()) throw new Error("Connect a Meta Model API key first.");
	if (modelId !== META_SPARK_MODEL_ID)
		throw new Error(
			"This Meta model is not supported. Contributor mode is not enabled.",
		);
	const model = createAnthropic({
		baseURL: "https://api.meta.ai/v1",
		authToken: apiKey,
		name: "meta.messages",
	})(modelId);
	return wrapLanguageModel({
		model,
		middleware: {
			specificationVersion: "v4",
			wrapStream: async ({ doStream }) => {
				const result = await doStream();
				let finished = false;
				return {
					...result,
					stream: result.stream.pipeThrough(
						new TransformStream<
							LanguageModelV4StreamPart,
							LanguageModelV4StreamPart
						>({
							transform(part, controller) {
								if (part.type === "error") throw part.error;
								if (part.type === "finish") {
									const counts = [
										part.usage.inputTokens.total,
										part.usage.outputTokens.total,
									];
									if (
										!part.finishReason.raw ||
										!counts.every(
											(count) =>
												typeof count === "number" &&
												Number.isSafeInteger(count) &&
												count >= 0,
										)
									)
										throw new Error(
											"Meta response is incomplete. Final usage requires reconciliation.",
										);
									finished = true;
								}
								controller.enqueue(part);
							},
							flush() {
								if (!finished)
									throw new Error(
										"Meta response is incomplete. Billing requires reconciliation before retrying.",
									);
							},
						}),
					),
				};
			},
		},
	});
}
