import { lunchRoomLimits } from "./lunchRoom";

// Internal binding traffic only; the public Worker validates the browser origin.
export const nicknameCheckPath = "/_internal/lunch-room/nickname-availability";

export async function readBoundedRoomJson(request: Request): Promise<unknown> {
	if (
		Number(request.headers.get("Content-Length")) >
		lunchRoomLimits.maxMessageBytes
	)
		throw new RangeError("Request too large");
	const reader = request.body?.getReader();
	if (!reader) throw new SyntaxError("Empty body");
	const chunks: Uint8Array[] = [];
	let length = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			length += value.byteLength;
			if (length > lunchRoomLimits.maxMessageBytes) {
				await reader.cancel();
				throw new RangeError("Request too large");
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
