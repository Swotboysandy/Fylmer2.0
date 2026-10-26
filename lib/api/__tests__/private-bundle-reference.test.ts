import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AssetBundle, BundleResponseSchema } from "../asset-bundle";

const prefix =
	"11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222";
const response = {
	id: "22222222-2222-4222-8222-222222222222",
	type: "image",
	provider: "fixture",
	result: { image: "image.png" },
};
const storage = {
	bucket: "fylmer-generated",
	prefix,
	manifestPath: `${prefix}/${"a".repeat(64)}-manifest.json`,
};

describe("private bundle transport", () => {
	afterEach(() => vi.unstubAllGlobals());
	it("resolves browser media to the session-authenticated application route", async () => {
		vi.stubGlobal("window", {
			location: { origin: "https://app.example.test" },
		});
		const fetcher = vi.fn().mockResolvedValue(Response.json([]));
		vi.stubGlobal("fetch", fetcher);
		const parsed = BundleResponseSchema.parse({
			...response,
			storage,
			result: {
				image: "opaque-image.png",
				timestamps: "opaque-timestamps.json",
			},
			metadata: { durationSec: 2 },
		});
		const original = JSON.stringify(parsed);
		const bundle = AssetBundle.fromResponse(parsed);
		expect(bundle.resolve("image")).toBe(
			`https://app.example.test/api/generated-media/${response.id}/image`,
		);
		expect(bundle.durationSec).toBe(2);
		expect(await bundle.fetchJson("timestamps", z.array(z.unknown()))).toEqual(
			[],
		);
		expect(fetcher).toHaveBeenCalledExactlyOnceWith(
			`https://app.example.test/api/generated-media/${response.id}/timestamps`,
		);
		expect(JSON.stringify(parsed)).toBe(original);
		expect(bundle.url).not.toContain("token=");
	});
	it("rejects mismatched identities and unsafe file keys in the browser", () => {
		vi.stubGlobal("window", {
			location: { origin: "https://app.example.test" },
		});
		expect(() =>
			AssetBundle.fromResponse(
				BundleResponseSchema.parse({
					...response,
					id: "33333333-3333-4333-8333-333333333333",
					storage,
				}),
			),
		).toThrow("does not match");
		expect(() =>
			AssetBundle.fromResponse(
				BundleResponseSchema.parse({
					...response,
					storage,
					result: { "../secret": "image.png" },
				}),
			),
		).toThrow();
	});
	it("retains stable storage identity across serialization and schema parsing", () => {
		const parsed = BundleResponseSchema.parse(
			JSON.parse(JSON.stringify({ ...response, storage })),
		);
		expect(parsed.storage).toEqual(storage);
		expect(() => AssetBundle.fromResponse(parsed)).toThrow(
			"authenticated resolution",
		);
	});
	it("preserves legacy public bundle resolution", () => {
		const parsed = BundleResponseSchema.parse(response);
		expect(parsed.storage).toBeUndefined();
		expect(AssetBundle.fromResponse(parsed).resolve("image")).toContain(
			"/assets/image/fixture/",
		);
	});
	it.each([
		{ ...storage, bucket: "public" },
		{ ...storage, prefix: "../other" },
		{ ...storage, manifestPath: `${prefix}/../manifest.json` },
		{ ...storage, manifestPath: "https://example.com/manifest.json" },
	])("rejects invalid storage identities", (invalid) => {
		expect(
			BundleResponseSchema.safeParse({ ...response, storage: invalid }).success,
		).toBe(false);
	});
});
