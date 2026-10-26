import { expect, it, vi } from "vitest";
import { GenerationQueue } from "../queue";
import type { ElementSnapshot } from "../snapshots";

const audioUrl = "https://media.example/score.wav";
const declaration = {
	status: "user-declared",
	audioUrl,
	basis: "original",
	statement: "My original score",
	evidence: "Recording project",
	declaredAt: "2026-10-24T00:00:00Z",
};
const snapshot = (): ElementSnapshot => ({
	status: "idle",
	startedAt: null,
	result: { audioUrl, durationSec: 8 },
	error: null,
	resultInputs: null,
	connectorType: "music",
	pinned: true,
});

it("updates canonical metadata and notifies autosave without creating a new generated take", () => {
	const original = snapshot();
	const queue = new GenerationQueue({ initialState: { score: original } });
	const changed = vi.fn();
	const committed = vi.fn();
	queue.subscribe(changed);
	queue.onCommitted(committed);
	const version = queue.getResultVersion();
	queue.setMusicRights("score", audioUrl, declaration);
	expect(queue.getElementSnapshot("score")).toEqual({
		...original,
		result: { ...original.result, musicRights: declaration },
	});
	expect(changed).toHaveBeenCalledTimes(1);
	expect(queue.getResultVersion()).toBeGreaterThan(version);
	expect(committed).not.toHaveBeenCalled();
});

it.each(["missing", "changed", "wrong-type", "invalid", "mismatched-evidence"])(
	"does not mutate metadata when %s",
	(variant) => {
		const original = snapshot();
		if (variant === "wrong-type") original.connectorType = "tts";
		const queue = new GenerationQueue({ initialState: { score: original } });
		const changed = vi.fn();
		queue.subscribe(changed);
		expect(() =>
			queue.setMusicRights(
				variant === "missing" ? "missing" : "score",
				variant === "changed" ? "https://media.example/other.wav" : audioUrl,
				variant === "invalid"
					? {}
					: variant === "mismatched-evidence"
						? { ...declaration, audioUrl: "https://media.example/other.wav" }
						: declaration,
			),
		).toThrow();
		expect(queue.getElementSnapshot("score")).toEqual(original);
		expect(changed).not.toHaveBeenCalled();
	},
);
