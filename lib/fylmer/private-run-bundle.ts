import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AssetBundle, type BundleResponse } from "@/lib/api/asset-bundle";
import { readRunBundle } from "./read-run-bundle";

export async function privateRunBundle(
	client: SupabaseClient,
	jobId: string,
	response: BundleResponse,
	appOrigin: string,
) {
	const origin = new URL(appOrigin);
	if (
		!["https:", "http:"].includes(origin.protocol) ||
		origin.username ||
		origin.password ||
		origin.search ||
		origin.hash ||
		origin.pathname !== "/"
	)
		throw new Error(
			"A trusted application origin is required for private film media.",
		);
	if (
		origin.protocol === "http:" &&
		!["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
	)
		throw new Error("Private film media requires HTTPS outside localhost.");
	const saved = await readRunBundle(client, jobId, response.storage);
	if (!isDeepStrictEqual(saved.response, response))
		throw new Error(
			"Completed private media differs from its stored manifest.",
		);
	class PrivateRunBundle extends AssetBundle {
		async fetchJson<T>(key: string, schema: z.ZodType<T>): Promise<T> {
			if (!Object.hasOwn(saved.files, key))
				throw new Error("Missing private film metadata.");
			const downloaded = await client.storage
				.from(saved.reference.bucket)
				.download(saved.files[key]);
			if (
				downloaded.error ||
				!downloaded.data ||
				downloaded.data.size > 1024 * 1024
			)
				throw new Error("Private film metadata is unavailable or too large.");
			const bytes = Buffer.from(await downloaded.data.arrayBuffer());
			if (
				createHash("sha256").update(bytes).digest("hex") !==
				saved.response.result[key].slice(0, 64)
			)
				throw new Error("Private film metadata failed its integrity check.");
			return schema.parse(JSON.parse(bytes.toString("utf8")));
		}
	}
	return new PrivateRunBundle(`${origin.origin}/api/generated-media/${jobId}`, {
		result: Object.fromEntries(
			Object.keys(saved.files).map((key) => [key, key]),
		),
		metadata: saved.response.metadata,
	});
}
