import {
	h3Settings,
	type H3SettingsInput,
	type H3ContinuityMode,
} from "./h3-settings";

export function h3GenerationPrompt(direction: string) {
	if (!direction.trim()) throw new Error("H3 needs a shot direction.");
	return `${direction.trim()}\n\nPRODUCTION CONSTRAINTS: Preserve the supplied shot's medium, palette, lighting, identity and physical geography. Do not impose a different cinematic style. Follow its timed audio direction; unless speech is explicitly requested, use music and sound design without voices. No written characters, logos, captions or invented lettering anywhere, including reflections. Reserve titles and exact typography for post-production. First and last images are visual conditioning; follow their composition without treating them as a guarantee of identical output pixels.`;
}

/** Pure graph construction: safe to inspect and test without a pod or API key. */
export function buildH3Workflow(
	input: H3SettingsInput & {
		prompt: string;
		firstFrameName?: string;
		lastFrameName?: string;
		identityLora?: "unlit_v1";
	},
) {
	const s = h3Settings(input);
	if (input.identityLora && input.identityLora !== "unlit_v1")
		throw new Error("Unknown identity LoRA.");
	if (input.identityLora && s.turbo)
		throw new Error("The identity LoRA has not been verified with H3 Turbo.");
	const seed = input.seed ?? Math.floor(Math.random() * 1e9);
	const prompt = h3GenerationPrompt(input.prompt);
	const workflow: Record<
		string,
		{ class_type: string; inputs: Record<string, any> }
	> = {
		"1": {
			class_type: "UNETLoader",
			inputs: {
				unet_name: "minimax_h3_fl2va_pruned_fp8_scaled.safetensors",
				weight_dtype: "default",
			},
		},
		"2": {
			class_type: "CLIPLoader",
			inputs: {
				clip_name: "qwen3vl_32b_minimax_h3_int8_convrot.safetensors",
				type: "minimax",
			},
		},
		"3": {
			class_type: "VAELoader",
			inputs: { vae_name: "minimax_h3_video_vae_fp16.safetensors" },
		},
		"4": {
			class_type: "VAELoader",
			inputs: { vae_name: "minimax_h3_audio_vae_fp32.safetensors" },
		},
		"5": {
			class_type: "MiniMaxH3ImageToVideo",
			inputs: {
				clip: ["2", 0],
				vae: ["3", 0],
				prompt,
				width: s.width,
				height: s.height,
				length: s.frames,
				...(input.firstFrameName ? { first_frame: ["0", 0] } : {}),
				...(input.lastFrameName ? { last_frame: ["0e", 0] } : {}),
			},
		},
		"9": {
			class_type: "VAEDecode",
			inputs: { samples: ["8", 0], vae: ["3", 0] },
		},
		"10": {
			class_type: "VAEDecodeAudio",
			inputs: { samples: ["8", 0], vae: ["4", 0] },
		},
		"11": {
			class_type: "SaveWEBM",
			inputs: {
				images: ["9", 0],
				filename_prefix: "h3",
				codec: "vp9",
				fps: s.fps,
				crf: 18.0,
			},
		},
		"12": {
			class_type: "SaveAudio",
			inputs: { audio: ["10", 0], filename_prefix: "h3_audio" },
		},
	};
	if (input.firstFrameName)
		workflow["0"] = {
			class_type: "LoadImage",
			inputs: { image: input.firstFrameName },
		};
	if (input.lastFrameName)
		workflow["0e"] = {
			class_type: "LoadImage",
			inputs: { image: input.lastFrameName },
		};
	if (input.identityLora) {
		workflow["18"] = {
			class_type: "LoraLoaderModelOnly",
			inputs: {
				model: ["1", 0],
				lora_name: "unlit_v1.safetensors",
				strength_model: 1.0,
			},
		};
	}
	if (s.turbo) {
		Object.assign(workflow, {
			"13": {
				class_type: "MiniMaxH3TurboLoRA",
				inputs: {
					model: ["1", 0],
					lora_name: "minimax_h3_turbo_v4_step600_ema.safetensors",
					strength_model: 1,
				},
			},
			"14": { class_type: "RandomNoise", inputs: { noise_seed: seed } },
			"15": {
				class_type: "BasicGuider",
				inputs: { model: ["13", 0], conditioning: ["5", 0] },
			},
			"16": { class_type: "MiniMaxH3TurboSampler", inputs: {} },
			"17": {
				class_type: "BasicScheduler",
				inputs: {
					model: ["13", 0],
					scheduler: "simple",
					steps: s.steps,
					denoise: 1,
				},
			},
			"8": {
				class_type: "SamplerCustomAdvanced",
				inputs: {
					noise: ["14", 0],
					guider: ["15", 0],
					sampler: ["16", 0],
					sigmas: ["17", 0],
					latent_image: ["5", 1],
				},
			},
		});
	} else {
		Object.assign(workflow, {
			"6": {
				class_type: "MiniMaxH3SigmaShift",
				inputs: {
					model: [input.identityLora ? "18" : "1", 0],
					shift_video: 12.0,
					shift_audio: 3.0,
				},
			},
			"7": {
				class_type: "ConditioningZeroOut",
				inputs: { conditioning: ["5", 0] },
			},
			"8": {
				class_type: "KSampler",
				inputs: {
					model: ["6", 0],
					seed,
					steps: s.steps,
					cfg: 1.0,
					sampler_name: "euler",
					scheduler: "simple",
					positive: ["5", 0],
					negative: ["7", 0],
					latent_image: ["5", 1],
					denoise: 1.0,
				},
			},
		});
	}
	return { workflow, prompt, settings: { ...s, seed } };
}

