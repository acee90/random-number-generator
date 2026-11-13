import { useCallback, useEffect, useRef, useState } from "react";
import { isLunchRoomId, normalizeLunchRoomNickname } from "@/lib/lunchRoom";
import {
	readLunchRoomHost,
	readOrCreateLunchRoomGuestToken,
} from "@/lib/lunchRoomClient";
import { beginRoomTiming } from "@/lib/roomTimings";

type AvailabilityStatus =
	| "idle"
	| "invalid"
	| "checking"
	| "available"
	| "taken"
	| "error";
type CheckResult = {
	roomId: string;
	name: string;
	attempt: number;
	status: "available" | "taken" | "error";
};

export function useNicknameAvailability({
	roomId,
	name,
	composing = false,
	enabled = true,
	rejected = false,
}: {
	roomId: string;
	name: string;
	composing?: boolean;
	enabled?: boolean;
	rejected?: boolean;
}) {
	const normalizedName = normalizeLunchRoomNickname(name);
	const [attempt, setAttempt] = useState(0);
	const [result, setResult] = useState<CheckResult | null>(null);
	const sequenceRef = useRef(0);
	const retry = useCallback(() => setAttempt((value) => value + 1), []);

	useEffect(() => {
		const sequence = ++sequenceRef.current;
		setResult(null);
		if (
			!enabled ||
			composing ||
			rejected ||
			!normalizedName ||
			!isLunchRoomId(roomId)
		)
			return;
		let active = true;
		const controller = new AbortController();
		const requestedName = normalizedName;
		let requestTimeout: ReturnType<typeof setTimeout> | undefined;
		let finishCheck: (() => void) | undefined;
		const timer = setTimeout(async () => {
			finishCheck = beginRoomTiming("nickname_check");
			requestTimeout = setTimeout(() => {
				if (!active || sequenceRef.current !== sequence) return;
				controller.abort();
				finishCheck?.();
				setResult({ roomId, name: requestedName, attempt, status: "error" });
			}, 8000);
			let status: CheckResult["status"] = "error";
			try {
				const hostToken = readLunchRoomHost(roomId);
				const proof = hostToken
					? { hostToken }
					: { guestToken: readOrCreateLunchRoomGuestToken(roomId) };
				const response = await fetch(
					`/api/lunch/rooms/${roomId}/nickname-availability`,
					{
						method: "POST",
						headers: { "Content-Type": "application/json" },
						credentials: "same-origin",
						cache: "no-store",
						signal: controller.signal,
						body: JSON.stringify({ name: requestedName, ...proof }),
					},
				);
				if (!response.ok) throw new Error("Availability check failed");
				const data: unknown = await response.json();
				if (
					!data ||
					typeof data !== "object" ||
					!("name" in data) ||
					data.name !== requestedName ||
					!("available" in data) ||
					typeof data.available !== "boolean"
				)
					throw new Error("Invalid availability response");
				status = data.available ? "available" : "taken";
			} catch {
				// A failed check never grants entry; the user can retry explicitly.
			} finally {
				clearTimeout(requestTimeout);
				finishCheck?.();
			}
			if (
				!active ||
				controller.signal.aborted ||
				sequenceRef.current !== sequence
			)
				return;
			setResult({ roomId, name: requestedName, attempt, status });
		}, 350);
		return () => {
			active = false;
			clearTimeout(timer);
			clearTimeout(requestTimeout);
			controller.abort();
			finishCheck?.();
		};
	}, [roomId, normalizedName, composing, enabled, rejected, attempt]);

	let status: AvailabilityStatus;
	if (!name.trim()) status = "idle";
	else if (!normalizedName) status = "invalid";
	else if (!isLunchRoomId(roomId) || rejected) status = "error";
	else if (!enabled) status = "idle";
	else if (
		composing ||
		!result ||
		result.roomId !== roomId ||
		result.name !== normalizedName ||
		result.attempt !== attempt
	)
		status = "checking";
	else status = result.status;

	return { status, normalizedName, retry };
}
