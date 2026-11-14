import type { Meta, StoryObj } from "@storybook/react-vite";
import { RotateCcw, ThumbsDown, ThumbsUp } from "lucide-react";
import { useEffect, useState } from "react";
import LunchRoomPage from "@/components/features/LunchRoomPage";
import {
	previewRoomId,
	RoomPageFixtureProvider,
	useRoomPagePreview,
} from "./room-page-fixture";
import "./style-proposals.css";
import "./room-page-preview.css";

type RoomPagePreviewArgs = {
	initialPhase: "idle" | "result";
	isHost: boolean;
	candidateCount: number;
	voteDelayMs?: number;
	style: "lime" | "match" | "soft" | "score";
};

const pageStyles = [
	{ value: "lime", label: "현재 서비스" },
	{ value: "match", label: "A · 매치보드" },
	{ value: "soft", label: "B · 소프트패널" },
	{ value: "score", label: "C · 스코어시트" },
] as const;

function PagePreviewControls({
	style,
	onStyleChange,
}: {
	style: RoomPagePreviewArgs["style"];
	onStyleChange: (style: RoomPagePreviewArgs["style"]) => void;
}) {
	const { addVote, reset, canAddVote } = useRoomPagePreview();
	return (
		<aside className="sb-room-page-tools" aria-label="페이지 미리보기 조작">
			<label className="sb-room-page-style-picker">
				시안
				<select
					value={style}
					onChange={(event) =>
						onStyleChange(
							event.currentTarget.value as RoomPagePreviewArgs["style"],
						)
					}
				>
					{pageStyles.map((entry) => (
						<option key={entry.value} value={entry.value}>
							{entry.label}
						</option>
					))}
				</select>
			</label>
			<div className="sb-toolbar sb-style-controls">
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

function RoomPagePreview({ style, ...roomOptions }: RoomPagePreviewArgs) {
	const [selectedStyle, setSelectedStyle] = useState(style);
	useEffect(() => setSelectedStyle(style), [style]);
	return (
		<RoomPageFixtureProvider {...roomOptions}>
			<div className="sb-room-page-preview">
				<PagePreviewControls
					style={selectedStyle}
					onStyleChange={setSelectedStyle}
				/>
				<div className="sb-style-surface" data-style={selectedStyle}>
					<LunchRoomPage roomId={previewRoomId} />
				</div>
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
		style: "lime",
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
		style: {
			name: "스타일 시안",
			control: {
				type: "select",
				labels: {
					lime: "현재 서비스",
					match: "A · 매치보드",
					soft: "B · 소프트패널",
					score: "C · 스코어시트",
				},
			},
			options: pageStyles.map((entry) => entry.value),
		},
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

export const MatchBoard: Story = {
	name: "시안 A · 매치보드",
	args: { initialPhase: "result", isHost: false, style: "match" },
};
export const SoftPanel: Story = {
	name: "시안 B · 소프트패널",
	args: { initialPhase: "result", isHost: false, style: "soft" },
};
export const ScoreSheet: Story = {
	name: "시안 C · 스코어시트",
	args: { initialPhase: "result", isHost: false, style: "score" },
};
export const MobileMatchBoard: Story = {
	...MatchBoard,
	name: "모바일 시안 A · 매치보드",
	globals: { viewport: { value: "phone", isRotated: false } },
};
export const MobileSoftPanel: Story = {
	...SoftPanel,
	name: "모바일 시안 B · 소프트패널",
	globals: { viewport: { value: "phone", isRotated: false } },
};
export const MobileScoreSheet: Story = {
	...ScoreSheet,
	name: "모바일 시안 C · 스코어시트",
	globals: { viewport: { value: "phone", isRotated: false } },
};
