import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { buildFilmRunPlan } from "../run-plan";
import { compileFilmRunRequest } from "../compile-run-request";
import { quoteAssetCost } from "@/lib/api/asset-cost-quote";
import { vendorParams } from "@/lib/connectors/models";

afterEach(() => vi.unstubAllGlobals());
const selected = (
	result: Record<string, string | number>,
	connectorType = "image",
) => ({
	status: "idle",
	startedAt: null,
	result,
	resultInputs: null,
	error: null,
	pinned: true,
	connectorType,
});
const planFor = (script: string, generation = {}, store = {}) =>
	buildFilmRunPlan({ script, generation, store });

describe("canonical film run request compiler", () => {
	it("quotes the same duration and resolution sent by the selected Kling connector", async () => {
		const model = { provider: "runware", model: "Kling 3 Turbo" } as const;
		const plan = planFor(
			'<video id="shot" duration="8" resolution="1080p">A lighthouse.</video>',
			{},
			{ models: { video: model } },
		);
		const compiled = await compileFilmRunRequest(
			plan,
			"shot",
			{},
			randomUUID(),
		);
		const request = { ...compiled, ...model };
		expect(request).toMatchObject({
			duration: 8,
			resolution: "1080p",
			width: 1920,
			height: 1080,
		});
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				Response.json({
					info: {
						"x-air-id": "klingai:kling-video@3.0-turbo",
						"x-status": "live",
						"x-pricing": {
							currency: "USD",
							rates: [
								{ amount: 0.112, unit: "durationSecond", label: "720p" },
								{ amount: 0.14, unit: "durationSecond", label: "1080p" },
							],
						},
					},
				}),
			),
		);
		expect((await quoteAssetCost("video", request)).ceilingUsd).toBeCloseTo(
			1.12,
			5,
		);
		expect(vendorParams("video", request)).toMatchObject({
			model: "klingai:kling-video@3.0-turbo",
			duration: 8,
			resolution: "1080p",
		});
	});
	it.each(["music", "sound"])(
		"retains the planned %s request without adding an unrequested track",
		async (type) => {
			const plan = planFor(
				`--- Scene 1 ---\n<${type} id="audio">Quiet radio static.</${type}>`,
			);
			const request = await compileFilmRunRequest(
				plan,
				"audio",
				{},
				randomUUID(),
			);
			expect(request).toMatchObject({
				...plan.nodes[0].model,
				prompt: "Quiet radio static.",
			});
		},
	);
	it("does not let editable attributes replace the selected model or project", async () => {
		const plan = planFor(
			'--- Scene 1 ---\n<image id="shot">A lighthouse.</image>',
		);
		plan.nodes[0].inputs.attributes = {
			...plan.nodes[0].inputs.attributes,
			provider: "unplanned",
			model: "unplanned",
			projectId: randomUUID(),
		};
		const projectId = randomUUID();
		expect(
			await compileFilmRunRequest(plan, "shot", {}, projectId),
		).toMatchObject({ ...plan.nodes[0].model, projectId });
	});
	it("retains canonical style, dimensions, selected model and project without provider calls", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const plan = planFor(
			'<asset_style id="style">Claymation</asset_style>\n--- Scene 1 ---\n<image id="shot">A lighthouse.</image>',
			{},
			{ videoSettings: { aspectRatio: "9:16" } },
		);
		const projectId = randomUUID();
		const request = await compileFilmRunRequest(plan, "shot", {}, projectId);
		expect(request).toMatchObject({
			...plan.nodes[0].model,
			projectId,
			prompt: "Claymation. A lighthouse.",
		});
		expect(Number(request.width)).toBeLessThan(Number(request.height));
		expect(fetchMock).not.toHaveBeenCalled();
	});
	it("uses the selected canonical character portrait, not a second generated identity", async () => {
		const generation = {
			mira: selected({
				imageUrl: "https://example.invalid/mira.png",
				durationSec: 0,
			}),
		};
		const plan = planFor(
			'<asset_avatar id="mira" name="Mira">Radio engineer.</asset_avatar>\n--- Scene 1 ---\n<image id="shot">{{Mira}} at the radio.</image>',
			generation,
		);
		const request = await compileFilmRunRequest(
			plan,
			"shot",
			generation,
			randomUUID(),
		);
		expect(request).toMatchObject({
			characterAssets: [
				{ name: "Mira", avatarUrl: "https://example.invalid/mira.png" },
			],
		});
		expect(request.prompt).toContain("No nameplates");
		await expect(
			compileFilmRunRequest(plan, "shot", {}, randomUUID()),
		).rejects.toThrow("selected Mira's avatar");
	});
	it("retains the selected narrator voice for speech", async () => {
		const generation = {
			voice: selected(
				{
					voiceId: "voice-123",
					audioUrl: "https://example.invalid/voice.mp3",
					durationSec: 2,
				},
				"voice",
			),
		};
		const plan = planFor(
			'<asset_voice id="voice" name="Narrator"></asset_voice>\n--- Scene 1 ---\n<narration id="line">A signal arrives.</narration>',
			generation,
		);
		expect(
			await compileFilmRunRequest(plan, "line", generation, randomUUID()),
		).toMatchObject({ voiceId: "voice-123", prompt: "A signal arrives." });
	});
	it("uses the shared video plugin with worker-supplied frames rather than browser canvas", async () => {
		const generation = {
			previous: selected(
				{ videoUrl: "https://example.invalid/previous.mp4", durationSec: 5 },
				"video",
			),
		};
		const plan = planFor(
			'--- Scene 1 ---\n<video id="previous">Opening.</video>\n<video id="next" startFrame="previous">Continue.</video>',
			generation,
		);
		const capture = vi.fn(async (_url: string, keys: readonly string[]) =>
			keys.map((key) => `https://example.invalid/${key}.jpg`),
		);
		const request = await compileFilmRunRequest(
			plan,
			"next",
			generation,
			randomUUID(),
			capture,
		);
		expect(request).toMatchObject({
			frameImage: "https://example.invalid/last.jpg",
			continuityFrames: [
				"https://example.invalid/first.jpg",
				"https://example.invalid/middle.jpg",
			],
		});
		expect(request.prompt).toContain(
			"No subtitles, no watermarks, no logos, no music.",
		);
		expect(capture).toHaveBeenCalledTimes(2);
		await expect(
			compileFilmRunRequest(plan, "next", generation, randomUUID()),
		).rejects.toThrow("worker video-frame extractor");
	});
	it("reuses a preceding image directly without requiring video decoding", async () => {
		const generation = {
			previous: selected({
				imageUrl: "https://example.invalid/previous.png",
				durationSec: 0,
			}),
		};
		const plan = planFor(
			'--- Scene 1 ---\n<image id="previous">Opening.</image>\n<video id="next" startFrame="previous">Continue.</video>',
			generation,
		);
		const capture = vi.fn();
		expect(
			await compileFilmRunRequest(
				plan,
				"next",
				generation,
				randomUUID(),
				capture,
			),
		).toMatchObject({
			frameImage: "https://example.invalid/previous.png",
			continuityFrames: ["https://example.invalid/previous.png"],
		});
		expect(capture).not.toHaveBeenCalled();
	});
	it("refuses reused takes and unresolved dependency work", async () => {
		const generation = {
			previous: selected({
				imageUrl: "https://example.invalid/previous.png",
				durationSec: 0,
			}),
		};
		const plan = planFor(
			'--- Scene 1 ---\n<image id="previous">Opening.</image>\n<video id="next">Continue.</video>',
			generation,
		);
		await expect(
			compileFilmRunRequest(plan, "previous", generation, randomUUID()),
		).rejects.toThrow("not scheduled");
		await expect(
			compileFilmRunRequest(
				plan,
				"next",
				{ previous: { ...generation.previous, status: "generating" } },
				randomUUID(),
			),
		).rejects.toThrow("Wait for the selected");
	});
});
