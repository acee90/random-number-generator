import { createFileRoute } from "@tanstack/react-router";
import RandomGenerator from "@/components/features/RandomGenerator";
import type { Mode } from "@/lib/drawHistory";
import { createSeoHead, privateRobots } from "@/lib/seo";

export const Route = createFileRoute("/tools")({
	validateSearch: (search: Record<string, unknown>): { tool: Mode } => ({
		tool:
			search.tool === "lotto" || search.tool === "pension"
				? search.tool
				: "number",
	}),
	head: ({ match }) =>
		createSeoHead({
			title: `${match.search.tool === "lotto" ? "로또 6/45 번호 생성기" : match.search.tool === "pension" ? "연금복권 720+ 번호 생성기" : "랜덤 숫자 생성기"} · 점메추`,
			description:
				"범위를 정해 숫자를 추첨하고 로또 6/45와 연금복권 720+ 번호를 생성하세요. 고정·제외 번호와 추첨 기록을 지원합니다.",
		}),
	headers: () => ({ "X-Robots-Tag": privateRobots }),
	component: ToolsPage,
});

function ToolsPage() {
	const { tool } = Route.useSearch();
	const navigate = Route.useNavigate();
	return (
		<RandomGenerator
			initialMode={tool}
			onModeChange={(next) => {
				void navigate({ search: { tool: next } });
			}}
		/>
	);
}
