import { createHash } from "node:crypto";

const excluded = new Set([
	"users",
	"sessions",
	"google_identities",
	"password_reset_requests",
	"chatgpt_connections",
	"chatgpt_oauth_attempts",
	"codex_connection",
	"oauth_attempts",
	"personal_text_models",
	"token_ledger",
	"app_settings",
]);

const targetTables = {
	storyboard_variant: "storyboard_variants",
	stitch_clip: "stitch_nodes",
	beat: "beats",
	sequence: "projects",
	library: "projects",
};

const quoted = (value) => `"${value.replaceAll('"', '""')}"`;

export function projectSnapshot(database, projectId) {
	const project = database
		.prepare("select * from projects where id = ?")
		.get(projectId);
	if (!project) throw new Error("Legacy project not found.");
	const tables = database
		.prepare(
			"select name from sqlite_master where type = 'table' and name not like 'sqlite_%'",
		)
		.all()
		.map(({ name }) => name)
		.filter((name) => !excluded.has(name));
	const columns = new Map(
		tables.map((name) => [
			name,
			database
				.prepare(`pragma table_info(${quoted(name)})`)
				.all()
				.map((column) => column.name),
		]),
	);
	const foreign = new Map(
		tables.map((name) => [
			name,
			database.prepare(`pragma foreign_key_list(${quoted(name)})`).all(),
		]),
	);
	const selected = new Map(tables.map((name) => [name, new Map()]));
	const rows = (table, condition = "", values = []) =>
		database
			.prepare(
				`select rowid as __rowid__, * from ${quoted(table)} ${condition}`,
			)
			.all(...values);
	const add = (table, row) => {
		if ("project_id" in row && row.project_id !== projectId) return false;
		const target = selected.get(table);
		if (target.has(row.__rowid__)) return false;
		const { __rowid__, ...content } = row;
		target.set(__rowid__, content);
		return true;
	};
	add("projects", rows("projects", "where id = ?", [projectId])[0]);
	for (const table of tables) {
		if (table === "projects" || !columns.get(table).includes("project_id"))
			continue;
		for (const row of rows(table, "where project_id = ?", [projectId]))
			add(table, row);
	}
	const known = (table, column) =>
		new Set(
			Array.from(
				selected.get(table)?.values() ?? [],
				(row) => row[column],
			).filter((value) => value !== null && value !== undefined),
		);
	let changed = true;
	while (changed) {
		changed = false;
		for (const table of tables) {
			for (const link of foreign.get(table)) {
				if (
					!selected.has(link.table) ||
					!columns.get(table).includes(link.from)
				)
					continue;
				const values = [...known(link.table, link.to)];
				if (!values.length) continue;
				for (const row of rows(
					table,
					`where ${quoted(link.from)} in (${values.map(() => "?").join(",")})`,
					values,
				))
					changed = add(table, row) || changed;
			}
		}
		if (selected.has("assets")) {
			const referenced = new Set();
			for (const [table, entries] of selected) {
				if (table === "assets") continue;
				for (const row of entries.values())
					for (const [key, value] of Object.entries(row))
						if (key.endsWith("asset_id") && typeof value === "string")
							referenced.add(value);
			}
			for (const row of rows("assets")) {
				const target = targetTables[row.target_kind];
				if (
					referenced.has(row.id) ||
					(row.node_id && known("nodes", "id").has(row.node_id)) ||
					(target && row.target_id && known(target, "id").has(row.target_id))
				)
					changed = add("assets", row) || changed;
			}
		}
	}
	const snapshot = Object.fromEntries(
		Array.from(selected, ([table, entries]) => [
			table,
			[...entries.values()],
		]).filter(([, entries]) => entries.length),
	);
	const canonical = JSON.stringify(snapshot);
	return {
		legacyProjectId: projectId,
		ownerId: project.owner_id,
		snapshot,
		sha256: createHash("sha256").update(canonical).digest("hex"),
		counts: Object.fromEntries(
			Object.entries(snapshot).map(([table, entries]) => [
				table,
				entries.length,
			]),
		),
	};
}
