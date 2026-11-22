import { UtensilsCrossed } from "lucide-react";
import { Button } from "@/components/ui/button";
import "./site-header.css";

type Tool = "number" | "lotto" | "pension";

interface SiteHeaderProps {
	active?: "lunch" | Tool;
	homeCurrent?: boolean;
	onToolChange?: (mode: Tool) => void;
	toolsDisabled?: boolean;
}

export default function SiteHeader({ active, homeCurrent }: SiteHeaderProps) {
	return (
		<header className="site-header">
			<a className="site-header-brand" href="/" aria-label="점메추 홈">
				<span className="site-header-symbol">
					<UtensilsCrossed size={22} strokeWidth={2.5} aria-hidden="true" />
				</span>
				<span>
					점메추<span className="site-header-period">.</span>
				</span>
			</a>
			<nav className="site-header-nav" aria-label="서비스 메뉴">
				<Button
					asChild
					variant={active === "lunch" ? "default" : "ghost"}
					size="sm"
					className="site-header-item"
				>
					<a href="/" aria-current={homeCurrent ? "page" : undefined}>
						<UtensilsCrossed size={16} aria-hidden="true" />
						점메추
					</a>
				</Button>
			</nav>
		</header>
	);
}
