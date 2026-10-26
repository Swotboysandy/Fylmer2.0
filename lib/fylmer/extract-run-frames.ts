import { execFile } from "node:child_process";
import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { FrameKey } from "@/lib/connectors/video/start-frame";

const run = promisify(execFile);
const keysSchema = z.array(z.enum(["first", "middle", "last"])).max(3);
const allowedInput = [
	"-protocol_whitelist",
	"file,pipe",
	"-format_whitelist",
	"mov,matroska,webm",
];
const streamSchema = z.object({
	width: z.number().int().positive().max(8192),
	height: z.number().int().positive().max(8192),
	duration: z.string().optional(),
	avg_frame_rate: z.string(),
});

export async function extractRunFrames(
	input: string,
	keys: readonly FrameKey[],
): Promise<Buffer[]> {
	keysSchema.parse(keys);
	if (keys.length === 0) return [];
	const path = resolve(input);
	const file = await lstat(path);
	if (!file.isFile() || file.size === 0 || file.size > 512 * 1024 * 1024)
		throw new Error(
			"Reference video must be a regular file between 1 byte and 512 MiB.",
		);
	const probe = await run(
		"ffprobe",
		[
			"-v",
			"error",
			...allowedInput,
			"-select_streams",
			"v:0",
			"-show_entries",
			"stream=width,height,duration,avg_frame_rate:format=duration",
			"-of",
			"json",
			path,
		],
		{ timeout: 15000, maxBuffer: 65536 },
	);
	const metadata = z
		.object({
			streams: z.array(streamSchema).length(1),
			format: z.object({ duration: z.string() }),
		})
		.parse(JSON.parse(probe.stdout));
	const stream = metadata.streams[0];
	const duration = Number(
		stream.duration && stream.duration !== "N/A"
			? stream.duration
			: metadata.format.duration,
	);
	const [numerator, denominator] = stream.avg_frame_rate.split("/").map(Number);
	const frameRate = numerator / denominator;
	if (
		!Number.isFinite(duration) ||
		duration <= 0 ||
		duration > 300 ||
		!Number.isFinite(frameRate) ||
		frameRate <= 0 ||
		frameRate > 120
	)
		throw new Error(
			"Reference video must be at most five minutes and between 0 and 120 frames per second.",
		);
	const results = new Map<FrameKey, Buffer>();
	for (const key of keys) {
		if (results.has(key)) continue;
		const seek =
			key === "last"
				? ["-sseof", String(-Math.min(0.5, duration))]
				: ["-ss", String(key === "middle" ? duration / 2 : 0)];
		const scale =
			"scale=w='min(768,iw)':h='min(768,ih)':force_original_aspect_ratio=decrease";
		const output = await run(
			"ffmpeg",
			[
				"-nostdin",
				"-hide_banner",
				"-loglevel",
				"error",
				...allowedInput,
				...seek,
				"-threads",
				"2",
				"-i",
				path,
				"-map",
				"0:v:0",
				"-an",
				"-sn",
				"-dn",
				"-vf",
				key === "last" ? `${scale},reverse` : scale,
				"-frames:v",
				"1",
				"-threads",
				"2",
				"-c:v",
				"mjpeg",
				"-q:v",
				"3",
				"-f",
				"image2pipe",
				"pipe:1",
			],
			{ timeout: 30000, maxBuffer: 2 * 1024 * 1024, encoding: "buffer" },
		);
		if (
			output.stdout.length < 4 ||
			output.stdout[0] !== 0xff ||
			output.stdout[1] !== 0xd8
		)
			throw new Error("The reference video did not produce a JPEG frame.");
		results.set(key, output.stdout);
	}
	return keys.map((key) => {
		const frame = results.get(key);
		if (!frame) throw new Error("A requested reference frame is missing.");
		return frame;
	});
}
