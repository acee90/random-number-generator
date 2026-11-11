import { ArrowRight, Shuffle } from "lucide-react";

export default function RouteNotFound() {
	return (
		<div className="random-lab">
			<header className="masthead">
				<div className="top-bar">
					<a className="wordmark" href="/" aria-label="랜덤랩 홈">
						<span className="brand-icon">
							<Shuffle size={22} strokeWidth={2.5} aria-hidden="true" />
						</span>
						<span>
							random<span className="wordmark-light">lab</span>
							<span className="brand-period">.</span>
						</span>
					</a>
				</div>
			</header>
			<main id="main-content" tabIndex={-1}>
				<section className="page-heading" aria-labelledby="not-found-title">
					<span className="section-label">404</span>
					<h1 id="not-found-title">페이지를 찾을 수 없습니다</h1>
					<p>주소를 확인하거나 랜덤 번호 생성기로 이동해 주세요.</p>
				</section>
				<a className="generate-button" href="/">
					<span>
						<Shuffle size={19} aria-hidden="true" />
						홈으로 이동
					</span>
					<ArrowRight size={19} aria-hidden="true" />
				</a>
			</main>
		</div>
	);
}
