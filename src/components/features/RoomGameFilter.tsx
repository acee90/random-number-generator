import { Check, Search } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
	RoomGameFilter as GameFilter,
	RoomCandidate,
} from "@/lib/lunchRoom";

export default function RoomGameFilter({
	candidates,
	filter,
	eligibleIds,
	excludedIds,
	excludeDrawn,
	disabled,
	onChange,
}: {
	candidates: RoomCandidate[];
	filter: GameFilter;
	eligibleIds: Set<string>;
	excludedIds: string[];
	excludeDrawn: boolean;
	disabled: boolean;
	onChange: (filter: GameFilter) => void;
}) {
	const id = useId();
	const [query, setQuery] = useState("");
	const categories = [
		...new Set(candidates.map((candidate) => candidate.category || "미분류")),
	];
	const selected = filter.categories ?? categories;
	const manual = new Set(filter.excludedIds);
	const visible = candidates.filter(
		(candidate) =>
			selected.includes(candidate.category || "미분류") &&
			candidate.name
				.toLocaleLowerCase()
				.includes(query.trim().toLocaleLowerCase()),
	);
	const active = filter.categories !== null || manual.size > 0;
	return (
		<section className="room-game-filter" aria-labelledby={`${id}-title`}>
			<div className="room-filter-heading">
				<div>
					<h3 id={`${id}-title`}>이번 추첨에 넣을 후보</h3>
					<p>후보 원본은 유지됩니다. 선택한 조건은 마감할 때 적용됩니다.</p>
				</div>
				<output aria-live="polite">
					<strong>{eligibleIds.size}</strong> / {candidates.length}개
				</output>
			</div>
			<fieldset disabled={disabled} className="room-filter-category-field">
				<legend>분류로 선택</legend>
				<div className="room-filter-categories">
					<Button
						variant="outline"
						size="sm"
						className="room-filter-chip"
						aria-pressed={filter.categories === null}
						onClick={() => onChange({ ...filter, categories: null })}
					>
						전체 분류 <span>{candidates.length}</span>
					</Button>
					{categories.map((category) => (
						<Button
							key={category}
							variant="outline"
							size="sm"
							className="room-filter-chip"
							aria-label={`${category} 분류 포함`}
							aria-pressed={selected.includes(category)}
							onClick={() =>
								onChange({
									...filter,
									categories: selected.includes(category)
										? selected.filter((value) => value !== category)
										: [...new Set([...selected, category])],
								})
							}
						>
							{selected.includes(category) && (
								<Check size={14} aria-hidden="true" />
							)}
							{category}{" "}
							<span>
								{
									candidates.filter(
										(candidate) =>
											(candidate.category || "미분류") === category,
									).length
								}
							</span>
						</Button>
					))}
				</div>
			</fieldset>
			<div className="room-filter-list-heading">
				<h4>
					후보별 선택 <span>{visible.length}개</span>
				</h4>
				<label className="room-filter-search" htmlFor={`${id}-search`}>
					<Search size={16} aria-hidden="true" />
					<Input
						id={`${id}-search`}
						aria-label="필터 후보 검색"
						placeholder="후보 검색"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						disabled={disabled}
					/>
				</label>
			</div>
			<fieldset disabled={disabled} className="room-filter-candidate-field">
				<legend className="sr-only">후보별 추첨 포함</legend>
				<ul className="room-filter-list">
					{visible.map((candidate) => {
						const drawn = excludeDrawn && excludedIds.includes(candidate.id);
						return (
							<li
								key={candidate.id}
								data-included={eligibleIds.has(candidate.id)}
							>
								<label className="room-filter-check">
									<input
										type="checkbox"
										aria-label={`${candidate.name} 추첨 포함`}
										checked={!manual.has(candidate.id)}
										onChange={(event) => {
											const next = new Set(manual);
											if (event.target.checked) next.delete(candidate.id);
											else next.add(candidate.id);
											onChange({ ...filter, excludedIds: [...next] });
										}}
									/>
									<span className="room-filter-candidate-name">
										{candidate.name}
										<small>{candidate.category || "미분류"}</small>
									</span>
									<span className="room-filter-candidate-state">
										{manual.has(candidate.id)
											? "직접 제외"
											: drawn
												? "당첨 제외"
												: "포함"}
									</span>
								</label>
							</li>
						);
					})}
				</ul>
			</fieldset>
			{visible.length === 0 && (
				<p className="room-filter-empty">
					{query.trim()
						? "검색 결과가 없습니다. 다른 이름으로 검색해 주세요."
						: "선택한 분류가 없습니다. 추첨에 넣을 분류를 선택해 주세요."}
				</p>
			)}
			<div className="room-filter-footer">
				<p>분류를 바꿔도 후보별 제외 선택은 유지됩니다.</p>
				<Button
					variant="ghost"
					size="sm"
					disabled={disabled || !active}
					onClick={() => onChange({ categories: null, excludedIds: [] })}
				>
					필터 초기화
				</Button>
			</div>
		</section>
	);
}
