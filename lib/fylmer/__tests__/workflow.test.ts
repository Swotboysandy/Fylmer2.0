import { describe, expect, it } from "vitest";
import { generationGate } from "../review";
import { buildH3Workflow } from "../h3-workflow";
import { parseComfyDocument } from "../comfy-document";

describe("Fylmer workflow", () => {
	const review = {
		mode: null,
		bible: false,
		images: false,
		videos: false,
		finalCut: false,
		imageCount: 0,
		videoCount: 0,
	};
	it("requires Bible approval for images", () =>
		expect(generationGate(review, "image")).toContain("Film Bible"));
	it("does not force a mode choice after Bible approval", () =>
		expect(generationGate({ ...review, bible: true }, "image")).toBeNull());
	it("requires image approval for videos", () =>
		expect(
			generationGate(
				{ ...review, mode: "directed" as const, bible: true },
				"video",
			),
		).toContain("images"));
	it("allows approved image generation", () =>
		expect(
			generationGate(
				{ ...review, mode: "directed" as const, bible: true },
				"image",
			),
		).toBeNull());
	it("allows approved video generation", () =>
		expect(
			generationGate(
				{ ...review, mode: "autonomous" as const, bible: true, images: true },
				"video",
			),
		).toBeNull());
	it("builds actual Tresca video and audio outputs", () => {
		const { workflow } = buildH3Workflow({
			prompt: "A woman crosses a station. Footsteps and rain, no speech.",
			seed: 123,
		});
		const document = parseComfyDocument(workflow);
		expect(document.prompt["11"].class_type).toBe("SaveWEBM");
		expect(document.prompt["12"].class_type).toBe("SaveAudio");
		expect(document.prompt["8"].inputs.seed).toBe(123);
	});
	it("rejects unsafe settings", () =>
		expect(() => buildH3Workflow({ prompt: "Shot", width: 4096 })).toThrow());
	it("rejects disconnected nodes", () =>
		expect(() =>
			parseComfyDocument({
				one: { class_type: "SaveWEBM", inputs: { images: ["missing", 0] } },
			}),
		).toThrow());
	it("preserves Canvas positions", () => {
		const { workflow } = buildH3Workflow({ prompt: "Shot", seed: 1 });
		expect(
			parseComfyDocument({
				prompt: workflow,
				positions: { "1": { x: 100, y: 200 } },
			}).positions["1"],
		).toEqual({ x: 100, y: 200 });
	});
});
