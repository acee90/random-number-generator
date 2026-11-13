import { ArrowRight, LoaderCircle, UserRound } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { clampLunchRoomNickname, lunchRoomLimits } from "@/lib/lunchRoom";
import { readLunchRoomName } from "@/lib/lunchRoomClient";
import "./room-entry.css";

export default function RoomEntryGate({
	pending,
	error,
	onEnter,
	onClearError,
}: {
	pending: boolean;
	error: string;
	onEnter: (name: string) => boolean;
	onClearError: () => void;
}) {
	const id = useId();
	const inputRef = useRef<HTMLInputElement>(null);
	const [name, setName] = useState("");
	const [validationError, setValidationError] = useState("");
	const message = validationError || error;

	useEffect(() => {
		setName(clampLunchRoomNickname(readLunchRoomName() ?? ""));
		inputRef.current?.focus();
	}, []);
	useEffect(() => {
		if (error && !pending) inputRef.current?.focus();
	}, [error, pending]);

	return (
		<section className="room-entry-card" aria-labelledby={`${id}-title`}>
			<div className="room-entry-icon" aria-hidden="true">
				<UserRound size={24} />
			</div>
			<p className="room-entry-eyebrow">점심 추첨방 입장</p>
			<h1 id={`${id}-title`}>닉네임을 정해 주세요</h1>
			<p className="room-entry-description">
				입장 버튼을 누르면 룰렛과 채팅에 참가합니다.
			</p>
			<form
				className="room-entry-form"
				aria-label="추첨방 입장"
				aria-busy={pending}
				noValidate
				onSubmit={(event) => {
					event.preventDefault();
					if (pending) return;
					const value = name.trim();
					if (!value || value.length > lunchRoomLimits.maxNicknameLength) {
						setValidationError(
							`닉네임은 1~${lunchRoomLimits.maxNicknameLength}자로 입력해 주세요.`,
						);
						inputRef.current?.focus();
						return;
					}
					setValidationError("");
					onEnter(value);
				}}
			>
				<div className="room-entry-field-heading">
					<label htmlFor={`${id}-name`}>닉네임</label>
					<span aria-hidden="true">
						{name.length}/{lunchRoomLimits.maxNicknameLength}
					</span>
				</div>
				<input
					id={`${id}-name`}
					ref={inputRef}
					value={name}
					disabled={pending}
					maxLength={lunchRoomLimits.maxNicknameLength}
					autoComplete="nickname"
					placeholder="사용할 닉네임 입력"
					aria-invalid={Boolean(message)}
					aria-describedby={`${id}-hint${message ? ` ${id}-error` : ""}`}
					onChange={(event) => {
						setName(event.target.value);
						setValidationError("");
						onClearError();
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter" && event.nativeEvent.isComposing)
							event.preventDefault();
					}}
				/>
				<p id={`${id}-hint`} className="room-entry-hint">
					1~{lunchRoomLimits.maxNicknameLength}자 · 같은 방에서 사용 중인
					닉네임은 쓸 수 없습니다.
				</p>
				{message && (
					<p id={`${id}-error`} className="room-entry-error" role="alert">
						{message}
					</p>
				)}
				<button
					type="submit"
					className="room-entry-submit"
					disabled={pending || !name.trim()}
				>
					{pending ? (
						<LoaderCircle size={18} aria-hidden="true" />
					) : (
						<ArrowRight size={18} aria-hidden="true" />
					)}
					{pending ? "입장 중…" : "입장하기"}
				</button>
			</form>
			<a className="room-entry-back" href="/">
				홈으로 돌아가기
			</a>
		</section>
	);
}
