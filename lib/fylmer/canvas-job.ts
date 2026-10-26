import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { parseComfyDocument } from "./comfy-document";
import { buildH3Workflow } from "./h3-workflow";

export function compileCanvasJob(input: unknown) {
	const document = parseComfyDocument(input);
	const conditioning = document.prompt["5"];
	const sampler = document.prompt["8"];
	if (
		conditioning?.class_type !== "MiniMaxH3ImageToVideo" ||
		sampler?.class_type !== "KSampler"
	)
		throw new Error(
			"This Canvas job requires the supported Tresca first/last-frame base template.",
		);
	const controls = z
		.object({
			prompt: z.string().min(1).max(20000),
			width: z.number().int(),
			height: z.number().int(),
			length: z.number().int().min(5).max(362),
		})
		.parse(conditioning.inputs);
	const sampling = z
		.object({ seed: z.number().int().nonnegative(), steps: z.number().int() })
		.parse(sampler.inputs);
	const { workflow, settings } = buildH3Workflow({
		prompt: controls.prompt,
		width: controls.width,
		height: controls.height,
		durationSeconds: Math.min(15, controls.length / 24),
		...sampling,
	});
	workflow["5"].inputs.prompt = controls.prompt;
	const actual = Object.fromEntries(
		Object.entries(document.prompt).map(([id, node]) => [
			id,
			{ class_type: node.class_type, inputs: node.inputs },
		]),
	);
	if (!isDeepStrictEqual(actual, workflow))
		throw new Error(
			"This workflow changes unsupported nodes or connections. Restore the Tresca template; prompt, size, length, seed and steps can be edited.",
		);
	return { document, workflow, settings };
}
