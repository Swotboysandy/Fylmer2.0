import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "@playwright/test";

const config = parseEnv(await readFile(".env.local", "utf8"));
assert.equal(new URL(config.NEXT_PUBLIC_SUPABASE_URL).host, "127.0.0.1:55421");
assert.equal(config.FYLMER_STAGING_GENERATION_ENABLED, "0");
const baseline = process.argv.includes("--baseline");
const origin = "http://127.0.0.1:3055";
const output = `artifacts/ui-details/${baseline ? "before" : "after"}`;
await mkdir(output, { recursive: true });
const admin = createClient(
	config.NEXT_PUBLIC_SUPABASE_URL,
	config.SUPABASE_SECRET_KEY,
	{
		auth: { persistSession: false },
	},
);
const email = `ui-details-${randomUUID()}@example.invalid`;
const entryProject = randomUUID();
const editorProject = randomUUID();
const results = [];
const blockedRequests = [];
let userId;
let browser;

async function appearance(locator) {
	return locator.evaluate((element) => {
		const style = getComputedStyle(element);
		const bounds = element.getBoundingClientRect();
		return {
			border: style.borderTopColor,
			borderWidth: style.borderTopWidth,
			shadow: style.boxShadow,
			outline: style.outlineStyle,
			background: style.backgroundColor,
			focusVisible: element.matches(":focus-visible"),
			width: bounds.width,
			height: bounds.height,
		};
	});
}

