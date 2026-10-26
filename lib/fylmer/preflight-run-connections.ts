import { providerForPick } from "@/lib/api/route-families";
import { buildFilmRunPlan } from "./run-plan";

export class FilmConnectionError extends Error {}

export async function preflightRunConnections(
	project: unknown,
	userId: string,
) {
	const plan = buildFilmRunPlan(project);
	const checked = new Set<string>();
	const missing: string[] = [];
	for (const node of plan.nodes) {
		if (node.action !== "generate") continue;
		const identity = JSON.stringify([node.connectorType, node.model]);
		if (checked.has(identity)) continue;
		checked.add(identity);
		if (node.connectorType === "voice") {
			missing.push("Choose a voice before starting this film.");
			continue;
		}
		try {
			await providerForPick(userId, node.connectorType, node.model);
		} catch {
			missing.push(
				`The selected ${node.model.model} (${node.connectorType}) connection is unavailable.`,
			);
		}
	}
	if (missing.length)
		throw new FilmConnectionError(
			`${missing.join(" ")} Check your model connections in Settings or choose connected models. No film run was started.`,
		);
}
