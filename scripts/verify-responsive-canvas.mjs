import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "playwright";

const config = Object.fromEntries(
	(await readFile(".env.local", "utf8"))
		.trim()
		.split("\n")
		.map((line) => {
			const separator = line.indexOf("=");
			return [line.slice(0, separator), line.slice(separator + 1)];
		}),
);
const admin = createClient(
	config.NEXT_PUBLIC_SUPABASE_URL,
	config.SUPABASE_SECRET_KEY,
	{ auth: { persistSession: false } },
);
const email = `layout-check-${randomUUID()}@example.invalid`;
const projectId = randomUUID();
const composerId = randomUUID();
const promptId = randomUUID();
const origin = "http://127.0.0.1:3055";
const script = [
	"--- Scene 1 ---",
	`<narration id="${randomUUID()}">A short story opens beside the sea.</narration>`,
	`<image id="${randomUUID()}">A lighthouse at dawn.</image>`,
].join("\n");

let userId;
let browser;
try {
	const { data: created, error: userError } =
		await admin.auth.admin.createUser({
			email,
			email_confirm: true,
			app_metadata: { api_access: true },
		});
	if (userError || !created.user) throw userError ?? new Error("No test user");
	userId = created.user.id;
	const { error: projectError } = await admin.from("projects").insert([
		{
			id: projectId,
			user_id: userId,
			name: "Responsive layout check",
			script,
			store: { title: "Responsive layout check" },
			generation: {},
		},
		{
			id: composerId,
			user_id: userId,
			name: "Smart composer check",
			script: "",
			store: { title: "Smart composer check" },
			generation: {},
		},
		{
			id: promptId,
			user_id: userId,
			name: "Enter key check",
			script: "",
			store: { title: "Enter key check" },
			generation: {},
		},
	]);
	if (projectError) throw projectError;
	const { data: link, error: linkError } =
		await admin.auth.admin.generateLink({
			type: "magiclink",
			email,
			options: { redirectTo: `${origin}/auth/callback` },
		});
	if (linkError) throw linkError;
	const authCookies = [];
	const session = createServerClient(
		config.NEXT_PUBLIC_SUPABASE_URL,
		config.NEXT_PUBLIC_SUPABASE_ANON_KEY,
		{
			cookies: {
				getAll: () => [],
				setAll: (cookies) => authCookies.push(...cookies),
			},
		},
	);
	const { error: verifyError } = await session.auth.verifyOtp({
		token_hash: link.properties.hashed_token,
		type: "magiclink",
	});
	if (verifyError || authCookies.length === 0)
		throw verifyError ?? new Error("Synthetic session had no cookies");

	browser = await chromium.launch({
		headless: true,
		executablePath:
			"/home/claudebot/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome",
	});
	const context = await browser.newContext();
	await context.addCookies(
		authCookies.map(({ name, value, options }) => ({
			name,
			value,
			url: origin,
			httpOnly: options?.httpOnly ?? false,
		})),
	);
	const page = await context.newPage();
	await page.goto(origin);
	await page.getByRole("link", { name: "Open Responsive layout check" }).hover();
	await page.screenshot({ path: "/tmp/fylmer-project-card-hover.png" });
	await page.goto(`${origin}/projects/${composerId}`);
	await page.getByRole("textbox", { name: "Enter your prompt" }).fill("Make a 30-second short narrated in Hindi");
	await page.getByRole("button", { name: "Aspect ratio: 9:16" }).waitFor();
	await page.getByRole("button", { name: "Language: Hindi" }).waitFor();
	await page.getByRole("button", { name: "Video length: Under 30 sec" }).waitFor();
	console.log("Composer: short selected 9:16, Hindi, and Under 30 sec");
	await page.getByText("Paste a script", { exact: true }).click();
	await page.waitForTimeout(350);
	await page.screenshot({ path: "/tmp/fylmer-segmented-script.png" });
	const scriptInput = page.getByRole("textbox", { name: "Paste your script" });
	await scriptInput.fill("NARRATOR\nA lighthouse shines at dawn.");
	await scriptInput.press("Enter");
	if ((await scriptInput.inputValue()) !== "NARRATOR\nA lighthouse shines at dawn.\n")
		throw new Error("Enter should insert a newline in script mode");
	await page.getByRole("button", { name: "Submit" }).click();
	await Promise.race([
		page.locator("[data-scene-id]").first().waitFor({ timeout: 150000 }),
		page.locator('p[role="alert"]:not(:empty)').first().waitFor({ timeout: 150000 }).then(async () => {
			throw new Error(`Script import failed: ${await page.locator('p[role="alert"]:not(:empty)').first().textContent()}`);
		}),
	]);
	console.log("Composer: pasted script imported into the canvas");
	await page.goto(`${origin}/projects/${promptId}`);
	const promptInput = page.getByRole("textbox", { name: "Enter your prompt" });
	await promptInput.fill("A lighthouse at dawn");
	await promptInput.press("Enter");
	await page.getByRole("button", { name: "Chat", exact: true }).waitFor();
	console.log("Composer: script Enter inserts a newline; story Enter opens the workspace");
	await page.goto(`${origin}/projects/${projectId}`);
	try {
		await page.locator("[data-scene-id]").first().waitFor({ timeout: 10000 });
	} catch {
		throw new Error(`Scene did not render at ${new URL(page.url()).pathname}: ${JSON.stringify(await page.locator("h1").allTextContents())}`);
	}
	await page.getByRole("button", { name: "Chat", exact: true }).click();
	const chatInput = page.getByRole("textbox", { name: "Message Fylmer Assistant" });
	await chatInput.fill("Check chat Enter submission");
	await chatInput.press("Enter");
	await page.getByText("Check chat Enter submission", { exact: true }).waitFor();
	console.log("Workspace chat: Enter sends the message");

	for (const width of [390, 768, 1280, 1920]) {
		await page.setViewportSize({ width, height: 900 });
		const layout = await page.evaluate(() => {
			const row = document.querySelector('[data-scene-id] [class*="elementRow"]');
			const card = row?.querySelector('[class*="group/card"]');
			const output = row?.querySelector('[class*="elementOutput"]');
			const cardBounds = card?.getBoundingClientRect();
			const outputBounds = output?.getBoundingClientRect();
			return {
				cardWidth: cardBounds?.width ?? 0,
				stacked: Boolean(cardBounds && outputBounds && outputBounds.top >= cardBounds.bottom),
				horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
			};
		});
		if (layout.horizontalOverflow || layout.cardWidth < 200 || (width === 390 && !layout.stacked))
			throw new Error(`Responsive layout failed at ${width}px: ${JSON.stringify(layout)}`);
		if (width === 390) await page.getByRole("button", { name: "Chat", exact: true }).click();
		await page.screenshot({ path: `/tmp/fylmer-canvas-${width}.png` });
		if (width === 390) await page.getByRole("button", { name: "Chat", exact: true }).click();
		console.log(`${width}px: ${JSON.stringify(layout)}`);
	}
} finally {
	await browser?.close();
	await admin.from("projects").delete().eq("id", projectId);
	await admin.from("projects").delete().eq("id", composerId);
	await admin.from("projects").delete().eq("id", promptId);
	if (userId) await admin.auth.admin.deleteUser(userId);
}
