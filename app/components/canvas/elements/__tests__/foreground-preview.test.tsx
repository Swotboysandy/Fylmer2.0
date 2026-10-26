// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { content } from "../../__tests__/fixtures";
import { ForegroundPreview } from "../foreground-preview";

const imageUrl = vi.hoisted(() => ({ current: "/missing.png" }));

vi.mock("../../hooks/use-generate", () => ({
	useGenerate: () => ({
		result: { imageUrl: imageUrl.current },
		status: "idle",
	}),
}));

vi.mock("@/lib/components/media-with-skeleton", () => ({
	MediaWithSkeleton: ({
		src,
		alt,
		onImageError,
	}: {
		src: string;
		alt: string;
		onImageError: () => void;
	}) => (
		<button type="button" data-src={src} onClick={onImageError}>
			{alt}
		</button>
	),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const container = document.body.appendChild(document.createElement("div"));
let root: Root;

beforeEach(() => {
	imageUrl.current = "/missing.png";
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
});

describe("ForegroundPreview", () => {
	it("shows a clear fallback when an image fails and retries a new URL", () => {
		const element = content("image");
		act(() => root.render(<ForegroundPreview element={element} />));
		const preview = container.querySelector("button");
		expect(preview?.getAttribute("data-src")).toBe("/missing.png");

		act(() => preview?.click());
		expect(container.textContent).toContain("Preview unavailable");
		expect(container.querySelector("button")).toBeNull();

		imageUrl.current = "/working.png";
		act(() => root.render(<ForegroundPreview element={element} />));
		expect(container.querySelector("button")?.getAttribute("data-src")).toBe(
			"/working.png",
		);
	});
});
