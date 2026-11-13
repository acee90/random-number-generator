import type { Meta, StoryObj } from "@storybook/react-vite";
import { WheelPlayground } from "./playgrounds";

const meta = {
	title: "CORE/룰렛",
	component: WheelPlayground,
	args: {
		candidateCount: 12,
		canDraw: true,
		motionOff: false,
		initialPhase: "idle",
	},
	argTypes: {
		canDraw: { name: "추첨 권한" },
		motionOff: { name: "회전 애니메이션 끄기" },
		candidateCount: {
			name: "후보 수",
			control: "select",
			options: [6, 12, 30, 107],
		},
		initialPhase: {
			name: "시작 상태",
			control: "select",
			options: ["idle", "fetching", "spinning", "done"],
		},
	},
	render: (args) => (
		<WheelPlayground
			key={`${args.candidateCount}:${args.canDraw}:${args.initialPhase}`}
			{...args}
		/>
	),
} satisfies Meta<typeof WheelPlayground>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = { name: "직접 돌려보기" };
export const FewCandidates: Story = {
	name: "후보 6곳",
	args: { candidateCount: 6 },
};
export const FullCandidates: Story = {
	name: "후보 107곳",
	args: { candidateCount: 107 },
};
export const Preparing: Story = {
	name: "추첨 준비 중",
	args: { initialPhase: "fetching" },
};
export const Spinning: Story = {
	name: "회전 중",
	args: { initialPhase: "spinning" },
};
export const Finished: Story = {
	name: "멈춘 결과",
	args: { initialPhase: "done" },
};
export const Guest: Story = {
	name: "참가자 · 방장 대기",
	args: { canDraw: false },
};
export const ReducedMotion: Story = {
	name: "회전 애니메이션 끄기",
	args: { motionOff: true },
};
export const Mobile: Story = {
	name: "모바일 · 직접 돌려보기",
	globals: { viewport: { value: "phone", isRotated: false } },
};
