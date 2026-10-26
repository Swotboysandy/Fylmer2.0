import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const user = vi.fn();
const rpc = vi.fn();
const resolveProvider = vi.fn();
vi.mock("@/lib/api/route-families", () => ({
	providerForPick: (...args: unknown[]) => resolveProvider(...args),
}));
const projectQuery = {
	from: vi.fn(),
	select: vi.fn(),
	eq: vi.fn(),
	single: vi.fn(),
};
vi.mock("@/lib/api/auth", () => ({ getUser: () => user() }));
vi.mock("@/lib/supabase/server", () => ({
	createClient: async () => ({ rpc, from: projectQuery.from }),
}));
vi.mock("@/lib/api/logger", () => ({
	logger: { error: vi.fn(), warn: vi.fn() },
}));
const { POST } = await import("../route");
const ownerId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
const saved = {
	id: runId,
	project_id: projectId,
	user_id: ownerId,
	mode: "directed",
	status: "paused",
	coordinator_stop: "images_review",
	updated_at: "2026-10-23T10:00:00Z",
	plan: { private: true },
};
const request = (body: unknown) =>
	POST(
		new NextRequest("http://localhost/api/film-run", {
			method: "POST",
			body: JSON.stringify(body),
		}),
	);
beforeEach(() => {
	vi.clearAllMocks();
	resolveProvider.mockResolvedValue({});
	user.mockResolvedValue({ id: ownerId });
	rpc.mockResolvedValue({ data: saved, error: null });
	for (const name of ["from", "select", "eq"] as const)
		projectQuery[name].mockReturnValue(projectQuery);
	projectQuery.single.mockResolvedValue({
		data: {
			script: '<image id="shot">A lighthouse.</image>',
			store: {},
			generation: {},
		},
		error: null,
	});
	vi.stubEnv("FYLMER_STAGING_GENERATION_ENABLED", "0");
	vi.stubEnv("FYLMER_FILM_COORDINATOR_ENABLED", "0");
});
afterEach(() => vi.unstubAllEnvs());
it("requires a session before database access", async () => {
	user.mockResolvedValue(null);
	expect((await request({ projectId, action: "read" })).status).toBe(401);
	expect(rpc).not.toHaveBeenCalled();
});
it("rejects a missing model connection before creating a run without exposing vault errors", async () => {
	vi.stubEnv("FYLMER_STAGING_GENERATION_ENABLED", "1");
	vi.stubEnv("FYLMER_FILM_COORDINATOR_ENABLED", "1");
	resolveProvider.mockRejectedValueOnce(new Error("private vault failure"));
	const response = await request({ projectId, action: "start", runId });
	expect(response.status).toBe(409);
	const body = await response.json();
	expect(body.error).toContain("connection is unavailable");
	expect(body.error).not.toContain("vault");
	expect(rpc).not.toHaveBeenCalled();
	expect(resolveProvider).toHaveBeenCalledWith(ownerId, "image", {
		provider: "openslop",
		model: "Seedream 5 Lite",
	});
});

it("rejects unpriced generated video before creating a run", async () => {
	vi.stubEnv("FYLMER_STAGING_GENERATION_ENABLED", "1");
	vi.stubEnv("FYLMER_FILM_COORDINATOR_ENABLED", "1");
	projectQuery.single.mockResolvedValueOnce({
		data: {
			script: '<video id="shot">A lighthouse.</video>',
			store: {},
			generation: {},
		},
		error: null,
	});
	const response = await request({ projectId, action: "start", runId });
	expect(response.status).toBe(409);
	expect((await response.json()).error).toContain("supported cost limits");
	expect(rpc).not.toHaveBeenCalled();
	expect(projectQuery.eq).toHaveBeenCalledWith("user_id", ownerId);
});

it("does not plan or create another owner's inaccessible project", async () => {
	vi.stubEnv("FYLMER_STAGING_GENERATION_ENABLED", "1");
	vi.stubEnv("FYLMER_FILM_COORDINATOR_ENABLED", "1");
	projectQuery.single.mockResolvedValueOnce({
		data: null,
		error: { message: "No row" },
	});
	expect((await request({ projectId, action: "start", runId })).status).toBe(
		404,
	);
	expect(rpc).not.toHaveBeenCalled();
});
it("requires mutation identities and rejects caller-owned identity fields", async () => {
	expect((await request({ projectId, action: "cancel" })).status).toBe(400);
	expect(
		(await request({ projectId, action: "read", userId: ownerId })).status,
	).toBe(400);
	expect(rpc).not.toHaveBeenCalled();
});
it.each(["start", "resume"])(
	"does not %s while generation is disabled",
	async (action) => {
		expect((await request({ projectId, action, runId })).status).toBe(503);
		expect(rpc).not.toHaveBeenCalled();
	},
);
it.each(["read", "pause", "cancel"])(
	"keeps %s available when generation is disabled",
	async (action) => {
		const response = await request({ projectId, action, runId });
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toContain("no-store");
		const body = await response.json();
		expect(body).toMatchObject({
			enabled: false,
			run: { id: runId, stopReason: "images_review" },
		});
		expect(body.run).not.toHaveProperty("plan");
		expect(rpc).toHaveBeenCalledWith("control_film_run", {
			p_project_id: projectId,
			p_action: action,
			p_run_id: runId,
		});
	},
);
it("delegates an enabled start to the session-bound RPC with its idempotency identity", async () => {
	vi.stubEnv("FYLMER_STAGING_GENERATION_ENABLED", "1");
	vi.stubEnv("FYLMER_FILM_COORDINATOR_ENABLED", "1");
	expect((await request({ projectId, action: "start", runId })).status).toBe(
		200,
	);
	expect(rpc).toHaveBeenCalledExactlyOnceWith("control_film_run", {
		p_project_id: projectId,
		p_action: "start",
		p_run_id: runId,
	});
});
it("returns no run for a project without history", async () => {
	rpc.mockResolvedValue({ data: null, error: null });
	expect(await (await request({ projectId, action: "read" })).json()).toEqual({
		run: null,
		enabled: false,
	});
});
it("does not expose a mismatched owner response", async () => {
	rpc.mockResolvedValue({
		data: { ...saved, user_id: projectId },
		error: null,
	});
	expect((await request({ projectId, action: "read" })).status).toBe(404);
});
it("returns actionable gate errors without raw database failures", async () => {
	rpc.mockResolvedValueOnce({
		data: null,
		error: { message: "FYLMER_RUN: Approve the current Film Bible." },
	});
	expect(
		await (await request({ projectId, action: "pause", runId })).json(),
	).toEqual({ error: "Approve the current Film Bible." });
	rpc.mockResolvedValueOnce({
		data: null,
		error: { message: "internal database detail" },
	});
	expect(
		await (await request({ projectId, action: "read" })).text(),
	).not.toContain("internal database");
});
