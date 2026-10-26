import { serializeError } from "serialize-error";
import { ApiErrorEnvelope } from "./api/error-envelope";

/** For logs and transport, where the whole error (name, stack, cause) matters. */
export const stringifyError = (error: unknown): string =>
	JSON.stringify(serializeError(error));

/** For anything a person reads. UI code reaches for `toastError` instead. */
export const errorMessage = (error: unknown): string => {
	const message = error instanceof Error ? error.message : String(error);
	if (message.length > 65536 || !message.trimStart().startsWith("{"))
		return message;
	try {
		return (
			ApiErrorEnvelope.safeParse(JSON.parse(message)).data?.error ?? message
		);
	} catch {
		return message;
	}
};
