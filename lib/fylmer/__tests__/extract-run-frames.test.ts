import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { extractRunFrames } from "../extract-run-frames";
import { captureOwnedRunFrames } from "../capture-owned-run-frames";

const owned = vi.hoisted(() => ({ resolve: vi.fn(), read: vi.fn() }));
vi.mock("../resolve-owned-generated-media", () => ({
	resolveOwnedGeneratedMedia: owned.resolve,
}));
vi.mock("../read-run-bundle", () => ({ readRunBundle: owned.read }));
afterEach(() => vi.unstubAllGlobals());

const run = promisify(execFile);
describe.skipIf(process.env.FYLMER_CPU_FRAME_TEST !== "1")(
	"real CPU reference frames",
	() => {
		let directory: string;
		let source: string;
		beforeAll(async () => {
			directory = await mkdtemp(join(tmpdir(), "fylmer-frame-test-"));
			source = join(directory, "sequence.mp4");
			await run(
				"ffmpeg",
				[
					"-nostdin",
					"-v",
					"error",
					"-f",
					"lavfi",
					"-i",
					"color=red:s=64x64:r=10:d=1",
					"-f",
					"lavfi",
					"-i",
					"color=lime:s=64x64:r=10:d=1",
					"-f",
					"lavfi",
					"-i",
					"color=blue:s=64x64:r=10:d=1",
					"-filter_complex",
					"[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]",
					"-map",
					"[v]",
					"-c:v",
					"libx264",
					"-threads",
					"2",
					"-pix_fmt",
					"yuv420p",
					source,
				],
				{ timeout: 30000 },
			);
		}, 35000);
		afterAll(async () => {
			if (directory) await rm(directory, { recursive: true, force: true });
		});
		it("downloads verified owned video once and supplies inline continuity frames", async () => {
			const bytes = await readFile(source);
			owned.resolve.mockResolvedValue({
				key: "video",
				jobId: "fixture",
				url: "https://storage.example/fixture",
				reference: {},
			});
			owned.read.mockResolvedValue({
				response: {
					result: {
						video: `${createHash("sha256").update(bytes).digest("hex")}-video.mp4`,
					},
				},
			});
			const fetcher = vi.fn().mockResolvedValue(new Response(bytes));
			vi.stubGlobal("fetch", fetcher);
			const capture = captureOwnedRunFrames({} as SupabaseClient, {
				userId: "fixture-owner",
				projectId: "fixture-project",
				appOrigin: "https://app.example",
			});
			const first = await capture(
				"https://app.example/api/generated-media/fixture/video",
				["last", "first"],
			);
			const middle = await capture(
				"https://app.example/api/generated-media/fixture/video",
				["middle", "last"],
			);
			expect(first[0]).toBe(middle[1]);
			expect(first[0]).not.toBe(first[1]);
			expect(middle[0]).not.toBe(first[0]);
			for (const frame of [...first, ...middle])
				expect(frame.startsWith("data:image/jpeg;base64,/9j/")).toBe(true);
			expect(fetcher).toHaveBeenCalledTimes(1);
			expect(owned.resolve).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({
					userId: "fixture-owner",
					projectId: "fixture-project",
				}),
				300,
			);
		}, 30000);
		it("rejects altered video bytes before decoding", async () => {
			owned.resolve.mockResolvedValue({
				key: "video",
				jobId: "fixture",
				url: "https://storage.example/fixture",
				reference: {},
			});
			owned.read.mockResolvedValue({
				response: { result: { video: `${"a".repeat(64)}-video.mp4` } },
			});
			vi.stubGlobal(
				"fetch",
				vi.fn().mockResolvedValue(new Response("tampered")),
			);
			const capture = captureOwnedRunFrames({} as SupabaseClient, {
				userId: "owner",
				projectId: "project",
				appOrigin: "https://app.example",
			});
			await expect(
				capture("https://app.example/api/generated-media/fixture/video", [
					"first",
				]),
			).rejects.toThrow("integrity");
		});
		it("extracts actual red, green and blue beginning/middle/end frames in requested order", async () => {
			const frames = await extractRunFrames(source, [
				"first",
				"middle",
				"last",
			]);
			expect(frames).toHaveLength(3);
			for (const [index, frame] of frames.entries()) {
				const image = join(directory, `frame-${index}.jpg`);
				await writeFile(image, frame);
				const pixel = await run(
					"ffmpeg",
					[
						"-nostdin",
						"-v",
						"error",
						"-i",
						image,
						"-vf",
						"scale=1:1",
						"-frames:v",
						"1",
						"-pix_fmt",
						"rgb24",
						"-f",
						"rawvideo",
						"pipe:1",
					],
					{ encoding: "buffer", timeout: 10000 },
				);
				expect(pixel.stdout[index]).toBeGreaterThan(200);
				for (const channel of [0, 1, 2].filter((channel) => channel !== index))
					expect(pixel.stdout[channel]).toBeLessThan(50);
			}
		}, 60000);
		it("deduplicates requested frames while retaining caller order", async () => {
			const frames = await extractRunFrames(source, ["last", "first", "last"]);
			expect(frames[0]).toEqual(frames[2]);
			expect(frames[0]).not.toEqual(frames[1]);
		}, 60000);
		it("refuses invalid keys, empty files and non-video content", async () => {
			await expect(
				extractRunFrames(source, ["unexpected"] as never),
			).rejects.toThrow();
			const empty = join(directory, "empty.mp4");
			await writeFile(empty, "");
			await expect(extractRunFrames(empty, ["first"])).rejects.toThrow(
				"regular file",
			);
			await writeFile(empty, "not a video");
			await expect(extractRunFrames(empty, ["first"])).rejects.toThrow();
		});
	},
);
