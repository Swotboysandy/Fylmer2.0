"use client";

import { memo, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "@/lib/auth/session";
import { toastError } from "@/lib/toast-error";
import { useUser } from "@/lib/user/user-provider";
import { useTheme } from "next-themes";
import { motion, useReducedMotion } from "motion/react";
import { UserAvatar } from "./user-avatar";
import { ThemeToggle } from "./theme-toggle";
import { Badge } from "@/components/ui/badge";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Check, Contrast, LogOut, Settings, User } from "@/components/ui/icon";
import ImpersonateDialog from "./impersonate-dialog";
import { SettingsDialog } from "./settings/settings-dialog";
import { useSettings } from "@/lib/settings/use-settings";

const IS_DEV = process.env.NODE_ENV !== "production";

const THEME_MODES = [
	{ value: "light", label: "Light" },
	{ value: "dark", label: "Dark" },
	{ value: "system", label: "System" },
];

function UserProfile() {
	const router = useRouter();
	const { theme, resolvedTheme, setTheme } = useTheme();
	const reducedMotion = useReducedMotion();
	const transitionTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
	const [impersonateOpen, setImpersonateOpen] = useState(false);
	const user = useUser();
	const settings = useSettings();
	const dark = resolvedTheme === "dark";

	useEffect(
		() => () => {
			clearTimeout(transitionTimer.current);
			document.documentElement.classList.remove("theme-changing");
		},
		[],
	);

	const changeTheme = (next: string) => {
		clearTimeout(transitionTimer.current);
		if (!reducedMotion) {
			document.documentElement.classList.add("theme-changing");
			transitionTimer.current = setTimeout(
				() => document.documentElement.classList.remove("theme-changing"),
				220,
			);
		}
		setTheme(next);
	};

	const handleLogout = async () => {
		try {
			await signOut();
		} catch (cause) {
			toastError(cause);
			return;
		}
		router.refresh();
	};

	return (
		<div className="fixed left-5 top-4 z-[100] flex items-center gap-2 animate-in fade-in duration-300">
			<DropdownMenu modal={false}>
				<DropdownMenuTrigger asChild>
					<button
						type="button"
						suppressHydrationWarning
						aria-label="Account menu"
						className="cursor-pointer rounded-full focus-ring"
					>
						<UserAvatar user={user} />
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className="w-56">
					<DropdownMenuLabel className="truncate">
						{user.name}
					</DropdownMenuLabel>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						role="menuitemcheckbox"
						aria-checked={dark}
						onSelect={(event) => {
							event.preventDefault();
							changeTheme(dark ? "light" : "dark");
						}}
						className="cursor-pointer"
					>
						<Contrast />
						Dark mode
						<span
							aria-hidden="true"
							className={`ml-auto flex h-5 w-9 items-center rounded-full p-0.5 ${dark ? "bg-accent" : "bg-secondary"}`}
						>
							<motion.span
								initial={false}
								animate={{
									transform: dark ? "translateX(16px)" : "translateX(0px)",
								}}
								transition={
									reducedMotion
										? { duration: 0 }
										: { duration: 0.18, ease: "easeInOut" }
								}
								className="size-4 rounded-full bg-card shadow-elevation-1"
							/>
						</span>
					</DropdownMenuItem>
					<DropdownMenuSub>
						<DropdownMenuSubTrigger className="cursor-pointer">
							<Contrast />
							Appearance
						</DropdownMenuSubTrigger>
						<DropdownMenuSubContent>
							<DropdownMenuLabel className="text-label text-muted-foreground">
								Mode
							</DropdownMenuLabel>
							{THEME_MODES.map((mode) => (
								<DropdownMenuItem
									key={mode.value}
									onClick={() => changeTheme(mode.value)}
									className="cursor-pointer"
								>
									<span className="flex w-4 items-center justify-center">
										{theme === mode.value && <Check className="size-3.5" />}
									</span>
									{mode.label}
								</DropdownMenuItem>
							))}
						</DropdownMenuSubContent>
					</DropdownMenuSub>
					<DropdownMenuItem
						onClick={() => settings.open("models")}
						className="cursor-pointer"
					>
						<Settings />
						Settings
					</DropdownMenuItem>
					{IS_DEV && (
						<DropdownMenuItem
							onClick={() => setImpersonateOpen(true)}
							className="cursor-pointer"
						>
							<User />
							Impersonate user
							<Badge variant="caution" className="ml-auto">
								Dev
							</Badge>
						</DropdownMenuItem>
					)}
					<DropdownMenuItem onClick={handleLogout} className="cursor-pointer">
						<LogOut />
						Log out
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<ThemeToggle />
			<SettingsDialog />
			{IS_DEV && (
				<ImpersonateDialog
					open={impersonateOpen}
					onOpenChange={setImpersonateOpen}
				/>
			)}
		</div>
	);
}

export default memo(UserProfile);
