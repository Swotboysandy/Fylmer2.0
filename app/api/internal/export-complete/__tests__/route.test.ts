import { afterEach, expect, it, vi } from "vitest";
const complete = vi.fn();
vi.mock("@/lib/render/complete-local-film-run", () => ({
	completeLocalFilmRun: (...args: unknown[]) => complete(...args),
}));
vi.mock("@/lib/render/local-export", () => ({
	exportDirectory: (user: string, render: string) =>
		`/exports/${user}/${render}`,
}));
const { POST } = await import("../route");
const userId = "11111111-1111-4111-8111-111111111111";
const renderId = "22222222-2222-4222-8222-222222222222";
const secret = "x".repeat(32);
const request = (body: unknown, authorized = true) => {
	vi.stubEnv("FYLMER_JOB_WORKER_SECRET", secret);
	return POST(
		new Request("http://localhost/api/internal/export-complete", {
			method: "POST",
			headers: authorized ? { authorization: `Bearer ${secret}` } : {},
			body: JSON.stringify(body),
		}),
	);
};
afterEach(() => {
	complete.mockReset();
	vi.unstubAllEnvs();
});
it("rejects untrusted callers before reading files", async () => {
	expect((await request({ userId, renderId }, false)).status).toBe(404);
	expect(complete).not.toHaveBeenCalled();
});
it("rejects invalid path identities", async () => {
	expect((await request({ userId: "../", renderId })).status).toBe(400);
	expect(complete).not.toHaveBeenCalled();
});
it.each([true, false])(
	"returns verified completion decision %s",
	async (recorded) => {
		complete.mockResolvedValue(recorded);
		const response = await request({ userId, renderId });
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("private, no-store");
		expect(await response.json()).toEqual({ recorded });
		expect(complete).toHaveBeenCalledWith(
			`/exports/${userId}/${renderId}`,
			userId,
			renderId,
		);
	},
);
it("returns a retryable failure without leaking backend details", async () => {
	complete.mockRejectedValue(new Error("private connection detail"));
	const response = await request({ userId, renderId });
	expect(response.status).toBe(503);
	expect(await response.text()).not.toContain("private connection detail");
});
