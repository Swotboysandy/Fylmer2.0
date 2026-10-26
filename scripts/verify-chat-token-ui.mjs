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
const output = "artifacts/chat-token-ui";
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
const email = `token-ui-${randomUUID()}@example.invalid`;
const results = [];
let userId;
let browser;
try {
	const account = await admin.auth.admin.createUser({
		email,
		email_confirm: true,
		app_metadata: { api_access: true },
	});
	if (account.error || !account.data.user)
		throw account.error ?? new Error("Fixture account missing");
	userId = account.data.user.id;
	const project = await admin.from("projects").insert({
		id: projectId,
		user_id: userId,
		name: "Token UI fixture",
		script: `--- Scene 1 ---\n<narration id="${randomUUID()}">A synthetic scene.</narration>`,
		store: { title: "Token UI fixture" },
		generation: {},
	});
	if (project.error) throw project.error;
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
	const conversation = await client
		.from("conversations")
		.insert({ project_id: projectId, user_id: userId })
		.select("id")
		.single();
	if (conversation.error) throw conversation.error;
	for (const [label, tokenUsage] of [
		["Reported usage fixture", { inputTokens: 12, outputTokens: 7 }],
		["Unknown usage fixture", { inputTokens: null, outputTokens: null }],
		["Legacy usage fixture", undefined],
		["Output limit fixture", { inputTokens: 12, outputTokens: 7 }],
	]) {
		const message = {
			id: randomUUID(),
			role: "assistant",
			parts: [{ type: "step-start" }, { type: "text", text: label }],
			metadata: {
				workSeconds: 3,
				...(tokenUsage ? { tokenUsage } : {}),
				...(label === "Output limit fixture"
					? { outputLimitReached: true }
					: {}),
			},
		};
		const stored = await client.from("messages").upsert({
			conversation_id: conversation.data.id,
			message_id: message.id,
			role: message.role,
			message,
		});
		if (stored.error) throw stored.error;
		const read = await client
			.from("messages")
			.select("message")
			.eq("conversation_id", conversation.data.id)
			.eq("message_id", message.id)
			.single();
		if (read.error) throw read.error;
		assert.deepEqual(read.data.message.metadata, message.metadata);
	}
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
			const page = await context.newPage();
			page.setDefaultTimeout(30000);
			await page.goto(`${origin}/projects/${projectId}`, {
				waitUntil: "networkidle",
			});
			for (let pass = 0; pass < 2; pass++) {
				if (pass) await page.reload({ waitUntil: "networkidle" });
				if (!(await page.getByRole("log").isVisible()))
					await page.getByRole("button", { name: "Chat", exact: true }).click();
				const known = page
					.getByRole("listitem")
					.filter({ hasText: "Reported usage fixture" });
				await expect(known).toContainText("19 tokens");
				await expect(known).not.toContainText("output limit");
				const limited = page
					.getByRole("listitem")
					.filter({ hasText: "Output limit fixture" });
				await expect(limited.getByRole("status")).toContainText(
					"output limit and may be incomplete",
				);
				await expect(limited.getByRole("status")).toBeVisible();
				await expect(limited).toContainText("19 tokens");
				await expect(
					known.locator('[title="12 input tokens; 7 output tokens"]'),
				).toBeVisible();
				await expect(
					page
						.getByRole("listitem")
						.filter({ hasText: "Unknown usage fixture" }),
				).toContainText("Token usage unavailable");
				await expect(
					page
						.getByRole("listitem")
						.filter({ hasText: "Legacy usage fixture" }),
				).not.toContainText("tokens");
				assert.equal(
					await page
						.getByRole("log")
						.evaluate(
							(element) => element.scrollWidth <= element.clientWidth + 1,
						),
					true,
				);
			}
			assert.equal(blocked.length, 0);
			await page.screenshot({ path: `${output}/${theme}-${width}.png` });
			results.push({
				theme,
				width,
				reload: true,
				databaseReadback: true,
				outputLimitWarning: true,
			});
			await context.close();
		}
	}
	await writeFile(
		`${output}/results.json`,
		JSON.stringify(
			{ results, seededMetadata: true, providerCalls: 0 },
			null,
			2,
		),
	);
	console.log(
		JSON.stringify({ results, seededMetadata: true, providerCalls: 0 }),
	);
} finally {
	await browser?.close();
	if (userId) {
		const removed = await admin.auth.admin.deleteUser(userId);
		if (removed.error) throw removed.error;
	}
}
