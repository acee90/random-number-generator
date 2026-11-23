import { UtensilsCrossed } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import "./site-header.css";

type Tool = "number" | "lotto" | "pension";

interface SiteHeaderProps {
	children?: ReactNode;
	className?: string;
	active?: "lunch" | Tool;
	homeCurrent?: boolean;
	onToolChange?: (mode: Tool) => void;
	toolsDisabled?: boolean;
}

export default function SiteHeader({
	children,
	className,
	homeCurrent,
}: SiteHeaderProps) {
	return (
		<header className={cn("site-header", className)}>
			<a
				className="site-header-brand"
				href="/"
				aria-label="점메추 홈"
				aria-current={homeCurrent ? "page" : undefined}
			>
				<span className="site-header-symbol">
					<UtensilsCrossed size={22} strokeWidth={2.5} aria-hidden="true" />
				</span>
				<span className="site-header-wordmark">
					점메추<span className="site-header-period">.</span>
				</span>
			</a>
			{children}
		</header>
	);
}
