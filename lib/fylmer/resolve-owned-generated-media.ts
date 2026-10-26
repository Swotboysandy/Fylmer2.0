import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { BundleResponseSchema } from "@/lib/api/asset-bundle";
import { signRunBundleFiles } from "./read-run-bundle";

export async function resolveOwnedGeneratedMedia(
	client: SupabaseClient,
	input: { userId: string; projectId: string; appOrigin: string; url: string },
	expiresIn = 900,
) {
	z.uuid().parse(input.userId);
	z.uuid().parse(input.projectId);
	z.number().int().min(30).max(3600).parse(expiresIn);
	const origin = new URL(input.appOrigin);
	const url = new URL(input.url);
	if (
		!["https:", "http:"].includes(origin.protocol) ||
		origin.username ||
		origin.password ||
		origin.pathname !== "/" ||
		origin.search ||
		origin.hash
	)
		throw new Error("Invalid generated-media application origin.");
	if (
		url.origin !== origin.origin ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		/%|\\/.test(url.pathname)
	)
		throw new Error("Generated media must use its trusted application URL.");
	const parts = /^\/api\/generated-media\/([^/]+)\/(image|video|audio)$/.exec(
		url.pathname,
	);
	if (!parts) throw new Error("Invalid generated-media playback URL.");
	const jobId = z.uuid().parse(parts[1]);
	const key = parts[2];
	const loaded = await client
		.from("jobs")
		.select("id,user_id,project_id,status,connector_type,result")
		.eq("id", jobId)
		.eq("user_id", input.userId)
		.eq("project_id", input.projectId)
		.single();
	if (
		loaded.error ||
		loaded.data?.user_id !== input.userId ||
		loaded.data.project_id !== input.projectId ||
		loaded.data.status !== "completed"
	)
		throw new Error("Generated media is not available to this project.");
	const expected =
		loaded.data.connector_type === "image"
			? "image"
			: loaded.data.connector_type === "video"
				? "video"
				: "audio";
	if (key !== expected)
		throw new Error("Generated media type does not match its job.");
	const response = BundleResponseSchema.parse(loaded.data.result);
	if (
		response.id !== jobId ||
		response.type !== loaded.data.connector_type ||
		!response.storage
	)
		throw new Error("Generated media has no valid private reference.");
	const access = await signRunBundleFiles(
		client,
		jobId,
		response.storage,
		[key],
		expiresIn,
	);
	return {
		jobId,
		key,
		reference: access.reference,
		stableUrl: url.href,
		url: access.urls[key],
		expiresIn,
	};
}
