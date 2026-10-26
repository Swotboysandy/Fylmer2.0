"use client";

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useTheme } from "next-themes";
import { useReducedMotion } from "motion/react";
import { Moon, Sun } from "@/components/ui/icon";

export function ThemeToggle({ className = "" }: { className?: string }) {
	const { resolvedTheme, setTheme } = useTheme();
	const reducedMotion = useReducedMotion();
	const transitionTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
	const transitionInProgress = useRef(false);
	const button = useRef<HTMLButtonElement>(null);
	const [currentTheme, setCurrentTheme] = useState<"light" | "dark" | null>(
		null,
	);
	const dark = currentTheme
		? currentTheme === "dark"
		: resolvedTheme === "dark";
	const ready = Boolean(currentTheme || resolvedTheme);

	useEffect(() => {
		const root = document.documentElement;
		const syncTheme = () =>
			setCurrentTheme(root.classList.contains("dark") ? "dark" : "light");
		syncTheme();
		const observer = new MutationObserver(syncTheme);
		observer.observe(root, { attributes: true, attributeFilter: ["class"] });
		return () => {
			observer.disconnect();
			clearTimeout(transitionTimer.current);
			root.classList.remove("theme-changing", "theme-reveal");
			root.style.removeProperty("--theme-reveal-x");
			root.style.removeProperty("--theme-reveal-y");
			root.style.removeProperty("--theme-reveal-radius");
		};
	}, []);

	const toggle = () => {
		if (transitionInProgress.current) return;
		const root = document.documentElement;
		const next = root.classList.contains("dark") ? "light" : "dark";
		const applyTheme = () => {
			flushSync(() => {
				setTheme(next);
				setCurrentTheme(next);
			});
			root.classList.toggle("dark", next === "dark");
			root.classList.toggle("light", next === "light");
			root.style.colorScheme = next;
			try {
				window.localStorage.setItem("theme", next);
			} catch {}
		};
		if (
			!document.startViewTransition ||
			reducedMotion ||
			window.matchMedia("(prefers-reduced-motion: reduce)").matches
		) {
			clearTimeout(transitionTimer.current);
			if (!reducedMotion) {
				root.classList.add("theme-changing");
				transitionTimer.current = setTimeout(
					() => root.classList.remove("theme-changing"),
					220,
				);
			}
			applyTheme();
			return;
		}

		const rect = button.current?.getBoundingClientRect();
		if (!rect) return;
		const centerX = rect.left + rect.width / 2;
		const centerY = rect.top + rect.height / 2;
		const radius = Math.hypot(
			Math.max(centerX, window.innerWidth - centerX),
			Math.max(centerY, window.innerHeight - centerY),
		);
		root.style.setProperty("--theme-reveal-x", `${centerX}px`);
		root.style.setProperty("--theme-reveal-y", `${centerY}px`);
		root.style.setProperty("--theme-reveal-radius", `${radius}px`);
		root.classList.add("theme-reveal");
		transitionInProgress.current = true;
		const transition = document.startViewTransition(applyTheme);
		void transition.finished.catch(() => {}).finally(() => {
			root.classList.remove("theme-reveal");
			root.style.removeProperty("--theme-reveal-x");
			root.style.removeProperty("--theme-reveal-y");
			root.style.removeProperty("--theme-reveal-radius");
			transitionInProgress.current = false;
		});
	};

	return (
		<button
			ref={button}
			type="button"
			suppressHydrationWarning
			aria-label={
				ready
					? `Switch to ${dark ? "light" : "dark"} mode`
					: "Toggle color theme"
			}
			aria-pressed={ready ? dark : undefined}
			onClick={toggle}
			className={`flex h-9 items-center gap-2 rounded-full border border-border bg-card px-3 text-label text-foreground transition-colors hover:bg-button-hover active:bg-button-hover focus-ring ${className}`}
		>
			<Sun size={15} className="dark:hidden" />
			<Moon size={15} className="hidden dark:block" />
			<span className="dark:hidden">Light</span>
			<span className="hidden dark:inline">Dark</span>
			<span
				aria-hidden="true"
				className="flex h-4 w-7 items-center rounded-full bg-secondary p-0.5"
			>
				<span className="size-3 rounded-full bg-foreground transition-transform duration-150 motion-reduce:transition-none dark:translate-x-3" />
			</span>
		</button>
	);
}
