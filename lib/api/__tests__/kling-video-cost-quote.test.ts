import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { quoteAssetCost } from "../asset-cost-quote";

const request = { provider: "runware", model: "Kling 3 Turbo" } as const;
const pricing = () => ({
	info: {
		"x-air-id": "klingai:kling-video@3.0-turbo",
		"x-status": "live",
		"x-pricing": {
			currency: "USD",
			rates: [
				{ amount: 0.112, unit: "durationSecond", label: "720p" },
				{ amount: 0.14, unit: "durationSecond", label: "1080p" },
			],
		},
	},
});
const fetchMock = vi.fn();
beforeEach(() => {
	fetchMock.mockReset().mockResolvedValue(Response.json(pricing()));
	vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

it.each([
	["720p", 5, 0.56],
	["1080p", 15, 2.1],
] as const)(
	"quotes %s for %s seconds using the current tier",
	async (resolution, duration, ceiling) => {
		const result = await quoteAssetCost("video", {
			...request,
			resolution,
			duration,
		});
		expect(result.ceilingUsd).toBeCloseTo(ceiling, 5);
		expect(result).toMatchObject({
			model: request.model,
			provider: "runware",
			currency: "USD",
		});
		expect(Date.parse(result.expiresAt)).toBeLessThanOrEqual(
			Date.now() + 300000,
		);
		expect(fetchMock).toHaveBeenCalledWith(
			"https://runware.ai/docs/models/klingai-video-3-0-turbo/schema.json",
			expect.objectContaining({ redirect: "error", cache: "no-store" }),
		);
	},
);

it("uses the provider's five-second 720p defaults", async () => {
	expect((await quoteAssetCost("video", request)).ceilingUsd).toBeCloseTo(
		0.56,
		5,
	);
});

it.each([
	{ duration: 2 },
	{ duration: 16 },
	{ duration: 4.5 },
	{ duration: "5" },
	{ resolution: "4k" },
	{ numberResults: 2 },
	{ width: 1920, height: 1080, resolution: "720p" },
])(
	"rejects unbounded or mismatched input %j before fetching",
	async (patch) => {
		await expect(
			quoteAssetCost("video", { ...request, ...patch }),
		).rejects.toThrow();
		expect(fetchMock).not.toHaveBeenCalled();
	},
);

it("prices first-frame input by the provider's explicit resolution, not unused dimensions", async () => {
	const result = await quoteAssetCost("video", {
		...request,
		frameImage: "https://example.invalid/reference.png",
		resolution: "1080p",
		duration: 3,
		width: 720,
		height: 1280,
	});
	expect(result.ceilingUsd).toBeCloseTo(0.42, 5);
});

it("refuses duplicate tiers and extra billable units", async () => {
	const duplicate = pricing();
	duplicate.info["x-pricing"].rates[1].label = "720p";
	fetchMock.mockResolvedValueOnce(Response.json(duplicate));
	await expect(quoteAssetCost("video", request)).rejects.toThrow(
		"could not be verified",
	);
	const extra = pricing();
	extra.info["x-pricing"].rates.push({
		amount: 0.1,
		unit: "reference",
		label: "720p",
	});
	fetchMock.mockResolvedValueOnce(Response.json(extra));
	await expect(quoteAssetCost("video", request)).rejects.toThrow(
		"could not be verified",
	);
});

it("refuses offline or changed pricing instead of falling back to a stale rate", async () => {
	fetchMock.mockRejectedValueOnce(new Error("offline"));
	await expect(quoteAssetCost("video", request)).rejects.toThrow(
		"could not be verified",
	);
	const wrong = pricing();
	wrong.info["x-air-id"] = "different-model";
	fetchMock.mockResolvedValueOnce(Response.json(wrong));
	await expect(quoteAssetCost("video", request)).rejects.toThrow(
		"could not be verified",
	);
});

it("does not apply Runware rates to another provider", async () => {
	await expect(
		quoteAssetCost("video", { ...request, provider: "openslop" }),
	).rejects.toThrow("no verified");
	expect(fetchMock).not.toHaveBeenCalled();
});
