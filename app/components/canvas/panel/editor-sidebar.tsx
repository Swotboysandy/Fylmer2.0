"use client";

import Link from "next/link";
import { Fragment, memo } from "react";
import {
	BookOpen,
	History,
	Home,
	Layout,
	type IconComponent,
	SlidersAlt,
	SlidersAltFill,
	StockAlt,
	StockAltFill,
	InsertElement,
	InsertElementFill,
	Robot,
	RobotFill,
	TextBox,
	TextBoxFill,
} from "@/components/ui/icon";
import { Separator } from "@/components/ui/separator";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { SloppyComposer } from "@/app/components/sloppy/sloppy-composer";
import { SloppyPanel } from "@/app/components/sloppy/sloppy-panel";
import { useProjectId } from "@/lib/project/project-provider";
import { useEditorPanel } from "./editor-panel-context";
import {
	PINNED_PANEL_KEYS,
	RAIL_PANEL_GROUPS,
	type PanelKey,
} from "./panel-keys";
import { AssetsPanel } from "./assets-panel";
import { CanvasHistoryPanel } from "./canvas-history-panel";
import { ModelsPanel } from "./models-panel";
import { ProjectPanel } from "./project-panel";
import { FilmReviewCard } from "./film-review-card";
import { MusicRightsCard } from "./music-rights-card";
import { CaptionsPanel } from "./captions-panel";
import { LayoutPanel } from "./layout-panel";
import { PropertiesPanel } from "./properties-panel";

type PanelEntry = {
	label: string;
	icon: IconComponent;
	iconActive: IconComponent;
	Panel: () => React.ReactNode;
	Footer?: () => React.ReactNode;
};

const PANELS: Record<PanelKey, PanelEntry> = {
	assets: {
		label: "Media",
		icon: StockAlt,
		iconActive: StockAltFill,
		Panel: AssetsPanel,
	},
	project: {
		label: "Film Bible",
		icon: BookOpen,
		iconActive: BookOpen,
		Panel: () => (
			<>
				<FilmReviewCard />
				<MusicRightsCard />
				<ProjectPanel />
			</>
		),
	},
	layout: {
		label: "Layout",
		icon: Layout,
		iconActive: Layout,
		Panel: LayoutPanel,
	},
	captions: {
		label: "Captions",
		icon: TextBox,
		iconActive: TextBoxFill,
		Panel: CaptionsPanel,
	},
	properties: {
		label: "Properties",
		icon: SlidersAlt,
		iconActive: SlidersAltFill,
		Panel: PropertiesPanel,
	},
	models: {
		label: "Models",
		icon: InsertElement,
		iconActive: InsertElementFill,
		Panel: ModelsPanel,
	},
	history: {
		label: "History",
		icon: History,
		iconActive: History,
		Panel: CanvasHistoryPanel,
	},
	sloppy: {
		label: "Chat",
		icon: Robot,
		iconActive: RobotFill,
		Panel: SloppyPanel,
		Footer: SloppyComposer,
	},
};

function RailItem({
	icon: Icon,
	label,
	selected = false,
	href,
	onClick,
}: {
	icon: IconComponent;
	label: string;
	selected?: boolean;
	href?: string;
	onClick?: () => void;
}) {
	const className = cn(
		"focus-ring flex w-full shrink-0 flex-col items-center gap-1 rounded-xl px-2 py-2.5 text-center text-label-xs font-medium transition-colors active:bg-secondary focus-visible:ring-inset",
		selected
			? "bg-secondary font-semibold text-panel-label"
			: "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
	);
	const body = (
		<>
			<Icon className="h-4 w-4" />
			<span className="hidden leading-tight lg:block">{label}</span>
		</>
	);
	const control = href ? (
		<Link href={href} className={className} aria-label={label}>
			{body}
		</Link>
	) : (
		<button
			type="button"
			onClick={onClick}
			className={className}
			aria-label={label}
			aria-pressed={selected}
		>
			{body}
		</button>
	);
	return (
		<SimpleTooltip label={label} side="right" delayDuration={350}>
			{control}
		</SimpleTooltip>
	);
}

function PanelRailItem({ panelKey }: { panelKey: PanelKey }) {
	const { active, setActive } = useEditorPanel();
	const { label, icon, iconActive } = PANELS[panelKey];
	const selected = active === panelKey;
	return (
		<RailItem
			icon={selected ? iconActive : icon}
			label={label}
			selected={selected}
			onClick={() => setActive(selected ? null : panelKey)}
		/>
	);
}

function EditorSidebarComponent() {
	const { active } = useEditorPanel();
	const projectId = useProjectId();
	const current = active ? PANELS[active] : null;

	return (
		<div className="relative z-20 flex shrink-0">
			<nav
				aria-label="Panels"
				className="flex min-h-0 w-14 shrink-0 flex-col items-center gap-1 overflow-y-auto overscroll-contain pt-4 mr-2 pl-1 lg:w-[72px]"
			>
				<RailItem icon={Home} label="Home" href="/" />
				<RailItem
					icon={BookOpen}
					label="Story & Bible"
					href={`/projects/${projectId}/bible`}
				/>
				{RAIL_PANEL_GROUPS.map((group) => (
					<Fragment key={group.join()}>
						<Separator className="my-1" />
						{group.map((key) => (
							<PanelRailItem key={key} panelKey={key} />
						))}
					</Fragment>
				))}

				<div className="mt-auto flex w-full flex-col items-center gap-1 pb-3">
					<Separator className="my-1" />
					{PINNED_PANEL_KEYS.map((key) => (
						<PanelRailItem key={key} panelKey={key} />
					))}
				</div>
			</nav>

			{current && (
				<div className="flex w-64 shrink-0 flex-col gap-3 pt-6 pr-1 pb-3 text-panel-fg max-[800px]:absolute max-[800px]:inset-y-0 max-[800px]:left-14 max-[800px]:z-30 max-[800px]:rounded-r-xl max-[800px]:bg-background max-[800px]:shadow-elevation-5">
					<div className="flex shrink-0 items-center gap-2 px-1">
						<current.iconActive className="h-5 w-5 text-panel-label" />
						<h2 className="text-body font-semibold text-panel-label">
							{current.label}
						</h2>
					</div>
					<div
						key={active}
						className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-1 [scrollbar-gutter:stable]"
					>
						<current.Panel />
					</div>
					{current.Footer && (
						// The scroll area's own inset plus the 6px scrollbar globals.css
						// reserves, so the footer lines up with the cards above it.
						<div className="pr-2.5">
							<current.Footer />
						</div>
					)}
				</div>
			)}
		</div>
	);
}

export const EditorSidebar = memo(EditorSidebarComponent);
