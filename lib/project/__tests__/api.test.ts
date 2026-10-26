import { beforeEach, expect, it, vi } from "vitest";
import { readProjectSnapshot, saveProject } from "../api";
import { parseSavedProject } from "../saved-project";

const rpc = vi.hoisted(() => vi.fn());
const query = vi.hoisted(() => ({
	from: vi.fn(),
	select: vi.fn(),
	eq: vi.fn(),
	abortSignal: vi.fn(),
	single: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({
	createClient: () => ({ rpc, from: query.from }),
}));
const input = {
	...parseSavedProject({ script: "A scene.", store: {}, generation: {} }),
	name: "Film",
	thumbnail_url: null,
};
beforeEach(() => {
	rpc.mockReset().mockResolvedValue({ error: null });
	for (const name of ["from", "select", "eq", "abortSignal"] as const)
		query[name].mockReset().mockReturnValue(query);
	query.single.mockReset().mockResolvedValue({ data: input, error: null });
});

it("reads a schema-checked project snapshot through the session client", async () => {
	const controller = new AbortController();
	expect(await readProjectSnapshot("owned-project", controller.signal)).toEqual(
		parseSavedProject(input),
	);
	expect(query.from).toHaveBeenCalledWith("projects");
	expect(query.eq).toHaveBeenCalledWith("id", "owned-project");
	const signal = query.abortSignal.mock.calls[0][0] as AbortSignal;
	controller.abort();
	expect(signal.aborted).toBe(true);
});

it("does not convert a denied or missing project into an empty snapshot", async () => {
	const error = new Error("No accessible project");
	query.single.mockResolvedValueOnce({ data: null, error });
	await expect(
		readProjectSnapshot("other-project", new AbortController().signal),
	).rejects.toBe(error);
});

it("rejects malformed remote media rather than importing it", async () => {
	query.single.mockResolvedValueOnce({
		data: { ...input, generation: { shot: { result: "bad" } } },
		error: null,
	});
	await expect(
		readProjectSnapshot("project", new AbortController().signal),
	).rejects.toThrow();
});
it("saves with the caller's last successful generation snapshot", async () => {
	await saveProject("project", input, {});
	expect(rpc).toHaveBeenCalledExactlyOnceWith("save_project_snapshot", {
		p_project_id: "project",
		p_expected_generation: {},
		p_script: input.script,
		p_store: input.store,
		p_generation: input.generation,
		p_name: "Film",
		p_thumbnail_url: null,
	});
});
it("surfaces a stale-save conflict instead of reporting a successful save", async () => {
	rpc.mockResolvedValueOnce({
		error: { message: "FYLMER_SAVE: Background media changed." },
	});
	await expect(saveProject("project", input, {})).rejects.toThrow(
		"Background media changed.",
	);
});
