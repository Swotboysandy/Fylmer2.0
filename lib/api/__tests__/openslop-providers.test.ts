import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/providers/image/runware", () => ({ RunwareImage: vi.fn() }));
vi.mock("@/lib/providers/image/mock", () => ({ MockImage: vi.fn() }));
vi.mock("@/lib/providers/video/runware", () => ({ RunwareVideo: vi.fn() }));
vi.mock("@/lib/providers/video/mock", () => ({ MockVideo: vi.fn() }));
vi.mock("@/lib/providers/music/elevenlabs", () => ({
	ElevenLabsMusic: vi.fn(),
}));
vi.mock("@/lib/providers/music/mock", () => ({ MockMusic: vi.fn() }));
vi.mock("@/lib/providers/sfx/elevenlabs", () => ({ ElevenLabsSFX: vi.fn() }));
vi.mock("@/lib/providers/sfx/mock", () => ({ MockSFX: vi.fn() }));
vi.mock("@/lib/providers/llm/anthropic", () => ({ AnthropicLLM: vi.fn() }));
vi.mock("@/lib/providers/llm/mock", () => ({ MockLLM: vi.fn() }));
vi.mock("@/lib/providers/tts/cartesia", () => ({ CartesiaTTS: vi.fn() }));
vi.mock("@/lib/providers/tts/mock", () => ({ MockTTS: vi.fn() }));
vi.mock("@/lib/providers/tts/azure-speech", () => ({
	AzureSpeechTTS: vi.fn(),
}));

import { MockImage } from "@/lib/providers/image/mock";
import { MockVideo } from "@/lib/providers/video/mock";
import { MockMusic } from "@/lib/providers/music/mock";
import { MockSFX } from "@/lib/providers/sfx/mock";
import { MockLLM } from "@/lib/providers/llm/mock";
import { MockTTS } from "@/lib/providers/tts/mock";
import { hostedProviderFor } from "../providers/openslop";

describe("hostedProviderFor", () => {
	const originalEnv = process.env;
	beforeEach(() => {
		process.env = { ...originalEnv, FYLMER_ALLOW_MOCKS: "1" };
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it("returns MockImage/MockVideo when RUNWARE_API_KEY is missing", () => {
		process.env = { ...originalEnv, FYLMER_ALLOW_MOCKS: "1" };
		delete process.env.RUNWARE_API_KEY;

		expect(hostedProviderFor("image", "Seedream 5 Lite")).toBeInstanceOf(
			MockImage,
		);
		expect(hostedProviderFor("video", "Kling 3 Omni")).toBeInstanceOf(
			MockVideo,
		);
	});

	it("returns MockMusic/MockSFX when ELEVENLABS_API_KEY is missing", () => {
		process.env = { ...originalEnv, FYLMER_ALLOW_MOCKS: "1" };
		delete process.env.ELEVENLABS_API_KEY;

		expect(hostedProviderFor("music", "Hosted music")).toBeInstanceOf(
			MockMusic,
		);
		expect(hostedProviderFor("sfx", "Hosted sound effects")).toBeInstanceOf(
			MockSFX,
		);
	});

	it("returns MockLLM when ANTHROPIC_API_KEY is missing", () => {
		process.env = { ...originalEnv, FYLMER_ALLOW_MOCKS: "1" };
		delete process.env.ANTHROPIC_API_KEY;

		expect(hostedProviderFor("llm", "Claude Opus 5")).toBeInstanceOf(MockLLM);
	});

	it("returns MockTTS when CARTESIA_API_KEY is missing", () => {
		process.env = { ...originalEnv, FYLMER_ALLOW_MOCKS: "1" };
		delete process.env.CARTESIA_API_KEY;

		expect(hostedProviderFor("tts", "Hosted speech")).toBeInstanceOf(MockTTS);
	});

	it("builds each hosted model once", () => {
		expect(hostedProviderFor("tts", "Hosted speech")).toBe(
			hostedProviderFor("tts", "Hosted speech"),
		);
	});

	it.each([
		["image", "Seedream 5 Lite", "RUNWARE_API_KEY"],
		["tts", "Microsoft Speech", "AZURE_SPEECH_KEY"],
	] as const)(
		"keeps rejecting repeated missing %s connections and can recover",
		async (type, model, key) => {
			vi.resetModules();
			const { hostedProviderFor: resolve } =
				await import("../providers/openslop");
			process.env.FYLMER_ALLOW_MOCKS = "0";
			delete process.env[key];
			delete process.env.AZURE_SPEECH_REGION;
			for (let attempt = 0; attempt < 3; attempt++) {
				expect(() => resolve(type, model)).toThrow("not connected");
			}
			process.env[key] = "synthetic-test-key";
			process.env.AZURE_SPEECH_REGION = "eastus";
			const provider = resolve(type, model);
			expect(provider).toBeDefined();
			expect(resolve(type, model)).toBe(provider);
		},
	);

	it("throws for a model OpenSlop does not host", () => {
		expect(() => hostedProviderFor("image", "Unknown model")).toThrow(
			'Fylmer hosts no image model "Unknown model"',
		);
	});
});
