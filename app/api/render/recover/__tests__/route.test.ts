import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const user = vi.fn();
const owns = vi.fn();
const recover = vi.fn();
vi.mock("@/lib/api/auth", () => ({ getUser: () => user() }));
vi.mock("@/lib/api/projects", () => ({
	ownsProject: (...args: unknown[]) => owns(...args),
}));
vi.mock("@/lib/render/export-recovery", () => ({
	recoverLocalExport: (...args: unknown[]) => recover(...args),
}));
vi.mock("@/lib/api/logger", () => ({
	logger: { error: vi.fn(), warn: vi.fn() },
}));
const { POST } = await import("../route");
const projectId = "11111111-1111-4111-8111-111111111111";
const request = (body: unknown = { projectId }) =>
	POST(
		new NextRequest("http://localhost/api/render/recover", {
			method: "POST",
			body: JSON.stringify(body),
		}),
	);
beforeEach(() => {
	vi.clearAllMocks();
	vi.stubEnv("FYLMER_EXPORT_BACKEND", "local");
	user.mockResolvedValue({ id: "owner" });
	owns.mockResolvedValue(true);
	recover.mockResolvedValue({
		renderId: "existing",
		bucketName: "fylmer-local",
	});
});
afterEach(() => vi.unstubAllEnvs());
it("requires a signed-in session before lookup", async () => {
	user.mockResolvedValue(null);
	expect((await request()).status).toBe(401);
	expect(owns).not.toHaveBeenCalled();
	expect(recover).not.toHaveBeenCalled();
});
it("rejects malformed project identities", async () => {
	expect((await request({ projectId: "../private" })).status).toBe(400);
	expect(recover).not.toHaveBeenCalled();
});
it("rejects missing or inaccessible projects before filesystem access", async () => {
	owns.mockResolvedValue(false);
	expect((await request()).status).toBe(404);
	expect(recover).not.toHaveBeenCalled();
});
it("uses session identity rather than an owner supplied by the caller", async () => {
	const response = await request({ projectId, userId: "other" });
	expect(response.status).toBe(200);
	expect(recover).toHaveBeenCalledWith("owner", projectId);
	expect(await response.json()).toEqual({
		handle: { renderId: "existing", bucketName: "fylmer-local" },
	});
});
it("returns an empty result when there is no saved export", async () => {
	recover.mockResolvedValue(null);
	expect(await (await request()).json()).toEqual({ handle: null });
});
it("does not scan local exports for a cloud backend", async () => {
	vi.stubEnv("FYLMER_EXPORT_BACKEND", "cloud");
	expect(await (await request()).json()).toEqual({ handle: null });
	expect(recover).not.toHaveBeenCalled();
});
