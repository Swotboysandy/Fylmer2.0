/** Settings for the installed ComfyUI fl2va checkpoint, not the hosted API. */
export const H3_FPS = 24;
export const H3_BASE_PIXELS = 1344 * 768;

export interface H3SettingsInput {
	durationSeconds?: number;
	width?: number;
	height?: number;
	turbo?: boolean;
	steps?: number;
	seed?: number;
}

export type H3QualityPreset = "fast" | "low" | "medium" | "high";
export const H3_QUALITY_PRESETS: readonly H3QualityPreset[] = [
	"fast",
	"low",
	"medium",
	"high",
];

/** A render preset changes sampling effort, not the trained model or its identity. */
export function h3QualityInput(
	input: H3SettingsInput,
	preset: H3QualityPreset = "medium",
): H3SettingsInput {
	if (!H3_QUALITY_PRESETS.includes(preset))
		throw new Error("Unsupported H3 quality preset.");
	const scale = preset === "fast" ? 0.75 : preset === "low" ? 0.875 : 1;
	const width = input.width ?? 1344;
	const height = input.height ?? 768;
	return {
		...input,
		width: Math.max(32, Math.floor((width * scale) / 32) * 32),
		height: Math.max(32, Math.floor((height * scale) / 32) * 32),
		steps: preset === "high" ? 30 : 20,
		turbo: false,
	};
}

export function h3Settings(input: H3SettingsInput = {}) {
	const duration = input.durationSeconds ?? 5;
	const width = input.width ?? 1344;
	const height = input.height ?? 768;
	const steps = input.steps ?? (input.turbo ? 8 : 20);
	if (!Number.isFinite(duration) || duration <= 0 || duration > 15) {
		throw new Error(
			"H3 duration must be greater than 0 and at most 15 seconds on this rig.",
		);
	}
	if (
		![width, height].every((n) => Number.isFinite(n) && n >= 32 && n <= 1344)
	) {
		throw new Error(
			"H3 dimensions must be finite numbers between 32 and 1344.",
		);
	}
	const W = Math.round(width / 32) * 32;
	const H = Math.round(height / 32) * 32;
	if (W * H > H3_BASE_PIXELS)
		throw new Error(
			"H3 canvas exceeds this rig's verified 1344 x 768 pixel budget.",
		);
	if (
		!Number.isInteger(steps) ||
		steps < (input.turbo ? 4 : 20) ||
		steps > 50
	) {
		throw new Error(
			input.turbo
				? "H3 Turbo steps must be an integer from 4 to 50."
				: "H3 base quality requires 20–50 steps; use Turbo explicitly for fewer steps.",
		);
	}
	if (
		input.seed !== undefined &&
		(!Number.isSafeInteger(input.seed) || input.seed < 0)
	) {
		throw new Error("H3 seed must be a non-negative safe integer.");
	}
	let frames = Math.max(5, Math.round(duration * H3_FPS));
	while (frames % 17 !== 5) frames++;
	return {
		width: W,
		height: H,
		frames,
		fps: H3_FPS,
		durationSeconds: frames / H3_FPS,
		steps,
		turbo: input.turbo === true,
	};
}

export const H3_CANVAS = {
	"16:9": [1344, 768],
	"9:16": [768, 1344],
	"1:1": [992, 992],
	"4:5": [896, 1120],
	"21:9": [1344, 576],
} as const;

export type H3ContinuityMode = "cut" | "continue";

/** Endpoints are conditioning, not a guarantee of identical decoded pixels. */
export function h3References(input: {
	mode: H3ContinuityMode;
	storyboard?: string | null;
	previousLastFrame?: string | null;
	explicitFirst?: string;
	explicitLast?: string;
	nextStoryboard?: string | null;
	endFrame?: boolean;
}) {
	const first =
		input.explicitFirst ||
		(input.mode === "continue" ? input.previousLastFrame : input.storyboard) ||
		undefined;
	if (input.mode === "continue" && !first) {
		throw new Error(
			"Continue needs the previous clip's actual final frame. Generate that clip first, or supply a start frame.",
		);
	}
	if (
		input.endFrame === true &&
		!input.explicitLast &&
		input.mode !== "continue"
	) {
		throw new Error(
			"Pinning the next shot requires Continue mode. For a deliberate cut, leave next-frame pinning off.",
		);
	}
	const last =
		input.endFrame === false
			? undefined
			: input.explicitLast ||
				(input.endFrame === true ? input.nextStoryboard : undefined) ||
				undefined;
	if (input.endFrame === true && !last)
		throw new Error(
			"No end frame is available to pin. Select the next storyboard frame first.",
		);
	return { first, last };
}

/** GPU render minutes one shot takes on the reference GPU. Measured base:
 *  about 12 minutes for 124 frames at 20 steps and 1344 x 768, scaling with
 *  frames, steps and pixels. A conservative estimate, not a promise of render
 *  time. GPU tokens are priced from this too (lib/auth/tokens.ts). */
export function h3RenderMinutes(input: H3SettingsInput): number {
	const s = h3Settings(input);
	return (
		12 *
		(s.frames / 124) *
		(s.steps / 20) *
		((s.width * s.height) / H3_BASE_PIXELS)
	);
}

export function estimateH3Spend(
	shots: H3SettingsInput[],
	hourlyRate: number,
	coldStart: boolean,
) {
	if (!shots.length || shots.length > 100)
		throw new Error("Estimate between 1 and 100 H3 shots.");
	if (!Number.isFinite(hourlyRate) || hourlyRate <= 0)
		throw new Error(
			"RunPod did not return a valid hourly rate; generation is blocked.",
		);
	const renderMinutes = shots.reduce(
		(total, input) => total + h3RenderMinutes(input),
		0,
	);
	const estimatedMinutes = (renderMinutes + (coldStart ? 12 : 0)) * 1.25;
	const estimatedCostUsd =
		Math.ceil((estimatedMinutes / 60) * hourlyRate * 100) / 100;
	const requiredBalanceUsd = Math.ceil((estimatedCostUsd + 0.1) * 100) / 100;
	return {
		shotCount: shots.length,
		hourlyRateUsd: hourlyRate,
		coldStart,
		estimatedMinutes,
		estimatedCostUsd,
		requiredBalanceUsd,
	};
}
