import { getCanvasElements } from "@/lib/canvas/assets";
import { getContentElements } from "@/lib/canvas/scenes";
import { DEFAULT_CONNECTOR_REGISTRY } from "@/lib/connectors/registry";
import { buildNodes } from "@/lib/generation/generation-graph";
import {
	buildSettings,
	hasPrompt,
	type GenerationNode,
} from "@/lib/generation/graph";
import { GenerationQueue } from "@/lib/generation/queue";
import { needsGeneration } from "@/lib/generation/staleness";
import { parseSavedProject } from "@/lib/project/saved-project";
import { deserializeWithScenes } from "@/lib/project/serialize";

export function buildFilmRunPlan(saved: unknown) {
	const project = parseSavedProject(saved);
	const document = deserializeWithScenes(
		project.script,
		project.store.models,
		(index) => `scene-${index + 1}`,
	);
	const canvas = getCanvasElements(document);
	const ids = new Set<string>();
	for (const element of canvas) {
		if (ids.has(element.id))
			throw new Error("The saved film has duplicate element IDs.");
		if (!project.script.includes(`id="${element.id}"`))
			throw new Error(
				"Save the canonical script with stable element IDs before starting a run.",
			);
		ids.add(element.id);
		if (
			project.generation[element.id]?.status &&
			project.generation[element.id].status !== "idle"
		)
			throw new Error(
				"Existing generation must settle before planning another run.",
			);
	}
	const queue = new GenerationQueue({ initialState: project.generation });
	const roots = buildNodes(getContentElements(document), {
		state: buildSettings(project.store),
		canvas,
		registry: DEFAULT_CONNECTOR_REGISTRY,
	}).filter(
		(node) => hasPrompt(node) || Boolean(project.generation[node.id]?.result),
	);
	if (roots.length === 0)
		throw new Error(
			"Add scripted clips or selected media before starting a film run.",
		);
	const ordered = new Map<string, GenerationNode>();
	const visit = (node: GenerationNode) => {
		if (ordered.has(node.id)) return;
		if (needsGeneration(node, queue)) {
			const dependencies = Object.values(node.dependsOn);
			if (
				node.job.connectorType === "tts" &&
				!dependencies.some(
					(dependency) => dependency.job.connectorType === "voice",
				)
			)
				throw new Error(
					"Choose a saved voice for every speaking character and narrator before starting a film run.",
				);
			dependencies.forEach(visit);
		}
		ordered.set(node.id, node);
	};
	roots.forEach(visit);
	return {
		version: 1,
		rootIds: roots.map((node) => node.id),
		nodes: Array.from(ordered.values()).map((node) => ({
			id: node.id,
			elementType: node.job.elementType,
			connectorType: node.job.connectorType,
			model: node.job.model,
			inputs: node.inputs,
			dependsOn: needsGeneration(node, queue)
				? Object.fromEntries(
						Object.entries(node.dependsOn).map(([label, dependency]) => [
							label,
							dependency.id,
						]),
					)
				: {},
			action: needsGeneration(node, queue) ? "generate" : "reuse",
			selectedTake: project.generation[node.id]?.result ?? null,
			pinned: project.generation[node.id]?.pinned ?? false,
		})),
	};
}
