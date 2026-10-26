import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
const admin = createClient(
	config.NEXT_PUBLIC_SUPABASE_URL,
	config.SUPABASE_SECRET_KEY,
	{
		auth: { persistSession: false },
	},
);
const projectId = randomUUID();
const imageId = randomUUID();
const videoId = randomUUID();
const script = `--- Scene 1 ---\n<image id="${imageId}">A synthetic review fixture.</image>\n<video id="${videoId}">A synthetic review fixture.</video>`;
const email = `film-review-${randomUUID()}@example.invalid`;
const cookies = [];
const session = createServerClient(
	config.NEXT_PUBLIC_SUPABASE_URL,
	config.NEXT_PUBLIC_SUPABASE_ANON_KEY,
	{
		cookies: { getAll: () => [], setAll: (values) => cookies.push(...values) },
	},
);
const checks = [];
const blocked = [];
let userId;
let browser;

async function review(action) {
	const { data, error } = await session.rpc("film_workflow", {
		p_project_id: projectId,
		p_action: action,
	});
	if (error) throw new Error(`${action}: ${error.message}`);
	return data;
}

async function updateProject(patch) {
	const { error } = await admin
		.from("projects")
		.update(patch)
		.eq("id", projectId)
		.eq("user_id", userId);
	if (error) throw error;
}

