import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
	signedIn: true,
	owns: vi.fn(),
	rpc: vi.fn(),
}));
vi.mock("@/lib/api/projects", () => ({ ownsProject: state.owns }));
vi.mock("@/lib/supabase/service", () => ({
	createServiceClient: () => ({ rpc: state.rpc }),
}));
vi.mock("@/lib/api/with-auth", () => ({
	withSession: async (
		_label: string,
		handle: (user: { id: string }) => Promise<Response>,
	) =>
		state.signedIn
			? handle({ id: "fixture-user" })
			: Response.json({ error: "Unauthorized" }, { status: 401 }),
	withApiAccess: vi.fn(),
	withHostedBudget: vi.fn(),
	withPublic: vi.fn(),
}));

import { POST } from "../route";

function request(projectId = "5b93c435-6b87-42da-b20b-33be73422845") {
	return POST(
		new NextRequest("http://localhost/api/film-budget", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ projectId }),
		}),
	);
}

describe("private canonical project budget", () => {
	beforeEach(() => {
		state.signedIn = true;
		state.owns.mockReset().mockResolvedValue(true);
		state.rpc
			.mockReset()
			.mockResolvedValue({
				data: [{ committed_usd: 0.6, has_uncertain: true }],
				error: null,
			});
	});
	it("returns committed reservations and uncertainty without calling them actual spend", async () => {
		const response = await request();
		expect(await response.json()).toEqual({
			committedUsd: 0.6,
			hasUncertainCharges: true,
		});
		expect(response.headers.get("cache-control")).toBe("private, no-store");
		expect(state.rpc).toHaveBeenCalledWith("film_budget_totals", {
			p_project_id: "5b93c435-6b87-42da-b20b-33be73422845",
		});
	});
	it("does not read the ledger for an anonymous request", async () => {
		state.signedIn = false;
		expect((await request()).status).toBe(401);
		expect(state.owns).not.toHaveBeenCalled();
		expect(state.rpc).not.toHaveBeenCalled();
	});
	it("does not read another owner's or missing project", async () => {
		state.owns.mockResolvedValue(false);
		expect((await request()).status).toBe(404);
		expect(state.rpc).not.toHaveBeenCalled();
	});
	it("rejects an invalid project before ownership or ledger access", async () => {
		expect((await request("invalid")).status).toBe(400);
		expect(state.owns).not.toHaveBeenCalled();
		expect(state.rpc).not.toHaveBeenCalled();
	});
	it("never substitutes zero for a failed ledger read", async () => {
		state.rpc.mockResolvedValue({
			data: null,
			error: { message: "private database detail" },
		});
		await expect(request()).rejects.toThrow("Could not load project budget.");
	});
	it.each([
		{ data: [] },
		{ data: [{ committed_usd: null, has_uncertain: false }] },
		{ data: [{ committed_usd: -1, has_uncertain: false }] },
	])("rejects malformed totals $data", async ({ data }) => {
		state.rpc.mockResolvedValue({ data, error: null });
		await expect(request()).rejects.toThrow();
	});
});
