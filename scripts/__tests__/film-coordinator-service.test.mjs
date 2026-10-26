import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { serveFilmCoordinator } from "../film-coordinator-service.mjs";

const enabled = () => ({
	FYLMER_STAGING_GENERATION_ENABLED: "1",
	FYLMER_FILM_COORDINATOR_ENABLED: "1",
	FYLMER_JOB_WORKER_SECRET: "synthetic-only-secret-for-service-tests",
});

for (const missing of [
	"FYLMER_STAGING_GENERATION_ENABLED",
	"FYLMER_FILM_COORDINATOR_ENABLED",
]) {
	test(`makes no requests when ${missing} is disabled`, async () => {
		const env = enabled();
		env[missing] = "0";
		assert.deepEqual(
			await serveFilmCoordinator({
				env,
				discover: () => assert.fail("Must not discover"),
			}),
			{ kind: "paused" },
		);
	});
}

test("serializes bounded passes and waits thirty seconds between them", async () => {
	const controller = new AbortController();
	let passes = 0;
	let waits = 0;
	const result = await serveFilmCoordinator({
		env: enabled(),
		signal: controller.signal,
		discover: async (input) => {
			assert.equal(input.maxRuns, 4);
			assert.equal(input.maxTicks, 12);
			assert.equal(input.origin, "http://127.0.0.1:3055");
			assert.equal(passes, waits);
			passes++;
			return { kind: "batch", runs: [] };
		},
		wait: async (milliseconds, _value, options) => {
			assert.equal(milliseconds, 30000);
			assert.equal(options.signal, controller.signal);
			waits++;
			if (waits === 2) controller.abort();
		},
	});
	assert.equal(passes, 2);
	assert.deepEqual(result, { kind: "interrupted" });
});

test("server pause stops scheduling instead of polling indefinitely", async () => {
	assert.deepEqual(
		await serveFilmCoordinator({
			env: enabled(),
			discover: async () => ({ kind: "paused" }),
			wait: () => assert.fail("Must not wait"),
		}),
		{ kind: "paused" },
	);
});

test("uncertain execution fails once without automatic retry", async () => {
	let calls = 0;
	await assert.rejects(
		serveFilmCoordinator({
			env: enabled(),
			discover: async () => {
				calls++;
				throw new Error("HTTP 503");
			},
			wait: () => assert.fail("Must not retry"),
		}),
		/HTTP 503/,
	);
	assert.equal(calls, 1);
});

test("abort during an in-flight request terminates gracefully", async () => {
	const controller = new AbortController();
	assert.deepEqual(
		await serveFilmCoordinator({
			env: enabled(),
			signal: controller.signal,
			discover: async ({ signal }) => {
				controller.abort();
				signal.throwIfAborted();
			},
		}),
		{ kind: "interrupted" },
	);
});

test("staging unit requires an explicit environment file and never restarts failures", async () => {
	const unit = await readFile(
		new URL("../systemd/fylmer-next-film-coordinator.service", import.meta.url),
		"utf8",
	);
	assert.match(unit, /^Restart=no$/m);
	assert.match(
		unit,
		/^EnvironmentFile=\/home\/claudebot\/fylmer-next-staging\/\.env.film-coordinator$/m,
	);
	assert.match(
		unit,
		/^WorkingDirectory=\/home\/claudebot\/fylmer-next-staging$/m,
	);
	assert.doesNotMatch(unit, /production|Restart=always|Restart=on-failure/);
});
