export type ComfyNode = {
	class_type: string;
	inputs: Record<string, unknown>;
	_meta?: Record<string, unknown>;
};
export type ComfyPrompt = Record<string, ComfyNode>;
export type ComfyDocument = {
	prompt: ComfyPrompt;
	positions: Record<string, { x: number; y: number }>;
};
export function comfyLink(value: unknown): value is [string, number] {
	return (
		Array.isArray(value) &&
		value.length === 2 &&
		typeof value[0] === "string" &&
		Number.isInteger(value[1]) &&
		value[1] >= 0
	);
}
export function parseComfyDocument(input: unknown): ComfyDocument {
	if (!input || typeof input !== "object" || Array.isArray(input))
		throw new Error("Choose a ComfyUI API-format workflow JSON.");
	if (JSON.stringify(input).length > 2_000_000)
		throw new Error("Workflow is too large. Use a file smaller than 2 MB.");
	const data = input as Record<string, unknown>;
	const raw =
		data.prompt &&
		typeof data.prompt === "object" &&
		!("class_type" in data.prompt)
			? data.prompt
			: input;
	if (Array.isArray((raw as Record<string, unknown>).nodes))
		throw new Error(
			"This is ComfyUI's visual format. Export the API-format workflow to preserve named inputs and connections.",
		);
	const entries = Object.entries(raw);
	if (!entries.length || entries.length > 200)
		throw new Error("Use a workflow with 1–200 nodes.");
	const prompt: ComfyPrompt = Object.create(null);
	const positions: ComfyDocument["positions"] = Object.create(null);
	const unsafe = new Set(["__proto__", "constructor", "prototype"]);
	for (const [id, value] of entries) {
		if (
			!/^[a-zA-Z0-9_-]{1,100}$/.test(id) ||
			unsafe.has(id) ||
			!value ||
			typeof value !== "object" ||
			Array.isArray(value)
		)
			throw new Error("Invalid ComfyUI node.");
		const node = value as ComfyNode;
		if (
			typeof node.class_type !== "string" ||
			!node.class_type.trim() ||
			node.class_type.length > 200 ||
			!node.inputs ||
			typeof node.inputs !== "object" ||
			Array.isArray(node.inputs)
		)
			throw new Error(`Node ${id} needs a class_type and named inputs.`);
		if (Object.keys(node.inputs).some((key) => unsafe.has(key)))
			throw new Error("Unsafe input name.");
		prompt[id] = structuredClone(node);
		const position = (
			data.positions as ComfyDocument["positions"] | undefined
		)?.[id];
		if (
			position &&
			Number.isFinite(position.x) &&
			Number.isFinite(position.y) &&
			Math.abs(position.x) <= 100000 &&
			Math.abs(position.y) <= 100000
		)
			positions[id] = position;
	}
	const visiting = new Set<string>(),
		visited = new Set<string>();
	const visit = (id: string) => {
		if (visiting.has(id))
			throw new Error("The workflow contains a connection loop.");
		if (visited.has(id)) return;
		visiting.add(id);
		for (const value of Object.values(prompt[id].inputs))
			if (comfyLink(value)) {
				if (!prompt[value[0]])
					throw new Error(`Node ${id} links to a missing node.`);
				visit(value[0]);
			}
		visiting.delete(id);
		visited.add(id);
	};
	for (const id of Object.keys(prompt)) visit(id);
	return { prompt, positions };
}
