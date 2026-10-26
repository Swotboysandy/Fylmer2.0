import { expect, it } from "vitest";
import { decodeReferenceImage } from "../image-reference-bytes";

const png = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=",
	"base64",
);
it("decodes a bounded inline PNG without fetching a URL", () => {
	expect(
		decodeReferenceImage(`data:image/png;base64,${png.toString("base64")}`),
	).toEqual({ bytes: png, contentType: "image/png" });
});
it.each([
	"data:image/png;base64,!!!!",
	"data:image/svg+xml;base64,PHN2Zz4=",
	`data:image/jpeg;base64,${png.toString("base64")}`,
	"data:image/png;base64,bm90LWFuLWltYWdl",
	"https://example.com/image.png",
])("rejects invalid inline image %s", (source) => {
	expect(() => decodeReferenceImage(source)).toThrow();
});
it("rejects oversize bytes before forwarding to a worker", () => {
	expect(() =>
		decodeReferenceImage(`data:image/png;base64,${png.toString("base64")}`, 4),
	).toThrow("size limit");
});
