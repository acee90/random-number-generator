import { createFileRoute } from "@tanstack/react-router";
import LunchPicker from "@/components/features/LunchPicker";
import { createSeoHead, lunchPageSeo } from "@/lib/seo";

export const Route = createFileRoute("/solo")({
	head: () => createSeoHead(lunchPageSeo.solo),
	component: LunchPicker,
});
