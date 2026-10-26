import { createConnector } from "./factory";
import type { LLMConnector, ModelRef } from "./types";

export function createProjectLLM(
	model: ModelRef,
	projectId: string,
): LLMConnector {
	if (!projectId.trim())
		throw new Error("Choose a saved project before generating text.");
	return createConnector("llm", model, {
		plugins: [
			{
				name: "project-context",
				beforeGenerate: (params) => {
					if (!params || typeof params !== "object")
						throw new Error("Invalid text generation request.");
					return { ...params, projectId };
				},
			},
		],
	});
}
