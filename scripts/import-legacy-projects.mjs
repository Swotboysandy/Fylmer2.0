import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { projectSnapshot } from "./legacy-project-snapshot.mjs";
import { convertLegacyProject } from "./legacy-project-convert.mjs";

const source = process.env.FYLMER_LEGACY_SOURCE_DB;
if (!source)
	throw new Error("Set FYLMER_LEGACY_SOURCE_DB to a read-only SQLite backup.");
const database = new DatabaseSync(source, { readOnly: true });
const users = database
	.prepare("select id,email,name,disabled from users order by id")
	.all();
const projectIds = database
	.prepare("select id from projects order by id")
	.all()
	.map(({ id }) => id);
const archives = projectIds.map((id) => projectSnapshot(database, id));
const total = (table) =>
	archives.reduce((count, archive) => count + (archive.counts[table] ?? 0), 0);
const dryRun = {
	users: users.length,
	projects: archives.length,
	characters: total("characters"),
	locations: total("locations"),
	linkedAssets: total("assets"),
	filmRuns: total("film_runs"),
	chatExchanges: total("film_chat_exchanges"),
};

if (!process.argv.includes("--apply")) {
	console.log(JSON.stringify({ mode: "dry-run", ...dryRun }));
	process.exit(0);
}
if (process.env.FYLMER_LEGACY_IMPORT_ENABLED !== "1")
	throw new Error("The legacy importer is disabled.");
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
const existing = await admin.auth.admin.listUsers({ perPage: 1000 });
if (existing.error) throw existing.error;
const knownUsers = new Map(
	existing.data.users.map((user) => [user.email?.toLowerCase(), user]),
);
const userIds = new Map();
for (const legacy of users) {
	const { data: mapped, error: mappingError } = await admin
		.from("legacy_identity_map")
		.select("user_id")
		.eq("legacy_user_id", legacy.id)
		.maybeSingle();
	if (mappingError) throw mappingError;
	if (mapped) {
		const candidate = knownUsers.get(legacy.email.toLowerCase());
		if (candidate?.id !== mapped.user_id)
			throw new Error("An imported account mapping changed.");
		userIds.set(legacy.id, mapped.user_id);
		continue;
	}
	let account = knownUsers.get(legacy.email.toLowerCase());
	if (account && account.app_metadata?.legacy_user_id !== legacy.id)
		throw new Error(
			"An unmapped account already uses an imported email; stop for manual identity review.",
		);
	if (!account) {
		const created = await admin.auth.admin.createUser({
			email: legacy.email,
			password: randomBytes(32).toString("base64url"),
			email_confirm: false,
			app_metadata: { legacy_user_id: legacy.id },
			user_metadata: { full_name: legacy.name },
		});
		if (created.error || !created.data.user)
			throw (
				created.error ?? new Error("Could not prepare an imported account.")
			);
		account = created.data.user;
		knownUsers.set(legacy.email.toLowerCase(), account);
	}
	const mappedNow = await admin
		.from("legacy_identity_map")
		.insert({ legacy_user_id: legacy.id, user_id: account.id });
	if (mappedNow.error) throw mappedNow.error;
	userIds.set(legacy.id, account.id);
}
for (const archive of archives) {
	const userId = userIds.get(archive.ownerId);
	if (!userId) throw new Error("An imported project has no mapped owner.");
	const converted = convertLegacyProject(archive);
	const existingProject = await admin
		.from("projects")
		.select("id,user_id,thumbnail_url")
		.eq("id", converted.id)
		.maybeSingle();
	if (existingProject.error) throw existingProject.error;
	if (existingProject.data && existingProject.data.user_id !== userId)
		throw new Error("An imported project changed owners.");
	if (!existingProject.data) {
		const inserted = await admin
			.from("projects")
			.insert({ ...converted, user_id: userId });
		if (inserted.error) throw inserted.error;
	} else if (!existingProject.data.thumbnail_url && converted.thumbnail_url) {
		const updated = await admin
			.from("projects")
			.update({ thumbnail_url: converted.thumbnail_url })
			.eq("id", converted.id)
			.is("thumbnail_url", null);
		if (updated.error) throw updated.error;
	}
	const existingArchive = await admin
		.from("legacy_project_archives")
		.select("source_sha256")
		.eq("project_id", converted.id)
		.maybeSingle();
	if (existingArchive.error) throw existingArchive.error;
	if (
		existingArchive.data &&
		existingArchive.data.source_sha256 !== archive.sha256
	)
		throw new Error(
			"An imported archive differs from the source backup; stop for manual review.",
		);
	if (!existingArchive.data) {
		const inserted = await admin.from("legacy_project_archives").insert({
			project_id: converted.id,
			legacy_project_id: archive.legacyProjectId,
			snapshot: archive.snapshot,
			source_sha256: archive.sha256,
		});
		if (inserted.error) throw inserted.error;
	}
	const urls = new Set(
		(archive.snapshot.assets ?? [])
			.map((asset) => asset.url)
			.filter(
				(url) =>
					typeof url === "string" &&
					/^\/(?:oss|direkta|quiet-star|maurya)\/[A-Za-z0-9._/-]+$/.test(url) &&
					!url.includes(".."),
			),
	);
	const media = [...urls].map((url) => ({
		project_id: converted.id,
		user_id: userId,
		url,
	}));
	if (media.length) {
		const { error: mediaError } = await admin
			.from("legacy_media_links")
			.upsert(media, { onConflict: "project_id,url" });
		if (mediaError) throw mediaError;
	}
}
console.log(JSON.stringify({ mode: "applied", ...dryRun }));
