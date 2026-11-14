import { FileSpreadsheet, ListPlus, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import {
	type CandidateListDraft,
	type CandidateListItem,
	candidateDraftLimits,
	normalizeCandidateDraft,
} from "@/lib/candidateListDraft";
import "./candidate-list-editor.css";

export type CandidateListEditorProps = {
	draft: CandidateListDraft;
	onChange: (draft: CandidateListDraft) => void;
	onCancel: () => void;
	onSave: (draft: CandidateListDraft) => void;
	onImportTemplate: () => void;
	onImportExcel: () => void;
	error?: string;
};

type EditorErrors = {
	name?: string;
	items?: string;
	itemNames: Map<string, string>;
	categories: Map<string, string>;
};

type ValidationFocus =
	| { field: "name" | "items" }
	| { field: "itemName" | "category"; itemId: string };

function validateDraft(draft: CandidateListDraft): EditorErrors {
	const errors: EditorErrors = { itemNames: new Map(), categories: new Map() };
	if (!draft.name) errors.name = "목록 이름을 입력해 주세요.";
	else if (draft.name.length > candidateDraftLimits.name)
		errors.name = `목록 이름은 ${candidateDraftLimits.name}자까지 입력해 주세요.`;
	if (draft.items.length > candidateDraftLimits.items)
		errors.items = `후보는 ${candidateDraftLimits.items}개까지 넣을 수 있어요.`;
	else if (draft.items.filter((item) => item.included).length < 2)
		errors.items = "추첨할 후보를 2개 이상 포함해 주세요.";
	for (const item of draft.items) {
		if (!item.name) errors.itemNames.set(item.id, "후보 이름을 입력해 주세요.");
		else if (item.name.length > candidateDraftLimits.itemName)
			errors.itemNames.set(
				item.id,
				`후보 이름은 ${candidateDraftLimits.itemName}자까지 입력해 주세요.`,
			);
		if (item.category.length > candidateDraftLimits.category)
			errors.categories.set(
				item.id,
				`분류는 ${candidateDraftLimits.category}자까지 입력해 주세요.`,
			);
	}
	return errors;
}

export function CandidateListEditor({
	draft,
	onChange,
	onCancel,
	onSave,
	onImportTemplate,
	onImportExcel,
	error,
}: CandidateListEditorProps) {
	const id = useId();
	const [submitAttempt, setSubmitAttempt] = useState(0);
	const nameRef = useRef<HTMLInputElement>(null);
	const itemsHeadingRef = useRef<HTMLHeadingElement>(null);
	const addRef = useRef<HTMLButtonElement>(null);
	const errorRef = useRef<HTMLParagraphElement>(null);
	const itemRefs = useRef(new Map<string, HTMLInputElement>());
	const categoryRefs = useRef(new Map<string, HTMLInputElement>());
	const nextFocus = useRef<{ id: string } | "add" | null>(null);
	const validationFocus = useRef<ValidationFocus | null>(null);
	const normalized = normalizeCandidateDraft(draft);
	const errors: EditorErrors =
		submitAttempt > 0
			? validateDraft(normalized)
			: {
					itemNames: new Map<string, string>(),
					categories: new Map<string, string>(),
				};
	const includedCount = draft.items.filter((item) => item.included).length;

	useEffect(() => {
		const next = nextFocus.current;
		if (next === "add") addRef.current?.focus();
		else if (next && draft.items.some((item) => item.id === next.id))
			itemRefs.current.get(next.id)?.focus();
		nextFocus.current = null;
	}, [draft.items]);

	useEffect(() => {
		if (submitAttempt === 0) return;
		const target = validationFocus.current;
		if (target?.field === "name") nameRef.current?.focus();
		else if (target?.field === "items") itemsHeadingRef.current?.focus();
		else if (target?.field === "itemName")
			itemRefs.current.get(target.itemId)?.focus();
		else if (target?.field === "category")
			categoryRefs.current.get(target.itemId)?.focus();
		validationFocus.current = null;
	}, [submitAttempt]);

	useEffect(() => {
		if (error) errorRef.current?.focus();
	}, [error]);

	function updateItem(itemId: string, update: Partial<CandidateListItem>) {
		onChange({
			...draft,
			items: draft.items.map((item) =>
				item.id === itemId ? { ...item, ...update } : item,
			),
		});
	}

	function addItem() {
		if (draft.items.length >= candidateDraftLimits.items) return;
		const item: CandidateListItem = {
			id: crypto.randomUUID(),
			name: "",
			category: "",
			included: true,
		};
		nextFocus.current = { id: item.id };
		onChange({ ...draft, items: [...draft.items, item] });
	}

	function removeItem(index: number) {
		const next = draft.items[index + 1] ?? draft.items[index - 1];
		nextFocus.current = next ? { id: next.id } : "add";
		onChange({
			...draft,
			items: draft.items.filter((_, itemIndex) => itemIndex !== index),
		});
	}

	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const result = validateDraft(normalized);
		setSubmitAttempt((attempt) => attempt + 1);
		if (result.name) {
			validationFocus.current = { field: "name" };
			return;
		}
		for (const item of normalized.items) {
			if (result.itemNames.has(item.id)) {
				validationFocus.current = { field: "itemName", itemId: item.id };
				return;
			}
			if (result.categories.has(item.id)) {
				validationFocus.current = { field: "category", itemId: item.id };
				return;
			}
		}
		if (result.items) {
			validationFocus.current = { field: "items" };
			return;
		}
		onSave(normalized);
	}

	return (
		<form
			className="candidate-editor"
			aria-label="후보 목록 편집"
			noValidate
			onSubmit={submit}
		>
			<div className="candidate-editor-name">
				<label htmlFor={`${id}-list-name`}>목록 이름</label>
				<input
					ref={nameRef}
					id={`${id}-list-name`}
					name="candidate-list-name"
					type="text"
					autoComplete="off"
					maxLength={candidateDraftLimits.name}
					value={draft.name}
					aria-invalid={Boolean(errors.name)}
					aria-describedby={errors.name ? `${id}-name-error` : undefined}
					onChange={(event) =>
						onChange({ ...draft, name: event.currentTarget.value })
					}
				/>
				{errors.name && (
					<p className="candidate-editor-error" id={`${id}-name-error`}>
						{errors.name}
					</p>
				)}
			</div>
			<div className="candidate-editor-tools">
				<h2
					ref={itemsHeadingRef}
					tabIndex={-1}
					aria-describedby={errors.items ? `${id}-items-error` : undefined}
				>
					후보 편집
				</h2>
				<div>
					<button type="button" onClick={onImportTemplate}>
						<ListPlus size={18} aria-hidden="true" />
						템플릿에서 추가
					</button>
					<button type="button" onClick={onImportExcel}>
						<FileSpreadsheet size={18} aria-hidden="true" />
						엑셀에서 추가
					</button>
				</div>
			</div>
			<p
				id={`${id}-items-error`}
				className="candidate-editor-error"
				role="alert"
			>
				{errors.items}
			</p>
			<div className="candidate-editor-columns" aria-hidden="true">
				<span>포함</span>
				<span>후보 이름</span>
				<span>분류 (선택)</span>
				<span />
			</div>
			<ol className="candidate-editor-list" aria-label="후보 편집 목록">
				{draft.items.map((item, index) => (
					<li
						key={item.id}
						className="candidate-editor-row"
						data-included={item.included}
					>
						<label className="candidate-editor-included">
							<input
								type="checkbox"
								checked={item.included}
								onChange={(event) =>
									updateItem(item.id, { included: event.currentTarget.checked })
								}
								aria-label={`${index + 1}번째 후보 포함`}
							/>
							<span aria-hidden="true">{index + 1}</span>
						</label>
						<div className="candidate-editor-field candidate-editor-item-name">
							<label
								className="candidate-editor-field-label"
								htmlFor={`${id}-item-${index}`}
							>
								<span className="sr-only">{index + 1}번째 </span>후보 이름
							</label>
							<input
								ref={(element) => {
									if (element) itemRefs.current.set(item.id, element);
									else itemRefs.current.delete(item.id);
								}}
								id={`${id}-item-${index}`}
								name={`candidate-name-${index}`}
								type="text"
								autoComplete="off"
								maxLength={candidateDraftLimits.itemName}
								value={item.name}
								aria-invalid={errors.itemNames.has(item.id)}
								aria-describedby={
									errors.itemNames.has(item.id)
										? `${id}-item-${index}-error`
										: undefined
								}
								onChange={(event) =>
									updateItem(item.id, { name: event.currentTarget.value })
								}
							/>
							{errors.itemNames.has(item.id) && (
								<span
									className="candidate-editor-error"
									id={`${id}-item-${index}-error`}
								>
									{errors.itemNames.get(item.id)}
								</span>
							)}
						</div>
						<div className="candidate-editor-field candidate-editor-category">
							<label
								className="candidate-editor-field-label"
								htmlFor={`${id}-category-${index}`}
							>
								<span className="sr-only">{index + 1}번째 </span>분류 (선택)
							</label>
							<input
								ref={(element) => {
									if (element) categoryRefs.current.set(item.id, element);
									else categoryRefs.current.delete(item.id);
								}}
								id={`${id}-category-${index}`}
								name={`candidate-category-${index}`}
								type="text"
								autoComplete="off"
								maxLength={candidateDraftLimits.category}
								value={item.category}
								aria-invalid={errors.categories.has(item.id)}
								aria-describedby={
									errors.categories.has(item.id)
										? `${id}-category-${index}-error`
										: undefined
								}
								onChange={(event) =>
									updateItem(item.id, { category: event.currentTarget.value })
								}
							/>
							{errors.categories.has(item.id) && (
								<span
									className="candidate-editor-error"
									id={`${id}-category-${index}-error`}
								>
									{errors.categories.get(item.id)}
								</span>
							)}
						</div>
						<button
							className="candidate-editor-delete"
							type="button"
							onClick={() => removeItem(index)}
							aria-label={`${index + 1}번째 후보 삭제`}
						>
							<Trash2 size={18} aria-hidden="true" />
						</button>
					</li>
				))}
			</ol>
			{draft.items.length === 0 && (
				<p className="candidate-editor-empty">후보를 추가해 주세요.</p>
			)}
			<button
				className="candidate-editor-add"
				type="button"
				ref={addRef}
				disabled={draft.items.length >= candidateDraftLimits.items}
				onClick={addItem}
			>
				<Plus size={20} aria-hidden="true" />
				후보 추가
			</button>
			<p
				ref={errorRef}
				tabIndex={-1}
				className="candidate-editor-error"
				role="alert"
			>
				{error}
			</p>
			<footer className="candidate-editor-footer">
				<p>
					포함 <strong>{includedCount}</strong> / 전체 {draft.items.length}
				</p>
				<div>
					<button type="button" onClick={onCancel}>
						취소
					</button>
					<button className="candidate-editor-save" type="submit">
						저장하고 사용
					</button>
				</div>
			</footer>
		</form>
	);
}

export default CandidateListEditor;
