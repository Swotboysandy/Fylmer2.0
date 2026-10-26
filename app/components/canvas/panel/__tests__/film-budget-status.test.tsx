// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountOnCanvas } from "@/app/components/canvas/__tests__/_mount";
import { FilmBudgetStatus } from "../film-budget-status";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let canvas: ReturnType<typeof mountOnCanvas> | undefined;
const review = {
	bible: true,
	images: false,
	videos: false,
	finalCut: false,
	imageCount: 0,
	videoCount: 0,
};
afterEach(() => {
	canvas?.unmount();
	vi.unstubAllGlobals();
});

describe("FilmBudgetStatus", () => {
	it("labels reservations and uncertain charges and reloads after review refresh", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(
				Response.json({ committedUsd: 0.6, hasUncertainCharges: true }),
			)
			.mockResolvedValueOnce(
				Response.json({ committedUsd: 0.2, hasUncertainCharges: false }),
			);
		vi.stubGlobal("fetch", fetch);
		canvas = mountOnCanvas();
		await act(async () =>
			canvas?.render(<FilmBudgetStatus projectId="fixture" review={review} />),
		);
		expect(document.body.textContent).toContain("$0.60");
		expect(document.body.textContent).toContain("active reservations");
		expect(document.body.textContent).toContain("needs billing review");
		await act(async () =>
			canvas?.render(
				<FilmBudgetStatus projectId="fixture" review={{ ...review }} />,
			),
		);
		expect(document.body.textContent).toContain("$0.20");
		expect(document.body.textContent).not.toContain("needs billing review");
	});
	it("shows failure rather than zero spending", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response("", { status: 503 })),
		);
		canvas = mountOnCanvas();
		await act(async () =>
			canvas?.render(<FilmBudgetStatus projectId="fixture" review={review} />),
		);
		expect(
			document.body.querySelector('[role="alert"]')?.textContent,
		).toContain("Budget unavailable");
		expect(document.body.textContent).not.toContain("$0.00");
	});
});
