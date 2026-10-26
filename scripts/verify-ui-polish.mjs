import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "@playwright/test";

const config = parseEnv(await readFile(".env.local", "utf8"));
const backend = new URL(config.NEXT_PUBLIC_SUPABASE_URL);
assert.equal(
	backend.host,
	"127.0.0.1:55421",
	"Only isolated staging is allowed",
);
const origin = "http://127.0.0.1:3055";
const output = "artifacts/ui-polish";
await mkdir(output, { recursive: true });
const admin = createClient(
	config.NEXT_PUBLIC_SUPABASE_URL,
	config.SUPABASE_SECRET_KEY,
	{ auth: { persistSession: false } },
);
const email = `ui-polish-${randomUUID()}@example.invalid`;
const projectId = randomUUID();
const prompt = "A lighthouse above the quiet sea at dawn.";
const script = [
	"--- Scene 1 ---",
	`<narration id="${randomUUID()}">A signal arrives at dawn.</narration>`,
	`<image id="${randomUUID()}">${prompt}</image>`,
	"--- Scene 2 ---",
	`<narration id="${randomUUID()}">The keeper answers the call.</narration>`,
].join("\n");
let userId;
let browser;
const results = [];
const blockedGeneration = [];

async function assertCleanPointerState(locator) {
	const styles = await locator.evaluate((element) => {
		const style = getComputedStyle(element);
		return {
			outline: style.outlineStyle,
			shadow: style.boxShadow,
			focusVisible: element.matches(":focus-visible"),
		};
	});
	assert.equal(styles.outline, "none");
	assert.equal(styles.shadow, "none");
	assert.equal(styles.focusVisible, false);
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
		name: "UI polish validation",
		script,
		store: { title: "UI polish validation" },
		generation: {},
	});
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
	assert.ok(cookies.length > 0);
	browser = await chromium.launch({
		headless: true,
		executablePath:
			"/home/claudebot/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome",
	});
	for (const theme of ["light", "dark"]) {
		for (const width of [320, 390, 768, 1440]) {
			const context = await browser.newContext({
				viewport: { width, height: width === 768 ? 500 : 900 },
				hasTouch: width <= 390,
				colorScheme: theme,
			});
			await context.addCookies(
				cookies.map(({ name, value, options }) => ({
					name,
					value,
					url: origin,
					httpOnly: options?.httpOnly ?? false,
				})),
			);
			await context.route("**/api/**", async (route) => {
				const request = route.request();
				if (
					request.method() === "POST" &&
					/\/(v1|third-party|queues)\//.test(new URL(request.url()).pathname)
				) {
					blockedGeneration.push(new URL(request.url()).pathname);
					await route.abort();
					return;
				}
				await route.continue();
			});
			await context.addInitScript((theme) => {
				localStorage.setItem("theme", theme);
			}, theme);
			const page = await context.newPage();
			await page.goto(`${origin}/projects/${projectId}`);
			await page.locator("[data-scene-id]").first().waitFor();
			const rail = page.getByRole("navigation", { name: "Panels" });
			const bible = rail.getByRole("link", { name: "Story & Bible" });
			assert.match(
				await bible.locator(".icon").getAttribute("style"),
				/book-open-icon/,
			);
			assert.match(
				await rail
					.getByRole("button", { name: "Captions", exact: true })
					.locator(".icon")
					.getAttribute("style"),
				/text-box-icon/,
			);
			for (const label of ["Media", "Models", "Film Bible", "Chat"]) {
				const button = rail.getByRole("button", { name: label, exact: true });
				await button.click();
				await page
					.getByRole("heading", { name: label, exact: true, level: 2 })
					.waitFor();
				assert.equal(await button.getAttribute("aria-pressed"), "true");
				await assertCleanPointerState(button);
			}
			const chat = rail.getByRole("button", { name: "Chat", exact: true });
			const input = page.getByRole("textbox", {
				name: "Message Fylmer Assistant",
			});
			await input.click();
			const inputStyle = await input.evaluate((element) => ({
				outline: getComputedStyle(element).outlineStyle,
				shadow: getComputedStyle(element).boxShadow,
			}));
			assert.equal(inputStyle.outline, "none");
			assert.equal(inputStyle.shadow, "none");
			await chat.click();
			const row = page.locator('[data-scene-id] [class*="elementRow"]').first();
			const card = row.locator('[class*="group/card"]');
			if (width <= 390) {
				const actions = card
					.getByRole("button", { name: "Delete element" })
					.locator("..");
				const actionStyle = await actions.evaluate((element) => ({
					opacity: getComputedStyle(element).opacity,
					pointerEvents: getComputedStyle(element).pointerEvents,
				}));
				assert.equal(actionStyle.opacity, "1");
				assert.equal(actionStyle.pointerEvents, "auto");
			} else {
				await chat.focus();
				await page.keyboard.press("Shift+Tab");
				assert.ok(
					await page
						.locator(":focus")
						.evaluate((element) => element.matches(":focus-visible")),
				);
				assert.notEqual(
					await page
						.locator(":focus")
						.evaluate((element) => getComputedStyle(element).boxShadow),
					"none",
				);
				await card
					.getByRole("button", { name: "Settings", exact: true })
					.focus();
				await page.waitForFunction(() => {
					const action = document.querySelector(
						'[aria-label="Delete element"]',
					)?.parentElement;
					return action && getComputedStyle(action).opacity === "1";
				});
			}
			const layout = await page.evaluate(() => {
				const row = document.querySelector(
					'[data-scene-id] [class*="elementRow"]',
				);
				const card = row
					?.querySelector('[class*="group/card"]')
					?.getBoundingClientRect();
				const output = row
					?.querySelector('[class*="elementOutput"]')
					?.getBoundingClientRect();
				let viewport = row?.parentElement;
				while (viewport && getComputedStyle(viewport).overflowY !== "auto") {
					viewport = viewport.parentElement;
				}
				const breadcrumb = document
					.querySelector('nav[aria-label="Breadcrumb"]')
					?.getBoundingClientRect();
				const generate = document
					.querySelector('[data-slot="button"][aria-label^="Generate "]')
					?.getBoundingClientRect();
				return {
					overflow: document.documentElement.scrollWidth > innerWidth + 1,
					canvasViewportHeight: viewport?.clientHeight ?? 0,
					minimumCanvasHeight: Math.min(200, innerHeight * 0.3),
					toolbarOverlap: Boolean(
						breadcrumb?.width && generate && breadcrumb.right > generate.left,
					),
					rowWidth: row?.getBoundingClientRect().width ?? 0,
					cardWidth: card?.width ?? 0,
					stacked: Boolean(card && output && output.top >= card.bottom),
					cta: getComputedStyle(document.documentElement)
						.getPropertyValue("--generate")
						.trim(),
				};
			});
			await page.screenshot({ path: `${output}/${theme}-${width}.png` });
			assert.equal(layout.overflow, false);
			assert.equal(layout.toolbarOverlap, false, JSON.stringify(layout));
			assert.ok(
				layout.canvasViewportHeight >= layout.minimumCanvasHeight,
				JSON.stringify(layout),
			);
			assert.ok(
				layout.cardWidth >=
					(layout.stacked ? layout.rowWidth - 1 : layout.rowWidth * 0.35),
				JSON.stringify(layout),
			);
			if (width <= 390) assert.equal(layout.stacked, true);
			const scenes = await page
				.locator("[data-scene-id]")
				.evaluateAll((elements) =>
					elements.map((element) => ({
						outline: getComputedStyle(element).outlineStyle,
						shadow: getComputedStyle(element).boxShadow,
						border: getComputedStyle(element).borderTopWidth,
					})),
				);
			for (const scene of scenes) {
				assert.equal(scene.outline, "none");
				assert.equal(scene.shadow, "none");
				assert.equal(scene.border, "0px");
			}
			const hidePanel = page.getByRole("radio", { name: "Hide bottom panel" });
			assert.ok(
				await hidePanel.evaluate((element) => {
					const bounds = element.getBoundingClientRect();
					const hit = document.elementFromPoint(
						bounds.left + bounds.width / 2,
						bounds.top + bounds.height / 2,
					);
					return (
						bounds.right <= innerWidth &&
						bounds.bottom <= innerHeight &&
						hit !== null &&
						element.contains(hit)
					);
				}),
				"Playback view controls must be visible and clickable",
			);
			await page
				.getByRole("heading", { name: "UI polish validation", exact: true })
				.click();
			const titleStyle = await page
				.getByRole("textbox", { name: "Project title" })
				.evaluate((element) => ({
					outline: getComputedStyle(element).outlineStyle,
					shadow: getComputedStyle(element).boxShadow,
					background: getComputedStyle(element).backgroundColor,
				}));
			assert.equal(titleStyle.outline, "none");
			assert.equal(titleStyle.shadow, "none");
			assert.notEqual(titleStyle.background, "rgba(0, 0, 0, 0)");
			await page.screenshot({ path: `${output}/${theme}-${width}.png` });
			results.push({ theme, width, ...layout });
			console.log(`${theme} ${width}px: passed`);
			await context.close();
		}
	}
	assert.deepEqual(
		blockedGeneration,
		[],
		"UI polish must not invoke generation",
	);
	await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
} finally {
	await browser?.close();
	const { error } = await admin.from("projects").delete().eq("id", projectId);
	if (error) throw error;
	if (userId) {
		const { error } = await admin.auth.admin.deleteUser(userId);
		if (error) throw error;
	}
}
