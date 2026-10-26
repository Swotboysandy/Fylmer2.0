import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";
import { z } from "zod";
import type { ModelRef } from "@/lib/connectors/types";
import type { AgentTurnRequest } from "../agent-turn";
import type { RouteFamily } from "../route-families";

const mocks = vi.hoisted(() => ({
	owns: vi.fn(),
	parseMessage: vi.fn(),
	admit: vi.fn(),
	turn: vi.fn(),
	provider: vi.fn(),
	spend: vi.fn(),
}));
vi.mock("../with-auth", () => {
	const auth = async (
		_label: string,
		handle: (user: User) => Promise<Response>,
	) => handle({ id: "signed-in-owner" } as User);
	return {
		withApiAccess: auth,
		withHostedBudget: auth,
		withSession: auth,
		withPublic: async (_label: string, handle: () => Promise<Response>) =>
			handle(),
	};
});
vi.mock("../projects", () => ({ ownsProject: mocks.owns }));
vi.mock("@/lib/agent/messages", () => ({
	parseSloppyMessage: mocks.parseMessage,
}));
vi.mock("../agent-budget", () => ({ admitAgentBudget: mocks.admit }));
vi.mock("../agent-turn", () => ({
	agentTurnSchema: (model: z.ZodType) =>
		z.object({ projectId: z.uuid(), message: z.unknown() }).and(model),
	streamAgentTurn: mocks.turn,
}));
import { createAgentRouteHandler, createLLMRouteHandler } from "../llm-routes";
import {
	createHostedRouteHandler,
	createSessionRouteHandler,
} from "../route-handler";

const projectId = "10000000-0000-4000-8000-000000000001";
const message = {
	id: "message",
	role: "user" as const,
	parts: [{ type: "text" as const, text: "Make a film" }],
};
const agent = {
	model: "test-model",
	modelId: "claude-haiku-4-5-20251001",
	maxOutputTokens: 64000,
	providerOptions: {},
	cachedPrefix: {},
	costOf: () => 0.1,
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.owns.mockResolvedValue(true);
	mocks.parseMessage.mockResolvedValue(message);
	mocks.admit.mockResolvedValue(null);
	mocks.provider.mockResolvedValue({
		agentModel: (modelId: string) => ({ ...agent, modelId }),
	});
	mocks.turn.mockImplementation(async (request: AgentTurnRequest) => {
		const llm = await request.llm();
		await request.admitBudget?.(llm.agentModel(request.model));
		return new Response("stream admitted");
	});
});

