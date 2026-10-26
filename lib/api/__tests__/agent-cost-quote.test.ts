import { expect, it } from "vitest";
import { quoteAgentCost } from "../agent-cost-quote";

const now = Date.parse("2026-10-23T22:00:00Z");
const picked = { provider: "anthropic" as const, model: "Claude Haiku 4.5" };
const modelId = "claude-haiku-4-5-20251001";
it("reserves full context at the highest cache-write rate plus bounded output", () => {
	const quote = quoteAgentCost(picked, modelId, 64000, now);
	expect(quote.ceilingUsd).toBe(0.7296);
	expect(quote.maxRetries).toBe(0);
	expect(quote.maxOutputTokens).toBe(64000);
	expect(quote.inputTokenCeiling).toBe(204800);
	expect(quote.expiresAt).toBe("2026-10-23T22:05:00.000Z");
	expect(quote.pricingReviewedAt).toBe("2026-10-23T21:00:00.000Z");
	expect(quote.source).toContain("platform.claude.com");
});
it("keeps the selected hosted identity but prices the actual model", () => {
	const quote = quoteAgentCost(
		{ provider: "openslop", model: "Claude Opus 5" },
		"claude-opus-5",
		128000,
		now,
	);
	expect(quote.provider).toBe("openslop");
	expect(quote.ceilingUsd).toBe(13.68576);
});
it.each([0, -1, NaN, Infinity, 1.5, 64001])(
	"rejects invalid output limit %s",
	(limit) => {
		expect(() => quoteAgentCost(picked, modelId, limit, now)).toThrow(
			"output limit",
		);
	},
);
it.each([
	"2026-10-23T20:59:59Z",
	"2026-10-24T21:00:00Z",
	"2027-01-01T00:00:00Z",
])("fails closed outside the pricing review window (%s)", (date) => {
	expect(() => quoteAgentCost(picked, modelId, 100, Date.parse(date))).toThrow(
		"pricing needs verification",
	);
});
it("does not let a quote outlive its price review", () => {
	expect(
		quoteAgentCost(picked, modelId, 100, Date.parse("2026-10-24T20:59:00Z"))
			.expiresAt,
	).toBe("2026-10-24T21:00:00.000Z");
});
it("rejects model substitution and unsupported subscription pricing", () => {
	expect(() => quoteAgentCost(picked, "claude-opus-5", 100, now)).toThrow(
		"no verified bounded price",
	);
	expect(() =>
		quoteAgentCost(
			{ provider: "openslop", model: "Fylmer Chat" },
			"codex",
			100,
			now,
		),
	).toThrow("no verified bounded price");
});
