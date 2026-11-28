import { LogOut, Settings } from "lucide-react";
import { useId, useRef, useState } from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { useLunchRoom } from "@/hooks/useLunchRoom";
import "./room-settings.css";

type Room = ReturnType<typeof useLunchRoom>;

export default function RoomSettingsDialog({
	room,
	busy,
	solo = false,
}: {
	room: Room;
	busy: boolean;
	solo?: boolean;
}) {
	const id = useId();
	const snapshot = room.snapshot;
	const [open, setOpen] = useState(false);
	const [openedAsHost, setOpenedAsHost] = useState(false);
	const [draftTitle, setDraftTitle] = useState("");
	const [originalTitle, setOriginalTitle] = useState("");
	const [saving, setSaving] = useState(false);
	const [closing, setClosing] = useState(false);
	const [confirmClose, setConfirmClose] = useState(false);
	const [error, setError] = useState("");
	const [discard, setDiscard] = useState<"close" | "reload" | null>(null);
	const savingRef = useRef(false);
	const retryTitleRef = useRef<{ title: string; baseVersion: number } | null>(
		null,
	);
	const isHost = room.self?.isHost === true;
	const titleDirty = draftTitle !== originalTitle;
	const showEditor = isHost || openedAsHost;
	const editable =
		isHost &&
		room.connection === "connected" &&
		!busy &&
		!room.mutationPending &&
		!room.candidatesPending &&
		!saving &&
		!closing &&
		Boolean(snapshot) &&
		!["fetching", "drawing", "closed"].includes(snapshot?.status ?? "closed");
	const titleConflict = !saving && snapshot?.title !== originalTitle;

	function changeOpen(next: boolean) {
		if (savingRef.current) return;
		if (!next && titleDirty) {
			setDiscard("close");
			return;
		}
		if (next) {
			setOpenedAsHost(isHost);
			setDraftTitle(snapshot?.title ?? "");
			setOriginalTitle(snapshot?.title ?? "");
			setError("");
			retryTitleRef.current = null;
		}
		setOpen(next);
	}
	function reloadTitle() {
		setDraftTitle(snapshot?.title ?? "");
		setOriginalTitle(snapshot?.title ?? "");
		setError("");
		retryTitleRef.current = null;
	}
	async function saveTitle() {
		if (!editable || !snapshot || !titleDirty || savingRef.current) return;
		const title = draftTitle.trim();
		if (!title) {
			setError("방 이름을 입력해 주세요.");
			return;
		}
		if (
			titleConflict &&
			!(retryTitleRef.current?.title === title && snapshot.title === title)
		) {
			setError(
				"다른 방장이 방 이름을 변경했습니다. 최신 이름을 확인한 뒤 다시 저장해 주세요.",
			);
			return;
		}
		savingRef.current = true;
		setSaving(true);
		setError("");
		const baseVersion =
			retryTitleRef.current?.title === title
				? retryTitleRef.current.baseVersion
				: snapshot.listVersion;
		retryTitleRef.current = { title, baseVersion };
		try {
			const accepted = await room.editRoom({
				baseVersion,
				title,
			});
			if (accepted) {
				setDraftTitle(title);
				setOriginalTitle(title);
				setOpen(false);
				retryTitleRef.current = null;
			}
		} catch {
			setError(
				"방 이름을 저장하지 못했습니다. 입력을 유지했으니 다시 시도해 주세요.",
			);
		} finally {
			savingRef.current = false;
			setSaving(false);
		}
	}
	async function closeRoom() {
		if (!editable || savingRef.current) return;
		savingRef.current = true;
		setClosing(true);
		setError("");
		try {
			if (await room.closeRoom()) {
				setConfirmClose(false);
				setOpen(false);
			} else {
				setError(
					"방을 종료하지 못했습니다. 방 상태를 확인한 뒤 다시 시도해 주세요.",
				);
			}
		} catch {
			setError(
				"방을 종료하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.",
			);
		} finally {
			savingRef.current = false;
			setClosing(false);
		}
	}

	return (
		<>
			<Dialog open={open} onOpenChange={changeOpen}>
				<DialogTrigger asChild>
					<Button
						variant="outline"
						size="icon"
						title="방 설정"
						aria-label="방 설정"
						disabled={!snapshot}
					>
						<Settings size={18} aria-hidden="true" />
					</Button>
				</DialogTrigger>
				<DialogContent
					className="room-settings-dialog"
					aria-labelledby={`${id}-settings-title`}
					onOpenAutoFocus={(event) => {
						if (!showEditor) {
							event.preventDefault();
							document.getElementById(`${id}-settings-title`)?.focus();
						}
					}}
				>
					<DialogHeader>
						<DialogTitle id={`${id}-settings-title`} tabIndex={-1}>
							방 설정
						</DialogTitle>
						<DialogDescription>
							{showEditor
								? "방 이름을 변경합니다."
								: "방장이 정한 방 이름입니다."}
						</DialogDescription>
					</DialogHeader>
					{showEditor ? (
						<>
							<div className="room-settings-field">
								<Label htmlFor={`${id}-room-title`}>방 이름</Label>
								<Input
									id={`${id}-room-title`}
									value={draftTitle}
									maxLength={60}
									disabled={!editable}
									onChange={(event) => setDraftTitle(event.target.value)}
									onKeyDown={(event) => {
										if (
											event.key === "Enter" &&
											!event.nativeEvent.isComposing
										) {
											event.preventDefault();
											void saveTitle();
										}
									}}
								/>
							</div>
							{titleConflict && (
								<div className="room-settings-conflict">
									<p>
										방 이름이 변경되었습니다. 입력한 이름은 보관하고 있어요.
									</p>
									<Button
										variant="outline"
										size="sm"
										disabled={!editable}
										onClick={() =>
											titleDirty ? setDiscard("reload") : reloadTitle()
										}
									>
										최신 방 이름 불러오기
									</Button>
								</div>
							)}
							{!editable && (
								<p className="room-settings-note">
									{room.connection !== "connected"
										? "다시 연결한 뒤 설정을 변경할 수 있습니다."
										: "진행 중인 추첨이나 요청이 끝나면 설정을 변경할 수 있습니다."}
								</p>
							)}
						</>
					) : (
						<dl className="room-settings-summary">
							<div>
								<dt>방 이름</dt>
								<dd>{snapshot?.title}</dd>
							</div>
						</dl>
					)}
					{(error || room.error) && (
						<p role="alert" className="room-error">
							{error || room.error}
						</p>
					)}
					<DialogFooter>
						<AlertDialog
							open={confirmClose}
							onOpenChange={(next) => {
								if (!savingRef.current) {
									setConfirmClose(next);
									setError("");
								}
							}}
						>
							{isHost && (
								<AlertDialogTrigger asChild>
									<Button
										variant="destructive"
										className="sm:me-auto"
										disabled={!editable}
									>
										<LogOut aria-hidden="true" />
										{solo ? "추첨 종료" : "방 종료"}
									</Button>
								</AlertDialogTrigger>
							)}
							<AlertDialogContent>
								<AlertDialogHeader>
									<AlertDialogTitle>
										{solo ? "혼자 추첨을 종료할까요?" : "방을 종료할까요?"}
									</AlertDialogTitle>
									<AlertDialogDescription>
										{solo
											? "현재 혼자 추첨을 종료합니다. 저장하지 않은 변경은 사라집니다. 추첨 기록은 원래 만료 시각까지 확인하고 저장할 수 있어요."
											: "모든 참가자의 이용이 종료되며 이 링크로 다시 입장할 수 없습니다. 저장하지 않은 변경은 사라집니다. 추첨 기록은 원래 만료 시각까지 확인하고 저장할 수 있어요."}
									</AlertDialogDescription>
								</AlertDialogHeader>
								{error && (
									<p role="alert" className="room-error">
										{error}
									</p>
								)}
								<AlertDialogFooter>
									<AlertDialogCancel disabled={closing}>취소</AlertDialogCancel>
									<AlertDialogAction
										data-variant="destructive"
										className="ui-button-destructive"
										disabled={!editable}
										onClick={(event) => {
											event.preventDefault();
											void closeRoom();
										}}
									>
										{closing ? "종료 중…" : solo ? "추첨 종료" : "방 종료"}
									</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>
						<Button
							variant="outline"
							disabled={saving || closing}
							onClick={() => changeOpen(false)}
						>
							닫기
						</Button>
						{showEditor && (
							<Button
								disabled={!editable || !titleDirty}
								onClick={() => void saveTitle()}
							>
								{saving ? "저장 중…" : "변경 저장"}
							</Button>
						)}
					</DialogFooter>
				</DialogContent>
			</Dialog>
			<AlertDialog
				open={discard !== null}
				onOpenChange={(next) => {
					if (!next) setDiscard(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>변경한 방 이름을 버릴까요?</AlertDialogTitle>
						<AlertDialogDescription>
							아직 저장하지 않은 방 이름이 있습니다.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>계속 편집</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								if (discard === "reload") reloadTitle();
								else {
									setDraftTitle(originalTitle);
									setOpen(false);
								}
								setDiscard(null);
							}}
						>
							변경 버리기
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
