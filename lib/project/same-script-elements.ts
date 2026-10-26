import isEqual from "lodash/isEqual";
import { isScene } from "@/lib/canvas/scenes";
import type { CanvasElement } from "@/lib/canvas/types";
import { deserializeWithScenes } from "./serialize";

function elementIdentities(script: string) {
	const elements = deserializeWithScenes(script).flatMap<CanvasElement>(
		(node) => (isScene(node) ? node.children : [node]),
	);
	if (
		!elements.length ||
		new Set(elements.map((node) => node.id)).size !== elements.length
	)
		return null;
	return elements
		.map(({ id, type }) => [id, type])
		.sort(([left], [right]) => left.localeCompare(right));
}

export function sameScriptElements(baseline: string, current: string): boolean {
	const before = elementIdentities(baseline);
	const after = elementIdentities(current);
	return before !== null && after !== null && isEqual(before, after);
}
