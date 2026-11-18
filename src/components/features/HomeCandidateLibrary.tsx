import { FolderOpen } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	CandidateListConflict,
	mutateCandidateLibrary,
	saveCandidateList,
	updateCandidateList,
} from "@/lib/candidateLibrary";
import type { CandidateListDraft } from "@/lib/candidateListDraft";
import CandidateListEditor from "./CandidateListEditor";
import CandidateListLoadDialog from "./CandidateListLoadDialog";

export default function HomeCandidateLibrary() {
	const trigger = useRef<HTMLButtonElement>(null);
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState<CandidateListDraft | null>(null);
	const [revision, setRevision] = useState<number>();
	const [pending, setPending] = useState(false);
	const [conflict, setConflict] = useState(false);
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");

	function edit(next: CandidateListDraft, baseRevision?: number) {
		setRevision(baseRevision);
		setConflict(false);
		setError("");
		setDraft(next);
		setOpen(false);
	}

	async function save(next: CandidateListDraft) {
		if (pending) return;
		setPending(true);
		try {
			const saved = await mutateCandidateLibrary(() =>
				revision === undefined || conflict
					? saveCandidateList(next)
					: updateCandidateList(next, revision),
			);
			setNotice(`${saved.name} 목록을 저장했어요.`);
			setDraft(null);
		} catch (cause) {
			if (cause instanceof CandidateListConflict) {
				setConflict(true);
				setError(
					`${cause.message} 현재 편집 내용은 사본으로 저장할 수 있어요.`,
				);
			} else {
				setError(
					cause instanceof Error ? cause.message : "목록을 저장하지 못했어요.",
				);
			}
		} finally {
			setPending(false);
		}
	}

	return (
		<>
			<Button
				ref={trigger}
				variant="ghost"
				size="lg"
				onClick={() => {
					setNotice("");
					setOpen(true);
				}}
			>
				<FolderOpen size={18} aria-hidden="true" />내 후보 목록
			</Button>
			<output className="sr-only">{notice}</output>
			<CandidateListLoadDialog
				open={open}
				onOpenChange={setOpen}
				returnFocusRef={draft ? undefined : trigger}
				onCreate={() => edit({ id: crypto.randomUUID(), name: "", items: [] })}
				onEdit={(list) => edit(list, list.revision)}
				onSelect={({ name, candidates }) =>
					edit({
						id: crypto.randomUUID(),
						name,
						items: candidates.map((candidate) => ({
							...candidate,
							included: candidate.included !== false,
						})),
					})
				}
			/>
			<Dialog
				open={draft !== null}
				onOpenChange={(next) => {
					if (!next && !pending) setDraft(null);
				}}
			>
				<DialogContent
					className="home-candidate-editor-dialog"
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						trigger.current?.focus();
					}}
				>
					<DialogHeader>
						<DialogTitle>
							{revision === undefined ? "새 후보 목록" : "저장 목록 편집"}
						</DialogTitle>
						<DialogDescription>
							이 브라우저에 저장되는 후보 목록입니다.
						</DialogDescription>
					</DialogHeader>
					{draft && (
						<CandidateListEditor
							draft={draft}
							onChange={setDraft}
							onCancel={() => setDraft(null)}
							onSave={(next) => void save(next)}
							error={error}
							pending={pending}
							personalSave
							submitLabel={conflict ? "사본 저장" : "목록 저장"}
						/>
					)}
				</DialogContent>
			</Dialog>
		</>
	);
}
