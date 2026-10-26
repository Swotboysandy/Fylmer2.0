export class FilmRunGateError extends Error {
	constructor(
		message: string,
		readonly stopped: boolean,
	) {
		super(message);
	}

	static from(error: { message: string }) {
		for (const [prefix, stopped] of [
			["FYLMER_RUN_WAIT: ", false],
			["FYLMER_RUN_STOP: ", true],
		] as const) {
			if (error.message.startsWith(prefix))
				return new FilmRunGateError(
					error.message.slice(prefix.length),
					stopped,
				);
		}
		return null;
	}
}
