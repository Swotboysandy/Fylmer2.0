import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ProjectBudgetError } from "@/lib/api/project-budget-error";

const createJob = vi.fn();
const enqueueJob = vi.fn();
const quoteAssetCost = vi.fn();
const review = vi.fn();
vi.mock("@/lib/api/jobs", () => ({
	createJob: (...args: unknown[]) => createJob(...args),
	enqueueJob: (...args: unknown[]) => enqueueJob(...args),
	updateJob: vi.fn(),
	getJob: vi.fn(),
}));
vi.mock("@/lib/api/asset-cost-quote", () => ({
	quoteAssetCost: (...args: unknown[]) => quoteAssetCost(...args),
}));
vi.mock("@/lib/api/auth", () => ({
	getUser: async () => ({ id: "user-1", app_metadata: { api_access: true } }),
}));
vi.mock("@/lib/api/budget", () => ({ refuseOverBudget: async () => null }));
vi.mock("@/lib/api/projects", () => ({ ownsProject: async () => true }));
vi.mock("@/lib/supabase/server", () => ({
	createClient: async () => ({ rpc: () => review() }),
}));
vi.mock("@/lib/api/logger", () => ({
	logger: { error: vi.fn(), warn: vi.fn() },
}));
const { POST } = await import("@/app/api/v1/image/route");
const quote = {
	ceilingUsd: 0.035,
	currency: "USD",
	model: "Seedream 5 Lite",
	provider: "openslop",
	expiresAt: new Date(Date.now() + 60000).toISOString(),
	source: "synthetic",
};
const post = () =>
	POST(
		new NextRequest("http://localhost/api/v1/image", {
			method: "POST",
			body: JSON.stringify({
				projectId: "11111111-1111-4111-8111-111111111111",
				provider: "openslop",
				model: "Seedream 5 Lite",
				prompt: "test",
				costQuote: { ceilingUsd: 0 },
			}),
		}),
	);

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubEnv("FYLMER_STAGING_GENERATION_ENABLED", "1");
	review.mockResolvedValue({
		data: {
			bible: true,
			images: true,
			videos: false,
			finalCut: false,
			imageCount: 1,
			videoCount: 0,
			mode: "autonomous",
			capUsd: 0.07,
		},
		error: null,
	});
	createJob.mockResolvedValue({ id: "job-1" });
	quoteAssetCost.mockResolvedValue(quote);
});
afterEach(() => vi.unstubAllEnvs());

describe("project media budget admission", () => {
	it("reserves the server price, not a client-supplied price", async () => {
		expect((await post()).status).toBe(200);
		expect(createJob).toHaveBeenCalledWith(
			expect.objectContaining({ costQuote: quote }),
		);
		expect(enqueueJob).toHaveBeenCalledWith("job-1");
	});
	it("does not enqueue after an atomic database cap refusal", async () => {
		createJob.mockRejectedValue(new ProjectBudgetError("Project cap exceeded"));
		const response = await post();
		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({ error: "Project cap exceeded" });
		expect(enqueueJob).not.toHaveBeenCalled();
	});
	it("does not create a job without a verified price", async () => {
		quoteAssetCost.mockRejectedValue(
			new ProjectBudgetError("Pricing unavailable"),
		);
		expect((await post()).status).toBe(409);
		expect(createJob).not.toHaveBeenCalled();
	});
	it("does not bypass the workspace generation switch", async () => {
		vi.stubEnv("FYLMER_STAGING_GENERATION_ENABLED", "0");
		expect((await post()).status).toBe(409);
		expect(quoteAssetCost).not.toHaveBeenCalled();
		expect(createJob).not.toHaveBeenCalled();
	});
});
