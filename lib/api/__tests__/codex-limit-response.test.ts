import { expect, it } from "vitest";
import { withPublic } from "../with-auth";
import { codexFailure } from "@/lib/providers/llm/codex-error";

it("returns 429 without an upstream stack or request contents", async () => {
	const response = await withPublic("Chat", async () => {
		throw codexFailure("429: private upstream response");
	});
	expect(response.status).toBe(429);
	const body = await response.json();
	expect(body.error).toContain("rate-limited");
	expect(body.error).not.toContain("private");
	expect(body.error).not.toContain("stack");
});

it("returns 503 for unavailable Codex without leaking internals", async () => {
	const response = await withPublic("Chat", async () => {
		throw codexFailure("private backend failure");
	});
	expect(response.status).toBe(503);
	expect((await response.json()).error).not.toContain("private");
});
