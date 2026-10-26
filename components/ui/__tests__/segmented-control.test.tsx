// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { SegmentedControl } from "../segmented-control";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const container = document.body.appendChild(document.createElement("div"));
const root = createRoot(container);
const onChange = vi.fn();

afterEach(() => {
	act(() => root.render(null));
	onChange.mockReset();
});

it("moves the selected surface without changing toggle semantics", () => {
	const options = [
		{ value: "story", label: "Describe a video" },
		{ value: "script", label: "Paste a script" },
	];
	act(() =>
		root.render(
			<SegmentedControl
				value="story"
				options={options}
				onChange={onChange}
				ariaLabel="Input type"
			/>,
		),
	);
	expect(container.querySelector('[data-state="on"]')?.textContent).toBe(
		"Describe a video",
	);
	expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1);
	act(() =>
		container.querySelectorAll<HTMLButtonElement>("button")[1]?.click(),
	);
	expect(onChange).toHaveBeenCalledWith("script");
	act(() =>
		root.render(
			<SegmentedControl
				value="script"
				options={options}
				onChange={onChange}
				ariaLabel="Input type"
			/>,
		),
	);
	expect(container.querySelector('[data-state="on"]')?.textContent).toBe(
		"Paste a script",
	);
	expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1);
});
