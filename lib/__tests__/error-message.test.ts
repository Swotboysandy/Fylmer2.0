import { expect, it } from "vitest";
import { errorMessage, stringifyError } from "../errors";

it("shows the API error text rather than the SDK's raw JSON body", () => {
	expect(
		errorMessage(new Error('{"error":"Set a project spending cap."}')),
	).toBe("Set a project spending cap.");
});
it("does not expose other envelope fields in the user message", () => {
	expect(errorMessage('{"error":"Request failed","internal":"debug"}')).toBe(
		"Request failed",
	);
});
it.each([
	"Normal error",
	"{not JSON}",
	'{"error":null}',
	'{"error":{"message":"nested"}}',
	'{"error":""}',
	'{"message":"different format"}',
])("preserves unsupported or ordinary messages: %s", (message) => {
	expect(errorMessage(new Error(message))).toBe(message);
});
it("keeps raw transport details for diagnostic logging", () => {
	const message = '{"error":"Request failed"}';
	expect(JSON.parse(stringifyError(new Error(message))).message).toBe(message);
});
