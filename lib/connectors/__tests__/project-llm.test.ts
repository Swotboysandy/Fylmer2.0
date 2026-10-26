import { afterEach, describe, expect, it, vi } from "vitest";
import { createProjectLLM } from "../project-llm";

afterEach(() => vi.unstubAllGlobals());

describe.each(["openslop", "anthropic"] as const)(
	"%s project text requests",
	(provider) => {
		const model = {
			provider,
			model: provider === "openslop" ? "Claude Opus 5" : "Claude Haiku 4.5",
		};
		it("sends the canonical project for non-streamed outline and review generation", async () => {
			const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
				Response.json({ text: "outline", model: "model" }),
			);
			vi.stubGlobal("fetch", fetch);
			const connector = createProjectLLM(model, "canonical-project");
			const params = { prompt: "Outline", projectId: "wrong-project" };
			const result = await connector.generate(params);
			expect(result.text).toBe("outline");
			const init = fetch.mock.calls[0]?.[1] as RequestInit;
			expect(JSON.parse(String(init.body))).toMatchObject({
				...model,
				projectId: "canonical-project",
				prompt: "Outline",
			});
		});
		it("sends the same canonical project and abort signal for streamed scripts", async () => {
			const fetch = vi.fn(
				async (_url: string, _init: RequestInit) =>
					new Response(
						'data: {"text":"scene","done":false}\n\ndata: {"text":"","done":true}\n\n',
					),
			);
			vi.stubGlobal("fetch", fetch);
			const controller = new AbortController();
			const connector = createProjectLLM(model, "canonical-project");
			const chunks = [];
			for await (const chunk of connector.stream(
				{ prompt: "Script" },
				controller.signal,
			))
				chunks.push(chunk);
			expect(chunks).toHaveLength(2);
			const init = fetch.mock.calls[0]?.[1];
			expect(init?.signal).toBe(controller.signal);
			expect(JSON.parse(String(init?.body))).toMatchObject({
				...model,
				projectId: "canonical-project",
				stream: true,
			});
		});
	},
);

it("refuses an empty project before attempting a request", () => {
	const fetch = vi.fn();
	vi.stubGlobal("fetch", fetch);
	expect(() =>
		createProjectLLM({ provider: "openslop", model: "Fylmer Chat" }, " "),
	).toThrow("saved project");
	expect(fetch).not.toHaveBeenCalled();
});
