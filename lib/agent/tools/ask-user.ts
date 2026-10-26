import { z } from "zod";
import { Info } from "@/components/ui/icon";
import { defineTool } from "./define-tool";

export const askUserAnswerSchema = z.object({
	answers: z.array(z.string()),
	skipped: z.boolean(),
});

export const askUser = defineTool({
	description:
		"Ask the user to choose only when their preference or approval changes the work. Offer 2 to 4 clear, distinct choices in plain language. The interface also offers a custom answer and a skip action, so do not add those as choices. Wait for the answer before continuing; never treat skipping as approval.",
	input: z.object({
		question: z.string().trim().min(1).max(240),
		options: z
			.array(
				z.object({
					label: z.string().trim().min(1).max(80),
					description: z.string().trim().max(160).optional(),
				}),
			)
			.min(2)
			.max(4),
		multiple: z.boolean().optional(),
	}),
	output: askUserAnswerSchema,
	icon: Info,
	label: "Waiting for your choice",
	execute: async () => {
		throw new Error("This question must be answered by the user.");
	},
});
