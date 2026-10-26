import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { recoverLocalExport } from "../export-recovery";

const userId = randomUUID();
const projectId = randomUUID();
let root: string;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "fylmer-recovery-"));
	vi.stubEnv("FYLMER_EXPORT_DIRECTORY", root);
});
afterEach(async () => {
	vi.unstubAllEnvs();
	await rm(root, { recursive: true, force: true });
});
async function fixture(
	state: string,
	createdAt: string,
	owner = userId,
	project = projectId,
) {
	const renderId = randomUUID();
	const directory = join(root, owner, renderId);
	await mkdir(directory, { recursive: true });
	await writeFile(
		join(directory, "manifest.json"),
		JSON.stringify({
			source: { projectId: project, approvalHash: "a".repeat(32) },
			createdAt,
		}),
	);
	if (state) await writeFile(join(directory, state), "{}");
	return renderId;
}
it("returns no handle when this account has no exports", async () => {
	expect(await recoverLocalExport(userId, projectId)).toBeNull();
});
it("recovers cancelled exports as terminal rather than active", async () => {
	const cancelled = await fixture("cancelled.json", "2026-10-23T12:00:00Z");
	expect(await recoverLocalExport(userId, projectId)).toMatchObject({
		renderId: cancelled,
	});
	const active = await fixture("pending.json", "2026-10-23T11:00:00Z");
	expect(await recoverLocalExport(userId, projectId)).toMatchObject({
		renderId: active,
	});
});
it("never recovers another account or project", async () => {
	await fixture("done.json", "2026-10-23T10:00:00Z", randomUUID());
	await fixture("pending.json", "2026-10-23T10:00:00Z", userId, randomUUID());
	expect(await recoverLocalExport(userId, projectId)).toBeNull();
});
it("prefers an active export over a newer terminal export", async () => {
	const active = await fixture("processing.json", "2026-10-23T10:00:00Z");
	await fixture("done.json", "2026-10-23T11:00:00Z");
	expect(await recoverLocalExport(userId, projectId)).toEqual({
		renderId: active,
		bucketName: "fylmer-local",
	});
});
it("recovers the newest completed or failed export without creating a job", async () => {
	await fixture("done.json", "2026-10-23T10:00:00Z");
	const latest = await fixture("failed.json", "2026-10-23T11:00:00Z");
	expect(await recoverLocalExport(userId, projectId)).toMatchObject({
		renderId: latest,
	});
});
it("does not expose a manifest that was never published to the queue", async () => {
	await fixture("", "2026-10-23T10:00:00Z");
	expect(await recoverLocalExport(userId, projectId)).toBeNull();
});
it("rejects traversal identities", async () => {
	await expect(recoverLocalExport("../other", projectId)).rejects.toThrow();
	await expect(recoverLocalExport(userId, "../other")).rejects.toThrow();
});
