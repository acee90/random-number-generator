import { useEffect, useRef, useState } from "react";
import type {
	CandidateListDraft,
	SavedCandidateList,
} from "@/lib/candidateListDraft";
import { sampleLunchPlaces } from "@/lib/lunch";
import { CandidateListFlow } from "./CandidateListFlow";

type Phase = "ready" | "drawing" | "voting" | "offline";
const labels: Record<Phase, string> = {
	ready: "추첨 대기",
	drawing: "추첨 중",
	voting: "투표 중",
	offline: "재연결 중",
};
const locks: Record<Phase, string> = {
	ready: "",
	drawing: "추첨이 끝난 뒤 변경할 수 있습니다.",
	voting: "투표를 종료한 뒤 변경할 수 있습니다.",
	offline: "다시 연결되면 적용할 수 있습니다.",
};
type History = { winner: string; names: string[]; up: number; down: number };

/** Candidate-panel flow fixture, not a second room client or a server adapter. */
export function RoomCandidateFlow() {
	const [phase, setPhase] = useState<Phase>("ready");
	const [isHost, setIsHost] = useState(true);
	const [failApply, setFailApply] = useState(false);
	const [version, setVersion] = useState(1);
	const [list, setList] = useState<SavedCandidateList>(() => ({
		id: "preview-created-room-list",
		name: "방 만들 때 선택한 목록",
		items: sampleLunchPlaces
			.slice(0, 6)
			.map((place) => ({ ...place, included: true })),
		updatedAt: 0,
	}));
	const [history, setHistory] = useState<History[]>([]);
	const latest = useRef({ phase, isHost, failApply, version });
	latest.current = { phase, isHost, failApply, version };
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);

	async function apply(draft: CandidateListDraft) {
		const expectedVersion = latest.current.version;
		await new Promise((resolve) => setTimeout(resolve, 1000));
		if (!mounted.current) throw new Error("미리보기가 종료되었습니다.");
		const current = latest.current;
		if (!current.isHost || current.phase !== "ready")
			throw new Error(
				"방 상태가 바뀌어 적용하지 않았습니다. 초안은 유지됩니다.",
			);
		if (current.failApply || current.version !== expectedVersion)
			throw new Error(
				"방에 적용하지 못했습니다. 다시 시도해 주세요. 초안은 유지됩니다.",
			);
		setList({ ...structuredClone(draft), updatedAt: Date.now() });
		setVersion((value) => value + 1);
	}
	function finishVote() {
		if (!isHost || phase !== "voting") return;
		const names = list.items
			.filter((item) => item.included)
			.map((item) => item.name);
		setHistory((entries) => [
			{ winner: names[0], names, up: 4, down: 2 },
			...entries,
		]);
		setPhase("ready");
	}
	return (
		<div className="cl-room-preview">
			<aside className="cl-room-fixture" aria-label="방 상태 예제 조작">
				<label>
					방 상태
					<select
						value={phase}
						onChange={(event) => setPhase(event.currentTarget.value as Phase)}
					>
						{Object.entries(labels).map(([value, label]) => (
							<option key={value} value={value}>
								{label}
							</option>
						))}
					</select>
				</label>
				<label>
					<input
						type="checkbox"
						checked={isHost}
						onChange={(event) => setIsHost(event.currentTarget.checked)}
					/>
					방장으로 보기
				</label>
				<label>
					<input
						type="checkbox"
						checked={failApply}
						onChange={(event) => setFailApply(event.currentTarget.checked)}
					/>
					방 적용 실패
				</label>
			</aside>
			<section className="cl-room-context" aria-label="현재 방 상태">
				<div>
					<strong>오늘 점심 추첨</strong>
					<span>
						{isHost ? "방장" : "참가자"} · {labels[phase]}
					</span>
				</div>
				<output aria-label="참가자에게 공유된 후보">
					공유된 후보 v{version} ·{" "}
					{list.items.filter((item) => item.included).length}개
				</output>
				{phase === "voting" && isHost && (
					<button
						type="button"
						className="cl-button cl-primary"
						onClick={finishVote}
					>
						투표 종료하고 다음 게임
					</button>
				)}
			</section>
			<CandidateListFlow
				initialStage="current"
				storageMode="normal"
				room={{
					list,
					version,
					isHost,
					lockedReason: isHost ? locks[phase] : "후보는 방장이 변경합니다.",
					onApply: apply,
				}}
			/>
			{history.length > 0 && (
				<details className="cl-room-history">
					<summary>이전 추첨 기록 {history.length}</summary>
					{history.map((entry, index) => (
						<section
							key={`round-${history.length - index}`}
							aria-label={`${history.length - index}회차 기록`}
						>
							<strong>{entry.winner}</strong>
							<p>
								좋아요 {entry.up} · 싫어요 {entry.down}
							</p>
							<ul>
								{entry.names.map((name, itemIndex) => (
									<li key={`${itemIndex}-${name}`}>{name}</li>
								))}
							</ul>
						</section>
					))}
				</details>
			)}
		</div>
	);
}
