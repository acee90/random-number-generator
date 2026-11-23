import { Download, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	lunchRoomLimits,
	parseRoomDrawHistory,
	type RoomDraw,
} from "@/lib/lunchRoom";
import {
	readLunchRoomHost,
	readOrCreateLunchRoomGuestToken,
} from "@/lib/lunchRoomClient";
import { parseRoomEntryInfo } from "@/lib/roomEntryInfo";
import { RoomDrawRecordBody, roomDrawCopyText } from "./RoomDrawDialog";
import RoomDrawFeedback from "./RoomDrawFeedback";
import "./closed-room.css";

type Archive = { title: string; expiresAt: number; draws: RoomDraw[] };

export function RoomTerminalActions() {
	return (
		<nav className="room-terminal-actions" aria-label="다음 추첨 시작">
			<Button asChild>
				<a href="/create">새 방 만들기</a>
			</Button>
			<Button asChild variant="outline">
				<a href="/solo">혼자 추첨하기</a>
			</Button>
		</nav>
	);
}

export default function ClosedRoomHistory({ roomId }: { roomId: string }) {
	const [archive, setArchive] = useState<Archive | null>(null);
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(true);
	const [attempt, setAttempt] = useState(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: An explicit retry must repeat this request.
	useEffect(() => {
		let active = true;
		const controller = new AbortController();
		setLoading(true);
		setArchive(null);
		setError("");
		const timeout = setTimeout(() => {
			controller.abort();
			if (active) {
				setLoading(false);
				setError("기록을 불러오지 못했습니다. 다시 시도해 주세요.");
			}
		}, 8000);
		async function load() {
			try {
				const hostToken = readLunchRoomHost(roomId);
				const response = await fetch(`/api/lunch/rooms/${roomId}/history`, {
					method: "POST",
					credentials: "same-origin",
					cache: "no-store",
					signal: controller.signal,
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(
						hostToken
							? { hostToken }
							: { guestToken: readOrCreateLunchRoomGuestToken(roomId) },
					),
				});
				const decoded: unknown = await response.json();
				const body =
					decoded && typeof decoded === "object"
						? (decoded as Record<string, unknown>)
						: {};
				if (!response.ok)
					throw new Error(
						typeof body?.error === "string"
							? body.error
							: "기록을 불러오지 못했습니다.",
					);
				const info = parseRoomEntryInfo(body);
				const draws = parseRoomDrawHistory(body?.draws);
				if (
					!info ||
					!draws ||
					typeof body.expiresAt !== "number" ||
					!Number.isSafeInteger(body.expiresAt) ||
					body.expiresAt <= Date.now()
				)
					throw new Error(
						"기록의 보관 시간이 끝났거나 기록을 불러오지 못했습니다.",
					);
				if (active && !controller.signal.aborted)
					setArchive({ title: info.title, expiresAt: body.expiresAt, draws });
			} catch (reason) {
				if (active && !controller.signal.aborted)
					setError(
						reason instanceof Error
							? reason.message
							: "기록을 불러오지 못했습니다.",
					);
			} finally {
				clearTimeout(timeout);
				if (active && !controller.signal.aborted) setLoading(false);
			}
		}
		void load();
		return () => {
			active = false;
			controller.abort();
			clearTimeout(timeout);
		};
	}, [roomId, attempt]);
	useEffect(() => {
		if (!archive) return;
		const timer = setTimeout(
			() => {
				setArchive(null);
				setError("방이 만료되어 기록이 삭제되었습니다.");
			},
			Math.max(0, archive.expiresAt - Date.now()),
		);
		return () => clearTimeout(timer);
	}, [archive]);
	return (
		<ClosedRoomArchive
			roomId={roomId}
			archive={archive}
			loading={loading}
			error={error}
			onRetry={() => setAttempt((value) => value + 1)}
		/>
	);
}

export function ClosedRoomArchive({
	roomId,
	archive,
	loading = false,
	error,
	onRetry,
}: {
	roomId: string;
	archive: Archive | null;
	loading?: boolean;
	error?: string;
	onRetry?: () => void;
}) {
	const [downloadError, setDownloadError] = useState("");
	function download() {
		if (!archive || Date.now() >= archive.expiresAt) return;
		let url: string | undefined;
		let link: HTMLAnchorElement | undefined;
		try {
			const text = [
				archive.title,
				`추첨 기록 ${archive.draws.length}개 (최근 ${lunchRoomLimits.maxHistory}개까지)`,
				"",
				...archive.draws.map(
					(draw, index) => `${index + 1}. 추첨 기록\n${roomDrawCopyText(draw)}`,
				),
			].join("\n\n");
			url = URL.createObjectURL(
				new Blob(["\uFEFF", text], { type: "text/plain;charset=utf-8" }),
			);
			link = document.createElement("a");
			link.href = url;
			link.download = `jeommechu-room-${roomId}-history.txt`;
			document.body.appendChild(link);
			link.click();
			setDownloadError("");
		} catch {
			setDownloadError(
				"파일을 저장하지 못했습니다. 아래 상세 기록을 선택해 복사해 주세요.",
			);
		} finally {
			link?.remove();
			if (url) {
				const usedUrl = url;
				setTimeout(() => URL.revokeObjectURL(usedUrl), 0);
			}
		}
	}
	return (
		<section
			className="closed-room-history"
			aria-label="종료된 방의 추첨 기록"
			aria-busy={loading}
		>
			<div className="closed-room-history-heading">
				<h3>추첨 기록{archive ? ` · ${archive.draws.length}` : ""}</h3>
				{archive && archive.draws.length > 0 && (
					<Button variant="outline" size="sm" onClick={download}>
						<Download size={16} aria-hidden="true" />
						TXT 내보내기
					</Button>
				)}
			</div>
			{loading && <output>기록을 불러오는 중…</output>}
			{error && (
				<div>
					<p role="alert">{error}</p>
					<Button variant="outline" size="sm" onClick={onRetry}>
						<RotateCcw size={16} aria-hidden="true" />
						다시 확인
					</Button>
				</div>
			)}
			{archive && (
				<>
					<p className="closed-room-history-note">
						{archive.title} · 최근 {lunchRoomLimits.maxHistory}개까지 보관
						<br />
						<time dateTime={new Date(archive.expiresAt).toISOString()}>
							{new Date(archive.expiresAt).toLocaleString("ko-KR")}
						</time>
						까지 확인하고 저장할 수 있어요.
					</p>
					{archive.draws.length === 0 ? (
						<p>완료된 추첨 기록이 없습니다.</p>
					) : (
						<ol className="closed-room-history-list">
							{archive.draws.map((draw) => (
								<li key={draw.id}>
									<details>
										<summary>
											<span>{draw.candidates[draw.winnerIndex].name}</span>
											<time dateTime={new Date(draw.timestamp).toISOString()}>
												{new Date(draw.timestamp).toLocaleString("ko-KR", {
													month: "numeric",
													day: "numeric",
													hour: "2-digit",
													minute: "2-digit",
												})}
											</time>
										</summary>
										<RoomDrawRecordBody draw={draw} />
										{draw.votes && (
											<RoomDrawFeedback
												draw={draw}
												isHost={false}
												connected={false}
												pending={false}
												readOnly
												onVote={() => false}
											/>
										)}
									</details>
								</li>
							))}
						</ol>
					)}
				</>
			)}
			{downloadError && <p role="alert">{downloadError}</p>}
		</section>
	);
}
