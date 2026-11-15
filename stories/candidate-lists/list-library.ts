import {
	type CandidateListItem,
	candidateDraftLimits,
	type SavedCandidateList,
} from "@/lib/candidateListDraft";

export type CandidateLibrary = {
	version: 1;
	lists: SavedCandidateList[];
	lastUsedId: string | null;
};

/** The preview must never share service identity, history or future library keys. */
export const previewLibraryKey = "jeommechu:storybook:candidate-lists:v1";

function emptyLibrary(): CandidateLibrary {
	return { version: 1, lists: [], lastUsedId: null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(
	value: unknown,
	limit: number,
	required = true,
): value is string {
	return (
		typeof value === "string" &&
		value.length <= limit &&
		(!required || value.trim().length > 0) &&
		Array.from(value).every((character) => {
			const code = character.charCodeAt(0);
			return code >= 32 && code !== 127;
		})
	);
}

function isId(value: unknown): value is string {
	return isText(value, 128) && value.trim() === value;
}

function parseItem(value: unknown): CandidateListItem | null {
	if (
		!isRecord(value) ||
		!isId(value.id) ||
		!isText(value.name, candidateDraftLimits.itemName) ||
		!isText(value.category, candidateDraftLimits.category, false) ||
		typeof value.included !== "boolean" ||
		(value.menu !== undefined &&
			!isText(value.menu, candidateDraftLimits.itemName, false)) ||
		(value.distanceMeters !== undefined &&
			(typeof value.distanceMeters !== "number" ||
				!Number.isFinite(value.distanceMeters) ||
				value.distanceMeters < 0))
	)
		return null;
	return {
		id: value.id,
		name: value.name,
		category: value.category,
		included: value.included,
		...(value.menu === undefined ? {} : { menu: value.menu as string }),
		...(value.distanceMeters === undefined
			? {}
			: { distanceMeters: value.distanceMeters as number }),
	};
}

function parseList(value: unknown): SavedCandidateList | null {
	if (
		!isRecord(value) ||
		!isId(value.id) ||
		!isText(value.name, candidateDraftLimits.name) ||
		!Array.isArray(value.items) ||
		value.items.length > candidateDraftLimits.items ||
		typeof value.updatedAt !== "number" ||
		!Number.isSafeInteger(value.updatedAt) ||
		value.updatedAt < 0
	)
		return null;
	const items: CandidateListItem[] = [];
	const ids = new Set<string>();
	for (const entry of value.items) {
		const item = parseItem(entry);
		if (!item || ids.has(item.id)) return null;
		ids.add(item.id);
		items.push(item);
	}
	return {
		id: value.id,
		name: value.name,
		items,
		updatedAt: value.updatedAt,
	};
}

function parseLibrary(value: unknown): CandidateLibrary | null {
	if (
		!isRecord(value) ||
		value.version !== 1 ||
		!Array.isArray(value.lists) ||
		value.lists.length > candidateDraftLimits.savedLists ||
		(value.lastUsedId !== null && !isId(value.lastUsedId))
	)
		return null;
	const lists: SavedCandidateList[] = [];
	const ids = new Set<string>();
	for (const entry of value.lists) {
		const list = parseList(entry);
		if (!list || ids.has(list.id)) return null;
		ids.add(list.id);
		lists.push(list);
	}
	if (value.lastUsedId !== null && !ids.has(value.lastUsedId as string))
		return null;
	return {
		version: 1,
		lists,
		lastUsedId: value.lastUsedId as string | null,
	};
}

export function readCandidateLibrary(storage: Pick<Storage, "getItem">): {
	library: CandidateLibrary;
	error: string;
} {
	let raw: string | null;
	try {
		raw = storage.getItem(previewLibraryKey);
	} catch {
		return {
			library: emptyLibrary(),
			error: "저장한 목록을 읽을 수 없어요. 브라우저 저장소를 확인해 주세요.",
		};
	}
	if (raw === null) return { library: emptyLibrary(), error: "" };
	try {
		const library = parseLibrary(JSON.parse(raw));
		if (library) return { library, error: "" };
	} catch {
		// Leave the original value available for recovery instead of deleting it.
	}
	return {
		library: emptyLibrary(),
		error: "저장한 목록의 형식을 읽을 수 없어요. 기존 저장 내용은 유지됩니다.",
	};
}

/** Callers update their applied state only after this synchronous write succeeds. */
export function writeCandidateLibrary(
	storage: Pick<Storage, "setItem">,
	library: CandidateLibrary,
): void {
	const parsed = parseLibrary(library);
	if (!parsed) throw new Error("저장할 목록의 형식을 확인해 주세요.");
	try {
		storage.setItem(previewLibraryKey, JSON.stringify(parsed));
	} catch (cause) {
		throw new Error(
			"브라우저에 목록을 저장할 수 없어요. 저장 공간과 권한을 확인해 주세요.",
			{ cause },
		);
	}
}
