import { DatabaseSync } from "node:sqlite";
import { projectSnapshot } from "./legacy-project-snapshot.mjs";

const [backupPath, livePath] = process.argv.slice(2);
if (!backupPath || !livePath) throw new Error("Provide the backup and live database paths.");
const backup = new DatabaseSync(backupPath, { readOnly: true });
const live = new DatabaseSync(livePath, { readOnly: true });
const ids = (database, table) => database.prepare(`select id from ${table} order by id`).all().map(({ id }) => id);
const backupProjects = ids(backup, "projects");
const liveProjects = ids(live, "projects");
const backupUsers = ids(backup, "users");
const liveUsers = ids(live, "users");
const changed = backupProjects.filter((id) => projectSnapshot(backup, id).sha256 !== projectSnapshot(live, id).sha256);
const stable = JSON.stringify(backupProjects) === JSON.stringify(liveProjects) && JSON.stringify(backupUsers) === JSON.stringify(liveUsers) && changed.length === 0;
console.log(JSON.stringify({ projects: backupProjects.length, users: backupUsers.length, changedProjects: changed.length, sameIds: backupProjects.length === liveProjects.length && backupUsers.length === liveUsers.length, stable }));
if (!stable) process.exitCode = 1;
