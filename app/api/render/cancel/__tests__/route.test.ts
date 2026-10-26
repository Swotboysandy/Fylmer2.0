import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const user = vi.fn();
const cancel = vi.fn();
vi.mock("@/lib/api/auth", () => ({ getUser: () => user() }));
vi.mock("@/lib/render/export-cancellation", () => ({
	requestExportCancellation: (...args: unknown[]) => cancel(...args),
}));
vi.mock("@/lib/api/logger", () => ({
	logger: { error: vi.fn(), warn: vi.fn() },
}));
const { POST } = await import("../route");
const renderId = "11111111-1111-4111-8111-111111111111";
const request = (body: unknown = { renderId }) =>
	POST(
		new NextRequest("http://localhost/api/render/cancel", {
			method: "POST",
			body: JSON.stringify(body),
		}),
	);
beforeEach(() => {
	vi.clearAllMocks();
	vi.stubEnv("FYLMER_EXPORT_BACKEND", "local");
	user.mockResolvedValue({ id: "owner" });
	cancel.mockResolvedValue("requested");
});
afterEach(() => vi.unstubAllEnvs());
it("requires authentication before accessing an export", async () => {
	user.mockResolvedValue(null);
	expect((await request()).status).toBe(401);
	expect(cancel).not.toHaveBeenCalled();
});
it("rejects invalid render identities", async () => {
	expect((await request({ renderId: "../other" })).status).toBe(400);
	expect(cancel).not.toHaveBeenCalled();
});
it("uses session identity and returns accepted, not stopped", async () => {
	const response = await request({ renderId, userId: "other" });
	expect(response.status).toBe(202);
	expect(await response.json()).toEqual({ status: "requested" });
	expect(cancel).toHaveBeenCalledWith("owner", renderId);
});
it("does not expose another owner's export", async () => {
	cancel.mockRejectedValue(
		Object.assign(new Error("missing"), { code: "ENOENT" }),
	);
	expect((await request()).status).toBe(404);
});
it.each(["done", "cancelled", "failed"])(
	"preserves terminal %s results",
	async (status) => {
		cancel.mockResolvedValue(status);
		const response = await request();
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status });
	},
);
it("does not cancel unsupported cloud exports", async () => {
	vi.stubEnv("FYLMER_EXPORT_BACKEND", "cloud");
	expect((await request()).status).toBe(409);
	expect(cancel).not.toHaveBeenCalled();
});
