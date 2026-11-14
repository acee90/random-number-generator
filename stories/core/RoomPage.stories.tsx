import type { Meta, StoryObj } from "@storybook/react-vite";
import { RotateCcw, ThumbsDown, ThumbsUp } from "lucide-react";
import LunchRoomPage from "@/components/features/LunchRoomPage";
import {
	previewRoomId,
	RoomPageFixtureProvider,
	useRoomPagePreview,
} from "./room-page-fixture";
import "./room-page-preview.css";

type RoomPagePreviewArgs = {
	initialPhase: "idle" | "result";
	isHost: boolean;
	candidateCount: number;
	voteDelayMs?: number;
};

function PagePreviewControls() {
	const { addVote, reset, canAddVote } = useRoomPagePreview();
	return (
		<aside className="sb-room-page-tools" aria-label="페이지 미리보기 조작">
			<div className="sb-toolbar">
				<button
					type="button"
					disabled={!canAddVote}
					onClick={() => addVote("up")}
				>
					<ThumbsUp size={18} aria-hidden="true" />
					좋아요 +1
				</button>
				<button
					type="button"
					disabled={!canAddVote}
					onClick={() => addVote("down")}
				>
					<ThumbsDown size={18} aria-hidden="true" />
					싫어요 +1
				</button>
				<button type="button" onClick={reset}>
					<RotateCcw size={18} aria-hidden="true" />
					초기화
				</button>
			</div>
			<p>예제 데이터 · 실제 방 연결 없음</p>
		</aside>
	);
}

function RoomPagePreview(args: RoomPagePreviewArgs) {
	return (
		<RoomPageFixtureProvider {...args}>
			<div className="sb-room-page-preview">
				<PagePreviewControls />
				<LunchRoomPage roomId={previewRoomId} />
			</div>
		</RoomPageFixtureProvider>
	);
}

const meta = {
	title: "PAGES/추첨방",
	component: RoomPagePreview,
	parameters: { layout: "fullscreen" },
	args: {
		initialPhase: "idle",
		isHost: true,
		candidateCount: 107,
		voteDelayMs: 140,
	},
	argTypes: {
		initialPhase: {
			name: "처음 화면",
			control: "radio",
			options: ["idle", "result"],
		},
		isHost: { name: "방장으로 보기" },
		candidateCount: {
			name: "후보 수",
			control: "select",
			options: [6, 12, 30, 107],
		},
		voteDelayMs: { table: { disable: true } },
	},
	render: (args) => (
		<RoomPagePreview
			key={`${args.initialPhase}:${args.isHost}:${args.candidateCount}:${args.voteDelayMs}`}
			{...args}
		/>
	),
} satisfies Meta<typeof RoomPagePreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const HostIdle: Story = { name: "방장 · 추첨 전" };
export const HostResult: Story = {
	name: "방장 · 추첨 결과",
	args: { initialPhase: "result" },
};
export const GuestResult: Story = {
	name: "참가자 · 투표",
	args: { initialPhase: "result", isHost: false },
};
export const SlowVote: Story = {
	name: "투표 응답 지연",
	args: { initialPhase: "result", isHost: false, voteDelayMs: 2000 },
};
export const GuestIdle: Story = {
	name: "참가자 · 추첨 대기",
	args: { isHost: false },
};
export const MobileHost: Story = {
	name: "모바일 · 방장",
	globals: { viewport: { value: "phone", isRotated: false } },
};
export const MobileVote: Story = {
	name: "모바일 · 참가자 투표",
	args: { initialPhase: "result", isHost: false },
	globals: { viewport: { value: "phone", isRotated: false } },
};
