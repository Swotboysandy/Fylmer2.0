import { afterEach, describe, expect, it, vi } from "vitest";
import { generateText, jsonSchema, stepCountIs, tool } from "ai";
import {
	createMetaLanguageModel,
	META_SPARK_MODEL_ID,
	metaProviderOptions,
} from "../llm/meta-model";

afterEach(() => vi.unstubAllGlobals());

const prompt = [
	{
		role: "user" as const,
		content: [{ type: "text" as const, text: "Read the saved film script." }],
	},
];
function response(content: unknown[], stopReason = "end_turn") {
	return Response.json({
		id: "msg_fixture",
		type: "message",
		role: "assistant",
		model: META_SPARK_MODEL_ID,
		content,
		stop_reason: stopReason,
		stop_sequence: null,
		usage: { input_tokens: 20, output_tokens: 10, cache_read_input_tokens: 0 },
	});
}

describe("Meta Messages wire adapter", () => {
	it.each(["thinking", "redacted_thinking"])(
		"replays %s and canonical script tool results across director turns",
		async (kind) => {
			const reasoning =
				kind === "thinking"
					? {
							type: "thinking",
							thinking: "Read the canonical script first.",
							signature: "synthetic-signature",
						}
					: { type: "redacted_thinking", data: "synthetic-encrypted-context" };
			const transport = vi
				.fn()
				.mockResolvedValueOnce(
					response(
						[
							reasoning,
							{
								type: "tool_use",
								id: "read-canonical",
								name: "read_script",
								input: {},
							},
						],
						"tool_use",
					),
				)
				.mockResolvedValueOnce(
					response([{ type: "text", text: "Mira waits at the transmitter." }]),
				);
			vi.stubGlobal("fetch", transport);
			const readScript = vi
				.fn()
				.mockResolvedValue({
					title: "The Last Signal",
					characters: ["Mira"],
					sceneId: "scene-canonical",
				});
			const result = await generateText({
				model: createMetaLanguageModel(
					"synthetic-meta-key",
					META_SPARK_MODEL_ID,
				),
				messages: prompt,
				maxOutputTokens: 1024,
				maxRetries: 0,
				providerOptions: metaProviderOptions("high"),
				stopWhen: stepCountIs(2),
				tools: {
					read_script: tool({
						description: "Read saved canonical Film Bible",
						inputSchema: jsonSchema<Record<string, never>>({
							type: "object",
							properties: {},
							additionalProperties: false,
						}),
						execute: readScript,
					}),
				},
			});
			expect(result.text).toBe("Mira waits at the transmitter.");
			expect(readScript).toHaveBeenCalledTimes(1);
			expect(transport).toHaveBeenCalledTimes(2);
			const replay = JSON.parse(transport.mock.calls[1][1].body);
			const blocks = replay.messages.flatMap(
				(message: { content: unknown[] }) => message.content,
			);
			expect(blocks).toContainEqual(expect.objectContaining(reasoning));
			expect(blocks).toContainEqual(
				expect.objectContaining({
					type: "tool_use",
					id: "read-canonical",
					name: "read_script",
				}),
			);
			expect(blocks).toContainEqual(
				expect.objectContaining({
					type: "tool_result",
					tool_use_id: "read-canonical",
					content: expect.stringContaining("scene-canonical"),
				}),
			);
		},
	);
	it.each([false, true])(
		"rejects missing final usage even with a closing event: %s",
		async (hasClosingEvent) => {
			const events = [
				{
					type: "message_start",
					message: {
						id: "msg_fixture",
						type: "message",
						role: "assistant",
						model: META_SPARK_MODEL_ID,
						content: [],
						stop_reason: null,
						stop_sequence: null,
						usage: { input_tokens: 20, output_tokens: 0 },
					},
				},
				{
					type: "content_block_start",
					index: 0,
					content_block: { type: "text", text: "" },
				},
				{
					type: "content_block_delta",
					index: 0,
					delta: { type: "text_delta", text: "Unfinished film" },
				},
				...(hasClosingEvent ? [{ type: "message_stop" }] : []),
			];
			vi.stubGlobal(
				"fetch",
				vi
					.fn()
					.mockResolvedValue(
						new Response(
							events
								.map(
									(event) =>
										`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
								)
								.join(""),
							{ headers: { "Content-Type": "text/event-stream" } },
						),
					),
			);
			const result = await createMetaLanguageModel(
				"synthetic-meta-key",
				META_SPARK_MODEL_ID,
			).doStream({ prompt, maxOutputTokens: 1024 });
			const consume = async () => {
				const reader = result.stream.getReader();
				try {
					while (!(await reader.read()).done) {}
				} finally {
					reader.releaseLock();
				}
			};
			await expect(consume()).rejects.toThrow("incomplete");
		},
	);
	it("propagates cancellation to the transport without retrying", async () => {
		const controller = new AbortController();
		const transport = vi.fn().mockImplementation(
			(_url, init) =>
				new Promise((_resolve, reject) => {
					init.signal.addEventListener(
						"abort",
						() => reject(new DOMException("Cancelled", "AbortError")),
						{ once: true },
					);
					controller.abort();
				}),
		);
		vi.stubGlobal("fetch", transport);
		await expect(
			createMetaLanguageModel(
				"synthetic-meta-key",
				META_SPARK_MODEL_ID,
			).doStream({
				prompt,
				maxOutputTokens: 1024,
				abortSignal: controller.signal,
			}),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(transport).toHaveBeenCalledTimes(1);
		expect(transport.mock.calls[0][1].signal.aborted).toBe(true);
	});
	it("rejects revoked credentials without silently falling back to another model", async () => {
		const transport = vi
			.fn()
			.mockResolvedValue(
				Response.json(
					{
						type: "error",
						error: { type: "authentication_error", message: "Invalid API key" },
					},
					{ status: 401 },
				),
			);
		vi.stubGlobal("fetch", transport);
		await expect(
			createMetaLanguageModel(
				"synthetic-meta-key",
				META_SPARK_MODEL_ID,
			).doGenerate({ prompt, maxOutputTokens: 1024 }),
		).rejects.toMatchObject({ statusCode: 401 });
		expect(transport).toHaveBeenCalledTimes(1);
	});
	it("uses native JSON output and maps maximum effort without forced tool choice", async () => {
		const transport = vi
			.fn()
			.mockResolvedValue(
				response([{ type: "text", text: '{"title":"Film"}' }]),
			);
		vi.stubGlobal("fetch", transport);
		await createMetaLanguageModel(
			"synthetic-meta-key",
			META_SPARK_MODEL_ID,
		).doGenerate({
			prompt,
			maxOutputTokens: 1024,
			providerOptions: metaProviderOptions("max"),
			responseFormat: {
				type: "json",
				schema: {
					type: "object",
					properties: { title: { type: "string" } },
					required: ["title"],
					additionalProperties: false,
				},
			},
		});
		const body = JSON.parse(transport.mock.calls[0][1].body);
		expect(body.thinking).toEqual({ type: "adaptive", display: "summarized" });
		expect(body.output_config).toMatchObject({
			effort: "xhigh",
			format: { type: "json_schema" },
		});
		expect(body.tool_choice).toBeUndefined();
		expect(body.stop_sequences).toBeUndefined();
	});
	it("streams text and final usage through the actual SDK", async () => {
		const events = [
			{
				type: "message_start",
				message: {
					id: "msg_fixture",
					type: "message",
					role: "assistant",
					model: META_SPARK_MODEL_ID,
					content: [],
					stop_reason: null,
					stop_sequence: null,
					usage: {
						input_tokens: 20,
						output_tokens: 0,
						cache_read_input_tokens: 0,
					},
				},
			},
			{
				type: "content_block_start",
				index: 0,
				content_block: { type: "text", text: "" },
			},
			{
				type: "content_block_delta",
				index: 0,
				delta: { type: "text_delta", text: "Film ready." },
			},
			{ type: "content_block_stop", index: 0 },
			{
				type: "message_delta",
				delta: { stop_reason: "end_turn", stop_sequence: null },
				usage: { output_tokens: 10 },
			},
			{ type: "message_stop" },
		];
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(
					new Response(
						events
							.map(
								(event) =>
									`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
							)
							.join(""),
						{ headers: { "Content-Type": "text/event-stream" } },
					),
				),
		);
		const result = await createMetaLanguageModel(
			"synthetic-meta-key",
			META_SPARK_MODEL_ID,
		).doStream({
			prompt,
			maxOutputTokens: 1024,
			providerOptions: metaProviderOptions("medium"),
		});
		const parts = [];
		const reader = result.stream.getReader();
		try {
			while (true) {
				const chunk = await reader.read();
				if (chunk.done) break;
				parts.push(chunk.value);
			}
		} finally {
			reader.releaseLock();
		}
		expect(parts).toContainEqual(
			expect.objectContaining({ type: "text-delta", delta: "Film ready." }),
		);
		expect(parts).toContainEqual(
			expect.objectContaining({
				type: "finish",
				usage: expect.objectContaining({
					inputTokens: expect.objectContaining({ total: 20 }),
					outputTokens: expect.objectContaining({ total: 10 }),
				}),
			}),
		);
	});
	it("rejects missing usage rather than manufacturing free generation", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(
					Response.json({
						id: "msg_fixture",
						type: "message",
						role: "assistant",
						model: META_SPARK_MODEL_ID,
						content: [{ type: "text", text: "Film" }],
						stop_reason: "end_turn",
						stop_sequence: null,
					}),
				),
		);
		await expect(
			createMetaLanguageModel(
				"synthetic-meta-key",
				META_SPARK_MODEL_ID,
			).doGenerate({ prompt, maxOutputTokens: 1024 }),
		).rejects.toThrow();
	});
	it("uses the real SDK with Meta bearer auth and standard model identity", async () => {
		const transport = vi
			.fn()
			.mockResolvedValue(
				response([{ type: "text", text: "Saved film read." }]),
			);
		vi.stubGlobal("fetch", transport);
		const model = createMetaLanguageModel(
			"synthetic-meta-key",
			META_SPARK_MODEL_ID,
		);
		const result = await model.doGenerate({ prompt, maxOutputTokens: 1024 });
		const [url, init] = transport.mock.calls[0];
		expect(String(url)).toBe("https://api.meta.ai/v1/messages");
		const headers = new Headers(init.headers);
		expect(headers.get("authorization")).toBe("Bearer synthetic-meta-key");
		expect(headers.has("x-api-key")).toBe(false);
		expect(JSON.parse(init.body)).toMatchObject({
			model: META_SPARK_MODEL_ID,
			max_tokens: 1024,
		});
		expect(model.provider).toBe("meta.messages");
		expect(result.content).toContainEqual({
			type: "text",
			text: "Saved film read.",
		});
		expect(result.usage.inputTokens.total).toBe(20);
		expect(result.usage.outputTokens.total).toBe(10);
	});
	it("preserves native director tool calls without executing tools or another request", async () => {
		const transport = vi.fn().mockResolvedValue(
			response(
				[
					{
						type: "tool_use",
						id: "tool_fixture",
						name: "read_script",
						input: {},
					},
				],
				"tool_use",
			),
		);
		vi.stubGlobal("fetch", transport);
		const model = createMetaLanguageModel(
			"synthetic-meta-key",
			META_SPARK_MODEL_ID,
		);
		const result = await model.doGenerate({
			prompt,
			maxOutputTokens: 1024,
			tools: [
				{
					type: "function",
					name: "read_script",
					description: "Read the canonical project script",
					inputSchema: { type: "object", properties: {} },
				},
			],
			toolChoice: { type: "auto" },
		});
		expect(result.content).toContainEqual(
			expect.objectContaining({
				type: "tool-call",
				toolCallId: "tool_fixture",
				toolName: "read_script",
				input: "{}",
			}),
		);
		expect(result.finishReason.unified).toBe("tool-calls");
		expect(transport).toHaveBeenCalledTimes(1);
	});
	it.each(["muse-spark-1.3-contributor", "claude-opus-5", "unknown"])(
		"rejects unsupported or training-opt-in model %s before any request",
		(modelId) => {
			const transport = vi.fn();
			vi.stubGlobal("fetch", transport);
			expect(() =>
				createMetaLanguageModel("synthetic-meta-key", modelId),
			).toThrow("not supported");
			expect(transport).not.toHaveBeenCalled();
		},
	);
	it("rejects missing credentials instead of falling back to environment credentials", () => {
		expect(() => createMetaLanguageModel(" ", META_SPARK_MODEL_ID)).toThrow(
			"Connect a Meta",
		);
	});
});
