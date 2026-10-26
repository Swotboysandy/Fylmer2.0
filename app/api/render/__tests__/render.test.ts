import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetUser = vi.fn();
vi.mock("@/lib/api/auth", () => ({ getUser: () => mockGetUser() }));
const mockRenderMediaOnLambda = vi.fn();
vi.mock("@remotion/lambda/client", () => ({
	renderMediaOnLambda: (...args: unknown[]) => mockRenderMediaOnLambda(...args),
	speculateFunctionName: () => "remotion-render-fn",
}));
const mockReviewedExport = vi.fn();
vi.mock("@/lib/render/reviewed-export", async (original) => ({
	...(await original<typeof import("@/lib/render/reviewed-export")>()),
	getReviewedExport: (...args: unknown[]) => mockReviewedExport(...args),
}));
vi.mock("@/lib/api/logger", () => ({
	logger: { error: vi.fn(), warn: vi.fn() },
}));
const { POST } = await import("@/app/api/render/route");
const projectId = "11111111-1111-4111-8111-111111111111";

function makeRequest(body: unknown) {
	return new NextRequest(new URL("/api/render", "http://localhost:3000"), {
		method: "POST",
		body: JSON.stringify(body),
	});
}

describe("POST /api/render", () => {
	afterEach(() => vi.unstubAllEnvs());
	beforeEach(() => {
		vi.stubEnv("FYLMER_STAGING_GENERATION_ENABLED", "1");
		vi.stubEnv("FYLMER_EXPORT_BACKEND", "cloud");
		vi.clearAllMocks();
		mockGetUser.mockResolvedValue({ id: "user-1" });
		mockReviewedExport.mockResolvedValue({
			layout: { saved: true },
			source: { projectId, approvalHash: "0123456789abcdef0123456789abcdef" },
		});
	});
	it("returns 401 when unauthenticated", async () => {
		mockGetUser.mockResolvedValue(null);
		const response = await POST(
			makeRequest({ projectId, inputProps: {}, resolution: "720p" }),
		);
		expect(response.status).toBe(401);
		expect(mockReviewedExport).not.toHaveBeenCalled();
	});
	it("returns 400 for an invalid body", async () => {
		const response = await POST(
			makeRequest({
				projectId,
				inputProps: "not-an-object",
				resolution: "720p",
			}),
		);
		expect(response.status).toBe(400);
		expect(mockReviewedExport).not.toHaveBeenCalled();
	});
	it("returns 400 for a resolution outside the presets", async () => {
		const response = await POST(
			makeRequest({ projectId, inputProps: { scenes: [] }, resolution: "8K" }),
		);
		expect(response.status).toBe(400);
		expect(mockRenderMediaOnLambda).not.toHaveBeenCalled();
	});
	it("returns 400 without a resolution", async () => {
		const response = await POST(
			makeRequest({ projectId, inputProps: { scenes: [] } }),
		);
		expect(response.status).toBe(400);
		expect(mockRenderMediaOnLambda).not.toHaveBeenCalled();
	});
	it("renders the approved saved composition at the preset scale", async () => {
		mockRenderMediaOnLambda.mockResolvedValue({
			renderId: "render-1",
			bucketName: "bucket-1",
		});
		const response = await POST(
			makeRequest({
				projectId,
				inputProps: { preview: true },
				resolution: "4K",
			}),
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			renderId: "render-1",
			bucketName: "bucket-1",
		});
		expect(mockReviewedExport).toHaveBeenCalledWith(projectId, {
			preview: true,
		});
		expect(mockRenderMediaOnLambda).toHaveBeenCalledWith(
			expect.objectContaining({
				codec: "h264",
				functionName: "remotion-render-fn",
				inputProps: { saved: true },
				scale: 2,
			}),
		);
	});
});
