import {
	ArrowRight,
	Dices,
	History,
	Link2,
	ListPlus,
	ThumbsUp,
	Users,
	X,
} from "lucide-react";
import { useEffect, useState } from "react";
import SiteHeader from "@/components/layout/SiteHeader";
import { Button } from "@/components/ui/button";
import {
	type RecentLunchRoom,
	readRecentLunchRooms,
	removeRecentLunchRoom,
} from "@/lib/recentRooms";
import HomeHowItWorks from "./home-showcase/HomeHowItWorks";
import HomeRoomShowcase from "./home-showcase/HomeRoomShowcase";
import "./lunch-home.css";

export default function LunchHome() {
	const [recentRooms, setRecentRooms] = useState<RecentLunchRoom[]>([]);
	useEffect(() => {
		setRecentRooms(readRecentLunchRooms());
	}, []);
	function dismissRoom(roomId: string) {
		removeRecentLunchRoom(roomId);
		setRecentRooms((current) =>
			current.filter((entry) => entry.roomId !== roomId),
		);
	}
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
				{recentRooms.length > 0 && (
					<section className="lunch-home-recent" aria-label="최근 추첨방">
						<div className="lunch-home-recent-head">
							<h2>
								<History size={16} aria-hidden="true" /> 최근 추첨방
							</h2>
						</div>
						<ul className="lunch-home-recent-list">
							{recentRooms.map((room) => (
								<li key={room.roomId}>
									<Button
										asChild
										variant="outline"
										size="default"
										className="lunch-home-recent-link"
									>
										<a href={`/lunch-room/${room.roomId}`}>
											<span className="lunch-home-recent-meta">
												<strong>{room.title}</strong>
												<small>
													{room.role === "host" ? "방장" : "참여자"}
												</small>
											</span>
											<ArrowRight size={16} aria-hidden="true" />
										</a>
									</Button>
									<Button
										type="button"
										variant="ghost"
										size="icon"
										className="lunch-home-recent-dismiss"
										aria-label={`${room.title} 최근 목록에서 숨기기`}
										onClick={() => dismissRoom(room.roomId)}
									>
										<X size={16} aria-hidden="true" />
									</Button>
								</li>
							))}
						</ul>
					</section>
				)}
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
