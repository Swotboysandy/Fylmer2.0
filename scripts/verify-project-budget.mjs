import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { setTimeout } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";

const config = parseEnv(await readFile(".env.local", "utf8"));
assert.equal(new URL(config.NEXT_PUBLIC_SUPABASE_URL).host, "127.0.0.1:55421");
assert.equal(config.FYLMER_STAGING_GENERATION_ENABLED, "0");
const admin = createClient(
	config.NEXT_PUBLIC_SUPABASE_URL,
	config.SUPABASE_SECRET_KEY,
	{ auth: { persistSession: false } },
);
const session = createClient(
	config.NEXT_PUBLIC_SUPABASE_URL,
	config.NEXT_PUBLIC_SUPABASE_ANON_KEY,
	{ auth: { persistSession: false } },
);
const email = `budget-audit-${randomUUID()}@example.invalid`;
const projectId = randomUUID();
const checks = [];
let userId;

const costQuote = (durationMs = 300000) => ({
	ceilingUsd: 0.035,
	currency: "USD",
	model: "Seedream 5 Lite",
	provider: "openslop",
	source: "synthetic-price-fixture",
	expiresAt: new Date(Date.now() + durationMs).toISOString(),
});
const createJob = (quote = costQuote()) =>
	admin
		.from("jobs")
		.insert({
			project_id: projectId,
			user_id: userId,
			connector_type: "image",
			request: {
				provider: "openslop",
				model: "Seedream 5 Lite",
				prompt: "synthetic budget fixture",
			},
			cost_quote: quote,
		})
		.select("*")
		.single();
async function patchJob(id, patch) {
	const result = await admin
		.from("jobs")
		.update(patch)
		.eq("id", id)
		.eq("user_id", userId)
		.select("*")
		.single();
	if (result.error) throw result.error;
	return result.data;
}
async function cap(amount) {
	return session.rpc("set_film_autonomous_cap", {
		p_project_id: projectId,
		p_cap_usd: amount,
	});
}
async function totals() {
	const { data, error } = await admin.rpc("film_budget_totals", {
		p_project_id: projectId,
	});
	if (error) throw error;
	return data[0];
}

