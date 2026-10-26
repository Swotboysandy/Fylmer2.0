import { expect, it } from "vitest";
import { codexFailure } from "../codex-error";

it("surfaces a retryable rate limit without raw provider errors", () => {
	const error = codexFailure(
		"exceeded retry limit, last status: 429 Too Many Requests",
	);
	expect(error.status).toBe(429);
	expect(error.message).toContain("rate-limited");
	expect(error.message).not.toContain("exceeded retry limit");
});

it("does not expose arbitrary upstream details", () => {
	const error = codexFailure(
		"internal error at /private/path with private request content",
	);
	expect(error.status).toBe(503);
	expect(error.message).not.toContain("private");
});
