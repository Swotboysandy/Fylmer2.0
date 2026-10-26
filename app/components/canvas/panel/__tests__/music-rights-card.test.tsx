// @vitest-environment happy-dom

import { act, useEffect } from "react";
import { afterEach, expect, it } from "vitest";
import { ProjectProvider } from "@/lib/project/project-provider";
import {
	GenerationQueueProvider,
	useGenerationQueue,
} from "@/lib/generation/generation-queue-provider";
import type { GenerationQueue } from "@/lib/generation/queue";
import { deserializeWithScenes } from "@/lib/project/serialize";
import {
	mountOnCanvas,
	type as typeInput,
} from "@/app/components/canvas/__tests__/_mount";
import { MusicRightsCard } from "../music-rights-card";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let canvas: ReturnType<typeof mountOnCanvas> | undefined;
let queue: GenerationQueue | undefined;
const projectId = "11111111-1111-4111-8111-111111111111";
const audioUrl = "https://media.example/score.wav";
function ObserveQueue() {
	const current = useGenerationQueue();
	useEffect(() => {
		queue = current;
	}, [current]);
	return null;
}
afterEach(() => {
	canvas?.unmount();
	queue = undefined;
});
async function mount(music: boolean) {
	canvas = mountOnCanvas(
		deserializeWithScenes(
			music
				? '<music id="score">A quiet score.</music>'
				: '<narration id="voice">Hello.</narration>',
			{},
			() => "scene",
		),
	);
	await act(async () =>
		canvas?.render(
			<ProjectProvider projectId={projectId} initialTranscript={[]}>
				<GenerationQueueProvider
					projectId={projectId}
					initialState={
						music
							? {
									score: {
										status: "idle",
										startedAt: null,
										result: { audioUrl, durationSec: 4 },
										error: null,
										resultInputs: null,
										connectorType: "music",
										pinned: true,
									},
								}
							: {}
					}
				>
					<ObserveQueue />
					<MusicRightsCard />
				</GenerationQueueProvider>
			</ProjectProvider>,
		),
	);
}
it("does not imply that a film without selected music has licensed tracks", async () => {
	await mount(false);
	expect(document.body.textContent).toContain("No selected music tracks");
	expect(document.body.querySelector("form")).toBeNull();
});
it("requires evidence and confirmation before applying track-bound metadata", async () => {
	await mount(true);
	const button = document.body.querySelector<HTMLButtonElement>(
		'button[type="submit"]',
	);
	expect(button?.disabled).toBe(true);
	const inputs = document.body.querySelectorAll<HTMLInputElement>(
		'input:not([type="checkbox"])',
	);
	expect(inputs.length).toBe(2);
	for (const field of inputs)
		expect(
			document.body.querySelector(`label[for="${field.id}"]`),
		).not.toBeNull();
	await typeInput(inputs[0], "I composed this recording.");
	await typeInput(inputs[1], "Recording project score-1");
	expect(button?.disabled).toBe(true);
	await act(async () =>
		document.body
			.querySelector<HTMLInputElement>('input[type="checkbox"]')
			?.click(),
	);
	expect(button?.disabled).toBe(false);
	await act(async () =>
		document.body
			.querySelector("form")
			?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
	);
	expect(queue?.getElementSnapshot("score").result?.musicRights).toMatchObject({
		status: "user-declared",
		audioUrl,
		evidence: "Recording project score-1",
	});
	expect(queue?.getElementSnapshot("score").pinned).toBe(true);
	expect(document.body.textContent).toContain("User-declared rights");
	expect(document.body.textContent).toContain("does not independently verify");
});
