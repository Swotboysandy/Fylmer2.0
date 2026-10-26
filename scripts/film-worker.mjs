import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const responseSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("yielded"),
		leaseId: z.uuid(),
		lastResult: z.object({
			kind: z.enum(["waiting", "dispatched", "committed"]),
		}),
	}),
	z.object({
		kind: z.enum([
			"paused",
			"stopped",
			"unavailable",
			"interrupted",
			"attention",
		]),
	}),
	z.object({ kind: z.literal("review"), stage: z.enum(["images", "final"]) }),
]);

function workerEndpoint(origin) {
	const base = new URL(origin);
	if (
		base.protocol !== "http:" ||
		base.hostname !== "127.0.0.1" ||
		base.username ||
		base.password ||
		base.pathname !== "/" ||
		base.search ||
		base.hash
	)
		throw new Error("The film worker requires a loopback app origin.");
	return new URL("/api/internal/film-worker", base);
}

export async function runFilmWorker({
	runId,
	origin,
	secret,
	maxTicks = 120,
	signal,
}) {
	z.uuid().parse(runId);
	z.string().min(32).parse(secret);
	z.number().int().min(1).max(120).parse(maxTicks);
	const endpoint = workerEndpoint(origin);
	let leaseId;
	for (let tick = 0; tick < maxTicks; tick++) {
		if (signal?.aborted) return { kind: "interrupted" };
		const response = await fetch(endpoint, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${secret}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ runId, leaseId }),
			redirect: "error",
			signal: signal
				? AbortSignal.any([signal, AbortSignal.timeout(540000)])
				: AbortSignal.timeout(540000),
		});
		if (!response.ok)
			throw new Error(
				`Film coordinator returned HTTP ${response.status}; inspect the run before restarting.`,
			);
		const result = responseSchema.parse(await response.json());
		if (result.kind !== "yielded") return result;
		if (leaseId && result.leaseId !== leaseId)
			throw new Error("Film coordinator ownership changed unexpectedly.");
		leaseId = result.leaseId;
		if (tick + 1 === maxTicks)
			return { kind: "bounded", lastKind: result.lastResult.kind };
		try {
			await delay(5000, undefined, { signal });
		} catch (error) {
			if (signal?.aborted) return { kind: "interrupted" };
			throw error;
		}
	}
	throw new Error("Unexpected film worker tick bound.");
}

export async function discoverFilmRuns({
	origin,
	secret,
	maxRuns = 4,
	maxTicks = 120,
	signal,
}) {
	z.string().min(32).parse(secret);
	z.number().int().min(1).max(4).parse(maxRuns);
	z.number().int().min(1).max(120).parse(maxTicks);
	const endpoint = workerEndpoint(origin);
	if (signal?.aborted) return { kind: "interrupted" };
	const response = await fetch(endpoint, {
		headers: { Authorization: `Bearer ${secret}` },
		redirect: "error",
		signal: signal
			? AbortSignal.any([signal, AbortSignal.timeout(10000)])
			: AbortSignal.timeout(10000),
	});
	if (!response.ok)
		throw new Error(
			`Film discovery returned HTTP ${response.status}; inspect the service before restarting.`,
		);
	const discovery = z
		.discriminatedUnion("kind", [
			z.object({ kind: z.literal("paused") }),
			z.object({
				kind: z.literal("candidates"),
				runIds: z
					.array(z.uuid())
					.max(20)
					.refine((ids) => new Set(ids).size === ids.length),
			}),
		])
		.parse(await response.json());
	if (discovery.kind === "paused") return discovery;
	const runs = [];
	for (const runId of discovery.runIds.slice(0, maxRuns)) {
		if (signal?.aborted) return { kind: "interrupted", runs };
		const result = await runFilmWorker({
			runId,
			origin,
			secret,
			maxTicks,
			signal,
		});
		runs.push({ runId, result });
		if (result.kind === "paused" || result.kind === "interrupted") break;
	}
	return { kind: "batch", runs };
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	if (
		process.env.FYLMER_STAGING_GENERATION_ENABLED !== "1" ||
		process.env.FYLMER_FILM_COORDINATOR_ENABLED !== "1"
	) {
		console.log(JSON.stringify({ kind: "paused" }));
	} else {
		const controller = new AbortController();
		process.once("SIGINT", () => controller.abort());
		process.once("SIGTERM", () => controller.abort());
		try {
			console.log(
				JSON.stringify(
					await (
						process.argv[2] === "--discover" ? discoverFilmRuns : runFilmWorker
					)({
						runId: process.argv[2],
						origin:
							process.env.FYLMER_WORKER_APP_ORIGIN ?? "http://127.0.0.1:3055",
						secret: process.env.FYLMER_JOB_WORKER_SECRET,
						signal: controller.signal,
					}),
				),
			);
		} catch {
			console.error("Film worker stopped; inspect the run before restarting.");
			process.exitCode = 1;
		}
	}
}
