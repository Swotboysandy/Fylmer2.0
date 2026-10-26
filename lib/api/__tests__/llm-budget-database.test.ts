import {
	beforeAll,
	afterAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { randomUUID } from "node:crypto";
import {
	createClient,
	type SupabaseClient,
	type User,
} from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { z } from "zod";
import type { ModelRef } from "@/lib/connectors/types";
import type { RouteFamily } from "../route-families";

const state = vi.hoisted(() => ({
	admin: undefined as SupabaseClient | undefined,
	client: undefined as SupabaseClient | undefined,
	user: undefined as User | undefined,
	generate: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
	createClient: async () => {
		if (!state.client) throw new Error("No fixture client");
		return state.client;
	},
}));
vi.mock("@/lib/supabase/service", () => ({
	createServiceClient: () => {
		if (!state.admin) throw new Error("No fixture service");
		return state.admin;
	},
}));
vi.mock("../with-auth", () => {
	const auth = async (
		_label: string,
		handle: (user: User) => Promise<Response>,
	) => {
		if (!state.user) throw new Error("No fixture session");
		return handle(state.user);
	};
	return {
		withApiAccess: auth,
		withHostedBudget: auth,
		withSession: auth,
		withPublic: async (_label: string, handle: () => Promise<Response>) =>
			handle(),
	};
});
vi.mock("../agent-cost-quote", () => ({
	quoteAgentCost: (picked: ModelRef) => ({
		...picked,
		ceilingUsd: 0.6,
		currency: "USD",
		source: "synthetic-database-route-test-only",
		expiresAt: new Date(Date.now() + 300000).toISOString(),
	}),
}));

import { createLLMRouteHandler } from "../llm-routes";
import { createSessionRouteHandler } from "../route-handler";
import { createJob, claimJob, markProviderStarted, updateJob } from "../jobs";

describe.skipIf(process.env.FYLMER_DB_ROUTE_TEST !== "1")(
	"isolated staging LLM budget routes",
	() => {
		beforeAll(async () => {
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
			state.admin = createClient(
				config.NEXT_PUBLIC_SUPABASE_URL,
				config.SUPABASE_SECRET_KEY,
				{ auth: { persistSession: false } },
			);
			state.client = createClient(
				config.NEXT_PUBLIC_SUPABASE_URL,
				config.NEXT_PUBLIC_SUPABASE_ANON_KEY,
				{ auth: { persistSession: false } },
			);
			const email = `llm-route-db-${randomUUID()}@example.invalid`;
			const account = await state.admin.auth.admin.createUser({
				email,
				email_confirm: true,
			});
			if (account.error || !account.data.user)
				throw account.error ?? new Error("Missing fixture account");
			state.user = account.data.user;
			const link = await state.admin.auth.admin.generateLink({
				type: "magiclink",
				email,
			});
			if (link.error) throw link.error;
			const auth = await state.client.auth.verifyOtp({
				type: "magiclink",
				token_hash: link.data.properties.hashed_token,
			});
			if (auth.error) throw auth.error;
		}, 30000);
		afterAll(async () => {
			if (state.admin && state.user) {
				const deleted = await state.admin.auth.admin.deleteUser(state.user.id);
				if (deleted.error) throw deleted.error;
				const remaining = await state.admin
					.from("projects")
					.select("id")
					.eq("user_id", state.user.id);
				if (remaining.error) throw remaining.error;
				expect(remaining.data).toEqual([]);
				const remainingJobs = await state.admin
					.from("jobs")
					.select("id")
					.eq("user_id", state.user.id);
				if (remainingJobs.error) throw remainingJobs.error;
				expect(remainingJobs.data).toEqual([]);
			}
		}, 30000);
		beforeEach(() => {
			state.generate.mockReset();
			state.generate.mockResolvedValue({
				output: { text: "synthetic film plan" },
				costUsd: 0.2,
			});
		});

		async function project() {
			if (!state.admin || !state.client || !state.user)
				throw new Error("Missing fixture clients");
			const id = randomUUID();
			const created = await state.admin.from("projects").insert({
				id,
				user_id: state.user.id,
				name: "Disposable LLM route budget test",
				script: "Synthetic fixture. No provider calls.",
			});
			if (created.error) throw created.error;
			const cap = await state.client.rpc("set_film_autonomous_cap", {
				p_project_id: id,
				p_cap_usd: 1,
			});
			if (cap.error) throw cap.error;
			return id;
		}
		async function jobs(projectId: string) {
			if (!state.admin) throw new Error("Missing fixture service");
			const rows = await state.admin
				.from("jobs")
				.select("id,status,billing_state,cost_usd,project_id,user_id")
				.eq("project_id", projectId);
			if (rows.error) throw rows.error;
			return rows.data;
		}
		function route(provider: "anthropic" | "openslop") {
			const model =
				provider === "anthropic" ? "Claude Haiku 4.5" : "Claude Opus 5";
			const family = {
				createHandler: createSessionRouteHandler,
				model: () =>
					z.object({ provider: z.literal(provider), model: z.literal(model) }),
				providerFor: async () => ({
					generate: state.generate,
					agentModel: (modelId: string) => ({
						model: "mock",
						modelId,
						maxOutputTokens: 2048,
						providerOptions: {},
						cachedPrefix: {},
						costOf: () => 0.2,
					}),
				}),
				recordSpend: async () => {
					throw new Error("Unexpected legacy booking");
				},
			} as unknown as RouteFamily<ModelRef>;
			const handler = createLLMRouteHandler(family);
			return (projectId: string) =>
				handler(
					new NextRequest("http://localhost/api/llm", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							provider,
							model,
							projectId,
							prompt: "Synthetic prompt only",
						}),
					}),
				);
		}

		it.each(["anthropic", "openslop"] as const)(
			"settles one protected project job for %s",
			async (provider) => {
				const projectId = await project();
				expect((await route(provider)(projectId)).status).toBe(200);
				const rows = await jobs(projectId);
				expect(rows).toHaveLength(1);
				expect(rows[0]).toMatchObject({
					status: "completed",
					billing_state: "settled",
					user_id: state.user?.id,
					project_id: projectId,
				});
				expect(Number(rows[0].cost_usd)).toBe(0.2);
			},
			30000,
		);
		it("rejects concurrent over-cap admission before the second model transmission", async () => {
			const projectId = await project();
			const release = Promise.withResolvers<void>();
			state.generate.mockImplementation(async () => {
				await release.promise;
				return { output: { text: "synthetic" }, costUsd: 0.2 };
			});
			const call = route("anthropic");
			const first = call(projectId);
			try {
				await vi.waitFor(
					() => expect(state.generate).toHaveBeenCalledTimes(1),
					{ timeout: 10000 },
				);
				await expect(call(projectId)).rejects.toThrow(
					"would exceed the project cap",
				);
				expect(state.generate).toHaveBeenCalledTimes(1);
			} finally {
				release.resolve();
				await first;
			}
			expect(await jobs(projectId)).toHaveLength(1);
		}, 30000);
		it("keeps failed submitted charges uncertain and blocks another request", async () => {
			const projectId = await project();
			state.generate.mockRejectedValueOnce(
				new Error("Synthetic provider failure"),
			);
			const call = route("anthropic");
			await expect(call(projectId)).rejects.toThrow(
				"Synthetic provider failure",
			);
			const rows = await jobs(projectId);
			expect(rows).toHaveLength(1);
			expect(rows[0]).toMatchObject({
				status: "failed",
				billing_state: "uncertain",
			});
			await expect(call(projectId)).rejects.toThrow("needs billing review");
			expect(state.generate).toHaveBeenCalledTimes(1);
		}, 30000);
		it("keeps completed voice with unknown actual cost uncertain and blocks further project spend", async () => {
			if (!state.user || !state.admin)
				throw new Error("Missing fixture clients");
			const projectId = await project();
			const model = {
				provider: "cartesia",
				model: "Synthetic voice billing fixture",
			};
			const job = await createJob({
				userId: state.user.id,
				projectId,
				connectorType: "tts",
				request: model,
				status: "pending",
				costQuote: {
					...model,
					ceilingUsd: 0.6,
					currency: "USD",
					source: "synthetic-voice-settlement-test-only",
					expiresAt: new Date(Date.now() + 300000).toISOString(),
				},
			});
			expect(await claimJob(job.id)).toBe(true);
			await markProviderStarted(job.id);
			await updateJob(job.id, { status: "completed", cost_usd: undefined });
			const stored = await state.admin
				.from("jobs")
				.select("status,billing_state,cost_usd,reserved_cost_usd")
				.eq("id", job.id)
				.single();
			if (stored.error) throw stored.error;
			expect(stored.data).toEqual({
				status: "completed",
				billing_state: "uncertain",
				cost_usd: null,
				reserved_cost_usd: 0.6,
			});
			await expect(route("anthropic")(projectId)).rejects.toThrow(
				"needs billing review",
			);
			expect(state.generate).not.toHaveBeenCalled();
			expect(await jobs(projectId)).toHaveLength(1);
		}, 30000);
		it.each([false, true])(
			"requires privileged billing evidence to recover an uncertain charge of %s",
			async (overCap) => {
				if (!state.admin || !state.client)
					throw new Error("Missing fixture clients");
				const projectId = await project();
				const call = route("anthropic");
				state.generate.mockRejectedValueOnce(new Error("Synthetic outage"));
				await expect(call(projectId)).rejects.toThrow("Synthetic outage");
				const [job] = await jobs(projectId);
				const input = {
					p_job_id: job.id,
					p_cost_usd: overCap ? 1.2 : 0.2,
					p_reference: "synthetic-invoice-fixture-only",
				};
				const unauthorized = await state.client.rpc(
					"reconcile_film_job_charge",
					input,
				);
				expect(unauthorized.error).not.toBeNull();
				const invalid = await state.admin.rpc("reconcile_film_job_charge", {
					...input,
					p_reference: "",
				});
				expect(invalid.error).not.toBeNull();
				await expect(call(projectId)).rejects.toThrow("needs billing review");
				expect(state.generate).toHaveBeenCalledTimes(1);
				const reconciled = await state.admin.rpc(
					"reconcile_film_job_charge",
					input,
				);
				if (reconciled.error) throw reconciled.error;
				const totals = await state.admin.rpc("film_budget_totals", {
					p_project_id: projectId,
				});
				if (totals.error) throw totals.error;
				expect(totals.data).toEqual([
					{
						committed_usd: input.p_cost_usd,
						has_uncertain: false,
					},
				]);
				if (overCap) {
					await expect(call(projectId)).rejects.toThrow(
						"would exceed the project cap",
					);
					expect(state.generate).toHaveBeenCalledTimes(1);
				} else {
					expect((await call(projectId)).status).toBe(200);
					expect(state.generate).toHaveBeenCalledTimes(2);
				}
			},
			30000,
		);
		it.each([false, true])(
			"preserves interruption accounting after submission=%s",
			async (submitted) => {
				if (!state.user) throw new Error("Missing fixture user");
				const projectId = await project();
				const model = {
					provider: "anthropic",
					model: "Claude Haiku 4.5",
				} as const;
				const reserved = await createJob({
					userId: state.user.id,
					projectId,
					connectorType: "llm",
					request: model,
					status: "pending",
					costQuote: {
						...model,
						ceilingUsd: 0.6,
						currency: "USD",
						source: "synthetic-interruption-test-only",
						expiresAt: new Date(Date.now() + 300000).toISOString(),
					},
				});
				expect(await claimJob(reserved.id)).toBe(true);
				if (submitted) await markProviderStarted(reserved.id);
				await expect(route("anthropic")(projectId)).rejects.toThrow(
					"would exceed the project cap",
				);
				expect(state.generate).not.toHaveBeenCalled();
				await updateJob(reserved.id, {
					status: "failed",
					error: "Synthetic executor interruption",
				});
				expect(await jobs(projectId)).toEqual([
					expect.objectContaining({
						id: reserved.id,
						status: "failed",
						billing_state: submitted ? "uncertain" : "released",
					}),
				]);
				await expect(claimJob(reserved.id)).resolves.toBe(false);
				if (submitted) {
					await expect(route("anthropic")(projectId)).rejects.toThrow(
						"needs billing review",
					);
					expect(state.generate).not.toHaveBeenCalled();
				} else {
					expect((await route("anthropic")(projectId)).status).toBe(200);
					expect(state.generate).toHaveBeenCalledTimes(1);
				}
			},
			30000,
		);
	},
);
