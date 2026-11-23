import type { Meta, StoryObj } from "@storybook/react-vite";
import { DrawViewPreview } from "./draw-views/DrawViewPreview";

const meta = {
	id: "draw-view-modes",
	title: "시안/추첨 보기",
	component: DrawViewPreview,
	args: { initialMode: "wheel", count: 200, guest: false, longName: false },
	argTypes: {
		initialMode: { table: { disable: true } },
		count: {
			name: "추첨 후보 수",
			control: "select",
			options: [0, 1, 6, 117, 118, 200],
		},
		guest: { name: "공동방 참가자" },
		longName: { name: "80자 후보" },
	},
	render: (args) => (
		<DrawViewPreview
			key={[args.initialMode, args.count, args.guest, args.longName].join("-")}
			{...args}
		/>
	),
} satisfies Meta<typeof DrawViewPreview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Roulette: Story = { name: "룰렛 · 기본 보기" };
export const Rolling: Story = {
	name: "슬롯머신 · 후보 200개",
	args: { initialMode: "rolling" },
};
export const Cards: Story = {
	name: "카드 뽑기 시안 · 후보 200개",
	args: { initialMode: "cards" },
};
export const Guest: Story = {
	name: "참가자의 대기 화면",
	args: { initialMode: "cards", guest: true },
};
