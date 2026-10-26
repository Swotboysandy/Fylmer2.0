"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import OnboardingCard from "./onboarding-card";
import { AuthFooterLink } from "./auth-footer-link";

export default function LegacyAuthForm({
	action,
}: {
	action: "login" | "register";
}) {
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const registering = action === "register";
	async function submit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setLoading(true);
		setError("");
		try {
			const fields = new FormData(event.currentTarget);
			const response = await fetch("/auth/legacy/session", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					action,
					email: fields.get("email"),
					password: fields.get("password"),
					...(registering ? { name: fields.get("name") } : {}),
				}),
			});
			const result: { error?: string } = await response.json();
			if (!response.ok)
				throw new Error(result.error || "Sign-in is unavailable right now.");
			window.location.assign("/auth/legacy");
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Sign-in is unavailable right now.",
			);
			setLoading(false);
		}
	}
	return (
		<OnboardingCard
			heading={registering ? "Sign up" : "Login"}
			subtitle={
				registering ? "Create your Fylmer account" : "Welcome back to Fylmer"
			}
			footer={
				<AuthFooterLink
					prompt={registering ? "Already have an account?" : "New to Fylmer?"}
					href={registering ? "/login" : "/signup"}
					label={registering ? "Login" : "Sign up"}
				/>
			}
		>
			<form onSubmit={submit} className="flex w-full flex-col gap-3">
				{registering && (
					<Input
						name="name"
						autoComplete="name"
						aria-label="Full name"
						placeholder="Full name"
						className="h-11 rounded-xl"
						required
					/>
				)}
				<Input
					name="email"
					type="email"
					autoComplete="email"
					aria-label="Email"
					placeholder="Email"
					className="h-11 rounded-xl"
					required
				/>
				<Input
					name="password"
					type="password"
					autoComplete={registering ? "new-password" : "current-password"}
					aria-label="Password"
					placeholder="Password"
					className="h-11 rounded-xl"
					required
				/>
				<Button
					type="submit"
					variant="accent"
					size="cta"
					disabled={loading}
					className="mt-1 w-full"
				>
					{loading ? "Please wait…" : registering ? "Create account" : "Login"}
				</Button>
			</form>
			{error && (
				<p role="alert" className="text-center text-body text-destructive">
					{error}
				</p>
			)}
		</OnboardingCard>
	);
}
