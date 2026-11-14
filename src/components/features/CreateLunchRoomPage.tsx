import { ArrowLeft, ChevronRight } from "lucide-react";
import SiteHeader from "@/components/layout/SiteHeader";
import { sampleLunchPlaces } from "@/lib/lunch";
import { lunchRoomLimits } from "@/lib/lunchRoom";
import CreateLunchRoom from "./CreateLunchRoom";
import "./create-lunch-room-page.css";

export default function CreateLunchRoomPage() {
	return (
		<div className="random-lab create-room-page">
			<SiteHeader active="lunch" />
			<main id="main-content" className="create-room-main">
				<nav className="create-room-location" aria-label="현재 위치">
					<a href="/">
						<ArrowLeft size={17} aria-hidden="true" /> 홈
					</a>
					<ChevronRight size={14} aria-hidden="true" />
					<span aria-current="page">방 만들기</span>
				</nav>
				<header className="create-room-heading">
					<h1>방 만들기</h1>
					<p>방 이름과 닉네임을 정해 주세요.</p>
				</header>
				<CreateLunchRoom
					inline
					candidateIds={sampleLunchPlaces.map((place) => place.id)}
				/>
				<details className="create-room-help">
					<summary>기본 후보 · 이용 안내</summary>
					<div>
						<p>
							제공받은 엑셀 목록을 사용합니다. 위치 검색 기능은 준비 중입니다.
						</p>
						<p>
							최대 {lunchRoomLimits.maxParticipants}명 · 생성 후 24시간 유지
						</p>
						<p>만료되면 방의 채팅과 추첨 기록을 삭제합니다.</p>
					</div>
				</details>
			</main>
			<footer className="create-room-footer">
				<span>jeommechu.dev</span>
				<span>점심 메뉴 룰렛 · 실시간 채팅</span>
			</footer>
		</div>
	);
}
