import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/api/asset-bundle");

const mockDisconnect = vi.fn();
const mockImageInference = vi.fn();
const mockRunware = vi.fn();

vi.mock("@runware/sdk-js", () => ({
	Runware: class {
		constructor(options: unknown) {
			mockRunware(options);
			return {
				imageInference: mockImageInference,
				disconnect: mockDisconnect,
			};
		}
	},
}));

import { AssetBundle } from "@/lib/api/asset-bundle";
import { RunwareImage } from "../image/runware";

const MODEL = "bytedance:seedream@5.0-lite";

describe("RunwareImage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("generates an image with defaults", async () => {
		mockImageInference.mockResolvedValue([
			{ imageBase64Data: "abc123", cost: 0.02, seed: 1 },
		]);

		const provider = new RunwareImage("test-key");
		const result = await provider.generate({ prompt: "a cat", model: MODEL });

		expect(result.output.result.image).toBe("url");
		expect(mockImageInference).toHaveBeenCalledWith({
			positivePrompt: "a cat",
			model: MODEL,
			width: 2848,
			height: 1600,
			outputType: "base64Data",
			outputFormat: "JPG",
			numberResults: 1,
			retry: 0,
			settings: { maxSequentialImages: 1 },
			includeCost: true,
			referenceImages: undefined,
		});
		expect(mockDisconnect).toHaveBeenCalled();
		expect(mockRunware).toHaveBeenCalledWith(
			expect.objectContaining({ globalMaxRetries: 0 }),
		);
	});

	it("names the characters plainly, their avatars ahead of the other reference images", async () => {
		mockImageInference.mockResolvedValue([
			{ imageBase64Data: "abc", cost: 0.02 },
		]);

		await new RunwareImage("test-key").generate({
			prompt: "{{Red}} pets a cat",
			model: MODEL,
			characterAssets: [{ name: "Red", avatarUrl: "https://img/red.png" }],
			referenceImages: ["https://img/style.png"],
		});

		expect(mockImageInference).toHaveBeenCalledWith(
			expect.objectContaining({
				positivePrompt: "Red pets a cat",
				referenceImages: ["https://img/red.png", "https://img/style.png"],
			}),
		);
	});

	it("asks for the format it labels the bytes with", async () => {
		mockImageInference.mockResolvedValue([
			{ imageBase64Data: "abc", cost: 0.02 },
		]);

		await new RunwareImage("test-key").generate({
			prompt: "a cat",
			model: MODEL,
			format: "webp",
		});

		expect(mockImageInference).toHaveBeenCalledWith(
			expect.objectContaining({ outputFormat: "WEBP" }),
		);
		expect(AssetBundle.upload).toHaveBeenCalledWith(
			"image",
			"runware",
			[
				expect.objectContaining({
					filename: "output.webp",
					contentType: "image/webp",
				}),
			],
			undefined,
		);
	});

	it("passes custom dimensions and model", async () => {
		mockImageInference.mockResolvedValue([
			{ imageBase64Data: "data", cost: 0.02 },
		]);

		const provider = new RunwareImage("test-key");
		await provider.generate({
			prompt: "sunset",
			model: "custom-model",
			width: 1024,
			height: 768,
		});

		expect(mockImageInference).toHaveBeenCalledWith(
			expect.objectContaining({
				model: "custom-model",
				width: 1024,
				height: 768,
			}),
		);
	});

	it("throws when no image data returned", async () => {
		mockImageInference.mockResolvedValue([{}]);

		const provider = new RunwareImage("test-key");
		await expect(
			provider.generate({ prompt: "test", model: MODEL }),
		).rejects.toThrow("No image data returned");
		expect(mockDisconnect).toHaveBeenCalled();
	});

	it("throws and disconnects when inference fails", async () => {
		mockImageInference.mockRejectedValue(new Error("API error"));

		const provider = new RunwareImage("test-key");
		await expect(
			provider.generate({ prompt: "test", model: MODEL }),
		).rejects.toThrow("API error");
		expect(mockDisconnect).toHaveBeenCalled();
	});

	it("does not silently bill only the first of unexpected extra images", async () => {
		mockImageInference.mockResolvedValue([
			{ imageBase64Data: "one", cost: 0.035 },
			{ imageBase64Data: "two", cost: 0.035 },
		]);
		await expect(
			new RunwareImage("test-key").generate({ prompt: "test", model: MODEL }),
		).rejects.toThrow("Unexpected image count");
		expect(AssetBundle.upload).not.toHaveBeenCalled();
	});

	it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
		"rejects an invalid returned cost: %s",
		async (cost) => {
			mockImageInference.mockResolvedValue([
				{ imageBase64Data: "image", cost },
			]);
			await expect(
				new RunwareImage("test-key").generate({ prompt: "test", model: MODEL }),
			).rejects.toThrow("Invalid image cost");
			expect(AssetBundle.upload).not.toHaveBeenCalled();
		},
	);

	it("correlates the provider task and stored media with the durable job ID", async () => {
		const jobId = "ad7fe3bc-1cb0-4933-b6ef-ea6000aa7172";
		mockImageInference.mockResolvedValue([
			{ imageBase64Data: "image", cost: 0.035, taskUUID: jobId },
		]);
		await new RunwareImage("test-key").generate(
			{ prompt: "test", model: MODEL },
			{ jobId },
		);
		expect(mockImageInference).toHaveBeenCalledWith(
			expect.objectContaining({ taskUUID: jobId }),
		);
		expect(AssetBundle.upload).toHaveBeenCalledWith(
			"image",
			"runware",
			expect.any(Array),
			{ providerTaskId: jobId },
		);
	});

	it("does not attribute a mismatched provider response to the reserved job", async () => {
		mockImageInference.mockResolvedValue([
			{ imageBase64Data: "image", cost: 0.035, taskUUID: "different-task" },
		]);
		await expect(
			new RunwareImage("test-key").generate(
				{ prompt: "test", model: MODEL },
				{ jobId: "ad7fe3bc-1cb0-4933-b6ef-ea6000aa7172" },
			),
		).rejects.toThrow("did not match the reserved job");
		expect(AssetBundle.upload).not.toHaveBeenCalled();
	});
});
