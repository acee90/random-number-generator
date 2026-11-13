import { createFileRoute } from "@tanstack/react-router";
import LunchPicker from "@/components/features/LunchPicker";

export const Route = createFileRoute("/lunch")({
	head: () => ({
		meta: [
			{ title: "점심 메뉴 추첨 · 랜덤랩" },
			{
				name: "description",
				content:
					"선정릉 점심 식당 35곳에서 후보를 고르고 룰렛으로 식당을 추첨하세요. 추첨에 사용한 난수 출처를 함께 확인할 수 있습니다.",
			},
		],
	}),
	component: LunchPicker,
});
