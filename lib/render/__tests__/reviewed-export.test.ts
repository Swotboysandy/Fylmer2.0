import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseSavedProject } from "@/lib/project/saved-project";
import { uploadedResult } from "@/lib/upload/uploaded-result";
import { ExportLayoutSchema } from "../local-export";
import {
	buildProjectExportLayout,
	getReviewedExport,
} from "../reviewed-export";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
	createClient: async () => ({ rpc }),
}));
const projectId = "11111111-1111-4111-8111-111111111111";
const approvalHash = "0123456789abcdef0123456789abcdef";
const result = (
	kind: "videoUrl" | "audioUrl",
	name: string,
	durationSec: number,
) => ({
	status: "idle",
	result: { [kind]: `https://media.example/${name}?token=one`, durationSec },
	error: null,
	resultInputs: null,
	connectorType: kind === "videoUrl" ? "video" : "tts",
});
const project = () =>
	parseSavedProject({
		script:
			'<video id="clip" trim-to-dialogue="false">The keeper enters.</video><narration id="voice">A signal arrives.</narration>',
		store: { videoSettings: { transitionType: "none", aspectRatio: "16:9" } },
		generation: {
			clip: result("videoUrl", "selected-take.mp4", 2),
			voice: result("audioUrl", "voice.wav", 3),
		},
	});
beforeEach(() => {
	rpc.mockReset();
});

