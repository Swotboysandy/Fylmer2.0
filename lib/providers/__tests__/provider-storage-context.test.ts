import { describe, expect, it, vi } from "vitest";
import { BaseProvider, type ProviderJobContext } from "../base";
import { BaseVideoProvider } from "../video/base";
import type { BundleFile, BundleResponse } from "@/lib/api/asset-bundle";

class ImageFixture extends BaseProvider<
	{ prompt: string },
	{ costUsd: number; metadata: { durationSec: number } }
> {
	protected readonly blobConfig = { type: "image", provider: "fixture" };
	async validate() {
		return { ok: true as const };
	}
	protected async _generate() {
		return { costUsd: 0.03, metadata: { durationSec: 0 } };
	}
	protected toFiles(): BundleFile[] {
		return [
			{
				key: "image",
				filename: "image.png",
				contentType: "image/png",
				data: Buffer.from("fixture"),
			},
		];
	}
}
class VideoFixture extends BaseVideoProvider {
	protected readonly blobConfig = { type: "video", provider: "fixture" };
	async validate() {
		return { ok: true as const };
	}
	async submit() {
		return "upstream-id";
	}
	protected async _poll() {
		return {
			url: "https://example.invalid/video.mp4",
			costUsd: 0.5,
			metadata: {
				jobId: "upstream-id",
				durationSec: 4,
				status: "completed" as const,
			},
		};
	}
}
const context = (jobId: string, type: string) => {
	const response: BundleResponse = {
		id: jobId,
		type,
		provider: "fixture",
		result: { [type]: "stored-file" },
	};
	const storeBundle = vi
		.fn<typeof import("@/lib/api/asset-bundle").AssetBundle.upload>()
		.mockResolvedValue(response);
	return {
		context: { jobId, storeBundle } satisfies ProviderJobContext,
		response,
		storeBundle,
	};
};

describe("per-job provider storage context", () => {
	it("keeps concurrent image jobs bound to their own storage callback", async () => {
		const first = context("first-job", "image");
		const second = context("second-job", "image");
		const provider = new ImageFixture();
		const results = await Promise.all([
			provider.generate({ prompt: "First" }, first.context),
			provider.generate({ prompt: "Second" }, second.context),
		]);
		expect(results).toEqual([
			{ output: first.response, costUsd: 0.03 },
			{ output: second.response, costUsd: 0.03 },
		]);
		for (const stored of [first, second])
			expect(stored.storeBundle).toHaveBeenCalledExactlyOnceWith(
				"image",
				"fixture",
				expect.any(Array),
				{ durationSec: 0 },
			);
	});
	it("passes completed video bytes-by-URL and metadata to the job storage callback", async () => {
		const stored = context("film-job", "video");
		const result = await new VideoFixture().poll(
			"upstream-id",
			{ prompt: "A film", model: "fixture", duration: 4 },
			stored.context,
		);
		expect(result).toMatchObject({
			kind: "ready",
			asset: { ...stored.response, metadata: { durationSec: 4 } },
			costUsd: 0.5,
		});
		expect(stored.storeBundle).toHaveBeenCalledExactlyOnceWith(
			"video",
			"fixture",
			[
				expect.objectContaining({
					key: "video",
					url: "https://example.invalid/video.mp4",
				}),
			],
			expect.objectContaining({ durationSec: 4 }),
		);
	});
	it("does not report success when owned storage fails", async () => {
		const stored = context("film-job", "image");
		stored.storeBundle.mockRejectedValue(new Error("storage unavailable"));
		await expect(
			new ImageFixture().generate({ prompt: "A film" }, stored.context),
		).rejects.toThrow("storage unavailable");
	});
});
