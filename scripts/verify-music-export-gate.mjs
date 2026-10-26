import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
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
const projectId = randomUUID();
const scoreId = randomUUID();
const imageId = randomUUID();
const email = `music-gate-${randomUUID()}@example.invalid`;
const audioUrl = "https://media.example.invalid/score.wav";
let userId;
let browser;
const review = async (action) => {
	const result = await client.rpc("film_workflow", {
		p_project_id: projectId,
		p_action: action,
	});
	if (result.error) throw new Error(`${action}: ${result.error.message}`);
	return result.data;
};
try {
	const account = await admin.auth.admin.createUser({
		email,
		email_confirm: true,
		app_metadata: { api_access: true },
	});
	if (account.error || !account.data.user)
		throw account.error ?? new Error("No fixture user");
	userId = account.data.user.id;
	const inserted = await admin.from("projects").insert({
		id: projectId,
		user_id: userId,
		name: "Music export gate fixture",
		script: `<image id="${imageId}">Synthetic frame</image><music id="${scoreId}">Synthetic score</music>`,
		store: { title: "Music export gate fixture" },
		generation: {
			[imageId]: {
				status: "idle",
				startedAt: null,
				result: {
					imageUrl: "https://media.example.invalid/frame.png",
					durationSec: 4,
				},
				error: null,
				resultInputs: null,
				connectorType: "image",
				pinned: true,
			},
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
	for (const action of ["bible", "directed", "images", "videos", "final_cut"])
		await review(action);
	browser = await chromium.launch({
		headless: true,
		executablePath:
			"/home/claudebot/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome",
	});
	const context = await browser.newContext({
		viewport: { width: 1440, height: 900 },
		reducedMotion: "reduce",
	});
	await context.addCookies(
		cookies.map(({ name, value }) => ({ name, value, url: origin })),
	);
	const runId = randomUUID();
	for (let attempt = 0; attempt < 2; attempt++) {
		const stopped = await context.request.post(`${origin}/api/film-run`, {
			data: { projectId, action: "start", runId },
		});
		assert.equal(stopped.status(), 503);
		assert.match(
			(await stopped.json()).error,
			/generation is currently disabled/,
		);
	}
	const runState = await context.request.post(`${origin}/api/film-run`, {
		data: { projectId, action: "read" },
	});
	assert.equal(runState.status(), 200);
	assert.equal((await runState.json()).run, null);
	await context.route("https://media.example.invalid/**", (route) =>
		route.fulfill({ status: 204, body: "" }),
	);
	const page = await context.newPage();
	page.setDefaultTimeout(30000);
	await page.goto(`${origin}/projects/${projectId}`, {
		waitUntil: "networkidle",
	});
	await page
		.getByRole("button", { name: "Export", exact: true })
		.first()
		.click();
	const responsePromise = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === "/api/render" &&
			response.request().method() === "POST",
	);
	await page
		.getByRole("button", { name: "Export", exact: true })
		.last()
		.click();
	const response = await responsePromise;
	assert.equal(response.status(), 409);
	const rejection = await response.json();
	assert.match(rejection.error, /no rights declaration/);
	await expect(
		page.getByText(rejection.error, { exact: true }).first(),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await page.getByRole("button", { name: "Film Bible", exact: true }).click();
	const card = page
		.locator("section")
		.filter({
			has: page.getByRole("heading", { name: "Music rights", exact: true }),
		});
	await card
		.getByLabel("What permits you to use this recording?")
		.fill("Synthetic fixture recording only.");
	await card
		.getByLabel("License or ownership evidence reference")
		.fill("Fixture test evidence");
	await card.getByRole("checkbox").check();
	await card.getByRole("button", { name: "Apply declaration" }).click();
	await expect
		.poll(async () => {
			const read = await client
				.from("projects")
				.select("generation")
				.eq("id", projectId)
				.single();
			if (read.error) throw read.error;
			return read.data.generation[scoreId]?.result?.musicRights?.evidence;
		})
		.toBe("Fixture test evidence");
	assert.equal((await review("read")).finalCut, false);
	for (const action of ["bible", "images", "videos", "final_cut"])
		await review(action);
	const probe = await context.request.post(`${origin}/api/render`, {
		data: { projectId, resolution: "480p", inputProps: {} },
	});
	assert.equal(probe.status(), 409);
	assert.match(
		(await probe.json()).error,
		/preview differs from the saved film/,
	);
	console.log(
		JSON.stringify({
			disabledGenerationRetries: "HTTP 503, no film run created",
			missingRights: "visible HTTP 409",
			declarationSaved: true,
			renewedReviewRequired: true,
			declarationGatePassed: true,
			renderIntentionallyPrevented: "invalid preview",
			syntheticOnly: true,
		}),
	);
} finally {
	await browser?.close();
	if (userId) {
		const removed = await admin.auth.admin.deleteUser(userId);
		if (removed.error) throw removed.error;
	}
}
