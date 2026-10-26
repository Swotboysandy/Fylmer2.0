import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv, promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium, expect } from "@playwright/test";

const run = promisify(execFile);
const config = parseEnv(await readFile(".env.local", "utf8"));
assert.equal(new URL(config.NEXT_PUBLIC_SUPABASE_URL).host, "127.0.0.1:55421");
assert.equal(config.FYLMER_STAGING_GENERATION_ENABLED, "0");
assert.equal(config.FYLMER_EXPORT_BACKEND, "local");
const origin = "http://127.0.0.1:3055";
const testCancellation = process.env.FYLMER_TEST_EXPORT_CANCELLATION === "1";
const testCrossfade = process.env.FYLMER_TEST_EXPORT_CROSSFADE === "1";
const testCaptions = process.env.FYLMER_TEST_EXPORT_CAPTIONS === "1";
assert.ok(!testCaptions || testCrossfade);
const testUpload = process.env.FYLMER_TEST_EXPORT_UPLOAD === "1";
const testGenerated = process.env.FYLMER_TEST_EXPORT_GENERATED === "1";
const testRun = process.env.FYLMER_TEST_EXPORT_RUN === "1";
const testClosed = process.env.FYLMER_TEST_EXPORT_CLOSED === "1";
assert.ok(!testClosed || (testRun && !testCancellation));
const filmRunId = randomUUID();
assert.ok(
	[testCancellation, testCrossfade, testUpload, testGenerated].filter(Boolean)
		.length <= 1,
);
assert.ok(!testRun || (!testCrossfade && !testUpload && !testGenerated));
const expectedDuration = testCrossfade ? 8 : 4;
const output = testClosed
	? "artifacts/closed-tab-film-export"
	: testRun
		? testCancellation
			? "artifacts/cancelled-film-run-export"
			: "artifacts/completed-film-run-export"
		: testGenerated
			? "artifacts/generated-private-export"
			: testCancellation
				? "artifacts/cancelled-export"
				: testCrossfade
					? "artifacts/crossfade-export"
					: testUpload
						? "artifacts/uploaded-still-export"
						: "artifacts/canonical-export";
await mkdir(output, { recursive: true });
const temporary = await mkdtemp(join(tmpdir(), "fylmer-canonical-export-"));
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
const imageId = randomUUID();
const videoId = randomUUID();
const voiceId = randomUUID();
const firstVoiceId = randomUUID();
const accounts = [];
const storagePaths = [];
const generatedPaths = [];
const checks = [];
const blocked = [];
let browser;
let userId;
let renderId;
let completed = false;

async function createAccount() {
	const email = `export-audit-${randomUUID()}@example.invalid`;
	const { data, error } = await admin.auth.admin.createUser({
		email,
		email_confirm: true,
		app_metadata: { api_access: true },
	});
	if (error || !data.user) throw error ?? new Error("Test account missing");
	accounts.push(data.user.id);
	return { email, id: data.user.id };
}

async function review(action) {
	const { data, error } = await client.rpc("film_workflow", {
		p_project_id: projectId,
		p_action: action,
	});
	if (error) throw error;
	return data;
}

async function upload(name, contentType) {
	const path = `${userId}/canonical-export/${name}`;
	const uploaded = await client.storage
		.from("fylmer-media")
		.upload(path, await readFile(join(temporary, name)), { contentType });
	if (uploaded.error) throw uploaded.error;
	storagePaths.push(path);
	const signed = await client.storage
		.from("fylmer-media")
		.createSignedUrl(path, 3600);
	if (signed.error) throw signed.error;
	return signed.data.signedUrl;
}

