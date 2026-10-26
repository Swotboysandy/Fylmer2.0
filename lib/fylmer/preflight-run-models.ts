import { supportsBoundedAssetPrice } from "@/lib/api/asset-price-support";
import { ProjectBudgetError } from "@/lib/api/project-budget-error";
import { buildFilmRunPlan } from "./run-plan";

export function preflightRunModels(project: unknown): void {
	const plan = buildFilmRunPlan(project);
	const unsupported = plan.nodes.filter(
		(node) =>
			node.action === "generate" &&
			!supportsBoundedAssetPrice(node.connectorType, node.model),
	);
	if (!unsupported.length) return;
	const models = [
		...new Set(
			unsupported.map((node) => `${node.model.model} (${node.connectorType})`),
		),
	];
	throw new ProjectBudgetError(
		`This film needs models without supported cost limits: ${models.join(", ")}. No run was started. Choose supported models or supply selected media for those steps; keep the project cap enabled.`,
	);
}
