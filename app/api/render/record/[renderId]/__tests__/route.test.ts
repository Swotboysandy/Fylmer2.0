import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";

const owner = "11111111-1111-4111-8111-111111111111";
const renderId = "22222222-2222-4222-8222-222222222222";
const user = vi.fn();
const record = vi.fn();
vi.mock("@/lib/api/auth", () => ({ getUser: () => user() }));
vi.mock("@/lib/render/export-record", () => ({
	getExportRecord: (...args: unknown[]) => record(...args),
}));
vi.mock("@/lib/api/logger", () => ({
	logger: { error: vi.fn(), warn: vi.fn() },
}));
const { GET } = await import("../route");
const request = (id = renderId) =>
	GET(
		new NextRequest(
			`http://localhost/api/render/record/${id}?userId=someone-else`,
		),
		{ params: Promise.resolve({ renderId: id }) },
	);
beforeEach(() => {
	vi.clearAllMocks();
	user.mockResolvedValue({ id: owner });
	record.mockResolvedValue({ version: 1, renderId });
});
it("returns a private attachment scoped only to the signed-in owner", async () => {
	const response = await request();
	expect(response.status).toBe(200);
	expect(record).toHaveBeenCalledWith(owner, renderId);
	expect(response.headers.get("Cache-Control")).toBe("private, no-store");
	expect(response.headers.get("Content-Disposition")).toContain("attachment;");
	expect(await response.json()).toEqual({ version: 1, renderId });
});
it("rejects anonymous requests before touching export files", async () => {
	user.mockResolvedValue(null);
	expect((await request()).status).toBe(401);
	expect(record).not.toHaveBeenCalled();
});
it("rejects invalid render paths before touching export files", async () => {
	expect((await request("not-a-uuid")).status).toBe(404);
	expect(record).not.toHaveBeenCalled();
});
it("does not reveal whether an inaccessible or unfinished export exists", async () => {
	record.mockResolvedValue(null);
	const response = await request();
	expect(response.status).toBe(404);
	expect(await response.json()).toEqual({ error: "Export not found" });
});