try {
	const account = await createAccount();
	userId = account.id;
	const outsider = await createAccount();
	const { data: link, error: linkError } = await admin.auth.admin.generateLink({
		type: "magiclink",
		email: account.email,
	});
	if (linkError) throw linkError;
	const verified = await client.auth.verifyOtp({
		token_hash: link.properties.hashed_token,
		type: "magiclink",
	});
	if (verified.error) throw verified.error;
	await run("ffmpeg", [
		"-nostdin",
		"-y",
		"-f",
		"lavfi",
		"-i",
		"color=c=blue:s=640x360:r=24:d=1",
		"-frames:v",
		"1",
		"-threads",
		"1",
		join(temporary, "opening.png"),
	]);
	await run("ffmpeg", [
		"-nostdin",
		"-y",
		"-f",
		"lavfi",
		"-i",
		"color=c=red:s=640x360:r=24:d=2",
		"-c:v",
		"libx264",
		"-pix_fmt",
		"yuv420p",
		"-threads",
		"1",
		join(temporary, "selected.mp4"),
	]);
	await run("ffmpeg", [
		"-nostdin",
		"-y",
		"-f",
		"lavfi",
		"-i",
		testCrossfade
			? "sine=frequency=880:duration=4"
			: "sine=frequency=660:duration=3",
		"-c:a",
		"pcm_s16le",
		join(temporary, "voice.wav"),
	]);
	if (testCrossfade) {
		await run("ffmpeg", [
			"-nostdin",
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			"sine=frequency=440:duration=4",
			join(temporary, "first-voice.wav"),
		]);
	}
	const snapshot = (connectorType, result) => ({
		status: "idle",
		startedAt: null,
		connectorType,
		result,
		error: null,
		resultInputs: null,
		pinned: true,
	});
	const generation = {
		[imageId]: snapshot("image", {
			imageUrl: await upload("opening.png", "image/png"),
			durationSec: testCrossfade ? 4 : 1,
		}),
		[videoId]: snapshot("video", {
			videoUrl: await upload("selected.mp4", "video/mp4"),
			durationSec: 2,
		}),
		[voiceId]: snapshot("tts", {
			audioUrl: await upload("voice.wav", "audio/wav"),
			durationSec: testCrossfade ? 4 : 3,
			...(testCaptions
				? { textTimestamps: [{ text: "ENDING", start: 3.5, end: 4 }] }
				: {}),
		}),
	};
	if (testCrossfade) {
		generation[firstVoiceId] = snapshot("tts", {
			audioUrl: await upload("first-voice.wav", "audio/wav"),
			durationSec: 4,
		});
	}
	const firstVoice = testCrossfade
		? `\n<narration id="${firstVoiceId}">The first synthetic line must finish.</narration>`
		: "";
	const script = `--- Scene 1 ---\n<image id="${imageId}">Synthetic blue opening.</image>${firstVoice}\n--- Scene 2 ---\n<video id="${videoId}">Synthetic selected red take.</video>\n<narration id="${voiceId}">The synthetic test signal is ready.</narration>`;
	const project = await admin.from("projects").insert({
		id: projectId,
		user_id: userId,
		name: "Canonical export verification",
		script,
		store: {
			videoSettings: {
				aspectRatio: "16:9",
				transitionType: testCrossfade ? "fade" : "none",
				captions: testCaptions,
			},
		},
		generation,
	});
	if (project.error) throw project.error;
	if (testGenerated) {
		for (const [elementId, name, contentType, key] of [
			[imageId, "opening.png", "image/png", "image"],
			[videoId, "selected.mp4", "video/mp4", "video"],
			[voiceId, "voice.wav", "audio/wav", "audio"],
		]) {
			const jobId = randomUUID();
			const prefix = `${userId}/${jobId}`;
			const bytes = await readFile(join(temporary, name));
			const filename = `${createHash("sha256").update(bytes).digest("hex")}-${name}`;
			const result = {
				id: jobId,
				type: generation[elementId].connectorType,
				provider: "synthetic",
				result: { [key]: filename },
				metadata: { durationSec: generation[elementId].result.durationSec },
			};
			const manifestBytes = Buffer.from(JSON.stringify(result));
			const manifestPath = `${prefix}/${createHash("sha256").update(manifestBytes).digest("hex")}-manifest.json`;
			for (const [path, data, mime] of [
				[`${prefix}/${filename}`, bytes, contentType],
				[manifestPath, manifestBytes, "application/json"],
			]) {
				const stored = await admin.storage
					.from("fylmer-generated")
					.upload(path, data, { contentType: mime });
				if (stored.error) throw stored.error;
				generatedPaths.push(path);
			}
			const inserted = await admin.from("jobs").insert({
				id: jobId,
				user_id: userId,
				project_id: projectId,
				connector_type: result.type,
				status: "completed",
				request: { provider: "openslop", model: "synthetic-fixture" },
				result: {
					...result,
					storage: { bucket: "fylmer-generated", prefix, manifestPath },
				},
				cost_usd: 0,
			});
			if (inserted.error) throw inserted.error;
			generation[elementId].result[`${key}Url`] =
				`${origin}/api/generated-media/${jobId}/${key}`;
		}
		const saved = await admin
			.from("projects")
			.update({ generation })
			.eq("id", projectId);
		if (saved.error) throw saved.error;
		checks.push(
			"Synthetic private image, video and audio jobs use stable application URLs",
		);
	}
	await review("bible");
	await review("directed");
	await review("images");
	await review("videos");
	browser = await chromium.launch({
		headless: true,
		executablePath:
			"/home/claudebot/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome",
	});
	const context = await browser.newContext({
		viewport: { width: 1440, height: 960 },
		acceptDownloads: true,
	});
	await context.addCookies(
		cookies.map((cookie) => ({
			name: cookie.name,
			value: cookie.value,
			url: origin,
		})),
	);
	await context.route(
		/\/api\/(v1|third-party)\/(image|video|tts|music|sfx|agent|llm)(?:\/|$)/,
		async (route) => {
			blocked.push(route.request().url());
			await route.abort();
		},
	);
	let page = await context.newPage();
	await page.goto(`${origin}/projects/${projectId}`, {
		waitUntil: "networkidle",
	});
	if (testCaptions) {
		const seek = page.getByRole("slider", { name: "Seek", exact: true });
		await expect(seek).not.toHaveAttribute("aria-disabled", "true");
		await seek.focus();
		await seek.press("End");
		await expect(page.getByText("ENDING", { exact: true })).toBeVisible();
		await page.screenshot({ path: `${output}/caption-preview-tail.png` });
		checks.push(
			"Final spoken caption remains visible at the editor preview's final frame with fades enabled",
		);
		await seek.press("Home");
	}
	if (testUpload) {
		const prefix = `/storage/v1/object/fylmer-media/${userId}/`;
		page.on("request", (request) => {
			const url = new URL(request.url());
			if (
				request.method() === "POST" &&
				url.origin === new URL(config.NEXT_PUBLIC_SUPABASE_URL).origin &&
				url.pathname.startsWith(prefix)
			) {
				storagePaths.push(
					decodeURIComponent(
						url.pathname.slice("/storage/v1/object/fylmer-media/".length),
					),
				);
			}
		});
		const picker = page.waitForEvent("filechooser");
		await page
			.getByRole("button", { name: "Upload your own image", exact: true })
			.click();
		await (await picker).setFiles(join(temporary, "opening.png"));
		let uploaded;
		await expect
			.poll(
				async () => {
					const saved = await client
						.from("projects")
						.select("generation")
						.eq("id", projectId)
						.single();
					if (saved.error) throw saved.error;
					uploaded = saved.data.generation[imageId];
					return (
						uploaded?.result?.imageUrl !==
							generation[imageId].result.imageUrl &&
						uploaded?.pinned === true &&
						uploaded?.result?.durationSec === 0
					);
				},
				{ timeout: 30000 },
			)
			.toBe(true);
		generation[imageId] = uploaded;
		const stored = await context.request.get(uploaded.result.imageUrl);
		assert.equal(stored.status(), 200);
		assert.equal(
			createHash("sha256")
				.update(await stored.body())
				.digest("hex"),
			createHash("sha256")
				.update(await readFile(join(temporary, "opening.png")))
				.digest("hex"),
		);
		await review("bible");
		await review("images");
		await review("videos");
		checks.push(
			"Actual image Upload button stores identical owned PNG bytes and saves a pinned zero-intrinsic-duration selected take",
		);
	}
	await expect(
		page.getByRole("button", { name: "Export", exact: true }).first(),
	).toBeEnabled({ timeout: 30000 });
	await page
		.getByRole("button", { name: "Export", exact: true })
		.first()
		.click();
	await page.getByRole("combobox", { name: "Resolution", exact: true }).click();
	await page.getByRole("option", { name: "480p", exact: true }).click();
	let captured;
	await page.route("**/api/render", async (route) => {
		captured = route.request().postDataJSON();
		await route.fulfill({
			status: 409,
			json: { error: "Synthetic preview captured; no export started." },
		});
	});
	await page
		.getByRole("button", { name: "Export", exact: true })
		.last()
		.click();
	await expect(
		page
			.getByText("Synthetic preview captured; no export started.", {
				exact: true,
			})
			.first(),
	).toBeVisible();
	assert.equal(captured.projectId, projectId);
	assert.equal(captured.inputProps.totalFrames, expectedDuration * 24);
	assert.equal(captured.inputProps.totalDurationSec, expectedDuration);
	if (testUpload)
		assert.equal(captured.inputProps.series[0].element.durationSec, 0);
	if (testCrossfade) {
		const voices = captured.inputProps.sequences.narration;
		assert.equal(voices.length, 2);
		assert.equal(voices[0].start, 0);
		assert.equal(voices[1].start, 4);
		assert.ok(captured.inputProps.series[1].start < voices[1].start);
		checks.push(
			"Browser preview preserves consecutive four-second speech while visuals crossfade",
		);
	}
	await page.unroute("**/api/render");
	const post = (body) =>
		context.request.post(`${origin}/api/render`, { data: body });
	const unapproved = await post(captured);
	assert.equal(unapproved.status(), 409);
	assert.match(
		(await unapproved.json()).error,
		/approve the current final cut/,
	);
	assert.equal(
		(
			await post({ inputProps: captured.inputProps, resolution: "480p" })
		).status(),
		400,
	);
	checks.push(
		"Actual UI supplies the current project; missing project and unapproved final cut cannot queue export",
	);
	const foreignProject = randomUUID();
	const foreign = await admin.from("projects").insert({
		id: foreignProject,
		user_id: outsider.id,
		name: "Private export fixture",
		script: "",
		store: {},
		generation: {},
	});
	if (foreign.error) throw foreign.error;
	assert.equal(
		(await post({ ...captured, projectId: foreignProject })).status(),
		409,
	);
	assert.ok(
		(await client.rpc("film_export_snapshot", { p_project_id: foreignProject }))
			.error,
	);
	checks.push(
		"Another account's saved film is inaccessible through export and the snapshot RPC",
	);
	await review("final_cut");
	const altered = structuredClone(generation);
	altered[voiceId].result.durationSec = 2.5;
	const audioChange = await admin
		.from("projects")
		.update({ generation: altered })
		.eq("id", projectId);
	if (audioChange.error) throw audioChange.error;
	const changedReview = await review("read");
	assert.equal(changedReview.videos, true);
	assert.equal(changedReview.finalCut, false);
	assert.equal((await post(captured)).status(), 409);
	await review("final_cut");
	const restore = await admin
		.from("projects")
		.update({ generation })
		.eq("id", projectId);
	if (restore.error) throw restore.error;
	assert.equal((await review("read")).finalCut, false);
	await review("final_cut");
	checks.push(
		"A changed selected audio take invalidates final approval even when video review remains current",
	);
	const tampered = structuredClone(captured);
	tampered.inputProps.totalFrames += 24;
	assert.equal((await post(tampered)).status(), 409);
	tampered.inputProps = structuredClone(captured.inputProps);
	tampered.inputProps.series[1].element.url =
		generation[imageId].result.imageUrl;
	assert.equal((await post(tampered)).status(), 409);
	checks.push(
		"Forged timing or a different selected take cannot replace the saved composition",
	);
	if (testRun) {
		const checkedRpc = async (name, args, connection = admin) => {
			const result = await connection.rpc(name, args);
			if (result.error) throw result.error;
			return result.data;
		};
		await checkedRpc(
			"set_film_autonomous_cap",
			{ p_project_id: projectId, p_cap_usd: 1 },
			client,
		);
		await checkedRpc(
			"control_film_run",
			{ p_project_id: projectId, p_action: "start", p_run_id: filmRunId },
			client,
		);
		const nodes = Object.entries(generation).map(([id, snapshot]) => ({
			id,
			elementType:
				snapshot.connectorType === "tts" ? "narration" : snapshot.connectorType,
			connectorType: snapshot.connectorType,
			model: { provider: "openslop", model: "Existing selected take" },
			inputs: {
				prompt: "Synthetic selected media fixture",
				attributes: {},
				reads: {},
			},
			dependsOn: {},
			action: "reuse",
			selectedTake: snapshot.result,
			pinned: true,
		}));
		await checkedRpc("install_film_run_plan", {
			p_run_id: filmRunId,
			p_generation: generation,
			p_plan: { version: 1, rootIds: nodes.map((node) => node.id), nodes },
		});
		const lease = await checkedRpc("film_run_lease", {
			p_run_id: filmRunId,
			p_action: "claim",
			p_lease_id: null,
		});
		await checkedRpc("stop_film_run_coordinator", {
			p_run_id: filmRunId,
			p_lease_id: lease.lease_id,
			p_reason: "final_review",
		});
		checks.push(
			"Disposable reused-media run waits for final export without any provider job",
		);
	}
	const queuedResponse = page.waitForResponse(
		(response) =>
			response.url() === `${origin}/api/render` &&
			response.request().method() === "POST",
	);
	await page
		.getByRole("button", { name: "Export", exact: true })
		.last()
		.click();
	const queued = await queuedResponse;
	assert.equal(queued.status(), 200, await queued.text());
	const handle = await queued.json();
	let duplicateExports = 0;
	context.on("request", (request) => {
		if (request.url() === `${origin}/api/render` && request.method() === "POST")
			duplicateExports++;
	});
	renderId = handle.renderId;
	assert.equal(handle.bucketName, "fylmer-local");
	const manifest = JSON.parse(
		await readFile(
			join(config.FYLMER_EXPORT_DIRECTORY, userId, renderId, "manifest.json"),
			"utf8",
		),
	);
	const approved = await client.rpc("film_export_snapshot", {
		p_project_id: projectId,
	});
	if (approved.error) throw approved.error;
	assert.deepEqual(manifest.source, {
		projectId,
		approvalHash: approved.data.approvalHash,
		...(testRun ? { runId: filmRunId } : {}),
	});
	assert.equal(manifest.inputProps.totalFrames, expectedDuration * 24);
	if (testGenerated) {
		assert.equal(manifest.mediaOrigin, origin);
		assert.equal(JSON.stringify(manifest).includes("token="), false);
		checks.push(
			"Queued canonical export contains no expiring generated-media tokens",
		);
	}
	assert.equal(
		manifest.inputProps.series[1].element.url,
		generation[videoId].result.videoUrl,
	);
	await page.screenshot({ path: `${output}/queued.png` });
	const measuredProgress = page.getByText(/^[1-9]\d?%$/, { exact: true });
	await expect(measuredProgress).toBeVisible({ timeout: 600000 });
	const progressLabel = await measuredProgress.textContent();
	await page.screenshot({ path: `${output}/measured-progress.png` });
	if (testCancellation) {
		const cancelResponse = page.waitForResponse(
			(response) =>
				response.url() === `${origin}/api/render/cancel` &&
				response.request().method() === "POST",
		);
		await page
			.getByRole("button", { name: "Cancel export", exact: true })
			.click();
		assert.equal((await cancelResponse).status(), 202);
		await expect(
			page.getByText(
				"Export cancelled. Your project is unchanged. You can export again.",
				{ exact: true },
			),
		).toBeVisible({ timeout: 60000 });
		const cancelledDirectory = join(
			config.FYLMER_EXPORT_DIRECTORY,
			userId,
			renderId,
		);
		await expect
			.poll(async () =>
				(await readdir(cancelledDirectory)).includes("processing.json"),
			)
			.toBe(false);
		assert.ok((await readdir(cancelledDirectory)).includes("cancelled.json"));
		await page.reload({ waitUntil: "networkidle" });
		await page
			.getByRole("button", { name: "Export", exact: true })
			.first()
			.click();
		await expect(
			page.getByText(
				"Export cancelled. Your project is unchanged. You can export again.",
				{ exact: true },
			),
		).toBeVisible({ timeout: 30000 });
		await page.screenshot({ path: `${output}/recovered-cancelled.png` });
		assert.equal(duplicateExports, 0);
		if (testRun) {
			const unfinished = await client.rpc("control_film_run", {
				p_project_id: projectId,
				p_action: "read",
				p_run_id: filmRunId,
			});
			if (unfinished.error) throw unfinished.error;
			assert.equal(unfinished.data.status, "paused");
			assert.equal(unfinished.data.coordinator_stop, "final_review");
			assert.equal(unfinished.data.completed_export_id, null);
			assert.equal(unfinished.data.completed_at, null);
			checks.push(
				"Cancelled export and refresh leave the associated film paused, never falsely completed",
			);
		}
		const retryResponse = page.waitForResponse(
			(response) =>
				response.url() === `${origin}/api/render` &&
				response.request().method() === "POST",
		);
		await page
			.getByRole("button", { name: "Export", exact: true })
			.last()
			.click();
		const retried = await retryResponse;
		assert.equal(retried.status(), 200, await retried.text());
		const retryHandle = await retried.json();
		assert.notEqual(retryHandle.renderId, renderId);
		renderId = retryHandle.renderId;
		if (testRun) {
			const retryManifest = JSON.parse(
				await readFile(
					join(
						config.FYLMER_EXPORT_DIRECTORY,
						userId,
						renderId,
						"manifest.json",
					),
					"utf8",
				),
			);
			assert.deepEqual(retryManifest.source, manifest.source);
		}
		await expect(measuredProgress).toBeVisible({ timeout: 600000 });
		checks.push(
			"Actual Cancel stops the CPU worker, releases queue capacity, survives refresh and permits one explicit retry",
		);
	}
	if (testClosed) {
		const beforeClose = await client.rpc("control_film_run", {
			p_project_id: projectId,
			p_action: "read",
			p_run_id: filmRunId,
		});
		if (beforeClose.error) throw beforeClose.error;
		assert.equal(beforeClose.data.status, "paused");
		await page.close();
		assert.equal(context.pages().length, 0);
		await expect
			.poll(
				async () => {
					const run = await client.rpc("control_film_run", {
						p_project_id: projectId,
						p_action: "read",
						p_run_id: filmRunId,
					});
					if (run.error) throw run.error;
					return run.data.status;
				},
				{ timeout: 600000, intervals: [1000, 2000] },
			)
			.toBe("completed");
		const directory = join(config.FYLMER_EXPORT_DIRECTORY, userId, renderId);
		await expect
			.poll(async () => (await readdir(directory)).includes("completion.json"))
			.toBe(true);
		assert.deepEqual(
			JSON.parse(await readFile(join(directory, "completion.json"), "utf8")),
			{ recorded: true },
		);
		checks.push(
			"Worker completes the run with every browser tab closed and no progress/download observer",
		);
		page = await context.newPage();
		await page.goto(`${origin}/projects/${projectId}`, {
			waitUntil: "networkidle",
		});
	} else await page.reload({ waitUntil: "networkidle" });
	await page
		.getByRole("button", { name: "Export", exact: true })
		.first()
		.click();
	await expect(
		page.getByText(
			"Recovered export from a saved snapshot. Later edits are not included.",
			{ exact: true },
		),
	).toBeVisible({ timeout: 30000 });
	await page.screenshot({ path: `${output}/recovered-active.png` });
	checks.push(
		`The existing export UI shows measured intermediate CPU progress (${progressLabel}) before completion`,
	);
	const exportDownload = page
		.locator('[data-slot="popover-content"]')
		.getByRole("link", { name: "Download", exact: true });
	await expect(exportDownload).toBeVisible({ timeout: 600000 });
	completed = true;
	const recordLink = page.getByRole("link", {
		name: "Download export record",
		exact: true,
	});
	await expect(recordLink).toBeVisible();
	const recordDownloadEvent = page.waitForEvent("download");
	await recordLink.click();
	const recordDownload = await recordDownloadEvent;
	assert.equal(await recordDownload.failure(), null);
	const recordPath = join(temporary, "export-record.json");
	await recordDownload.saveAs(recordPath);
	const record = JSON.parse(await readFile(recordPath, "utf8"));
	assert.equal(record.projectId, projectId);
	assert.equal(record.renderId, renderId);
	assert.equal(record.timeline.totalFrames, expectedDuration * 24);
	assert.equal(record.timeline.durationSec, expectedDuration);
	assert.ok(record.timeline.clips.length >= 3);
	assert.equal(record.music.length, 0);
	assert.ok(!JSON.stringify(record).includes("token="));
	assert.equal(
		(await fetch(`${origin}/api/render/record/${renderId}`)).status,
		401,
	);
	checks.push(
		"Actual record download preserves the exported timeline and project identity without media tokens; anonymous access is rejected",
	);
	await page.screenshot({ path: `${output}/completed.png` });
	await page.reload({ waitUntil: "networkidle" });
	await page
		.getByRole("button", { name: "Export", exact: true })
		.first()
		.click();
	await expect(exportDownload).toBeVisible({ timeout: 30000 });
	await expect(
		page.getByText(
			"Recovered export from a saved snapshot. Later edits are not included.",
			{ exact: true },
		),
	).toBeVisible();
	assert.equal(duplicateExports, testCancellation ? 1 : 0);
	await page.screenshot({ path: `${output}/recovered-completed.png` });
	checks.push(
		"Refresh during rendering and after completion restores the saved export without another enqueue",
	);
	const linkElement = exportDownload;
	const downloadUrl = await linkElement.getAttribute("href");
	const downloadEvent = page.waitForEvent("download");
	await linkElement.click();
	const download = await downloadEvent;
	assert.equal(await download.failure(), null);
	const exported = `${output}/approved-final-cut.mp4`;
	await download.saveAs(exported);
	if (testRun) {
		const finished = await client.rpc("control_film_run", {
			p_project_id: projectId,
			p_action: "read",
			p_run_id: filmRunId,
		});
		if (finished.error) throw finished.error;
		assert.equal(finished.data.status, "completed");
		assert.equal(finished.data.completed_export_id, renderId);
		assert.equal(
			finished.data.completed_approval_hash,
			manifest.source.approvalHash,
		);
		const jobs = await admin
			.from("jobs")
			.select("id")
			.eq("project_id", projectId);
		if (jobs.error) throw jobs.error;
		assert.deepEqual(jobs.data, []);
		checks.push(
			"Actual export progress and Download complete exactly the associated run with zero provider jobs",
		);
	}
	const anonymous = await fetch(`${origin}${downloadUrl}`);
	assert.notEqual(anonymous.status, 200);
	const bytes = await readFile(exported);
	const probe = JSON.parse(
		(
			await run("ffprobe", [
				"-v",
				"error",
				"-show_streams",
				"-show_format",
				"-of",
				"json",
				exported,
			])
		).stdout,
	);
	assert.ok(probe.streams.some((stream) => stream.codec_name === "h264"));
	assert.ok(probe.streams.some((stream) => stream.codec_name === "aac"));
	assert.ok(Math.abs(Number(probe.format.duration) - expectedDuration) < 0.1);
	const frame = await run(
		"ffmpeg",
		[
			"-nostdin",
			"-v",
			"error",
			"-ss",
			testCrossfade ? "6" : "2",
			"-i",
			exported,
			"-frames:v",
			"1",
			"-vf",
			"scale=1:1",
			"-pix_fmt",
			"rgb24",
			"-f",
			"rawvideo",
			"pipe:1",
		],
		{ encoding: "buffer" },
	);
	assert.ok(
		frame.stdout[0] > frame.stdout[2] + 100,
		"The exported second scene contains the selected red take",
	);
	const audio = await run("ffmpeg", [
		"-nostdin",
		"-i",
		exported,
		"-af",
		"volumedetect",
		"-vn",
		"-f",
		"null",
		"-",
	]);
	const peak = /max_volume: (-?[\d.]+) dB/.exec(audio.stderr);
	assert.ok(
		peak && Number(peak[1]) > -40,
		"The downloaded film has audible synthetic narration",
	);
	assert.equal(blocked.length, 0);
	if (testCrossfade) {
		const decoded = await run(
			"ffmpeg",
			[
				"-v",
				"error",
				"-i",
				exported,
				"-vn",
				"-ac",
				"1",
				"-ar",
				"16000",
				"-f",
				"f32le",
				"pipe:1",
			],
			{ encoding: "buffer", maxBuffer: 2 * 1024 * 1024 },
		);
		const amplitude = (start, frequency) => {
			let sine = 0;
			let cosine = 0;
			for (let sample = 0; sample < 1600; sample++) {
				const value = decoded.stdout.readFloatLE(
					(Math.round(start * 16000) + sample) * 4,
				);
				const angle = (2 * Math.PI * frequency * sample) / 16000;
				sine += value * Math.sin(angle);
				cosine += value * Math.cos(angle);
			}
			return Math.hypot(sine, cosine) / 1600;
		};
		const first = [amplitude(3.7, 440), amplitude(3.7, 880)];
		const second = [amplitude(4.3, 440), amplitude(4.3, 880)];
		assert.ok(first[0] > 0.01 && first[0] > first[1] * 20);
		assert.ok(second[1] > 0.01 && second[1] > second[0] * 20);
		await writeFile(
			`${output}/audio-separation.json`,
			JSON.stringify({ first, second }, null, 2),
		);
		checks.push(
			"Downloaded crossfade film keeps both audible synthetic lines separate at the scene boundary",
		);
		const transitionStart = captured.inputProps.series[1].start;
		const transitionEnd = captured.inputProps.sequences.narration[1].start;
		const sampleTimes = [
			transitionStart - 0.1,
			(transitionStart + transitionEnd) / 2,
			transitionEnd + 0.1,
		];
		const colors = [];
		for (const time of sampleTimes) {
			const sample = await run(
				"ffmpeg",
				[
					"-nostdin",
					"-v",
					"error",
					"-ss",
					String(time),
					"-i",
					exported,
					"-frames:v",
					"1",
					"-vf",
					"scale=1:1",
					"-pix_fmt",
					"rgb24",
					"-f",
					"rawvideo",
					"pipe:1",
				],
				{ encoding: "buffer" },
			);
			assert.equal(sample.stdout.length, 3);
			colors.push(Array.from(sample.stdout));
		}
		const [before, middle, after] = colors;
		assert.ok(
			before[2] > before[0] + 100,
			"The first scene remains blue before the fade",
		);
		assert.ok(
			middle[0] > 40 && middle[2] > 40 && middle[1] < 40,
			"The exported transition blends both scenes instead of cutting or fading to black",
		);
		assert.ok(
			after[0] > after[2] + 100,
			"The second scene is red after the fade",
		);
		await writeFile(
			`${output}/visual-transition.json`,
			JSON.stringify({ sampleTimes, colors }, null, 2),
		);
		checks.push(
			"Decoded export frames show blue, blended red/blue, then red across the actual crossfade",
		);
	}
	checks.push(
		`Actual Export and Download clicks produce a ${expectedDuration}-second H264/AAC film with the selected red take and audible synthetic narration`,
	);
	checks.push(
		"The retained export manifest identifies the approved project snapshot; anonymous download is rejected",
	);
	await writeFile(
		`${output}/results.json`,
		JSON.stringify(
			{
				checks,
				providerCalls: 0,
				syntheticOnly: true,
				projectId,
				renderId,
				duration: probe.format.duration,
				sha256: createHash("sha256").update(bytes).digest("hex"),
				size: bytes.length,
			},
			null,
			2,
		),
	);
	console.log(
		JSON.stringify({
			checks,
			providerCalls: 0,
			syntheticOnly: true,
			duration: probe.format.duration,
		}),
	);
} finally {
	await browser?.close();
	let active = false;
	if (renderId && !completed) {
		const files = await readdir(
			join(config.FYLMER_EXPORT_DIRECTORY, userId, renderId),
		);
		active =
			files.includes("pending.json") || files.includes("processing.json");
	}
	if (active) {
		console.error(
			"Synthetic fixtures retained because their CPU export is still active",
			{ userId, renderId },
		);
	} else {
		if (generatedPaths.length) {
			const removed = await admin.storage
				.from("fylmer-generated")
				.remove(generatedPaths);
			if (removed.error) throw removed.error;
		}
		if (storagePaths.length) {
			const removed = await admin.storage
				.from("fylmer-media")
				.remove(storagePaths);
			if (removed.error) throw removed.error;
		}
		for (const accountId of accounts) {
			const deleted = await admin.auth.admin.deleteUser(accountId);
			if (deleted.error) throw deleted.error;
		}
		if (userId)
			await rm(join(config.FYLMER_EXPORT_DIRECTORY, userId), {
				recursive: true,
				force: true,
			});
	}
	await rm(temporary, { recursive: true, force: true });
}
