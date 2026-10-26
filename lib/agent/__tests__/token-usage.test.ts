import { expect, it } from "vitest";
import { accumulateTokenUsage } from "../token-usage";

it("retains exact reported counts and sums continuation steps", () => {
	const first = accumulateTokenUsage(undefined, {
		inputTokens: 12,
		outputTokens: 7,
	});
	expect(first).toEqual({ inputTokens: 12, outputTokens: 7 });
	expect(
		accumulateTokenUsage(first, { inputTokens: 4, outputTokens: 3 }),
	).toEqual({ inputTokens: 16, outputTokens: 10 });
});
it("distinguishes unknown counts from reported zero", () => {
	expect(
		accumulateTokenUsage(undefined, {
			inputTokens: undefined,
			outputTokens: 0,
		}),
	).toEqual({ inputTokens: null, outputTokens: 0 });
});
it("does not turn partial or legacy totals into complete counts", () => {
	expect(
		accumulateTokenUsage(null, { inputTokens: 12, outputTokens: 7 }),
	).toEqual({ inputTokens: null, outputTokens: null });
	expect(
		accumulateTokenUsage(
			{ inputTokens: null, outputTokens: 1 },
			{ inputTokens: 12, outputTokens: 7 },
		),
	).toEqual({ inputTokens: null, outputTokens: 8 });
});
it.each([-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])(
	"rejects invalid provider counts %s",
	(count) => {
		expect(
			accumulateTokenUsage(undefined, {
				inputTokens: count,
				outputTokens: count,
			}),
		).toEqual({ inputTokens: null, outputTokens: null });
	},
);
