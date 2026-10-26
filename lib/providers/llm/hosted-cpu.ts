import { createOpenAI } from "@ai-sdk/openai";
import { generateText, streamText } from "ai";
import type { LLMProvider, LLMRequest } from "./base";
import type { AgentModel } from "./agent-model";

export class HostedCpuLLM implements LLMProvider {
	private model() {
		const baseURL = process.env.FYLMER_CHAT_BASE_URL;
		const modelId = process.env.FYLMER_CHAT_MODEL;
		if (!baseURL || !modelId)
			throw new Error("The staging chat model is not connected.");
		return createOpenAI({ baseURL, apiKey: "hosted-cpu" }).chat(modelId);
	}

	async validate() {
		try {
			await generateText({
				model: this.model(),
				prompt: "Reply OK",
				maxOutputTokens: 8,
			});
			return { ok: true as const };
		} catch {
			return {
				ok: false as const,
				error: "The staging chat model is unavailable.",
			};
		}
	}

	agentModel(): AgentModel {
		const model = this.model();
		return {
			model,
			modelId: model.modelId,
			providerOptions: {},
			cachedPrefix: {},
			costOf: () => 0,
			initialTool: "read_script",
			maxOutputTokens: 2048,
		};
	}

	private request(params: LLMRequest) {
		if (params.referenceImages?.length)
			throw new Error(
				"This CPU chat model cannot inspect images. Use a vision model for visual review.",
			);
		return {
			model: this.model(),
			instructions: params.systemPrompt,
			prompt: params.prompt,
			maxOutputTokens: Math.min(params.maxTokens ?? 4096, 8192),
		};
	}

	async generate(params: LLMRequest) {
		const result = await generateText(this.request(params));
		return {
			output: {
				text: result.text,
				model: result.finalStep.response.modelId,
				usage: {
					inputTokens: result.usage.inputTokens ?? 0,
					outputTokens: result.usage.outputTokens ?? 0,
				},
			},
			costUsd: 0,
		};
	}

	async *stream(params: LLMRequest) {
		const result = streamText(this.request(params));
		for await (const part of result.fullStream) {
			if (part.type === "text-delta") yield { text: part.text, done: false };
			if (part.type === "error")
				throw new Error(
					"The staging chat model could not finish its response.",
				);
		}
		yield { text: "", done: true };
		return 0;
	}
}
