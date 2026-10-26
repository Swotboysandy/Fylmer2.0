import { z } from "zod";

export const FilmReviewSchema = z.object({
	mode: z.enum(["autonomous", "directed"]).nullable().optional(),
	capUsd: z.number().min(0.01).nullable().optional(),
	bible: z.boolean(),
	images: z.boolean(),
	videos: z.boolean(),
	finalCut: z.boolean(),
	imageCount: z.number(),
	videoCount: z.number(),
});
export type FilmReview = z.infer<typeof FilmReviewSchema>;
export const ReviewActionSchema = z.enum([
	"read",
	"bible",
	"autonomous",
	"directed",
	"cap",
	"images",
	"videos",
	"final_cut",
]);

export function generationGate(
	review: FilmReview,
	type: string,
): string | null {
	if (!review.bible)
		return "Review and approve your Film Bible before generating media.";
	if (type === "video" && !review.images)
		return "Review and approve your images before generating videos.";
	return null;
}
