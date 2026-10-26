import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveOwnedGeneratedMedia } from "@/lib/fylmer/resolve-owned-generated-media";
import { ExportLayoutSchema, validateLocalExport } from "./local-export";

export async function hydrateExportMedia(
	client: SupabaseClient,
	userId: string,
	projectId: string,
	input: unknown,
	appOrigin: string,
) {
	const layout = ExportLayoutSchema.parse(input);
	validateLocalExport(layout, userId, "720p", appOrigin);
	const renewed = new Map<string, string>();
	for (const item of [
		...layout.series,
		...Object.values(layout.sequences).flat(),
	]) {
		const url = item.element.url;
		if (!new URL(url).pathname.startsWith("/api/generated-media/")) continue;
		if (!renewed.has(url)) {
			const media = await resolveOwnedGeneratedMedia(
				client,
				{ userId, projectId, appOrigin, url },
				1800,
			);
			renewed.set(url, media.url);
		}
		const replacement = renewed.get(url);
		if (!replacement)
			throw new Error("Private export media could not be renewed.");
		item.element.url = replacement;
	}
	return layout;
}
