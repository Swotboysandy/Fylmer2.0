import { afterEach, expect, it, vi } from "vitest";
import { preflightRunModels } from "../preflight-run-models";

afterEach(() => vi.unstubAllGlobals());

it("checks model coverage without provider or pricing requests", () => {
	const fetch = vi.fn(() => {
		throw new Error("Unexpected request");
	});
	vi.stubGlobal("fetch", fetch);
	expect(() =>
		preflightRunModels({
			script: '<image id="shot">A lighthouse.</image>',
			store: {},
			generation: {},
		}),
	).not.toThrow();
	expect(fetch).not.toHaveBeenCalled();
});

it("rejects a mixed plan before any early image can incur cost", () => {
	expect(() =>
		preflightRunModels({
			script:
				'<image id="still">A lighthouse.</image><video id="shot">A lighthouse.</video>',
			store: {},
			generation: {},
		}),
	).toThrow("No run was started");
});

it("does not require a new generation price for a reused uploaded video", () => {
	expect(() =>
		preflightRunModels({
			script: '<video id="shot">A lighthouse.</video>',
			store: {},
			generation: {
				shot: {
					status: "idle",
					startedAt: null,
					result: {
						videoUrl: "https://example.invalid/owned.mp4",
						durationSec: 3,
					},
					error: null,
					resultInputs: null,
					connectorType: "video",
					pinned: true,
				},
			},
		}),
	).not.toThrow();
});
