import { ArrowRight, Shuffle } from "lucide-react";
import SiteHeader from "@/components/layout/SiteHeader";

export default function RouteNotFound() {
	return (
		<div className="random-lab">
			<SiteHeader />
			<main id="main-content" tabIndex={-1}>
				<section className="page-heading" aria-labelledby="not-found-title">
					<span className="section-label">404</span>
					<h1 id="not-found-title">페이지를 찾을 수 없습니다</h1>
					<p>주소를 확인하거나 점메추 홈으로 이동해 주세요.</p>
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
