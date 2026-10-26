import { z } from "zod";
import { workerAuthorized } from "@/lib/api/local-job-worker";
import { createServiceClient } from "@/lib/supabase/service";
import { continueFilmRun } from "@/lib/fylmer/continue-film-run";

export async function GET(request: Request) {
	const headers = { "Cache-Control": "private, no-store" };
	if (!workerAuthorized(request.headers.get("authorization")))
		return Response.json({ error: "Not found" }, { status: 404, headers });
	if (
		process.env.FYLMER_STAGING_GENERATION_ENABLED !== "1" ||
		process.env.FYLMER_FILM_COORDINATOR_ENABLED !== "1"
	)
		return Response.json({ kind: "paused" }, { headers });
	try {
		const { data, error } = await createServiceClient().rpc(
			"list_film_run_candidates",
			{ p_limit: 20 },
		);
		if (error) throw new Error("Could not discover runs.");
		const rows = z
			.array(z.object({ run_id: z.uuid() }))
			.max(20)
			.parse(data);
		return Response.json(
			{ kind: "candidates", runIds: rows.map((row) => row.run_id) },
			{ headers },
		);
	} catch {
		return Response.json(
			{ error: "Film run discovery is unavailable." },
			{ status: 503, headers },
		);
	}
}

export async function POST(request: Request) {
	const headers = { "Cache-Control": "private, no-store" };
	if (!workerAuthorized(request.headers.get("authorization")))
		return Response.json({ error: "Not found" }, { status: 404, headers });
	if (
		process.env.FYLMER_STAGING_GENERATION_ENABLED !== "1" ||
		process.env.FYLMER_FILM_COORDINATOR_ENABLED !== "1"
	)
		return Response.json({ kind: "paused" }, { headers });
	const parsed = z
		.object({ runId: z.uuid(), leaseId: z.uuid().optional() })
		.strict()
		.safeParse(await request.json().catch(() => null));
	if (!parsed.success)
		return Response.json(
			{ error: "Invalid coordinator request." },
			{ status: 400, headers },
		);
	let appOrigin: string;
	try {
		const origin = new URL(process.env.FYLMER_GENERATED_MEDIA_APP_ORIGIN ?? "");
		if (
			origin.username ||
			origin.password ||
			origin.search ||
			origin.hash ||
			origin.pathname !== "/" ||
			(origin.protocol !== "https:" &&
				!(
					origin.protocol === "http:" &&
					["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
				))
		)
			throw new Error("Invalid origin");
		appOrigin = origin.origin;
	} catch {
		return Response.json(
			{ error: "Configure the film media application origin." },
			{ status: 503, headers },
		);
	}
	try {
		const result = await continueFilmRun(
			createServiceClient(),
			{ ...parsed.data, appOrigin },
			{ maxTicks: 1, signal: request.signal },
		);
		return Response.json(result, { headers });
	} catch {
		return Response.json(
			{ error: "Film coordination stopped. Review the run before retrying." },
			{ status: 409, headers },
		);
	}
}
