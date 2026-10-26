import isEqual from "lodash/isEqual";
import { z } from "zod";
import { isScene } from "@/lib/canvas/scenes";
import { CONTENT_TYPES } from "@/lib/canvas/types";
import { getPrimaryUrl } from "@/lib/connectors/asset-url";
import { getPromptText } from "@/lib/generation/inputs";
import { SnapshotStore } from "@/lib/generation/snapshots";
import {
	parseSavedProject,
	type SavedProject,
} from "@/lib/project/saved-project";
import { deserializeWithScenes } from "@/lib/project/serialize";
import { createClient } from "@/lib/supabase/server";
import { ExportLayoutSchema } from "./local-export";
import { resolveElements } from "./resolve";
import { buildRenderLayout } from "./scene-builder";
import type { RenderLayout, Sequence } from "./types";
import { exportMusicRights } from "./export-music-rights";

export class ExportReviewError extends Error {}

export function buildProjectExportLayout(project: SavedProject): RenderLayout {
	const scenes = deserializeWithScenes(
		project.script,
		project.store.models,
		(index) => `scene-${index + 1}`,
	).filter(isScene);
	const identifiers = new Set<string>();
	for (const scene of scenes) {
		for (const element of scene.children) {
			if (identifiers.has(element.id))
				throw new ExportReviewError(
					"The saved film has duplicate clip IDs. Correct the script before exporting.",
				);
			identifiers.add(element.id);
			const snapshot = project.generation[element.id];
			if (snapshot && snapshot.status !== "idle")
				throw new ExportReviewError(
					"Wait for the selected clips to finish generating, then review the final cut.",
				);
			if (!getPromptText(element) && !snapshot?.result) continue;
			const result = snapshot?.result;
			if (
				!result ||
				!getPrimaryUrl(result, CONTENT_TYPES[element.type].outputKind) ||
				!Number.isFinite(result.durationSec) ||
				result.durationSec < 0 ||
				(result.durationSec === 0 && element.type !== "image")
			) {
				throw new ExportReviewError(
					"Some scripted clips have no usable selected take. Complete the film before exporting.",
				);
			}
		}
	}
	const snapshots = new SnapshotStore(project.generation);
	const settings = project.store.videoSettings;
	return buildRenderLayout(
		resolveElements(scenes, snapshots.get, {
			captionsEnabled: settings.captions,
		}),
		settings,
	);
}

function comparableLayout(layout: RenderLayout) {
	const sequence = (item: Sequence) => {
		const media = new URL(item.element.url);
		media.search = "";
		media.hash = "";
		return {
			...item,
			element: {
				...item.element,
				sceneId: `scene-${item.element.sceneNumber}`,
				url: media.href,
				captionTimestamps: item.element.captionTimestamps,
			},
		};
	};
	return {
		...layout,
		series: layout.series.map(sequence),
		sequences: Object.fromEntries(
			Object.entries(layout.sequences).map(([type, items]) => [
				type,
				items.map(sequence),
			]),
		),
	};
}

export async function getReviewedExport(projectId: string, preview: unknown) {
	const client = await createClient();
	const { data, error } = await client.rpc("film_export_snapshot", {
		p_project_id: projectId,
	});
	if (error) {
		if (error.message.startsWith("FYLMER_EXPORT: "))
			throw new ExportReviewError(
				error.message.slice("FYLMER_EXPORT: ".length),
			);
		throw new Error("Could not load the approved film for export.");
	}
	const saved = z
		.object({
			projectId: z.uuid(),
			approvalHash: z.string().regex(/^[a-f0-9]{32}$/),
			runId: z.uuid().nullish(),
			project: z.unknown(),
		})
		.parse(data);
	if (saved.projectId !== projectId)
		throw new Error("Export project mismatch.");
	const project = parseSavedProject(saved.project);
	const layout = buildProjectExportLayout(project);
	const musicRights = exportMusicRights(project, layout);
	if (musicRights.some((record) => !record.declaration))
		throw new ExportReviewError(
			"Some selected music has no rights declaration. Add its evidence under Film Bible > Music rights, or remove that music from the script, then save and review the final cut again.",
		);
	const expected = ExportLayoutSchema.safeParse(preview);
	if (
		!expected.success ||
		!isEqual(comparableLayout(layout), comparableLayout(expected.data))
	) {
		throw new ExportReviewError(
			"The preview differs from the saved film. Wait for saving to finish, refresh the Film Bible review, and approve the current final cut before exporting.",
		);
	}
	return {
		layout,
		source: {
			projectId,
			approvalHash: saved.approvalHash,
			...(saved.runId ? { runId: saved.runId } : {}),
			...(musicRights.length ? { musicRights } : {}),
		},
	};
}
