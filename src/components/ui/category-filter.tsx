import { Check, SlidersHorizontal } from "lucide-react";
import { Button } from "./button";
import "./category-filter.css";

export function CategoryFilterButton({
	controls,
	expanded,
	count,
	total,
	description,
	size = "sm",
	showCount = true,
	disabled,
	onClick,
}: {
	controls: string;
	expanded: boolean;
	count: number;
	total: number;
	description: string;
	size?: "sm" | "default";
	showCount?: boolean;
	disabled?: boolean;
	onClick: () => void;
}) {
	return (
		<>
			<Button
				variant="outline"
				size={size}
				aria-label="필터"
				aria-expanded={expanded}
				aria-controls={controls}
				aria-describedby={`${controls}-count`}
				disabled={disabled}
				onClick={onClick}
			>
				<SlidersHorizontal size={16} aria-hidden="true" />
				필터
				{showCount && (
					<span className="category-filter-count" aria-hidden="true">
						{count}/{total}
					</span>
				)}
			</Button>
			<span className="sr-only" id={`${controls}-count`}>
				{description}
			</span>
		</>
	);
}

export function CategoryFilterChips({
	id,
	legend,
	options,
	selected,
	allSelected,
	total,
	disabled,
	onToggleAll,
	onSelect,
}: {
	id?: string;
	legend: string;
	options: readonly { value: string; count?: number }[];
	selected: readonly string[];
	allSelected: boolean;
	total?: number;
	disabled?: boolean;
	onToggleAll?: () => void;
	onSelect: (category: string | null) => void;
}) {
	return (
		<fieldset id={id} className="category-filter" disabled={disabled}>
			<legend className="sr-only">{legend}</legend>
			<div className="category-filter-chips">
				<Button
					variant="outline"
					size="sm"
					aria-pressed={allSelected}
					disabled={!options.length}
					onClick={() => (onToggleAll ? onToggleAll() : onSelect(null))}
				>
					{onToggleAll && allSelected && <Check size={14} aria-hidden="true" />}
					전체{total !== undefined && ` ${total}`}
				</Button>
				{options.map(({ value, count }) => (
					<Button
						key={value}
						variant="outline"
						size="sm"
						aria-label={count === undefined ? `${value} 분류 포함` : undefined}
						aria-pressed={allSelected || selected.includes(value)}
						onClick={() => onSelect(value)}
					>
						{(allSelected || selected.includes(value)) && (
							<Check size={14} aria-hidden="true" />
						)}
						{value}
						{count !== undefined && ` ${count}`}
					</Button>
				))}
			</div>
		</fieldset>
	);
}
