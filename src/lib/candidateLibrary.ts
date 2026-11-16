import {
	type CandidateListDraft,
	type CandidateListItem,
	candidateDraftLimits,
	normalizeCandidateDraft,
	type SavedCandidateList,
} from "./candidateListDraft";

/** Service data is deliberately separate from Storybook examples and room proofs. */
export const candidateLibraryKey = "jeommechu:candidate-lists:v1";

type LibraryStorage = Pick<Storage, "getItem" | "setItem">;
type Library = { version: 1; lists: SavedCandidateList[] };
const maximumLibraryBytes = 8 * 1024 * 1024;
const invalidCharacters = /[\p{Cc}\p{Cf}\p{Cs}]/u;
const opaqueId = /^[A-Za-z0-9_-]{1,80}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validText(
	value: unknown,
	maximum: number,
	required = true,
): value is string {
	return (
		typeof value === "string" &&
		value.length <= maximum &&
		(!required || value.trim().length > 0) &&
		!invalidCharacters.test(value)
	);
}

function parseItem(value: unknown): CandidateListItem | null {
	if (
		!isRecord(value) ||
		typeof value.id !== "string" ||
		!opaqueId.test(value.id) ||
		!validText(value.name, candidateDraftLimits.itemName) ||
		!validText(value.category, candidateDraftLimits.category, false) ||
		typeof value.included !== "boolean" ||
		(value.menu !== undefined && !validText(value.menu, 200, false)) ||
		(value.distanceMeters !== undefined &&
			(typeof value.distanceMeters !== "number" ||
				!Number.isSafeInteger(value.distanceMeters) ||
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
		typeof value.id !== "string" ||
		!opaqueId.test(value.id) ||
		!validText(value.name, candidateDraftLimits.name) ||
		!Array.isArray(value.items) ||
		value.items.length > candidateDraftLimits.items ||
		typeof value.updatedAt !== "number" ||
		!Number.isSafeInteger(value.updatedAt) ||
		value.updatedAt < 0
	)
		return null;
	const items: CandidateListItem[] = [];
	const seen = new Set<string>();
	for (const entry of value.items) {
		const item = parseItem(entry);
		if (!item || seen.has(item.id)) return null;
		seen.add(item.id);
		items.push(item);
	}
	return {
		id: value.id,
		name: value.name,
		items,
		updatedAt: value.updatedAt,
	};
}

function parseLibrary(raw: string): Library | null {
	if (
		raw.length > maximumLibraryBytes ||
		new TextEncoder().encode(raw).byteLength > maximumLibraryBytes
	)
		return null;
	const value: unknown = JSON.parse(raw);
	if (
		!isRecord(value) ||
		value.version !== 1 ||
		!Array.isArray(value.lists) ||
		value.lists.length > candidateDraftLimits.savedLists
	)
		return null;
	const lists: SavedCandidateList[] = [];
	const seen = new Set<string>();
	for (const entry of value.lists) {
		const list = parseList(entry);
		if (!list || seen.has(list.id)) return null;
		seen.add(list.id);
		lists.push(list);
	}
	return { version: 1, lists };
}

/** Reads never repair or remove unreadable data. A later save must respect errors. */
export function readCandidateLibrary(storage?: Pick<Storage, "getItem">): {
	lists: SavedCandidateList[];
	error: string;
} {
	if (!storage && typeof window === "undefined")
		return { lists: [], error: "" };
	let raw: string | null;
	try {
		raw = (storage ?? window.localStorage).getItem(candidateLibraryKey);
	} catch {
		return {
			lists: [],
			error:
				"저장한 목록을 읽을 수 없어요. 브라우저 저장소 권한을 확인하고 다시 시도해 주세요.",
		};
	}
	if (raw === null) return { lists: [], error: "" };
	try {
		const library = parseLibrary(raw);
		if (library) return { lists: library.lists, error: "" };
	} catch {
		// Keep the original serialized value available for recovery.
	}
	return {
		lists: [],
		error:
			"저장한 목록의 형식을 읽을 수 없어요. 기존 저장 내용은 유지됩니다. 기본 목록을 사용하거나 다시 시도해 주세요.",
	};
}

/** Always appends a fresh copy; room changes never overwrite a personal original. */
export function saveCandidateList(
	draft: CandidateListDraft,
	storage?: LibraryStorage,
): SavedCandidateList {
	const copy = parseList({
		...draft,
		id: crypto.randomUUID(),
		updatedAt: Date.now(),
	});
	if (!copy)
		throw new Error("목록 이름과 후보 입력을 확인한 뒤 다시 저장해 주세요.");
	if (!copy.items.length)
		throw new Error("저장할 후보를 1개 이상 추가해 주세요.");
	const normalized = parseList({
		...normalizeCandidateDraft(copy),
		updatedAt: copy.updatedAt,
	});
	if (!normalized)
		throw new Error("목록 이름과 후보 입력을 확인한 뒤 다시 저장해 주세요.");
	let target: LibraryStorage;
	try {
		target = storage ?? window.localStorage;
	} catch {
		throw new Error("브라우저 저장소 권한을 확인한 뒤 다시 저장해 주세요.");
	}
	const current = readCandidateLibrary(target);
	if (current.error) throw new Error(current.error);
	if (current.lists.length >= candidateDraftLimits.savedLists)
		throw new Error(
			`저장한 목록이 ${candidateDraftLimits.savedLists}개입니다. 기존 저장 내용을 정리한 뒤 다시 저장해 주세요. 현재 후보는 유지됩니다.`,
		);
	const serialized = JSON.stringify({
		version: 1,
		lists: [...current.lists, normalized],
	});
	if (new TextEncoder().encode(serialized).byteLength > maximumLibraryBytes)
		throw new Error(
			"저장할 목록의 용량이 큽니다. 후보나 메뉴 내용을 줄인 뒤 다시 저장해 주세요. 기존 저장 내용은 유지됩니다.",
		);
	try {
		target.setItem(candidateLibraryKey, serialized);
	} catch (cause) {
		throw new Error(
			"목록을 저장하지 못했어요. 브라우저 저장 공간과 권한을 확인한 뒤 다시 시도해 주세요. 현재 후보는 유지됩니다.",
			{ cause },
		);
	}
	return normalized;
}

/** Deletes only the saved browser copy, never an active room or editing draft. */
export function deleteCandidateList(
	id: string,
	storage?: LibraryStorage,
): boolean {
	if (!opaqueId.test(id))
		throw new Error("삭제할 저장 목록을 다시 선택해 주세요.");
	let target: LibraryStorage;
	try {
		target = storage ?? window.localStorage;
	} catch {
		throw new Error("브라우저 저장소 권한을 확인한 뒤 다시 삭제해 주세요.");
	}
	const current = readCandidateLibrary(target);
	if (current.error) throw new Error(current.error);
	if (!current.lists.some((list) => list.id === id)) return false;
	try {
		target.setItem(
			candidateLibraryKey,
			JSON.stringify({
				version: 1,
				lists: current.lists.filter((list) => list.id !== id),
			}),
		);
	} catch (cause) {
		throw new Error(
			"목록을 삭제하지 못했어요. 브라우저 저장소 권한을 확인한 뒤 다시 시도해 주세요. 기존 저장 내용은 유지됩니다.",
			{ cause },
		);
	}
	return true;
}
