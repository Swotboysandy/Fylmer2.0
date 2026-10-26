import { describe, expect, it } from "vitest";
import { inferBriefSettings, reconcileBriefSetting } from "../brief-settings";

describe("inferBriefSettings", () => {
	it("picks vertical framing from a short brief", () => {
		expect(inferBriefSettings("Make a short about a lost puppy")).toMatchObject({
			aspectRatio: "9:16",
		});
	});

	it("lets an explicit ratio beat a platform cue", () => {
		expect(inferBriefSettings("A widescreen 9:16 short").aspectRatio).toBe(
			"9:16",
		);
		expect(inferBriefSettings("A 16:9 TikTok clip").aspectRatio).toBe(
			"16:9",
		);
	});

	it("leaves contradictory framing and formats unchanged", () => {
		expect(inferBriefSettings("Vertical and landscape versions").aspectRatio).toBeUndefined();
		expect(inferBriefSettings("A faceless cinematic video").format).toBeUndefined();
	});

	it("recognizes named formats and spoken language without treating nationality as language", () => {
		expect(inferBriefSettings("A faceless documentary narrated in Hindi")).toMatchObject({
			language: "hi",
		});
		expect(inferBriefSettings("An explainer video in French")).toMatchObject({
			format: "explainer",
			language: "fr",
		});
		expect(inferBriefSettings("A French chef makes dinner").language).toBeUndefined();
	});

	it("recognizes explicit runtimes but not scene timing", () => {
		expect(inferBriefSettings("Make a 30-second short").length).toBe("under-30s");
		expect(inferBriefSettings("A 2 minute video").length).toBe("1-3m");
		expect(inferBriefSettings("A 3-5 min film").length).toBe("3-5m");
		expect(inferBriefSettings("She waits 30 seconds").length).toBeUndefined();
	});
});

describe("reconcileBriefSetting", () => {
	it("restores the previous setting when the cue is removed", () => {
		const selected = reconcileBriefSetting("16:9", "9:16", undefined);
		expect(selected).toEqual({
			value: "9:16",
			automatic: { previous: "16:9", selected: "9:16" },
			overridden: false,
		});
		expect(
			reconcileBriefSetting("9:16", undefined, selected.automatic),
		).toEqual({ value: "16:9", overridden: false });
	});

	it("stops applying suggestions after an external manual change", () => {
		expect(
			reconcileBriefSetting("16:9", "9:16", {
				previous: "16:9",
				selected: "9:16",
			}),
		).toEqual({ value: "16:9", overridden: true });
	});
});
