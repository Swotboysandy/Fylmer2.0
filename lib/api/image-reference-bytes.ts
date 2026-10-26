export function referenceImageType(bytes: Buffer) {
	if (
		bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
	)
		return "image/png";
	if (
		bytes.length >= 3 &&
		bytes[0] === 255 &&
		bytes[1] === 216 &&
		bytes[2] === 255
	)
		return "image/jpeg";
	if (
		bytes.length >= 12 &&
		bytes.toString("ascii", 0, 4) === "RIFF" &&
		bytes.toString("ascii", 8, 12) === "WEBP"
	)
		return "image/webp";
	throw new Error("A reference must contain PNG, JPEG or WebP image bytes.");
}

export function decodeReferenceImage(
	source: string,
	maximum = 10 * 1024 * 1024,
) {
	if (source.length > Math.ceil(maximum / 3) * 4 + 64)
		throw new Error("Reference image exceeds the inline size limit.");
	const matched =
		/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(
			source,
		);
	if (!matched) throw new Error("Invalid inline reference image.");
	const bytes = Buffer.from(matched[2], "base64");
	if (
		!bytes.length ||
		bytes.length > maximum ||
		bytes.toString("base64") !== matched[2]
	)
		throw new Error("Invalid or oversized inline image bytes.");
	const contentType = referenceImageType(bytes);
	if (contentType !== matched[1])
		throw new Error("Reference image bytes do not match their declared type.");
	return { bytes, contentType };
}
