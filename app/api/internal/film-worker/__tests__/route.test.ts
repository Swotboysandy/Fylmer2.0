import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET, POST } from "../route";
import type { SupabaseClient } from "@supabase/supabase-js";
import { continueFilmRun } from "@/lib/fylmer/continue-film-run";
import { createServiceClient } from "@/lib/supabase/service";

vi.mock("@/lib/fylmer/continue-film-run", () => ({ continueFilmRun: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({
	createServiceClient: vi.fn(() => ({})),
}));
const secret = "synthetic-coordinator-test-secret-123456789";
const runId = "11111111-1111-4111-8111-111111111111";
it("protects candidate discovery with authentication and enable gates", async () => {
	expect(
		(await GET(new Request("http://localhost/api/internal/film-worker")))
			.status,
	).toBe(404);
	vi.stubEnv("FYLMER_FILM_COORDINATOR_ENABLED", "0");
	expect(
		await (
			await GET(
				new Request("http://localhost/api/internal/film-worker", {
					headers: { authorization: `Bearer ${secret}` },
				}),
			)
		).json(),
	).toEqual({ kind: "paused" });
	expect(createServiceClient).not.toHaveBeenCalled();
});
it("returns only candidate identities, never ownership tokens or project payloads", async () => {
	const rpc = vi
		.fn()
		.mockResolvedValue({
			data: [{ run_id: runId, lease_id: "secret", script: "private" }],
			error: null,
		});
	vi.mocked(createServiceClient).mockReturnValueOnce({
		rpc,
	} as unknown as SupabaseClient);
	const response = await GET(
		new Request("http://localhost/api/internal/film-worker", {
			headers: { authorization: `Bearer ${secret}` },
		}),
	);
	expect(await response.json()).toEqual({
		kind: "candidates",
		runIds: [runId],
	});
	expect(rpc).toHaveBeenCalledExactlyOnceWith("list_film_run_candidates", {
		p_limit: 20,
	});
	expect(response.headers.get("cache-control")).toContain("no-store");
});
const request = (
	body: unknown = { runId },
	authorization = `Bearer ${secret}`,
) =>
	new Request("http://127.0.0.1:3055/api/internal/film-worker", {
		method: "POST",
		headers: { authorization, "content-type": "application/json" },
		body: JSON.stringify(body),
	});
beforeEach(() => {
	vi.clearAllMocks();
	vi.stubEnv("FYLMER_JOB_WORKER_SECRET", secret);
	vi.stubEnv("FYLMER_STAGING_GENERATION_ENABLED", "1");
	vi.stubEnv("FYLMER_FILM_COORDINATOR_ENABLED", "1");
	vi.stubEnv("FYLMER_GENERATED_MEDIA_APP_ORIGIN", "http://127.0.0.1:3055");
	vi.mocked(continueFilmRun).mockResolvedValue({ kind: "unavailable" });
});
afterEach(() => vi.unstubAllEnvs());
it("rejects unauthorized callers before database access", async () => {
	const response = await POST(request({}, "Bearer wrong"));
	expect(response.status).toBe(404);
	expect(response.headers.get("cache-control")).toContain("no-store");
	expect(createServiceClient).not.toHaveBeenCalled();
});
it.each([
	"FYLMER_STAGING_GENERATION_ENABLED",
	"FYLMER_FILM_COORDINATOR_ENABLED",
])("requires explicit %s", async (flag) => {
	vi.stubEnv(flag, "0");
	expect(await (await POST(request())).json()).toEqual({ kind: "paused" });
	expect(continueFilmRun).not.toHaveBeenCalled();
	expect(createServiceClient).not.toHaveBeenCalled();
});
it("rejects caller-controlled origins and malformed identifiers", async () => {
	expect(
		(await POST(request({ runId, appOrigin: "https://attacker.invalid" })))
			.status,
	).toBe(400);
	expect((await POST(request({ runId: "bad" }))).status).toBe(400);
	expect(createServiceClient).not.toHaveBeenCalled();
});
it.each([
	"",
	"http://public.example",
	"https://user:password@example.com",
	"https://example.com/path",
])("refuses unsafe origin %s", async (origin) => {
	vi.stubEnv("FYLMER_GENERATED_MEDIA_APP_ORIGIN", origin);
	expect((await POST(request())).status).toBe(503);
	expect(createServiceClient).not.toHaveBeenCalled();
});
it("executes one bounded tick with server-owned origin and abort signal", async () => {
	const incoming = request();
	expect(await (await POST(incoming)).json()).toEqual({ kind: "unavailable" });
	expect(continueFilmRun).toHaveBeenCalledExactlyOnceWith(
		{},
		{ runId, appOrigin: "http://127.0.0.1:3055" },
		{ maxTicks: 1, signal: incoming.signal },
	);
});
it("does not expose internal errors or pretend a failed tick succeeded", async () => {
	vi.mocked(continueFilmRun).mockRejectedValueOnce(
		new Error("private credential detail"),
	);
	const response = await POST(request());
	expect(response.status).toBe(409);
	expect(await response.text()).not.toContain("private credential");
});
