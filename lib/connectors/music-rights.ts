import { z } from "zod";

export const MusicRightsDeclarationSchema = z
	.object({
		status: z.literal("user-declared"),
		audioUrl: z.url(),
		basis: z.enum(["original", "licensed", "public-domain"]),
		statement: z.string().trim().min(1).max(2000),
		evidence: z.string().trim().min(1).max(2000),
		declaredAt: z.iso.datetime(),
	})
	.strict();
