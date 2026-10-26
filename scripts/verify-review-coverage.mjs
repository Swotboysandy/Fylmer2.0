import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { createClient } from "@supabase/supabase-js";

const config = parseEnv(await readFile(".env.local", "utf8"));
assert.equal(new URL(config.NEXT_PUBLIC_SUPABASE_URL).host, "127.0.0.1:55421");
assert.equal(config.FYLMER_STAGING_GENERATION_ENABLED, "0");
const admin = createClient(
	config.NEXT_PUBLIC_SUPABASE_URL,
	config.SUPABASE_SECRET_KEY,
	{ auth: { persistSession: false } },
);
const client = createClient(
	config.NEXT_PUBLIC_SUPABASE_URL,
	config.NEXT_PUBLIC_SUPABASE_ANON_KEY,
	{ auth: { persistSession: false } },
);
const email = `review-coverage-${randomUUID()}@example.invalid`;
const checks = [];
let userId;

async function review(projectId, action) {
	return client.rpc("film_workflow", {
		p_project_id: projectId,
		p_action: action,
	});
}

async function project(kinds) {
	const id = randomUUID();
	const clips = kinds.map((type) => ({ type, id: randomUUID() }));
	const generation = Object.fromEntries(
		clips.map((clip) => [
			clip.id,
			{
				status: "idle",
				startedAt: null,
				connectorType: clip.type,
				result: {
					[`${clip.type}Url`]: `https://example.invalid/${clip.id}`,
					durationSec: 2,
				},
				error: null,
				resultInputs: null,
				pinned: true,
			},
		]),
	);
	const inserted = await client
		.from("projects")
		.insert({
			id,
			user_id: userId,
			name: "Review coverage fixture",
			script:
				clips
					.map(
						(clip) =>
							`<${clip.type} id="${clip.id}">Synthetic selected ${clip.type}.</${clip.type}>`,
					)
					.join("\n") || "Synthetic plan without any visual clips.",
			store: {},
			generation,
		});
	if (inserted.error) throw inserted.error;
	assert.equal((await review(id, "bible")).error, null);
	assert.equal((await review(id, "directed")).error, null);
	return { id, clips, generation };
}

try {
	const account = await admin.auth.admin.createUser({
		email,
		email_confirm: true,
	});
	if (account.error || !account.data.user)
		throw account.error ?? new Error("Fixture account missing");
	userId = account.data.user.id;
	const link = await admin.auth.admin.generateLink({
		type: "magiclink",
		email,
	});
	if (link.error) throw link.error;
	const authenticated = await client.auth.verifyOtp({
		type: "magiclink",
		token_hash: link.data.properties.hashed_token,
	});
	if (authenticated.error) throw authenticated.error;
	for (const kind of ["image", "video"]) {
		const saved = await project([kind]);
		const initial = await review(saved.id, "read");
		assert.equal(initial.error, null);
		assert.equal(initial.data.finalCut, false);
		if (kind === "video") assert.equal(initial.data.images, true);
		const approved = await review(
			saved.id,
			kind === "image" ? "images" : "videos",
		);
		assert.equal(approved.error, null);
		assert.equal(approved.data.images, true);
		assert.equal(approved.data.videos, true);
		assert.equal(approved.data.finalCut, false);
		assert.equal((await review(saved.id, "final_cut")).data.finalCut, true);
		const snapshot = await client.rpc("film_export_snapshot", {
			p_project_id: saved.id,
		});
		assert.equal(snapshot.error, null);
		assert.equal(snapshot.data.projectId, saved.id);
		checks.push(
			`Directed ${kind}-only films skip the absent stage and still require explicit final approval`,
		);
	}
	for (const kind of ["image", "video"]) {
		const saved = await project([kind, kind]);
		const incomplete = structuredClone(saved.generation);
		delete incomplete[saved.clips[1].id];
		assert.equal(
			(
				await client
					.from("projects")
					.update({ generation: incomplete })
					.eq("id", saved.id)
			).error,
			null,
		);
		const refused = await review(
			saved.id,
			kind === "image" ? "images" : "videos",
		);
		assert.ok(refused.error);
		assert.equal((await review(saved.id, "read")).data.videos, false);
		assert.ok((await review(saved.id, "final_cut")).error);
		assert.ok(
			(await client.rpc("film_export_snapshot", { p_project_id: saved.id }))
				.error,
		);
		checks.push(
			`Directed approval rejects a missing required ${kind} even when another selected take exists`,
		);
	}
	const autonomous = await project(["video"]);
	assert.equal(
		(
			await client.rpc("set_film_autonomous_cap", {
				p_project_id: autonomous.id,
				p_cap_usd: 0.1,
			})
		).error,
		null,
	);
	const switched = await review(autonomous.id, "autonomous");
	assert.equal(switched.error, null);
	assert.equal(switched.data.images, true);
	assert.equal(switched.data.videos, true);
	assert.equal(switched.data.finalCut, false);
	assert.equal((await review(autonomous.id, "final_cut")).data.finalCut, true);
	checks.push(
		"Autonomous video-only films advance completed stages but never approve their own final cut",
	);
	const empty = await project([]);
	assert.ok((await review(empty.id, "final_cut")).error);
	assert.ok(
		(await client.rpc("film_export_snapshot", { p_project_id: empty.id }))
			.error,
	);
	checks.push("An empty film cannot be approved or exported");
	await mkdir("artifacts/canonical-export", { recursive: true });
	await writeFile(
		"artifacts/canonical-export/review-coverage.json",
		JSON.stringify({ checks, providerCalls: 0, syntheticOnly: true }, null, 2),
	);
	console.log(
		JSON.stringify({ checks, providerCalls: 0, syntheticOnly: true }),
	);
} finally {
	if (userId) {
		const deleted = await admin.auth.admin.deleteUser(userId);
		if (deleted.error) throw deleted.error;
	}
}
