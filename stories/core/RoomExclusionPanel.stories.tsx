import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import RoomExclusionPanel from "@/components/features/RoomExclusionPanel";
import "@/components/features/picnic/picnic-art.css";
import "@/components/features/picnic/details.css";
import { sampleLunchPlaces } from "@/lib/lunch";
import type { RoomSnapshot } from "@/lib/lunchRoom";

const firstDrawAt = Date.parse("2026-11-16T02:00:00Z");

function createLedgerSnapshot(count = 200): RoomSnapshot {
	const candidates = Array.from({ length: count }, (_, index) => {
		const sample = sampleLunchPlaces[index % sampleLunchPlaces.length];
		return {
			id: `preview-candidate-${index + 1}`,
			name:
				index === count - 1
					? "아주 긴 이름의 음식점 · 선릉역 직장인 점심 추천 메뉴"
					: `${sample.name}${index >= sampleLunchPlaces.length ? ` · 후보 ${index + 1}` : ""}`,
			category: sample.category,
		};
	});
	return {
		roomId: "preview-exclusion-ledger",
		title: "당첨 제외 내역 미리보기",
		createdAt: firstDrawAt - 60_000,
		expiresAt: firstDrawAt + 86_400_000,
		listVersion: 1,
		candidates,
		participants: [{ id: "preview-host", name: "방장", isHost: true }],
		messages: [],
		draw: null,
		history: [],
		status: "waiting",
		excludeDrawn: true,
		excludedIds: candidates.map((candidate) => candidate.id),
		exclusionRecords: candidates.map((candidate, index) => ({
			candidateId: candidate.id,
			drawId: `preview-draw-${index + 1}`,
			drawnAt: firstDrawAt + index * 60_000,
			roundNumber: index + 1,
			roundNumberIsExact: true,
		})),
		drawCount: count,
		drawCountIsExact: true,
	};
}

const fullLedger = createLedgerSnapshot();
const legacyBase = createLedgerSnapshot(6);
const legacyLedger: RoomSnapshot = {
	...legacyBase,
	roomId: "preview-exclusion-legacy",
	exclusionRecords: legacyBase.exclusionRecords?.slice(-3).map((record) => ({
		...record,
		roundNumberIsExact: false,
	})),
	drawCountIsExact: false,
};

type PreviewArgs = {
	initialSnapshot: RoomSnapshot;
	isHost: boolean;
	locked: boolean;
	busy: boolean;
	showResult: boolean;
	boardWidth: number;
};

function ExclusionPanelPreview({
	initialSnapshot,
	boardWidth,
	...props
}: PreviewArgs) {
	const [snapshot, setSnapshot] = useState(initialSnapshot);
	return (
		<div className="sb-playground">
			<header className="sb-heading">
				<h1>당첨 제외 내역</h1>
				<p>예제 데이터 · 실제 방 연결 없음</p>
			</header>
			<div className="sb-toolbar">
				<button type="button" onClick={() => setSnapshot(initialSnapshot)}>
					예제 내역 복원
				</button>
			</div>
			<div
				className="picnic-frame"
				style={{
					minBlockSize: 400,
					inlineSize: `${boardWidth}px`,
					maxInlineSize: "100%",
					border: "1px solid var(--line)",
				}}
			>
				<RoomExclusionPanel
					{...props}
					snapshot={snapshot}
					onToggle={async (excludeDrawn) => {
						setSnapshot((current) => ({ ...current, excludeDrawn }));
						return true;
					}}
					onReset={async () => {
						setSnapshot((current) => ({
							...current,
							excludedIds: [],
							exclusionRecords: [],
						}));
						return true;
					}}
				/>
			</div>
		</div>
	);
}

const meta = {
	id: "core-exclusion-panel",
	title: "CORE/당첨 제외 내역",
	component: ExclusionPanelPreview,
	args: {
		initialSnapshot: fullLedger,
		isHost: true,
		locked: false,
		busy: false,
		showResult: false,
		boardWidth: 597,
	},
	argTypes: {
		initialSnapshot: { table: { disable: true } },
		isHost: { name: "방장 화면" },
		locked: { name: "옵션 잠김" },
		busy: { name: "변경 전송 중" },
		showResult: { name: "결과 화면" },
		boardWidth: {
			name: "보드 너비",
			control: "select",
			options: [320, 597, 720],
		},
	},
	render: (args) => (
		<ExclusionPanelPreview
			key={`${args.initialSnapshot.roomId}:${args.initialSnapshot.excludeDrawn}`}
			{...args}
		/>
	),
} satisfies Meta<typeof ExclusionPanelPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FullLedger: Story = { name: "200개 내역 · 최근 추첨순" };

export const StoredLedger: Story = {
	name: "중복 제외 꺼짐 · 내역 유지",
	args: {
		initialSnapshot: { ...fullLedger, excludeDrawn: false },
	},
};

export const LegacyLedger: Story = {
	name: "이전 방 · 일부 기록만 남음",
	args: { initialSnapshot: legacyLedger },
};
