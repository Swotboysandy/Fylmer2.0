import fs from "fs";
import path from "path";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import OnboardingCard from "./components/onboarding-card";
import { AuthFooterLink } from "./components/auth-footer-link";
import AccessCodeInput from "./components/access-code-input";
import ProjectsList from "./components/projects/projects-list";
import { listProviderKeys } from "@/lib/api/provider-keys";
import { PROJECT_ROW_COLUMNS, ProjectRowSchema } from "@/lib/project/api";
import { AccountSchema } from "@/lib/user/account";
import { UserProvider } from "@/lib/user/user-provider";

const icons = fs
	.readdirSync(path.join(process.cwd(), "public/icons"))
	.filter((file) => file.endsWith(".svg"))
	.sort();

export default async function Home() {
	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();

	if (user) {
		const [
			{ data: projects, error },
			providerKeys,
			{ data: archives, error: archiveError },
			{ data: media, error: mediaError },
		] = await Promise.all([
			supabase
				.from("projects")
				.select(PROJECT_ROW_COLUMNS)
				.order("updated_at", { ascending: false }),
			listProviderKeys(user),
			supabase.from("legacy_project_archives").select("project_id"),
			supabase.from("legacy_media_links").select("project_id,url"),
		]);
		if (error) throw error;
		if (archiveError) throw archiveError;
		if (mediaError) throw mediaError;
		const mediaCounts: Record<string, { images: number; videos: number }> = {};
		for (const link of media ?? []) {
			const counts = mediaCounts[link.project_id] ?? { images: 0, videos: 0 };
			if (/\.(?:png|jpe?g|webp)$/i.test(link.url)) counts.images += 1;
			if (/\.(?:mp4|webm)$/i.test(link.url)) counts.videos += 1;
			mediaCounts[link.project_id] = counts;
		}
		return (
			<UserProvider
				account={AccountSchema.parse(user)}
				providerKeys={providerKeys}
			>
				<ProjectsList
					initialProjects={ProjectRowSchema.array().parse(projects)}
					legacyProjectIds={(archives ?? []).map(
						(archive) => archive.project_id,
					)}
					legacyMediaCounts={mediaCounts}
				/>
			</UserProvider>
		);
	}

	return (
		<OnboardingCard
			heading="Welcome to the Fylmer Beta"
			subtitle="Create your film with Fylmer, from the first idea to the final cut."
			extra={
				<div className="flex w-full items-center justify-center gap-3 rounded-full border border-border bg-secondary px-4 py-2.5 sm:gap-5 sm:px-6 sm:py-3">
					{icons.map((icon) => (
						<Image
							key={icon}
							src={`/icons/${icon}`}
							alt={icon.replace(".svg", "")}
							width={28}
							height={28}
							className="w-7 h-7 sm:w-8 sm:h-8"
						/>
					))}
				</div>
			}
			footer={
				<AuthFooterLink
					prompt="Already have an account?"
					href="/login"
					label="Login"
				/>
			}
		>
			<p className="text-body font-medium text-muted-foreground">
				Have an access code?
			</p>

			<AccessCodeInput />
		</OnboardingCard>
	);
}
