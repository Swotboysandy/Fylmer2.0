import { afterEach, describe, expect, it, vi } from "vitest";
import type { TTSRequest } from "../tts/base";
import { AzureSpeechTTS } from "../tts/azure-speech";
import { wavFromPcm } from "../wav";

function speechWav(withMetadata = false) {
	const wav = wavFromPcm(Buffer.alloc(48000), {
		audioFormat: 1,
		channels: 1,
		sampleRate: 24000,
		bitsPerSample: 16,
	});
	if (!withMetadata) return wav;
	const chunk = Buffer.alloc(48008);
	chunk.write("JUNK", 0);
	chunk.writeUInt32LE(48000, 4);
	const extended = Buffer.concat([
		wav.subarray(0, 36),
		chunk,
		wav.subarray(36),
	]);
	extended.writeUInt32LE(extended.length - 8, 4);
	return extended;
}

const voice = {
	ShortName: "en-US-JennyNeural",
	DisplayName: "Jenny",
	Locale: "en-US",
	Gender: "Female",
	VoiceType: "Neural",
	Status: "GA",
};

class TestAzureSpeechTTS extends AzureSpeechTTS {
	generateRaw(request: TTSRequest) {
		return this._generate(request);
	}
}

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

describe("AzureSpeechTTS", () => {
	it("lists Microsoft voices from the configured region", async () => {
		const fetchMock = vi.fn().mockResolvedValue(Response.json([voice]));
		vi.stubGlobal("fetch", fetchMock);
		const provider = new AzureSpeechTTS("test-key", "centralindia");

		expect(
			await provider.search({ language: "en", gender: "feminine" }),
		).toEqual([
			{
				id: "en-US-JennyNeural",
				name: "Jenny",
				language: "en",
				gender: "feminine",
				description: "Microsoft Neural voice · en-US",
			},
		]);
		expect(fetchMock.mock.calls[0][0]).toBe(
			"https://centralindia.tts.speech.microsoft.com/cognitiveservices/voices/list",
		);
	});

	it.each([false, true])(
		"escapes script text and measures audio, not metadata: %s",
		async (withMetadata) => {
			vi.stubEnv("FYLMER_AZURE_TTS_USD_PER_MILLION_CHARACTERS", "15");
			const wav = speechWav(withMetadata);
			const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
				if (url.endsWith("/voices/list")) return Response.json([voice]);
				expect(init?.body).toContain("Tom &amp; Jerry");
				expect(init?.body).toContain('name="en-US-JennyNeural"');
				return new Response(new Uint8Array(wav), {
					headers: { "Content-Type": "audio/wav" },
				});
			});
			vi.stubGlobal("fetch", fetchMock);
			const provider = new TestAzureSpeechTTS("test-key", "centralindia");

			const result = await provider.generateRaw({
				model: "azure-neural",
				voiceId: voice.ShortName,
				prompt: "Tom & Jerry",
			});
			expect(result.durationSec).toBe(1);
			expect(result.costUsd).toBe(("Tom & Jerry".length * 15) / 1_000_000);
			expect(result.costIsEstimate).toBe(true);
			expect(fetchMock).toHaveBeenCalledTimes(2);
		},
	);

	it.each(["", "Infinity", "NaN", "-1"])(
		"does not call Microsoft with an invalid usage rate: %s",
		async (rate) => {
			vi.stubEnv("FYLMER_AZURE_TTS_USD_PER_MILLION_CHARACTERS", rate);
			const fetchMock = vi.fn();
			vi.stubGlobal("fetch", fetchMock);
			const provider = new TestAzureSpeechTTS("test-key", "centralindia");
			await expect(
				provider.generateRaw({
					model: "azure-neural",
					voiceId: voice.ShortName,
					prompt: "Hello",
				}),
			).rejects.toThrow("usage rate");
			expect(fetchMock).not.toHaveBeenCalled();
		},
	);
});
