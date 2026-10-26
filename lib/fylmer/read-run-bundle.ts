import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { BundleResponseSchema } from "@/lib/api/asset-bundle";
import { GENERATED_MEDIA_BUCKET } from "./store-run-bundle";

const referenceSchema = z.object({
	bucket: z.literal(GENERATED_MEDIA_BUCKET),
	prefix: z.string(),
	manifestPath: z.string(),
});
const filenameSchema = z
	.string()
	.regex(/^[a-f0-9]{64}-[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/);

export async function readRunBundle(
	client: SupabaseClient,
	jobId: string,
	rawReference: unknown,
) {
	z.uuid().parse(jobId);
	const reference = referenceSchema.parse(rawReference);
	const loaded = await client
		.from("jobs")
		.select("id,user_id,connector_type")
		.eq("id", jobId)
		.single();
	if (loaded.error)
		throw new Error("Generated film media was not found or is not accessible.");
	const job = z
		.object({ id: z.uuid(), user_id: z.uuid(), connector_type: z.string() })
		.parse(loaded.data);
	const prefix = `${job.user_id}/${job.id}`;
	if (
		reference.prefix !== prefix ||
		!reference.manifestPath.startsWith(`${prefix}/`)
	)
		throw new Error(
			"The generated media reference does not belong to this job.",
		);
	const name = reference.manifestPath.slice(prefix.length + 1);
	if (!/^[a-f0-9]{64}-manifest\.json$/.test(name))
		throw new Error("Invalid generated media manifest reference.");
	const downloaded = await client.storage
		.from(reference.bucket)
		.download(reference.manifestPath);
	if (downloaded.error || !downloaded.data)
		throw new Error("The generated film manifest could not be read.");
	if (downloaded.data.size > 1024 * 1024)
		throw new Error("Generated film manifest exceeds 1 MiB.");
	const bytes = Buffer.from(await downloaded.data.arrayBuffer());
	if (createHash("sha256").update(bytes).digest("hex") !== name.slice(0, 64))
		throw new Error("The generated film manifest failed its integrity check.");
	const response = BundleResponseSchema.parse(
		JSON.parse(bytes.toString("utf8")),
	);
	if (response.id !== job.id || response.type !== job.connector_type)
		throw new Error("The generated film manifest does not match this job.");
	const entries = Object.entries(response.result);
	if (entries.length === 0 || entries.length > 16)
		throw new Error("Invalid generated film file count.");
	const files = Object.fromEntries(
		entries.map(([key, filename]) => [
			key,
			`${prefix}/${filenameSchema.parse(filename)}`,
		]),
	);
	return {
		reference,
		response: BundleResponseSchema.parse({ ...response, storage: reference }),
		files,
	};
}

export async function signRunBundleFiles(
	client: SupabaseClient,
	jobId: string,
	reference: unknown,
	keys: string[],
	expiresIn = 300,
) {
	z.number().int().min(30).max(3600).parse(expiresIn);
	z.array(z.string()).min(1).max(16).parse(keys);
	const bundle = await readRunBundle(client, jobId, reference);
	for (const key of keys)
		if (!Object.hasOwn(bundle.files, key))
			throw new Error("The requested film file is not in its manifest.");
	const urls: Record<string, string> = {};
	for (const key of new Set(keys)) {
		const signed = await client.storage
			.from(bundle.reference.bucket)
			.createSignedUrl(bundle.files[key], expiresIn);
		if (signed.error || !signed.data)
			throw new Error(
				"Could not create temporary access to generated film media.",
			);
		urls[key] = signed.data.signedUrl;
	}
	return { reference: bundle.reference, urls, expiresIn };
}
