import {
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

type ScreenMode = "native" | "focus" | null;
type ScreenSession = { mode: ScreenMode; pending: boolean };

function supportsFullscreen() {
	return (
		document.fullscreenEnabled === true &&
		typeof document.documentElement.requestFullscreen === "function"
	);
}

function exitFullscreen() {
	if (document.fullscreenElement === document.documentElement)
		return document.exitFullscreen().catch(() => {});
}

export function useDrawFullscreen(
	scope: string | null,
	trigger: RefObject<HTMLButtonElement | null>,
) {
	const sessionRef = useRef<ScreenSession | null>(null);
	const [mode, setMode] = useState<ScreenMode>(null);
	const [nativeAvailable, setNativeAvailable] = useState(false);

	useEffect(() => {
		setMode(null);
		if (!scope) return;
		setNativeAvailable(supportsFullscreen());
		const session: ScreenSession = { mode: null, pending: false };
		sessionRef.current = session;

		function onFullscreenChange() {
			if (session.mode !== "native" || document.fullscreenElement) return;
			session.mode = null;
			setMode(null);
			if (document.activeElement === document.body)
				trigger.current?.focus({ preventScroll: true });
		}

		function onEscape(event: KeyboardEvent) {
			if (
				session.mode !== "focus" ||
				event.key !== "Escape" ||
				event.defaultPrevented ||
				event.isComposing ||
				(event.target instanceof Element &&
					event.target.closest(
						'[role="menu"],[role="dialog"],[role="alertdialog"]',
					))
			)
				return;
			event.preventDefault();
			session.mode = null;
			setMode(null);
			trigger.current?.focus({ preventScroll: true });
		}

		document.addEventListener("fullscreenchange", onFullscreenChange);
		document.addEventListener("keydown", onEscape);
		return () => {
			sessionRef.current = null;
			document.removeEventListener("fullscreenchange", onFullscreenChange);
			document.removeEventListener("keydown", onEscape);
			if (session.mode === "native") void exitFullscreen();
		};
	}, [scope, trigger]);

	async function toggle() {
		const session = sessionRef.current;
		if (!session || session.pending) return;
		if (session.mode === "native") {
			await exitFullscreen();
			return;
		}
		if (session.mode === "focus") {
			session.mode = null;
			setMode(null);
			return;
		}
		if (nativeAvailable && !document.fullscreenElement) {
			session.pending = true;
			try {
				await document.documentElement.requestFullscreen();
				if (sessionRef.current !== session) {
					void exitFullscreen();
					return;
				}
				session.mode = "native";
				setMode("native");
				return;
			} catch {
				if (sessionRef.current !== session) return;
				setNativeAvailable(false);
			} finally {
				session.pending = false;
			}
		}
		session.mode = "focus";
		setMode("focus");
	}

	return {
		active: Boolean(scope && mode),
		label:
			mode === "native"
				? "전체 화면 끝내기"
				: mode === "focus"
					? "집중 화면 끝내기"
					: nativeAvailable
						? "전체 화면"
						: "집중 화면",
		toggle,
	};
}

export function useDrawSound(
	scope: string | null,
	audible: boolean,
	drawId: string | undefined,
	phase: "spinning" | "result" | null,
) {
	const [enabled, setEnabled] = useState(false);
	const [supported, setSupported] = useState(false);
	const [error, setError] = useState("");
	const contextRef = useRef<AudioContext | null>(null);
	const stopRef = useRef<(() => void) | null>(null);
	const observedDraw = useRef<string | undefined>(undefined);

	const stop = useCallback(() => {
		stopRef.current?.();
		stopRef.current = null;
		observedDraw.current = undefined;
	}, []);

	const close = useCallback(() => {
		stop();
		const context = contextRef.current;
		contextRef.current = null;
		if (context) void context.close().catch(() => {});
	}, [stop]);

	useEffect(() => {
		setEnabled(false);
		setError("");
		if (!scope) return;
		setSupported(typeof window.AudioContext === "function");
		function onVisibility() {
			if (document.hidden) stop();
		}
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			document.removeEventListener("visibilitychange", onVisibility);
			close();
		};
	}, [scope, close, stop]);

	useEffect(() => {
		if (!enabled || !audible || !drawId || document.hidden) {
			stop();
			return;
		}
		if (phase === "spinning") {
			observedDraw.current = drawId;
			return;
		}
		if (phase !== "result" || observedDraw.current !== drawId) return;
		const context = contextRef.current;
		stop();
		if (context?.state !== "running") return;

		const note = context.createOscillator();
		const gain = context.createGain();
		const start = context.currentTime;
		note.frequency.setValueAtTime(523.25, start);
		note.frequency.setValueAtTime(659.25, start + 0.09);
		gain.gain.setValueAtTime(0, start);
		gain.gain.linearRampToValueAtTime(0.12, start + 0.02);
		gain.gain.exponentialRampToValueAtTime(0.001, start + 0.24);
		note.connect(gain).connect(context.destination);

		function disconnect() {
			note.disconnect();
			gain.disconnect();
		}
		function silence() {
			note.stop();
			disconnect();
		}
		note.onended = () => {
			if (stopRef.current === silence) {
				disconnect();
				stopRef.current = null;
			}
		};
		stopRef.current = silence;
		note.start(start);
		note.stop(start + 0.24);
	}, [audible, drawId, enabled, phase, stop]);

	function toggle() {
		setError("");
		if (contextRef.current) {
			close();
			setEnabled(false);
			return;
		}
		try {
			const context = new AudioContext();
			contextRef.current = context;
			setEnabled(true);
			void context.resume().catch(() => {
				if (contextRef.current !== context) return;
				close();
				setEnabled(false);
				setError("효과음을 켜지 못했습니다.");
			});
		} catch {
			close();
			setEnabled(false);
			setError("효과음을 켜지 못했습니다.");
		}
	}

	return { enabled, supported, error, toggle };
}
