import {
	afterAll,
	afterEach,
	beforeAll,
	expect,
	it,
	describe,
	vi,
} from "vitest";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const fixture = vi.hoisted(() => ({
	admin: undefined as SupabaseClient | undefined,
	delivery: undefined as { job_id: string; lease_id: string } | undefined,
	poll: vi.fn(),
	submit: vi.fn(),
}));
vi.mock("@/lib/supabase/service", () => ({
	createServiceClient: () => {
		if (!fixture.admin) throw new Error("Missing fixture client");
		return {
			from: fixture.admin.from.bind(fixture.admin),
			rpc: async (name: string) => {
				if (name !== "claim_asset_delivery" || !fixture.delivery)
					throw new Error("Unscoped fixture claim refused");
				return { data: [fixture.delivery], error: null };
			},
		};
	},
}));
vi.mock("../handlers/base", () => ({
	providerForJob: async () => ({ poll: fixture.poll, submit: fixture.submit }),
	jobVendorParams: () => ({ prompt: "Synthetic recovery fixture" }),
}));
import { createJob, claimJob, markProviderStarted, updateJob } from "../jobs";
import { processLocalDelivery } from "../local-job-worker";

describe.skipIf(process.env.FYLMER_DB_ROUTE_TEST !== "1")(
	"isolated video recovery ledger",
	() => {
		let admin: SupabaseClient;
		let client: SupabaseClient;
		let userId: string;
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
			admin = createClient(
				config.NEXT_PUBLIC_SUPABASE_URL,
				config.SUPABASE_SECRET_KEY,
				{ auth: { persistSession: false } },
			);
			fixture.admin = admin;
			client = createClient(
				config.NEXT_PUBLIC_SUPABASE_URL,
				config.NEXT_PUBLIC_SUPABASE_ANON_KEY,
				{ auth: { persistSession: false } },
			);
			const email = `video-recovery-${randomUUID()}@example.invalid`;
			const created = await admin.auth.admin.createUser({
				email,
				email_confirm: true,
			});
			if (created.error || !created.data.user)
				throw created.error ?? new Error("Missing fixture user");
			userId = created.data.user.id;
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
		}, 30000);
		afterEach(() => {
			vi.unstubAllEnvs();
			fixture.poll.mockReset();
			fixture.submit.mockReset();
			fixture.delivery = undefined;
		});
		afterAll(async () => {
			if (!userId) return;
			const removed = await admin.auth.admin.deleteUser(userId);
			if (removed.error) throw removed.error;
			for (const table of ["projects", "jobs"]) {
				const remaining = await admin
					.from(table)
					.select("id")
					.eq("user_id", userId);
				if (remaining.error) throw remaining.error;
				expect(remaining.data).toEqual([]);
			}
		}, 30000);

		it.each(["ready", "pending", "failed"] as const)(
			"recovers saved upstream %s without another submission",
			async (outcome) => {
				const projectId = randomUUID();
				const project = await admin.from("projects").insert({
					id: projectId,
					user_id: userId,
					name: "Disposable video recovery",
					script: "Synthetic fixture",
				});
				if (project.error) throw project.error;
				const cap = await client.rpc("set_film_autonomous_cap", {
					p_project_id: projectId,
					p_cap_usd: 1,
				});
				if (cap.error) throw cap.error;
				const model = { provider: "fixture", model: "synthetic-video" };
				const job = await createJob({
					userId,
					projectId,
					connectorType: "video",
					request: model,
					status: "pending",
					costQuote: {
						...model,
						currency: "USD",
						ceilingUsd: 0.6,
						source: "synthetic-test",
						expiresAt: new Date(Date.now() + 300000).toISOString(),
					},
				});
				expect(await claimJob(job.id)).toBe(true);
				await markProviderStarted(job.id);
				await updateJob(job.id, {
					metadata: { providerJobId: "upstream-fixture" },
				});
				fixture.delivery = { job_id: job.id, lease_id: randomUUID() };
				const delivery = await admin.from("asset_deliveries").insert({
					...fixture.delivery,
					lease_until: new Date(Date.now() + 600000).toISOString(),
				});
				if (delivery.error) throw delivery.error;
				const asset = {
					id: "synthetic",
					type: "video",
					provider: "fixture",
					result: { video: "fixture.mp4" },
				};
				fixture.poll.mockResolvedValue(
					outcome === "ready"
						? { kind: outcome, asset, costUsd: 0.2 }
						: { kind: outcome },
				);
				vi.stubEnv("FYLMER_JOB_QUEUE", "postgres");
				vi.stubEnv("FYLMER_STAGING_GENERATION_ENABLED", "1");
				if (outcome === "failed")
					await expect(processLocalDelivery()).rejects.toThrow(
						"Video generation failed",
					);
				else
					await expect(processLocalDelivery()).resolves.toEqual({
						processed: true,
					});
				expect(fixture.submit).not.toHaveBeenCalled();
				expect(fixture.poll).toHaveBeenCalledExactlyOnceWith(
					"upstream-fixture",
					{ prompt: "Synthetic recovery fixture" },
					{ jobId: job.id },
				);
				const saved = await admin
					.from("jobs")
					.select("status,billing_state,metadata,result,cost_usd")
					.eq("id", job.id)
					.single();
				if (saved.error) throw saved.error;
				expect(saved.data).toMatchObject({
					status: outcome === "ready" ? "completed" : outcome,
					billing_state:
						outcome === "ready"
							? "settled"
							: outcome === "pending"
								? "submitted"
								: "uncertain",
					metadata: { providerJobId: "upstream-fixture" },
				});
				if (outcome === "ready") {
					expect(saved.data.result).toEqual(asset);
					expect(Number(saved.data.cost_usd)).toBe(0.2);
					await expect(
						updateJob(job.id, {
							status: "failed",
							error: "Late stale executor failure",
						}),
					).rejects.toThrow("A finished job cannot be restarted");
					await expect(
						updateJob(job.id, { status: "completed", cost_usd: 0.4 }),
					).rejects.toThrow("A settled provider charge cannot be overwritten");
				}
				const deliveries = await admin
					.from("asset_deliveries")
					.select("lease_id")
					.eq("job_id", job.id);
				if (deliveries.error) throw deliveries.error;
				expect(deliveries.data).toEqual(
					outcome === "ready"
						? []
						: [
								{
									lease_id:
										outcome === "pending" ? null : fixture.delivery.lease_id,
								},
							],
				);
			},
			30000,
		);
	},
);
