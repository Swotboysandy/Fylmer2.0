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
const output = "artifacts/music-rights-ui";
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
const projectId = randomUUID();
const scoreId = randomUUID();
const email = `rights-ui-${randomUUID()}@example.invalid`;
const audioUrl = "https://media.example.invalid/synthetic-score.wav";
let userId;
let browser;
const results = [];
try {
	const account = await admin.auth.admin.createUser({
		email,
		email_confirm: true,
	});
	if (account.error || !account.data.user)
		throw account.error ?? new Error("No fixture user");
	userId = account.data.user.id;
	const inserted = await admin
		.from("projects")
		.insert({
			id: projectId,
			user_id: userId,
			name: "Music rights fixture",
			script: `<music id="${scoreId}">Synthetic score</music>`,
			store: { title: "Music rights fixture" },
			generation: {
				[scoreId]: {
					status: "idle",
					startedAt: null,
					result: { audioUrl, durationSec: 4 },
					error: null,
					resultInputs: null,
					connectorType: "music",
					pinned: true,
				},
			},
		});
	if (inserted.error) throw inserted.error;
	const link = await admin.auth.admin.generateLink({
		type: "magiclink",
		email,
	});
	if (link.error) throw link.error;
	const session = await client.auth.verifyOtp({
		token_hash: link.data.properties.hashed_token,
		type: "magiclink",
	});
	if (session.error) throw session.error;
	browser = await chromium.launch({
		headless: true,
		executablePath:
			"/home/claudebot/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome",
	});
	for (const theme of ["light", "dark"])
		for (const width of [390, 1440]) {
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
			const blocked = [];
			await context.route("**/api/**", async (route) => {
				if (
					route.request().method() === "POST" &&
					/\/(v1|third-party|queues|agent)\b/.test(
						new URL(route.request().url()).pathname,
					)
				) {
					blocked.push(route.request().url());
					await route.abort();
				} else await route.continue();
			});
			await context.route("https://media.example.invalid/**", (route) =>
				route.fulfill({ status: 204, body: "" }),
			);
			const page = await context.newPage();
			page.setDefaultTimeout(30000);
			await page.goto(`${origin}/projects/${projectId}`, {
				waitUntil: "networkidle",
			});
			await page
				.getByRole("button", { name: "Film Bible", exact: true })
				.click();
			const card = page
				.locator("section")
				.filter({
					has: page.getByRole("heading", { name: "Music rights", exact: true }),
				});
			const evidence = `Fixture recording reference ${theme}-${width}`;
			await card
				.getByLabel("What permits you to use this recording?")
				.fill("I created this synthetic recording for testing.");
			await card
				.getByLabel("License or ownership evidence reference")
				.fill(evidence);
			await expect(
				card.getByRole("button", { name: "Apply declaration" }),
			).toBeDisabled();
			await card.getByRole("checkbox").check();
			await card.getByRole("button", { name: "Apply declaration" }).click();
			await expect(card).toContainText("User-declared rights");
			await expect
				.poll(
					async () => {
						const read = await client
							.from("projects")
							.select("generation")
							.eq("id", projectId)
							.single();
						if (read.error) throw read.error;
						return read.data.generation[scoreId]?.result?.musicRights?.evidence;
					},
					{ timeout: 30000 },
				)
				.toBe(evidence);
			await page.reload({ waitUntil: "networkidle" });
			if (!(await card.isVisible()))
				await page
					.getByRole("button", { name: "Film Bible", exact: true })
					.click();
			await expect(
				card.getByLabel("License or ownership evidence reference"),
			).toHaveValue(evidence);
			await expect(card.getByRole("checkbox")).not.toBeChecked();
			assert.equal(
				await card.evaluate(
					(element) => element.scrollWidth <= element.clientWidth + 1,
				),
				true,
			);
			assert.equal(blocked.length, 0);
			await card.screenshot({ path: `${output}/${theme}-${width}.png` });
			results.push({ theme, width, savedToDatabase: true, reload: true });
			await context.close();
		}
	await writeFile(
		`${output}/results.json`,
		JSON.stringify({ results, providerCalls: 0, syntheticOnly: true }, null, 2),
	);
	console.log(
		JSON.stringify({ results, providerCalls: 0, syntheticOnly: true }),
	);
} finally {
	await browser?.close();
	if (userId) {
		const removed = await admin.auth.admin.deleteUser(userId);
		if (removed.error) throw removed.error;
	}
}