try {
	const { data, error } = await admin.auth.admin.createUser({
		email,
		email_confirm: true,
	});
	if (error || !data.user) throw error ?? new Error("Synthetic user missing");
	userId = data.user.id;
	const project = await admin.from("projects").insert({
		id: projectId,
		user_id: userId,
		name: "Budget concurrency fixture",
		script: "Synthetic budget test only",
	});
	if (project.error) throw project.error;
	const { data: link, error: linkError } = await admin.auth.admin.generateLink({
		type: "magiclink",
		email,
	});
	if (linkError) throw linkError;
	const auth = await session.auth.verifyOtp({
		type: "magiclink",
		token_hash: link.properties.hashed_token,
	});
	if (auth.error) throw auth.error;
	const autonomous = await admin
		.from("film_reviews")
		.insert({ project_id: projectId, mode: "autonomous" });
	if (autonomous.error) throw autonomous.error;
	assert.match(
		(await createJob()).error?.message ?? "",
		/Set a per-project cap/,
	);
	checks.push("Autonomous media cannot queue without an explicit project cap");
	assert.equal((await cap(0.07)).error, null);
	const forged = await session.from("jobs").insert({
		project_id: projectId,
		user_id: userId,
		connector_type: "image",
		request: { provider: "openslop", model: "Seedream 5 Lite" },
		cost_quote: { ...costQuote(), ceilingUsd: 0 },
	});
	assert.equal(forged.error?.code, "42501");
	const bypass = await session
		.from("film_reviews")
		.update({ autonomous_cap_usd: 999 })
		.eq("project_id", projectId)
		.select("autonomous_cap_usd");
	assert.ok(bypass.error || bypass.data.length === 0);
	checks.push(
		"Authenticated clients cannot forge job prices or bypass the cap RPC",
	);
	const unpriced = await createJob(null);
	assert.match(unpriced.error?.message ?? "", /verified price/);
	const attempts = await Promise.all(
		Array.from({ length: 10 }, () => createJob()),
	);
	const accepted = attempts
		.filter((result) => !result.error)
		.map((result) => result.data);
	assert.equal(
		accepted.length,
		2,
		"Exactly two concurrent $0.035 jobs fit a $0.07 cap",
	);
	assert.equal((await totals()).committed_usd, 0.07);
	assert.ok((await cap(0.01)).error);
	checks.push(
		"Ten concurrent admissions reserve atomically; only two fit; lowering the cap below reservations fails",
	);
	const [first, second] = accepted;
	const claim = await patchJob(first.id, { status: "processing" });
	assert.equal(claim.billing_state, "reserved");
	assert.equal(
		(
			await patchJob(first.id, {
				provider_started_at: new Date().toISOString(),
			})
		).billing_state,
		"submitted",
	);
	assert.equal(
		(
			await patchJob(first.id, {
				status: "failed",
				error: "Synthetic connection lost after submission",
			})
		).billing_state,
		"uncertain",
	);
	assert.match((await createJob()).error?.message ?? "", /billing review/);
	assert.ok(
		(
			await session.rpc("reconcile_film_job_charge", {
				p_job_id: first.id,
				p_cost_usd: 0,
				p_reference: "synthetic-untrusted-receipt",
			})
		).error,
	);
	const reconciliation = await admin.rpc("reconcile_film_job_charge", {
		p_job_id: first.id,
		p_cost_usd: 0.02,
		p_reference: "synthetic-verified-invoice-001",
	});
	if (reconciliation.error) throw reconciliation.error;
	assert.equal((await totals()).committed_usd, 0.055);
	checks.push(
		"Ambiguous provider failure holds budget and blocks retries; only trusted billing reconciliation releases it",
	);
	assert.equal(
		(
			await patchJob(second.id, {
				status: "failed",
				error: "Synthetic queue failure before submission",
			})
		).billing_state,
		"released",
	);
	assert.equal((await totals()).committed_usd, 0.02);
	const restart = await admin
		.from("jobs")
		.update({ status: "pending" })
		.eq("id", second.id);
	assert.match(
		restart.error?.message ?? "",
		/finished job cannot be restarted/,
	);
	checks.push(
		"Failure before provider submission releases the unused reservation",
	);
	const third = await createJob();
	if (third.error) throw third.error;
	const mutation = await admin
		.from("jobs")
		.update({ request: { ...third.data.request, prompt: "Changed request" } })
		.eq("id", third.data.id);
	assert.ok(mutation.error);
	await patchJob(third.data.id, { status: "processing" });
	await patchJob(third.data.id, {
		provider_started_at: new Date().toISOString(),
	});
	assert.equal(
		(await patchJob(third.data.id, { status: "completed", cost_usd: 0.08 }))
			.billing_state,
		"uncertain",
	);
	assert.equal((await totals()).committed_usd, 0.1);
	assert.ok((await cap(0.09)).error);
	assert.equal((await cap(0.2)).error, null);
	assert.match((await createJob()).error?.message ?? "", /billing review/);
	const settled = await admin.rpc("reconcile_film_job_charge", {
		p_job_id: third.data.id,
		p_cost_usd: 0.08,
		p_reference: "synthetic-verified-invoice-002",
	});
	if (settled.error) throw settled.error;
	checks.push(
		"Requests are immutable and an unexpected provider overcharge freezes further spending even after a cap increase",
	);
	const race = await Promise.all([createJob(), cap(0.11)]);
	assert.equal(race.filter((result) => !result.error).length, 1);
	const { data: savedReview, error: savedError } = await admin
		.from("film_reviews")
		.select("autonomous_cap_usd")
		.eq("project_id", projectId)
		.single();
	if (savedError) throw savedError;
	assert.ok((await totals()).committed_usd <= savedReview.autonomous_cap_usd);
	if (!race[0].error)
		await patchJob(race[0].data.id, {
			status: "failed",
			error: "Synthetic queue cleanup",
		});
	assert.equal((await cap(0.2)).error, null);
	checks.push(
		"Cap changes and job reservations serialize on the same project lock",
	);
	const expiring = await createJob(costQuote(1500));
	if (expiring.error) throw expiring.error;
	await setTimeout(1750);
	const expired = await admin
		.from("jobs")
		.update({ status: "processing" })
		.eq("id", expiring.data.id);
	assert.match(expired.error?.message ?? "", /expired/);
	await patchJob(expiring.data.id, {
		status: "failed",
		cost_usd: 0,
		error: "Expired before provider submission",
	});
	assert.equal((await totals()).committed_usd, 0.1);
	checks.push(
		"A quote that expires while queued cannot start a provider request",
	);
	const jobs = await admin
		.from("jobs")
		.select("id")
		.eq("project_id", projectId);
	if (jobs.error) throw jobs.error;
	const deliveries = await admin
		.from("asset_deliveries")
		.select("job_id")
		.in(
			"job_id",
			jobs.data.map((job) => job.id),
		);
	if (deliveries.error) throw deliveries.error;
	assert.equal(deliveries.data.length, 0);
	await mkdir("artifacts/project-budget", { recursive: true });
	await writeFile(
		"artifacts/project-budget/results.json",
		JSON.stringify({ checks, syntheticOnly: true, providerCalls: 0 }, null, 2),
	);
	console.log(
		JSON.stringify({ checks, syntheticOnly: true, providerCalls: 0 }),
	);
} finally {
	if (userId) {
		const { error } = await admin.auth.admin.deleteUser(userId);
		if (error) throw error;
	}
}
