export class ProjectBudgetError extends Error {
	static from(error: { message: string }) {
		const prefix = "FYLMER_BUDGET: ";
		return error.message.startsWith(prefix)
			? new ProjectBudgetError(error.message.slice(prefix.length))
			: null;
	}
}
