import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/asset-bundle");
const mocks = vi.hoisted(() => ({
	compose: vi.fn(),
	convert: vi.fn(),
	client: vi.fn(),
	cache: vi.fn(),
	embed: vi.fn(),
}));
vi.mock("@elevenlabs/elevenlabs-js", () => ({
	ElevenLabsClient: class {
		constructor(options: unknown) {
			mocks.client(options);
		}
		music = { compose: mocks.compose };
		textToSoundEffects = { convert: mocks.convert };
	},
}));
vi.mock("@pinecone-database/pinecone", () => ({
	Pinecone: class {
		constructor() {
			mocks.cache();
			throw new Error("Unscoped audio cache must not be used");
		}
	},
}));
vi.mock("../embed", () => ({ embedText: mocks.embed }));

function audio() {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new Uint8Array(16000));
			controller.close();
		},
	});
}

describe("ElevenLabs audio account isolation", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		vi.stubEnv("PINECONE_API_KEY", "configured-but-unscoped");
		mocks.compose.mockImplementation(async () => audio());
		mocks.convert.mockImplementation(async () => audio());
	});
	afterEach(() => vi.unstubAllEnvs());

	it.each(["music", "sfx"] as const)(
		"%s never reads or publishes to the shared prompt cache",
		async (type) => {
			const Provider =
				type === "music"
					? (await import("../music/elevenlabs")).ElevenLabsMusic
					: (await import("../sfx/elevenlabs")).ElevenLabsSFX;
			const model = type === "music" ? "music_v1" : "eleven_text_to_sound_v2";
			for (const key of ["fixture-account-one", "fixture-account-two"]) {
				const result = await new Provider(key).generate({
					prompt: "Private unreleased scene cue",
					durationSeconds: 4,
					model,
				});
				expect(result.output.result.audio).toBe("url");
				expect(result.output.metadata?.cached).not.toBe(true);
				expect(result.costUsd).toBeGreaterThan(0);
				expect(result.costIsEstimate).toBe(true);
				expect(mocks.client).toHaveBeenCalledWith({ apiKey: key });
			}
			expect(
				type === "music" ? mocks.compose : mocks.convert,
			).toHaveBeenCalledTimes(2);
			expect(mocks.cache).not.toHaveBeenCalled();
			expect(mocks.embed).not.toHaveBeenCalled();
		},
	);
});
