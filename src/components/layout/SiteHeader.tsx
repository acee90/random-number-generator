import { UtensilsCrossed } from "lucide-react";
import "./site-header.css";

type Tool = "number" | "lotto" | "pension";

interface SiteHeaderProps {
	active?: "lunch" | Tool;
	onToolChange?: (mode: Tool) => void;
	toolsDisabled?: boolean;
}

export default function SiteHeader({ active }: SiteHeaderProps) {
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
				<a
					className="site-header-item"
					href="/"
					aria-current={active === "lunch" ? "page" : undefined}
				>
					<UtensilsCrossed size={16} aria-hidden="true" />
					점메추
				</a>
			</nav>
		</header>
	);
}
