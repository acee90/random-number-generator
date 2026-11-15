/** UI draft contract. Room protocol integration is tracked separately in #4. */
export type CandidateListItem = {
	id: string;
	name: string;
	category: string;
	included: boolean;
	menu?: string;
	distanceMeters?: number;
};

export type CandidateListDraft = {
	id: string;
	name: string;
	items: CandidateListItem[];
};

export type SavedCandidateList = CandidateListDraft & { updatedAt: number };

/** Preview limits; service request/snapshot limits are part of the #4 migration. */
export const candidateDraftLimits = {
	name: 40,
	itemName: 80,
	category: 24,
	items: 200,
	savedLists: 20,
} as const;

export function normalizeCandidateDraft(
	draft: CandidateListDraft,
): CandidateListDraft {
	return {
		...draft,
		name: draft.name.normalize("NFC").trim(),
		items: draft.items.map((item) => ({
			...item,
			name: item.name.normalize("NFC").trim(),
			category: item.category.normalize("NFC").trim(),
		})),
	};
}
