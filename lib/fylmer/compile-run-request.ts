import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { captureOwnedRunFrames } from "./capture-owned-run-frames";
import { DEFAULT_CONNECTOR_REGISTRY } from "@/lib/connectors/registry";
import {
	runBeforeGenerate,
	runTransformPrompt,
} from "@/lib/connectors/plugins";
import { createPreviousVisualPlugin } from "@/lib/connectors/video/plugins/previous-visual";
import type { FrameKey } from "@/lib/connectors/video/start-frame";
import type { AssetResult } from "@/lib/connectors/types";
import { GenerationSnapshotSchema } from "@/lib/generation/snapshots";
import { FilmRunPlanSchema } from "./run-plan-schema";
import { bodySchema, VIDEO_FIELDS } from "@/lib/api/generation-schema";

export type RunFrameCapture = (
	url: string,
	keys: readonly FrameKey[],
) => Promise<string[]>;

const unavailableFrames: RunFrameCapture = async () => {
	throw new Error(
		"Configure the worker video-frame extractor before generating linked video shots.",
	);
};

export async function compileFilmRunRequest(
	rawPlan: unknown,
	nodeId: string,
	rawGeneration: unknown,
	projectId: string,
	captureFrames: RunFrameCapture = unavailableFrames,
	privateAccess?: { client: SupabaseClient; userId: string; appOrigin: string },
) {
	z.uuid().parse(projectId);
	const frameCapture =
		privateAccess && captureFrames === unavailableFrames
			? captureOwnedRunFrames(privateAccess.client, {
					userId: privateAccess.userId,
					appOrigin: privateAccess.appOrigin,
					projectId,
				})
			: captureFrames;
	const plan = FilmRunPlanSchema.parse(rawPlan);
	const node = plan.nodes.find((node) => node.id === nodeId);
	if (!node || node.action !== "generate" || node.pinned)
		throw new Error("This step is not scheduled for generation.");
	if (node.connectorType === "voice")
		throw new Error("Select a catalog voice before generating speech.");
	const generation = GenerationSnapshotSchema.parse(rawGeneration);
	const dependencies: Record<string, AssetResult> = {};
	for (const [label, id] of Object.entries(node.dependsOn)) {
		const snapshot = generation[id];
		if (!snapshot?.result || snapshot.status !== "idle")
			throw new Error(
				`Wait for the selected ${label} before generating this step.`,
			);
		dependencies[label] = snapshot.result;
	}
	const config = Object.entries(DEFAULT_CONNECTOR_REGISTRY).find(
		([type]) => type === node.elementType,
	)?.[1];
	if (!config)
		throw new Error("The planned element has no generation configuration.");
	const plugins = (config.plugins ?? []).map((plugin) =>
		plugin.name === "previous-visual"
			? createPreviousVisualPlugin(frameCapture)
			: plugin,
	);
	const context = { dependencies, reads: node.inputs.reads };
	const prompt = await runTransformPrompt(plugins, node.inputs.prompt, context);
	const request = await runBeforeGenerate<Record<string, unknown>>(
		plugins,
		{ ...node.inputs.attributes, ...node.model, projectId, prompt },
		context,
	);
	if (node.connectorType !== "video") return request;
	return bodySchema(
		z.object({
			provider: z.literal(node.model.provider),
			model: z.literal(node.model.model),
		}),
		VIDEO_FIELDS,
	).parse(request);
}
