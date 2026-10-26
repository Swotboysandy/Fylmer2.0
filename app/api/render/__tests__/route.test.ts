import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ExportReviewError } from "@/lib/render/reviewed-export";

const reviewed = vi.fn();
const enqueue = vi.fn();
const cloud = vi.fn();
const sessionClient = { session: "owner" };
const session = vi.fn(async () => sessionClient);
vi.mock("@/lib/supabase/server", () => ({ createClient: () => session() }));
vi.mock("@/lib/api/auth", () => ({ getUser: async () => ({ id: "user-1" }) }));
vi.mock("@/lib/api/logger", () => ({
	logger: { error: vi.fn(), warn: vi.fn() },
}));
vi.mock("@/lib/render/reviewed-export", async (original) => ({
	...(await original<typeof import("@/lib/render/reviewed-export")>()),
	getReviewedExport: (...args: unknown[]) => reviewed(...args),
}));
vi.mock("@/lib/render/local-export", async (original) => ({
	...(await original<typeof import("@/lib/render/local-export")>()),
	enqueueLocalExport: (...args: unknown[]) => enqueue(...args),
}));
vi.mock("@remotion/lambda/client", () => ({
	renderMediaOnLambda: (...args: unknown[]) => cloud(...args),
}));
const { POST } = await import("../route");
const projectId = "11111111-1111-4111-8111-111111111111";
const source = {
	projectId,
	approvalHash: "0123456789abcdef0123456789abcdef",
	runId: "22222222-2222-4222-8222-222222222222",
};
const request = (body: unknown) =>
	POST(
		new NextRequest("http://localhost/api/render", {
			method: "POST",
			body: JSON.stringify(body),
		}),
	);
beforeEach(() => {
	vi.clearAllMocks();
	vi.stubEnv("FYLMER_EXPORT_BACKEND", "local");
	vi.stubEnv("FYLMER_STAGING_GENERATION_ENABLED", "0");
	reviewed.mockResolvedValue({ layout: { saved: true }, source });
	enqueue.mockResolvedValue({ renderId: "render", bucketName: "fylmer-local" });
});
afterEach(() => vi.unstubAllEnvs());
it("queues the saved composition and approval identity, not the caller's layout", async () => {
	const response = await request({
		projectId,
		inputProps: { caller: true, runId: "33333333-3333-4333-8333-333333333333" },
		resolution: "480p",
	});
	expect(response.status).toBe(200);
	expect(enqueue).toHaveBeenCalledWith(
		"user-1",
		{ saved: true },
		"480p",
		source,
		{ client: sessionClient, appOrigin: "http://localhost" },
	);
	expect(session).toHaveBeenCalledOnce();
	expect(cloud).not.toHaveBeenCalled();
});
it("does not queue an export when the private-media session cannot be created", async () => {
	session.mockRejectedValueOnce(new Error("Session unavailable"));
	const response = await request({
		projectId,
		inputProps: {},
		resolution: "480p",
	});
	expect(response.status).toBe(500);
	expect(enqueue).not.toHaveBeenCalled();
	expect(cloud).not.toHaveBeenCalled();
});
it("requires a project and cannot start an unreviewed render", async () => {
	expect((await request({ inputProps: {}, resolution: "480p" })).status).toBe(
		400,
	);
	expect(reviewed).not.toHaveBeenCalled();
	reviewed.mockRejectedValue(
		new ExportReviewError("Approve the final cut first."),
	);
	const response = await request({
		projectId,
		inputProps: {},
		resolution: "480p",
	});
	expect(response.status).toBe(409);
	expect(await response.json()).toEqual({
		error: "Approve the final cut first.",
	});
	expect(enqueue).not.toHaveBeenCalled();
	expect(cloud).not.toHaveBeenCalled();
});
it("does not enable paid cloud rendering when the generation switch is off", async () => {
	vi.stubEnv("FYLMER_EXPORT_BACKEND", "cloud");
	expect(
		(await request({ projectId, inputProps: {}, resolution: "480p" })).status,
	).toBe(409);
	expect(cloud).not.toHaveBeenCalled();
});
