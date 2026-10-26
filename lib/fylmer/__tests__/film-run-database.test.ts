import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { advanceFilmRun } from "../advance-film-run";
import { tickFilmRun } from "../tick-film-run";
import { continueFilmRun } from "../continue-film-run";
import { discoverFilmRuns } from "@/scripts/film-worker.mjs";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { prepareFilmRunPlan } from "../prepare-run-plan";
import { buildFilmRunPlan } from "../run-plan";
import { commitFilmRunResult } from "../commit-run-result";
import { AssetBundle } from "@/lib/api/asset-bundle";
import { GENERATED_MEDIA_BUCKET, storeRunBundle } from "../store-run-bundle";
import { readRunBundle, signRunBundleFiles } from "../read-run-bundle";
import { BaseProvider } from "@/lib/providers/base";
import { generatedMediaResponse } from "../generated-media-response";
import { privateRunBundle } from "../private-run-bundle";
import { resolveOwnedGeneratedMedia } from "../resolve-owned-generated-media";
import { privateProviderWriter } from "../private-provider-storage";
import { inlineOwnedImage } from "../inline-owned-image";
import { compileFilmRunRequest } from "../compile-run-request";
import { quoteAssetCost } from "@/lib/api/asset-cost-quote";

describe.skipIf(process.env.FYLMER_DB_ROUTE_TEST !== "1")(
	"durable film run control",
	() => {
		let admin: SupabaseClient;
		let owner: SupabaseClient;
		let other: SupabaseClient;
		let ownerId: string;
		const users: string[] = [];
		const originalBundleBase = AssetBundle.baseUrl;
		beforeAll(async () => {
			AssetBundle.baseUrl = "https://media.example.invalid";
			const config = z
				.object({
					NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
					SUPABASE_SECRET_KEY: z.string().min(1),
					NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
					FYLMER_STAGING_GENERATION_ENABLED: z.literal("0"),
				})
				.parse(parseEnv(await readFile(".env.local", "utf8")));
			expect(new URL(config.NEXT_PUBLIC_SUPABASE_URL).host).toBe(
				"127.0.0.1:55421",
			);
			expect(config.FYLMER_STAGING_GENERATION_ENABLED).toBe("0");
			admin = createClient(
				config.NEXT_PUBLIC_SUPABASE_URL,
				config.SUPABASE_SECRET_KEY,
				{ auth: { persistSession: false } },
			);
			const login = async () => {
				const email = `film-run-${randomUUID()}@example.invalid`;
				const created = await admin.auth.admin.createUser({
					email,
					email_confirm: true,
				});
				if (created.error || !created.data.user)
					throw created.error ?? new Error("Missing fixture user");
				users.push(created.data.user.id);
				const client = createClient(
					config.NEXT_PUBLIC_SUPABASE_URL,
					config.NEXT_PUBLIC_SUPABASE_ANON_KEY,
					{ auth: { persistSession: false } },
				);
				const link = await admin.auth.admin.generateLink({
					type: "magiclink",
					email,
				});
				if (link.error) throw link.error;
				const session = await client.auth.verifyOtp({
					type: "magiclink",
					token_hash: link.data.properties.hashed_token,
				});
				if (session.error) throw session.error;
				return { client, id: created.data.user.id };
			};
			const first = await login();
			owner = first.client;
			ownerId = first.id;
			other = (await login()).client;
		}, 30000);
		afterAll(async () => {
			AssetBundle.baseUrl = originalBundleBase;
			for (const id of users) {
				const deleted = await admin.auth.admin.deleteUser(id);
				if (deleted.error) throw deleted.error;
			}
		});
		const review = async (projectId: string, action: string) => {
			const result = await owner.rpc("film_workflow", {
				p_project_id: projectId,
				p_action: action,
			});
			if (result.error) throw result.error;
		};
		const project = async (approved = true, capped = true) => {
			const id = randomUUID();
			const created = await admin.from("projects").insert({
				id,
				user_id: ownerId,
				name: "Run control fixture",
				script: `--- Scene 1 ---\n<image id="${randomUUID()}">A lighthouse.</image>`,
				store: {},
				generation: {},
			});
			if (created.error) throw created.error;
			if (approved) await review(id, "bible");
			if (capped) {
				const cap = await owner.rpc("set_film_autonomous_cap", {
					p_project_id: id,
					p_cap_usd: 1,
				});
				if (cap.error) throw cap.error;
			}
			return id;
		};
		const control = (
			projectId: string,
			action: string,
			runId: string,
			client = owner,
		) =>
			client.rpc("control_film_run", {
				p_project_id: projectId,
				p_action: action,
				p_run_id: runId,
			});

		it("requires renewed final approval after a music declaration changes", async () => {
			const id = await project();
			const audioUrl = "https://example.invalid/score.wav";
			const generation = {
				shot: {
					status: "idle",
					startedAt: null,
					error: null,
					resultInputs: null,
					connectorType: "image",
					pinned: true,
					result: {
						imageUrl: "https://example.invalid/frame.png",
						durationSec: 0,
					},
				},
				score: {
					status: "idle",
					startedAt: null,
					error: null,
					resultInputs: null,
					connectorType: "music",
					pinned: true,
					result: {
						audioUrl,
						durationSec: 4,
						musicRights: {
							status: "user-declared",
							audioUrl,
							basis: "original",
							statement: "I composed this score.",
							evidence: "Original recording project",
							declaredAt: "2026-10-24T00:00:00Z",
						},
					},
				},
			};
			expect(
				(
					await owner
						.from("projects")
						.update({
							script:
								'<image id="shot">A lighthouse.</image><music id="score">A quiet score.</music>',
							generation,
						})
						.eq("id", id)
				).error,
			).toBeNull();
			await review(id, "bible");
			await review(id, "images");
			await review(id, "final_cut");
			const approved = await owner.rpc("film_export_snapshot", {
				p_project_id: id,
			});
			expect(approved.error).toBeNull();
			generation.score.result.musicRights.evidence =
				"Updated recording evidence";
			expect(
				(await owner.from("projects").update({ generation }).eq("id", id))
					.error,
			).toBeNull();
			const stale = await owner.rpc("film_export_snapshot", {
				p_project_id: id,
			});
			expect(stale.error).not.toBeNull();
			const current = await owner.rpc("film_workflow", {
				p_project_id: id,
				p_action: "read",
			});
			expect(current.error).toBeNull();
			expect(current.data.finalCut).toBe(false);
			await review(id, "final_cut");
			const refreshed = await owner.rpc("film_export_snapshot", {
				p_project_id: id,
			});
			expect(refreshed.error).toBeNull();
			expect(refreshed.data.approvalHash).not.toBe(approved.data.approvalHash);
			expect(
				refreshed.data.project.generation.score.result.musicRights.evidence,
			).toBe("Updated recording evidence");
		});

		it.each([
			"matching",
			"cancelled",
			"queued",
			"wrong-stop",
			"source",
			"takes",
			"mode",
			"uncommitted",
		])(
			"binds an approved export only to its exact final-review run: %s",
			async (variant) => {
				const id = await project();
				const generation = {
					shot: {
						status: "idle",
						startedAt: null,
						error: null,
						resultInputs: null,
						connectorType: "image",
						pinned: true,
						result: {
							imageUrl: "https://example.invalid/frame.png",
							durationSec: 0,
						},
					},
				};
				const changed = await owner
					.from("projects")
					.update({
						script: '<image id="shot">A lighthouse.</image>',
						generation,
					})
					.eq("id", id);
				expect(changed.error).toBeNull();
				await review(id, "bible");
				await review(id, "images");
				await review(id, "final_cut");
				const runId = randomUUID();
				expect((await control(id, "start", runId)).error).toBeNull();
				const plan = await prepareFilmRunPlan(admin, runId);
				const held = await lease(runId, "claim");
				expect(held.error).toBeNull();
				const stopped = await admin.rpc("stop_film_run_coordinator", {
					p_run_id: runId,
					p_lease_id: held.data.lease_id,
					p_reason: "final_review",
				});
				expect(stopped.error).toBeNull();
				const mutations: Record<string, Record<string, unknown>> = {
					cancelled: { status: "cancelled" },
					queued: { status: "queued" },
					"wrong-stop": { coordinator_stop: "images_review" },
					source: { source_hash: "obsolete" },
					takes: { planned_generation: {} },
					mode: { mode: "autonomous" },
					uncommitted: {
						plan: {
							...plan,
							nodes: plan.nodes.map((node) => ({
								...node,
								action: "generate",
							})),
						},
					},
				};
				if (mutations[variant])
					expect(
						(
							await admin
								.from("film_runs")
								.update(mutations[variant])
								.eq("id", runId)
						).error,
					).toBeNull();
				const snapshot = await owner.rpc("film_export_snapshot", {
					p_project_id: id,
				});
				expect(snapshot.error).toBeNull();
				expect(snapshot.data.runId).toBe(variant === "matching" ? runId : null);
				expect(
					(await other.rpc("film_export_snapshot", { p_project_id: id })).error,
				).not.toBeNull();
				if (variant === "matching")
					expect((await control(id, "read", runId)).data.status).toBe("paused");
				const completion = {
					p_run_id: runId,
					p_user_id: ownerId,
					p_project_id: id,
					p_render_id: randomUUID(),
					p_approval_hash: snapshot.data.approvalHash,
				};
				expect(
					(await owner.rpc("complete_film_run_export", completion)).error,
				).not.toBeNull();
				for (const invalid of [
					{ p_user_id: randomUUID() },
					{ p_project_id: randomUUID() },
					{ p_run_id: randomUUID() },
					{ p_approval_hash: "0".repeat(32) },
				]) {
					const refused = await admin.rpc("complete_film_run_export", {
						...completion,
						...invalid,
					});
					expect(refused.error).toBeNull();
					expect(refused.data).toBe(false);
				}
				const completed = await admin.rpc(
					"complete_film_run_export",
					completion,
				);
				expect(completed.error).toBeNull();
				expect(completed.data).toBe(variant === "matching");
				if (variant === "matching") {
					const repeated = await admin.rpc(
						"complete_film_run_export",
						completion,
					);
					expect(repeated.error).toBeNull();
					expect(repeated.data).toBe(true);
					expect(
						(
							await admin.rpc("complete_film_run_export", {
								...completion,
								p_render_id: randomUUID(),
							})
						).data,
					).toBe(false);
					expect((await control(id, "read", runId)).data).toMatchObject({
						status: "completed",
						completed_export_id: completion.p_render_id,
						completed_approval_hash: completion.p_approval_hash,
					});
				}
			},
		);
		it("deduplicates simultaneous starts and persists the same run", async () => {
			const id = await project();
			const started = await Promise.all(
				Array.from({ length: 5 }, () => control(id, "start", randomUUID())),
			);
			for (const result of started) expect(result.error).toBeNull();
			expect(new Set(started.map((result) => result.data.id)).size).toBe(1);
			const runId = started[0].data.id;
			const saved = await control(id, "read", runId);
			expect(saved.data).toMatchObject({
				id: runId,
				project_id: id,
				status: "queued",
				mode: "directed",
			});
			const jobs = await admin.from("jobs").select("id").eq("project_id", id);
			expect(jobs.error).toBeNull();
			expect(jobs.data).toEqual([]);
		});
		it("requires current Bible approval and a cap", async () => {
			const unapproved = await project(false);
			expect(
				(await control(unapproved, "start", randomUUID())).error?.message,
			).toContain("Approve the current Film Bible");
			const uncapped = await project(true, false);
			expect(
				(await control(uncapped, "start", randomUUID())).error?.message,
			).toContain("spending cap");
		});
		it("persists pause and resume, and does not resurrect cancelled runs", async () => {
			const id = await project();
			const runId = randomUUID();
			expect((await control(id, "start", runId)).error).toBeNull();
			expect((await control(id, "pause", runId)).data.status).toBe("paused");
			expect((await control(id, "read", runId)).data.status).toBe("paused");
			expect((await control(id, "resume", runId)).data.status).toBe("queued");
			expect((await control(id, "cancel", runId)).data.status).toBe(
				"cancelled",
			);
			expect((await control(id, "start", runId)).data.status).toBe("cancelled");
			expect((await control(id, "resume", runId)).error?.message).toContain(
				"cannot be resumed",
			);
			expect((await control(id, "start", randomUUID())).data.status).toBe(
				"queued",
			);
		});
		it("refuses a changed script even after the replacement Bible is approved", async () => {
			const id = await project();
			const runId = randomUUID();
			await control(id, "start", runId);
			await control(id, "pause", runId);
			const edit = await owner
				.from("projects")
				.update({ script: "A changed canonical script." })
				.eq("id", id);
			expect(edit.error).toBeNull();
			await review(id, "bible");
			expect((await control(id, "resume", runId)).error?.message).toContain(
				"settings or mode changed",
			);
			expect((await control(id, "read", runId)).data.status).toBe("paused");
		});
		it("refuses mode changes during a paused run", async () => {
			const id = await project();
			const runId = randomUUID();
			await control(id, "start", runId);
			await control(id, "pause", runId);
			await review(id, "autonomous");
			expect((await control(id, "resume", runId)).error?.message).toContain(
				"settings or mode changed",
			);
		});
		it.each([false, true])(
			"allows recovery but refuses new spend when the ledger is exhausted or uncertain: %s",
			async (uncertain) => {
				const id = await project();
				const runId = randomUUID();
				await control(id, "start", runId);
				await prepareFilmRunPlan(admin, runId);
				await control(id, "pause", runId);
				const model = { provider: "openslop", model: "Seedream 5 Lite" };
				const reserved = await admin
					.from("jobs")
					.insert({
						project_id: id,
						user_id: ownerId,
						connector_type: "image",
						request: { ...model, prompt: "Synthetic admission fixture only" },
						cost_quote: {
							...model,
							ceilingUsd: uncertain ? 0.1 : 1,
							currency: "USD",
							source: "synthetic-price-fixture",
							expiresAt: new Date(Date.now() + 300000).toISOString(),
						},
					})
					.select("id")
					.single();
				if (reserved.error) throw reserved.error;
				if (uncertain) {
					for (const patch of [
						{ status: "processing" },
						{ provider_started_at: new Date().toISOString() },
						{ status: "failed", error: "Synthetic unknown invoice" },
					]) {
						const updated = await admin
							.from("jobs")
							.update(patch)
							.eq("id", reserved.data.id);
						if (updated.error) throw updated.error;
					}
				}
				const resumed = await control(id, "resume", runId);
				expect(resumed.error).toBeNull();
				expect(resumed.data.status).toBe("queued");
				const held = await lease(runId, "claim");
				expect(held.error).toBeNull();
				expect(held.data.lease_id).toBeTruthy();
				const extra = await admin.from("jobs").insert({
					project_id: id,
					user_id: ownerId,
					connector_type: "image",
					request: { ...model, prompt: "Must not be admitted" },
					cost_quote: {
						...model,
						ceilingUsd: 0.01,
						currency: "USD",
						source: "synthetic-price-fixture",
						expiresAt: new Date(Date.now() + 300000).toISOString(),
					},
				});
				expect(extra.error?.message).toContain(
					uncertain ? "billing review" : "exceed the project cap",
				);
				if (!uncertain) {
					for (const patch of [
						{ status: "processing" },
						{ provider_started_at: new Date().toISOString() },
						{ status: "completed", cost_usd: 1 },
					]) {
						const updated = await admin
							.from("jobs")
							.update(patch)
							.eq("id", reserved.data.id);
						if (updated.error) throw updated.error;
					}
				}
				const renewed = await lease(runId, "renew", held.data.lease_id);
				expect(renewed.error).toBeNull();
				expect(renewed.data.lease_id).toBe(held.data.lease_id);
				const jobs = await admin.from("jobs").select("id").eq("project_id", id);
				expect(jobs.error).toBeNull();
				expect(jobs.data).toHaveLength(1);
			},
		);
		it("rejects changed model settings without replacing the canonical project", async () => {
			const id = await project();
			const runId = randomUUID();
			await control(id, "start", runId);
			await control(id, "pause", runId);
			const changed = await owner
				.from("projects")
				.update({
					store: {
						models: {
							image: { provider: "openslop", model: "Seedream 5 Lite" },
						},
					},
				})
				.eq("id", id);
			expect(changed.error).toBeNull();
			await review(id, "bible");
			expect((await control(id, "resume", runId)).error?.message).toContain(
				"settings or mode changed",
			);
		});
		it("installs the canonical plan once without creating provider jobs", async () => {
			const id = await project();
			const runId = randomUUID();
			await control(id, "start", runId);
			const plan = await prepareFilmRunPlan(admin, runId);
			expect(await prepareFilmRunPlan(admin, runId)).toEqual(plan);
			const read = await control(id, "read", runId);
			expect(read.data.plan).toEqual(plan);
			expect(read.data.planned_generation).toEqual({});
			const rewritten = await admin.rpc("install_film_run_plan", {
				p_run_id: runId,
				p_generation: {},
				p_plan: { ...plan, rootIds: ["different"] },
			});
			expect(rewritten.error?.message).toContain("cannot be replaced");
			const untrusted = await owner.rpc("install_film_run_plan", {
				p_run_id: runId,
				p_generation: {},
				p_plan: plan,
			});
			expect(untrusted.error).not.toBeNull();
			const jobs = await admin.from("jobs").select("id").eq("project_id", id);
			expect(jobs.error).toBeNull();
			expect(jobs.data).toEqual([]);
		});
		it("rejects selected-take races between reading and installing a plan", async () => {
			const id = await project();
			const runId = randomUUID();
			await control(id, "start", runId);
			const current = await admin
				.from("projects")
				.select("script,store,generation")
				.eq("id", id)
				.single();
			if (current.error) throw current.error;
			const plan = buildFilmRunPlan(current.data);
			const updated = await owner
				.from("projects")
				.update({
					generation: {
						fixture: {
							status: "idle",
							startedAt: null,
							result: {
								imageUrl: "https://example.invalid/replacement.png",
								durationSec: 0,
							},
							connectorType: "image",
							resultInputs: null,
							error: null,
							pinned: true,
						},
					},
				})
				.eq("id", id);
			expect(updated.error).toBeNull();
			const installed = await admin.rpc("install_film_run_plan", {
				p_run_id: runId,
				p_generation: current.data.generation,
				p_plan: plan,
			});
			expect(installed.error?.message).toContain("selected takes changed");
			expect((await control(id, "read", runId)).data.plan).toBeNull();
		});
		it("does not install a plan after pause or cancellation", async () => {
			const id = await project();
			const runId = randomUUID();
			await control(id, "start", runId);
			const current = await admin
				.from("projects")
				.select("script,store,generation")
				.eq("id", id)
				.single();
			if (current.error) throw current.error;
			const plan = buildFilmRunPlan(current.data);
			for (const action of ["pause", "cancel"]) {
				await control(id, action, runId);
				const installed = await admin.rpc("install_film_run_plan", {
					p_run_id: runId,
					p_generation: current.data.generation,
					p_plan: plan,
				});
				expect(installed.error?.message).toContain("Only queued runs");
			}
		});
		const plannedRun = async (script?: string) => {
			const projectId = await project();
			if (script) {
				const updated = await owner
					.from("projects")
					.update({ script })
					.eq("id", projectId);
				if (updated.error) throw updated.error;
				await review(projectId, "bible");
			}
			const runId = randomUUID();
			const started = await control(projectId, "start", runId);
			if (started.error) throw started.error;
			await prepareFilmRunPlan(admin, runId);
			return { projectId, runId };
		};
		const lease = (
			runId: string,
			action: string,
			token: string | null = null,
			client = admin,
		) =>
			client.rpc("film_run_lease", {
				p_run_id: runId,
				p_action: action,
				p_lease_id: token,
			});
		it("allows only one concurrent worker lease and renews the same token", async () => {
			const { runId } = await plannedRun();
			const claims = await Promise.all(
				Array.from({ length: 5 }, () => lease(runId, "claim")),
			);
			for (const claim of claims) expect(claim.error).toBeNull();
			const winners = claims.filter((claim) => claim.data !== null);
			expect(winners).toHaveLength(1);
			const held = winners[0].data;
			const renewed = await lease(runId, "renew", held.lease_id);
			expect(renewed.error).toBeNull();
			expect(renewed.data.lease_id).toBe(held.lease_id);
			expect(Date.parse(renewed.data.expires_at)).toBeGreaterThanOrEqual(
				Date.parse(held.expires_at),
			);
			expect((await lease(runId, "release", held.lease_id)).data.lease_id).toBe(
				held.lease_id,
			);
			expect((await lease(runId, "claim")).data.lease_id).not.toBe(
				held.lease_id,
			);
		});
		it("fences expired workers after a replacement claims the run", async () => {
			const { runId } = await plannedRun();
			const first = await lease(runId, "claim");
			if (first.error) throw first.error;
			const expired = await admin
				.from("film_run_leases")
				.update({ expires_at: new Date(0).toISOString() })
				.eq("run_id", runId);
			expect(expired.error).toBeNull();
			const second = await lease(runId, "claim");
			expect(second.error).toBeNull();
			expect(second.data.lease_id).not.toBe(first.data.lease_id);
			expect(
				(await lease(runId, "renew", first.data.lease_id)).data,
			).toBeNull();
			expect(
				(await lease(runId, "release", first.data.lease_id)).data,
			).toBeNull();
			expect(
				(await lease(runId, "renew", second.data.lease_id)).data.lease_id,
			).toBe(second.data.lease_id);
		});
		it("revokes leases on pause and cancel, including after resume", async () => {
			const { projectId, runId } = await plannedRun();
			const first = await lease(runId, "claim");
			if (first.error) throw first.error;
			await control(projectId, "pause", runId);
			expect(
				(await lease(runId, "renew", first.data.lease_id)).data,
			).toBeNull();
			expect((await lease(runId, "claim")).data).toBeNull();
			await control(projectId, "resume", runId);
			const second = await lease(runId, "claim");
			expect(second.data.lease_id).not.toBe(first.data.lease_id);
			await control(projectId, "cancel", runId);
			expect(
				(await lease(runId, "renew", second.data.lease_id)).data,
			).toBeNull();
		});
		it("denies worker lease access to ordinary signed-in users", async () => {
			const { runId } = await plannedRun();
			for (const action of ["claim", "renew", "release"]) {
				expect(
					(await lease(runId, action, randomUUID(), owner)).error,
				).not.toBeNull();
			}
			expect(
				(await owner.from("film_run_leases").select("*")).error,
			).not.toBeNull();
		});
		it("requires an installed plan and rechecks the canonical source on claim", async () => {
			const projectId = await project();
			const runId = randomUUID();
			await control(projectId, "start", runId);
			expect((await lease(runId, "claim")).error?.message).toContain(
				"Install the canonical plan",
			);
			await prepareFilmRunPlan(admin, runId);
			const edit = await owner
				.from("projects")
				.update({ script: "Changed while waiting for a worker." })
				.eq("id", projectId);
			expect(edit.error).toBeNull();
			expect((await lease(runId, "claim")).error?.message).toContain(
				"canonical project or selected takes changed",
			);
		});
		const admissionFixture = async (script?: string) => {
			const { projectId, runId } = await plannedRun(script);
			const plan = await prepareFilmRunPlan(admin, runId);
			const held = await lease(runId, "claim");
			if (held.error) throw held.error;
			const node = plan.nodes[0];
			const request = { ...node.model, prompt: node.inputs.prompt };
			const quote = {
				...node.model,
				ceilingUsd: 1,
				currency: "USD",
				source: "synthetic-price-fixture",
				expiresAt: new Date(Date.now() + 300000).toISOString(),
			};
			return {
				projectId,
				runId,
				nodeId: node.id,
				token: held.data.lease_id,
				request,
				quote,
			};
		};
		const admit = (
			fixture: Omit<
				Awaited<ReturnType<typeof admissionFixture>>,
				"request" | "quote"
			> & {
				request: Record<string, unknown>;
				quote:
					| Awaited<ReturnType<typeof quoteAssetCost>>
					| Awaited<ReturnType<typeof admissionFixture>>["quote"];
			},
			client = admin,
		) =>
			client.rpc("admit_film_run_job", {
				p_run_id: fixture.runId,
				p_lease_id: fixture.token,
				p_node_id: fixture.nodeId,
				p_request: fixture.request,
				p_quote: fixture.quote,
			});
		it("bounds a compiled Kling video against the project cap and deduplicates admission", async () => {
			const projectId = await project();
			const model = { provider: "runware", model: "Kling 3 Turbo" } as const;
			const changed = await owner
				.from("projects")
				.update({
					script:
						'<video id="shot" duration="8" resolution="1080p">A lighthouse.</video>',
					store: { models: { video: model } },
				})
				.eq("id", projectId);
			expect(changed.error).toBeNull();
			await review(projectId, "bible");
			const runId = randomUUID();
			expect((await control(projectId, "start", runId)).error).toBeNull();
			const plan = await prepareFilmRunPlan(admin, runId);
			const held = await lease(runId, "claim");
			if (held.error) throw held.error;
			const request = {
				...(await compileFilmRunRequest(plan, "shot", {}, projectId)),
				...model,
			};
			const pricingFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
				Response.json({
					info: {
						"x-air-id": "klingai:kling-video@3.0-turbo",
						"x-status": "live",
						"x-pricing": {
							currency: "USD",
							rates: [
								{ amount: 0.112, unit: "durationSecond", label: "720p" },
								{ amount: 0.14, unit: "durationSecond", label: "1080p" },
							],
						},
					},
				}),
			);
			let quote;
			try {
				quote = await quoteAssetCost("video", request);
			} finally {
				pricingFetch.mockRestore();
			}
			expect(quote.ceilingUsd).toBeCloseTo(1.12, 5);
			const fixture = {
				projectId,
				runId,
				nodeId: "shot",
				token: held.data.lease_id,
				request,
				quote,
			};
			expect((await admit(fixture)).error?.message).toMatch(/cap/i);
			const rejectedJobs = await admin
				.from("jobs")
				.select("id")
				.eq("project_id", projectId);
			expect(rejectedJobs.data).toEqual([]);
			expect(
				(
					await owner.rpc("set_film_autonomous_cap", {
						p_project_id: projectId,
						p_cap_usd: 2,
					})
				).error,
			).toBeNull();
			const first = await admit(fixture);
			expect(first.error).toBeNull();
			const repeat = await admit(fixture);
			expect(repeat.error).toBeNull();
			expect(repeat.data).toBe(first.data);
			const persisted = await admin
				.from("jobs")
				.select("request,cost_quote")
				.eq("id", first.data)
				.single();
			expect(persisted.error).toBeNull();
			expect(persisted.data?.request).toMatchObject({
				...model,
				duration: 8,
				resolution: "1080p",
			});
			expect(persisted.data?.cost_quote).toEqual(quote);
		});

		it("atomically admits one priced job despite concurrent workers repeating the same step", async () => {
			const fixture = await admissionFixture();
			const admitted = await Promise.all(
				Array.from({ length: 5 }, () => admit(fixture)),
			);
			for (const result of admitted) expect(result.error).toBeNull();
			expect(new Set(admitted.map((result) => result.data)).size).toBe(1);
			const jobs = await admin
				.from("jobs")
				.select("id,billing_state,reserved_cost_usd,status")
				.eq("project_id", fixture.projectId);
			expect(jobs.error).toBeNull();
			expect(jobs.data).toHaveLength(1);
			expect(jobs.data?.[0]).toMatchObject({
				billing_state: "reserved",
				reserved_cost_usd: 1,
				status: "pending",
			});
			const bindings = await admin
				.from("film_run_jobs")
				.select("job_id")
				.eq("run_id", fixture.runId);
			expect(bindings.data).toEqual([{ job_id: admitted[0].data }]);
			const deliveries = await admin
				.from("asset_deliveries")
				.select("job_id")
				.eq("job_id", admitted[0].data);
			expect(deliveries.error).toBeNull();
			expect(deliveries.data).toEqual([]);
		});
		it("recovers the same job after lease replacement and rejects the expired worker", async () => {
			const fixture = await admissionFixture();
			const first = await admit(fixture);
			expect(first.error).toBeNull();
			const expired = await admin
				.from("film_run_leases")
				.update({ expires_at: new Date(0).toISOString() })
				.eq("run_id", fixture.runId);
			expect(expired.error).toBeNull();
			const next = await lease(fixture.runId, "claim");
			expect(next.error).toBeNull();
			expect((await admit(fixture)).error?.message).toContain(
				"lease is no longer valid",
			);
			const recovered = await admit({ ...fixture, token: next.data.lease_id });
			expect(recovered.error).toBeNull();
			expect(recovered.data).toBe(first.data);
		});
		it("refuses changed requests, unplanned models, and untrusted admission", async () => {
			const fixture = await admissionFixture();
			expect((await admit(fixture, owner)).error).not.toBeNull();
			expect(
				(
					await admit({
						...fixture,
						request: { ...fixture.request, model: "unplanned-model" },
					})
				).error?.message,
			).toContain("planned model");
			expect((await admit(fixture)).error).toBeNull();
			expect(
				(
					await admit({
						...fixture,
						request: { ...fixture.request, prompt: "Different scene" },
					})
				).error?.message,
			).toContain("different immutable request");
		});
		it("rolls back both job and association when the new charge exceeds the cap", async () => {
			const fixture = await admissionFixture();
			const denied = await admit({
				...fixture,
				quote: { ...fixture.quote, ceilingUsd: 2 },
			});
			expect(denied.error?.message).toContain("exceed the project cap");
			const jobs = await admin
				.from("jobs")
				.select("id")
				.eq("project_id", fixture.projectId);
			const bindings = await admin
				.from("film_run_jobs")
				.select("job_id")
				.eq("run_id", fixture.runId);
			expect(jobs.error).toBeNull();
			expect(bindings.error).toBeNull();
			expect(jobs.data).toEqual([]);
			expect(bindings.data).toEqual([]);
		});
		it("refuses admission after pause or cancellation", async () => {
			const fixture = await admissionFixture();
			await control(fixture.projectId, "pause", fixture.runId);
			expect((await admit(fixture)).error?.message).toContain(
				"lease is no longer valid",
			);
			await control(fixture.projectId, "cancel", fixture.runId);
			expect((await admit(fixture)).error?.message).toContain(
				"lease is no longer valid",
			);
		});
		it("waits for generated character dependencies to be committed", async () => {
			const fixture = await admissionFixture(
				'<asset_avatar id="mira" name="Mira">Radio engineer.</asset_avatar>\n--- Scene 1 ---\n<image id="shot">{{Mira}} at the radio.</image>',
			);
			const denied = await admit({ ...fixture, nodeId: "shot" });
			expect(denied.error?.message).toContain("required dependency");
		});
		it("requires current image approval before video admission", async () => {
			const fixture = await admissionFixture(
				'--- Scene 1 ---\n<image id="shot">Radio tower.</image>\n<video id="motion" continuity="false" startFrame="none">Approach the tower.</video>',
			);
			const plan = await prepareFilmRunPlan(admin, fixture.runId);
			const video = plan.nodes.find((node) => node.id === "motion");
			if (!video) throw new Error("Missing video fixture");
			const denied = await admit({
				...fixture,
				nodeId: video.id,
				request: { ...video.model, prompt: video.inputs.prompt },
				quote: { ...fixture.quote, ...video.model },
			});
			expect(denied.error?.message).toContain("Review the current images");
		});
		it("retains job identity when a bound job is deleted without its run", async () => {
			const fixture = await admissionFixture();
			const first = await admit(fixture);
			expect(first.error).toBeNull();
			const deletion = await admin.from("jobs").delete().eq("id", first.data);
			expect(deletion.error).not.toBeNull();
			expect((await admit(fixture)).data).toBe(first.data);
		});
		const dispatch = (
			fixture: Awaited<ReturnType<typeof admissionFixture>>,
			client = admin,
		) =>
			client.rpc("dispatch_film_run_job", {
				p_run_id: fixture.runId,
				p_lease_id: fixture.token,
				p_node_id: fixture.nodeId,
			});
		it("dispatches concurrent retries once without resetting an existing delivery lease or delay", async () => {
			const fixture = await admissionFixture();
			const admitted = await admit(fixture);
			expect(admitted.error).toBeNull();
			const attempts = await Promise.all(
				Array.from({ length: 5 }, () => dispatch(fixture)),
			);
			for (const attempt of attempts) {
				expect(attempt.error).toBeNull();
				expect(attempt.data).toBe(admitted.data);
			}
			const held = await admin
				.from("asset_deliveries")
				.update({
					lease_id: randomUUID(),
					lease_until: new Date(Date.now() + 600000).toISOString(),
					available_at: new Date(Date.now() + 300000).toISOString(),
				})
				.eq("job_id", admitted.data)
				.select()
				.single();
			expect(held.error).toBeNull();
			expect((await dispatch(fixture)).error).toBeNull();
			const after = await admin
				.from("asset_deliveries")
				.select()
				.eq("job_id", admitted.data);
			expect(after.error).toBeNull();
			expect(after.data).toEqual([held.data]);
		});
		it("requires admission, service authorization and a valid lease before dispatch", async () => {
			const fixture = await admissionFixture();
			expect((await dispatch(fixture)).error?.message).toContain(
				"Admit this planned step",
			);
			expect((await admit(fixture)).error).toBeNull();
			expect((await dispatch(fixture, owner)).error).not.toBeNull();
			expect(
				(await dispatch({ ...fixture, token: randomUUID() })).error?.message,
			).toContain("lease is no longer valid");
			const paused = await control(fixture.projectId, "pause", fixture.runId);
			expect(paused.error).toBeNull();
			expect((await dispatch(fixture)).error?.message).toContain(
				"lease is no longer valid",
			);
			expect(
				(await control(fixture.projectId, "cancel", fixture.runId)).error,
			).toBeNull();
			expect((await dispatch(fixture)).error?.message).toContain(
				"lease is no longer valid",
			);
		});
		it("recovers a missing delivery with a replacement run lease without admitting a new charge", async () => {
			const fixture = await admissionFixture();
			const admitted = await admit(fixture);
			expect(admitted.error).toBeNull();
			expect(
				(await lease(fixture.runId, "release", fixture.token)).error,
			).toBeNull();
			const replacement = await lease(fixture.runId, "claim");
			expect(replacement.error).toBeNull();
			expect((await dispatch(fixture)).error?.message).toContain(
				"lease is no longer valid",
			);
			const recovered = await dispatch({
				...fixture,
				token: replacement.data.lease_id,
			});
			expect(recovered.error).toBeNull();
			expect(recovered.data).toBe(admitted.data);
			const jobs = await admin
				.from("jobs")
				.select("id,reserved_cost_usd")
				.eq("project_id", fixture.projectId);
			expect(jobs.error).toBeNull();
			expect(jobs.data).toEqual([{ id: admitted.data, reserved_cost_usd: 1 }]);
		});
		it("does not redeliver a terminal job", async () => {
			const fixture = await admissionFixture();
			const admitted = await admit(fixture);
			expect(admitted.error).toBeNull();
			const failed = await admin
				.from("jobs")
				.update({ status: "failed", cost_usd: 0 })
				.eq("id", admitted.data);
			expect(failed.error).toBeNull();
			const result = await dispatch(fixture);
			expect(result.error).toBeNull();
			expect(result.data).toBe(admitted.data);
			const deliveries = await admin
				.from("asset_deliveries")
				.select("job_id")
				.eq("job_id", admitted.data);
			expect(deliveries.error).toBeNull();
			expect(deliveries.data).toEqual([]);
		});
		it("blocks a pause racing after job claim and permits the same job after resume", async () => {
			const fixture = await admissionFixture();
			const admitted = await admit(fixture);
			expect(admitted.error).toBeNull();
			expect(
				(
					await admin
						.from("jobs")
						.update({ status: "processing" })
						.eq("id", admitted.data)
				).error,
			).toBeNull();
			expect(
				(await control(fixture.projectId, "pause", fixture.runId)).error,
			).toBeNull();
			const denied = await admin
				.from("jobs")
				.update({ provider_started_at: new Date().toISOString() })
				.eq("id", admitted.data);
			expect(denied.error?.message).toContain("FYLMER_RUN_WAIT");
			expect(
				(
					await admin
						.from("jobs")
						.update({ status: "pending" })
						.eq("id", admitted.data)
				).error,
			).toBeNull();
			expect(
				(await control(fixture.projectId, "resume", fixture.runId)).error,
			).toBeNull();
			expect((await lease(fixture.runId, "claim")).error).toBeNull();
			expect(
				(
					await admin
						.from("jobs")
						.update({ status: "processing" })
						.eq("id", admitted.data)
				).error,
			).toBeNull();
			expect(
				(
					await admin
						.from("jobs")
						.update({ provider_started_at: new Date().toISOString() })
						.eq("id", admitted.data)
				).error,
			).toBeNull();
		});
		it.each(["pause", "cancel"])(
			"allows already-submitted polling and settlement after %s without another reservation",
			async (action) => {
				const fixture = await admissionFixture();
				const admitted = await admit(fixture);
				expect(admitted.error).toBeNull();
				expect(
					(
						await admin
							.from("jobs")
							.update({ status: "processing" })
							.eq("id", admitted.data)
					).error,
				).toBeNull();
				expect(
					(
						await admin
							.from("jobs")
							.update({ provider_started_at: new Date().toISOString() })
							.eq("id", admitted.data)
					).error,
				).toBeNull();
				expect(
					(await control(fixture.projectId, action, fixture.runId)).error,
				).toBeNull();
				for (const status of ["pending", "processing"]) {
					expect(
						(
							await admin
								.from("jobs")
								.update({ status })
								.eq("id", admitted.data)
						).error,
					).toBeNull();
				}
				const settled = await admin
					.from("jobs")
					.update({ status: "completed", cost_usd: 1 })
					.eq("id", admitted.data)
					.select("billing_state,cost_usd")
					.single();
				expect(settled.error).toBeNull();
				expect(settled.data).toEqual({ billing_state: "settled", cost_usd: 1 });
			},
		);
		it.each(["cancel", "source", "lease"])(
			"refuses an unsent job when its run changes: %s",
			async (change) => {
				const fixture = await admissionFixture();
				const admitted = await admit(fixture);
				expect(admitted.error).toBeNull();
				if (change === "cancel")
					expect(
						(await control(fixture.projectId, "cancel", fixture.runId)).error,
					).toBeNull();
				if (change === "source")
					expect(
						(
							await owner
								.from("projects")
								.update({ script: "Changed film" })
								.eq("id", fixture.projectId)
						).error,
					).toBeNull();
				if (change === "lease")
					expect(
						(
							await admin
								.from("film_run_leases")
								.update({ expires_at: new Date(0).toISOString() })
								.eq("run_id", fixture.runId)
						).error,
					).toBeNull();
				const denied = await admin
					.from("jobs")
					.update({ status: "processing" })
					.eq("id", admitted.data);
				expect(denied.error?.message).toContain(
					change === "lease" ? "FYLMER_RUN_WAIT" : "FYLMER_RUN_STOP",
				);
				const saved = await admin
					.from("jobs")
					.select("status,provider_started_at,billing_state")
					.eq("id", admitted.data)
					.single();
				expect(saved.error).toBeNull();
				expect(saved.data).toEqual({
					status: "pending",
					provider_started_at: null,
					billing_state: "reserved",
				});
			},
		);
		it("leaves paused deliveries unclaimed and resumes them without touching non-fixture work", async () => {
			const fixture = await admissionFixture();
			const admitted = await admit(fixture);
			expect(admitted.error).toBeNull();
			expect((await dispatch(fixture)).error).toBeNull();
			expect(
				(await control(fixture.projectId, "pause", fixture.runId)).error,
			).toBeNull();
			const queue = await admin
				.from("asset_deliveries")
				.select("job_id,jobs!inner(user_id)");
			expect(queue.error).toBeNull();
			const rows = z
				.array(
					z.object({
						job_id: z.string(),
						jobs: z.object({ user_id: z.literal(ownerId) }),
					}),
				)
				.parse(queue.data);
			for (let index = 0; index <= rows.length; index++) {
				const claimed = await admin.rpc("claim_asset_delivery");
				expect(claimed.error).toBeNull();
				expect(
					claimed.data.some(
						(delivery: { job_id: string }) => delivery.job_id === admitted.data,
					),
				).toBe(false);
				if (claimed.data.length === 0) break;
			}
			expect(
				(await control(fixture.projectId, "resume", fixture.runId)).error,
			).toBeNull();
			expect((await lease(fixture.runId, "claim")).error).toBeNull();
			const claimed = await admin.rpc("claim_asset_delivery");
			expect(claimed.error).toBeNull();
			expect(claimed.data).toEqual([
				expect.objectContaining({ job_id: admitted.data }),
			]);
		});
		const reviewedVideoJob = async (withImage = true) => {
			const projectId = await project();
			const script = `--- Scene 1 ---\n${withImage ? '<image id="shot">Radio tower.</image>\n' : ""}<video id="motion" continuity="false" startFrame="none">Approach the tower.</video>`;
			const generation = withImage
				? {
						shot: {
							status: "idle",
							startedAt: null,
							error: null,
							resultInputs: null,
							connectorType: "image",
							pinned: true,
							result: {
								imageUrl: "https://example.invalid/tower.png",
								durationSec: 0,
							},
						},
					}
				: {};
			expect(
				(
					await owner
						.from("projects")
						.update({ script, generation })
						.eq("id", projectId)
				).error,
			).toBeNull();
			await review(projectId, "bible");
			if (withImage) await review(projectId, "images");
			const runId = randomUUID();
			expect((await control(projectId, "start", runId)).error).toBeNull();
			const plan = await prepareFilmRunPlan(admin, runId);
			const node = plan.nodes.find((node) => node.id === "motion");
			if (!node) throw new Error("Missing video node");
			const held = await lease(runId, "claim");
			expect(held.error).toBeNull();
			const admitted = await admit({
				projectId,
				runId,
				nodeId: node.id,
				token: held.data.lease_id,
				request: { ...node.model, prompt: node.inputs.prompt },
				quote: {
					...node.model,
					ceilingUsd: 1,
					currency: "USD",
					source: "synthetic-price-fixture",
					expiresAt: new Date(Date.now() + 300000).toISOString(),
				},
			});
			expect(admitted.error).toBeNull();
			return { projectId, jobId: admitted.data };
		};
		it.each(["claim", "submission"])(
			"requires renewed image review after revocation at video %s",
			async (boundary) => {
				const { projectId, jobId } = await reviewedVideoJob();
				if (boundary === "submission")
					expect(
						(
							await admin
								.from("jobs")
								.update({ status: "processing" })
								.eq("id", jobId)
						).error,
					).toBeNull();
				await review(projectId, "bible");
				const patch =
					boundary === "claim"
						? { status: "processing" }
						: { provider_started_at: new Date().toISOString() };
				const denied = await admin.from("jobs").update(patch).eq("id", jobId);
				expect(denied.error?.message).toContain("Review the current images");
				const saved = await admin
					.from("jobs")
					.select("provider_started_at,billing_state")
					.eq("id", jobId)
					.single();
				expect(saved.error).toBeNull();
				expect(saved.data).toEqual({
					provider_started_at: null,
					billing_state: "reserved",
				});
				await review(projectId, "images");
				expect(
					(await admin.from("jobs").update(patch).eq("id", jobId)).error,
				).toBeNull();
			},
		);
		it("allows text-only video without a fictitious image approval stage", async () => {
			const { jobId } = await reviewedVideoJob(false);
			expect(
				(
					await admin
						.from("jobs")
						.update({ status: "processing" })
						.eq("id", jobId)
				).error,
			).toBeNull();
			expect(
				(
					await admin
						.from("jobs")
						.update({ provider_started_at: new Date().toISOString() })
						.eq("id", jobId)
				).error,
			).toBeNull();
		});
		it("settles an already-submitted video even when image review is revoked", async () => {
			const { projectId, jobId } = await reviewedVideoJob();
			expect(
				(
					await admin
						.from("jobs")
						.update({ status: "processing" })
						.eq("id", jobId)
				).error,
			).toBeNull();
			expect(
				(
					await admin
						.from("jobs")
						.update({ provider_started_at: new Date().toISOString() })
						.eq("id", jobId)
				).error,
			).toBeNull();
			await review(projectId, "bible");
			for (const status of ["pending", "processing"])
				expect(
					(await admin.from("jobs").update({ status }).eq("id", jobId)).error,
				).toBeNull();
			const settled = await admin
				.from("jobs")
				.update({ status: "completed", cost_usd: 1 })
				.eq("id", jobId)
				.select("billing_state")
				.single();
			expect(settled.error).toBeNull();
			expect(settled.data?.billing_state).toBe("settled");
		});
		it("coordinates admission, same-job recovery, canonical commit and final review without provider calls", async () => {
			const fixture = await admissionFixture();
			const input = {
				runId: fixture.runId,
				leaseId: fixture.token,
				appOrigin: "http://127.0.0.1:3055",
			};
			const quote = vi.fn().mockResolvedValue(fixture.quote);
			try {
				vi.stubEnv("FYLMER_STAGING_GENERATION_ENABLED", "0");
				expect(await advanceFilmRun(admin, input, quote)).toEqual({
					kind: "paused",
				});
				expect(quote).not.toHaveBeenCalled();
				vi.stubEnv("FYLMER_STAGING_GENERATION_ENABLED", "1");
				const first = await advanceFilmRun(admin, input, quote);
				expect(first.kind).toBe("dispatched");
				if (first.kind !== "dispatched")
					throw new Error("Expected synthetic dispatch");
				const retry = await advanceFilmRun(admin, input, quote);
				expect(retry).toEqual({
					kind: "waiting",
					nodeId: first.nodeId,
					jobId: first.jobId,
				});
				expect(quote).toHaveBeenCalledTimes(1);
				const completed = await admin
					.from("jobs")
					.update({
						status: "completed",
						result: {
							id: first.jobId,
							type: "image",
							provider: "openslop",
							result: { image: "shot.png" },
							metadata: { durationSec: 0 },
						},
						cost_usd: 0,
					})
					.eq("id", first.jobId);
				expect(completed.error).toBeNull();
				expect(await advanceFilmRun(admin, input, quote)).toEqual({
					kind: "committed",
					nodeId: first.nodeId,
					jobId: first.jobId,
				});
				expect(await advanceFilmRun(admin, input, quote)).toEqual({
					kind: "review",
					stage: "final",
				});
				const jobs = await admin
					.from("jobs")
					.select("id")
					.eq("project_id", fixture.projectId);
				expect(jobs.data).toEqual([{ id: first.jobId }]);
				const project = await admin
					.from("projects")
					.select("generation")
					.eq("id", fixture.projectId)
					.single();
				expect(
					project.data?.generation[first.nodeId].result.imageUrl,
				).toContain(first.jobId);
			} finally {
				vi.unstubAllEnvs();
			}
		});
		it("does not coordinate a paused run or admit above its project cap", async () => {
			const fixture = await admissionFixture();
			const input = {
				runId: fixture.runId,
				leaseId: fixture.token,
				appOrigin: "http://127.0.0.1:3055",
			};
			try {
				vi.stubEnv("FYLMER_STAGING_GENERATION_ENABLED", "1");
				const quote = vi
					.fn()
					.mockResolvedValue({ ...fixture.quote, ceilingUsd: 2 });
				await expect(advanceFilmRun(admin, input, quote)).rejects.toThrow(
					"exceed the project cap",
				);
				const jobs = await admin
					.from("jobs")
					.select("id")
					.eq("project_id", fixture.projectId);
				expect(jobs.data).toEqual([]);
				await control(fixture.projectId, "pause", fixture.runId);
				expect(await advanceFilmRun(admin, input, quote)).toEqual({
					kind: "stopped",
				});
				expect(quote).toHaveBeenCalledTimes(1);
			} finally {
				vi.unstubAllEnvs();
			}
		});
		it("bootstraps one coordinator for an admitted job and fences pause/resume ownership", async () => {
			const fixture = await admissionFixture();
			const admitted = await admit(fixture);
			expect(admitted.error).toBeNull();
			expect(
				(await lease(fixture.runId, "release", fixture.token)).error,
			).toBeNull();
			const input = {
				runId: fixture.runId,
				appOrigin: "http://127.0.0.1:3055",
			};
			try {
				vi.stubEnv("FYLMER_STAGING_GENERATION_ENABLED", "1");
				const attempts = await Promise.all(
					Array.from({ length: 3 }, () => tickFilmRun(admin, input)),
				);
				const winner = attempts.find((attempt) => attempt.kind === "waiting");
				if (!winner || winner.kind !== "waiting")
					throw new Error("Expected one coordinator owner");
				expect(
					attempts.filter((attempt) => attempt.kind === "waiting"),
				).toHaveLength(1);
				expect(
					attempts.filter((attempt) => attempt.kind === "unavailable"),
				).toHaveLength(2);
				expect(winner.jobId).toBe(admitted.data);
				expect(winner.leaseId).not.toBe(fixture.token);
				expect(
					await tickFilmRun(admin, { ...input, leaseId: winner.leaseId }),
				).toEqual(winner);
				expect(
					(await control(fixture.projectId, "pause", fixture.runId)).error,
				).toBeNull();
				expect(
					await tickFilmRun(admin, { ...input, leaseId: winner.leaseId }),
				).toMatchObject({ kind: "stopped" });
				expect(
					(await control(fixture.projectId, "resume", fixture.runId)).error,
				).toBeNull();
				const resumed = await tickFilmRun(admin, input);
				if (resumed.kind !== "waiting")
					throw new Error("Expected resumed coordinator");
				expect(resumed.jobId).toBe(admitted.data);
				expect(resumed.leaseId).not.toBe(winner.leaseId);
				expect(
					await tickFilmRun(admin, { ...input, leaseId: winner.leaseId }),
				).toMatchObject({ kind: "stopped" });
				const jobs = await admin
					.from("jobs")
					.select("id")
					.eq("project_id", fixture.projectId);
				expect(jobs.error).toBeNull();
				expect(jobs.data).toEqual([{ id: admitted.data }]);
			} finally {
				vi.unstubAllEnvs();
			}
		});
		it("persists coordinator attention, revokes ownership and clears its reason only on resume", async () => {
			const fixture = await admissionFixture();
			const admitted = await admit(fixture);
			expect(admitted.error).toBeNull();
			const failed = await admin
				.from("jobs")
				.update({
					status: "failed",
					cost_usd: 0,
					error: "Synthetic provider failure",
				})
				.eq("id", admitted.data);
			expect(failed.error).toBeNull();
			try {
				vi.stubEnv("FYLMER_STAGING_GENERATION_ENABLED", "1");
				expect(
					await tickFilmRun(admin, {
						runId: fixture.runId,
						leaseId: fixture.token,
						appOrigin: "http://127.0.0.1:3055",
					}),
				).toMatchObject({ kind: "attention" });
				const saved = await control(fixture.projectId, "read", fixture.runId);
				expect(saved.data).toMatchObject({
					status: "paused",
					coordinator_stop: "job_attention",
				});
				expect(
					(await lease(fixture.runId, "renew", fixture.token)).data,
				).toBeNull();
				const resumed = await control(
					fixture.projectId,
					"resume",
					fixture.runId,
				);
				expect(resumed.error).toBeNull();
				expect(resumed.data).toMatchObject({
					status: "queued",
					coordinator_stop: null,
				});
			} finally {
				vi.unstubAllEnvs();
			}
		});
		it("only a valid service-held lease can durably stop for review", async () => {
			const fixture = await admissionFixture();
			const input = {
				p_run_id: fixture.runId,
				p_lease_id: fixture.token,
				p_reason: "images_review",
			};
			expect(
				(await owner.rpc("stop_film_run_coordinator", input)).error,
			).not.toBeNull();
			expect(
				(
					await admin.rpc("stop_film_run_coordinator", {
						...input,
						p_lease_id: randomUUID(),
					})
				).error,
			).not.toBeNull();
			expect(
				(await control(fixture.projectId, "read", fixture.runId)).data.status,
			).toBe("queued");
			const stopped = await admin.rpc("stop_film_run_coordinator", input);
			expect(stopped.error).toBeNull();
			expect(stopped.data).toMatchObject({
				status: "paused",
				coordinator_stop: "images_review",
			});
			expect((await lease(fixture.runId, "claim")).data).toBeNull();
		});
		it("discovers only unowned queued runs and never exposes leases to users", async () => {
			const available = await admissionFixture();
			const held = await admissionFixture();
			const paused = await admissionFixture();
			const cancelled = await admissionFixture();
			expect(
				(await lease(available.runId, "release", available.token)).error,
			).toBeNull();
			expect(
				(await control(paused.projectId, "pause", paused.runId)).error,
			).toBeNull();
			expect(
				(await control(cancelled.projectId, "cancel", cancelled.runId)).error,
			).toBeNull();
			const listed = await admin.rpc("list_film_run_candidates", {
				p_limit: 100,
			});
			expect(listed.error).toBeNull();
			const ids = listed.data.map((row: { run_id: string }) => row.run_id);
			expect(ids).toContain(available.runId);
			expect(ids).not.toContain(held.runId);
			expect(ids).not.toContain(paused.runId);
			expect(ids).not.toContain(cancelled.runId);
			expect(
				(await owner.rpc("list_film_run_candidates", { p_limit: 100 })).error,
			).not.toBeNull();
			expect(
				(await admin.rpc("list_film_run_candidates", { p_limit: 101 })).error,
			).not.toBeNull();
			const expired = await admin
				.from("film_run_leases")
				.update({ expires_at: new Date(Date.now() - 1000).toISOString() })
				.eq("run_id", held.runId);
			expect(expired.error).toBeNull();
			const recovered = await admin.rpc("list_film_run_candidates", {
				p_limit: 100,
			});
			expect(recovered.error).toBeNull();
			expect(
				recovered.data.map((row: { run_id: string }) => row.run_id),
			).toContain(held.runId);
		});
		it("carries a discovered synthetic job through HTTP polling, canonical commit and durable final review", async () => {
			const fixture = await admissionFixture();
			const admitted = await admit(fixture);
			expect(admitted.error).toBeNull();
			expect(
				(await lease(fixture.runId, "release", fixture.token)).error,
			).toBeNull();
			const secret = "synthetic-http-coordinator-secret-123456789";
			const outcomes: string[] = [];
			const failures: unknown[] = [];
			const server = createServer(async (request, response) => {
				try {
					expect(request.headers.authorization).toBe(`Bearer ${secret}`);
					expect(request.url).toBe("/api/internal/film-worker");
					response.setHeader("content-type", "application/json");
					if (request.method === "GET") {
						const listed = await admin.rpc("list_film_run_candidates", {
							p_limit: 100,
						});
						expect(listed.error).toBeNull();
						const runIds = listed.data
							.map((row: { run_id: string }) => row.run_id)
							.filter((id: string) => id === fixture.runId);
						expect(runIds).toEqual([fixture.runId]);
						response.end(JSON.stringify({ kind: "candidates", runIds }));
						return;
					}
					expect(request.method).toBe("POST");
					const chunks: Buffer[] = [];
					for await (const chunk of request) chunks.push(Buffer.from(chunk));
					const input = z
						.object({
							runId: z.literal(fixture.runId),
							leaseId: z.uuid().optional(),
						})
						.strict()
						.parse(JSON.parse(Buffer.concat(chunks).toString()));
					const result = await continueFilmRun(
						admin,
						{ ...input, appOrigin: "http://127.0.0.1:3055" },
						{ maxTicks: 1 },
					);
					outcomes.push(
						result.kind === "yielded" ? result.lastResult.kind : result.kind,
					);
					if (outcomes.length === 1) {
						expect(outcomes[0]).toBe("waiting");
						const completed = await admin
							.from("jobs")
							.update({
								status: "completed",
								cost_usd: 0,
								result: {
									id: admitted.data,
									type: "image",
									provider: "openslop",
									result: { image: "shot.png" },
									metadata: { durationSec: 0 },
								},
							})
							.eq("id", admitted.data)
							.eq("project_id", fixture.projectId);
						expect(completed.error).toBeNull();
					}
					response.end(JSON.stringify(result));
				} catch (error) {
					failures.push(error);
					response.statusCode = 500;
					response.end(
						JSON.stringify({ error: "Synthetic test adapter failed" }),
					);
				}
			});
			try {
				vi.stubEnv("FYLMER_STAGING_GENERATION_ENABLED", "1");
				server.listen(0, "127.0.0.1");
				await once(server, "listening");
				const address = server.address();
				if (!address || typeof address === "string")
					throw new Error("Missing fixture port");
				const result = await discoverFilmRuns({
					origin: `http://127.0.0.1:${address.port}`,
					secret,
					maxRuns: 1,
					maxTicks: 3,
					signal: AbortSignal.timeout(25000),
				});
				expect(failures).toEqual([]);
				expect(outcomes).toEqual(["waiting", "committed", "review"]);
				expect(result).toEqual({
					kind: "batch",
					runs: [
						{
							runId: fixture.runId,
							result: { kind: "review", stage: "final" },
						},
					],
				});
				const saved = await control(fixture.projectId, "read", fixture.runId);
				expect(saved.data).toMatchObject({
					status: "paused",
					coordinator_stop: "final_review",
				});
				const selected = await admin
					.from("projects")
					.select("generation")
					.eq("id", fixture.projectId)
					.single();
				expect(selected.error).toBeNull();
				expect(
					selected.data?.generation[fixture.nodeId].result.imageUrl,
				).toContain(admitted.data);
				const jobs = await admin
					.from("jobs")
					.select("id")
					.eq("project_id", fixture.projectId);
				expect(jobs.data).toEqual([{ id: admitted.data }]);
			} finally {
				vi.unstubAllEnvs();
				server.closeAllConnections();
				await new Promise<void>((resolve, reject) =>
					server.close((error) => (error ? reject(error) : resolve())),
				);
			}
		}, 30000);
		it("records an owned coordinator failure even after the script becomes stale", async () => {
			const fixture = await admissionFixture();
			const edited = await owner
				.from("projects")
				.update({ script: "Changed during coordinator processing." })
				.eq("id", fixture.projectId);
			expect(edited.error).toBeNull();
			try {
				vi.stubEnv("FYLMER_STAGING_GENERATION_ENABLED", "1");
				await expect(
					tickFilmRun(admin, {
						runId: fixture.runId,
						leaseId: fixture.token,
						appOrigin: "http://127.0.0.1:3055",
					}),
				).rejects.toThrow("canonical project or selected takes changed");
				const saved = await control(fixture.projectId, "read", fixture.runId);
				expect(saved.data).toMatchObject({
					status: "paused",
					coordinator_stop: "job_attention",
				});
				const listed = await admin.rpc("list_film_run_candidates", {
					p_limit: 100,
				});
				expect(
					listed.data.map((row: { run_id: string }) => row.run_id),
				).not.toContain(fixture.runId);
				expect(
					(await control(fixture.projectId, "resume", fixture.runId)).error,
				).not.toBeNull();
				const jobs = await admin
					.from("jobs")
					.select("id")
					.eq("project_id", fixture.projectId);
				expect(jobs.data).toEqual([]);
			} finally {
				vi.unstubAllEnvs();
			}
		});
		it("pauses on invalid completed media without selecting or resubmitting it", async () => {
			const fixture = await admissionFixture();
			const admitted = await admit(fixture);
			expect(admitted.error).toBeNull();
			const completed = await admin
				.from("jobs")
				.update({
					status: "completed",
					cost_usd: 0,
					result: {
						id: admitted.data,
						type: "image",
						provider: "openslop",
						result: {},
						metadata: { durationSec: 0 },
					},
				})
				.eq("id", admitted.data);
			expect(completed.error).toBeNull();
			try {
				vi.stubEnv("FYLMER_STAGING_GENERATION_ENABLED", "1");
				await expect(
					tickFilmRun(admin, {
						runId: fixture.runId,
						leaseId: fixture.token,
						appOrigin: "http://127.0.0.1:3055",
					}),
				).rejects.toThrow();
				expect(
					(await control(fixture.projectId, "read", fixture.runId)).data,
				).toMatchObject({
					status: "paused",
					coordinator_stop: "job_attention",
				});
				const project = await admin
					.from("projects")
					.select("generation")
					.eq("id", fixture.projectId)
					.single();
				expect(project.data?.generation[fixture.nodeId]).toBeUndefined();
				const jobs = await admin
					.from("jobs")
					.select("id")
					.eq("project_id", fixture.projectId);
				expect(jobs.data).toEqual([{ id: admitted.data }]);
			} finally {
				vi.unstubAllEnvs();
			}
		});
		it("refuses stale editor snapshots that would erase background-selected media", async () => {
			const projectId = await project();
			const nodeId = randomUUID();
			const generation = {
				[nodeId]: {
					status: "generating",
					startedAt: 123,
					result: {
						imageUrl: "https://media.example.invalid/new.png",
						durationSec: 0,
					},
					resultInputs: null,
					connectorType: "image",
					pinned: false,
					error: null,
				},
			};
			const updated = await admin
				.from("projects")
				.update({ generation })
				.eq("id", projectId);
			expect(updated.error).toBeNull();
			const input = {
				p_project_id: projectId,
				p_expected_generation: {},
				p_script: "An unsaved local edit",
				p_store: {},
				p_generation: {},
				p_name: "Local title",
				p_thumbnail_url: null,
			};
			const stale = await owner.rpc("save_project_snapshot", input);
			expect(stale.error?.message).toContain("Background media changed");
			const unchanged = await admin
				.from("projects")
				.select("script,generation")
				.eq("id", projectId)
				.single();
			expect(unchanged.data?.generation).toEqual(generation);
			expect(unchanged.data?.script).not.toBe(input.p_script);
			const normalized = {
				[nodeId]: { ...generation[nodeId], status: "idle", startedAt: null },
			};
			const preserved = await owner.rpc("save_project_snapshot", {
				...input,
				p_generation: normalized,
			});
			expect(preserved.error).toBeNull();
			const removed = await owner.rpc("save_project_snapshot", {
				...input,
				p_expected_generation: normalized,
			});
			expect(removed.error).toBeNull();
			const saved = await admin
				.from("projects")
				.select("script,generation")
				.eq("id", projectId)
				.single();
			expect(saved.data).toEqual({ script: input.p_script, generation: {} });
			expect(
				(await other.rpc("save_project_snapshot", input)).error?.message,
			).toContain("Project not found");
		});
		const completedFixture = async (script?: string) => {
			const fixture = await admissionFixture(script);
			const admitted = await admit(fixture);
			expect(admitted.error).toBeNull();
			const bundle = {
				id: admitted.data,
				type: "image",
				provider: "openslop",
				result: { image: "shot.png" },
				metadata: { durationSec: 0 },
			};
			const completed = await admin
				.from("jobs")
				.update({ status: "completed", result: bundle, cost_usd: 0 })
				.eq("id", admitted.data);
			expect(completed.error).toBeNull();
			return { ...fixture, jobId: admitted.data, bundle };
		};
		it("atomically selects one completed take and history row despite concurrent retries, then allows the next shot", async () => {
			const fixture = await completedFixture(
				'--- Scene 1 ---\n<image id="first">First shot.</image>\n<image id="second">Second shot.</image>',
			);
			const original = await control(fixture.projectId, "read", fixture.runId);
			const commits = await Promise.all(
				Array.from({ length: 5 }, () =>
					commitFilmRunResult(
						admin,
						fixture.runId,
						fixture.token,
						fixture.nodeId,
					),
				),
			);
			for (const result of commits) expect(result).toEqual(commits[0]);
			expect(commits[0].first).toMatchObject({
				status: "idle",
				pinned: false,
				connectorType: "image",
				result: {
					durationSec: 0,
					imageUrl: `https://media.example.invalid/assets/image/openslop/${fixture.jobId}/shot.png`,
				},
			});
			const history = await admin
				.from("element_history")
				.select("id,result")
				.eq("project_id", fixture.projectId);
			expect(history.error).toBeNull();
			expect(history.data).toEqual([
				{ id: fixture.jobId, result: commits[0].first.result },
			]);
			const after = await control(fixture.projectId, "read", fixture.runId);
			expect(after.data.plan).toEqual(original.data.plan);
			expect(after.data.planned_generation).toEqual({});
			expect(after.data.expected_generation).toEqual(commits[0]);
			expect(await prepareFilmRunPlan(admin, fixture.runId)).toEqual(
				original.data.plan,
			);
			expect(
				(await lease(fixture.runId, "renew", fixture.token)).error,
			).toBeNull();
			const next = await admit({
				...fixture,
				nodeId: "second",
				request: { ...fixture.request, prompt: "Second shot." },
			});
			expect(next.error).toBeNull();
			expect(
				(
					await admin
						.from("jobs")
						.update({ status: "processing" })
						.eq("id", next.data)
				).error,
			).toBeNull();
			expect(
				(
					await admin
						.from("jobs")
						.update({ provider_started_at: new Date().toISOString() })
						.eq("id", next.data)
				).error,
			).toBeNull();
		});
		it("does not overwrite a pinned take edited while generation was completing", async () => {
			const fixture = await completedFixture();
			const edited = {
				[fixture.nodeId]: {
					status: "idle",
					startedAt: null,
					error: null,
					resultInputs: null,
					connectorType: "image",
					pinned: true,
					result: {
						imageUrl: "https://example.invalid/user.png",
						durationSec: 0,
					},
				},
			};
			expect(
				(
					await owner
						.from("projects")
						.update({ generation: edited })
						.eq("id", fixture.projectId)
				).error,
			).toBeNull();
			await expect(
				commitFilmRunResult(
					admin,
					fixture.runId,
					fixture.token,
					fixture.nodeId,
				),
			).rejects.toThrow("selected takes changed");
			const saved = await admin
				.from("projects")
				.select("generation")
				.eq("id", fixture.projectId)
				.single();
			expect(saved.error).toBeNull();
			expect(saved.data?.generation).toEqual(edited);
			const history = await admin
				.from("element_history")
				.select("id")
				.eq("project_id", fixture.projectId);
			expect(history.error).toBeNull();
			expect(history.data).toEqual([]);
		});
		it("rejects stale workers, paused commits and unauthorized or changed job bundles", async () => {
			const fixture = await completedFixture();
			const params = {
				p_run_id: fixture.runId,
				p_lease_id: fixture.token,
				p_node_id: fixture.nodeId,
				p_bundle: { ...fixture.bundle, id: "forged" },
				p_result: {
					imageUrl: "https://example.invalid/fake.png",
					durationSec: 0,
				},
			};
			expect(
				(await owner.rpc("commit_film_run_job", params)).error,
			).not.toBeNull();
			expect(
				(await admin.rpc("commit_film_run_job", params)).error?.message,
			).toContain("matching completed provider job");
			await expect(
				commitFilmRunResult(admin, fixture.runId, randomUUID(), fixture.nodeId),
			).rejects.toThrow("lease is no longer valid");
			expect(
				(await control(fixture.projectId, "pause", fixture.runId)).error,
			).toBeNull();
			await expect(
				commitFilmRunResult(
					admin,
					fixture.runId,
					fixture.token,
					fixture.nodeId,
				),
			).rejects.toThrow("lease is no longer valid");
		});
		it("unlocks a generated character dependency with the committed result identity", async () => {
			const fixture = await completedFixture(
				'<asset_avatar id="mira" name="Mira">Radio engineer.</asset_avatar>\n--- Scene 1 ---\n<image id="shot">{{Mira}} at the radio.</image>',
			);
			const result = await commitFilmRunResult(
				admin,
				fixture.runId,
				fixture.token,
				fixture.nodeId,
			);
			const next = await admit({
				...fixture,
				nodeId: "shot",
				request: { ...fixture.request, prompt: "Mira at the radio." },
			});
			expect(next.error).toBeNull();
			const bundle = { ...fixture.bundle, id: next.data };
			expect(
				(
					await admin
						.from("jobs")
						.update({ status: "completed", result: bundle, cost_usd: 0 })
						.eq("id", next.data)
				).error,
			).toBeNull();
			const selected = await commitFilmRunResult(
				admin,
				fixture.runId,
				fixture.token,
				"shot",
			);
			expect(selected.shot.resultInputs?.dependencies).toEqual({
				"Mira's avatar": result.mira.result?.imageUrl,
			});
			expect(selected.mira).toEqual(result.mira);
		});
		it.each([false, true])(
			"preserves a superseded take and its existing history: %s",
			async (alreadySaved) => {
				const projectId = await project();
				const oldResult = {
					imageUrl: "https://example.invalid/old.png",
					durationSec: 0,
				};
				const oldInputs = {
					prompt: "Old shot",
					attributes: {},
					reads: {},
					dependencies: {},
				};
				const previous = {
					status: "idle",
					startedAt: null,
					result: oldResult,
					resultInputs: oldInputs,
					connectorType: "image",
					error: null,
					pinned: false,
				};
				expect(
					(
						await owner
							.from("projects")
							.update({
								script: '--- Scene 1 ---\n<image id="shot">New shot.</image>',
								generation: { shot: previous },
							})
							.eq("id", projectId)
					).error,
				).toBeNull();
				const oldId = randomUUID();
				if (alreadySaved)
					expect(
						(
							await owner.from("element_history").insert({
								id: oldId,
								project_id: projectId,
								element_id: "shot",
								connector_type: "image",
								element_type: "image",
								inputs: oldInputs,
								result: oldResult,
								pinned: false,
							})
						).error,
					).toBeNull();
				await review(projectId, "bible");
				const runId = randomUUID();
				expect((await control(projectId, "start", runId)).error).toBeNull();
				const plan = await prepareFilmRunPlan(admin, runId);
				const node = plan.nodes[0];
				const held = await lease(runId, "claim");
				expect(held.error).toBeNull();
				const admitted = await admit({
					projectId,
					runId,
					nodeId: "shot",
					token: held.data.lease_id,
					request: { ...node.model, prompt: node.inputs.prompt },
					quote: {
						...node.model,
						ceilingUsd: 1,
						currency: "USD",
						source: "synthetic-price-fixture",
						expiresAt: new Date(Date.now() + 300000).toISOString(),
					},
				});
				expect(admitted.error).toBeNull();
				const bundle = {
					id: admitted.data,
					type: "image",
					provider: "openslop",
					result: { image: "shot.png" },
					metadata: { durationSec: 0 },
				};
				expect(
					(
						await admin
							.from("jobs")
							.update({ status: "completed", result: bundle, cost_usd: 0 })
							.eq("id", admitted.data)
					).error,
				).toBeNull();
				const selected = await commitFilmRunResult(
					admin,
					runId,
					held.data.lease_id,
					"shot",
				);
				const history = await owner
					.from("element_history")
					.select("id,result,inputs")
					.eq("project_id", projectId);
				expect(history.error).toBeNull();
				expect(history.data).toHaveLength(2);
				expect(history.data).toEqual(
					expect.arrayContaining([
						expect.objectContaining({
							result: oldResult,
							inputs: oldInputs,
							...(alreadySaved ? { id: oldId } : {}),
						}),
						expect.objectContaining({
							id: admitted.data,
							result: selected.shot.result,
							inputs: selected.shot.resultInputs,
						}),
					]),
				);
			},
		);
		it("stores generated media and metadata privately with stable retry-safe references", async () => {
			const fixture = await completedFixture();
			const prefix = `${ownerId}/${fixture.jobId}`;
			const bucket = admin.storage.from(GENERATED_MEDIA_BUCKET);
			try {
				const bytes = Buffer.from(
					"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=",
					"base64",
				);
				const files = [
					{
						key: "image",
						filename: "shot.png",
						contentType: "image/png",
						data: bytes,
					},
					{
						key: "timestamps",
						filename: "timestamps.json",
						contentType: "application/json",
						data: Buffer.from("[]"),
					},
				];
				class GeneratedImageFixture extends BaseProvider<
					{ prompt: string },
					{ costUsd: number; metadata: { durationSec: number } }
				> {
					protected readonly blobConfig = { type: "image", provider: "tresca" };
					async validate() {
						return { ok: true as const };
					}
					protected async _generate() {
						return { costUsd: 0, metadata: { durationSec: 0 } };
					}
					protected toFiles() {
						return files;
					}
				}
				let stored: Awaited<ReturnType<typeof storeRunBundle>> | undefined;
				const generated = await new GeneratedImageFixture().generate(
					{ prompt: "Synthetic storage fixture" },
					{
						jobId: fixture.jobId,
						storeBundle: async (type, provider, outputFiles, metadata) => {
							expect(type).toBe("image");
							const response = await privateProviderWriter(
								admin,
								fixture.jobId,
								[],
							)(type, provider, outputFiles, metadata);
							if (!response.storage)
								throw new Error("Missing private provider storage reference");
							stored = { ...response.storage, response };
							return stored.response;
						},
					},
				);
				if (!stored)
					throw new Error("Provider did not persist its fixture output");
				expect(generated).toEqual({ output: stored.response, costUsd: 0 });
				expect(
					await storeRunBundle(admin, fixture.jobId, "tresca", files, {
						durationSec: 0,
					}),
				).toEqual(stored);
				expect(stored.prefix).toBe(prefix);
				const savedBundle = await admin
					.from("jobs")
					.update({ result: stored.response })
					.eq("id", fixture.jobId);
				if (savedBundle.error) throw savedBundle.error;
				await expect(
					commitFilmRunResult(
						admin,
						fixture.runId,
						fixture.token,
						fixture.nodeId,
					),
				).rejects.toThrow("authenticated resolution");
				const selectedPrivate = await commitFilmRunResult(
					admin,
					fixture.runId,
					fixture.token,
					fixture.nodeId,
					"http://127.0.0.1:3055",
				);
				expect(selectedPrivate[fixture.nodeId].result).toEqual({
					durationSec: 0,
					imageUrl: `http://127.0.0.1:3055/api/generated-media/${fixture.jobId}/image`,
				});
				expect(JSON.stringify(selectedPrivate)).not.toContain("token=");
				const mediaInput = {
					userId: ownerId,
					projectId: fixture.projectId,
					appOrigin: "http://127.0.0.1:3055",
					url: `http://127.0.0.1:3055/api/generated-media/${fixture.jobId}/image`,
				};
				const hydrated = await resolveOwnedGeneratedMedia(
					admin,
					mediaInput,
					900,
				);
				expect(hydrated.stableUrl).toBe(mediaInput.url);
				const inlineImage = await inlineOwnedImage(owner, mediaInput);
				expect(inlineImage).toBe(
					`data:image/png;base64,${bytes.toString("base64")}`,
				);
				await expect(
					inlineOwnedImage(admin, { ...mediaInput, projectId: randomUUID() }),
				).rejects.toThrow("this project");
				expect(hydrated.reference).toEqual(stored.response.storage);
				const hydratedBytes = await fetch(hydrated.url);
				expect(Buffer.from(await hydratedBytes.arrayBuffer())).toEqual(bytes);
				await expect(
					resolveOwnedGeneratedMedia(admin, {
						...mediaInput,
						projectId: randomUUID(),
					}),
				).rejects.toThrow("this project");
				await expect(
					resolveOwnedGeneratedMedia(admin, {
						...mediaInput,
						userId: randomUUID(),
					}),
				).rejects.toThrow("this project");
				await expect(
					resolveOwnedGeneratedMedia(other, mediaInput),
				).rejects.toThrow("this project");
				for (const unsafeUrl of [
					mediaInput.url.replace("127.0.0.1", "example.com"),
					`${mediaInput.url}?token=untrusted`,
					`${mediaInput.url}#fragment`,
					mediaInput.url.replace("/image", "/timestamps"),
				])
					await expect(
						resolveOwnedGeneratedMedia(admin, {
							...mediaInput,
							url: unsafeUrl,
						}),
					).rejects.toThrow();
				const privateBundle = await privateRunBundle(
					owner,
					fixture.jobId,
					stored.response,
					"http://127.0.0.1:3055",
				);
				expect(
					await privateBundle.fetchJson("timestamps", z.array(z.unknown())),
				).toEqual([]);
				await expect(
					privateRunBundle(
						other,
						fixture.jobId,
						stored.response,
						"http://127.0.0.1:3055",
					),
				).rejects.toThrow("not accessible");
				await expect(
					privateRunBundle(
						owner,
						fixture.jobId,
						{ ...stored.response, metadata: { durationSec: 9 } },
						"http://127.0.0.1:3055",
					),
				).rejects.toThrow("differs");
				await expect(
					privateRunBundle(
						owner,
						fixture.jobId,
						stored.response,
						"https://user:password@example.com",
					),
				).rejects.toThrow("trusted application origin");
				const playbackRequest = new Request(
					"http://localhost/api/generated-media",
				);
				const playback = await generatedMediaResponse(
					owner,
					ownerId,
					fixture.jobId,
					"image",
					playbackRequest,
				);
				expect(playback.status).toBe(200);
				expect(playback.headers.get("cache-control")).toBe("private, no-store");
				expect(playback.headers.has("location")).toBe(false);
				expect(Buffer.from(await playback.arrayBuffer())).toEqual(bytes);
				const partial = await generatedMediaResponse(
					owner,
					ownerId,
					fixture.jobId,
					"image",
					new Request(playbackRequest.url, { headers: { Range: "bytes=0-7" } }),
				);
				expect(partial.status).toBe(206);
				expect(Buffer.from(await partial.arrayBuffer())).toEqual(
					bytes.subarray(0, 8),
				);
				const head = await generatedMediaResponse(
					owner,
					ownerId,
					fixture.jobId,
					"image",
					new Request(playbackRequest.url, { method: "HEAD" }),
				);
				expect(head.status).toBe(200);
				expect(await head.text()).toBe("");
				expect(
					(
						await generatedMediaResponse(
							other,
							ownerId,
							fixture.jobId,
							"image",
							playbackRequest,
						)
					).status,
				).toBe(404);
				expect(
					(
						await generatedMediaResponse(
							admin,
							randomUUID(),
							fixture.jobId,
							"image",
							playbackRequest,
						)
					).status,
				).toBe(404);
				expect(
					(
						await generatedMediaResponse(
							owner,
							ownerId,
							fixture.jobId,
							"missing",
							playbackRequest,
						)
					).status,
				).toBe(404);
				const originalReference = JSON.stringify(stored);
				const resolved = await readRunBundle(owner, fixture.jobId, stored);
				expect(resolved.response).toEqual(stored.response);
				await expect(
					readRunBundle(other, fixture.jobId, stored),
				).rejects.toThrow("not accessible");
				await expect(
					readRunBundle(admin, fixture.jobId, {
						...stored,
						prefix: `${randomUUID()}/${fixture.jobId}`,
					}),
				).rejects.toThrow("does not belong");
				await expect(
					readRunBundle(admin, fixture.jobId, {
						...stored,
						manifestPath: `${prefix}/../manifest.json`,
					}),
				).rejects.toThrow("Invalid generated");
				await expect(
					signRunBundleFiles(owner, fixture.jobId, stored, ["not-present"]),
				).rejects.toThrow("not in its manifest");
				const shortAccess = await signRunBundleFiles(
					owner,
					fixture.jobId,
					stored,
					["image"],
					60,
				);
				const renewedAccess = await signRunBundleFiles(
					owner,
					fixture.jobId,
					stored,
					["image"],
					120,
				);
				expect(shortAccess.reference).toEqual(renewedAccess.reference);
				expect(shortAccess.urls.image).not.toBe(renewedAccess.urls.image);
				expect(JSON.stringify(stored)).toBe(originalReference);
				for (const access of [shortAccess, renewedAccess]) {
					expect(new URL(access.urls.image).host).toBe("127.0.0.1:55421");
					const media = await fetch(access.urls.image, {
						signal: AbortSignal.timeout(5000),
					});
					expect(media.ok).toBe(true);
					expect(Buffer.from(await media.arrayBuffer())).toEqual(bytes);
				}
				expect(JSON.stringify(stored)).not.toContain("token=");
				const own = owner.storage.from(GENERATED_MEDIA_BUCKET);
				const imagePath = `${stored.prefix}/${stored.response.result.image}`;
				const downloaded = await own.download(imagePath);
				expect(downloaded.error).toBeNull();
				if (!downloaded.data) throw new Error("Missing stored fixture image");
				expect(Buffer.from(await downloaded.data.arrayBuffer())).toEqual(bytes);
				const manifest = await own.download(stored.manifestPath);
				expect(manifest.error).toBeNull();
				if (!manifest.data) throw new Error("Missing stored fixture manifest");
				const { storage, ...manifestContents } = stored.response;
				expect(JSON.parse(await manifest.data.text())).toEqual(
					manifestContents,
				);
				expect(storage).toEqual(resolved.reference);
				const storedResponse = stored.response;
				expect(() => AssetBundle.fromResponse(storedResponse)).toThrow(
					"authenticated resolution",
				);
				expect(
					(await readRunBundle(owner, fixture.jobId, storage)).response,
				).toEqual(stored.response);
				expect(
					(await other.storage.from(GENERATED_MEDIA_BUCKET).download(imagePath))
						.error,
				).not.toBeNull();
				expect(
					(
						await own.upload(imagePath, bytes, {
							contentType: "image/png",
							upsert: true,
						})
					).error,
				).not.toBeNull();
				const signed = await own.createSignedUrl(imagePath, 60);
				expect(signed.error).toBeNull();
				if (!signed.data) throw new Error("Missing fixture signed URL");
				expect(new URL(signed.data.signedUrl).host).toBe("127.0.0.1:55421");
				const read = await fetch(signed.data.signedUrl, {
					signal: AbortSignal.timeout(5000),
				});
				expect(read.ok).toBe(true);
				expect(Buffer.from(await read.arrayBuffer())).toEqual(bytes);
				const list = await bucket.list(prefix);
				expect(list.error).toBeNull();
				expect(list.data).toHaveLength(3);
				const altered = await bucket.update(
					stored.manifestPath,
					Buffer.from("{}"),
					{ contentType: "application/json" },
				);
				expect(altered.error).toBeNull();
				await expect(
					readRunBundle(owner, fixture.jobId, stored),
				).rejects.toThrow("integrity check");
			} finally {
				const list = await bucket.list(prefix);
				if (list.error) throw list.error;
				const paths = list.data.map((file) => `${prefix}/${file.name}`);
				if (paths.length) {
					const removed = await bucket.remove(paths);
					if (removed.error) throw removed.error;
				}
			}
		}, 30000);
		it("denies other accounts and direct status writes", async () => {
			const id = await project();
			const runId = randomUUID();
			await control(id, "start", runId);
			for (const action of ["read", "pause", "resume", "cancel", "start"]) {
				expect(
					(await control(id, action, runId, other)).error?.message,
				).toContain("Project not found");
			}
			const hidden = await other.from("film_runs").select("id").eq("id", runId);
			expect(hidden.error).toBeNull();
			expect(hidden.data).toEqual([]);
			const forged = await owner
				.from("film_runs")
				.update({ status: "completed" })
				.eq("id", runId);
			expect(forged.error).not.toBeNull();
			expect((await control(id, "read", runId)).data.status).toBe("queued");
		});
	},
);
