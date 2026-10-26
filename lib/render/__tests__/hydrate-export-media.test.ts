import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_CAPTION_STYLE } from "@/lib/captions/caption-style";
import { hydrateExportMedia } from "../hydrate-export-media";
import { enqueueLocalExport, exportDirectory } from "../local-export";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const mocks = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("@/lib/fylmer/resolve-owned-generated-media", () => ({
	resolveOwnedGeneratedMedia: mocks.resolve,
}));
const userId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const origin = "https://app.example.test";
const url = `${origin}/api/generated-media/33333333-3333-4333-8333-333333333333/image`;
const client = {} as SupabaseClient;
const layout = () => ({
	series: [0, 1].map((index) => ({
		start: index,
		duration: 1,
		element: {
			id: `clip-${index}`,
			type: "image",
			role: "foreground",
			layer: "visual",
			sceneId: "scene",
			sceneNumber: 1,
			prompt: "",
			url,
			durationSec: 0,
			loops: 1,
			loop: false,
			trimToDialogue: false,
			volume: 1,
			motion: "none",
		},
	})),
	sequences: {},
	fps: 24,
	width: 1280,
	height: 720,
	totalFrames: 48,
	totalDurationSec: 2,
	transitionType: "none",
	transitionDurationSec: 0,
	captionStyle: DEFAULT_CAPTION_STYLE,
});
beforeEach(() => {
	vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55421");
	mocks.resolve.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

it("renews once per execution and leaves canonical and queued URLs untouched", async () => {
	mocks.resolve
		.mockResolvedValueOnce({ url: "https://storage.example/asset?token=first" })
		.mockResolvedValueOnce({
			url: "https://storage.example/asset?token=renewed",
		});
	const queued = layout();
	const original = JSON.stringify(queued);
	const first = await hydrateExportMedia(
		client,
		userId,
		projectId,
		queued,
		origin,
	);
	const second = await hydrateExportMedia(
		client,
		userId,
		projectId,
		queued,
		origin,
	);
	expect(mocks.resolve).toHaveBeenCalledTimes(2);
	expect(mocks.resolve).toHaveBeenCalledWith(
		client,
		{ userId, projectId, appOrigin: origin, url },
		1800,
	);
	expect(
		first.series.every((item) => item.element.url.endsWith("token=first")),
	).toBe(true);
	expect(
		second.series.every((item) => item.element.url.endsWith("token=renewed")),
	).toBe(true);
	expect(JSON.stringify(queued)).toBe(original);
});
it("stops export when owned renewal fails", async () => {
	mocks.resolve.mockRejectedValue(new Error("not available to this project"));
	await expect(
		hydrateExportMedia(client, userId, projectId, layout(), origin),
	).rejects.toThrow("this project");
});
it("queues only stable identities after ownership validation", async () => {
	const directory = await mkdtemp(join(tmpdir(), "fylmer-generated-export-"));
	vi.stubEnv("FYLMER_EXPORT_DIRECTORY", directory);
	mocks.resolve.mockResolvedValue({
		url: "https://storage.example/asset?token=must-not-persist",
	});
	try {
		const queued = await enqueueLocalExport(
			userId,
			layout(),
			"720p",
			{ projectId, approvalHash: "a".repeat(32) },
			{ client, appOrigin: origin },
		);
		const payload = JSON.parse(
			await readFile(
				join(exportDirectory(userId, queued.renderId), "pending.json"),
				"utf8",
			),
		);
		expect(payload.mediaOrigin).toBe(origin);
		expect(payload.inputProps.series[0].element.url).toBe(url);
		expect(JSON.stringify(payload)).not.toContain("must-not-persist");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
it("rejects foreign origins before renewal", async () => {
	const queued = layout();
	queued.series[0].element.url = url.replace(
		origin,
		"https://untrusted.example",
	);
	await expect(
		hydrateExportMedia(client, userId, projectId, queued, origin),
	).rejects.toThrow("private library");
	expect(mocks.resolve).not.toHaveBeenCalled();
});
