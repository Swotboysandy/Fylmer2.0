import type { SupabaseClient } from "@supabase/supabase-js";
import { AssetBundle, type BundleFile } from "@/lib/api/asset-bundle";
import { storeRunBundle } from "./store-run-bundle";

const maximum = 100 * 1024 * 1024;

export async function providerFileBytes(
	file: BundleFile,
	origins: string[],
	remaining: number,
) {
	if (remaining <= 0)
		throw new Error("Generated media exceeds the bundle size limit.");
	if ("data" in file) {
		const bytes = Buffer.isBuffer(file.data)
			? file.data
			: typeof file.data === "string"
				? Buffer.from(file.data)
				: Buffer.from(file.data);
		if (!bytes.length || bytes.length > remaining)
			throw new Error(
				"Generated media is empty or exceeds the bundle size limit.",
			);
		return bytes;
	}
	const url = new URL(file.url);
	if (
		!["https:", "http:"].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.hash ||
		!origins.includes(url.origin)
	)
		throw new Error(
			"The provider media origin is not approved for private storage.",
		);
	const response = await fetch(url, {
		redirect: "error",
		signal: AbortSignal.timeout(60000),
	});
	if (!response.ok || !response.body)
		throw new Error("Could not read generated provider media.");
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let length = 0;
	try {
		const declared = Number(response.headers.get("content-length") ?? 0);
		if (declared > remaining)
			throw new Error("Generated media exceeds the bundle size limit.");
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			length += next.value.byteLength;
			if (length > remaining)
				throw new Error("Generated media exceeds the bundle size limit.");
			chunks.push(next.value);
		}
	} finally {
		await reader.cancel();
	}
	if (!length) throw new Error("The provider returned empty generated media.");
	return Buffer.concat(chunks);
}

export function privateProviderWriter(
	client: SupabaseClient,
	jobId: string,
	origins: string[],
): typeof AssetBundle.upload {
	return async (type, provider, files, metadata) => {
		if (!files.length || files.length > 16)
			throw new Error("Invalid generated bundle file count.");
		const job = await client
			.from("jobs")
			.select("connector_type,status")
			.eq("id", jobId)
			.single();
		if (
			job.error ||
			job.data?.connector_type !== type ||
			!["processing", "completed"].includes(job.data.status)
		)
			throw new Error("Generated bundle does not match its active job.");
		const buffered = [];
		let remaining = maximum;
		for (const file of files) {
			const data = await providerFileBytes(file, origins, remaining);
			remaining -= data.length;
			buffered.push({
				key: file.key,
				filename: file.filename,
				contentType: file.contentType,
				data,
			});
		}
		return (await storeRunBundle(client, jobId, provider, buffered, metadata))
			.response;
	};
}
