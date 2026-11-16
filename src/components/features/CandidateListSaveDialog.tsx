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
import { saveCandidateList } from "@/lib/candidateLibrary";
import type { RoomCandidate } from "@/lib/lunchRoom";

export default function CandidateListSaveDialog({
	open,
	onOpenChange,
	name,
	candidates,
	disabled,
	returnFocusRef,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	name: string;
	candidates: RoomCandidate[];
	disabled: boolean;
	returnFocusRef?: RefObject<HTMLButtonElement | null>;
}) {
	const id = useId();
	const inputRef = useRef<HTMLInputElement | null>(null);
	const [title, setTitle] = useState(name);
	const [error, setError] = useState("");
	const [saved, setSaved] = useState(false);
	function save() {
		if (disabled || saved) return;
		try {
			saveCandidateList({
				id: crypto.randomUUID(),
				name: title,
				items: candidates.map((candidate) => ({
					id: candidate.id,
					name: candidate.name,
					category: candidate.category === "미분류" ? "" : candidate.category,
					included: true,
					...(candidate.menu ? { menu: candidate.menu } : {}),
					...(candidate.distanceMeters === undefined
						? {}
						: { distanceMeters: candidate.distanceMeters }),
				})),
			});
			setError("");
			setSaved(true);
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "목록을 저장하지 못했습니다. 다시 시도해 주세요.",
			);
		}
	}
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="room-save-list-dialog"
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					setTitle(name);
					setError("");
					setSaved(false);
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
						이 브라우저에 사본을 저장합니다. 방의 목록과 게임 필터는 바뀌지
						않습니다.
					</DialogDescription>
				</DialogHeader>
				{saved ? (
					<output>
						목록을 저장했습니다. 다음에 목록 불러오기에서 사용할 수 있어요.
					</output>
				) : (
					<form
						onSubmit={(event) => {
							event.preventDefault();
							save();
						}}
					>
						<Label htmlFor={`${id}-name`}>목록 이름</Label>
						<Input
							ref={inputRef}
							id={`${id}-name`}
							value={title}
							maxLength={40}
							disabled={disabled}
							onChange={(event) => setTitle(event.target.value)}
							aria-invalid={Boolean(error)}
							aria-describedby={error ? `${id}-error` : undefined}
						/>
						<p className="room-panel-note">
							후보 {candidates.length}개 · 기존 저장본은 유지됩니다.
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
							>
								취소
							</Button>
							<Button type="submit" disabled={disabled}>
								사본 저장
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
