import { z } from "zod";
import type { ModelRef } from "@/lib/connectors/types";
import { ProjectBudgetError } from "./project-budget-error";
import { supportsBoundedAssetPrice } from "./asset-price-support";
import { quoteKlingVideoCost } from "./kling-video-cost-quote";

const source =
	"https://runware.ai/docs/models/bytedance-seedream-5-0-lite/schema.json";
const sizes = new Set([
	"2048x2048",
	"2304x1728",
	"1728x2304",
	"2848x1600",
	"1600x2848",
	"2496x1664",
	"1664x2496",
	"3136x1344",
	"3072x3072",
	"3456x2592",
	"2592x3456",
	"4096x2304",
	"2304x4096",
	"3744x2496",
	"2496x3744",
	"4704x2016",
]);
const pricingSchema = z.object({
	info: z.object({
		"x-air-id": z.literal("bytedance:seedream@5.0-lite"),
		"x-status": z.literal("live"),
		"x-pricing": z
			.object({
				currency: z.literal("USD"),
				docs: z.string().url().optional(),
				overview: z.string().optional(),
				examples: z.array(z.unknown()).optional(),
				rates: z
					.array(
						z
							.object({
								amount: z.number().positive().max(10000),
								unit: z.literal("output"),
								display: z.string().optional(),
							})
							.strict(),
					)
					.length(1),
			})
			.strict(),
	}),
});

export type AssetCostQuote = {
	ceilingUsd: number;
	currency: "USD";
	model: string;
	provider: string;
	source: string;
	expiresAt: string;
};

export async function quoteAssetCost(
	type: string,
	request: ModelRef & Record<string, unknown>,
): Promise<AssetCostQuote> {
	if (!supportsBoundedAssetPrice(type, request))
		throw new ProjectBudgetError(
			"This model has no verified bounded media price yet. No job was started; keep the project cap enabled and choose a supported model.",
		);
	if (type === "video") return quoteKlingVideoCost(request);
	const width = request.width ?? 2848;
	const height = request.height ?? 1600;
	if (!sizes.has(`${width}x${height}`))
		throw new ProjectBudgetError(
			"This image size has no verified bounded price. Choose a supported Seedream size before generating.",
		);
	try {
		const response = await fetch(source, {
			cache: "no-store",
			redirect: "error",
			signal: AbortSignal.timeout(5000),
		});
		if (!response.ok) throw new Error("Pricing unavailable");
		const body = await response.text();
		if (body.length > 262144) throw new Error("Pricing response too large");
		const parsed = pricingSchema.parse(JSON.parse(body));
		const [rate] = parsed.info["x-pricing"].rates;
		return {
			ceilingUsd: Math.ceil(rate.amount * 1_000_000) / 1_000_000,
			currency: "USD",
			model: request.model,
			provider: request.provider,
			source,
			expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
		};
	} catch {
		throw new ProjectBudgetError(
			"The current image price could not be verified. No job was started. Try again when pricing is available.",
		);
	}
}
