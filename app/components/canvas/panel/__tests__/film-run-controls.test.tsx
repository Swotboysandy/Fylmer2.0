// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FilmRunControls } from "../film-run-controls";

const saved = vi.hoisted(() => vi.fn());
vi.mock("@/lib/project/canvas-history-provider", () => ({
	useCanvasHistory: () => ({ ensureSaved: saved }),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const projectId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
let root: Root;
let container: HTMLDivElement;
let calls: { action: string; runId?: string; projectId: string }[];
let state: {
	enabled: boolean;
	run: null | { id: string; status: string; stopReason: string | null };
};
beforeEach(() => {
	saved.mockReset().mockResolvedValue(undefined);
	calls = [];
	state = { enabled: true, run: null };
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_url, options) => {
			const input = JSON.parse(options.body);
			calls.push(input);
			if (input.action !== "read")
				state = {
					enabled: state.enabled,
					run: {
						id: input.runId,
						status:
							input.action === "pause"
								? "paused"
								: input.action === "cancel"
									? "cancelled"
									: "queued",
						stopReason: null,
					},
				};
			return Response.json(state);
		}),
	);
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});
const render = async () =>
	act(async () =>
		root.render(<FilmRunControls projectId={projectId} canStart />),
	);
const button = (name: string) => {
	const found = Array.from(container.querySelectorAll("button")).find(
		(candidate) => candidate.textContent === name,
	);
	if (!found) throw new Error(`Missing ${name}`);
	return found;
};
it("explains disabled generation without enabling start", async () => {
	state.enabled = false;
	await render();
	expect(button("Start film").disabled).toBe(true);
	expect(container.textContent).toContain("generation is disabled");
});
it("waits for the current save and prevents duplicate clicks", async () => {
	let finish: () => void = () => {};
	saved.mockImplementationOnce(
		() =>
			new Promise<void>((resolve) => {
				finish = resolve;
			}),
	);
	await render();
	await act(async () => {
		button("Start film").click();
	});
	expect(calls.map((input) => input.action)).toEqual(["read"]);
	expect(button("Start film").disabled).toBe(true);
	await act(async () => {
		finish();
	});
	expect(calls.map((input) => input.action)).toEqual(["read", "start"]);
	expect(calls[1].projectId).toBe(projectId);
	expect(calls[1].runId).toMatch(/^[\da-f-]{36}$/);
	expect(button("Pause run")).toBeDefined();
});
it("does not start after a save failure", async () => {
	saved.mockRejectedValueOnce(new Error("Latest changes are not saved."));
	await render();
	await act(async () => button("Start film").click());
	expect(calls).toHaveLength(1);
	expect(container.querySelector('[role="alert"]')?.textContent).toContain(
		"not saved",
	);
});
it("allows pause and cancel without waiting for a failed save or generation enablement", async () => {
	state = {
		enabled: false,
		run: { id: runId, status: "queued", stopReason: null },
	};
	saved.mockRejectedValue(new Error("offline"));
	await render();
	await act(async () => button("Pause run").click());
	expect(button("Resume run").disabled).toBe(true);
	await act(async () => button("Cancel run").click());
	expect(saved).not.toHaveBeenCalled();
	expect(calls.slice(1).map((input) => [input.action, input.runId])).toEqual([
		["pause", runId],
		["cancel", runId],
	]);
});
it("shows final review instead of a misleading resume button", async () => {
	state = {
		enabled: true,
		run: { id: runId, status: "paused", stopReason: "final_review" },
	};
	await render();
	expect(container.textContent).toContain("Review and export your final cut");
	expect(container.textContent).not.toContain("Resume run");
});
it("reuses the start identity after an uncertain network failure", async () => {
	await render();
	const fetchMock = vi.mocked(fetch);
	fetchMock.mockRejectedValueOnce(new Error("connection lost"));
	await act(async () => button("Start film").click());
	const first = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
	await act(async () => button("Start film").click());
	const retry = JSON.parse(String(fetchMock.mock.calls[2][1]?.body));
	expect(retry.runId).toBe(first.runId);
	expect(retry.action).toBe("start");
});

it("clears a transient progress failure after the next successful read without starting a run", async () => {
	vi.useFakeTimers();
	vi.mocked(fetch).mockRejectedValueOnce(new Error("Synthetic offline"));
	await render();
	expect(container.querySelector('[role="alert"]')?.textContent).toContain(
		"Could not refresh",
	);
	await act(async () => vi.advanceTimersByTimeAsync(5000));
	expect(container.querySelector('[role="alert"]')).toBeNull();
	expect(container.textContent).toContain("No film run started.");
	expect(
		vi
			.mocked(fetch)
			.mock.calls.map(
				([, options]) => JSON.parse(String(options?.body)).action,
			),
	).toEqual(["read", "read"]);
});

it("does not erase a failed start when background progress recovers", async () => {
	vi.useFakeTimers();
	await render();
	saved.mockRejectedValueOnce(new Error("Latest changes are not saved."));
	await act(async () => button("Start film").click());
	vi.mocked(fetch).mockRejectedValueOnce(new Error("Synthetic offline"));
	await act(async () => vi.advanceTimersByTimeAsync(5000));
	await act(async () => vi.advanceTimersByTimeAsync(5000));
	expect(container.querySelector('[role="alert"]')?.textContent).toContain(
		"not saved",
	);
	expect(
		vi
			.mocked(fetch)
			.mock.calls.every(
				([, options]) => JSON.parse(String(options?.body)).action === "read",
			),
	).toBe(true);
});
