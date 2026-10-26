import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseSavedProject } from "@/lib/project/saved-project";
import { buildProjectExportLayout } from "../reviewed-export";
import { exportDirectory } from "../local-export";
import { getExportRecord } from "../export-record";

const owner = "11111111-1111-4111-8111-111111111111";
const outsider = "22222222-2222-4222-8222-222222222222";
const renderId = "33333333-3333-4333-8333-333333333333";
let root: string;
let directory: string;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "fylmer-record-"));
	vi.stubEnv("FYLMER_EXPORT_DIRECTORY", root);
	directory = exportDirectory(owner, renderId);
	await mkdir(directory, { recursive: true });
});
afterEach(async () => {
	vi.unstubAllEnvs();
	await rm(root, { recursive: true, force: true });
});
it("does not expose incomplete exports or another owner's files", async () => {
	await writeFile(join(directory, "output.mp4"), "fixture");
	expect(await getExportRecord(owner, renderId)).toBeNull();
	await writeFile(join(directory, "done.json"), '{"size":7}');
	expect(await getExportRecord(outsider, renderId)).toBeNull();
});
it("rejects a completion marker whose output size does not match", async () => {
	await writeFile(join(directory, "done.json"), '{"size":8}');
	await writeFile(join(directory, "output.mp4"), "fixture");
	await expect(getExportRecord(owner, renderId)).rejects.toThrow(
		"does not match",
	);
});
it.each([false, true])(
	"returns only snapshot metadata without media credentials, declared=%s",
	async (declared) => {
		const audioUrl = "https://media.example/score.wav?token=PRIVATE_TOKEN";
		const declaration = {
			status: "user-declared",
			basis: "original",
			audioUrl,
			statement: "Original test score",
			evidence: "Recording reference",
			declaredAt: "2026-10-24T00:00:00Z",
		};
		const project = parseSavedProject({
			store: {},
			script:
				'<image id="frame">PRIVATE_PROMPT</image><music id="score">Music</music>',
			generation: {
				frame: {
					status: "idle",
					error: null,
					resultInputs: null,
					connectorType: "image",
					result: {
						imageUrl: "https://media.example/frame.png?token=PRIVATE_TOKEN",
						durationSec: 4,
					},
				},
				score: {
					status: "idle",
					error: null,
					resultInputs: null,
					connectorType: "music",
					result: { audioUrl, durationSec: 4 },
				},
			},
		});
		const layout = buildProjectExportLayout(project);
		await writeFile(
			join(directory, "manifest.json"),
			JSON.stringify({
				createdAt: "2026-10-24T00:00:00Z",
				inputProps: layout,
				secret: "PRIVATE_SECRET",
				source: {
					projectId: owner,
					approvalHash: "0123456789abcdef0123456789abcdef",
					musicRights: [
						{
							elementId: "score",
							audioUrl,
							declaration: declared ? declaration : null,
						},
					],
				},
			}),
		);
		await writeFile(join(directory, "done.json"), '{"size":7}');
		await writeFile(join(directory, "output.mp4"), "fixture");
		const record = await getExportRecord(owner, renderId);
		expect(record?.timeline.totalFrames).toBe(layout.totalFrames);
		expect(record?.timeline.clips).toHaveLength(2);
		expect(record?.music[0].declaration?.status ?? null).toBe(
			declared ? "user-declared" : null,
		);
		expect(JSON.stringify(record)).not.toMatch(
			/PRIVATE_|https:|audioUrl|imageUrl/,
		);
		expect(record?.notice).toContain("not independent verification");
	},
);
