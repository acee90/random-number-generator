// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
	RoomEditableCandidateList,
	RoomReadonlyCandidateList,
} from "../src/components/features/RoomCandidateList";
import { sampleLunchPlaces } from "../src/lib/lunch";

afterEach(cleanup);

it("updates selection and uses the latest callback while preserving inherited disabled state", () => {
	const places = sampleLunchPlaces.slice(0, 2);
	const first = vi.fn();
	const next = vi.fn();
	const view = render(
		<fieldset>
			<RoomEditableCandidateList
				places={places}
				selectedIds={[places[0].id]}
				onIncludedChange={first}
			/>
		</fieldset>,
	);
	view.rerender(
		<fieldset>
			<RoomEditableCandidateList
				places={[...places]}
				selectedIds={[places[1].id]}
				onIncludedChange={next}
			/>
		</fieldset>,
	);
	const checkbox = screen.getByRole("checkbox", {
		name: `${places[0].name} 추첨 포함`,
	}) as HTMLInputElement;
	expect(checkbox.checked).toBe(false);
	fireEvent.click(checkbox);
	expect(first).not.toHaveBeenCalled();
	expect(next).toHaveBeenCalledExactlyOnceWith(places[0].id, true);
	view.rerender(
		<fieldset disabled>
			<RoomEditableCandidateList
				places={[...places]}
				selectedIds={[places[1].id]}
				onIncludedChange={next}
			/>
		</fieldset>,
	);
	expect(checkbox.matches(":disabled")).toBe(true);
});

it("refreshes names, categories and order without changing the original candidate numbers", () => {
	const places = sampleLunchPlaces.slice(0, 2);
	const view = render(<RoomReadonlyCandidateList places={places} />);
	view.rerender(
		<RoomReadonlyCandidateList
			places={[
				{ ...places[1], name: "새 식당 이름", category: "한식" },
				places[0],
			]}
		/>,
	);
	const rows = screen.getAllByRole("listitem");
	expect(rows[0].textContent).toBe("2새 식당 이름한식");
	expect(rows[1].textContent).toContain(places[0].name);
});
