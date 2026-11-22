import {
	ArrowRight,
	Dices,
	Link2,
	ListPlus,
	ThumbsUp,
	Users,
} from "lucide-react";
import SiteHeader from "@/components/layout/SiteHeader";
import { Button } from "@/components/ui/button";
import HomeHowItWorks from "./home-showcase/HomeHowItWorks";
import HomeRoomShowcase from "./home-showcase/HomeRoomShowcase";
import "./lunch-home.css";

export default function LunchHome() {
	return (
		<div className="random-lab jeommechu-home">
			<SiteHeader active="lunch" homeCurrent />
			<main id="main-content">
				<section
					className="lunch-home-start"
					aria-labelledby="lunch-home-title"
				>
					<div className="lunch-home-intro">
						<p className="lunch-home-kicker">점심 메뉴 추첨</p>
						<h1 id="lunch-home-title">
							오늘 점심,
							<br />
							룰렛으로 정해요.
						</h1>
						<p>원하는 후보를 모아 룰렛으로 하나 뽑아요.</p>
					</div>
					<div className="lunch-home-actions">
						<Button asChild size="default">
							<a className="lunch-home-create" href="/create">
								<span>
									<Users size={18} aria-hidden="true" />방 만들기
								</span>
								<ArrowRight size={18} aria-hidden="true" />
							</a>
						</Button>
						<Button asChild variant="outline" size="default">
							<a className="lunch-home-solo" href="/solo">
								<Dices size={20} aria-hidden="true" />
								혼자 추첨하기
								<ArrowRight size={18} aria-hidden="true" />
							</a>
						</Button>
						<ol
							className="lunch-home-steps"
							aria-label="추첨방에서 할 수 있는 일"
						>
							<li>
								<Link2 size={18} aria-hidden="true" />
								링크로 초대하기
							</li>
							<li>
								<ListPlus size={18} aria-hidden="true" />
								후보 추천받기
							</li>
							<li>
								<ThumbsUp size={18} aria-hidden="true" />
								결과에 반응 남기기
							</li>
						</ol>
					</div>
				</section>
				<HomeRoomShowcase />
				<HomeHowItWorks />
			</main>
			<footer className="lunch-home-footer">
				<span>jeommechu.dev</span>
				<span>점심 메뉴 룰렛 · 실시간 채팅</span>
			</footer>
		</div>
	);
}
