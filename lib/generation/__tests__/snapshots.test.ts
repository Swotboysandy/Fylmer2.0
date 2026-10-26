import { describe, expect, it, vi } from "vitest";
import type { AssetResult } from "@/lib/connectors/types";
import { inputsFor } from "./_graph";
import { SnapshotStore, type ElementSnapshot } from "../snapshots";

const result = (imageUrl: string): AssetResult => ({
	imageUrl,
	durationSec: 0,
});

const commit = (store: SnapshotStore, id: string, url: string) =>
	store.commit({
		elementId: id,
		elementType: "image",
		connectorType: "image",
		inputs: inputsFor(url),
		result: result(url),
		pinned: false,
	});

describe("SnapshotStore remote merge", () => {
	const saved = (url: string) => {
		const store = new SnapshotStore();
		commit(store, "shot", url);
		return store.all();
	};

	it("merges a background take and notifies once without resetting other jobs", () => {
		const baseline = saved("before.png");
		const store = new SnapshotStore(baseline);
		store.update("other", { status: "generating", startedAt: 12 });
		const listener = vi.fn();
		store.subscribe(listener);
		expect(store.mergeRemote(baseline, saved("after.png"))).toEqual({
			applied: ["shot"],
			conflicts: [],
		});
		expect(store.get("shot").result).toEqual(result("after.png"));
		expect(store.get("other")).toMatchObject({
			status: "generating",
			startedAt: 12,
		});
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it.each(["queued", "generating"] as const)(
		"does not replace a %s local job",
		(status) => {
			const baseline = saved("before.png");
			const store = new SnapshotStore(baseline);
			store.update("shot", { status });
			expect(store.mergeRemote(baseline, saved("after.png"))).toEqual({
				applied: [],
				conflicts: ["shot"],
			});
			expect(store.get("shot").status).toBe(status);
		},
	);

	it("refuses the entire merge if a selected take was locally edited", () => {
		const baseline = saved("before.png");
		const store = new SnapshotStore(baseline);
		commit(store, "shot", "local.png");
		const remote = new SnapshotStore(saved("remote.png"));
		commit(remote, "new-shot", "new.png");
		const listener = vi.fn();
		store.subscribe(listener);
		expect(store.mergeRemote(baseline, remote.all()).conflicts).toEqual([
			"shot",
		]);
		expect(store.get("shot").result).toEqual(result("local.png"));
		expect(store.get("new-shot").result).toBeNull();
		expect(listener).not.toHaveBeenCalled();
	});

	it("protects pinned takes even when the baseline is also pinned", () => {
		const store = new SnapshotStore(saved("pinned.png"));
		store.update("shot", { pinned: true });
		expect(
			store.mergeRemote(store.all(), saved("remote.png")).conflicts,
		).toEqual(["shot"]);
		expect(store.get("shot").pinned).toBe(true);
	});

	it("preserves a local removal and detects conflicting remote provenance", () => {
		const baseline = saved("before.png");
		const store = new SnapshotStore(baseline);
		store.remove("shot");
		const remote = new SnapshotStore(baseline);
		remote.update("shot", { resultInputs: inputsFor("changed prompt") });
		expect(store.mergeRemote(baseline, remote.all()).conflicts).toEqual([
			"shot",
		]);
		expect(store.get("shot").result).toBeNull();
	});

	it("accepts remote deletion only for an unchanged local selection", () => {
		const baseline = saved("before.png");
		const store = new SnapshotStore(baseline);
		expect(store.mergeRemote(baseline, {}).applied).toEqual(["shot"]);
		expect(store.ids()).toEqual([]);
	});

	it("ignores echoes and transient status without notifications", () => {
		const baseline = saved("before.png");
		const store = new SnapshotStore(baseline);
		const remote = new SnapshotStore(baseline);
		remote.update("shot", { status: "generating", startedAt: 9, error: "old" });
		const listener = vi.fn();
		store.subscribe(listener);
		expect(store.mergeRemote(baseline, remote.all())).toEqual({
			applied: [],
			conflicts: [],
		});
		expect(store.get("shot").status).toBe("idle");
		expect(listener).not.toHaveBeenCalled();
	});

	it("keeps unrelated local edits when the remote selection has not changed", () => {
		const baseline = saved("before.png");
		const store = new SnapshotStore(baseline);
		commit(store, "shot", "local.png");
		expect(store.mergeRemote(baseline, baseline)).toEqual({
			applied: [],
			conflicts: [],
		});
		expect(store.get("shot").result).toEqual(result("local.png"));
	});
});

describe("SnapshotStore", () => {
	it("reports an unknown element as idle and empty", () => {
		expect(new SnapshotStore().get("nope")).toEqual<ElementSnapshot>({
			status: "idle",
			startedAt: null,
			result: null,
			error: null,
			resultInputs: null,
			connectorType: null,
			pinned: false,
		});
	});

	it("restores initial state as idle, dropping any in-flight progress", () => {
		const store = new SnapshotStore({
			a: {
				status: "generating",
				startedAt: 1_000,
				result: result("a.png"),
				error: null,
				resultInputs: inputsFor("a.png"),
				connectorType: "image",
				pinned: true,
			},
		});
		expect(store.get("a")).toMatchObject({
			status: "idle",
			startedAt: null,
			pinned: true,
			result: result("a.png"),
		});
	});

	it("bumps the result version only when a held result actually changes", () => {
		const store = new SnapshotStore();
		expect(store.getResultVersion()).toBe(0);

		store.update("a", { status: "queued" });
		expect(store.getResultVersion()).toBe(0);

		commit(store, "a", "a.png");
		expect(store.getResultVersion()).toBe(1);

		store.update("a", { startedAt: 3 });
		expect(store.getResultVersion()).toBe(1);

		store.update("a", { resultInputs: inputsFor("edited") });
		expect(store.getResultVersion()).toBe(2);

		store.update("a", { pinned: true });
		expect(store.getResultVersion()).toBe(3);

		store.remove("a");
		expect(store.getResultVersion()).toBe(4);
	});

	it("keeps a settled result on reset but forgets an untouched element", () => {
		const store = new SnapshotStore();
		commit(store, "kept", "kept.png");
		store.update("kept", { status: "generating", startedAt: 4 });
		store.update("bare", { status: "queued" });

		store.resetToIdle("kept");
		store.resetToIdle("bare");

		expect(store.get("kept")).toMatchObject({
			status: "idle",
			startedAt: null,
			result: result("kept.png"),
		});
		expect(store.ids()).toEqual(["kept"]);
	});

	it("reports each commit as the version it produced", () => {
		const store = new SnapshotStore();
		expect(
			store.commit({
				elementId: "a",
				elementType: "image",
				connectorType: "image",
				inputs: inputsFor("a.png"),
				result: result("a.png"),
				pinned: false,
			}),
		).toMatchObject({ elementId: "a", connectorType: "image", pinned: false });
	});

	it("counts active and generated elements separately", () => {
		const store = new SnapshotStore();
		commit(store, "done", "done.png");
		store.update("running", { status: "generating" });
		store.update("waiting", { status: "queued" });

		expect(store.isBusy()).toBe(true);
		expect(store.getActiveCount()).toBe(2);
		expect(store.getGeneratedCount()).toBe(1);
	});

	it("notifies subscribers until they unsubscribe", () => {
		const store = new SnapshotStore();
		let calls = 0;
		const unsubscribe = store.subscribe(() => {
			calls++;
		});

		store.notify();
		expect(calls).toBe(1);

		unsubscribe();
		store.notify();
		expect(calls).toBe(1);
	});

	it("adopts a whole result set and drops what is not in it", () => {
		const store = new SnapshotStore();
		commit(store, "a", "https://cdn/a.png");
		const listener = vi.fn();
		store.subscribe(listener);

		store.replaceAll({ b: store.get("a") });

		expect(store.ids()).toEqual(["b"]);
		expect(store.get("a").result).toBeNull();
		expect(listener).toHaveBeenCalledTimes(1);
	});
});
