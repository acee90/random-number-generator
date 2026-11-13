import { memo } from "react";
import { type LunchPlace, sampleLunchPlaces } from "@/lib/lunch";

export const roomCandidateNumbers: ReadonlyMap<string, number> = new Map(
	sampleLunchPlaces.map((place, index) => [place.id, index + 1]),
);

function samePlaces(left: readonly LunchPlace[], right: readonly LunchPlace[]) {
	return (
		left === right ||
		(left.length === right.length &&
			left.every((place, index) => {
				const next = right[index];
				return (
					place.id === next.id &&
					place.name === next.name &&
					place.category === next.category
				);
			}))
	);
}

type EditableProps = {
	places: readonly LunchPlace[];
	selectedIds: readonly string[];
	onIncludedChange: (id: string, included: boolean) => void;
};

export const RoomEditableCandidateList = memo(
	function RoomEditableCandidateList({
		places,
		selectedIds,
		onIncludedChange,
	}: EditableProps) {
		const selected = new Set(selectedIds);
		return (
			<div className="room-candidate-list">
				{places.map((place) => (
					<label key={place.id}>
						<input
							type="checkbox"
							checked={selected.has(place.id)}
							aria-label={`${place.name} 추첨 포함`}
							onChange={(event) =>
								onIncludedChange(place.id, event.target.checked)
							}
						/>
						<span className="room-candidate-number">
							{roomCandidateNumbers.get(place.id)}
						</span>
						<span>
							<strong>{place.name}</strong>
							<small>{place.category}</small>
						</span>
					</label>
				))}
			</div>
		);
	},
	(previous, next) =>
		previous.onIncludedChange === next.onIncludedChange &&
		samePlaces(previous.places, next.places) &&
		previous.selectedIds.length === next.selectedIds.length &&
		previous.selectedIds.every((id, index) => id === next.selectedIds[index]),
);

export const RoomReadonlyCandidateList = memo(
	function RoomReadonlyCandidateList({
		places,
	}: {
		places: readonly LunchPlace[];
	}) {
		return (
			<ul className="room-readonly-candidates">
				{places.map((place) => (
					<li key={place.id}>
						<span className="room-candidate-number">
							{roomCandidateNumbers.get(place.id)}
						</span>
						<span>
							<strong>{place.name}</strong>
							<small>{place.category}</small>
						</span>
					</li>
				))}
			</ul>
		);
	},
	(previous, next) => samePlaces(previous.places, next.places),
);
