import * as Dialog from "@radix-ui/react-dialog";
import { useRouter } from "@tanstack/react-router";
import { LoaderCircle, Users, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import {
	clampLunchRoomNickname,
	isLunchRoomId,
	lunchRoomLimits,
	normalizeLunchRoomNickname,
} from "@/lib/lunchRoom";
import {
	prepareLunchRoomEntry,
	readLunchRoomName,
	saveLunchRoomHost,
	saveLunchRoomName,
} from "@/lib/lunchRoomClient";
import "./create-lunch-room.css";

export default function CreateLunchRoom({
	candidateIds,
	disabled = false,
	inline = false,
}: {
	candidateIds: string[];
	disabled?: boolean;
	inline?: boolean;
}) {
	const id = useId();
	const router = useRouter({ warn: false });
	const [open, setOpen] = useState(false);
	const [title, setTitle] = useState("오늘 점심 추첨");
	const [name, setName] = useState("방장");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");
	const creating = useRef(false);
	const requestRef = useRef<AbortController | null>(null);
	useEffect(() => {
		setName(clampLunchRoomNickname(readLunchRoomName() ?? "") || "방장");
		return () => requestRef.current?.abort();
	}, []);

	async function create(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (creating.current) return;
		const hostName = normalizeLunchRoomNickname(name);
		if (!hostName) {
			setError(
				`닉네임은 1~${lunchRoomLimits.maxNicknameLength}자로 입력해 주세요.`,
			);
			return;
		}
		if (candidateIds.length < 2) {
			setError("추첨 후보를 두 곳 이상 선택해 주세요.");
			return;
		}
		creating.current = true;
		setPending(true);
		setError("");
		const controller = new AbortController();
		requestRef.current = controller;
		try {
			const response = await fetch("/api/lunch/rooms", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					title: title.trim(),
					hostName,
					candidateIds,
				}),
				signal: controller.signal,
			});
			const body: unknown = await response.json();
			if (controller.signal.aborted) return;
			const value =
				body && typeof body === "object"
					? (body as Record<string, unknown>)
					: {};
			if (!response.ok) {
				throw new Error(
					typeof value.error === "string"
						? value.error
						: "방을 만들지 못했습니다. 다시 시도해 주세요.",
				);
			}
			if (
				!isLunchRoomId(value.roomId) ||
				typeof value.hostToken !== "string" ||
				!/^[a-f0-9]{64}$/.test(value.hostToken)
			) {
				throw new Error("방 정보를 확인할 수 없습니다. 다시 시도해 주세요.");
			}
			saveLunchRoomHost(value.roomId, value.hostToken);
			saveLunchRoomName(hostName);
			prepareLunchRoomEntry(value.roomId, hostName);
			await router.navigate({
				to: "/lunch-room/$roomId",
				params: { roomId: value.roomId },
			});
			setOpen(false);
		} catch (cause) {
			if (controller.signal.aborted) return;
			setError(
				cause instanceof Error
					? cause.message
					: "연결을 확인한 뒤 다시 시도해 주세요.",
			);
		} finally {
			creating.current = false;
			if (!controller.signal.aborted) setPending(false);
		}
	}

	const fields = (
		<form
			className="lunch-create-form"
			onSubmit={(event) => void create(event)}
			aria-busy={pending}
		>
			<label htmlFor={`${id}-title`}>방 이름</label>
			<input
				id={`${id}-title`}
				value={title}
				onChange={(event) => setTitle(event.target.value)}
				required
				maxLength={60}
				disabled={pending}
			/>
			<label htmlFor={`${id}-name`}>{inline ? "닉네임" : "내 이름"}</label>
			<input
				id={`${id}-name`}
				value={name}
				onChange={(event) => setName(event.target.value)}
				required
				maxLength={lunchRoomLimits.maxNicknameLength}
				aria-describedby={`${id}-name-help`}
				disabled={pending}
			/>
			<p id={`${id}-name-help`}>
				최대 {lunchRoomLimits.maxNicknameLength}자 · {name.length}/
				{lunchRoomLimits.maxNicknameLength}
			</p>
			<p>
				회사 주변 음식점 {candidateIds.length}곳으로 시작합니다. 후보는 방에서
				바꿀 수 있습니다.
			</p>
			{error && (
				<p role="alert" className="lunch-create-error">
					{error}
				</p>
			)}
			<button
				type="submit"
				className="lunch-create-submit"
				disabled={
					pending ||
					!title.trim() ||
					!name.trim() ||
					name.trim().length > lunchRoomLimits.maxNicknameLength ||
					candidateIds.length < 2
				}
			>
				{pending && <LoaderCircle size={18} aria-hidden="true" />}{" "}
				{pending ? "방 만드는 중…" : "방 만들고 입장하기"}
			</button>
		</form>
	);
	if (inline)
		return (
			<section
				className="lunch-create-inline"
				aria-labelledby={`${id}-create-title`}
			>
				<h2 id={`${id}-create-title`}>새 추첨방</h2>
				{fields}
			</section>
		);
	return (
		<Dialog.Root
			open={open}
			onOpenChange={(next) => {
				if (!pending) {
					setOpen(next);
					setError("");
				}
			}}
		>
			<Dialog.Trigger asChild>
				<button
					type="button"
					className="lunch-create-trigger"
					disabled={disabled}
				>
					<Users size={17} aria-hidden="true" /> 방 만들기
				</button>
			</Dialog.Trigger>
			<Dialog.Portal>
				<Dialog.Overlay className="lunch-create-backdrop" />
				<Dialog.Content
					className="lunch-create-dialog"
					onEscapeKeyDown={(event) => {
						if (pending) event.preventDefault();
					}}
					onPointerDownOutside={(event) => {
						if (pending) event.preventDefault();
					}}
				>
					<Dialog.Title>함께 점심 추첨하기</Dialog.Title>
					<Dialog.Description>
						참가 링크를 공유하면 같은 룰렛을 보며 채팅할 수 있습니다.
					</Dialog.Description>
					<Dialog.Close asChild>
						<button
							type="button"
							className="lunch-create-close"
							aria-label="닫기"
							disabled={pending}
						>
							<X size={20} />
						</button>
					</Dialog.Close>
					{fields}
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
