import memoize from "lodash/memoize";
import { OPENSLOP_IMAGE_MODELS } from "@/lib/connectors/image/openslop/models";
import { OPENSLOP_LLM_MODELS } from "@/lib/connectors/llm/openslop/models";
import { OPENSLOP_MUSIC_MODELS } from "@/lib/connectors/music/openslop/models";
import { OPENSLOP_SFX_MODELS } from "@/lib/connectors/sfx/openslop/models";
import { OPENSLOP_TTS_MODELS } from "@/lib/connectors/tts/openslop/models";
import { OPENSLOP_VIDEO_MODELS } from "@/lib/connectors/video/openslop/models";
import { MockImage } from "@/lib/providers/image/mock";
import { RunwareImage } from "@/lib/providers/image/runware";
import { AnthropicLLM } from "@/lib/providers/llm/anthropic";
import { MockLLM } from "@/lib/providers/llm/mock";
import { HostedCpuLLM } from "@/lib/providers/llm/hosted-cpu";
import { ElevenLabsMusic } from "@/lib/providers/music/elevenlabs";
import { MockMusic } from "@/lib/providers/music/mock";
import { ElevenLabsSFX } from "@/lib/providers/sfx/elevenlabs";
import { MockSFX } from "@/lib/providers/sfx/mock";
import { CartesiaTTS } from "@/lib/providers/tts/cartesia";
import { AzureSpeechTTS } from "@/lib/providers/tts/azure-speech";
import { MockTTS } from "@/lib/providers/tts/mock";
import type { ProviderType, Providers } from "@/lib/providers/types";
import { MockVideo } from "@/lib/providers/video/mock";
import { RunwareVideo } from "@/lib/providers/video/runware";
import { TrescaVideo } from "@/lib/providers/video/tresca";

const hosted = <R, M>(
	envVar: string,
	Real: new (apiKey: string) => R,
	Mock: new () => M,
): (() => R | M) =>
	memoize(() => {
		const apiKey = process.env[envVar];
		if (apiKey) return new Real(apiKey);
		if (
			process.env.FYLMER_ALLOW_MOCKS === "1" &&
			process.env.NODE_ENV === "test"
		)
			return new Mock();
		throw new Error(
			"This model is not connected in this Fylmer environment. No generation was started.",
		);
	});

const microsoftSpeech = memoize(() => {
	const apiKey = process.env.AZURE_SPEECH_KEY;
	const region = process.env.AZURE_SPEECH_REGION;
	if (!apiKey || !region)
		throw new Error(
			"Microsoft Speech is not connected in this Fylmer environment.",
		);
	return new AzureSpeechTTS(apiKey, region);
});

type Sources<K extends ProviderType, TModels> = Record<
	keyof TModels,
	() => Providers[K]
>;

/** Keyed by the model tables' own names, so a model cannot be listed without saying what serves it. */
const OPENSLOP_PROVIDERS: {
	llm: Sources<"llm", typeof OPENSLOP_LLM_MODELS>;
	tts: Sources<"tts", typeof OPENSLOP_TTS_MODELS>;
	image: Sources<"image", typeof OPENSLOP_IMAGE_MODELS>;
	video: Sources<"video", typeof OPENSLOP_VIDEO_MODELS>;
	sfx: Sources<"sfx", typeof OPENSLOP_SFX_MODELS>;
	music: Sources<"music", typeof OPENSLOP_MUSIC_MODELS>;
} = {
	llm: {
		"Fylmer Chat": () => new HostedCpuLLM(),
		"Claude Opus 5": hosted("ANTHROPIC_API_KEY", AnthropicLLM, MockLLM),
	},
	tts: {
		"Hosted speech": hosted("CARTESIA_API_KEY", CartesiaTTS, MockTTS),
		"Microsoft Speech": microsoftSpeech,
	},
	image: {
		"Seedream 5 Lite": hosted("RUNWARE_API_KEY", RunwareImage, MockImage),
	},
	video: {
		"Tresca H3": () => new TrescaVideo(),
		"Kling 3 Omni": hosted("RUNWARE_API_KEY", RunwareVideo, MockVideo),
		"Seedance 2 Fast": hosted("RUNWARE_API_KEY", RunwareVideo, MockVideo),
		"Kling 3 Turbo": hosted("RUNWARE_API_KEY", RunwareVideo, MockVideo),
	},
	sfx: {
		"Hosted sound effects": hosted(
			"ELEVENLABS_API_KEY",
			ElevenLabsSFX,
			MockSFX,
		),
	},
	music: {
		"Hosted music": hosted("ELEVENLABS_API_KEY", ElevenLabsMusic, MockMusic),
	},
};

export function hostedProviderFor<K extends ProviderType>(
	type: K,
	model: string,
): Providers[K] {
	const sources: Partial<Record<string, () => Providers[ProviderType]>> =
		OPENSLOP_PROVIDERS[type];
	const source = sources[model];
	if (!source) throw new Error(`Fylmer hosts no ${type} model "${model}"`);
	return source() as Providers[K];
}
