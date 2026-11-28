import {
	ArrowRight,
	Check,
	ChevronDown,
	Disc3,
	GalleryVertical,
	List,
	LoaderCircle,
	X,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type DrawView, drawViewLabels } from "@/lib/drawView";
import type { RoomCandidate } from "@/lib/lunchRoom";

const games = [
	{ id: "slot-v1", icon: GalleryVertical },
	{ id: "wheel", icon: Disc3 },
] as const;

export function RoomGameWorkspace({
	children,
	chatCollapsed,
	active,
	target,
	isHost,
	disabled,
	onSelect,
}: {
	children: ReactNode;
	chatCollapsed?: boolean;
	active: DrawView;
	target?: DrawView;
	isHost: boolean;
	disabled: boolean;
	onSelect: (game: DrawView, trigger: HTMLButtonElement) => void;
}) {
	const mobileTrigger = useRef<HTMLButtonElement>(null);
	const choosing = useRef(false);
	return (
		<div className="room-workspace">
			{isHost && (
				<nav className="room-game-nav" aria-label="게임 목록">
					<div className="room-game-rail">
						<h2>게임 목록</h2>
						{games.map(({ id, icon: Icon }) => (
							<Button
								key={id}
								size="touch"
								variant={id === active ? "secondary" : "ghost"}
								aria-pressed={id === active}
								disabled={disabled}
								onClick={(event) => {
									if (id !== active) onSelect(id, event.currentTarget);
								}}
							>
								<Icon aria-hidden="true" />
								{drawViewLabels[id]}
								{id === active ? (
									<Check className="room-game-mark" aria-hidden="true" />
								) : (
									id === target && (
										<ArrowRight className="room-game-mark" aria-hidden="true" />
									)
								)}
							</Button>
						))}
					</div>
					<div className="room-game-picker">
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									ref={mobileTrigger}
									variant="outline"
									size="touch"
									disabled={disabled}
								>
									<List aria-hidden="true" />
									게임 변경
									<ChevronDown aria-hidden="true" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent
								align="start"
								aria-label="게임 선택"
								onCloseAutoFocus={(event) => {
									if (choosing.current) event.preventDefault();
									choosing.current = false;
								}}
							>
								{games.map(({ id, icon: Icon }) => (
									<DropdownMenuItem
										key={id}
										onSelect={() => {
											if (id !== active && mobileTrigger.current) {
												choosing.current = true;
												onSelect(id, mobileTrigger.current);
											}
										}}
									>
										<Icon aria-hidden="true" />
										{drawViewLabels[id]}
										{id === active && (
											<>
												<Check aria-hidden="true" />
												<span className="sr-only">현재 게임</span>
											</>
										)}
									</DropdownMenuItem>
								))}
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</nav>
			)}
			<div className="room-layout" data-chat-collapsed={chatCollapsed}>
				{children}
			</div>
		</div>
	);
}

export function RoomGameConfirmation({
	active,
	target,
	candidates,
	eligibleCount,
	hasResult,
	disabled,
	pending,
	onKeep,
	onEdit,
	onCancel,
}: {
	active: DrawView;
	target: DrawView;
	candidates: RoomCandidate[];
	eligibleCount: number;
	hasResult: boolean;
	disabled: boolean;
	pending: boolean;
	onKeep: () => void;
	onEdit: () => void;
	onCancel: () => void;
}) {
	const id = useId();
	const keep = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		keep.current?.focus();
	}, []);
	return (
		<section
			className="room-game-confirm"
			aria-labelledby={id}
			onKeyDown={(event) => {
				if (event.key === "Escape" && !pending) {
					event.preventDefault();
					onCancel();
				}
			}}
		>
			<div className="room-game-confirm-inner">
				<div className="room-game-confirm-header">
					<p className="room-game-route">
						{drawViewLabels[active]} <ArrowRight aria-hidden="true" />{" "}
						{drawViewLabels[target]}
					</p>
					<Button
						size="touch"
						variant="ghost"
						disabled={pending}
						aria-label="게임 변경 취소"
						onClick={onCancel}
					>
						<X aria-hidden="true" />
					</Button>
				</div>
				<h2 id={id}>{drawViewLabels[target]}에서도 이 목록을 쓸까요?</h2>
				<div className="room-game-pool">
					<strong>현재 후보 {candidates.length}개</strong>
					<span>
						{candidates
							.slice(0, 3)
							.map(({ name }) => name)
							.join(" · ")}
						{candidates.length > 3 && ` 외 ${candidates.length - 3}개`}
					</span>
					{eligibleCount !== candidates.length && (
						<span>이번 추첨에 포함된 후보 {eligibleCount}개</span>
					)}
				</div>
				{hasResult && (
					<p className="room-game-result-notice">
						게임을 바꾸면 이번 투표가 마감되고 결과는 지난 기록에 보관돼요.
					</p>
				)}
				<div className="room-game-actions">
					<Button
						size="touch"
						ref={keep}
						disabled={disabled}
						aria-busy={pending || undefined}
						onClick={onKeep}
					>
						{pending && (
							<LoaderCircle
								aria-hidden="true"
								className="motion-safe:animate-spin"
							/>
						)}
						{pending ? "전환 중…" : "이 목록으로 계속"}
					</Button>
					<Button
						size="touch"
						variant="outline"
						disabled={disabled}
						onClick={onEdit}
					>
						목록 바꾸기
					</Button>
				</div>
			</div>
		</section>
	);
}
