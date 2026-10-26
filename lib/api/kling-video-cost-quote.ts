import { z } from "zod";
import type { ModelRef } from "@/lib/connectors/types";
import type { AssetCostQuote } from "./asset-cost-quote";
import { ProjectBudgetError } from "./project-budget-error";

const source =
	"https://runware.ai/docs/models/klingai-video-3-0-turbo/schema.json";
const requestSchema = z.object({
	duration: z.number().int().min(3).max(15).default(5),
	resolution: z.enum(["720p", "1080p"]).default("720p"),
	width: z.number().int().positive().optional(),
	height: z.number().int().positive().optional(),
	frameImage: z.string().min(1).optional(),
	numberResults: z.literal(1).optional(),
});
const dimensions = {
	"720p": new Set(["1280x720", "720x1280", "960x960"]),
	"1080p": new Set(["1920x1080", "1080x1920", "1440x1440"]),
};
const schema = z.object({
	info: z.object({
		"x-air-id": z.literal("klingai:kling-video@3.0-turbo"),
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
								unit: z.literal("durationSecond"),
								label: z.enum(["720p", "1080p"]),
								display: z.string().optional(),
							})
							.strict(),
					)
					.length(2)
					.refine(
						(rates) => new Set(rates.map((rate) => rate.label)).size === 2,
					),
			})
			.strict(),
	}),
});

export async function quoteKlingVideoCost(
	request: ModelRef & Record<string, unknown>,
): Promise<AssetCostQuote> {
	const parsed = requestSchema.safeParse(request);
	if (!parsed.success)
		throw new ProjectBudgetError(
			"Choose a whole-number Kling Turbo duration from 3 to 15 seconds, one output and a supported resolution before generating.",
		);
	const { duration, resolution, frameImage } = parsed.data;
	const width = parsed.data.width ?? (resolution === "720p" ? 1280 : 1920);
	const height = parsed.data.height ?? (resolution === "720p" ? 720 : 1080);
	if (!frameImage && !dimensions[resolution].has(`${width}x${height}`))
		throw new ProjectBudgetError(
			"These Kling Turbo dimensions do not match the quoted resolution. No job was started.",
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
		const rates = schema.parse(JSON.parse(body)).info["x-pricing"].rates;
		const rate = rates.find((candidate) => candidate.label === resolution);
		if (!rate) throw new Error("Pricing tier unavailable");
		return {
			ceilingUsd: Math.ceil(rate.amount * duration * 1_000_000) / 1_000_000,
			currency: "USD",
			model: request.model,
			provider: request.provider,
			source,
			expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
		};
	} catch {
		throw new ProjectBudgetError(
			"The current Kling Turbo price could not be verified. No job was started. Keep the project cap enabled and try again when pricing is available.",
		);
	}
}
