import { expect, it } from "vitest";
import { exportRequestOrigin } from "../export-request-origin";

it("uses the served host rather than Next's internal hostname", () => {
	expect(
		exportRequestOrigin(
			new Request("http://localhost:3055/api/render", {
				headers: { host: "127.0.0.1:3055", origin: "http://127.0.0.1:3055" },
			}),
		),
	).toBe("http://127.0.0.1:3055");
});
it("retains same-host HTTPS behind the local proxy", () => {
	expect(
		exportRequestOrigin(
			new Request("http://localhost:3055/api/render", {
				headers: {
					host: "app.example.test",
					origin: "https://app.example.test",
				},
			}),
		),
	).toBe("https://app.example.test");
});
it("rejects cross-origin export requests", () => {
	expect(() =>
		exportRequestOrigin(
			new Request("http://localhost:3055/api/render", {
				headers: {
					host: "app.example.test",
					origin: "https://other.example.test",
				},
			}),
		),
	).toThrow("current application");
});