try {
	const { data, error } = await admin.auth.admin.createUser({
		email,
		email_confirm: true,
		app_metadata: { api_access: true },
	});
	if (error || !data.user) throw error ?? new Error("Synthetic user missing");
	userId = data.user.id;
	const { error: projectError } = await admin.from("projects").insert({
		id: projectId,
		user_id: userId,
		name: "Review validation",
		script,
		store: { title: "Review validation" },
		generation: {},
	});
	if (projectError) throw projectError;
	const { data: link, error: linkError } = await admin.auth.admin.generateLink({
		type: "magiclink",
		email,
	});
	if (linkError) throw linkError;
	const { error: authError } = await session.auth.verifyOtp({
		token_hash: link.properties.hashed_token,
		type: "magiclink",
	});
	if (authError) throw authError;
	assert.equal((await review("read")).bible, false);
	const premature = await session.rpc("film_workflow", {
		p_project_id: projectId,
		p_action: "final_cut",
	});
	assert.ok(premature.error);
	assert.equal((await review("bible")).bible, true);
	const { error: capError } = await session.rpc("set_film_autonomous_cap", {
		p_project_id: projectId,
		p_cap_usd: 1,
	});
	if (capError) throw capError;
	assert.equal((await review("autonomous")).mode, "autonomous");
	const generation = {
		[imageId]: {
			status: "idle",
			startedAt: null,
			result: { imageUrl: "/review-fixture.png", durationSec: 1 },
			error: null,
			resultInputs: null,
			connectorType: "image",
			pinned: true,
		},
		[videoId]: {
			status: "idle",
			startedAt: null,
			result: { videoUrl: "/review-fixture.mp4", durationSec: 1 },
			error: null,
			resultInputs: null,
			connectorType: "video",
			pinned: true,
		},
	};
	await updateProject({ generation });
	const before = await review("read");
	assert.equal(before.videos, true);
	assert.equal(before.finalCut, false);
	checks.push(
		"Autonomous read approves complete stages but never the final cut",
	);
	assert.equal((await review("final_cut")).finalCut, true);
	assert.equal((await review("read")).mode, "autonomous");
	checks.push("Explicit final approval works without switching mode");
	await updateProject({
		script: script.replaceAll("synthetic review", "revised synthetic review"),
	});
	assert.equal((await review("read")).bible, false);
	assert.ok(
		(
			await session.rpc("film_workflow", {
				p_project_id: projectId,
				p_action: "final_cut",
			})
		).error,
	);
	checks.push(
		"Changed Bible invalidates approval and blocks premature final review",
	);
	await review("bible");
	await review("read");
	assert.equal((await review("final_cut")).finalCut, true);
	await review("directed");
	assert.equal((await review("read")).finalCut, false);
	await review("images");
	await review("videos");
	assert.equal((await review("final_cut")).finalCut, true);
	checks.push("Directed approvals still work");
	const anonymous = createClient(
		config.NEXT_PUBLIC_SUPABASE_URL,
		config.NEXT_PUBLIC_SUPABASE_ANON_KEY,
		{ auth: { persistSession: false } },
	);
	assert.ok(
		(
			await anonymous.rpc("film_workflow", {
				p_project_id: projectId,
				p_action: "final_cut",
			})
		).error,
	);
	assert.ok(
		(
			await session.rpc("film_workflow", {
				p_project_id: randomUUID(),
				p_action: "final_cut",
			})
		).error,
	);
	checks.push("Unauthenticated and missing-project requests are rejected");
	if (!process.argv.includes("--rpc-only")) {
		await mkdir("artifacts/film-review", { recursive: true });
		execFileSync(
			"ffmpeg",
			[
				"-y",
				"-f",
				"lavfi",
				"-i",
				"color=c=0x30343d:s=320x180:r=24:d=1",
				"-c:v",
				"libx264",
				"-pix_fmt",
				"yuv420p",
				"-movflags",
				"+faststart",
				"artifacts/film-review/synthetic-fixture.mp4",
			],
			{ stdio: "ignore" },
		);
		const videoFixture = await readFile(
			"artifacts/film-review/synthetic-fixture.mp4",
		);
		const imageFixture =
			'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#30343d"/><text x="160" y="90" fill="#ffffff" text-anchor="middle" font-size="16">Synthetic review fixture</text></svg>';
		await review("bible");
		await review("autonomous");
		browser = await chromium.launch({
			headless: true,
			executablePath:
				"/home/claudebot/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome",
		});
		const context = await browser.newContext({
			viewport: { width: 1440, height: 900 },
			colorScheme: "dark",
		});
		await context.addCookies(
			cookies.map(({ name, value, options }) => ({
				name,
				value,
				url: origin,
				httpOnly: options?.httpOnly ?? false,
			})),
		);
		await context.route("**/*", async (route) => {
			const request = route.request();
			const url = new URL(request.url());
			if (
				request.method() === "POST" &&
				url.pathname !== "/api/render/recover" &&
				/\/api\/(v1|third-party|queues|render|internal)\b/.test(url.pathname)
			) {
				blocked.push(url.pathname);
				await route.abort();
				return;
			}
			if (url.pathname === "/review-fixture.png") {
				await route.fulfill({
					contentType: "image/svg+xml",
					body: imageFixture,
				});
				return;
			}
			if (url.pathname === "/review-fixture.mp4") {
				await route.fulfill({ contentType: "video/mp4", body: videoFixture });
				return;
			}
			if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
				await route.abort();
				return;
			}
			await route.continue();
		});
		const page = await context.newPage();
		await page.goto(`${origin}/projects/${projectId}`);
		await page
			.getByRole("navigation", { name: "Panels" })
			.getByRole("button", { name: "Film Bible", exact: true })
			.click();
		const finalButton = page.getByRole("button", {
			name: "Next: approve final cut",
			exact: true,
		});
		await expect(finalButton).toBeEnabled();
		const cap = page.getByRole("spinbutton", { name: "Autonomous cap ($)" });
		await expect(cap).toHaveValue("1");
		assert.ok(
			(await cap.boundingBox()).width >= 100,
			"Budget amount must not be squeezed out of view",
		);
		await expect
			.poll(() =>
				page
					.locator("video")
					.first()
					.evaluate((video) => !video.error && video.readyState >= 2),
			)
			.toBe(true);
		await expect(page.getByText(/The browser threw an error/)).toHaveCount(0);
		await finalButton.click();
		await expect(
			page.getByText("Final cut approved", { exact: false }),
		).toBeVisible();
		await expect(finalButton).toBeDisabled();
		assert.equal((await review("read")).mode, "autonomous");
		checks.push("Actual UI final-review click succeeds in Autonomous");
		await expect(
			page.getByRole("button", { name: "Start film", exact: true }),
		).toBeDisabled();
		await expect(
			page.getByText(
				"Film generation is disabled. Existing runs can still be paused or cancelled.",
				{ exact: true },
			),
		).toBeVisible();
		const runId = randomUUID();
		const started = await session.rpc("control_film_run", {
			p_project_id: projectId,
			p_action: "start",
			p_run_id: runId,
		});
		if (started.error) throw started.error;
		await expect(
			page.getByRole("button", { name: "Pause run", exact: true }),
		).toBeVisible({ timeout: 15000 });
		await page.getByRole("button", { name: "Pause run", exact: true }).click();
		await expect(
			page.getByRole("button", { name: "Resume run", exact: true }),
		).toBeDisabled();
		const paused = await session.rpc("control_film_run", {
			p_project_id: projectId,
			p_action: "read",
			p_run_id: runId,
		});
		assert.equal(paused.data.status, "paused");
		await page.reload();
		const panel = page
			.getByRole("navigation", { name: "Panels" })
			.getByRole("button", { name: "Film Bible", exact: true });
		if (
			!(await page
				.getByRole("button", { name: "Cancel run", exact: true })
				.isVisible())
		)
			await panel.click();
		await expect(
			page.getByRole("button", { name: "Resume run", exact: true }),
		).toBeDisabled();
		await page.getByRole("button", { name: "Cancel run", exact: true }).click();
		await expect(
			page.getByText("Film run: cancelled", { exact: true }),
		).toBeVisible();
		const cancelled = await session.rpc("control_film_run", {
			p_project_id: projectId,
			p_action: "read",
			p_run_id: runId,
		});
		assert.equal(cancelled.data.status, "cancelled");
		await expect(
			page.getByRole("button", { name: "Start film", exact: true }),
		).toBeDisabled();
		checks.push(
			"Actual UI pauses a synthetic run, restores it after refresh, and cancels it while generation stays disabled",
		);
		await mkdir("artifacts/film-review", { recursive: true });
		await page.screenshot({ path: "artifacts/film-review/final-approved.png" });
		await updateProject({ script: `${script}\nA changed story.` });
		await page.getByRole("button", { name: "Refresh review" }).click();
		const bibleButton = page.getByRole("button", {
			name: "Approve Film Bible",
			exact: true,
		});
		await expect(bibleButton).toBeEnabled();
		await bibleButton.click();
		await expect(finalButton).toBeEnabled();
		checks.push(
			"Actual UI recovers stale Bible without losing Autonomous mode",
		);
		assert.deepEqual(blocked, []);
		await context.close();
	}
	await mkdir("artifacts/film-review", { recursive: true });
	await writeFile(
		"artifacts/film-review/results.json",
		JSON.stringify({ checks, noGeneration: blocked.length === 0 }, null, 2),
	);
	console.log(JSON.stringify({ checks, noGeneration: blocked.length === 0 }));
} finally {
	await browser?.close();
	if (userId) {
		const { error } = await admin.auth.admin.deleteUser(userId);
		if (error) throw error;
	}
}
