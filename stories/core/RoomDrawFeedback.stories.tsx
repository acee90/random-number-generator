import type { Meta, StoryObj } from "@storybook/react-vite";
import RoomDrawResult from "@/components/features/RoomDrawResult";
import {
	createPreviewDraw,
	previewGuests,
	previewSelfId,
	previewVote,
	previewVotes,
} from "./fixtures";
import { ResultFrame, VotePlayground } from "./playgrounds";

const meta = {
	title: "CORE/투표",
	component: RoomDrawResult,
	args: {
		draw: createPreviewDraw(),
		selfId: previewSelfId,
		isHost: false,
		connected: true,
		pending: false,
		readOnly: false,
		canNext: true,
		onNext: () => {},
		onVote: () => false,
	},
	argTypes: {
		isHost: { name: "방장 화면" },
		connected: { name: "연결됨" },
		pending: { name: "투표 전송 중" },
		readOnly: { name: "읽기 전용 기록" },
		canNext: { name: "다음 게임 허용" },
		draw: { table: { disable: true } },
		selfId: { table: { disable: true } },
		onNext: { table: { disable: true } },
		onVote: { table: { disable: true } },
		titleRef: { table: { disable: true } },
		titleId: { table: { disable: true } },
	},
	render: (args) => <ResultFrame {...args} />,
} satisfies Meta<typeof RoomDrawResult>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = {
	name: "직접 눌러보기",
	render: (args) => <VotePlayground {...args} />,
};
export const Empty: Story = { name: "투표 전" };
export const Teams: Story = {
	name: "양쪽 팀과 반응 순위",
	args: { draw: createPreviewDraw({ votes: previewVotes(7) }) },
};
export const Host: Story = {
	name: "방장 화면",
	args: {
		isHost: true,
		selfId: "preview-host",
		draw: createPreviewDraw({ votes: previewVotes(7) }),
	},
};
export const MyUpVote: Story = {
	name: "내 선택 · 좋아요",
	args: {
		draw: createPreviewDraw({
			votes: [previewVote(previewGuests[0], "up", 180), ...previewVotes(5)],
		}),
	},
};
export const MyDownVote: Story = {
	name: "내 선택 · 싫어요",
	args: {
		draw: createPreviewDraw({
			votes: [previewVote(previewGuests[0], "down", 180), ...previewVotes(5)],
		}),
	},
};
export const LateJoin: Story = {
	name: "늦은 입장 · 투표 불가",
	args: {
		selfId: "preview-late",
		draw: createPreviewDraw({ votes: previewVotes(7) }),
	},
};
export const Reconnecting: Story = {
	name: "다시 연결 중",
	args: {
		connected: false,
		draw: createPreviewDraw({ votes: previewVotes(4) }),
	},
};
export const Pending: Story = {
	name: "내 투표 전송 중",
	args: { pending: true },
};
export const Archived: Story = {
	name: "확정된 기록",
	args: { readOnly: true, draw: createPreviewDraw({ votes: previewVotes(7) }) },
};
export const FullRoom: Story = {
	name: "긴 이름과 많은 팀원",
	args: { draw: createPreviewDraw({ votes: previewVotes(29, true) }) },
};
export const Mobile: Story = {
	name: "모바일 · 직접 눌러보기",
	globals: { viewport: { value: "phone", isRotated: false } },
	render: (args) => <VotePlayground {...args} />,
};
