import { expect, it, vi } from "vitest";
import { hydrateProviderReferences } from "../hydrate-provider-references";

const url =
	"https://app.example/api/generated-media/11111111-1111-4111-8111-111111111111/image";
it("hydrates known continuity fields once without altering queued identity or prose", async () => {
	const params = {
		prompt: `Use this reference ${url}`,
		frameImage: url,
		referenceImages: [url, "data:image/png;base64,fixture"],
		continuityFrames: [url],
		characterAssets: [
			{ name: "Mira", avatarUrl: url, voice: { id: "voice-1" } },
		],
		custom: url,
	};
	const original = JSON.stringify(params);
	const resolve = vi
		.fn()
		.mockResolvedValue("https://storage.example/object?token=fresh");
	const hydrated = await hydrateProviderReferences(params, resolve);
	expect(resolve).toHaveBeenCalledExactlyOnceWith(url);
	expect(hydrated.frameImage).toContain("token=fresh");
	expect(hydrated.characterAssets[0].avatarUrl).toBe(hydrated.frameImage);
	expect(hydrated.continuityFrames).toEqual([hydrated.frameImage]);
	expect(hydrated.referenceImages[1]).toBe(params.referenceImages[1]);
	expect(hydrated.prompt).toBe(params.prompt);
	expect(hydrated.custom).toBe(url);
	expect(JSON.stringify(params)).toBe(original);
});
it("obtains fresh access on a later submission attempt", async () => {
	const resolve = vi
		.fn()
		.mockResolvedValueOnce("first")
		.mockResolvedValueOnce("renewed");
	expect(
		(await hydrateProviderReferences({ frameImage: url }, resolve)).frameImage,
	).toBe("first");
	expect(
		(await hydrateProviderReferences({ frameImage: url }, resolve)).frameImage,
	).toBe("renewed");
});
it("preserves external references without granting them private access", async () => {
	const resolve = vi.fn();
	const params = { referenceImages: ["https://provider.example/image.png"] };
	expect(await hydrateProviderReferences(params, resolve)).toEqual(params);
	expect(resolve).not.toHaveBeenCalled();
});
it("propagates ownership failure before provider submission", async () => {
	await expect(
		hydrateProviderReferences(
			{ frameImage: url },
			vi.fn().mockRejectedValue(new Error("not available to this project")),
		),
	).rejects.toThrow("this project");
});
it.each([
	{ referenceImages: "invalid" },
	{ characterAssets: [null] },
	{ continuityFrames: [123] },
])("rejects malformed reference fields", async (params) => {
	await expect(hydrateProviderReferences(params, vi.fn())).rejects.toThrow();
});
