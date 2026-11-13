import {
	ArrowRight,
	Link2,
	MessageCircle,
	UtensilsCrossed,
} from "lucide-react";
import SiteHeader from "@/components/layout/SiteHeader";
import { sampleLunchPlaces } from "@/lib/lunch";
import CreateLunchRoom from "./CreateLunchRoom";
import "./lunch-home.css";

export default function LunchHome() {
	return (
		<div className="random-lab jeommechu-home">
			<SiteHeader active="lunch" />
			<main id="main-content">
				<div className="lunch-home-grid">
					<section
						className="lunch-home-intro"
						aria-labelledby="lunch-home-title"
					>
						<span className="lunch-home-eyebrow">점메추 · 점심 메뉴 추첨</span>
						<h1 id="lunch-home-title">
							방 만들고,
							<br />
							같이 점심 정하기
						</h1>
						<p>
							참가 링크를 공유하고 같은 룰렛을 보며
							<br className="lunch-home-desktop-break" /> 채팅으로 점심 메뉴를
							정하세요.
						</p>
						<ol className="lunch-home-steps" aria-label="이용 방법">
							<li>
								<Link2 size={19} aria-hidden="true" />
								<span>
									<strong>링크로 초대</strong>
									<small>앱 설치나 회원가입 없이 참가합니다.</small>
								</span>
							</li>
							<li>
								<MessageCircle size={19} aria-hidden="true" />
								<span>
									<strong>채팅하며 후보 선택</strong>
									<small>방장이 추첨할 식당을 고릅니다.</small>
								</span>
							</li>
							<li>
								<UtensilsCrossed size={19} aria-hidden="true" />
								<span>
									<strong>같은 룰렛, 같은 결과</strong>
									<small>각 식당은 같은 확률로 추첨합니다.</small>
								</span>
							</li>
						</ol>
					</section>
					<div className="lunch-home-create">
						<CreateLunchRoom
							inline
							candidateIds={sampleLunchPlaces.map((place) => place.id)}
						/>
						<p className="lunch-home-lifetime">
							생성 후 24시간 유지 · 최대 30명
							<br />
							만료되면 방의 채팅과 추첨 기록을 삭제합니다.
						</p>
					</div>
				</div>
				<section
					className="lunch-home-info"
					aria-label="현재 제공하는 식당 목록"
				>
					<div>
						<strong>
							회사 주변 음식점 {sampleLunchPlaces.length}곳으로 시작합니다.
						</strong>
						<p>
							제공받은 엑셀 목록을 사용합니다. 위치 검색 기능은 준비 중입니다.
						</p>
					</div>
					<a href="/solo">
						혼자 추첨하기 <ArrowRight size={16} aria-hidden="true" />
					</a>
				</section>
			</main>
			<footer className="lunch-home-footer">
				<span>jeommechu.dev</span>
				<span>점심 메뉴 룰렛 · 실시간 채팅</span>
			</footer>
		</div>
	);
}
