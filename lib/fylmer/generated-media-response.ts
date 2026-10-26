import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { BundleResponseSchema } from "@/lib/api/asset-bundle";
import { signRunBundleFiles } from "./read-run-bundle";

export async function generatedMediaResponse(
	client: SupabaseClient,
	userId: string,
	jobId: string,
	key: string,
	request: Request,
) {
	const headers = {
		"Cache-Control": "private, no-store",
		"X-Content-Type-Options": "nosniff",
	};
	const unavailable = () =>
		Response.json(
			{ error: "Generated media is unavailable." },
			{ status: 404, headers },
		);
	if (!z.uuid().safeParse(jobId).success || !/^[a-zA-Z0-9_-]{1,128}$/.test(key))
		return unavailable();
	const range = request.headers.get("range");
	if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range))
		return new Response(null, { status: 416, headers });
	const loaded = await client
		.from("jobs")
		.select("user_id,status,result")
		.eq("id", jobId)
		.eq("user_id", userId)
		.single();
	if (
		loaded.error ||
		loaded.data?.user_id !== userId ||
		loaded.data.status !== "completed"
	)
		return unavailable();
	const parsed = BundleResponseSchema.safeParse(loaded.data.result);
	if (!parsed.success || parsed.data.id !== jobId || !parsed.data.storage)
		return unavailable();
	let url: string;
	try {
		const access = await signRunBundleFiles(
			client,
			jobId,
			parsed.data.storage,
			[key],
			300,
		);
		url = access.urls[key];
	} catch {
		return unavailable();
	}
	try {
		const upstream = await fetch(url, {
			method: request.method === "HEAD" ? "HEAD" : "GET",
			headers: range ? { Range: range } : {},
			redirect: "error",
			cache: "no-store",
			signal: AbortSignal.any([request.signal, AbortSignal.timeout(120000)]),
		});
		if (![200, 206, 416].includes(upstream.status)) {
			await upstream.body?.cancel();
			return unavailable();
		}
		const output = new Headers(headers);
		for (const name of [
			"content-type",
			"content-length",
			"content-range",
			"accept-ranges",
		]) {
			const value = upstream.headers.get(name);
			if (value !== null) output.set(name, value);
		}
		return new Response(request.method === "HEAD" ? null : upstream.body, {
			status: upstream.status,
			headers: output,
		});
	} catch {
		return Response.json(
			{ error: "Generated media could not be loaded. Please retry." },
			{ status: 502, headers },
		);
	}
}
