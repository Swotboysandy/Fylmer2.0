import { readFile, readdir, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export function createExportReconciler({
	env = process.env,
	fetchImpl = fetch,
	now = Date.now,
} = {}) {
	const retryAfter = new Map();
	return async (directory, userId, renderId) => {
		const files = await readdir(directory);
		if (
			!files.includes("done.json") ||
			files.includes("failed.json") ||
			files.includes("cancelled.json") ||
			files.includes("completion.json")
		)
			return;
		if ((retryAfter.get(directory) ?? 0) > now()) return;
		retryAfter.set(directory, now() + 30000);
		const manifest = JSON.parse(
			await readFile(join(directory, "manifest.json"), "utf8"),
		);
		if (!manifest.source?.runId) {
			retryAfter.delete(directory);
			return;
		}
		z.uuid().parse(manifest.source.runId);
		const origin = new URL(
			env.FYLMER_WORKER_APP_ORIGIN ?? "http://127.0.0.1:3055",
		);
		if (
			!["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname) ||
			!["http:", "https:"].includes(origin.protocol) ||
			origin.username ||
			origin.password ||
			origin.pathname !== "/" ||
			origin.search ||
			origin.hash
		)
			throw new Error(
				"Export completion requires a local application endpoint",
			);
		const secret = env.FYLMER_JOB_WORKER_SECRET;
		if (!secret || secret.length < 32)
			throw new Error("Export completion is not configured");
		const response = await fetchImpl(
			new URL("/api/internal/export-complete", origin),
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${secret}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					userId: z.uuid().parse(userId),
					renderId: z.uuid().parse(renderId),
				}),
				redirect: "error",
				signal: AbortSignal.timeout(10000),
			},
		);
		if (!response.ok)
			throw new Error("Export completion acknowledgement failed");
		const result = z
			.object({ recorded: z.boolean() })
			.parse(await response.json());
		await writeFile(join(directory, "completion.tmp"), JSON.stringify(result), {
			mode: 0o600,
		});
		await rename(
			join(directory, "completion.tmp"),
			join(directory, "completion.json"),
		);
		retryAfter.delete(directory);
	};
}
