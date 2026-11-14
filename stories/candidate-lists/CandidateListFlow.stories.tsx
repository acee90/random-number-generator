import type { Meta, StoryObj } from "@storybook/react-vite";
import { CandidateListFlow } from "./CandidateListFlow";
import { RoomCandidateFlow } from "./RoomCandidateFlow";

const meta = {
	title: "FLOW/후보 목록",
	component: CandidateListFlow,
	args: { initialStage: "current", storageMode: "normal" },
	argTypes: {
		initialStage: {
			name: "처음 화면",
			control: "select",
			options: ["current", "choose", "editor", "excel"],
		},
		storageMode: { table: { disable: true } },
	},
	render: (args) => (
		<CandidateListFlow
			key={`${args.initialStage}:${args.storageMode}`}
			{...args}
		/>
	),
} satisfies Meta<typeof CandidateListFlow>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = { name: "전체 흐름" };
export const Mobile: Story = {
	name: "모바일 · 전체 흐름",
	globals: { viewport: { value: "phone", isRotated: false } },
};
export const StorageFailure: Story = {
	name: "저장 실패 · 초안 유지",
	args: { initialStage: "editor", storageMode: "fail" },
};
export const AfterRoomCreated: Story = {
	name: "방 생성 후 후보 수정",
	parameters: { controls: { disable: true } },
	render: () => <RoomCandidateFlow />,
};
