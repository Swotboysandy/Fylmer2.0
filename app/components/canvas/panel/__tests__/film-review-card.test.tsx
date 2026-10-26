// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectProvider } from "@/lib/project/project-provider";
import {
	mountOnCanvas,
	type as typeInput,
} from "@/app/components/canvas/__tests__/_mount";
import { FilmReviewCard } from "../film-review-card";
vi.mock("../film-run-controls", () => ({ FilmRunControls: () => null }));
vi.mock("../film-budget-status", () => ({ FilmBudgetStatus: () => null }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let canvas: ReturnType<typeof mountOnCanvas> | undefined;
afterEach(() => {
	canvas?.unmount();
	vi.unstubAllGlobals();
});

describe("FilmReviewCard", () => {
	it.each([
		{ bible: false, images: false, videos: false, label: "Approve Film Bible" },
		{
			bible: true,
			images: true,
			videos: true,
			label: "Next: approve final cut",
		},
	])("keeps $label reachable in Autonomous", async (state) => {
		let finalCut = false;
		const fetch = vi.fn(async (_url: string, init: RequestInit) => {
			const { action } = JSON.parse(String(init.body)) as { action: string };
			if (action === "final_cut") finalCut = true;
			return Response.json({
				mode: "autonomous",
				capUsd: 5,
				bible: state.bible,
				images: state.images,
				videos: state.videos,
				finalCut,
				imageCount: 1,
				videoCount: 1,
			});
		});
		vi.stubGlobal("fetch", fetch);
		canvas = mountOnCanvas();
		await act(async () => {
			canvas?.render(
				<ProjectProvider
					projectId="11111111-1111-4111-8111-111111111111"
					initialTranscript={[]}
				>
					<FilmReviewCard />
				</ProjectProvider>,
			);
		});
		const button = Array.from(document.body.querySelectorAll("button")).find(
			(candidate) => candidate.textContent === state.label,
		);
		expect(button).toBeDefined();
		expect(button?.disabled).toBe(false);
		await act(async () => button?.click());
		expect(
			fetch.mock.calls.map(([, init]) => JSON.parse(String(init.body)).action),
		).toEqual(["read", state.bible ? "final_cut" : "bible"]);
		if (state.videos) {
			expect(document.body.textContent).toContain("Final cut approved");
			expect(button?.disabled).toBe(true);
		}
	});

	it("keeps Directed as default and offers an optional capped Autonomous toggle", async () => {
		let bible = false;
		let mode = "directed";
		let capUsd: number | null = null;
		const fetch = vi.fn(async (_url: string, init: RequestInit) => {
			const input = JSON.parse(String(init.body)) as {
				action: string;
				capUsd?: number;
			};
			if (input.action === "bible") bible = true;
			if (input.action === "cap") capUsd = input.capUsd ?? null;
			if (input.action === "autonomous") mode = "autonomous";
			return new Response(
				JSON.stringify({
					mode,
					capUsd,
					bible,
					images: false,
					videos: false,
					finalCut: false,
					imageCount: 0,
					videoCount: 0,
				}),
			);
		});
		vi.stubGlobal("fetch", fetch);
		canvas = mountOnCanvas();
		await act(async () => {
			canvas?.render(
				<ProjectProvider
					projectId="11111111-1111-4111-8111-111111111111"
					initialTranscript={[]}
				>
					<FilmReviewCard />
				</ProjectProvider>,
			);
		});
		const button = (label: string) =>
			Array.from(document.body.querySelectorAll("button")).find((candidate) =>
				candidate.textContent?.includes(label),
			);
		await act(async () => button("Approve Film Bible")?.click());
		const toggle =
			document.body.querySelector<HTMLButtonElement>("#autonomous-mode");
		expect(toggle?.disabled).toBe(true);
		expect(document.body.textContent).toContain("Next: approve images");
		const cap =
			document.body.querySelector<HTMLInputElement>("#autonomous-cap");
		if (!cap) throw new Error("Cap input missing");
		await typeInput(cap, "5");
		await act(async () => button("Save")?.click());
		expect(toggle?.disabled).toBe(false);
		await act(async () => toggle?.click());
		expect(fetch).toHaveBeenCalledWith(
			"/api/film-workflow",
			expect.objectContaining({
				body: expect.stringContaining('"action":"autonomous"'),
			}),
		);
		expect(document.body.textContent).not.toContain("Next: approve images");
	});
});
