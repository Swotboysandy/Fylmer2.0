import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, mkdir } from "node:fs/promises";
import { parseEnv } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium, expect } from "@playwright/test";

const config = parseEnv(await readFile(".env.local", "utf8"));
assert.equal(new URL(config.NEXT_PUBLIC_SUPABASE_URL).host, "127.0.0.1:55421");
assert.equal(config.FYLMER_STAGING_GENERATION_ENABLED, "0");
const origin = "http://127.0.0.1:3055";
const admin = createClient(
	config.NEXT_PUBLIC_SUPABASE_URL,
	config.SUPABASE_SECRET_KEY,
	{ auth: { persistSession: false } },
);
const cookies = [];
const client = createServerClient(
	config.NEXT_PUBLIC_SUPABASE_URL,
	config.NEXT_PUBLIC_SUPABASE_ANON_KEY,
	{
		cookies: {
			getAll: () => cookies,
			setAll: (values) => cookies.push(...values),
		},
	},
);
const owners = [];
const projectId = randomUUID();
const otherProjectId = randomUUID();
const jobId = randomUUID();
let browser;
async function checked(operation) {
	const result = await operation;
	if (result.error) throw result.error;
	return result.data;
}
try {
	for (let index = 0; index < 2; index++) {
		const email = `budget-ui-${randomUUID()}@example.invalid`;
		const account = await checked(
			admin.auth.admin.createUser({
				email,
				email_confirm: true,
				app_metadata: { api_access: true },
			}),
		);
		assert.ok(account.user);
		owners.push(account.user.id);
		await checked(
			admin
				.from("projects")
				.insert({
					id: index ? otherProjectId : projectId,
					user_id: account.user.id,
					name: "Synthetic budget verification",
					script:
						"<scene><narration>Synthetic budget fixture.</narration></scene>",
					store: { title: "Synthetic budget verification" },
				}),
		);
		if (!index) {
			const link = await checked(
				admin.auth.admin.generateLink({ type: "magiclink", email }),
			);
			await checked(
				client.auth.verifyOtp({
					type: "magiclink",
					token_hash: link.properties.hashed_token,
				}),
			);
		}
	}
	await checked(
		admin.from("jobs").insert([
			{
				id: randomUUID(),
				user_id: owners[0],
				project_id: projectId,
				connector_type: "tts",
				status: "completed",
				request: { provider: "synthetic", model: "fixture" },
				cost_usd: 0.2,
			},
			{
				id: jobId,
				user_id: owners[0],
				project_id: projectId,
				connector_type: "tts",
				status: "failed",
				request: { provider: "synthetic", model: "fixture" },
			},
		]),
	);
	browser = await chromium.launch({
		headless: true,
		executablePath:
			"/home/claudebot/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome",
	});
	const anonymous = await browser.newContext();
	assert.equal(
		(
			await anonymous.request.post(`${origin}/api/film-budget`, {
				data: { projectId },
			})
		).status(),
		401,
	);
	await anonymous.close();
	await mkdir("artifacts/budget-readout", { recursive: true });
	for (const theme of ["light", "dark"]) {
		for (const width of [1440, 390]) {
			const context = await browser.newContext({
				viewport: { width, height: 900 },
				colorScheme: theme,
				reducedMotion: "reduce",
			});
			await context.addCookies(
				cookies.map(({ name, value }) => ({ name, value, url: origin })),
			);
			await context.addInitScript(
				(theme) => localStorage.setItem("theme", theme),
				theme,
			);
			const denied = await context.request.post(`${origin}/api/film-budget`, {
				data: { projectId: otherProjectId },
			});
			assert.equal(denied.status(), 404);
			const response = await context.request.post(`${origin}/api/film-budget`, {
				data: { projectId },
			});
			assert.equal(response.status(), 200);
			assert.equal(response.headers()["cache-control"], "private, no-store");
			assert.deepEqual(await response.json(), {
				committedUsd: 0.2,
				hasUncertainCharges: true,
			});
			const page = await context.newPage();
			let failedProgressRead = false;
			const runActions = [];
			await page.route("**/api/film-run", async (route) => {
				const input = route.request().postDataJSON();
				runActions.push(input.action);
				if (input.action === "read" && !failedProgressRead) {
					failedProgressRead = true;
					await route.fulfill({
						status: 503,
						contentType: "application/json",
						body: JSON.stringify({ error: "Synthetic progress interruption" }),
					});
					return;
				}
				await route.continue();
			});
			page.setDefaultTimeout(30000);
			await page.goto(`${origin}/projects/${projectId}`, {
				waitUntil: "networkidle",
			});
			await page
				.getByRole("button", { name: "Film Bible", exact: true })
				.click();
			await expect(
				page.getByText(/Could not refresh film progress/),
			).toBeVisible();
			await expect(
				page.getByText(/Could not refresh film progress/),
			).toHaveCount(0, { timeout: 15000 });
			assert.ok(
				runActions.length >= 2 &&
					runActions.every((action) => action === "read"),
			);
			await expect(page.getByText(/Committed:/)).toContainText("$0.20");
			await expect(
				page.getByText(/A provider charge needs billing review/),
			).toBeVisible();
			const bounds = await page.getByText(/Committed:/).boundingBox();
			assert.ok(
				bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1,
			);
			await page.screenshot({
				path: `artifacts/budget-readout/${theme}-${width}.png`,
			});
			if (theme === "dark" && width === 390) {
				await checked(
					admin.rpc("reconcile_film_job_charge", {
						p_job_id: jobId,
						p_cost_usd: 0.1,
						p_reference: "synthetic-fixture-evidence-only",
					}),
				);
				await page
					.getByRole("button", { name: "Refresh review", exact: true })
					.click();
				await expect(page.getByText(/Committed:/)).toContainText("$0.30");
				await expect(
					page.getByText(/A provider charge needs billing review/),
				).toHaveCount(0);
			}
			await context.close();
			console.log(
				`${theme} ${width}: owner/anonymous/non-owner checks, visible budget and hold passed`,
			);
		}
	}
} finally {
	await browser?.close();
	for (const owner of owners) {
		await checked(admin.auth.admin.deleteUser(owner));
		assert.deepEqual(
			await checked(admin.from("projects").select("id").eq("user_id", owner)),
			[],
		);
		assert.deepEqual(
			await checked(admin.from("jobs").select("id").eq("user_id", owner)),
			[],
		);
	}
}
