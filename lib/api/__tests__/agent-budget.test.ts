import { beforeEach, expect, it, vi } from "vitest";
import type { AgentModel } from "@/lib/providers/llm/agent-model";
import type { LanguageModelUsage } from "ai";

const mocks = vi.hoisted(() => ({
	rpc: vi.fn(),
	quote: vi.fn(),
	begin: vi.fn(),
	settle: vi.fn(),
	fail: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
	createClient: async () => ({ rpc: mocks.rpc }),
}));
vi.mock("../agent-cost-quote", () => ({ quoteAgentCost: mocks.quote }));
vi.mock("../agent-charge", () => ({ beginAgentCharge: mocks.begin }));
import { admitAgentBudget } from "../agent-budget";

const review = {
	capUsd: 1,
	mode: "directed",
	bible: false,
	images: false,
	videos: false,
	finalCut: false,
	imageCount: 0,
	videoCount: 0,
};
const input = {
	userId: "owner",
	projectId: "project",
	picked: { provider: "anthropic" as const, model: "Claude Haiku 4.5" },
};
const costOf = vi.fn(() => 0.1);
const agent = {
	model: "test",
	modelId: "claude-haiku-4-5-20251001",
	maxOutputTokens: 64000,
	providerOptions: {},
	cachedPrefix: {},
	costOf,
} satisfies AgentModel;
const usage = {
	inputTokens: 12,
	outputTokens: 7,
	totalTokens: 19,
	inputTokenDetails: {
		noCacheTokens: 12,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
	},
	outputTokenDetails: { textTokens: 7, reasoningTokens: 0 },
} as LanguageModelUsage;

beforeEach(() => {
	vi.clearAllMocks();
	mocks.rpc.mockResolvedValue({ data: review, error: null });
	mocks.quote.mockReturnValue({ ceilingUsd: 0.5 });
	mocks.begin.mockResolvedValue({ settle: mocks.settle, fail: mocks.fail });
	mocks.settle.mockResolvedValue(undefined);
	mocks.fail.mockResolvedValue(undefined);
});

it("reserves the canonical project before returning an admitted model", async () => {
	const budget = await admitAgentBudget(input, agent);
	expect(mocks.rpc).toHaveBeenCalledWith("film_workflow", {
		p_project_id: "project",
		p_action: "read",
	});
	expect(mocks.begin).toHaveBeenCalledWith(
		expect.objectContaining({
			userId: "owner",
			projectId: "project",
			model: input.picked,
			quote: { ceilingUsd: 0.5 },
		}),
	);
	await budget?.settle(usage);
	expect(mocks.settle).toHaveBeenCalledWith({
		costUsd: 0.1,
		modelId: agent.modelId,
		tokenUsage: { inputTokens: 12, outputTokens: 7 },
	});
});
it("retains legacy uncapped Directed behavior", async () => {
	mocks.rpc.mockResolvedValue({
		data: { ...review, capUsd: null },
		error: null,
	});
	expect(await admitAgentBudget(input, agent)).toBeNull();
	expect(mocks.begin).not.toHaveBeenCalled();
});
it("refuses Autonomous without a cap", async () => {
	mocks.rpc.mockResolvedValue({
		data: { ...review, mode: "autonomous", capUsd: null },
		error: null,
	});
	await expect(admitAgentBudget(input, agent)).rejects.toThrow("spending cap");
	expect(mocks.begin).not.toHaveBeenCalled();
});
it("fails closed when canonical budget lookup fails", async () => {
	mocks.rpc.mockResolvedValue({ data: null, error: { message: "offline" } });
	await expect(admitAgentBudget(input, agent)).rejects.toThrow(
		"Could not verify",
	);
	expect(mocks.begin).not.toHaveBeenCalled();
});
it("does not replace missing detailed usage with a zero charge", async () => {
	const budget = await admitAgentBudget(input, agent);
	await budget?.settle({
		...usage,
		inputTokenDetails: {
			noCacheTokens: undefined,
			cacheReadTokens: undefined,
			cacheWriteTokens: undefined,
		},
	});
	expect(costOf).not.toHaveBeenCalled();
	expect(mocks.settle).toHaveBeenCalledWith(
		expect.objectContaining({ costUsd: undefined }),
	);
});
it("preserves a failed submission even if a finish callback arrives later", async () => {
	const budget = await admitAgentBudget(input, agent);
	await budget?.fail();
	await budget?.settle(usage);
	await budget?.fail();
	expect(mocks.fail).toHaveBeenCalledTimes(1);
	expect(mocks.settle).not.toHaveBeenCalled();
});
it("keeps inconsistent input accounting unknown instead of underbilling", async () => {
	const budget = await admitAgentBudget(input, agent);
	await budget?.settle({
		...usage,
		inputTokenDetails: {
			noCacheTokens: 1,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		},
	});
	expect(costOf).not.toHaveBeenCalled();
	expect(mocks.settle).toHaveBeenCalledWith(
		expect.objectContaining({ costUsd: undefined }),
	);
});
it("settles a validated generic provider cost once without inventing token totals", async () => {
	const budget = await admitAgentBudget(input, agent);
	await budget?.settleCost(0.12);
	await budget?.settleCost(0.15);
	await budget?.fail();
	expect(mocks.settle).toHaveBeenCalledExactlyOnceWith({
		costUsd: 0.12,
		modelId: agent.modelId,
		tokenUsage: { inputTokens: null, outputTokens: null },
	});
	expect(mocks.fail).not.toHaveBeenCalled();
});
