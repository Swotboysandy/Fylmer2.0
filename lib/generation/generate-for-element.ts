import { createConnector } from "@/lib/connectors/factory";
import type { AssetResult } from "@/lib/connectors/types";
import type { GenerationNode } from "./graph";

export async function generateForElement(
	{ job, inputs }: GenerationNode,
	dependencies: Record<string, AssetResult>,
	signal?: AbortSignal,
	projectId?: string,
): Promise<AssetResult> {
	if (!projectId?.trim())
		throw new Error("Choose a saved project before generating media.");
	return createConnector(job.connectorType, job.model, job.config).generate(
		{ prompt: inputs.prompt, ...inputs.attributes, projectId },
		{ dependencies, reads: inputs.reads, signal },
	);
}
