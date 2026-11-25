import { createServerFn } from "@tanstack/react-start";
import { roomEntropyBatchSize } from "./roomEntropy";

/** The solo room can request a fixed batch before it knows who will be eligible. */
export const prepareSoloRoomEntropy = createServerFn({
	method: "POST",
}).handler(async () => {
	const { fetchExternalEntropy } = await import("./seedPool");
	return fetchExternalEntropy(roomEntropyBatchSize);
});
