import { expect, it } from "vitest";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseEnv, promisify } from "node:util";
import { layoutOf } from "./_layout";
import type { ResolvedElement } from "../types";

const run = promisify(execFile);

it
	.skipIf(process.env.FYLMER_RENDER_TIMING_TEST !== "1")
	.each(["image", "video"] as const)(
	"renders %s fades without truncating or overlapping longer spoken tracks",
	async (visualType) => {
		const env = parseEnv(await readFile(".env.local", "utf8"));
		expect(new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? "").host).toBe(
			"127.0.0.1:55421",
		);
		expect(env.FYLMER_STAGING_GENERATION_ENABLED).toBe("0");
		const directory = await mkdtemp(join(tmpdir(), "fylmer-speech-render-"));
		const assets = new Map<string, { data: Buffer; type: string }>();
		for (const frequency of [440, 880]) {
			const path = join(directory, `${frequency}.wav`);
			await run("ffmpeg", [
				"-v",
				"error",
				"-f",
				"lavfi",
				"-i",
				`sine=frequency=${frequency}:duration=4:sample_rate=48000`,
				path,
			]);
			assets.set(`/${frequency}.wav`, {
				data: await readFile(path),
				type: "audio/wav",
			});
		}
		for (const color of ["red", "blue"]) {
			if (visualType === "video") {
				const path = join(directory, `${color}.mp4`);
				await run("ffmpeg", [
					"-v",
					"error",
					"-f",
					"lavfi",
					"-i",
					`color=c=${color}:s=320x180:r=24:d=1`,
					"-c:v",
					"libx264",
					"-pix_fmt",
					"yuv420p",
					path,
				]);
				assets.set(`/${color}.mp4`, {
					data: await readFile(path),
					type: "video/mp4",
				});
			}
			assets.set(`/${color}.svg`, {
				data: Buffer.from(
					`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="${color}"/></svg>`,
				),
				type: "image/svg+xml",
			});
		}
		const server = createServer((request, response) => {
			const asset = assets.get(request.url ?? "");
			if (!asset) {
				response.writeHead(404).end();
				return;
			}
			response.writeHead(200, {
				"Content-Type": asset.type,
				"Content-Length": asset.data.length,
				"Access-Control-Allow-Origin": "*",
			});
			response.end(asset.data);
		});
		await new Promise<void>((accept) => server.listen(0, "127.0.0.1", accept));
		try {
			const address = server.address();
			if (!address || typeof address === "string")
				throw new Error("Missing fixture port");
			const origin = `http://127.0.0.1:${address.port}`;
			const element = (
				id: string,
				type: ResolvedElement["type"],
				file: string,
			): ResolvedElement => ({
				id,
				type,
				role: type === "image" || type === "video" ? "foreground" : "overlay",
				layer: type === "image" || type === "video" ? "visual" : "audio",
				sceneId: id,
				sceneNumber: 1,
				prompt: "Synthetic timing fixture",
				url: `${origin}/${file}`,
				durationSec: type === "video" ? 1 : 4,
				loops: 1,
				loop: false,
				trimToDialogue: false,
				volume: 10,
				motion: "none",
				captionTimestamps:
					type === "narration" || type === "character"
						? [{ text: "ENDING", start: 3.5, end: 4 }]
						: undefined,
			});
			const layout = {
				...layoutOf(
					[
						element(
							"red",
							visualType,
							visualType === "video" ? "red.mp4" : "red.svg",
						),
						element("first", "narration", "440.wav"),
						element(
							"blue",
							visualType,
							visualType === "video" ? "blue.mp4" : "blue.svg",
						),
						element("second", "character", "880.wav"),
					],
					{ transitionType: "fade", fps: 24 },
				),
				width: 320,
				height: 180,
			};
			expect(layout.totalDurationSec).toBe(8);
			layout.captionStyle = { ...layout.captionStyle, fontSize: 120 };
			await writeFile(join(directory, "props.json"), JSON.stringify(layout));
			await run(
				process.execPath,
				[
					"scripts/render-local-export.mjs",
					resolve(process.env.FYLMER_RENDER_TEST_BUNDLE ?? "build"),
					directory,
				],
				{ timeout: 180000, maxBuffer: 2 * 1024 * 1024 },
			);
			const output = join(directory, "output.mp4");
			const probe = await run("ffprobe", [
				"-v",
				"error",
				"-show_entries",
				"format=duration",
				"-of",
				"json",
				output,
			]);
			const duration = Number(JSON.parse(probe.stdout).format.duration);
			expect(duration).toBeGreaterThanOrEqual(8);
			expect(duration).toBeLessThan(8.15);
			const pcmPath = join(directory, "audio.f32");
			await run("ffmpeg", [
				"-v",
				"error",
				"-i",
				output,
				"-vn",
				"-ac",
				"1",
				"-ar",
				"16000",
				"-f",
				"f32le",
				pcmPath,
			]);
			const pcm = await readFile(pcmPath);
			const amplitude = (start: number, frequency: number) => {
				let sine = 0;
				let cosine = 0;
				for (let sample = 0; sample < 1600; sample++) {
					const value = pcm.readFloatLE(
						(Math.round(start * 16000) + sample) * 4,
					);
					const angle = (2 * Math.PI * frequency * sample) / 16000;
					sine += value * Math.sin(angle);
					cosine += value * Math.cos(angle);
				}
				return Math.hypot(sine, cosine) / 1600;
			};
			const first = [amplitude(3.7, 440), amplitude(3.7, 880)];
			const second = [amplitude(4.3, 440), amplitude(4.3, 880)];
			expect(first[0]).toBeGreaterThan(0.01);
			expect(first[0]).toBeGreaterThan(first[1] * 20);
			expect(second[1]).toBeGreaterThan(0.01);
			expect(second[1]).toBeGreaterThan(second[0] * 20);
			expect(amplitude(7.7, 880)).toBeGreaterThan(0.01);
			const captionFramePath = join(directory, "caption-tail.rgb");
			await run("ffmpeg", [
				"-v",
				"error",
				"-ss",
				"7.7",
				"-i",
				output,
				"-frames:v",
				"1",
				"-pix_fmt",
				"rgb24",
				"-f",
				"rawvideo",
				captionFramePath,
			]);
			const captionPixels = await readFile(captionFramePath);
			let whitePixels = 0;
			for (let offset = 0; offset < captionPixels.length; offset += 3) {
				if (
					captionPixels[offset] > 200 &&
					captionPixels[offset + 1] > 200 &&
					captionPixels[offset + 2] > 200
				)
					whitePixels++;
			}
			expect(whitePixels).toBeGreaterThan(10);
			for (const [time, channel] of [
				[3, 0],
				[7.7, 2],
			]) {
				const framePath = join(directory, `frame-${time}.rgb`);
				await run("ffmpeg", [
					"-v",
					"error",
					"-ss",
					String(time),
					"-i",
					output,
					"-frames:v",
					"1",
					"-vf",
					"scale=1:1",
					"-pix_fmt",
					"rgb24",
					"-f",
					"rawvideo",
					framePath,
				]);
				const pixel = await readFile(framePath);
				expect(pixel.length).toBe(3);
				expect(pixel[channel]).toBeGreaterThan(200);
				expect(pixel[1]).toBeLessThan(50);
			}
			await writeFile(
				join(directory, "results.json"),
				JSON.stringify(
					{ duration, first, second, syntheticOnly: true, providerCalls: 0 },
					null,
					2,
				),
			);
			console.log(`Speech timing render evidence: ${directory}`);
		} finally {
			server.closeAllConnections();
			await new Promise<void>((accept, reject) =>
				server.close((error) => (error ? reject(error) : accept())),
			);
		}
	},
	240000,
);
