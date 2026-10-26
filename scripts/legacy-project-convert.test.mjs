import { describe, expect, it } from "vitest";
import { convertLegacyProject } from "./legacy-project-convert.mjs";

describe("legacy project conversion", () => {
	it("keeps the source scene, storyboard and planned shot IDs in the working draft", () => {
		const converted = convertLegacyProject({
			snapshot: {
				projects: [
					{
						id: "old-project",
						title: "The Light",
						logline: "A choice",
						aspect_ratio: "16:9",
					},
				],
				characters: [{ id: "cast-1", name: "Maya", role: "Lead" }],
				beats: [
					{
						id: "beat-1",
						n: 1,
						scene_heading: "INT. VAULT",
						title: "Arrival",
						summary: "She enters",
					},
				],
				storyboard_variants: [
					{ id: "frame-1", beat_id: "beat-1", prompt: "Maya in the vault" },
				],
				film_runs: [{ id: "run-1", created_at: "2026-10-19" }],
				film_run_shots: [
					{
						id: "shot-1",
						run_id: "run-1",
						scene_number: 1,
						shot_number: 1,
						ordinal: 1,
						shot_json: JSON.stringify({ action: "Maya opens the door" }),
					},
				],
				assets: [{ id: "asset-1", kind: "image", url: "/oss/original.jpg" }],
			},
		});
		expect(converted.script).toContain('id="cast-1"');
		expect(converted.script).toContain('id="beat-1"');
		expect(converted.script).toContain('id="frame-1"');
		expect(converted.script).toContain('id="shot-1"');
		expect(converted.thumbnail_url).toBe("/oss/original.jpg");
	});
});
