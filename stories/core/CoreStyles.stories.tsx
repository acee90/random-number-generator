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
export const Lime: Story = {
	name: "A · 라임 보드",
	args: { view: "lime" },
};
export const Line: Story = {
	name: "B · 라인 보드",
	args: { view: "line" },
};
export const MobileLime: Story = {
	name: "모바일 A · 라임 보드",
	args: { view: "lime" },
	globals: { viewport: { value: "phone", isRotated: false } },
};
export const MobileLine: Story = {
	name: "모바일 B · 라인 보드",
	args: { view: "line" },
	globals: { viewport: { value: "phone", isRotated: false } },
};
