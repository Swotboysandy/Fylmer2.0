import { beforeEach, expect, it, vi } from "vitest";
import { beginAgentCharge } from "../agent-charge";
import { claimJob, createJob, markProviderStarted, updateJob } from "../jobs";

vi.mock("../jobs", () => ({
	claimJob: vi.fn(),
	createJob: vi.fn(),
	markProviderStarted: vi.fn(),
	updateJob: vi.fn(),
}));
const input: Parameters<typeof beginAgentCharge>[0] = {
	userId: "owner",
	projectId: "project",
	model: { provider: "openslop", model: "model" },
	quote: {
		provider: "openslop",
		model: "model",
		currency: "USD",
		ceilingUsd: 0.1,
		source: "synthetic",
		expiresAt: "2030-01-01T00:00:00Z",
	},
};
beforeEach(() => {
	vi.resetAllMocks();
	vi.mocked(createJob).mockResolvedValue({ id: "charge" });
	vi.mocked(claimJob).mockResolvedValue(true);
	vi.mocked(markProviderStarted).mockResolvedValue();
	vi.mocked(updateJob).mockResolvedValue();
});
it("creates a project-bound pending reservation before recording submission", async () => {
	const charge = await beginAgentCharge(input);
	expect(charge.id).toBe("charge");
	expect(createJob).toHaveBeenCalledWith({
		userId: "owner",
		projectId: "project",
		connectorType: "llm",
		request: input.model,
		status: "pending",
		costQuote: input.quote,
	});
	expect(claimJob).toHaveBeenCalledWith("charge");
	expect(markProviderStarted).toHaveBeenCalledWith("charge");
	expect(vi.mocked(createJob).mock.invocationCallOrder[0]).toBeLessThan(
		vi.mocked(claimJob).mock.invocationCallOrder[0],
	);
	expect(vi.mocked(claimJob).mock.invocationCallOrder[0]).toBeLessThan(
		vi.mocked(markProviderStarted).mock.invocationCallOrder[0],
	);
});
it("does not submit a model call when reservation admission fails", async () => {
	vi.mocked(createJob).mockRejectedValue(new Error("Project cap exceeded"));
	await expect(beginAgentCharge(input)).rejects.toThrow("Project cap exceeded");
	expect(claimJob).not.toHaveBeenCalled();
	expect(markProviderStarted).not.toHaveBeenCalled();
});
it("releases an admission failure before transmission through the existing job lifecycle", async () => {
	vi.mocked(markProviderStarted).mockRejectedValue(new Error("Price expired"));
	await expect(beginAgentCharge(input)).rejects.toThrow("Price expired");
	expect(updateJob).toHaveBeenCalledWith(
		"charge",
		expect.objectContaining({ status: "failed" }),
	);
});
it("does not fail a reservation already claimed by another executor", async () => {
	vi.mocked(claimJob).mockResolvedValue(false);
	await expect(beginAgentCharge(input)).rejects.toThrow("could not be claimed");
	expect(markProviderStarted).not.toHaveBeenCalled();
	expect(updateJob).not.toHaveBeenCalled();
});
it("settles the same row with known cost and provider metadata", async () => {
	const charge = await beginAgentCharge(input);
	await charge.settle({
		costUsd: 0.03,
		modelId: "actual-model",
		tokenUsage: { inputTokens: 12, outputTokens: 7 },
	});
	expect(createJob).toHaveBeenCalledTimes(1);
	expect(updateJob).toHaveBeenCalledWith("charge", {
		status: "completed",
		cost_usd: 0.03,
		metadata: {
			modelId: "actual-model",
			tokenUsage: { inputTokens: 12, outputTokens: 7 },
		},
	});
});
it.each([undefined, NaN, Infinity, -1])(
	"never replaces an unknown or invalid cost (%s) with zero",
	async (costUsd) => {
		const charge = await beginAgentCharge(input);
		await charge.settle({
			costUsd,
			modelId: "actual-model",
			tokenUsage: { inputTokens: null, outputTokens: null },
		});
		expect(vi.mocked(updateJob).mock.lastCall?.[1]).not.toHaveProperty(
			"cost_usd",
		);
	},
);
it("keeps a failed submitted call for billing review rather than releasing it", async () => {
	const charge = await beginAgentCharge(input);
	await charge.fail();
	expect(updateJob).toHaveBeenCalledWith(
		"charge",
		expect.objectContaining({ status: "failed" }),
	);
	expect(vi.mocked(updateJob).mock.lastCall?.[1]).not.toHaveProperty(
		"cost_usd",
	);
});
