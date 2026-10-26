import { setTimeout } from "node:timers/promises";

const secret = process.env.FYLMER_JOB_WORKER_SECRET;
if (!secret || secret.length < 32)
	throw new Error("Worker authorization is not configured");
const origin = process.env.FYLMER_WORKER_APP_ORIGIN ?? "http://127.0.0.1:3055";
const endpoint = new URL("/api/internal/asset-worker", origin);
if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1")
	throw new Error("The asset worker must call a loopback app service.");
while (true) {
	try {
		const response = await fetch(
			endpoint,
			{
				method: "POST",
				headers: { Authorization: `Bearer ${secret}` },
				signal: AbortSignal.timeout(540_000),
			},
		);
		if (!response.ok) console.error("Asset delivery failed", response.status);
	} catch {
		console.error("Asset worker connection failed");
	}
	await setTimeout(5000);
}
