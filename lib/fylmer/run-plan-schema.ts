import { z } from "zod";
import { ElementTypeSchema } from "@/lib/canvas/types";
import {
	ASSET_CONNECTOR_TYPES,
	AssetResultSchema,
	PROVIDERS,
} from "@/lib/connectors/types";
import { GenerationInputsSchema } from "@/lib/generation/inputs";

export const FilmRunPlanSchema = z.object({
	version: z.literal(1),
	rootIds: z.array(z.string().min(1)).nonempty(),
	nodes: z
		.array(
			z.object({
				id: z.string().min(1),
				elementType: ElementTypeSchema,
				connectorType: z.enum(ASSET_CONNECTOR_TYPES),
				model: z.object({
					provider: z.enum(PROVIDERS),
					model: z.string().min(1),
				}),
				inputs: GenerationInputsSchema.omit({ dependencies: true }),
				dependsOn: z.record(z.string(), z.string()),
				action: z.enum(["generate", "reuse"]),
				selectedTake: AssetResultSchema.nullable(),
				pinned: z.boolean(),
			}),
		)
		.nonempty(),
});
