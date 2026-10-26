import { useState } from "react";
import { CONTENT_TYPES, type ContentElement } from "@/lib/canvas/types";
import { useGenerate } from "../hooks/use-generate";
import { PlaceholderBallsLoader } from "./preview/placeholder-balls";
import { MediaWithSkeleton } from "@/lib/components/media-with-skeleton";
import { getPrimaryUrl } from "@/lib/connectors/asset-url";

export function ForegroundPreview({ element }: { element: ContentElement }) {
	const [failedUrl, setFailedUrl] = useState<string | null>(null);
	const { result, status } = useGenerate(element);
	const { outputKind } = CONTENT_TYPES[element.type];
	const url = getPrimaryUrl(result, outputKind);
	const unavailable = Boolean(url && failedUrl === url);

	if (!url || unavailable) {
		return (
			<div className="relative w-full h-full rounded-lg overflow-hidden border bg-muted">
				{unavailable ? (
					<span className="flex size-full items-center justify-center p-2 text-center text-badge-xs text-muted-foreground">
						Preview unavailable
					</span>
				) : (
					<PlaceholderBallsLoader generating={status === "generating"} />
				)}
			</div>
		);
	}

	return (
		<div className="relative w-full h-full rounded-lg overflow-hidden border">
			<MediaWithSkeleton
				outputKind={outputKind}
				src={url}
				alt="Scene preview"
				onImageError={() => setFailedUrl(url)}
			/>
		</div>
	);
}
