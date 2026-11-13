import { type ErrorComponentProps, useRouter } from "@tanstack/react-router";
import { ArrowRight, LoaderCircle, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import SiteHeader from "@/components/layout/SiteHeader";

export default function RouteError({ reset }: ErrorComponentProps) {
	const router = useRouter();
	const mainRef = useRef<HTMLElement>(null);
	const [retrying, setRetrying] = useState(false);

	useEffect(() => {
		mainRef.current?.focus();
	}, []);

	async function retry() {
		if (retrying) return;
		setRetrying(true);
		try {
			await router.invalidate();
			reset?.();
		} catch {
			// Keep the recovery actions available if reloading also fails.
		} finally {
			setRetrying(false);
		}
	}

	return (
		<div className="random-lab">
			<SiteHeader active="lunch" />
			<main
				id="main-content"
				ref={mainRef}
				tabIndex={-1}
				aria-labelledby="route-error-title"
				aria-busy={retrying}
			>
				<section className="page-heading">
					<h1 id="route-error-title">화면을 열 수 없습니다</h1>
					<p>다시 시도하거나 홈으로 이동해 주세요.</p>
				</section>
				<button
					type="button"
					className="generate-button"
					disabled={retrying}
					onClick={() => void retry()}
				>
					<span>
						{retrying ? (
							<LoaderCircle size={19} className="spin" aria-hidden="true" />
						) : (
							<RotateCcw size={19} aria-hidden="true" />
						)}
						{retrying ? "다시 시도 중…" : "다시 시도"}
					</span>
				</button>
				<a className="text-button" href="/">
					홈으로 이동 <ArrowRight size={18} aria-hidden="true" />
				</a>
			</main>
		</div>
	);
}
