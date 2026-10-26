import { ANTHROPIC_LLM_MODELS } from "../anthropic/models";

export const OPENSLOP_LLM_MODELS = {
	"Fylmer Chat": { id: "hosted-cpu", cost: "low", speed: "high" },
	"Claude Opus 5": ANTHROPIC_LLM_MODELS["Claude Opus 5"],
} as const;
