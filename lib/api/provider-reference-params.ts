import { createServiceClient } from "@/lib/supabase/service";
import { hydrateProviderReferences } from "@/lib/fylmer/hydrate-provider-references";
import { inlineOwnedImage } from "@/lib/fylmer/inline-owned-image";

export function providerReferenceParams<T extends object>(
	job: { user_id: string; project_id: string | null },
	params: T,
) {
	let encodedBytes = 0;
	return hydrateProviderReferences(params, async (url) => {
		const appOrigin = process.env.FYLMER_GENERATED_MEDIA_APP_ORIGIN;
		if (!job.project_id || !appOrigin)
			throw new Error(
				"Private references require an owned project and configured application origin before generation.",
			);
		const data = await inlineOwnedImage(createServiceClient(), {
			userId: job.user_id,
			projectId: job.project_id,
			appOrigin,
			url,
		});
		encodedBytes += Buffer.byteLength(data);
		if (encodedBytes > 20 * 1024 * 1024)
			throw new Error(
				"Private reference images exceed the combined inline request limit.",
			);
		return data;
	});
}
