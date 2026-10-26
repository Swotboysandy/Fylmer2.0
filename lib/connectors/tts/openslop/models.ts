import { CARTESIA_TTS_MODELS } from "../cartesia/models";

export const OPENSLOP_TTS_MODELS = {
	"Hosted speech": CARTESIA_TTS_MODELS["Sonic 3.6"],
	"Microsoft Speech": { id: "azure-neural", cost: "low", speed: "high" },
} as const;
