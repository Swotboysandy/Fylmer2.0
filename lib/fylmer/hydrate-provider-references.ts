export async function hydrateProviderReferences<T extends object>(
	params: T,
	resolve: (url: string) => Promise<string>,
): Promise<T> {
	const output = structuredClone(params);
	const fields = output as Record<string, unknown>;
	const resolved = new Map<string, string>();
	const hydrate = async (value: unknown) => {
		if (typeof value !== "string")
			throw new Error("A provider media reference must be a URL or data URI.");
		if (value.startsWith("data:")) return value;
		let url: URL;
		try {
			url = new URL(value);
		} catch {
			return value;
		}
		if (!url.pathname.startsWith("/api/generated-media/")) return value;
		if (!resolved.has(value)) resolved.set(value, await resolve(value));
		return resolved.get(value);
	};
	if (fields.frameImage !== undefined)
		fields.frameImage = await hydrate(fields.frameImage);
	for (const key of ["referenceImages", "continuityFrames"]) {
		if (fields[key] === undefined) continue;
		if (!Array.isArray(fields[key]))
			throw new Error("Provider image references must be a list.");
		const images = [];
		for (const value of fields[key]) images.push(await hydrate(value));
		fields[key] = images;
	}
	if (fields.characterAssets !== undefined) {
		if (!Array.isArray(fields.characterAssets))
			throw new Error("Character references must be a list.");
		for (const character of fields.characterAssets) {
			if (!character || typeof character !== "object")
				throw new Error("Invalid character reference.");
			if (character.avatarUrl !== undefined)
				character.avatarUrl = await hydrate(character.avatarUrl);
		}
	}
	return output;
}
