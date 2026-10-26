import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { AssetBundle } from "@/lib/api/asset-bundle";
import { resolveCompletedRunResult } from "../completed-run-result";

const originalBase = AssetBundle.baseUrl;
const fetchMock = vi.fn();
beforeEach(() => {
	AssetBundle.baseUrl = "https://media.example.invalid";
	fetchMock.mockReset();
	vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
	AssetBundle.baseUrl = originalBase;
	vi.unstubAllGlobals();
});

function completed(
	type: "image" | "video" | "tts" | "music" | "sfx" = "image",
	duration = 0,
) {
	return {
		id: randomUUID(),
		status: "completed",
		connector_type: type,
		request: { provider: "openslop", model: "fixture-model" },
		result: {
			id: "take-1",
			type,
			provider: "openslop",
			result: {
				image: "image.png",
				video: "video.mp4",
				audio: "audio.mp3",
				timestamps: "timestamps.json",
			},
			metadata: { durationSec: duration },
		},
	};
}

describe("completed film-run result conversion", () => {
	it.each(["image", "video", "music", "sfx"] as const)(
		"uses the native %s media shape without generating or fetching media",
		async (type) => {
			const field =
				type === "image"
					? "imageUrl"
					: type === "video"
						? "videoUrl"
						: "audioUrl";
			const file =
				type === "image"
					? "image.png"
					: type === "video"
						? "video.mp4"
						: "audio.mp3";
			expect(
				await resolveCompletedRunResult(
					completed(type, type === "image" ? 0 : 4.25),
				),
			).toEqual({
				[field]: `https://media.example.invalid/assets/${type}/openslop/take-1/${file}`,
				durationSec: type === "image" ? 0 : 4.25,
			});
			expect(fetchMock).not.toHaveBeenCalled();
		},
	);
	it("preserves native speech captions and measured duration", async () => {
		const timestamps = [
			{ text: "A", start: 0, end: 0.3 },
			{ text: "signal", start: 0.4, end: 1.2 },
		];
		fetchMock.mockResolvedValue(new Response(JSON.stringify(timestamps)));
		expect(await resolveCompletedRunResult(completed("tts", 1.3))).toEqual({
			audioUrl:
				"https://media.example.invalid/assets/tts/openslop/take-1/audio.mp3",
			durationSec: 1.3,
			textTimestamps: timestamps,
		});
		expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
			"https://media.example.invalid/assets/tts/openslop/take-1/timestamps.json",
			{ redirect: "error", signal: expect.any(AbortSignal) },
		);
	});
	it.each(["pending", "processing", "failed"])(
		"never selects a %s job",
		async (status) => {
			await expect(
				resolveCompletedRunResult({ ...completed(), status }),
			).rejects.toThrow();
			expect(fetchMock).not.toHaveBeenCalled();
		},
	);
	it.each([0, -1, NaN, Infinity])(
		"rejects invalid moving-media duration %s",
		async (duration) => {
			await expect(
				resolveCompletedRunResult(completed("video", duration)),
			).rejects.toThrow();
		},
	);
	it("rejects a bundle for the wrong connector", async () => {
		const job = completed();
		await expect(
			resolveCompletedRunResult({
				...job,
				result: { ...job.result, type: "video" },
			}),
		).rejects.toThrow("does not match");
	});
	it("preserves the actual Tresca storage identity behind the hosted model gateway", async () => {
		const job = completed("video", 5);
		job.result.provider = "tresca";
		expect(await resolveCompletedRunResult(job)).toEqual({
			videoUrl:
				"https://media.example.invalid/assets/video/tresca/take-1/video.mp4",
			durationSec: 5,
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});
	it.each([
		"../escape.json",
		"https://elsewhere.invalid/timestamps.json",
		"http://127.0.0.1/private",
		"//elsewhere.invalid/timestamps.json",
	])("refuses unsafe timestamp source %s before fetching", async (url) => {
		const job = completed("tts", 1);
		job.result.result.timestamps = url;
		await expect(resolveCompletedRunResult(job)).rejects.toThrow();
		expect(fetchMock).not.toHaveBeenCalled();
	});
	it("refuses malformed storage identity and absent media without fetching", async () => {
		const job = completed();
		job.result.id = "../other-take";
		await expect(resolveCompletedRunResult(job)).rejects.toThrow(
			"storage identity",
		);
		job.result.id = "take-1";
		job.result.result.image = "";
		await expect(resolveCompletedRunResult(job)).rejects.toThrow("No file");
		expect(fetchMock).not.toHaveBeenCalled();
	});
	it.each([
		[{ text: "bad", start: -1, end: 0.5 }],
		[{ text: "bad", start: 1, end: 0.5 }],
		[{ text: "bad", start: 0, end: 10 }],
		[
			{ text: "later", start: 1, end: 1.2 },
			{ text: "earlier", start: 0, end: 0.5 },
		],
	])("rejects invalid speech timing %j", async (...timestamps) => {
		fetchMock.mockResolvedValue(new Response(JSON.stringify(timestamps)));
		await expect(
			resolveCompletedRunResult(completed("tts", 2)),
		).rejects.toThrow("Speech timestamps");
	});
	it("propagates timestamp storage failure instead of dropping captions", async () => {
		fetchMock.mockResolvedValue(new Response("missing", { status: 404 }));
		await expect(
			resolveCompletedRunResult(completed("tts", 2)),
		).rejects.toThrow("404");
	});
});
