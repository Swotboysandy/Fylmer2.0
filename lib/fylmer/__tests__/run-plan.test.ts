import { afterEach, describe, expect, it, vi } from "vitest";
import { buildFilmRunPlan } from "../run-plan";

afterEach(() => vi.unstubAllGlobals());

const saved = (script: string, generation = {}, store = {}) => ({
	script,
	generation,
	store,
});
const uploaded = {
	status: "idle",
	startedAt: null,
	result: { imageUrl: "https://example.invalid/selected.png", durationSec: 0 },
	error: null,
	resultInputs: null,
	connectorType: "image",
	pinned: true,
};

describe("canonical film run planner", () => {
	it("preserves scene order and produces deterministic serializable plans without network requests", () => {
		const fetchMock = vi.fn(() => {
			throw new Error("No network during planning");
		});
		vi.stubGlobal("fetch", fetchMock);
		const project = saved(
			'--- Scene 1 ---\n<image id="opening">Opening shot.</image>\n--- Scene 2 ---\n<image id="closing">Closing shot.</image>',
		);
		const plan = buildFilmRunPlan(project);
		expect(plan.rootIds).toEqual(["opening", "closing"]);
		expect(plan.nodes.map((node) => node.action)).toEqual([
			"generate",
			"generate",
		]);
		expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
		expect(buildFilmRunPlan(project)).toEqual(plan);
		expect(fetchMock).not.toHaveBeenCalled();
	});
	it("plans canonical character references before the scene that uses them", () => {
		const plan = buildFilmRunPlan(
			saved(
				'<asset_avatar id="mira" name="Mira">A radio engineer.</asset_avatar>\n--- Scene 1 ---\n<image id="shot">{{Mira}} at the transmitter.</image>',
			),
		);
		expect(plan.nodes.map((node) => node.id)).toEqual(["mira", "shot"]);
		expect(plan.nodes[1].dependsOn).toEqual({ "Mira's avatar": "mira" });
	});
	it("preserves an uploaded take without scheduling unused character generation", () => {
		const plan = buildFilmRunPlan(
			saved(
				'<asset_avatar id="mira" name="Mira">A radio engineer.</asset_avatar>\n--- Scene 1 ---\n<image id="shot">{{Mira}} at the transmitter.</image>',
				{ shot: uploaded },
			),
		);
		expect(plan.nodes).toHaveLength(1);
		expect(plan.nodes[0]).toMatchObject({
			id: "shot",
			action: "reuse",
			selectedTake: uploaded.result,
			dependsOn: {},
			pinned: true,
		});
	});
	it("includes an uploaded clip even when its prompt is empty", () => {
		const plan = buildFilmRunPlan(
			saved('--- Scene 1 ---\n<image id="shot"></image>', { shot: uploaded }),
		);
		expect(plan.rootIds).toEqual(["shot"]);
		expect(plan.nodes[0].action).toBe("reuse");
	});
	it("retains selected model identity rather than serializing plugin functions", () => {
		const plan = buildFilmRunPlan(
			saved(
				'--- Scene 1 ---\n<image id="shot" provider="openslop" model="Seedream 5 Lite">Opening.</image>',
			),
		);
		expect(plan.nodes[0].model).toEqual({
			provider: "openslop",
			model: "Seedream 5 Lite",
		});
		expect(plan.nodes[0]).not.toHaveProperty("config");
	});
	it("refuses duplicate IDs before graph deduplication can discard a clip", () => {
		expect(() =>
			buildFilmRunPlan(
				saved(
					'--- Scene 1 ---\n<image id="shot">One.</image>\n<image id="shot">Two.</image>',
				),
			),
		).toThrow("duplicate element IDs");
	});
	it("refuses unsaved generated IDs", () => {
		expect(() =>
			buildFilmRunPlan(saved("--- Scene 1 ---\n<image>One.</image>")),
		).toThrow("stable element IDs");
	});
	it.each(["queued", "generating"])(
		"does not treat %s media as settled",
		(status) => {
			expect(() =>
				buildFilmRunPlan(
					saved('--- Scene 1 ---\n<image id="shot">One.</image>', {
						shot: { ...uploaded, status },
					}),
				),
			).toThrow("must settle");
		},
	);
	it("plans narrator voice selection before speech", () => {
		const plan = buildFilmRunPlan(
			saved(
				'<asset_voice id="voice" name="Narrator"></asset_voice>\n--- Scene 1 ---\n<narration id="line">A signal arrives.</narration>',
			),
		);
		expect(plan.nodes.map((node) => node.id)).toEqual(["voice", "line"]);
		expect(plan.nodes[1].dependsOn).toEqual({ "Narrator's voice": "voice" });
	});
	it("refuses speech that has no canonical voice assignment", () => {
		expect(() =>
			buildFilmRunPlan(
				saved(
					'--- Scene 1 ---\n<narration id="line">A signal arrives.</narration>',
				),
			),
		).toThrow("Choose a saved voice");
	});
	it("preserves previous-shot continuity dependencies", () => {
		const plan = buildFilmRunPlan(
			saved(
				'--- Scene 1 ---\n<image id="opening">The radio tower.</image>\n<video id="motion" continuity="true">Move toward the tower.</video>',
			),
		);
		expect(plan.nodes.map((node) => node.id)).toEqual(["opening", "motion"]);
		expect(plan.nodes[1].dependsOn).toEqual({
			"the previous visual": "opening",
		});
	});
	it("rejects an empty film", () => {
		expect(() => buildFilmRunPlan(saved(""))).toThrow("Add scripted clips");
	});
});