describe.each(["hosted", "byok"] as const)("%s agent route", (kind) => {
	const provider = kind === "hosted" ? "openslop" : "anthropic";
	const model = kind === "hosted" ? "Claude Opus 5" : "Claude Haiku 4.5";
	const family = {
		createHandler:
			kind === "hosted" ? createHostedRouteHandler : createSessionRouteHandler,
		model: () =>
			z.object({ provider: z.literal(provider), model: z.literal(model) }),
		providerFor: mocks.provider,
		recordSpend: mocks.spend,
	} as unknown as RouteFamily<ModelRef>;
	const route = createAgentRouteHandler(family);
	const generate = createLLMRouteHandler(family);
	const request = (overrides = {}) =>
		new NextRequest("http://localhost/api/agent", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				projectId,
				message,
				provider,
				model,
				...overrides,
			}),
		});

	it("binds admission to the session owner and canonical project, not body credentials", async () => {
		expect((await route(request({ userId: "attacker" }))).status).toBe(200);
		expect(mocks.admit).toHaveBeenCalledWith(
			{
				userId: "signed-in-owner",
				projectId,
				picked: expect.objectContaining({ provider, model }),
			},
			{
				...agent,
				modelId: kind === "hosted" ? "claude-opus-5" : agent.modelId,
			},
		);
		expect(mocks.provider).toHaveBeenCalledWith(
			"signed-in-owner",
			"llm",
			expect.objectContaining({ projectId }),
		);
		expect(mocks.spend).not.toHaveBeenCalled();
	});
	it("rejects another owner's project before resolving a provider", async () => {
		mocks.owns.mockResolvedValue(false);
		expect((await route(request())).status).toBe(404);
		expect(mocks.provider).not.toHaveBeenCalled();
		expect(mocks.admit).not.toHaveBeenCalled();
	});
	it("also rejects another owner's project on generic generation before any provider call", async () => {
		mocks.owns.mockResolvedValue(false);
		expect((await generate(request({ prompt: "Write the film" }))).status).toBe(
			404,
		);
		expect(mocks.provider).not.toHaveBeenCalled();
		expect(mocks.spend).not.toHaveBeenCalled();
	});
	it("rejects an invalid message before resolving a provider", async () => {
		mocks.parseMessage.mockResolvedValue(null);
		expect((await route(request())).status).toBe(400);
		expect(mocks.provider).not.toHaveBeenCalled();
	});
	it("does not swallow a budget denial", async () => {
		mocks.admit.mockRejectedValue(new Error("Project cap exhausted"));
		await expect(route(request())).rejects.toThrow("Project cap exhausted");
		expect(mocks.spend).not.toHaveBeenCalled();
	});
	it("rejects a malformed project before looking it up", async () => {
		expect((await route(request({ projectId: "not-a-project" }))).status).toBe(
			400,
		);
		expect(mocks.owns).not.toHaveBeenCalled();
		expect(mocks.admit).not.toHaveBeenCalled();
	});
	it("finishes generic stream accounting after the browser disconnects", async () => {
		const release = Promise.withResolvers<void>();
		async function* stream() {
			yield { text: "start", done: false };
			await release.promise;
			yield { text: "finish", done: true };
			return 0.42;
		}
		mocks.provider.mockResolvedValueOnce({ stream, agentModel: () => agent });
		const response = await generate(
			request({ prompt: "Write the film", stream: true }),
		);
		const reader = response.body?.getReader();
		await reader?.read();
		await reader?.cancel();
		expect(mocks.spend).not.toHaveBeenCalled();
		release.resolve();
		await vi.waitFor(() =>
			expect(mocks.spend).toHaveBeenCalledWith(
				"signed-in-owner",
				expect.objectContaining({ projectId, provider, model }),
				0.42,
			),
		);
	});
	it("requires project context for generic text generation", async () => {
		expect(
			(
				await generate(
					request({ prompt: "Write the film", projectId: undefined }),
				)
			).status,
		).toBe(400);
		expect(mocks.provider).not.toHaveBeenCalled();
	});
	it("settles a capped stream after disconnect without duplicate legacy booking", async () => {
		const release = Promise.withResolvers<void>();
		const settleCost = vi.fn(async () => {});
		const fail = vi.fn(async () => {});
		async function* stream() {
			yield { text: "start", done: false };
			await release.promise;
			yield { text: "finish", done: true };
			return 0.12;
		}
		mocks.admit.mockResolvedValueOnce({
			maxOutputTokens: 2048,
			settleCost,
			fail,
		});
		mocks.provider.mockResolvedValueOnce({ stream, agentModel: () => agent });
		const response = await generate(
			request({ prompt: "Write the film", stream: true }),
		);
		const reader = response.body?.getReader();
		await reader?.read();
		await reader?.cancel();
		release.resolve();
		await vi.waitFor(() =>
			expect(settleCost).toHaveBeenCalledExactlyOnceWith(0.12),
		);
		expect(mocks.spend).not.toHaveBeenCalled();
		expect(fail).not.toHaveBeenCalled();
	});
	it("marks a failed generic stream for reconciliation instead of settling", async () => {
		const settleCost = vi.fn();
		const fail = vi.fn(async () => {});
		async function* stream(): AsyncGenerator<
			{ text: string; done: boolean },
			number
		> {
			yield { text: "start", done: false };
			throw new Error("Stream failed");
		}
		mocks.admit.mockResolvedValueOnce({
			maxOutputTokens: 2048,
			settleCost,
			fail,
		});
		mocks.provider.mockResolvedValueOnce({ stream, agentModel: () => agent });
		const response = await generate(
			request({ prompt: "Write the film", stream: true }),
		);
		await expect(response.text()).rejects.toThrow("Stream failed");
		expect(fail).toHaveBeenCalledTimes(1);
		expect(settleCost).not.toHaveBeenCalled();
	});
	it("settles a capped generic request once without legacy booking", async () => {
		const settleCost = vi.fn(async () => {});
		const fail = vi.fn(async () => {});
		const generateText = vi.fn(async () => ({
			output: { text: "film" },
			costUsd: 0.12,
		}));
		mocks.admit.mockResolvedValueOnce({
			maxOutputTokens: 2048,
			settleCost,
			fail,
		});
		mocks.provider.mockResolvedValueOnce({
			generate: generateText,
			agentModel: () => agent,
		});
		expect((await generate(request({ prompt: "Write the film" }))).status).toBe(
			200,
		);
		expect(generateText).toHaveBeenCalledWith(
			expect.objectContaining({ maxTokens: 2048 }),
		);
		expect(settleCost).toHaveBeenCalledExactlyOnceWith(0.12);
		expect(mocks.spend).not.toHaveBeenCalled();
		expect(fail).not.toHaveBeenCalled();
	});
	it("does not transmit generic text when admission rejects", async () => {
		const generateText = vi.fn();
		mocks.admit.mockRejectedValueOnce(new Error("Cap exhausted"));
		mocks.provider.mockResolvedValueOnce({
			generate: generateText,
			agentModel: () => agent,
		});
		await expect(
			generate(request({ prompt: "Write the film" })),
		).rejects.toThrow("Cap exhausted");
		expect(generateText).not.toHaveBeenCalled();
	});
	it("retains the reserved charge for reconciliation when generic generation fails", async () => {
		const settleCost = vi.fn();
		const fail = vi.fn(async () => {});
		mocks.admit.mockResolvedValueOnce({
			maxOutputTokens: 2048,
			settleCost,
			fail,
		});
		mocks.provider.mockResolvedValueOnce({
			generate: async () => {
				throw new Error("Provider failed");
			},
			agentModel: () => agent,
		});
		await expect(
			generate(request({ prompt: "Write the film" })),
		).rejects.toThrow("Provider failed");
		expect(fail).toHaveBeenCalledTimes(1);
		expect(settleCost).not.toHaveBeenCalled();
		expect(mocks.spend).not.toHaveBeenCalled();
	});
});
