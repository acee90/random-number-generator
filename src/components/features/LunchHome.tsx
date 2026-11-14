import {
	ArrowRight,
	ChevronDown,
	Dices,
	Link2,
	Shuffle,
	Users,
} from "lucide-react";
import SiteHeader from "@/components/layout/SiteHeader";
import { sampleLunchPlaces } from "@/lib/lunch";
import "./lunch-home.css";

export default function LunchHome() {
	return (
		<div className="random-lab jeommechu-home">
			<SiteHeader active="lunch" />
			<main id="main-content">
				<section
					className="lunch-home-board"
					aria-labelledby="lunch-home-title"
				>
					<div className="lunch-home-start">
						<div className="lunch-home-intro">
							<p className="lunch-home-kicker">점심 메뉴 추첨</p>
							<h1 id="lunch-home-title">
								오늘 점심,
								<br />
								같이 정해요.
							</h1>
							<p>링크로 모여 같은 룰렛을 돌려요.</p>
						</div>
						<div className="lunch-home-actions">
							<a className="lunch-home-create" href="/create">
								<span>
									<Users size={22} aria-hidden="true" />방 만들기
								</span>
								<ArrowRight size={24} aria-hidden="true" />
							</a>
							<ol className="lunch-home-steps" aria-label="이용 방법">
								<li>
									<Link2 size={18} aria-hidden="true" />
									링크로 초대
								</li>
								<li>
									<Users size={18} aria-hidden="true" />
									채팅하며 후보 선택
								</li>
								<li>
									<Shuffle size={18} aria-hidden="true" />
									같은 룰렛, 같은 결과
								</li>
							</ol>
						</div>
					</div>
					<div className="lunch-home-secondary">
						<a className="lunch-home-solo" href="/solo">
							<Dices size={20} aria-hidden="true" />
							혼자 추첨하기
							<ArrowRight size={18} aria-hidden="true" />
						</a>
						<details className="lunch-home-details">
							<summary>
								식당 목록 · 이용 안내
								<ChevronDown size={16} aria-hidden="true" />
							</summary>
							<div>
								<p>
									회사 주변 음식점 {sampleLunchPlaces.length}곳으로 시작합니다.
								</p>
								<p>
									제공받은 엑셀 목록을 사용합니다. 위치 검색 기능은 준비
									중입니다.
								</p>
								<p>앱 설치나 회원가입 없이 링크로 참가할 수 있습니다.</p>
								<p>
									생성 후 24시간 유지 · 최대 30명. 만료되면 방의 채팅과 추첨
									기록을 삭제합니다.
								</p>
							</div>
						</details>
					</div>
				</section>
			</main>
			<footer className="lunch-home-footer">
				<span>jeommechu.dev</span>
				<span>점심 메뉴 룰렛 · 실시간 채팅</span>
			</footer>
		</div>
	);
}
