export interface RoomEntryInfo {
	title: string;
}

/** Match the existing room title contract and expose no other snapshot fields. */
export function parseRoomEntryInfo(value: unknown): RoomEntryInfo | null {
	if (!value || typeof value !== "object" || !("title" in value)) return null;
	if (typeof value.title !== "string") return null;
	const title = value.title.trim();
	return title && title.length <= 60 ? { title } : null;
}
