import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium, expect } from "@playwright/test";

const config = parseEnv(await readFile(".env.local", "utf8"));
assert.equal(new URL(config.NEXT_PUBLIC_SUPABASE_URL).host, "127.0.0.1:55421");
assert.equal(config.FYLMER_STAGING_GENERATION_ENABLED, "0");
const origin = "http://127.0.0.1:3055";
const output = "artifacts/brand-budget-ui";
await mkdir(output, { recursive: true });
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
const results = [];
let browser;
let userId;
try {
	browser = await chromium.launch({
		headless: true,
		executablePath:
			"/home/claudebot/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome",
	});
	for (const theme of ["light", "dark"]) {
		for (const width of [390, 1440]) {
			const context = await browser.newContext({
				viewport: { width, height: 900 },
				colorScheme: theme,
				reducedMotion: "reduce",
			});
			await context.addInitScript(
				(theme) => localStorage.setItem("theme", theme),
				theme,
			);
			const page = await context.newPage();
			await page.goto(`${origin}/login`, { waitUntil: "networkidle" });
			const wordmark = page.locator('img[src*="fylmer-logo-"]:visible');
			await expect(wordmark).toHaveCount(1);
			await expect(wordmark).toHaveAttribute(
				"src",
				`/brand/fylmer-logo-${theme}.png`,
			);
			await expect(page.getByAltText("Fylmer logo")).toBeVisible();
			assert.equal(
				await wordmark.evaluate(
					(element) => element.complete && element.naturalWidth === 480,
				),
				true,
			);
			assert.equal(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth + 1,
				),
				true,
			);
			const icon = await page.request.get(`${origin}/favicon.ico`);
			assert.equal(icon.status(), 200);
			const digest = (value) =>
				createHash("sha256").update(value).digest("hex");
			assert.equal(
				digest(await icon.body()),
				digest(await readFile("app/favicon.ico")),
			);
			await page.screenshot({ path: `${output}/login-${theme}-${width}.png` });
			results.push({ theme, width, logo: true, faviconMatches: true });
			await context.close();
		}
	}
	const email = `brand-budget-ui-${randomUUID()}@example.invalid`;
	const account = await admin.auth.admin.createUser({
		email,
		email_confirm: true,
		app_metadata: { api_access: true },
	});
	if (account.error || !account.data.user)
		throw account.error ?? new Error("Missing fixture user");
	userId = account.data.user.id;
	const projectId = randomUUID();
	const created = await admin
		.from("projects")
		.insert({
			id: projectId,
			user_id: userId,
			name: "Budget error UI fixture",
			script: `--- Scene 1 ---\n<narration id="${randomUUID()}">A synthetic scene.</narration>`,
			store: {
				title: "Budget error UI fixture",
				models: { llm: { provider: "openslop", model: "Fylmer Chat" } },
			},
			generation: {},
		});
	if (created.error) throw created.error;
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
	const cap = await client.rpc("set_film_autonomous_cap", {
		p_project_id: projectId,
		p_cap_usd: 1,
	});
	if (cap.error) throw cap.error;
	const context = await browser.newContext({
		viewport: { width: 390, height: 900 },
		colorScheme: "dark",
		reducedMotion: "reduce",
	});
	await context.addCookies(
		cookies.map(({ name, value }) => ({ name, value, url: origin })),
	);
	await context.route("**/api/**", async (route) => {
		const request = route.request();
		if (request.method() !== "POST") return route.continue();
		const path = new URL(request.url()).pathname;
		if (/\/(v1|third-party|queues|agent)\b/.test(path)) {
			const body = request.postDataJSON();
			if (
				path.endsWith("/agent") &&
				body.provider === "openslop" &&
				body.model === "Fylmer Chat" &&
				body.projectId === projectId
			)
				return route.continue();
			return route.abort();
		}
		return route.continue();
	});
	const page = await context.newPage();
	await page.goto(`${origin}/projects/${projectId}`, {
		waitUntil: "networkidle",
	});
	if (!(await page.getByRole("log").isVisible()))
		await page.getByRole("button", { name: "Chat", exact: true }).click();
	const composer = page.getByPlaceholder("Write or change the script…");
	await composer.fill("Read the existing script.");
	const responsePromise = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname.endsWith("/agent") &&
			response.request().method() === "POST",
	);
	await composer.press("Enter");
	const response = await responsePromise;
	assert.equal(response.status(), 409);
	assert.match((await response.json()).error, /no verified bounded price/);
	await expect(
		page.getByText(/no verified bounded price/).first(),
	).toBeVisible();
	await expect(page.locator("[data-sonner-toast]").first()).not.toContainText(
		'{"error"',
	);
	const jobs = await admin.from("jobs").select("id").eq("user_id", userId);
	if (jobs.error) throw jobs.error;
	assert.equal(jobs.data.length, 0);
	await page.screenshot({ path: `${output}/budget-error-dark-390.png` });
	results.push({ budgetRejected: true, visibleError: true, jobCount: 0 });
	await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
	console.log(JSON.stringify(results));
} finally {
	await browser?.close();
	if (userId) {
		const deleted = await admin.auth.admin.deleteUser(userId);
		if (deleted.error) throw deleted.error;
	}
}
