import debounce from "lodash/debounce";
import isEqual from "lodash/isEqual";
import PQueue from "p-queue";
import { createEmitter } from "@/lib/store/emitter";
import { saveProject, type SaveProjectInput } from "./api";
import type { ProjectDocument } from "./project-document";
import type { SavedProject } from "./saved-project";
import { sameScriptElements } from "./same-script-elements";

export const AUTOSAVE_DEBOUNCE_MS = 2000;

export interface AutosaverOptions {
	projectId: string;
	/**
	 * Read once at construction for the baseline and then when the debounce
	 * fires, so serializing stays off the per-keystroke path.
	 */
	document: Pick<ProjectDocument, "read" | "meta">;
	onSaved: () => void;
	onError: (error: unknown) => void;
	remote?: {
		initialScript?: string;
		read: (signal: AbortSignal) => Promise<SavedProject>;
		merge: (
			baseline: SavedProject["generation"],
			incoming: SavedProject["generation"],
		) => { conflicts: string[] };
	};
}

export interface Autosaver {
	/** Coalesce this change with any others into one debounced save. */
	schedule: () => void;
	/** Run any pending save immediately. */
	flush: () => void;
	ensureSaved: () => Promise<void>;
	refreshRemote: (signal: AbortSignal) => Promise<void>;
	/** Persist any pending edit, then hold every later save until {@link resume}. */
	suspend: () => void;
	/** Resume saving, with one save for whatever was dropped while suspended. */
	resume: () => void;
	onProjectSaved: (listener: (input: SaveProjectInput) => void) => () => void;
}

/**
 * Debounces edits into one save at a time. The queue keeps a slow save from
 * overlapping the next one, so the last scheduled state always lands last.
 *
 * The document it is built from counts as saved, and a save whose payload
 * matches the last one is dropped, so an untouched project never saves itself
 * on open or reports "Saved" for an echo of what it loaded.
 */
export function createAutosaver({
	projectId,
	document,
	onSaved,
	onError,
	remote,
}: AutosaverOptions): Autosaver {
	const queue = new PQueue({ concurrency: 1 });
	const projectSaved = createEmitter<SaveProjectInput>();

	const buildInput = (): SaveProjectInput => ({
		...document.read(),
		...document.meta(),
	});

	let lastSaved = buildInput();
	let lastRemoteScript = remote?.initialScript ?? lastSaved.script;
	let suspended = false;
	let revision = 0;
	let refreshing = false;

	const persist = async (input: SaveProjectInput) => {
		if (isEqual(input, lastSaved)) return;
		try {
			await saveProject(projectId, input, lastSaved.generation);
			lastSaved = input;
			lastRemoteScript = input.script;
			onSaved();
			projectSaved.notify(input);
		} catch (error) {
			console.error("Autosave failed", error);
			onError(error);
		}
	};

	/**
	 * Reads the payload as the debounce fires, not as the save runs, so a save
	 * queued behind a slow one still writes the state it was scheduled for.
	 */
	const schedule = debounce(() => {
		if (suspended) return;
		const input = buildInput();
		const scheduledRevision = ++revision;
		void queue.add(async () => {
			if (scheduledRevision === revision) await persist(input);
		});
	}, AUTOSAVE_DEBOUNCE_MS);

	return {
		schedule,
		flush: schedule.flush,
		refreshRemote: async (signal) => {
			if (!remote || refreshing || suspended || signal.aborted) return;
			refreshing = true;
			try {
				await queue.add(async () => {
					if (suspended || signal.aborted) return;
					const incoming = await remote.read(signal);
					if (suspended || signal.aborted) return;
					if (
						incoming.script !== lastRemoteScript ||
						!isEqual(incoming.store, lastSaved.store)
					)
						throw new Error(
							"The project changed in another session. Keep your edits and reopen it before continuing.",
						);
					const currentScript = buildInput().script;
					if (
						currentScript !== lastSaved.script &&
						!sameScriptElements(lastSaved.script, currentScript)
					)
						return;
					const { conflicts } = remote.merge(
						lastSaved.generation,
						incoming.generation,
					);
					if (conflicts.length)
						throw new Error(
							"Background takes conflict with local selections. Your local edits have been kept.",
						);
					lastSaved = { ...lastSaved, generation: incoming.generation };
					revision++;
					if (!isEqual(buildInput(), lastSaved)) schedule();
				});
			} catch (error) {
				if (!signal.aborted) onError(error);
			} finally {
				refreshing = false;
			}
		},
		ensureSaved: async () => {
			if (suspended)
				throw new Error(
					"Finish previewing the saved version before continuing.",
				);
			schedule();
			schedule.flush();
			await queue.onIdle();
			if (suspended || !isEqual(buildInput(), lastSaved))
				throw new Error(
					"The latest project changes are not saved. Save them before continuing.",
				);
		},
		suspend: () => {
			schedule.flush();
			suspended = true;
		},
		resume: () => {
			suspended = false;
			schedule();
		},
		onProjectSaved: projectSaved.subscribe,
	};
}
