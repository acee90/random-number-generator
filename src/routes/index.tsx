import { createFileRoute } from "@tanstack/react-router";
import LunchHome from "@/components/features/LunchHome";
import { createSeoHead, lunchPageSeo } from "@/lib/seo";

export const Route = createFileRoute("/")({
	head: () => createSeoHead(lunchPageSeo.home),
	component: LunchHome,
});
