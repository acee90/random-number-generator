import type { Meta, StoryObj } from "@storybook/react-vite";
import { CoreStylePreview } from "./style-proposals";

const meta = {
	title: "CORE/스타일 비교",
	component: CoreStylePreview,
	args: {
		view: "compare",
		candidateCount: 12,
		isHost: false,
		motionOff: false,
	},
	argTypes: {
		view: { table: { disable: true } },
		candidateCount: {
			name: "후보 수",
			control: "select",
			options: [6, 12, 30, 107],
		},
		isHost: { name: "방장으로 보기" },
		motionOff: { name: "동작 줄이기" },
	},
	render: (args) => (
		<CoreStylePreview
			key={`${args.view}:${args.candidateCount}:${args.isHost}:${args.motionOff}`}
			{...args}
		/>
	),
} satisfies Meta<typeof CoreStylePreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Compare: Story = { name: "두 시안 나란히" };
export const MatchBoard: Story = {
	name: "A · 매치보드",
	args: { view: "match" },
};
export const SoftPanel: Story = {
	name: "B · 소프트패널",
	args: { view: "soft" },
};
export const ScoreSheet: Story = {
	name: "C · 스코어시트",
	args: { view: "score" },
};
export const Lime: Story = {
	name: "현재 서비스 · 스코어시트",
	args: { view: "lime" },
};
export const Line: Story = {
	name: "이전 시안 · 라인",
	args: { view: "line" },
};
export const MobileLime: Story = {
	name: "모바일 현재 서비스",
	args: { view: "lime" },
	globals: { viewport: { value: "phone", isRotated: false } },
};
export const MobileLine: Story = {
	name: "모바일 이전 라인",
	args: { view: "line" },
	globals: { viewport: { value: "phone", isRotated: false } },
};
export const MobileMatchBoard: Story = {
	name: "모바일 A · 매치보드",
	args: { view: "match" },
	globals: { viewport: { value: "phone", isRotated: false } },
};
export const MobileSoftPanel: Story = {
	name: "모바일 B · 소프트패널",
	args: { view: "soft" },
	globals: { viewport: { value: "phone", isRotated: false } },
};
export const MobileScoreSheet: Story = {
	name: "모바일 C · 스코어시트",
	args: { view: "score" },
	globals: { viewport: { value: "phone", isRotated: false } },
};
