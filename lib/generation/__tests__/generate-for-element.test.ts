import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AssetResult, PluginContext } from "@/lib/connectors/types";
import { DEFAULT_MODELS } from "@/lib/connectors/models";

const mockGenerate =
	vi.fn<(params: unknown, context: PluginContext) => Promise<AssetResult>>();

vi.mock("@/lib/connectors/factory", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/connectors/factory")>()),
	createConnector: vi.fn(() => ({ generate: mockGenerate })),
}));

import { generateForElement } from "../generate-for-element";
import { GenerationQueue } from "../queue";
import { createConnector } from "@/lib/connectors/factory";
import { jobNode } from "./_graph";

const node = jobNode("a sunset", [], {
	attributes: { width: "1024" },
	reads: { "the art style": "noir" },
});

describe("generateForElement", () => {
	it("carries the queue's saved-project identity into media generation", async () => {
		mockGenerate.mockResolvedValue({ imageUrl: "fixture.png", durationSec: 0 });
		const queue = new GenerationQueue({ projectId: "queue-project" });
		queue.enqueueGraph([node]);
		await vi.waitFor(() =>
			expect(queue.getElementSnapshot(node.id).result?.imageUrl).toBe(
				"fixture.png",
			),
		);
		expect(mockGenerate).toHaveBeenCalledWith(
			expect.objectContaining({ projectId: "queue-project" }),
			expect.anything(),
		);
	});
	beforeEach(() => {
		vi.clearAllMocks();
		mockGenerate.mockReset();
		mockGenerate.mockResolvedValue({ imageUrl: "fixture.png", durationSec: 0 });
	});

	it("generates on the job's connector with the node's inputs, dependency results and signal", async () => {
		const expected: AssetResult = { imageUrl: "img.png", durationSec: 0 };
		mockGenerate.mockResolvedValue(expected);
		const dependencies = {
			previousVisual: { imageUrl: "frame.png", durationSec: 0 },
		};
		const { signal } = new AbortController();

		const result = await generateForElement(
			node,
			dependencies,
			signal,
			"canonical-project",
		);

		expect(createConnector).toHaveBeenCalledWith(
			"image",
			DEFAULT_MODELS.image,
			{},
		);
		expect(mockGenerate).toHaveBeenCalledWith(
			{ prompt: "a sunset", width: "1024", projectId: "canonical-project" },
			{ dependencies, reads: { "the art style": "noir" }, signal },
		);
		expect(result).toBe(expected);
	});

	it("propagates errors from connector.generate", async () => {
		mockGenerate.mockRejectedValue(new Error("generation failed"));

		await expect(
			generateForElement(node, {}, undefined, "canonical-project"),
		).rejects.toThrow("generation failed");
	});
	it.each([undefined, "", "  "])(
		"rejects missing project %s before connector transmission",
		async (projectId) => {
			await expect(
				generateForElement(node, {}, undefined, projectId),
			).rejects.toThrow("Choose a saved project");
			expect(createConnector).not.toHaveBeenCalled();
		},
	);
	it("overrides a project ID embedded in editable generation attributes", async () => {
		const altered = {
			...node,
			inputs: { ...node.inputs, attributes: { projectId: "wrong-project" } },
		};
		await generateForElement(altered, {}, undefined, "canonical-project");
		expect(mockGenerate).toHaveBeenCalledWith(
			expect.objectContaining({ projectId: "canonical-project" }),
			expect.anything(),
		);
	});
});
