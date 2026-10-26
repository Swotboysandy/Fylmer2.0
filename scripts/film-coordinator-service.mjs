import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { discoverFilmRuns } from "./film-worker.mjs";

export async function serveFilmCoordinator({
	env = process.env,
	signal,
	discover = discoverFilmRuns,
	wait = delay,
} = {}) {
	try {
		while (!signal?.aborted) {
			if (
				env.FYLMER_STAGING_GENERATION_ENABLED !== "1" ||
				env.FYLMER_FILM_COORDINATOR_ENABLED !== "1"
			)
				return { kind: "paused" };
			const result = await discover({
				origin: env.FYLMER_WORKER_APP_ORIGIN ?? "http://127.0.0.1:3055",
				secret: env.FYLMER_JOB_WORKER_SECRET,
				maxRuns: 4,
				maxTicks: 12,
				signal,
			});
			if (result.kind === "paused" || result.kind === "interrupted")
				return { kind: result.kind };
			await wait(30000, undefined, { signal });
		}
		return { kind: "interrupted" };
	} catch (error) {
		if (signal?.aborted) return { kind: "interrupted" };
		throw error;
	}
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	const controller = new AbortController();
	process.once("SIGTERM", () => controller.abort());
	process.once("SIGINT", () => controller.abort());
	try {
		console.log(
			JSON.stringify(await serveFilmCoordinator({ signal: controller.signal })),
		);
	} catch {
		console.error(
			"Film coordinator stopped. Inspect the run and service before restarting.",
		);
		process.exitCode = 1;
	}
}
