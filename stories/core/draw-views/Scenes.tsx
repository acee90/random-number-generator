import { Flower2, UtensilsCrossed } from "lucide-react";
import type { RefObject } from "react";
import type { LunchPlace } from "@/lib/lunch";
import type { RoomDraw } from "@/lib/lunchRoom";

export function MenuCard({
	place,
	index,
	drawing,
}: {
	place: LunchPlace;
	index: number;
	drawing: boolean;
}) {
	return (
		<div
			className="dv-deck"
			data-drawing={drawing || undefined}
			aria-hidden="true"
		>
			<div className="dv-playing-card" key={drawing ? "back" : "front"}>
				{drawing ? (
					<div className="dv-card-back">
						<UtensilsCrossed />
					</div>
				) : (
					<>
						<div className="dv-card-corner">
							<span className="dv-serial">
								Nº {String(index + 1).padStart(3, "0")}
							</span>
							<Flower2 />
						</div>
						<div className="dv-card-face">
							<UtensilsCrossed />
							<strong>{place.name}</strong>
						</div>
						<div className="dv-card-foot">
							<span>{place.category}</span>
							<Flower2 />
						</div>
					</>
				)}
			</div>
		</div>
	);
}

export function WinnerTicket({
	draw,
	titleRef,
}: {
	draw: RoomDraw;
	titleRef: RefObject<HTMLHeadingElement | null>;
}) {
	const winner = draw.candidates[draw.winnerIndex];
	return (
		<div className="dv-ticket">
			<div className="dv-ticket-main">
				<Flower2 aria-hidden="true" />
				<span>당첨 메뉴</span>
				<h2 ref={titleRef} tabIndex={-1} id="dv-winner">
					{winner.name}
				</h2>
				<small>{winner.category}</small>
			</div>
			<div className="dv-ticket-stub">
				<span>후보</span>
				<b>{draw.winnerIndex + 1}</b>
				<i aria-hidden="true" />
			</div>
		</div>
	);
}