async function verifyIcons(page) {
	const icons = await page.locator(".icon:visible").evaluateAll((elements) =>
		elements.map((element) => {
			const style = getComputedStyle(element);
			const bounds = element.getBoundingClientRect();
			return {
				mask: style.maskImage,
				width: bounds.width,
				height: bounds.height,
				hidden: element.getAttribute("aria-hidden"),
			};
		}),
	);
	assert.ok(icons.length > 5);
	for (const icon of icons) {
		assert.match(icon.mask, /url\(/);
		assert.ok(icon.width >= 10 && icon.width <= 48, JSON.stringify(icon));
		assert.ok(Math.abs(icon.width - icon.height) < 1, JSON.stringify(icon));
		assert.equal(icon.hidden, "true");
	}
	return icons.length;
}

try {
	const { data, error } = await admin.auth.admin.createUser({
		email,
		email_confirm: true,
		app_metadata: { api_access: true },
	});
	if (error || !data.user)
		throw error ?? new Error("Synthetic account missing");
	userId = data.user.id;
	const { error: projectError } = await admin.from("projects").insert([
		{
			id: entryProject,
			user_id: userId,
			name: "UI details entry",
			script: "",
			store: {},
			generation: {},
		},
		{
			id: editorProject,
			user_id: userId,
			name: "UI details editor",
			script: `--- Scene 1 ---\n<narration id="${randomUUID()}">The keeper answers the call.</narration>`,
			store: { title: "UI details editor" },
			generation: {},
		},
	]);
	if (projectError) throw projectError;
	const { data: link, error: linkError } = await admin.auth.admin.generateLink({
		type: "magiclink",
		email,
	});
	if (linkError) throw linkError;
	const cookies = [];
	const session = createServerClient(
		config.NEXT_PUBLIC_SUPABASE_URL,
		config.NEXT_PUBLIC_SUPABASE_ANON_KEY,
		{
			cookies: {
				getAll: () => [],
				setAll: (values) => cookies.push(...values),
			},
		},
	);
	const { error: authError } = await session.auth.verifyOtp({
		token_hash: link.properties.hashed_token,
		type: "magiclink",
	});
	if (authError) throw authError;
	browser = await chromium.launch({
		headless: true,
		executablePath:
			"/home/claudebot/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome",
	});
	for (const theme of ["light", "dark"]) {
		for (const width of [320, 390, 768, 1440]) {
			const context = await browser.newContext({
				viewport: { width, height: width === 768 ? 500 : 900 },
				colorScheme: theme,
				reducedMotion: "reduce",
			});
			await context.addCookies(
				cookies.map(({ name, value, options }) => ({
					name,
					value,
					url: origin,
					httpOnly: options?.httpOnly ?? false,
				})),
			);
			await context.addInitScript(
				(theme) => localStorage.setItem("theme", theme),
				theme,
			);
			await context.route("**/api/**", async (route) => {
				const request = route.request();
				const path = new URL(request.url()).pathname;
				if (
					request.method() === "POST" &&
					/\/(v1|third-party|queues|render|agent)\b/.test(path)
				) {
					blockedRequests.push(path);
					await route.abort();
					return;
				}
				await route.continue();
			});
			const page = await context.newPage();
			page.setDefaultTimeout(20_000);
			await page.goto(`${origin}/projects/${entryProject}`);
			const prompt = page.getByRole("textbox", { name: "Enter your prompt" });
			await prompt.waitFor();
			const composer = page
				.locator("div.rounded-xl.border")
				.filter({ has: prompt })
				.last();
			const idleComposer = await appearance(composer);
			await prompt.click();
			await prompt.fill("A short film about a lighthouse keeper");
			const editingComposer = await appearance(composer);
			const template = page
				.getByRole("button")
				.filter({ has: page.locator("img") })
				.first();
			await page
				.getByRole("heading", { name: "Describe your film", exact: true })
				.click();
			const idleTemplate = await appearance(template);
			await template.hover();
			await page
				.locator("button img")
				.evaluateAll((images) =>
					Promise.all(images.map((image) => image.decode())),
				);
			const hoveredTemplate = await appearance(template);
			await page.screenshot({
				path: `${output}/${theme}-${width}-entry.png`,
				fullPage: true,
			});
			const entryIcons = await verifyIcons(page);
			if (!baseline) {
				assert.equal(
					idleComposer.border,
					idleTemplate.border,
					"Composer should use the same neutral border as cards",
				);
				assert.equal(editingComposer.border, idleComposer.border);
				assert.equal(editingComposer.shadow, "none");
				assert.equal(hoveredTemplate.border, idleTemplate.border);
				assert.equal(hoveredTemplate.shadow, "none");
				assert.equal(hoveredTemplate.outline, "none");
				assert.notEqual(hoveredTemplate.background, idleTemplate.background);
				await template.focus();
				await page.keyboard.press("Shift+Tab");
				await page.keyboard.press("Tab");
				const keyboardTemplate = await appearance(template);
				assert.equal(keyboardTemplate.focusVisible, true);
				assert.notEqual(keyboardTemplate.shadow, "none");
			}
			assert.equal(
				await page.evaluate(
					() => document.documentElement.scrollWidth > innerWidth + 1,
				),
				false,
			);
			await page.goto(`${origin}/projects/${editorProject}`);
			const rail = page.getByRole("navigation", { name: "Panels" });
			const captions = rail.getByRole("button", {
				name: "Captions",
				exact: true,
			});
			await captions.waitFor();
			await captions.hover();
			if (!baseline) {
				await page
					.getByRole("tooltip", { name: "Captions", exact: true })
					.waitFor();
			}
			await captions.click();
			const show = page.getByRole("radio", {
				name: "Show captions",
				exact: true,
			});
			if ((await show.getAttribute("aria-checked")) !== "true")
				await show.click();
			const numeric = page.getByRole("spinbutton", {
				name: "Text size",
				exact: true,
			});
			const originalValue = await numeric.getAttribute("aria-valuenow");
			await numeric.click();
			const input = page.getByRole("textbox", {
				name: "Text size",
				exact: true,
			});
			await input.waitFor();
			const editingNumeric = await appearance(input.locator(".."));
			if (!baseline) {
				assert.equal(editingNumeric.shadow, "none");
				assert.equal(editingNumeric.outline, "none");
				assert.notEqual(editingNumeric.background, "rgba(0, 0, 0, 0)");
			}
			await page.screenshot({
				path: `${output}/${theme}-${width}-captions.png`,
			});
			await input.press("Escape");
			assert.equal(await numeric.getAttribute("aria-valuenow"), originalValue);
			await numeric.focus();
			await numeric.press("Enter");
			await input.fill("48");
			await input.press("Enter");
			assert.equal(await numeric.getAttribute("aria-valuenow"), "48");
			const editorIcons = await verifyIcons(page);
			const pointerState = await appearance(captions);
			assert.equal(pointerState.shadow, "none");
			assert.equal(pointerState.outline, "none");
			await captions.click();
			await captions.focus();
			await page.keyboard.press("Tab");
			await page.keyboard.press("Shift+Tab");
			const keyboardState = await appearance(captions);
			assert.equal(keyboardState.focusVisible, true);
			assert.notEqual(keyboardState.shadow, "none");
			assert.equal(
				await page.evaluate(
					() => document.documentElement.scrollWidth > innerWidth + 1,
				),
				false,
			);
			results.push({
				theme,
				width,
				idleComposer,
				editingComposer,
				idleTemplate,
				hoveredTemplate,
				editingNumeric,
				entryIcons,
				editorIcons,
			});
			console.log(`${theme} ${width}px: ${baseline ? "captured" : "passed"}`);
			await context.close();
		}
	}
	assert.deepEqual(blockedRequests, []);
	await writeFile(
		`${output}/results.json`,
		JSON.stringify({ baseline, cases: results, providerCalls: 0 }, null, 2),
	);
} finally {
	await browser?.close();
	if (userId) {
		const { error } = await admin.auth.admin.deleteUser(userId);
		if (error) throw error;
	}
}
