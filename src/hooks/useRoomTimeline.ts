import { type RefObject, useEffect, useRef, useState } from "react";
import type { RoomDraw } from "@/lib/lunchRoom";

export function useRoomTimeline(
	draw: RoomDraw | null,
	clockOffset: number,
	rotorRef: RefObject<HTMLDivElement | null>,
	motionOff: boolean,
) {
	const [completedId, setCompletedId] = useState<string | null>(null);
	const completedRef = useRef<string | null>(null);
	const drawId = draw?.id;
	const startedAt = draw?.startedAt;
	const durationMs = draw?.durationMs;
	const toRotation = draw?.toRotation;
	useEffect(() => {
		if (
			!drawId ||
			startedAt === undefined ||
			durationMs === undefined ||
			toRotation === undefined
		) {
			setCompletedId(null);
			return;
		}
		if (completedRef.current === drawId) {
			setCompletedId(drawId);
			return;
		}
		let active = true;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let animation: Animation | undefined;
		const media = window.matchMedia("(prefers-reduced-motion: reduce)");
		function align() {
			if (!active || startedAt === undefined || durationMs === undefined)
				return;
			clearTimeout(timer);
			const elapsed = Date.now() + clockOffset - startedAt;
			if (elapsed >= durationMs) {
				if (animation) {
					animation.currentTime = durationMs;
					animation.pause();
				}
				completedRef.current = drawId ?? null;
				setCompletedId(drawId ?? null);
				return;
			}
			setCompletedId(null);
			if (animation) animation.currentTime = elapsed;
			timer = setTimeout(align, Math.max(1, durationMs - elapsed));
		}
		if (
			!motionOff &&
			!media.matches &&
			typeof rotorRef.current?.animate === "function" &&
			Date.now() + clockOffset < startedAt + durationMs
		) {
			animation = rotorRef.current.animate(
				[
					{ transform: "rotate(0deg)" },
					{ transform: `rotate(${toRotation}deg)` },
				],
				{
					duration: durationMs,
					easing: "cubic-bezier(.12,.72,.16,1)",
					fill: "both",
				},
			);
		}
		align();
		function onVisibility() {
			if (document.visibilityState === "visible") align();
		}
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			active = false;
			clearTimeout(timer);
			animation?.cancel();
			document.removeEventListener("visibilitychange", onVisibility);
		};
	}, [
		drawId,
		startedAt,
		durationMs,
		toRotation,
		clockOffset,
		rotorRef,
		motionOff,
	]);
	return Boolean(draw && completedId === draw.id);
}
