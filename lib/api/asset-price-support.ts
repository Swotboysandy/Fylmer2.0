import type { ModelRef } from "@/lib/connectors/types";

export function supportsBoundedAssetPrice(
	type: string,
	model: ModelRef,
): boolean {
	if (
		type === "video" &&
		model.provider === "runware" &&
		model.model === "Kling 3 Turbo"
	)
		return true;
	return (
		type === "image" &&
		model.model === "Seedream 5 Lite" &&
		["openslop", "runware"].includes(model.provider)
	);
}