/** Reference channels the installed ref2va checkpoint accepts.
 *  Node limits, enforced below: 9 images, 3 videos, 3 audio. */
export interface H3ReferenceInputs {
	/** Identity and design anchors — character sheet first, then world/style. */
	images?: string[];
	/** Preceding clip's frames. Carries motion, lighting and palette. */
	video?: string;
	/** That same clip's soundtrack. Only meaningful alongside `video`. */
	videoAudio?: string;
	/** Standalone sound the new shot should continue or sit inside. */
	audio?: string[];
}

const H3_REF_LIMITS = { images: 9, videos: 1, audio: 3 };

/** Prompt preamble naming each reference by the tag H3 expects.
 *  References are addressed as <Picture i>/<Video k>/<Audio j>, 1-based per type,
 *  so the text must agree with the wiring order or the model reads the wrong one. */
function h3ReferencePreamble(
	refs: H3ReferenceInputs,
	mode: H3ContinuityMode,
	imageLabels: string[],
) {
	const lines: string[] = [];
	const imageCount = refs.images?.length ?? 0;
	if (imageCount > 0) {
		const tags = Array.from(
			{ length: imageCount },
			(_, i) => `<Picture ${i + 1}>`,
		).join(", ");
		lines.push(
			`${tags} are IDENTITY and STYLE references. Match the people, costume, design language and palette they establish exactly. Do NOT reproduce their compositions, camera angles or layouts — this is a new shot.`,
		);
		if (imageLabels.length) {
			lines.push(
				imageLabels
					.map((label, index) => `<Picture ${index + 1}>: ${label}.`)
					.join("\n") +
					" Use each image for its named role. Do not swap the identities of distinct people between references.",
			);
		}
	}
	if (refs.video) {
		lines.push(
			mode === "continue"
				? `<Video 1> is the IMMEDIATELY PRECEDING SHOT. Continue directly from its final moment: same location, same time of day, same lighting, same colour grade, same characters. Do not reset the scene.`
				: `<Video 1> anchors character identity and overall render quality. This is a NEW shot: follow its own location, time, wardrobe, lighting and action rather than continuing the previous clip.`,
		);
	}
	if (refs.videoAudio) {
		lines.push(
			`<Audio 1> is the soundtrack of <Video 1>. Carry its ambience, key and intensity forward without restarting or changing character.`,
		);
	}
	const extraAudio = refs.audio?.length ?? 0;
	if (extraAudio > 0) {
		const offset = refs.videoAudio ? 1 : 0;
		const tags = Array.from(
			{ length: extraAudio },
			(_, i) => `<Audio ${i + 1 + offset}>`,
		).join(", ");
		lines.push(
			`${tags} set the sound bed this shot sits inside. Match their instrumentation and level.`,
		);
	}
	return lines.join("\n\n");
}

/** Pure ref2va graph. Unlike the fl2va path this conditions on whole clips and
 *  their sound, which is what holds identity and continuity across a sequence. */
