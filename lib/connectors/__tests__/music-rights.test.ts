import { expect, it } from "vitest";
import { AssetResultSchema } from "../types";
import { GenerationSnapshotSchema } from "@/lib/generation/snapshots";

const audioUrl = "https://media.example/owned-track.wav";
const declaration = {
	status: "user-declared",
	audioUrl,
	basis: "original",
	statement: "I created this recording for my film.",
	evidence: "Original recording project reference: score-1",
	declaredAt: "2026-10-24T00:00:00Z",
};

it("keeps legacy media without inventing music rights", () => {
	expect(AssetResultSchema.parse({ audioUrl, durationSec: 8 })).toEqual({
		audioUrl,
		durationSec: 8,
	});
});

it("preserves the declaration through canonical snapshot serialization", () => {
	const saved = {
		score: {
			status: "idle",
			result: { audioUrl, durationSec: 8, musicRights: declaration },
			error: null,
			resultInputs: null,
			connectorType: "music",
			pinned: true,
		},
	};
	const parsed = GenerationSnapshotSchema.parse(
		JSON.parse(JSON.stringify(saved)),
	);
	expect(parsed.score.result?.musicRights).toEqual(declaration);
});

it.each(["https://media.example/another-take.wav", undefined])(
	"rejects a declaration attached to different or missing audio: %s",
	(selectedUrl) => {
		expect(
			AssetResultSchema.safeParse({
				audioUrl: selectedUrl,
				durationSec: 8,
				musicRights: declaration,
			}).success,
		).toBe(false);
	},
);

it.each([
	{ status: "verified" },
	{ evidence: " " },
	{ statement: " " },
	{ declaredAt: "yesterday" },
])("rejects unsupported or incomplete rights declarations: %j", (override) => {
	expect(
		AssetResultSchema.safeParse({
			audioUrl,
			durationSec: 8,
			musicRights: { ...declaration, ...override },
		}).success,
	).toBe(false);
});
