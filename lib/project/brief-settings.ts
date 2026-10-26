import { ASPECT_RATIOS, type AspectRatio } from "./aspect-ratio";
import { LANGUAGE_CHOICES, languageLabel, type LanguageChoice } from "./language";
import { VIDEO_FORMAT_TARGETS, type VideoFormat } from "./video-format";
import { VIDEO_LENGTH_TARGETS, type VideoLength } from "./video-length";

export type BriefSettings = {
	aspectRatio?: AspectRatio;
	format?: VideoFormat;
	language?: LanguageChoice;
	length?: VideoLength;
};

export type AutoSetting<T extends string> = {
	previous: T;
	selected: T;
};

export function reconcileBriefSetting<T extends string>(
	current: T,
	suggested: T | undefined,
	automatic: AutoSetting<T> | undefined,
): { value: T; automatic?: AutoSetting<T>; overridden: boolean } {
	if (automatic && current !== automatic.selected)
		return { value: current, overridden: true };
	if (suggested)
		return {
			value: suggested,
			automatic: {
				previous: automatic?.previous ?? current,
				selected: suggested,
			},
			overridden: false,
		};
	return {
		value: automatic?.previous ?? current,
		overridden: false,
	};
}

function uniqueMatch<T extends string>(matches: readonly T[]): T | undefined {
	const values = new Set(matches);
	return values.size === 1 ? values.values().next().value : undefined;
}

function aspectRatio(text: string): AspectRatio | undefined {
	const explicit = ASPECT_RATIOS.filter((ratio) =>
		new RegExp(`\\b${ratio.replace(":", "\\s*[:x/]\\s*")}\\b`, "i").test(text),
	);
	if (explicit.length > 0) return uniqueMatch(explicit);
	return uniqueMatch(
		[
			/\b(?:shorts?|reels?|tiktok|vertical|portrait)\b/i.test(text) && "9:16",
			/\b(?:widescreen|landscape|horizontal)\b/i.test(text) && "16:9",
		].filter((ratio): ratio is AspectRatio => Boolean(ratio)),
	);
}

const FORMAT_CUES: Record<(typeof VIDEO_FORMAT_TARGETS)[number], RegExp> = {
	cinematic: /\b(?:cinematic|film trailer|movie trailer|music video)\b/i,
	faceless: /\b(?:faceless|no[- ]face)\b/i,
	explainer: /\b(?:explainer|tutorial|documentary|product tour)\b/i,
};

function format(text: string): VideoFormat | undefined {
	return uniqueMatch(
		VIDEO_FORMAT_TARGETS.filter((choice) => FORMAT_CUES[choice].test(text)),
	);
}

const LANGUAGE_CUES = LANGUAGE_CHOICES.filter(
	(choice): choice is Exclude<LanguageChoice, "auto"> => choice !== "auto",
).map((choice) => {
	const name = languageLabel(choice).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return {
		choice,
		before: new RegExp(
			`\\b(?:in|spoken in|narrated in|voiceover in|language:?|speaking)\\s+${name}\\b`,
			"i",
		),
		after: new RegExp(
			`\\b${name}(?:-language|\\s+(?:language|voiceover|narration|dialogue|video|film|short|script))\\b`,
			"i",
		),
	};
});

function language(text: string): LanguageChoice | undefined {
	return uniqueMatch(
		LANGUAGE_CUES.filter(
			({ before, after }) => before.test(text) || after.test(text),
		).map(({ choice }) => choice),
	);
}

const LENGTH_RANGES = VIDEO_LENGTH_TARGETS.filter((choice) => /^\d+-\d+m$/.test(choice)).map((choice) => {
	const [minimum, maximum] = choice.split("-").map(Number);
	return {
		choice,
		pattern: new RegExp(
			`\\b${minimum}\\s*(?:-|–|to)\\s*${maximum}\\s*(?:m|min|minutes?)\\b`,
			"i",
		),
	};
});

function lengthBucket(seconds: number): VideoLength | undefined {
	if (seconds <= 0) return undefined;
	if (seconds <= 30) return "under-30s";
	if (seconds <= 60) return "under-1m";
	if (seconds <= 180) return "1-3m";
	if (seconds <= 300) return "3-5m";
	if (seconds <= 600) return "5-10m";
	if (seconds <= 900) return "10-15m";
	if (seconds <= 1200) return "15-20m";
	if (seconds <= 1800) return "20-30m";
	return undefined;
}

function length(text: string): VideoLength | undefined {
	const explicit: VideoLength[] = [
		...LENGTH_RANGES.filter(({ pattern }) => pattern.test(text)).map(
			({ choice }) => choice,
		),
		...(/\b(?:under|less than)\s*30\s*(?:s|sec|seconds?)\b/i.test(text)
			? (["under-30s"] as const)
			: []),
		...(/\b(?:under|less than)\s*(?:1|one)\s*(?:m|min|minutes?)\b/i.test(text)
			? (["under-1m"] as const)
			: []),
	];
	if (explicit.length > 0) return uniqueMatch(explicit);

	const duration = text.match(
		/\b(\d{1,2})\s*[- ]?\s*(seconds?|secs?|s|minutes?|mins?|m)\s+(?:long\s+)?(?:short|reel|video|film|clip|trailer|story)\b/i,
	);
	if (!duration) return undefined;
	const amount = Number(duration[1]);
	const seconds = duration[2].toLowerCase().startsWith("m")
		? amount * 60
		: amount;
	return lengthBucket(seconds);
}

export function inferBriefSettings(text: string): BriefSettings {
	return {
		aspectRatio: aspectRatio(text),
		format: format(text),
		language: language(text),
		length: length(text),
	};
}
