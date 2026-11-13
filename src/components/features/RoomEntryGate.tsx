import {
	ArrowRight,
	CheckCircle2,
	CircleX,
	LoaderCircle,
	TriangleAlert,
	UserRound,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useNicknameAvailability } from "@/hooks/useNicknameAvailability";
import {
	clampLunchRoomNickname,
	lunchRoomLimits,
	normalizeLunchRoomNickname,
} from "@/lib/lunchRoom";
import { readLunchRoomName } from "@/lib/lunchRoomClient";
import "./room-entry.css";

export default function RoomEntryGate({
	roomId,
	pending,
	error,
	onEnter,
	onClearError,
}: {
	roomId: string;
	pending: boolean;
	error: string;
	onEnter: (name: string) => boolean;
	onClearError: () => void;
}) {
	const id = useId();
	const inputRef = useRef<HTMLInputElement>(null);
	const [name, setName] = useState("");
	const [composing, setComposing] = useState(false);
	const [validationError, setValidationError] = useState("");
	const message = validationError || error;
	const availability = useNicknameAvailability({
		roomId,
		name,
		composing,
		enabled: !pending,
		rejected: Boolean(error),
	});
	const canEnter = !pending && availability.status === "available";
	const availabilityMessage = {
		idle: "닉네임을 입력하면 중복 여부를 확인합니다.",
		invalid: `닉네임은 1~${lunchRoomLimits.maxNicknameLength}자로 입력해 주세요.`,
		checking: "확인 중…",
		available: "사용할 수 있는 닉네임입니다.",
		taken: "이미 사용 중인 닉네임입니다.",
		error: error
			? "닉네임을 다시 확인해 주세요."
			: "닉네임을 확인하지 못했습니다.",
	}[availability.status];

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
					const value = normalizeLunchRoomNickname(name);
					if (!value) {
						setValidationError(
							`닉네임은 1~${lunchRoomLimits.maxNicknameLength}자로 입력해 주세요.`,
						);
						inputRef.current?.focus();
						return;
					}
					if (!canEnter || composing) return;
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
					aria-invalid={
						Boolean(message) ||
						availability.status === "taken" ||
						availability.status === "invalid"
					}
					aria-describedby={`${id}-hint ${id}-availability${message ? ` ${id}-error` : ""}`}
					onChange={(event) => {
						setName(event.target.value);
						setValidationError("");
						onClearError();
					}}
					onCompositionStart={() => setComposing(true)}
					onCompositionEnd={(event) => {
						setName(event.currentTarget.value);
						setComposing(false);
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
				<output
					id={`${id}-availability`}
					htmlFor={`${id}-name`}
					className="room-entry-availability"
					data-status={availability.status}
					aria-live="polite"
					aria-atomic="true"
				>
					{availability.status === "checking" ? (
						<LoaderCircle
							className="room-entry-spinner"
							size={16}
							aria-hidden="true"
						/>
					) : availability.status === "available" ? (
						<CheckCircle2 size={16} aria-hidden="true" />
					) : availability.status === "taken" ||
						availability.status === "invalid" ? (
						<CircleX size={16} aria-hidden="true" />
					) : availability.status === "error" ? (
						<TriangleAlert size={16} aria-hidden="true" />
					) : null}
					<span>{pending ? "입장 중…" : availabilityMessage}</span>
					{!pending &&
						(availability.status === "error" ||
							availability.status === "taken") && (
							<button
								type="button"
								className="room-entry-recheck"
								onClick={() => {
									onClearError();
									availability.retry();
								}}
							>
								다시 확인
							</button>
						)}
				</output>
				{message && (
					<p id={`${id}-error`} className="room-entry-error" role="alert">
						{message}
					</p>
				)}
				<button
					type="submit"
					className="room-entry-submit"
					disabled={!canEnter}
				>
					{pending ? (
						<LoaderCircle
							className="room-entry-spinner"
							size={18}
							aria-hidden="true"
						/>
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
