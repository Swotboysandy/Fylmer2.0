import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { projectSnapshot } from "./legacy-project-snapshot.mjs";

const [sourcePath, ossRoot, generatedRoot, demoRoot] = process.argv.slice(2);
if (!sourcePath || !ossRoot || !generatedRoot || !demoRoot)
	throw new Error("Provide the backup database and three media roots.");
const source = new DatabaseSync(sourcePath, { readOnly: true });
const ids = source
	.prepare("select id from projects order by id")
	.all()
	.map(({ id }) => id);
const urls = ids.flatMap((id) =>
	(projectSnapshot(source, id).snapshot.assets ?? []).map((asset) => asset.url),
);
const pathFor = (url) => {
	if (
		typeof url !== "string" ||
		!/^\/(?:oss|direkta|quiet-star|maurya)\/[A-Za-z0-9._/-]+$/.test(url) ||
		url.includes("..")
	)
		return null;
	if (url.startsWith("/oss/")) return join(ossRoot, url.slice(5));
	if (url.startsWith("/direkta/generated/"))
		return join(generatedRoot, url.slice(19));
	if (
		url.startsWith("/quiet-star/generated/") ||
		url.startsWith("/maurya/generated/")
	)
		return join(demoRoot, url.slice(1));
	return null;
};
const missing = urls.filter(
	(url) => !pathFor(url) || !existsSync(pathFor(url)),
);
console.log(
	JSON.stringify({
		linkedAssetRows: urls.length,
		existing: urls.length - missing.length,
		missing: missing.length,
		unsupportedRoots: missing.filter((url) => !pathFor(url)).length,
	}),
);
if (missing.length) console.error(JSON.stringify({ missingUrls: missing }));
if (missing.length) process.exitCode = 1;
