import {
	ArrowRight,
	CheckCircle2,
	CircleX,
	LoaderCircle,
	TriangleAlert,
	UserRound,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNicknameAvailability } from "@/hooks/useNicknameAvailability";
import { useRoomEntryInfo } from "@/hooks/useRoomEntryInfo";
import {
	clampLunchRoomNickname,
	lunchRoomLimits,
	normalizeLunchRoomNickname,
} from "@/lib/lunchRoom";
import { readLunchRoomName } from "@/lib/lunchRoomClient";
import ClosedRoomHistory, { RoomTerminalActions } from "./ClosedRoomHistory";
import "./room-entry.css";

export default function RoomEntryGate({
	roomId,
	loading = false,
	pending,
	error,
	onEnter,
	onClearError,
	onReconnect,
}: {
	roomId: string;
	loading?: boolean;
	pending: boolean;
	error: string;
	onEnter: (name: string) => boolean;
	onClearError: () => void;
	onReconnect?: () => void;
}) {
	const id = useId();
	const inputRef = useRef<HTMLInputElement>(null);
	const [name, setName] = useState("");
	const [composing, setComposing] = useState(false);
	const [validationError, setValidationError] = useState("");
	const message = validationError || error;
	const entryInfo = useRoomEntryInfo({ roomId, enabled: !loading });
	const availability = useNicknameAvailability({
		roomId,
		name,
		composing,
		enabled: !loading && !pending && entryInfo.status !== "closed",
		rejected: Boolean(error),
	});
	const canEnter = !pending && availability.status === "available";
	const showRetry =
		!pending &&
		(availability.status === "error" || availability.status === "taken");
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
	}, []);
	useEffect(() => {
		if (!loading && !pending) inputRef.current?.focus();
	}, [loading, pending]);
	useEffect(() => {
		if (error && !loading && !pending) inputRef.current?.focus();
	}, [loading, error, pending]);

	if (!loading && entryInfo.status === "closed")
		return (
			<section
				className="room-entry-card room-closed-entry"
				aria-labelledby={`${id}-closed-title`}
			>
				<h1 id={`${id}-closed-title`}>방이 종료되었습니다</h1>
				<p>
					방장이 방을 종료했습니다. 남아 있는 추첨 기록을 확인하고 저장할 수
					있어요.
				</p>
				<RoomTerminalActions />
				<ClosedRoomHistory key={roomId} roomId={roomId} />
			</section>
		);

	if (loading)
		return (
			<Card className="w-full max-w-sm border-border">
				<CardHeader>
					<CardTitle>
						<h1 className="flex items-center gap-2 leading-normal">
							<LoaderCircle
								size={18}
								className="motion-safe:animate-spin"
								aria-hidden="true"
							/>
							입장 준비 중…
						</h1>
					</CardTitle>
					<output className="sr-only">
						방 연결과 참가 정보를 확인하고 있습니다.
					</output>
				</CardHeader>
				{error && (
					<CardContent className="grid gap-2">
						<p className="text-sm text-destructive" role="alert">
							{error}
						</p>
						{onReconnect && (
							<Button className="justify-self-start" onClick={onReconnect}>
								다시 연결
							</Button>
						)}
					</CardContent>
				)}
				<CardFooter>
					<Button asChild variant="link" size="sm">
						<a href="/">홈으로 돌아가기</a>
					</Button>
				</CardFooter>
			</Card>
		);

	return (
		<section className="room-entry-card" aria-labelledby={`${id}-title`}>
			<header className="room-entry-heading">
				<div className="room-entry-icon" aria-hidden="true">
					<UserRound size={24} />
				</div>
				<div className="room-entry-title-block">
					<p className="room-entry-eyebrow">추첨방 입장</p>
					<h1 id={`${id}-title`}>{entryInfo.title ?? "점심 추첨방"}</h1>
				</div>
			</header>
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
					<Label htmlFor={`${id}-name`}>닉네임</Label>
					<span aria-hidden="true">
						{name.length}/{lunchRoomLimits.maxNicknameLength}
					</span>
				</div>
				<div
					className="room-entry-input-wrap"
					data-status={message ? "error" : availability.status}
				>
					<Input
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
						aria-describedby={`${id}-hint ${id}-availability`}
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
					<span className="room-entry-input-status" aria-hidden="true">
						{availability.status === "checking" || pending ? (
							<LoaderCircle className="room-entry-spinner" size={18} />
						) : availability.status === "available" && !message ? (
							<CheckCircle2 size={18} />
						) : availability.status === "taken" ||
							availability.status === "invalid" ||
							message ? (
							<CircleX size={18} />
						) : availability.status === "error" ? (
							<TriangleAlert size={18} />
						) : null}
					</span>
				</div>
				<p id={`${id}-hint`} className="sr-only">
					1~{lunchRoomLimits.maxNicknameLength}자 · 같은 방에서 사용 중인
					닉네임은 쓸 수 없습니다.
				</p>
				<output
					id={`${id}-availability`}
					htmlFor={`${id}-name`}
					className="room-entry-availability"
					data-status={message ? "error" : availability.status}
					role={message ? "alert" : "status"}
					aria-live={message ? "assertive" : "polite"}
					aria-atomic="true"
				>
					<span
						className={
							!message &&
							["idle", "checking", "available"].includes(availability.status)
								? "sr-only"
								: undefined
						}
					>
						{message || (pending ? "입장 중…" : availabilityMessage)}
					</span>
					<Button
						variant="link"
						size="sm"
						type="button"
						className="room-entry-recheck"
						data-visible={showRetry}
						aria-hidden={!showRetry}
						tabIndex={showRetry ? undefined : -1}
						onClick={() => {
							onClearError();
							availability.retry();
						}}
					>
						다시 확인
					</Button>
				</output>
				<Button
					variant="default"
					size="lg"
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
				</Button>
			</form>
			<Button asChild variant="link" size="sm" className="room-entry-back">
				<a href="/">홈으로 돌아가기</a>
			</Button>
		</section>
	);
}
