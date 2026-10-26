"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createStoreContext } from "@/lib/store/create-store-context";
import { GenerationQueue } from "./queue";
import type { ElementSnapshot } from "./snapshots";

const [GenerationQueueContext, useGenerationQueue, useQueueSelector] =
	createStoreContext<GenerationQueue>("GenerationQueueContext");
export { useGenerationQueue, useQueueSelector };

export function GenerationQueueProvider({
	projectId,
	initialState,
	children,
}: {
	projectId: string;
	initialState: Record<string, ElementSnapshot>;
	children: ReactNode;
}) {
	const [queue] = useState(
		() => new GenerationQueue({ initialState, projectId }),
	);
	useEffect(() => () => queue.cancelAll(), [queue]);
	return (
		<GenerationQueueContext value={queue}>{children}</GenerationQueueContext>
	);
}
