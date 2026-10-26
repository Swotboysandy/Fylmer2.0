import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createExportReconciler } from "../reconcile-export.mjs";

const userId = "11111111-1111-4111-8111-111111111111";
const renderId = "22222222-2222-4222-8222-222222222222";
const env = { FYLMER_JOB_WORKER_SECRET: "x".repeat(32) };
async function fixture(context) {
	const directory = await mkdtemp(join(tmpdir(), "export-reconcile-"));
	context.after(() => rm(directory, { recursive: true, force: true }));
	await writeFile(
		join(directory, "manifest.json"),
		JSON.stringify({ source: { runId: userId } }),
	);
	await writeFile(join(directory, "done.json"), '{"size":4}');
	return directory;
}
for (const recorded of [true, false])
	test(`acknowledges ${recorded} once across worker restarts`, async (context) => {
		const directory = await fixture(context);
		let calls = 0;
		const fetchImpl = async (url, options) => {
			calls++;
			assert.equal(
				String(url),
				"http://127.0.0.1:3055/api/internal/export-complete",
			);
			assert.deepEqual(JSON.parse(options.body), { userId, renderId });
			assert.equal(options.redirect, "error");
			return Response.json({ recorded });
		};
		await createExportReconciler({ env, fetchImpl })(
			directory,
			userId,
			renderId,
		);
		await createExportReconciler({ env, fetchImpl })(
			directory,
			userId,
			renderId,
		);
		assert.equal(calls, 1);
		assert.deepEqual(
			JSON.parse(await readFile(join(directory, "completion.json"), "utf8")),
			{ recorded },
		);
	});
test("retries an unavailable acknowledgement after cooldown without losing finished output", async (context) => {
	const directory = await fixture(context);
	let clock = 1;
	let calls = 0;
	const reconcile = createExportReconciler({
		env,
		now: () => clock,
		fetchImpl: async () => {
			calls++;
			return calls === 1
				? new Response("offline", { status: 503 })
				: Response.json({ recorded: true });
		},
	});
	await assert.rejects(reconcile(directory, userId, renderId));
	await reconcile(directory, userId, renderId);
	assert.equal(calls, 1);
	assert.ok((await readdir(directory)).includes("done.json"));
	assert.ok(!(await readdir(directory)).includes("completion.json"));
	clock += 30000;
	await reconcile(directory, userId, renderId);
	assert.equal(calls, 2);
});
for (const state of ["failed.json", "cancelled.json", "pending", "legacy"])
	test(`skips ${state} without requests`, async (context) => {
		const directory = await fixture(context);
		if (state === "pending") await rm(join(directory, "done.json"));
		else if (state === "legacy")
			await writeFile(join(directory, "manifest.json"), '{"source":{}}');
		else await writeFile(join(directory, state), "{}");
		await createExportReconciler({
			env,
			fetchImpl: () => assert.fail("Unexpected request"),
		})(directory, userId, renderId);
	});
for (const origin of [
	"https://example.com",
	"http://user:pass@localhost",
	"http://localhost/path",
])
	test(`rejects unsafe endpoint ${origin}`, async (context) => {
		const directory = await fixture(context);
		await assert.rejects(
			createExportReconciler({
				env: { ...env, FYLMER_WORKER_APP_ORIGIN: origin },
				fetchImpl: () => assert.fail("Unexpected request"),
			})(directory, userId, renderId),
		);
	});
