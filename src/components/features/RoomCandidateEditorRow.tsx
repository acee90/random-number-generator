import {
	Check,
	CircleMinus,
	Ellipsis,
	Pencil,
	Tag,
	Trash2,
} from "lucide-react";
import { type ReactNode, useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { RoomCandidate } from "@/lib/lunchRoom";
import RoomCandidateAuthor from "./RoomCandidateAuthor";

export default function RoomCandidateEditorRow({
	candidate,
	category,
	exclusion,
	checked,
	recentlyAdded,
	disabled,
	nameEditor,
	nameTriggerRef,
	menuOpen,
	onMenuOpenChange,
	onToggle,
	onEditName,
	onEditCategory,
	onRemove,
}: {
	candidate: RoomCandidate;
	category: string;
	exclusion?: "제외" | "분류 제외" | "당첨 제외";
	checked: boolean;
	recentlyAdded: boolean;
	disabled: boolean;
	nameEditor?: ReactNode;
	nameTriggerRef: (element: HTMLButtonElement | null) => void;
	menuOpen: boolean;
	onMenuOpenChange: (open: boolean) => void;
	onToggle: (checked: boolean) => void;
	onEditName: () => void;
	onEditCategory: (trigger: HTMLButtonElement | null) => void;
	onRemove: () => void;
}) {
	const stateId = useId();
	const triggerRef = useRef<HTMLButtonElement>(null);
	const actionSelected = useRef<"rename" | "move-focus" | null>(null);
	const name = candidate.name || "이름을 입력해 주세요";
	return (
		<li
			className="room-simple-row"
			data-candidate-id={candidate.id}
			data-included={!exclusion}
		>
			<label className="room-simple-check" htmlFor={`${stateId}-include`}>
				<Input
					id={`${stateId}-include`}
					type="checkbox"
					checked={checked}
					disabled={disabled}
					aria-label={`${name} 추첨 포함`}
					aria-describedby={exclusion ? stateId : undefined}
					onChange={(event) => onToggle(event.currentTarget.checked)}
				/>
			</label>
			<div className="room-simple-item">
				<div className="room-simple-identity">
					{nameEditor ?? (
						<Button
							ref={nameTriggerRef}
							variant="ghost"
							size="auto"
							className="room-simple-name"
							aria-label={`${name} 이름 수정`}
							disabled={disabled}
							onClick={onEditName}
						>
							{name}
						</Button>
					)}
					{(candidate.ownerName || recentlyAdded || exclusion) && (
						<div className="room-simple-state-badges">
							{candidate.ownerName && (
								<RoomCandidateAuthor name={candidate.ownerName} />
							)}
							{recentlyAdded && (
								<span className="room-simple-state-badge room-simple-state-added">
									<Check size={12} aria-hidden="true" /> 추가됨
								</span>
							)}
							{exclusion && (
								<span className="room-simple-state-badge" id={stateId}>
									<CircleMinus size={12} aria-hidden="true" /> {exclusion}
								</span>
							)}
						</div>
					)}
				</div>
				<span className="room-simple-category">{category}</span>
			</div>
			<DropdownMenu open={menuOpen} onOpenChange={onMenuOpenChange}>
				<DropdownMenuTrigger asChild>
					<Button
						ref={triggerRef}
						variant="ghost"
						size="icon"
						aria-label={`${name} 후보 관리`}
						disabled={disabled}
					>
						<Ellipsis size={16} aria-hidden="true" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent
					aria-label={`${name} 후보 관리`}
					onCloseAutoFocus={(event) => {
						const action = actionSelected.current;
						if (!action) return;
						event.preventDefault();
						actionSelected.current = null;
						if (action === "rename") onEditName();
					}}
				>
					<DropdownMenuItem
						disabled={disabled}
						onSelect={() => {
							actionSelected.current = "rename";
						}}
					>
						<Pencil size={16} aria-hidden="true" /> 이름 수정
					</DropdownMenuItem>
					<DropdownMenuItem
						disabled={disabled}
						onSelect={() => {
							actionSelected.current = "move-focus";
							onEditCategory(triggerRef.current);
						}}
					>
						<Tag size={16} aria-hidden="true" /> 분류 변경
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						variant="destructive"
						disabled={disabled}
						onSelect={() => {
							actionSelected.current = "move-focus";
							onRemove();
						}}
					>
						<Trash2 size={16} aria-hidden="true" /> 후보 삭제
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</li>
	);
}