export function buildH3ReferenceWorkflow(
	input: H3SettingsInput & {
		prompt: string;
		references: H3ReferenceInputs;
		imageLabels?: string[];
		mode?: H3ContinuityMode;
		/** "max" uses the 2048px reference pipeline: best identity, several times slower. */
		refImageSize?: "match" | "max";
	},
) {
	const s = h3Settings(input);
	const seed = input.seed ?? Math.floor(Math.random() * 1e9);
	const refs = input.references;
	const mode = input.mode ?? "cut";
	const images = refs.images ?? [];
	const audio = refs.audio ?? [];

	if (images.length > H3_REF_LIMITS.images)
		throw new Error(
			`H3 accepts at most ${H3_REF_LIMITS.images} reference images.`,
		);
	if (input.imageLabels && input.imageLabels.length !== images.length) {
		throw new Error("Each reference image needs one label in upload order.");
	}
	if (audio.length + (refs.videoAudio ? 1 : 0) > H3_REF_LIMITS.audio)
		throw new Error(
			`H3 accepts at most ${H3_REF_LIMITS.audio} reference audio inputs.`,
		);
	if (!images.length && !refs.video && !audio.length)
		throw new Error(
			"The reference path needs at least one reference; use the first/last-frame path for an unreferenced shot.",
		);
	if (refs.videoAudio && !refs.video)
		throw new Error(
			"Reference video audio must accompany its own reference video.",
		);
	if (mode === "continue" && !refs.video)
		throw new Error(
			"Continue mode needs the preceding clip as a reference video.",
		);

	const imageLabels = (input.imageLabels ?? []).map(
		(label, index) =>
			label
				.replace(/[<>\r\n]+/g, " ")
				.replace(/\s+/g, " ")
				.trim()
				.slice(0, 80) || `Image reference ${index + 1}`,
	);
	const preamble = h3ReferencePreamble(refs, mode, imageLabels);
	const prompt = `${preamble}\n\n${h3GenerationPrompt(input.prompt)}`;

	const workflow: Record<
		string,
		{ class_type: string; inputs: Record<string, any> }
	> = {
		"1": {
			class_type: "UNETLoader",
			inputs: {
				unet_name: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
				weight_dtype: "default",
			},
		},
		"2": {
			class_type: "CLIPLoader",
			inputs: {
				clip_name: "qwen3vl_32b_minimax_h3_int8_convrot.safetensors",
				type: "minimax",
			},
		},
		"3": {
			class_type: "VAELoader",
			inputs: { vae_name: "minimax_h3_video_vae_fp16.safetensors" },
		},
		"4": {
			class_type: "VAELoader",
			inputs: { vae_name: "minimax_h3_audio_vae_fp32.safetensors" },
		},
		"6": {
			class_type: "MiniMaxH3SigmaShift",
			inputs: { model: ["1", 0], shift_video: 12.0, shift_audio: 3.0 },
		},
		"7": {
			class_type: "ConditioningZeroOut",
			inputs: { conditioning: ["5", 0] },
		},
		"8": {
			class_type: "KSampler",
			inputs: {
				model: ["6", 0],
				seed,
				steps: s.steps,
				cfg: 1.0,
				sampler_name: "euler",
				scheduler: "simple",
				positive: ["5", 0],
				negative: ["7", 0],
				latent_image: ["5", 1],
				denoise: 1.0,
			},
		},
		"9": {
			class_type: "VAEDecode",
			inputs: { samples: ["8", 0], vae: ["3", 0] },
		},
		"10": {
			class_type: "VAEDecodeAudio",
			inputs: { samples: ["8", 0], vae: ["4", 0] },
		},
		"11": {
			class_type: "SaveWEBM",
			inputs: {
				images: ["9", 0],
				filename_prefix: "h3",
				codec: "vp9",
				fps: s.fps,
				crf: 18.0,
			},
		},
		"12": {
			class_type: "SaveAudio",
			inputs: { audio: ["10", 0], filename_prefix: "h3_audio" },
		},
	};

	// Autogrow inputs must arrive as a dict keyed ref_x_0, ref_x_1, ...; passing
	// them as flattened top-level inputs is rejected by the node.
	const refImages: Record<string, [string, number]> = {};
	images.forEach((name, i) => {
		const id = `100${i}`;
		workflow[id] = { class_type: "LoadImage", inputs: { image: name } };
		refImages[`ref_image_${i}`] = [id, 0];
	});
	const refAudios: Record<string, [string, number]> = {};
	audio.forEach((name, i) => {
		const id = `200${i}`;
		workflow[id] = { class_type: "LoadAudio", inputs: { audio: name } };
		refAudios[`ref_audio_${i}`] = [id, 0];
	});

	const refVideos: Record<string, [string, number]> = {};
	const refVideoAudios: Record<string, [string, number]> = {};
	if (refs.video) {
		workflow["300"] = { class_type: "LoadVideo", inputs: { file: refs.video } };
		workflow["301"] = {
			class_type: "GetVideoComponents",
			inputs: { video: ["300", 0] },
		};
		refVideos["ref_video_0"] = ["301", 0];
		// Frames and soundtrack come off the same decode, so they cannot desync.
		if (refs.videoAudio) refVideoAudios["ref_video_audio_0"] = ["301", 1];
	}

	workflow["5"] = {
		class_type: "MiniMaxH3ReferenceToVideo",
		inputs: {
			clip: ["2", 0],
			vae: ["3", 0],
			audio_vae: ["4", 0],
			prompt,
			width: s.width,
			height: s.height,
			length: s.frames,
			ref_image_size: input.refImageSize ?? "match",
			...(Object.keys(refImages).length ? { ref_images: refImages } : {}),
			...(Object.keys(refVideos).length ? { ref_videos: refVideos } : {}),
			...(Object.keys(refVideoAudios).length
				? { ref_video_audios: refVideoAudios }
				: {}),
			...(Object.keys(refAudios).length ? { ref_audios: refAudios } : {}),
		},
	};

	return { workflow, prompt, settings: { ...s, seed } };
}
