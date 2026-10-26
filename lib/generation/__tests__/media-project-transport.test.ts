import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MODELS } from "@/lib/connectors/models";
import { generateForElement } from "../generate-for-element";
import { jobNode } from "./_graph";

afterEach(() => vi.unstubAllGlobals());

describe("media project HTTP transport", () => {
	it.each(["image", "video", "music", "sfx", "tts"] as const)(
		"sends canonical project identity through the real %s connector",
		async (connectorType) => {
			const fetchMock = vi
				.fn()
				.mockResolvedValue(
					Response.json(
						{ error: "Generation disabled for test" },
						{ status: 409 },
					),
				);
			vi.stubGlobal("fetch", fetchMock);
			const node = jobNode("fixture", [], {
				connectorType,
				attributes: { projectId: "editable-wrong-project" },
			});
			node.job.model = DEFAULT_MODELS[connectorType];
			await expect(
				generateForElement(node, {}, undefined, "owned-project"),
			).rejects.toThrow("Generation disabled for test");
			expect(fetchMock).toHaveBeenCalledOnce();
			const [url, init] = fetchMock.mock.calls[0];
			expect(url).toContain(`/${connectorType}`);
			expect(init.method).toBe("POST");
			expect(JSON.parse(init.body)).toMatchObject({
				projectId: "owned-project",
				prompt: "fixture",
			});
		},
	);
});
