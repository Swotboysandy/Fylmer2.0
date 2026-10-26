import { afterEach, describe, expect, it, vi } from "vitest";
import { legacyAuthOrigin, legacySessionUser } from "../legacy-bridge";

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

describe("legacy auth bridge", () => {
	it("only enables a loopback origin", () => {
		vi.stubEnv("FYLMER_LEGACY_AUTH_ENABLED", "1");
		vi.stubEnv("FYLMER_LEGACY_AUTH_ORIGIN", "https://example.com/");
		expect(() => legacyAuthOrigin()).toThrow("loopback");
		vi.stubEnv("FYLMER_LEGACY_AUTH_ORIGIN", "http://127.0.0.1:3002");
		expect(legacyAuthOrigin()).toBe("http://127.0.0.1:3002");
	});

	it("accepts only an authenticated old session response", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				Response.json({ user: { id: "old-id", email: "owner@example.com" } }),
			)
			.mockResolvedValueOnce(new Response(null, { status: 401 }));
		vi.stubGlobal("fetch", fetchMock);
		const token = "a".repeat(43);
		expect(await legacySessionUser("http://127.0.0.1:3002", token)).toEqual({
			id: "old-id",
			email: "owner@example.com",
		});
		expect(await legacySessionUser("http://127.0.0.1:3002", token)).toBeNull();
		expect(await legacySessionUser("http://127.0.0.1:3002", "bad")).toBeNull();
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});
