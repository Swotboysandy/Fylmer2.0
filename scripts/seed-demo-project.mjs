import { stat } from "node:fs/promises";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const name = "Demo — The Last Signal";
const imageBase = "/demo/last-signal";
const images = {
	mira: `${imageBase}/mira.png`,
	first: `${imageBase}/scene-1.png`,
	second: `${imageBase}/scene-2.png`,
};

const escapeXml = (value) =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll('"', "&quot;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");

const element = (type, id, text, attributes = {}) => {
	const props = Object.entries({ id, ...attributes })
		.map(([key, value]) => ` ${key}="${escapeXml(String(value))}"`)
		.join("");
	return `<${type}${props}>${escapeXml(text)}</${type}>`;
};

const script = [
	element(
		"asset_style",
		"demo-style",
		"Grounded coastal mystery. Storm-blue shadows, practical amber light, patient camera movement, natural faces, and a hopeful dawn.",
	),
	element(
		"asset_avatar",
		"demo-mira-avatar",
		"Mira, a South Asian radio archivist in her early thirties, has short wavy dark hair, a charcoal work jacket, and a watchful expression. Keep this look consistent in every scene.",
		{ name: "Mira" },
	),
	"--- Scene 1 ---",
	element(
		"narration",
		"demo-scene-1-narration",
		"On the night the coastal transmitter was due to close, Mira heard a call that had not been sent yet.",
	),
	element(
		"image",
		"demo-scene-1-image",
		"Mira at the analog transmitter in a rain-dark signal station. A red warning lamp glows. The lighthouse stands beyond the windows.",
		{ duration: "8" },
	),
	element(
		"character",
		"demo-scene-1-dialogue",
		"That is my voice. It is asking me to keep the channel open.",
		{ name: "Mira" },
	),
	element(
		"video",
		"demo-scene-1-video",
		"Slow push toward Mira as she turns the receiver dial. Rain lashes the windows; the distant lighthouse beam sweeps across her face. Preserve her identity and the station layout.",
		{ duration: "8", trimToDialogue: "false" },
	),
	"--- Scene 2 ---",
	element(
		"narration",
		"demo-scene-2-narration",
		"At dawn, the signal became a path of lights on the water. Mira chose to send it to everyone.",
	),
	element(
		"image",
		"demo-scene-2-image",
		"Mira on the rocky shore below the lighthouse, holding a portable tape recorder. A line of warm lights appears along the cold horizon.",
		{ duration: "8" },
	),
	element(
		"character",
		"demo-scene-2-dialogue",
		"If someone is out there, they deserve to be found.",
		{ name: "Mira" },
	),
	element(
		"video",
		"demo-scene-2-video",
		"Wide lateral move along the shore, ending on Mira and the lights offshore. Blue dawn, sea spray, restrained hope. Match her face, jacket, and lighthouse geography.",
		{ duration: "8", trimToDialogue: "false" },
	),
].join("\n");

const pinnedImage = (imageUrl) => ({
	status: "idle",
	startedAt: null,
	result: { imageUrl, durationSec: 8 },
	error: null,
	resultInputs: null,
	connectorType: "image",
	pinned: true,
});

const generation = {
	"demo-mira-avatar": pinnedImage(images.mira),
	"demo-scene-1-image": pinnedImage(images.first),
	"demo-scene-2-image": pinnedImage(images.second),
};

for (const imageUrl of Object.values(images)) {
	const file = join(process.cwd(), "public", imageUrl.slice(1));
	if ((await stat(file)).size < 100_000)
		throw new Error(`Demo image is missing or incomplete: ${file}`);
}

if (process.argv[2] === "--check") {
	console.log(
		`${name}: 2 scenes, 1 character, 3 images, 2 unrendered video prompts; no GPU jobs.`,
	);
	process.exit(0);
}
if (process.argv[2] !== "--apply") throw new Error("Use --check or --apply.");

const userId = process.env.FYLMER_CODEX_SUNNY_USER_ID;
if (
	!userId ||
	!process.env.SUPABASE_SECRET_KEY ||
	!process.env.NEXT_PUBLIC_SUPABASE_URL
)
	throw new Error(
		"Production account and Supabase service configuration are required.",
	);

const supabase = createClient(
	process.env.NEXT_PUBLIC_SUPABASE_URL,
	process.env.SUPABASE_SECRET_KEY,
	{
		auth: { persistSession: false },
	},
);
const { data: account, error: accountError } =
	await supabase.auth.admin.getUserById(userId);
if (accountError) throw accountError;
if (
	account.user?.email?.toLowerCase() !== "sunny.draftss@gmail.com" ||
	!account.user.email_confirmed_at
)
	throw new Error(
		"Sunny's confirmed account did not match; no project was created.",
	);

const { data: existing, error: existingError } = await supabase
	.from("projects")
	.select("id")
	.eq("user_id", userId)
	.eq("name", name)
	.limit(2);
if (existingError) throw existingError;
if (existing.length) {
	console.log(`Demo already exists: /projects/${existing[0].id}`);
	process.exit(0);
}

const { data: project, error: insertError } = await supabase
	.from("projects")
	.insert({
		user_id: userId,
		name,
		thumbnail_url: images.first,
		script,
		store: { title: name },
		generation,
	})
	.select("id")
	.single();
if (insertError) throw insertError;
console.log(`Created ${name}: /projects/${project.id}`);
