import { Check } from "lucide-react";
import { type RefObject, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	CandidateListConflict,
	mutateCandidateLibrary,
	readCandidateLibrary,
	saveCandidateList,
	updateCandidateList,
	type VersionedCandidateList,
} from "@/lib/candidateLibrary";
import type { RoomCandidate } from "@/lib/lunchRoom";
import "./candidate-list-save-dialog.css";

type SaveMode = "overwrite" | "copy";

function findSavedList(sourceId?: string): VersionedCandidateList | null {
	if (!sourceId?.startsWith("saved:")) return null;
	const id = sourceId.slice("saved:".length);
	if (!id) return null;
	return readCandidateLibrary().lists.find((entry) => entry.id === id) ?? null;
}

export default function CandidateListSaveDialog({
	open,
	onOpenChange,
	name,
	sourceId,
	candidates,
	disabled,
	returnFocusRef,
	onSaved,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	name: string;
	sourceId?: string;
	candidates: RoomCandidate[];
	disabled: boolean;
	returnFocusRef?: RefObject<HTMLButtonElement | null>;
	onSaved?: (list: VersionedCandidateList) => void;
}) {
	const id = useId();
	const inputRef = useRef<HTMLInputElement | null>(null);
	const [title, setTitle] = useState(name);
	const [targetList, setTargetList] = useState<VersionedCandidateList | null>(
		null,
	);
	const [mode, setMode] = useState<SaveMode>("copy");
	const [error, setError] = useState("");
	const [savedMode, setSavedMode] = useState<SaveMode | null>(null);
	const [pending, setPending] = useState(false);
	const saved = savedMode !== null;

	async function save() {
		if (disabled || saved || pending) return;
		setPending(true);
		try {
			const items = candidates.map((candidate) => ({
				id: candidate.id,
				name: candidate.name,
				category: candidate.category === "미분류" ? "" : candidate.category,
				included: true,
				...(candidate.menu ? { menu: candidate.menu } : {}),
				...(candidate.distanceMeters === undefined
					? {}
					: { distanceMeters: candidate.distanceMeters }),
			}));
			const currentMode: SaveMode =
				mode === "overwrite" && targetList ? "overwrite" : "copy";
			const result = mutateCandidateLibrary(() =>
				currentMode === "overwrite" && targetList
					? updateCandidateList(
							{
								id: targetList.id,
								name: title,
								items,
							},
							targetList.revision,
						)
					: saveCandidateList({
							id: crypto.randomUUID(),
							name: title,
							items,
						}),
			);
			const persisted = result instanceof Promise ? await result : result;
			setError("");
			setSavedMode(currentMode);
			onSaved?.(persisted);
		} catch (cause) {
			if (cause instanceof CandidateListConflict) {
				setTargetList(null);
				setMode("copy");
				setError(
					"다른 탭에서 기존 목록이 바뀌었어요. 새 사본으로 저장할 수 있습니다.",
				);
			} else {
				setError(
					cause instanceof Error
						? cause.message
						: "목록을 저장하지 못했습니다. 다시 시도해 주세요.",
				);
			}
		} finally {
			setPending(false);
		}
	}
	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!pending) onOpenChange(next);
			}}
		>
			<DialogContent
				className="room-save-list-dialog"
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					const existing = findSavedList(sourceId);
					setTargetList(existing);
					setMode(existing ? "overwrite" : "copy");
					setTitle(existing?.name ?? name);
					setError("");
					setSavedMode(null);
					requestAnimationFrame(() => inputRef.current?.focus());
				}}
				onCloseAutoFocus={(event) => {
					if (returnFocusRef?.current?.isConnected) {
						event.preventDefault();
						returnFocusRef.current.focus();
					}
				}}
			>
				<DialogHeader>
					<DialogTitle>내 목록에 저장</DialogTitle>
					<DialogDescription>
						{targetList
							? "불러온 개인 목록을 덮어쓰거나 새 사본으로 저장할 수 있어요. 방의 목록과 필터는 바뀌지 않습니다."
							: "이 브라우저에 사본을 저장합니다. 방의 목록과 게임 필터는 바뀌지 않습니다."}
					</DialogDescription>
				</DialogHeader>
				{saved ? (
					<output>
						{savedMode === "overwrite"
							? "기존 목록을 최신 내용으로 저장했습니다."
							: "목록을 저장했습니다. 다음에 목록 불러오기에서 사용할 수 있어요."}
					</output>
				) : (
					<form
						onSubmit={(event) => {
							event.preventDefault();
							save();
						}}
					>
						{targetList && (
							<fieldset className="room-save-mode" aria-label="저장 방식">
								<Button
									type="button"
									variant="outline"
									size="touch"
									aria-pressed={mode === "overwrite"}
									disabled={disabled || pending}
									onClick={() => {
										setMode("overwrite");
										setError("");
									}}
								>
									{mode === "overwrite" && (
										<Check size={14} aria-hidden="true" />
									)}
									기존 목록 덮어쓰기
								</Button>
								<Button
									type="button"
									variant="outline"
									size="touch"
									aria-pressed={mode === "copy"}
									disabled={disabled || pending}
									onClick={() => {
										setMode("copy");
										setError("");
									}}
								>
									{mode === "copy" && <Check size={14} aria-hidden="true" />}새
									사본으로 저장
								</Button>
							</fieldset>
						)}
						<Label htmlFor={`${id}-name`}>목록 이름</Label>
						<Input
							ref={inputRef}
							id={`${id}-name`}
							value={title}
							maxLength={40}
							disabled={disabled || pending}
							onChange={(event) => setTitle(event.target.value)}
							aria-invalid={Boolean(error)}
							aria-describedby={error ? `${id}-error` : undefined}
						/>
						<p className="room-panel-note">
							{mode === "overwrite" && targetList
								? `후보 ${candidates.length}개 · '${targetList.name}' 목록을 덮어씁니다.`
								: `후보 ${candidates.length}개 · 기존 저장본은 유지됩니다.`}
						</p>
						{error && (
							<p role="alert" id={`${id}-error`} className="room-error">
								{error}
							</p>
						)}
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => onOpenChange(false)}
								disabled={pending}
							>
								취소
							</Button>
							<Button type="submit" disabled={disabled || pending}>
								{pending
									? "저장 중…"
									: mode === "overwrite" && targetList
										? "덮어쓰기 저장"
										: "사본 저장"}
							</Button>
						</DialogFooter>
					</form>
				)}
				{saved && (
					<DialogFooter>
						<Button onClick={() => onOpenChange(false)}>닫기</Button>
					</DialogFooter>
				)}
			</DialogContent>
		</Dialog>
	);
}
