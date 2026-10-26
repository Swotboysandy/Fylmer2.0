import { afterEach, expect, it, vi } from "vitest";
import {
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	validateLocalExport,
	exportDirectory,
	enqueueLocalExport,
	localExportProgress,
} from "../local-export";
import { DEFAULT_CAPTION_STYLE } from "@/lib/captions/caption-style";
const userId = "141dd5ec-3816-4610-a8e8-46caf4e308c7";
const media = `http://127.0.0.1:55421/storage/v1/object/sign/fylmer-media/${userId}/test.mp4?token=test`;
const layout = (url = media) => ({
	series: [
		{
			start: 0,
			duration: 1,
			element: {
				id: "clip",
				type: "video",
				role: "foreground",
				layer: "visual",
				sceneId: "scene",
				sceneNumber: 1,
				prompt: "",
				url,
				durationSec: 1,
				loops: 1,
				loop: false,
				trimToDialogue: false,
				volume: 1,
				motion: "none",
			},
		},
	],
	sequences: {},
	fps: 24,
	width: 1920,
	height: 1080,
	totalFrames: 24,
	totalDurationSec: 1,
	transitionType: "none",
	transitionDurationSec: 0,
	captionStyle: DEFAULT_CAPTION_STYLE,
});
it("admits at most two simultaneous exports for one account", async () => {
	const root = await mkdtemp(join(tmpdir(), "fylmer-export-race-"));
	vi.stubEnv("FYLMER_EXPORT_DIRECTORY", root);
	vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55421");
	const source = {
		projectId: "11111111-1111-4111-8111-111111111111",
		approvalHash: "0123456789abcdef0123456789abcdef",
	};
	try {
		const outcomes = await Promise.allSettled(
			Array.from({ length: 8 }, () =>
				enqueueLocalExport(userId, layout(), "480p", source),
			),
		);
		expect(
			outcomes.filter((outcome) => outcome.status === "fulfilled"),
		).toHaveLength(2);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
afterEach(() => vi.unstubAllEnvs());
it("reports acknowledged cancellation but preserves an already completed download", async () => {
	const root = await mkdtemp(join(tmpdir(), "fylmer-cancel-status-"));
	vi.stubEnv("FYLMER_EXPORT_DIRECTORY", root);
	const renderId = "11111111-1111-4111-8111-111111111111";
	const directory = exportDirectory(userId, renderId);
	try {
		await mkdir(directory, { recursive: true });
		await writeFile(join(directory, "cancel-requested"), "");
		expect(await localExportProgress(userId, renderId)).toEqual({
			type: "progress",
			progress: 0,
		});
		await writeFile(join(directory, "cancelled.json"), "{}");
		expect(await localExportProgress(userId, renderId)).toEqual({
			type: "cancelled",
		});
		await writeFile(
			join(directory, "done.json"),
			JSON.stringify({ size: 128 }),
		);
		expect(await localExportProgress(userId, renderId)).toMatchObject({
			type: "done",
			size: 128,
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
it.each(["done.json", "failed.json"])(
	"releases capacity after %s",
	async (terminal) => {
		const root = await mkdtemp(join(tmpdir(), "fylmer-export-capacity-"));
		vi.stubEnv("FYLMER_EXPORT_DIRECTORY", root);
		vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55421");
		const source = {
			projectId: "11111111-1111-4111-8111-111111111111",
			approvalHash: "0123456789abcdef0123456789abcdef",
		};
		const enqueue = () => enqueueLocalExport(userId, layout(), "480p", source);
		try {
			const first = await enqueue();
			await enqueue();
			await expect(enqueue()).rejects.toThrow("Two exports");
			const directory = exportDirectory(userId, first.renderId);
			await rename(join(directory, "pending.json"), join(directory, terminal));
			await expect(enqueue()).resolves.toMatchObject({
				bucketName: "fylmer-local",
			});
			await expect(enqueue()).rejects.toThrow("Two exports");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	},
);
it("reports measured progress and gives terminal states priority", async () => {
	const root = await mkdtemp(join(tmpdir(), "fylmer-progress-unit-"));
	vi.stubEnv("FYLMER_EXPORT_DIRECTORY", root);
	const renderId = "11111111-1111-4111-8111-111111111111";
	const directory = exportDirectory(userId, renderId);
	try {
		await mkdir(directory, { recursive: true });
		expect(await localExportProgress(userId, renderId)).toEqual({
			type: "progress",
			progress: 0,
		});
		await writeFile(
			join(directory, "progress.json"),
			JSON.stringify({ progress: 0.42 }),
		);
		expect(await localExportProgress(userId, renderId)).toEqual({
			type: "progress",
			progress: 0.42,
		});
		await writeFile(join(directory, "failed.json"), "{}");
		expect(await localExportProgress(userId, renderId)).toMatchObject({
			type: "error",
		});
		await writeFile(
			join(directory, "done.json"),
			JSON.stringify({ size: 128 }),
		);
		expect(await localExportProgress(userId, renderId)).toEqual({
			type: "done",
			size: 128,
			url: `/api/render/download/${renderId}`,
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
it.each([-1, 1, "0.5", null])(
	"rejects invalid worker progress %s",
	async (progress) => {
		const root = await mkdtemp(join(tmpdir(), "fylmer-progress-invalid-"));
		vi.stubEnv("FYLMER_EXPORT_DIRECTORY", root);
		const renderId = "11111111-1111-4111-8111-111111111111";
		const directory = exportDirectory(userId, renderId);
		try {
			await mkdir(directory, { recursive: true });
			await writeFile(
				join(directory, "progress.json"),
				JSON.stringify({ progress }),
			);
			await expect(localExportProgress(userId, renderId)).rejects.toThrow();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	},
);
it("accepts owned uploaded clips without enabling GPU generation", () => {
	vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55421");
	vi.stubEnv("FYLMER_TRESCA_GPU_APPROVED", "0");
	expect(
		validateLocalExport(layout(), userId, "720p").inputProps.series,
	).toHaveLength(1);
});
it.each([
	"http://169.254.169.254/latest/meta-data",
	"file:///etc/passwd",
	media.replace(userId, "68255c90-4484-4913-8d98-c9f73306a554"),
	media.replace("test.mp4", "%2e%2e/secret"),
])("rejects unowned or unsafe media %s", (url) => {
	vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55421");
	expect(() => validateLocalExport(layout(url), userId, "720p")).toThrow();
});
it("bounds CPU export size and duration", () => {
	expect(() => validateLocalExport(layout(), userId, "4K")).toThrow("1920");
	expect(() =>
		validateLocalExport(
			{ ...layout(), totalFrames: 18000, fps: 24 },
			userId,
			"720p",
		),
	).toThrow("five minutes");
});
it("rounds fractional output dimensions to valid H264 dimensions", () => {
	vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55421");
	const output = validateLocalExport(layout(), userId, "480p");
	expect(output.inputProps.width).toBe(854);
	expect(output.inputProps.height).toBe(480);
	expect(output.scale).toBe(1);
});
it("rejects path traversal in download identities", () => {
	vi.stubEnv("FYLMER_EXPORT_DIRECTORY", "/private/exports");
	expect(() => exportDirectory(userId, "../secret")).toThrow();
});
it("keeps the approved project, run identity and exact queued timeline in a private manifest", async () => {
	const root = await mkdtemp(join(tmpdir(), "fylmer-export-unit-"));
	vi.stubEnv("FYLMER_EXPORT_DIRECTORY", root);
	vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55421");
	const source = {
		projectId: "11111111-1111-4111-8111-111111111111",
		approvalHash: "0123456789abcdef0123456789abcdef",
		runId: "22222222-2222-4222-8222-222222222222",
		musicRights: [
			{
				elementId: "score",
				audioUrl: "https://media.example/score.wav",
				declaration: null,
			},
		],
	};
	try {
		const handle = await enqueueLocalExport(userId, layout(), "480p", source);
		const directory = exportDirectory(userId, handle.renderId);
		const manifest = JSON.parse(
			await readFile(join(directory, "manifest.json"), "utf8"),
		);
		const pending = JSON.parse(
			await readFile(join(directory, "pending.json"), "utf8"),
		);
		expect(manifest).toEqual(pending);
		expect(manifest.source).toEqual(source);
		expect(manifest.inputProps.totalFrames).toBe(24);
		expect(manifest.resolution).toBe("480p");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
