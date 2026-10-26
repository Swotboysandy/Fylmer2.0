import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { BundleResponseSchema } from "@/lib/api/asset-bundle";

export const GENERATED_MEDIA_BUCKET = "fylmer-generated";
const fileSchema = z.object({
	key: z.string().regex(/^[a-zA-Z0-9_-]+$/),
	filename: z
		.string()
		.max(128)
		.regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
	contentType: z.enum([
		"image/png",
		"image/jpeg",
		"image/webp",
		"image/gif",
		"video/mp4",
		"video/webm",
		"audio/mpeg",
		"audio/wav",
		"audio/flac",
		"audio/ogg",
		"application/json",
	]),
	data: z.instanceof(Uint8Array),
});

export async function storeRunBundle(
	client: SupabaseClient,
	jobId: string,
	provider: string,
	rawFiles: unknown,
	metadata: Record<string, unknown> = {},
) {
	z.uuid().parse(jobId);
	z.string()
		.regex(/^[a-zA-Z0-9_-]+$/)
		.parse(provider);
	const files = z.array(fileSchema).min(1).max(16).parse(rawFiles);
	if (
		new Set(files.map((file) => file.key)).size !== files.length ||
		files.some((file) => file.data.byteLength === 0) ||
		files.reduce((total, file) => total + file.data.byteLength, 0) >
			100 * 1024 * 1024
	)
		throw new Error(
			"A stored film bundle needs unique, nonempty files totalling at most 100 MiB.",
		);
	const loaded = await client
		.from("jobs")
		.select("id,user_id,project_id,connector_type,status")
		.eq("id", jobId)
		.single();
	if (loaded.error)
		throw new Error("Could not verify the generated media job.");
	const job = z
		.object({
			id: z.uuid(),
			user_id: z.uuid(),
			project_id: z.uuid(),
			connector_type: z.enum(["image", "video", "tts", "music", "sfx"]),
			status: z.enum(["processing", "completed"]),
		})
		.parse(loaded.data);
	const configured = await client.storage.getBucket(GENERATED_MEDIA_BUCKET);
	if (configured.error || !configured.data || configured.data.public)
		throw new Error(
			"Generated film storage must be an available private bucket.",
		);
	const allowed = configured.data.allowed_mime_types;
	const limit = Number(configured.data.file_size_limit ?? 100 * 1024 * 1024);
	if (
		files.some(
			(file) =>
				file.data.byteLength > limit ||
				(allowed &&
					!allowed.some(
						(mime) =>
							mime === file.contentType ||
							(mime.endsWith("/*") &&
								file.contentType.startsWith(mime.slice(0, -1))),
					)),
		)
	)
		throw new Error(
			"Generated film storage does not allow this file type or size.",
		);
	if (Buffer.byteLength(JSON.stringify(metadata)) > 1024 * 1024)
		throw new Error("Generated film metadata exceeds 1 MiB.");
	const bucket = client.storage.from(GENERATED_MEDIA_BUCKET);
	const prefix = `${job.user_id}/${job.id}`;
	const result: Record<string, string> = {};
	const persist = async (
		name: string,
		data: Uint8Array,
		contentType: string,
	) => {
		const digest = createHash("sha256").update(data).digest("hex");
		const filename = `${digest}-${name}`;
		const uploaded = await bucket.upload(`${prefix}/${filename}`, data, {
			contentType,
			upsert: false,
		});
		if (
			uploaded.error &&
			String((uploaded.error as { statusCode?: string }).statusCode) !== "409"
		)
			throw new Error(
				`Could not store generated film file: ${uploaded.error.message}`,
			);
		return filename;
	};
	for (const file of files)
		result[file.key] = await persist(
			file.filename,
			file.data,
			file.contentType,
		);
	const response = BundleResponseSchema.parse({
		id: job.id,
		type: job.connector_type,
		provider,
		result,
		metadata,
	});
	const manifest = Buffer.from(JSON.stringify(response));
	if (manifest.length > 1024 * 1024)
		throw new Error("Generated film metadata exceeds 1 MiB.");
	const manifestName = await persist(
		"manifest.json",
		manifest,
		"application/json",
	);
	const reference = {
		bucket: GENERATED_MEDIA_BUCKET,
		prefix,
		manifestPath: `${prefix}/${manifestName}`,
	};
	return {
		...reference,
		response: BundleResponseSchema.parse({ ...response, storage: reference }),
	};
}
