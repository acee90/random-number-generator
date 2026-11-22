import { Check, LoaderCircle, Plus } from "lucide-react";
import {
	type Dispatch,
	type RefObject,
	type SetStateAction,
	useRef,
	useState,
} from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { candidateDraftLimits } from "@/lib/candidateListDraft";

export type QuickAddDraft = [
	name: string,
	setName: Dispatch<SetStateAction<string>>,
];

export default function RoomCandidateQuickAdd({
	id,
	controlRef,
	draft,
	disabled,
	onAdd,
}: {
	id: string;
	controlRef: RefObject<HTMLInputElement | HTMLButtonElement | null>;
	draft?: QuickAddDraft;
	disabled: boolean;
	onAdd: (name: string) => boolean | Promise<boolean>;
}) {
	const localDraft = useState("");
	const [name, setName] = draft ?? localDraft;
	const [expanded, setExpanded] = useState(() => Boolean(name.trim()));
	const pending = useRef(false);
	const [error, setError] = useState("");
	const [adding, setAdding] = useState(false);
	const candidateName = name.normalize("NFC").trim();

	function setExpandedAndFocus(next: boolean) {
		// Focus the replacement control during the gesture so mobile keyboards can open.
		flushSync(() => setExpanded(next));
		controlRef.current?.focus();
	}

	function setControl(control: HTMLInputElement | HTMLButtonElement | null) {
		controlRef.current = control;
	}

	async function add() {
		if (disabled || pending.current || !candidateName) return;
		controlRef.current?.focus();
		if (
			candidateName.length > candidateDraftLimits.itemName ||
			/[\p{Cc}\p{Cf}\p{Cs}]/u.test(candidateName)
		) {
			setError(
				`후보 이름은 제어문자 없이 ${candidateDraftLimits.itemName}자까지 입력해 주세요.`,
			);
			return;
		}
		pending.current = true;
		setAdding(true);
		setError("");
		try {
			if (await onAdd(candidateName)) {
				setName((current) => (current === name ? "" : current));
				return;
			}
			setError("후보를 추가하지 못했습니다. 다시 시도해 주세요.");
		} catch {
			setError("후보를 추가하지 못했습니다. 다시 시도해 주세요.");
		} finally {
			pending.current = false;
			setAdding(false);
		}
	}

	if (!expanded) {
		return (
			<Button
				ref={setControl}
				id={id}
				variant="ghost"
				size="auto"
				className="room-simple-add-trigger"
				disabled={disabled}
				onClick={() => setExpandedAndFocus(true)}
			>
				<Plus size={16} aria-hidden="true" />
				<span>추가하기</span>
			</Button>
		);
	}

	return (
		<form
			aria-label="후보 빠른 추가"
			aria-busy={adding}
			className="room-simple-row room-simple-quick-add"
			onSubmit={(event) => {
				event.preventDefault();
				void add();
			}}
			onBlur={(event) => {
				if (
					!candidateName &&
					!error &&
					!pending.current &&
					!event.currentTarget.contains(event.relatedTarget)
				) {
					setName("");
					setExpanded(false);
				}
			}}
			onKeyDown={(event) => {
				if (event.nativeEvent.isComposing) {
					if (event.key === "Enter") event.preventDefault();
					return;
				}
				if (event.key === "Escape" && !disabled && !pending.current) {
					event.preventDefault();
					setName("");
					setError("");
					setExpandedAndFocus(false);
				}
			}}
		>
			<div className="room-simple-item">
				<Label className="sr-only" htmlFor={id}>
					새 후보 이름
				</Label>
				<Input
					ref={setControl}
					id={id}
					name="new-candidate-name"
					placeholder="후보 이름"
					value={name}
					maxLength={candidateDraftLimits.itemName}
					autoComplete="off"
					enterKeyHint="done"
					disabled={disabled && !adding}
					aria-invalid={Boolean(error)}
					aria-describedby={error ? `${id}-error` : undefined}
					onChange={(event) => {
						setName(event.currentTarget.value);
						setError("");
					}}
				/>
				<span className="room-simple-category" aria-hidden="true">
					미분류
				</span>
			</div>
			<Button
				type="submit"
				variant="ghost"
				size="icon"
				disabled={disabled || adding || !candidateName}
				aria-label={adding ? "후보 추가 중…" : "후보 추가"}
			>
				{adding ? (
					<LoaderCircle
						size={16}
						className="motion-safe:animate-spin"
						aria-hidden="true"
					/>
				) : (
					<Check size={16} aria-hidden="true" />
				)}
			</Button>
			{error && (
				<p id={`${id}-error`} role="alert" className="text-sm text-destructive">
					{error}
				</p>
			)}
		</form>
	);
}
