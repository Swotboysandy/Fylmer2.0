import { z } from "zod";
import type { BundleFile } from "@/lib/api/asset-bundle";
import type { VoiceInfo, VoiceSearchParams } from "@/lib/connectors/types";
import { DEFAULT_TTS_SPEED } from "@/lib/connectors/tts/enums";
import { BaseProvider, type RawResult } from "../base";
import { audioDurationSec } from "../audio-duration";
import type { TTSProvider, TTSRequest } from "./base";

const VoiceSchema = z.object({
	ShortName: z.string(),
	DisplayName: z.string(),
	Locale: z.string(),
	Gender: z.string(),
	VoiceType: z.string().optional(),
	Status: z.string().optional(),
});

type SpeechResult = RawResult & { data: Buffer; durationSec: number };

function escapeXml(value: string) {
	return value.replace(/[&<>"']/g, (character) => {
		const entities: Record<string, string> = {
			"&": "&amp;",
			"<": "&lt;",
			">": "&gt;",
			'"': "&quot;",
			"'": "&apos;",
		};
		return entities[character];
	});
}

function asVoiceInfo(voice: z.infer<typeof VoiceSchema>): VoiceInfo {
	return {
		id: voice.ShortName,
		name: voice.DisplayName,
		language: voice.Locale.split("-")[0],
		gender:
			voice.Gender === "Male"
				? "masculine"
				: voice.Gender === "Female"
					? "feminine"
					: undefined,
		description: `Microsoft ${voice.VoiceType ?? "neural"} voice · ${voice.Locale}`,
	};
}

export class AzureSpeechTTS
	extends BaseProvider<TTSRequest, SpeechResult>
	implements TTSProvider
{
	protected readonly blobConfig = { type: "tts", provider: "azure-speech" };
	private readonly baseUrl: string;

	constructor(
		private readonly apiKey: string,
		region: string,
	) {
		super();
		if (!/^[a-z0-9]+$/.test(region))
			throw new Error("Configure a valid Azure Speech region.");
		this.baseUrl = `https://${region}.tts.speech.microsoft.com`;
	}

	private async voices() {
		const response = await fetch(
			`${this.baseUrl}/cognitiveservices/voices/list`,
			{
				headers: { "Ocp-Apim-Subscription-Key": this.apiKey },
				signal: AbortSignal.timeout(15000),
			},
		);
		if (!response.ok)
			throw new Error("Microsoft Speech voices are unavailable.");
		return z.array(VoiceSchema).parse(await response.json());
	}

	async validate() {
		try {
			await this.voices();
			return { ok: true as const };
		} catch {
			return {
				ok: false as const,
				error: "Microsoft Speech is not connected.",
			};
		}
	}

	async search(params: VoiceSearchParams): Promise<VoiceInfo[]> {
		const query = params.query?.toLowerCase().trim();
		const voices = (await this.voices())
			.filter((voice) => voice.Status === "GA" || !voice.Status)
			.map(asVoiceInfo)
			.filter((voice) => !params.language || voice.language === params.language)
			.filter((voice) => !params.gender || voice.gender === params.gender)
			.filter(
				(voice) =>
					!query ||
					`${voice.name} ${voice.description}`.toLowerCase().includes(query),
			);
		return voices.slice(0, params.limit || voices.length);
	}

	async getVoice(voiceId: string): Promise<VoiceInfo | null> {
		const voice = (await this.voices()).find(
			(candidate) => candidate.ShortName === voiceId,
		);
		return voice ? asVoiceInfo(voice) : null;
	}

	async fetchVoicePreview(): Promise<Response> {
		throw new Error("Microsoft voice previews are generated on demand.");
	}

	protected toFiles(result: SpeechResult): BundleFile[] {
		return [
			{
				key: "audio",
				filename: "output.wav",
				data: result.data,
				contentType: "audio/wav",
			},
			{
				key: "timestamps",
				filename: "timestamps.json",
				data: "[]",
				contentType: "application/json",
			},
		];
	}

	protected async _generate(params: TTSRequest): Promise<SpeechResult> {
		const rate = Number(
			process.env.FYLMER_AZURE_TTS_USD_PER_MILLION_CHARACTERS,
		);
		if (!Number.isFinite(rate) || !(rate > 0))
			throw new Error(
				"Configure the Microsoft Speech usage rate before generation.",
			);
		if (!params.prompt.trim()) throw new Error("Enter text for this voice.");
		const voice = (await this.voices()).find(
			(candidate) => candidate.ShortName === params.voiceId,
		);
		if (!voice) throw new Error("Choose an available Microsoft voice.");
		const speed = params.speed ?? DEFAULT_TTS_SPEED;
		const pace = speed === "slow" ? "-20%" : speed === "fast" ? "+20%" : "+0%";
		const ssml = `<speak version="1.0" xml:lang="${escapeXml(voice.Locale)}"><voice name="${escapeXml(voice.ShortName)}"><prosody rate="${pace}">${escapeXml(params.prompt)}</prosody></voice></speak>`;
		const response = await fetch(`${this.baseUrl}/cognitiveservices/v1`, {
			method: "POST",
			headers: {
				"Ocp-Apim-Subscription-Key": this.apiKey,
				"Content-Type": "application/ssml+xml",
				"X-Microsoft-OutputFormat": "riff-24khz-16bit-mono-pcm",
				"User-Agent": "Fylmer",
			},
			body: ssml,
			signal: AbortSignal.timeout(60000),
		});
		if (!response.ok)
			throw new Error("Microsoft Speech could not generate audio.");
		const bytes = await response.arrayBuffer();
		const data = Buffer.from(bytes);
		if (
			data.length < 44 ||
			data.length > 50 * 1024 * 1024 ||
			data.toString("ascii", 0, 4) !== "RIFF"
		)
			throw new Error("Microsoft Speech returned invalid audio.");
		const durationSec = await audioDurationSec(bytes);
		if (!Number.isFinite(durationSec) || durationSec <= 0)
			throw new Error("Microsoft Speech returned invalid audio.");
		return {
			data,
			durationSec,
			costUsd: (params.prompt.length * rate) / 1_000_000,
			costIsEstimate: true,
			metadata: { durationSec },
		};
	}
}
