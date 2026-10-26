import { expect, it } from "vitest";
import { sameScriptElements } from "../same-script-elements";

const baseline =
	'<image id="shot">Before</image><narration id="voice">Hello</narration>';

it("allows text edits and reordering without changing element identity", () => {
	expect(
		sameScriptElements(
			baseline,
			'<narration id="voice">New narration</narration><image id="shot">After</image>',
		),
	).toBe(true);
});

it.each([
	'<image id="shot">Before</image>',
	'<video id="shot">Before</video><narration id="voice">Hello</narration>',
	'<image id="other">Before</image><narration id="voice">Hello</narration>',
	`${baseline}<image id="added">Added</image>`,
	'<image id="shot">Before</image><narration id="shot">Duplicate</narration>',
])(
	"rejects deleted, added, replaced or ambiguous identities: %s",
	(current) => {
		expect(sameScriptElements(baseline, current)).toBe(false);
	},
);

it("does not guess identity for empty scripts or elements lacking stable IDs", () => {
	expect(sameScriptElements("", "")).toBe(false);
	expect(
		sameScriptElements("<image>Before</image>", "<image>After</image>"),
	).toBe(false);
});
