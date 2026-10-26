export function exportRequestOrigin(request: Request) {
	const url = new URL(request.url);
	const host = request.headers.get("host");
	if (host) {
		url.port = "";
		url.host = host;
	}
	const supplied = request.headers.get("origin");
	if (supplied) {
		const browser = new URL(supplied);
		if (
			browser.host !== url.host ||
			browser.username ||
			browser.password ||
			browser.pathname !== "/" ||
			browser.search ||
			browser.hash
		)
			throw new Error("Export must use the current application origin.");
		url.protocol = browser.protocol;
	}
	if (
		!["http:", "https:"].includes(url.protocol) ||
		url.username ||
		url.password
	)
		throw new Error("Invalid export application origin.");
	return url.origin;
}
