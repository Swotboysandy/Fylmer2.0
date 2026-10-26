import { useEffect, useState } from "react";
import { toast } from "sonner";
import { toastError } from "@/lib/toast-error";
import { onPageHidden } from "@/lib/components/on-page-hidden";
import { createAutosaver, type Autosaver } from "@/lib/project/autosave";
import { readProjectSnapshot } from "@/lib/project/api";
import { useInitialScript } from "@/lib/script/script-provider";
import type { ProjectDocument } from "@/lib/project/project-document";
import { useProjectStoreHandle } from "@/lib/project/project-store-provider";
import { useGenerationQueue } from "@/lib/generation/generation-queue-provider";

const TOAST_OPTIONS = {
	id: "autosave",
	position: "bottom-right" as const,
	className:
		"!bg-muted !border !border-border !text-muted-foreground !text-label !shadow-none !rounded-md !py-1.5 !px-2.5 !min-h-0 !w-auto",
	duration: 1500,
};

export function useAutosave(
	projectId: string,
	document: ProjectDocument,
): Autosaver {
	const queue = useGenerationQueue();
	const store = useProjectStoreHandle();
	const initialScript = useInitialScript();

	const [autosaver] = useState(() =>
		createAutosaver({
			projectId,
			document,
			remote: {
				initialScript,
				read: (signal) => readProjectSnapshot(projectId, signal),
				merge: queue.mergeRemoteSnapshots,
			},
			onSaved: () => toast("Saved", TOAST_OPTIONS),
			onError: (error) =>
				toastError(error, "Save failed", {
					...TOAST_OPTIONS,
					duration: 4000,
				}),
		}),
	);

	useEffect(() => () => autosaver.flush(), [autosaver]);

	useEffect(() => onPageHidden(autosaver.flush), [autosaver]);

	useEffect(() => {
		const controller = new AbortController();
		const refresh = () => {
			if (globalThis.document.visibilityState === "visible")
				void autosaver.refreshRemote(controller.signal);
		};
		refresh();
		const timer = setInterval(refresh, 5000);
		globalThis.document.addEventListener("visibilitychange", refresh);
		return () => {
			controller.abort();
			clearInterval(timer);
			globalThis.document.removeEventListener("visibilitychange", refresh);
		};
	}, [autosaver]);

	useEffect(() => store.subscribe(autosaver.schedule), [store, autosaver]);

	useEffect(() => {
		let lastVersion = queue.getResultVersion();
		return queue.subscribe(() => {
			const version = queue.getResultVersion();
			if (version === lastVersion) return;
			lastVersion = version;
			autosaver.schedule();
		});
	}, [queue, autosaver]);

	return autosaver;
}
