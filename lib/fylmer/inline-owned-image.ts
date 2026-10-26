import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { referenceImageType } from "@/lib/api/image-reference-bytes";
import { resolveOwnedGeneratedMedia } from "./resolve-owned-generated-media";
import { readRunBundle } from "./read-run-bundle";
import { providerFileBytes } from "./private-provider-storage";

export async function inlineOwnedImage(
	client: SupabaseClient,
	input: { userId: string; projectId: string; appOrigin: string; url: string },
) {
	const access = await resolveOwnedGeneratedMedia(client, input, 300);
	if (access.key !== "image")
		throw new Error(
			"Only image outputs can be used as private picture references.",
		);
	const bundle = await readRunBundle(client, access.jobId, access.reference);
	const bytes = await providerFileBytes(
		{
			key: "image",
			filename: "reference",
			contentType: "image/png",
			url: access.url,
		},
		[new URL(access.url).origin],
		10 * 1024 * 1024,
	);
	if (
		createHash("sha256").update(bytes).digest("hex") !==
		bundle.response.result.image.slice(0, 64)
	)
		throw new Error("The private reference image failed its integrity check.");
	const contentType = referenceImageType(bytes);
	return `data:${contentType};base64,${bytes.toString("base64")}`;
}
