import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium, expect } from "@playwright/test";

const config = parseEnv(await readFile(".env.local", "utf8"));
assert.equal(new URL(config.NEXT_PUBLIC_SUPABASE_URL).host, "127.0.0.1:55421");
assert.equal(config.FYLMER_STAGING_GENERATION_ENABLED, "0");
const origin = "http://127.0.0.1:3055";
const output = "artifacts/media-project-ui";
await mkdir(output, { recursive: true });
const admin = createClient(
	config.NEXT_PUBLIC_SUPABASE_URL,
	config.SUPABASE_SECRET_KEY,
	{
		auth: { persistSession: false },
	},
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
const projects = [randomUUID(), randomUUID()];
const requests = [];
let browser;
let userId;
try {
	const email = `media-project-ui-${randomUUID()}@example.invalid`;
	const account = await admin.auth.admin.createUser({
		email,
		email_confirm: true,
		app_metadata: { api_access: true },
	});
	if (account.error || !account.data.user)
		throw account.error ?? new Error("Missing fixture user");
	userId = account.data.user.id;
	for (const projectId of projects) {
		const created = await admin.from("projects").insert({
			id: projectId,
			user_id: userId,
			name: "Media project identity verification",
			script: `--- Scene 1 ---\n<image id="${randomUUID()}">A lighthouse in the rain.</image>`,
			store: {},
			generation: {},
		});
		if (created.error) throw created.error;
	}
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
	browser = await chromium.launch({
		headless: true,
		executablePath:
			"/home/claudebot/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome",
	});
	const context = await browser.newContext({
		viewport: { width: 1440, height: 960 },
		reducedMotion: "reduce",
	});
	await context.addCookies(
		cookies.map(({ name, value }) => ({ name, value, url: origin })),
	);
	await context.route("**/api/**", async (route) => {
		const request = route.request();
		const path = new URL(request.url()).pathname;
		if (/\/(v1|third-party|queues|agent)\b/.test(path)) {
			if (request.method() === "POST" && path.endsWith("/image")) {
				requests.push(request.postDataJSON());
				return route.fulfill({
					status: 409,
					contentType: "application/json",
					body: JSON.stringify({
						error: "Verification only: generation disabled.",
					}),
				});
			}
			return route.abort();
		}
		return route.continue();
	});
	const page = await context.newPage();
	for (const [index, projectId] of projects.entries()) {
		await page.goto(`${origin}/projects/${projectId}`, {
			waitUntil: "networkidle",
		});
		const generate = page.getByRole("button", {
			name: "Generate",
			exact: true,
		});
		await expect(generate).toHaveCount(1);
		await generate.click();
		await expect.poll(() => requests.length).toBe(index + 1);
		assert.equal(requests[index].projectId, projectId);
		assert.equal(requests[index].prompt.includes("lighthouse"), true);
		assert.equal(typeof requests[index].model, "string");
		assert.equal(typeof requests[index].provider, "string");
		await expect(generate).toBeEnabled();
		await expect(
			page.getByText("Verification only: generation disabled.").first(),
		).toBeVisible();
		await page.screenshot({ path: `${output}/project-${index + 1}.png` });
	}
	const jobs = await admin.from("jobs").select("id").eq("user_id", userId);
	if (jobs.error) throw jobs.error;
	assert.equal(jobs.data.length, 0);
	const result = {
		projectsVerified: projects.length,
		interceptedRequests: requests.length,
		canonicalIdsMatch: true,
		providerJobsCreated: 0,
		actualProviderGeneration: false,
	};
	await writeFile(`${output}/results.json`, JSON.stringify(result, null, 2));
	console.log(JSON.stringify(result));
} finally {
	await browser?.close();
	if (userId) {
		const deleted = await admin.auth.admin.deleteUser(userId);
		if (deleted.error) throw deleted.error;
	}
}
