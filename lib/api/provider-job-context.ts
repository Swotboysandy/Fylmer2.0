import type { ProviderJobContext } from "@/lib/providers/base";
import { createServiceClient } from "@/lib/supabase/service";
import { privateProviderWriter } from "@/lib/fylmer/private-provider-storage";

export function providerJobContext(jobId: string): ProviderJobContext {
	if (process.env.NEXT_PUBLIC_STORAGE_PROVIDER !== "supabase") return { jobId };
	const origins = (process.env.FYLMER_GENERATED_MEDIA_ORIGINS ?? "")
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean)
		.map((value) => {
			const url = new URL(value);
			if (
				!["http:", "https:"].includes(url.protocol) ||
				url.username ||
				url.password ||
				url.pathname !== "/" ||
				url.search ||
				url.hash
			)
				throw new Error(
					"Configure exact provider media origins without paths or credentials.",
				);
			return url.origin;
		});
	if (!origins.length)
		throw new Error(
			"Configure approved generated-media origins before starting private-storage generation.",
		);
	return {
		jobId,
		storeBundle: privateProviderWriter(createServiceClient(), jobId, origins),
	};
}
