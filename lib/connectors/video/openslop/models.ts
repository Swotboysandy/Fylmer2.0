import { RUNWARE_VIDEO_MODELS } from "../runware/models";

export const OPENSLOP_VIDEO_MODELS = {
	"Tresca H3": { id: "minimax-h3", cost: "high", speed: "low", resolutions: ["720p"] },
	"Kling 3 Omni": RUNWARE_VIDEO_MODELS["Kling 3 Omni"],
	"Seedance 2 Fast": RUNWARE_VIDEO_MODELS["Seedance 2 Fast"],
	"Kling 3 Turbo": RUNWARE_VIDEO_MODELS["Kling 3 Turbo"],
} as const;
