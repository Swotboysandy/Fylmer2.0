import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { privateRunBundle } from "./private-run-bundle";
import { AssetBundle, BundleResponseSchema } from "@/lib/api/asset-bundle";
import { BaseAssetConnector } from "@/lib/connectors/asset-base";
import { createConnector } from "@/lib/connectors/factory";
import { AssetResultSchema, PROVIDERS } from "@/lib/connectors/types";

const CompletedJobSchema = z.object({
	id: z.uuid(),
	status: z.literal("completed"),
	connector_type: z.enum(["image", "video", "tts", "music", "sfx"]),
	request: z.object({ provider: z.enum(PROVIDERS), model: z.string().min(1) }),
	result: BundleResponseSchema,
});

function ownedBundleUrl(bundle: AssetBundle, key: string) {
	const stored = bundle.manifest.result[key];
	if (
		stored &&
		!/^https?:\/\//.test(stored) &&
		(!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(stored) ||
			stored.split("/").some((part) => part === "." || part === ".."))
	)
		throw new Error("Completed film media has an unsafe stored path.");
	const base = new URL(`${bundle.url}/`);
	const url = new URL(bundle.resolve(key));
	if (
		!["http:", "https:"].includes(base.protocol) ||
		url.origin !== base.origin ||
		!url.pathname.startsWith(base.pathname) ||
		/%2f|%5c|%2e/i.test(url.pathname) ||
		url.username ||
		url.password ||
		url.hash
	)
		throw new Error(
			"Completed film media must remain inside its stored bundle.",
		);
	return url;
}

class CompletedRunBundle extends AssetBundle {
	async fetchJson<T>(key: string, schema: z.ZodType<T>): Promise<T> {
		const url = ownedBundleUrl(this, key);
		const response = await fetch(url.href, {
			redirect: "error",
			signal: AbortSignal.timeout(15000),
		});
		if (!response.ok)
			throw new Error(
				`Failed to read completed film metadata (${response.status}).`,
			);
		return schema.parse(await response.json());
	}
}

export async function resolveCompletedRunResult(
	raw: unknown,
	privateAccess?: { client: SupabaseClient; appOrigin: string },
) {
	const job = CompletedJobSchema.parse(raw);
	if (job.result.type !== job.connector_type)
		throw new Error(
			"The completed media bundle does not match its admitted job.",
		);
	for (const segment of [job.result.type, job.result.provider, job.result.id]) {
		if (!/^[a-zA-Z0-9_-]+$/.test(segment))
			throw new Error(
				"The completed media bundle has an invalid storage identity.",
			);
	}
	let bundle: AssetBundle;
	if (job.result.storage) {
		if (!privateAccess)
			throw new Error(
				"Private completed media requires authenticated resolution.",
			);
		bundle = await privateRunBundle(
			privateAccess.client,
			job.id,
			job.result,
			privateAccess.appOrigin,
		);
	} else {
		const storedBundle = AssetBundle.fromResponse(job.result);
		bundle = new CompletedRunBundle(storedBundle.url, storedBundle.manifest);
	}
	const mediaKey =
		job.connector_type === "image"
			? "image"
			: job.connector_type === "video"
				? "video"
				: "audio";
	ownedBundleUrl(bundle, mediaKey);
	const duration = z.number().finite().nonnegative().parse(bundle.durationSec);
	if (job.connector_type !== "image" && duration <= 0)
		throw new Error(
			"Completed audio and video must have a positive measured duration.",
		);
	if (job.connector_type === "tts") ownedBundleUrl(bundle, "timestamps");
	const connector = createConnector(job.connector_type, job.request);
	if (!(connector instanceof BaseAssetConnector))
		throw new Error("This completed job has no media result converter.");
	const result = AssetResultSchema.parse(await connector.resolveBundle(bundle));
	for (const [index, timestamp] of (result.textTimestamps ?? []).entries()) {
		const previous = result.textTimestamps?.[index - 1];
		if (
			!Number.isFinite(timestamp.start) ||
			!Number.isFinite(timestamp.end) ||
			timestamp.start < 0 ||
			timestamp.end < timestamp.start ||
			timestamp.end > duration + 0.1 ||
			(previous && timestamp.start < previous.start)
		)
			throw new Error(
				"Speech timestamps must follow the measured audio timeline.",
			);
	}
	return result;
}
