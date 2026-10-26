import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
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
const projectId = randomUUID();
const email = `chat-budget-audit-${randomUUID()}@example.invalid`;
let userId;
try {
	const account = await admin.auth.admin.createUser({
		email,
		email_confirm: true,
	});
	if (account.error || !account.data.user)
		throw account.error ?? new Error("Fixture account missing");
	userId = account.data.user.id;
	const project = await admin
		.from("projects")
		.insert({
			id: projectId,
			user_id: userId,
			name: "Synthetic chat budget audit",
			script: "No provider calls",
		});
	if (project.error) throw project.error;
	const link = await admin.auth.admin.generateLink({
		type: "magiclink",
		email,
	});
	if (link.error) throw link.error;
	const auth = await client.auth.verifyOtp({
		type: "magiclink",
		token_hash: link.data.properties.hashed_token,
	});
	if (auth.error) throw auth.error;
	const cap = await client.rpc("set_film_autonomous_cap", {
		p_project_id: projectId,
		p_cap_usd: 0.01,
	});
	if (cap.error) throw cap.error;
	const unbound = {
		user_id: userId,
		connector_type: "llm",
		status: "completed",
		request: { provider: "openslop", model: "synthetic-no-provider" },
		cost_usd: 10,
	};
	const hosted = await admin
		.from("jobs")
		.insert(unbound)
		.select("id,project_id")
		.single();
	if (hosted.error) throw hosted.error;
	assert.equal(hosted.data.project_id, null);
	const totals = await admin.rpc("film_budget_totals", {
		p_project_id: projectId,
	});
	if (totals.error) throw totals.error;
	assert.equal(Number(totals.data[0].committed_usd), 0);
	const ownerWrite = await client.from("jobs").insert(unbound);
	assert.equal(ownerWrite.error?.code, "42501");
	const bound = await admin
		.from("jobs")
		.insert({ ...unbound, project_id: projectId });
	assert.match(bound.error?.message ?? "", /verified price is required/);
	const reserve = () =>
		admin
			.from("jobs")
			.insert({
				user_id: userId,
				project_id: projectId,
				connector_type: "llm",
				status: "pending",
				request: unbound.request,
				cost_quote: {
					...unbound.request,
					currency: "USD",
					ceilingUsd: 0.005,
					source: "synthetic-test-only",
					expiresAt: new Date(Date.now() + 300000).toISOString(),
				},
			})
			.select("*")
			.single();
	const patch = async (id, changes) => {
		const result = await admin
			.from("jobs")
			.update(changes)
			.eq("id", id)
			.eq("user_id", userId)
			.select("*")
			.single();
		if (result.error) throw result.error;
		return result.data;
	};
	const reserved = await reserve();
	if (reserved.error) throw reserved.error;
	assert.equal(reserved.data.billing_state, "reserved");
	await patch(reserved.data.id, { status: "processing" });
	assert.equal(
		(
			await patch(reserved.data.id, {
				provider_started_at: new Date().toISOString(),
			})
		).billing_state,
		"submitted",
	);
	assert.equal(
		(await patch(reserved.data.id, { status: "completed", cost_usd: 0.003 }))
			.billing_state,
		"settled",
	);
	const uncertain = await reserve();
	if (uncertain.error) throw uncertain.error;
	await patch(uncertain.data.id, { status: "processing" });
	await patch(uncertain.data.id, {
		provider_started_at: new Date().toISOString(),
	});
	assert.equal(
		(await patch(uncertain.data.id, { status: "failed" })).billing_state,
		"uncertain",
	);
	assert.match((await reserve()).error?.message ?? "", /billing review/);
	console.log(
		JSON.stringify({
			lifecycleChecks: [
				"Project-bound LLM reserve, submit and settle use the same protected job row",
				"Failed submitted LLM charge stays uncertain and blocks further admission",
			],
			providerCalls: 0,
		}),
	);
	console.log(
		JSON.stringify({
			syntheticOnly: true,
			providerCalls: 0,
			fixtureCapUsd: 0.01,
			syntheticUnassociatedRecordedCostUsd: 10,
			projectCommittedUsd: 0,
			findings: [
				"Current hosted chat record shape is excluded from project totals",
				"Post-hoc project association without a quote is rejected after the fact",
				"Client cannot insert or forge protected job costs",
				"Reserve a project-bound job with verified pricing before transmitting to the model; settle the same row after usage",
			],
		}),
	);
} finally {
	if (userId) {
		const removed = await admin.auth.admin.deleteUser(userId);
		if (removed.error) throw removed.error;
	}
}
