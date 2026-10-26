import { createReadStream, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, sep, extname } from "node:path";
import { Readable } from "node:stream";
import { createClient } from "@/lib/supabase/server";

const types: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".mp4": "video/mp4",
	".webm": "video/webm",
	".mp3": "audio/mpeg",
	".m4a": "audio/mp4",
	".wav": "audio/wav",
};

function mediaPath(segments: string[]) {
	if (
		!segments.length ||
		segments.some(
			(segment) =>
				!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment) || segment.includes(".."),
		)
	)
		return null;
	const [root, ...rest] = segments;
	if (root === "oss" && rest.length === 1) return [root, ...rest];
	if (root === "direkta" && rest.length > 0) return [root, ...rest];
	if (
		(root === "quiet-star" || root === "maurya") &&
		rest[0] === "generated" &&
		rest.length > 1
	)
		return ["demo-media", root, ...rest];
	return null;
}

function byteRange(value: string | null, size: number) {
	if (!value) return null;
	const match = /^bytes=(\d*)-(\d*)$/.exec(value);
	if (!match || (!match[1] && !match[2])) return false;
	const start = match[1]
		? Number(match[1])
		: Math.max(0, size - Number(match[2]));
	const end = match[1] && match[2] ? Number(match[2]) : size - 1;
	if (
		!Number.isSafeInteger(start) ||
		!Number.isSafeInteger(end) ||
		start < 0 ||
		start >= size ||
		end < start
	)
		return false;
	return { start, end: Math.min(end, size - 1) };
}

export async function serveLegacyMedia(
	request: Request,
	segments: string[],
	head = false,
) {
	const relative = mediaPath(segments);
	if (!relative) return new Response(null, { status: 404 });
	const url = `/${segments.join("/")}`;
	const client = await createClient();
	const {
		data: { user },
	} = await client.auth.getUser();
	if (!user)
		return new Response(null, {
			status: 401,
			headers: { "Cache-Control": "private, no-store" },
		});
	const { data: link, error } = await client
		.from("legacy_media_links")
		.select("url")
		.eq("user_id", user.id)
		.eq("url", url)
		.limit(1)
		.maybeSingle();
	if (error) throw error;
	if (!link)
		return new Response(null, {
			status: 404,
			headers: { "Cache-Control": "private, no-store" },
		});
	const configured = process.env.FYLMER_LEGACY_MEDIA_ROOT;
	if (!configured || !isAbsolute(configured))
		throw new Error("The private legacy media root is not configured.");
	let filepath: string;
	let size: number;
	try {
		const root = realpathSync(configured);
		filepath = realpathSync(join(root, ...relative));
		if (!filepath.startsWith(`${root}${sep}`))
			return new Response(null, { status: 404 });
		const stat = statSync(filepath);
		if (!stat.isFile()) return new Response(null, { status: 404 });
		size = stat.size;
	} catch (cause) {
		if (cause instanceof Error && "code" in cause && cause.code === "ENOENT")
			return new Response(null, { status: 404 });
		throw cause;
	}
	const range = byteRange(request.headers.get("range"), size);
	if (range === false)
		return new Response(null, {
			status: 416,
			headers: { "Content-Range": `bytes */${size}` },
		});
	const headers = new Headers({
		"Content-Type":
			types[extname(filepath).toLowerCase()] ?? "application/octet-stream",
		"Cache-Control": "private, no-store",
		"X-Content-Type-Options": "nosniff",
		"Accept-Ranges": "bytes",
		"Content-Length": String(range ? range.end - range.start + 1 : size),
	});
	if (range)
		headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
	const body = head
		? null
		: (Readable.toWeb(
				createReadStream(filepath, range || undefined),
			) as unknown as ReadableStream);
	return new Response(body, { status: range ? 206 : 200, headers });
}
