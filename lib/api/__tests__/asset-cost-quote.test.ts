import { afterEach, describe, expect, it, vi } from "vitest";
import { quoteAssetCost } from "../asset-cost-quote";

const request = { provider: "openslop", model: "Seedream 5 Lite" } as const;
const document = {
	info: {
		"x-air-id": "bytedance:seedream@5.0-lite",
		"x-status": "live",
		"x-pricing": {
			currency: "USD",
			rates: [{ amount: 0.035, unit: "output" }],
		},
	},
};
afterEach(() => vi.unstubAllGlobals());

describe("quoteAssetCost", () => {
	it.each(["openslop", "runware"] as const)(
		"reads a current single-image rate for %s",
		async (provider) => {
			const fetch = vi.fn().mockResolvedValue(Response.json(document));
			vi.stubGlobal("fetch", fetch);
			const quote = await quoteAssetCost("image", { ...request, provider });
			expect(quote).toMatchObject({
				ceilingUsd: 0.035,
				currency: "USD",
				provider,
				model: request.model,
			});
			expect(Date.parse(quote.expiresAt)).toBeGreaterThan(Date.now());
			expect(Date.parse(quote.expiresAt)).toBeLessThanOrEqual(
				Date.now() + 5 * 60_000,
			);
			expect(fetch).toHaveBeenCalledWith(
				"https://runware.ai/docs/models/bytedance-seedream-5-0-lite/schema.json",
				expect.objectContaining({ redirect: "error", cache: "no-store" }),
			);
		},
	);
	it.each(["video", "music", "sfx", "tts"])(
		"refuses unpriced %s without a provider call",
		async (type) => {
			const fetch = vi.fn();
			vi.stubGlobal("fetch", fetch);
			await expect(quoteAssetCost(type, request)).rejects.toThrow(
				"no verified bounded media price",
			);
			expect(fetch).not.toHaveBeenCalled();
		},
	);
	it("refuses unsupported dimensions before fetching a price", async () => {
		const fetch = vi.fn();
		vi.stubGlobal("fetch", fetch);
		await expect(
			quoteAssetCost("image", { ...request, width: 9999, height: 9999 }),
		).rejects.toThrow("size has no verified");
		expect(fetch).not.toHaveBeenCalled();
	});
	it.each([
		{ currency: "EUR", rates: [{ amount: 0.035, unit: "output" }] },
		{ currency: "USD", rates: [{ amount: 0.035, unit: "second" }] },
		{
			currency: "USD",
			rates: [{ amount: 0.035, unit: "output", condition: "2K only" }],
		},
		{
			currency: "USD",
			rates: [{ amount: 0.035, unit: "output" }],
			minimumCharge: 1,
		},
		{ currency: "USD", rates: [] },
		{ currency: "USD", rates: [{ amount: -1, unit: "output" }] },
	])("fails closed for ambiguous pricing %j", async (pricing) => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(
					Response.json({ info: { ...document.info, "x-pricing": pricing } }),
				),
		);
		await expect(quoteAssetCost("image", request)).rejects.toThrow(
			"could not be verified",
		);
	});
	it("never replaces an unavailable price with zero", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
		await expect(quoteAssetCost("image", request)).rejects.toThrow(
			"No job was started",
		);
	});
});
