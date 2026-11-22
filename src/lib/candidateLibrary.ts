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
export type VersionedCandidateList = SavedCandidateList & { revision: number };
type Library = { version: 1; lists: VersionedCandidateList[] };

export class CandidateListConflict extends Error {
	constructor() {
		super("다른 탭에서 이 목록을 수정하거나 삭제했어요.");
	}
}

export function mutateCandidateLibrary<T>(action: () => T): T | Promise<T> {
	const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
	return locks ? locks.request(candidateLibraryKey, action) : action();
}
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

function parseList(value: unknown): VersionedCandidateList | null {
	if (
		!isRecord(value) ||
		typeof value.id !== "string" ||
		!opaqueId.test(value.id) ||
		!validText(value.name, candidateDraftLimits.name) ||
		!Array.isArray(value.items) ||
		typeof value.updatedAt !== "number" ||
		!Number.isSafeInteger(value.updatedAt) ||
		value.updatedAt < 0 ||
		(value.revision !== undefined &&
			(typeof value.revision !== "number" ||
				!Number.isSafeInteger(value.revision) ||
				value.revision < 1))
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
		revision: typeof value.revision === "number" ? value.revision : 1,
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
	const lists: VersionedCandidateList[] = [];
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
	lists: VersionedCandidateList[];
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

function writeCandidateLibrary(
	target: LibraryStorage,
	lists: VersionedCandidateList[],
) {
	const serialized = JSON.stringify({ version: 1, lists });
	if (new TextEncoder().encode(serialized).byteLength > maximumLibraryBytes)
		throw new Error(
			"저장할 목록의 용량이 큽니다. 후보나 메뉴 내용을 줄인 뒤 다시 저장해 주세요.",
		);
	try {
		target.setItem(candidateLibraryKey, serialized);
	} catch (cause) {
		throw new Error(
			"목록을 저장하지 못했어요. 브라우저 저장 공간과 권한을 확인한 뒤 다시 시도해 주세요. 현재 후보는 유지됩니다.",
			{ cause },
		);
	}
}

/** Saving from a room always appends an independent browser copy. */
export function saveCandidateList(
	draft: CandidateListDraft,
	storage?: LibraryStorage,
): VersionedCandidateList {
	return commitCandidateList(draft, storage);
}

export function updateCandidateList(
	draft: CandidateListDraft,
	expectedRevision: number,
	storage?: LibraryStorage,
): VersionedCandidateList {
	return commitCandidateList(draft, storage, expectedRevision);
}

function commitCandidateList(
	draft: CandidateListDraft,
	storage?: LibraryStorage,
	expectedRevision?: number,
): VersionedCandidateList {
	const validated = parseList({
		...draft,
		id: expectedRevision === undefined ? crypto.randomUUID() : draft.id,
		updatedAt: Date.now(),
		revision: expectedRevision === undefined ? 1 : expectedRevision + 1,
	});
	if (!validated)
		throw new Error("목록 이름과 후보 입력을 확인한 뒤 다시 저장해 주세요.");
	if (!validated.items.length)
		throw new Error("저장할 후보를 1개 이상 추가해 주세요.");
	const copy = parseList({
		...validated,
		...normalizeCandidateDraft(validated),
	});
	if (!copy)
		throw new Error("목록 이름과 후보 입력을 확인한 뒤 다시 저장해 주세요.");
	let target: LibraryStorage;
	try {
		target = storage ?? window.localStorage;
	} catch {
		throw new Error("브라우저 저장소 권한을 확인한 뒤 다시 저장해 주세요.");
	}
	const current = readCandidateLibrary(target);
	if (current.error) throw new Error(current.error);
	if (expectedRevision !== undefined) {
		const previous = current.lists.find((list) => list.id === draft.id);
		if (!previous || previous.revision !== expectedRevision)
			throw new CandidateListConflict();
		writeCandidateLibrary(
			target,
			current.lists.map((list) => (list.id === copy.id ? copy : list)),
		);
	} else {
		if (current.lists.length >= candidateDraftLimits.savedLists)
			throw new Error(
				`저장한 목록이 ${candidateDraftLimits.savedLists}개입니다. 저장 목록을 정리한 뒤 다시 저장해 주세요.`,
			);
		writeCandidateLibrary(target, [...current.lists, copy]);
	}
	return copy;
}

/** Deletes only the saved browser copy, never an active room or editing draft. */
export function deleteCandidateList(
	id: string,
	storage?: LibraryStorage,
	expectedRevision?: number,
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
	const previous = current.lists.find((list) => list.id === id);
	if (expectedRevision !== undefined && previous?.revision !== expectedRevision)
		throw new CandidateListConflict();
	if (!previous) return false;
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