describe("canonical final export", () => {
	it.each([false, true])(
		"requires saved music declarations despite caller claims, declared=%s",
		async (declared) => {
			const saved = project();
			const audioUrl = "https://media.example/score.wav";
			const declaration = {
				status: "user-declared" as const,
				audioUrl,
				basis: "original" as const,
				statement: "I composed this score.",
				evidence: "Recording project score-1",
				declaredAt: "2026-10-24T00:00:00Z",
			};
			saved.script += '<music id="score">A quiet score.</music>';
			saved.generation.score = {
				status: "idle",
				startedAt: null,
				result: {
					audioUrl,
					durationSec: 3,
					...(declared ? { musicRights: declaration } : {}),
				},
				error: null,
				resultInputs: null,
				connectorType: "music",
				pinned: true,
			};
			const layout = buildProjectExportLayout(saved);
			rpc.mockResolvedValue({
				data: { projectId, approvalHash, project: saved },
				error: null,
			});
			const pending = getReviewedExport(projectId, {
				...layout,
				musicRights: [{ declaration: { status: "verified" } }],
			});
			if (!declared) {
				await expect(pending).rejects.toThrow("no rights declaration");
				return;
			}
			const reviewed = await pending;
			expect(reviewed.source.musicRights).toEqual([
				{
					elementId: "score",
					audioUrl,
					declaration,
				},
			]);
		},
	);
	it.each([undefined, null, "22222222-2222-4222-8222-222222222222"])(
		"retains only the server-associated run identity: %s",
		async (runId) => {
			const saved = project();
			const layout = buildProjectExportLayout(saved);
			rpc.mockResolvedValue({
				data: { projectId, approvalHash, runId, project: saved },
				error: null,
			});
			const reviewed = await getReviewedExport(projectId, {
				...layout,
				runId: "33333333-3333-4333-8333-333333333333",
			});
			expect(reviewed.source).toEqual({
				projectId,
				approvalHash,
				...(runId ? { runId } : {}),
			});
		},
	);
	it.each([false, true])(
		"accepts uploaded stills with intrinsic zero duration, narration=%s",
		async (narrated) => {
			const saved = project();
			saved.script =
				'<image id="clip">An uploaded still.</image>' +
				(narrated ? '<narration id="voice">A signal arrives.</narration>' : "");
			saved.generation.clip = {
				...saved.generation.clip,
				connectorType: "image",
				pinned: true,
				result: await uploadedResult(
					"image",
					"https://media.example/upload.png",
				),
			};
			const layout = buildProjectExportLayout(saved);
			expect(layout.series[0].element.durationSec).toBe(0);
			expect(layout.totalDurationSec).toBe(narrated ? 3 : 1);
			expect(ExportLayoutSchema.safeParse(layout).success).toBe(true);
			rpc.mockResolvedValue({
				data: { projectId, approvalHash, project: saved },
				error: null,
			});
			await expect(getReviewedExport(projectId, layout)).resolves.toMatchObject(
				{ layout },
			);
		},
	);
	it.each(["video", "narration"] as const)(
		"still rejects zero-duration %s media in export payloads",
		(type) => {
			const layout = buildProjectExportLayout(project());
			layout.series[0].element.type = type;
			layout.series[0].element.durationSec = 0;
			expect(ExportLayoutSchema.safeParse(layout).success).toBe(false);
		},
	);
	it("uses the selected take and shared dialogue timing rather than an alternate history entry", () => {
		const saved = project();
		saved.generation.unselected = saved.generation.clip;
		const layout = buildProjectExportLayout(saved);
		expect(layout.series).toHaveLength(1);
		expect(layout.series[0].element.url).toContain("selected-take.mp4");
		expect(layout.totalDurationSec).toBe(3);
		expect(layout.totalFrames).toBe(72);
		expect(layout.sequences.narration).toHaveLength(1);
	});
	it("refuses missing narration instead of silently exporting an incomplete film", () => {
		const saved = project();
		delete saved.generation.voice;
		expect(() => buildProjectExportLayout(saved)).toThrow(
			"no usable selected take",
		);
	});
	it("refuses active generation, duplicate IDs and invalid selected durations", () => {
		const busy = project();
		busy.generation.clip.status = "generating";
		expect(() => buildProjectExportLayout(busy)).toThrow("finish generating");
		const duplicate = project();
		duplicate.script += '<video id="clip">Duplicate.</video>';
		expect(() => buildProjectExportLayout(duplicate)).toThrow(
			"duplicate clip IDs",
		);
		const invalid = project();
		invalid.generation.voice.result = {
			audioUrl: "https://media.example/voice.wav",
			durationSec: 0,
		};
		expect(() => buildProjectExportLayout(invalid)).toThrow(
			"no usable selected take",
		);
	});
	it("accepts transient scene IDs and renewed media tokens, but returns only the saved timeline", async () => {
		const saved = project();
		const layout = buildProjectExportLayout(saved);
		const preview = structuredClone(layout);
		preview.series[0].element.sceneId = "browser-local-scene-id";
		preview.series[0].element.url =
			"https://media.example/selected-take.mp4?token=renewed";
		rpc.mockResolvedValue({
			data: { projectId, approvalHash, project: saved },
			error: null,
		});
		const exported = await getReviewedExport(
			projectId,
			JSON.parse(JSON.stringify(preview)),
		);
		expect(exported.layout).toEqual(layout);
		expect(exported.source).toEqual({ projectId, approvalHash });
		expect(rpc).toHaveBeenCalledWith("film_export_snapshot", {
			p_project_id: projectId,
		});
	});
	it.each(["duration", "take", "audio", "captions"])(
		"rejects a changed browser %s",
		async (change) => {
			const saved = project();
			const preview = structuredClone(buildProjectExportLayout(saved));
			if (change === "duration") preview.totalFrames += 24;
			if (change === "take")
				preview.series[0].element.url = "https://media.example/other-take.mp4";
			if (change === "audio") preview.sequences = {};
			if (change === "captions") preview.captionStyle.fontSize += 1;
			rpc.mockResolvedValue({
				data: { projectId, approvalHash, project: saved },
				error: null,
			});
			await expect(getReviewedExport(projectId, preview)).rejects.toThrow(
				"differs from the saved film",
			);
		},
	);
	it("surfaces a missing final review without creating another project", async () => {
		rpc.mockResolvedValue({
			data: null,
			error: { message: "FYLMER_EXPORT: Review the final cut first." },
		});
		await expect(getReviewedExport(projectId, {})).rejects.toThrow(
			"Review the final cut first.",
		);
	});
});
