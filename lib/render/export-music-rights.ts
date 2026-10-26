import { z } from "zod";
import { MusicRightsDeclarationSchema } from "@/lib/connectors/music-rights";
import type { SavedProject } from "@/lib/project/saved-project";
import type { RenderLayout } from "./types";

export const ExportMusicRightsSchema = z
	.array(
		z
			.object({
				elementId: z.string().min(1),
				audioUrl: z.url(),
				declaration: MusicRightsDeclarationSchema.nullable(),
			})
			.refine(
				(record) =>
					!record.declaration ||
					record.declaration.audioUrl === record.audioUrl,
				{
					message: "Music declaration does not match the exported take.",
				},
			),
	)
	.max(400);

export function exportMusicRights(project: SavedProject, layout: RenderLayout) {
	const identifiers = new Set(
		[...layout.series, ...Object.values(layout.sequences).flat()]
			.filter((sequence) => sequence.element.type === "music")
			.map((sequence) => sequence.element.id),
	);
	return ExportMusicRightsSchema.parse(
		[...identifiers].map((elementId) => {
			const result = project.generation[elementId]?.result;
			return {
				elementId,
				audioUrl: result?.audioUrl,
				declaration: result?.musicRights ?? null,
			};
		}),
	);
}
