import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { discoverFilmRuns, runFilmWorker } from "../film-worker.mjs";

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});
const runId = "11111111-1111-4111-8111-111111111111";
const leaseId = "22222222-2222-4222-8222-222222222222";
const input = {
	runId,
	origin: "http://127.0.0.1:3055",
	secret: "synthetic-worker-secret-123456789012345",
	maxTicks: 2,
};
test("discovers a bounded batch and claims each run without borrowing another lease", async () => {
	const calls = [];
	globalThis.fetch = async (_url, options) => {
		calls.push(options);
		return Response.json(
			!options.method
				? { kind: "candidates", runIds: [runId, leaseId] }
				: { kind: "review", stage: "final" },
		);
	};
	const result = await discoverFilmRuns({ ...input, maxRuns: 1 });
	assert.equal(result.kind, "batch");
	assert.equal(result.runs.length, 1);
	assert.deepEqual(JSON.parse(calls[1].body), { runId });
	assert.equal(calls.length, 2);
});
test("does not process candidates when discovery is disabled", async () => {
	let calls = 0;
	globalThis.fetch = async () => {
		calls++;
		return Response.json({ kind: "paused" });
	};
	assert.deepEqual(await discoverFilmRuns(input), { kind: "paused" });
	assert.equal(calls, 1);
});
test("refuses duplicate or untrusted discovery identities before mutation", async () => {
	globalThis.fetch = async (_url, options) => {
		assert.equal(options.method, undefined);
		return Response.json({ kind: "candidates", runIds: [runId, runId] });
	};
	await assert.rejects(discoverFilmRuns(input));
});
test("stops the batch on uncertain execution rather than trying more runs", async () => {
	let calls = 0;
	globalThis.fetch = async (_url, options) => {
		calls++;
		return options.method
			? new Response("unavailable", { status: 503 })
			: Response.json({ kind: "candidates", runIds: [runId, leaseId] });
	};
	await assert.rejects(discoverFilmRuns(input), /HTTP 503/);
	assert.equal(calls, 2);
});
test("retains only its returned lease and stops at review", async () => {
	const calls = [];
	globalThis.fetch = async (url, options) => {
		calls.push({ url: String(url), ...options });
		return Response.json(
			calls.length === 1
				? { kind: "yielded", leaseId, lastResult: { kind: "waiting" } }
				: { kind: "review", stage: "final" },
		);
	};
	assert.deepEqual(await runFilmWorker(input), {
		kind: "review",
		stage: "final",
	});
	assert.deepEqual(JSON.parse(calls[0].body), { runId });
	assert.deepEqual(JSON.parse(calls[1].body), { runId, leaseId });
	assert.equal(calls[0].redirect, "error");
});
test("does not retry an unknown HTTP outcome", async () => {
	let calls = 0;
	globalThis.fetch = async () => {
		calls++;
		return new Response("private error", { status: 409 });
	};
	await assert.rejects(runFilmWorker(input), /HTTP 409/);
	assert.equal(calls, 1);
});
test("refuses off-host credential transmission", async () => {
	globalThis.fetch = async () => {
		throw new Error("must not fetch");
	};
	await assert.rejects(
		runFilmWorker({ ...input, origin: "https://outside.example" }),
		/loopback/,
	);
});
test("stops at the tick bound without reporting completion or exposing its lease", async () => {
	globalThis.fetch = async () =>
		Response.json({
			kind: "yielded",
			leaseId,
			lastResult: { kind: "dispatched" },
		});
	assert.deepEqual(await runFilmWorker({ ...input, maxTicks: 1 }), {
		kind: "bounded",
		lastKind: "dispatched",
	});
});
test("rejects malformed ownership instead of resubmitting", async () => {
	globalThis.fetch = async () =>
		Response.json({
			kind: "yielded",
			leaseId: "wrong",
			lastResult: { kind: "waiting" },
		});
	await assert.rejects(runFilmWorker(input));
});
test("an interrupted worker does not make a request", async () => {
	globalThis.fetch = async () => {
		throw new Error("must not fetch");
	};
	assert.deepEqual(
		await runFilmWorker({ ...input, signal: AbortSignal.abort() }),
		{ kind: "interrupted" },
	);
});
