// Run against npm run dev. Use a fresh browser profile and a local room for each run.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const origin = new URL(process.argv[2] ?? "http://localhost:3000").origin;
const browser = await chromium.launch(
	process.env.CHROME_PATH
		? { executablePath: process.env.CHROME_PATH }
		: { channel: "chrome" },
);
try {
	const page = await browser.newPage({
		viewport: { width: 1440, height: 940 },
		locale: "ko-KR",
		hasTouch: true,
	});
	page.setDefaultTimeout(15_000);
	const created = await page.request.post(
		new URL("/api/lunch/rooms", origin).href,
		{
			headers: { Origin: origin },
			data: {
				title: "룰렛 동작 확인",
				hostName: "방장",
				candidateIds: [],
				candidates: [
					"김치찌개",
					"돈까스",
					"쌀국수",
					"비빔밥",
					"우동",
					"떡볶이",
				].map((name, i) => ({ id: `menu-${i}`, name, category: "점심" })),
			},
		},
	);
	assert.equal(created.status(), 201);
	const { roomId, hostToken, joinPath } = await created.json();
	await page.addInitScript(
		({ roomId, hostToken }) =>
			localStorage.setItem(`randomlab:lunch-room-host:${roomId}`, hostToken),
		{ roomId, hostToken },
	);
	// Hold the lazy renderer so the first frame can be inspected even on localhost.
	const painterModule =
		/\/(?:picnic\/paint\.ts|assets\/paint-[\w-]+\.js)(?:\?|$)/;
	const { promise: paintGate, resolve: releasePaint } = Promise.withResolvers();
	await page.route(painterModule, async (route) => {
		await paintGate;
		await route.continue();
	});
	await page.goto(new URL(joinPath, origin).href);
	await page.getByRole("textbox", { name: "닉네임" }).fill("방장");
	await page.getByRole("button", { name: "입장하기" }).click();
	await page.getByRole("button", { name: "마감", exact: true }).click();
	await page.getByRole("combobox", { name: /추첨 보기/ }).click();
	await page.getByRole("option", { name: "룰렛", exact: true }).click();
	const board = page.getByRole("region", { name: "게임 보드" });
	const panel = page.getByRole("region", { name: "룰렛", exact: true });
	const fallbackDraw = board.getByRole("button", { name: "룰렛 돌리기" });
	await fallbackDraw.waitFor();
	const loadingHeight = (await board.boundingBox()).height;
	assert.equal(await fallbackDraw.count(), 1);
	assert.ok(await fallbackDraw.isEnabled());
	assert.ok(await board.locator(".lunch-wheel-rotor").isVisible());
	assert.equal(await board.locator("canvas[data-painted]").count(), 0);
	await fallbackDraw.focus();
	const rotor = board.locator(".lunch-wheel-rotor");
	const initialPose = await rotor.evaluate((el) => el.style.transform);
	await page.keyboard.down("Space");
	await page.waitForFunction(
		(before) =>
			document.querySelector(".lunch-wheel-rotor")?.style.transform !== before,
		initialPose,
	);
	assert.ok(await fallbackDraw.isEnabled());
	await page.keyboard.up("Space");
	assert.ok(await fallbackDraw.isEnabled());
	releasePaint();
	await board.getByRole("heading", { name: "좋아요 0" }).waitFor();

	await board.locator("canvas[data-painted]").waitFor();
	assert.equal((await board.boundingBox()).height, loadingHeight);
	const history = board.getByRole("button", { name: "당첨 내역 열기" });
	const popup = page.getByRole("dialog", { name: "당첨 내역" });
	const switchName = /중복 없이 추첨/;
	const exclude = board.getByRole("switch", { name: switchName });
	const initial = await exclude.isChecked();
	await board
		.locator("label.picnic-exclusion")
		.click({ position: { x: 12, y: 22 } });
	await board
		.getByRole("switch", { name: switchName, checked: !initial })
		.waitFor();
	assert.equal(await popup.count(), 0);
	await exclude.click();
	await board
		.getByRole("switch", { name: switchName, checked: initial })
		.waitFor();
	if (!initial) {
		await exclude.press("Space");
		await board
			.getByRole("switch", { name: switchName, checked: true })
			.waitFor();
	}
	for (const { width, height } of [
		{ width: 320, height: 760 },
		{ width: 591, height: 718 },
		{ width: 597, height: 850 },
		{ width: 701, height: 718 },
		{ width: 1440, height: 940 },
	]) {
		const reduce = width === 597;
		await page.emulateMedia({
			reducedMotion: reduce ? "reduce" : "no-preference",
		});
		await page.setViewportSize({ width, height });
		const wheel = board.locator(".picnic-wheel");
		await wheel.scrollIntoViewIfNeeded();
		// Wait for the ResizeObserver layout and the following paint after resizing or unfolding.
		await page.evaluate(
			() =>
				new Promise((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(resolve)),
				),
		);
		const spin = board.locator(".picnic-spin-footer button");
		await spin.scrollIntoViewIfNeeded();
		const footerOffset = await spin.evaluate(
			(el) => el.offsetTop + el.parentElement.offsetTop,
		);
		const idleHeight = (await board.boundingBox()).height;
		const panelHeight = (await panel.boundingBox()).height;
		await spin.click();
		const spinning = board.locator(
			'canvas[data-painted][data-scene="spinning"]',
		);
		await spinning.waitFor();
		if (!reduce) {
			// After the result overlay clears, the rim stays still while the disc turns.
			await page.waitForTimeout(700);
			const before = await spinning.evaluate(wheelPixels);
			await page.waitForTimeout(90);
			const after = await spinning.evaluate(wheelPixels);
			assert.equal(before.rim, after.rim);
			assert.notEqual(before.disc, after.disc);
			const pose = await rotor.evaluate((el) => el.style.transform);
			await page.waitForFunction(
				(before) =>
					document.querySelector(".lunch-wheel-rotor")?.style.transform !==
					before,
				pose,
			);
		}
		await page.evaluate(
			() =>
				new Promise((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(resolve)),
				),
		);
		assert.equal((await board.boundingBox()).height, idleHeight);
		const result = board.locator('canvas[data-painted][data-scene="result"]');
		await page.waitForFunction(() =>
			document.querySelector('canvas[data-painted][data-scene="result"]'),
		);
		if (!reduce && process.env.ROULETTE_CAPTURE_DIR) {
			const png = await result.evaluate(async (el) => {
				await new Promise((resolve) => setTimeout(resolve, 140));
				return el.toDataURL();
			});
			await writeFile(
				`${process.env.ROULETTE_CAPTURE_DIR}/winner-${width}.png`,
				Buffer.from(png.split(",")[1], "base64"),
			);
		}
		if (!reduce) {
			const ticketPixels = () =>
				result.evaluate((canvas) => {
					const ticket = canvas.parentElement.querySelector(".picnic-ticket");
					const bounds = canvas.getBoundingClientRect();
					const rect = ticket.getBoundingClientRect();
					const scale = canvas.width / bounds.width;
					return [
						...canvas
							.getContext("2d")
							.getImageData(
								Math.floor(
									(rect.left - bounds.left + rect.width / 2 - 10) * scale,
								),
								Math.floor(
									(rect.top - bounds.top + rect.height / 2 - 10) * scale,
								),
								Math.round(20 * scale),
								Math.round(20 * scale),
							).data,
					];
				});
			await page.waitForTimeout(320);
			const duringPause = await ticketPixels();
			await page.waitForTimeout(190);
			assert.notDeepEqual(
				await ticketPixels(),
				duringPause,
				`${width}px: the ticket should start assembling after the 300ms pause`,
			);
		}
		assert.equal(
			(await board.boundingBox()).height,
			idleHeight,
			`${width}px: revealing the result must keep the waiting layout height`,
		);
		assert.equal((await panel.boundingBox()).height, panelHeight);
		assert.equal(
			await board.getByRole("heading", { name: "실시간 투표 현황" }).count(),
			0,
		);
		assert.equal(await board.getByText(/투표가 마감돼요/).count(), 0);
		assert.equal(
			await spin.evaluate((el) => el.offsetTop + el.parentElement.offsetTop),
			footerOffset,
		);
		const lists = board.locator(".picnic-sheet .room-feedback-list ul");
		const listHeights = () =>
			lists.evaluateAll((nodes) => nodes.map((list) => list.clientHeight));
		const emptyHeights = await listHeights();
		assert.equal(emptyHeights.length, 2);
		for (const list of await lists.all()) {
			assert.ok(
				await list.evaluate((el) => {
					const slots = [...el.children];
					const row = parseFloat(
						getComputedStyle(el).getPropertyValue("--voter-row-height"),
					);
					return (
						slots.length === 3 &&
						el.clientHeight >= row * 3 &&
						slots.every((li) => li.getBoundingClientRect().height >= row) &&
						el.scrollHeight === el.clientHeight
					);
				}),
				`${width}px: reserve three visible voter rows in each column`,
			);
		}
		await page.waitForTimeout(1000);
		if (process.env.ROULETTE_CAPTURE_DIR) {
			await board.screenshot({
				path: `${process.env.ROULETTE_CAPTURE_DIR}/result-${width}.png`,
			});
		}
		const like = board.getByRole("button", { name: "좋아요 투표" });
		await like.click();
		await board
			.getByRole("heading", { name: "좋아요 1", exact: true })
			.waitFor();
		assert.deepEqual(await listHeights(), emptyHeights);
		const motion = await result.evaluate(async (canvas) => {
			const number = canvas.parentElement
				.querySelector('[data-hit="up"] strong')
				.getBoundingClientRect();
			const box = canvas.getBoundingClientRect(),
				scale = canvas.width / box.width;
			const frames = new Set();
			const ctx = canvas.getContext("2d");
			// Sample only the number after selection, so changing the count alone cannot pass.
			for (let i = 0; i < 8; i++) {
				await new Promise(requestAnimationFrame);
				const { data } = ctx.getImageData(
					(number.x - box.x - 5) * scale,
					(number.y - box.y - 5) * scale,
					(number.width + 10) * scale,
					(number.height + 10) * scale,
				);
				frames.add(
					data.reduce((sum, byte) => Math.imul(sum ^ byte, 16777619), 0),
				);
			}
			return frames.size;
		});
		assert.ok(
			reduce ? motion === 1 : motion > 1,
			`${width}px: vote feedback must respect reduced motion`,
		);
		assert.ok(
			await board
				.getByRole("list", { name: "좋아요 투표한 참가자" })
				.isVisible(),
		);
		assert.equal(
			await board.getByRole("list", { name: "당첨 제외 내역" }).count(),
			0,
		);
		const canvas = board.locator("canvas.picnic-art");
		const backdropPixel = () =>
			canvas.evaluate((el) => {
				const ctx = el.getContext("2d");
				return [
					...ctx.getImageData(
						Math.floor(el.width * 0.5),
						Math.floor(el.height * 0.02),
						1,
						1,
					).data,
				];
			});
		const beforeBackdrop = await backdropPixel();
		await history.focus();
		await history.press("Enter");
		await popup.waitFor();
		await page.evaluate(
			() =>
				new Promise((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(resolve)),
				),
		);
		assert.deepEqual(
			await backdropPixel(),
			beforeBackdrop,
			`${width}px: dialog backdrop must not darken the Pixi board`,
		);
		if (process.env.ROULETTE_CAPTURE_DIR)
			await board.screenshot({
				path: `${process.env.ROULETTE_CAPTURE_DIR}/history-${width}.png`,
			});
		assert.equal(
			await popup.getByRole("checkbox", { name: "이전 게임 포함" }).count(),
			0,
		);
		assert.ok(
			(await popup.getByRole("button", { name: /상세 기록 열기$/ }).count()) >
				0,
		);
		assert.ok(
			await popup.evaluate((el) => {
				const board = el.closest(".picnic-popup-layer").getBoundingClientRect();
				const pane = el.closest(".room-primary-column").getBoundingClientRect();
				const box = el.getBoundingClientRect();
				const left = Math.max(0, board.left, pane.left),
					right = Math.min(innerWidth, board.right, pane.right);
				const top = Math.max(0, board.top, pane.top),
					bottom = Math.min(innerHeight, board.bottom, pane.bottom);
				return (
					Math.abs(box.left + box.right - left - right) < 3 &&
					Math.abs(box.top + box.bottom - top - bottom) < 3 &&
					box.left >= left &&
					box.right <= right &&
					box.top >= top &&
					box.bottom <= bottom
				);
			}),
			`${width}px: center the entire history dialog in the visible part of the board`,
		);
		assert.ok(
			await popup.evaluate(
				(el) =>
					!!el.closest(".picnic-frame") && el.contains(document.activeElement),
			),
		);
		if (width < 900) {
			assert.ok(
				await popup.evaluate((el) => {
					const box = el.getBoundingClientRect();
					const viewport = el
						.closest(".room-primary-column")
						.getBoundingClientRect();
					return (
						box.top >= viewport.top - 1 && box.bottom <= viewport.bottom + 1
					);
				}),
				`${width}px: the complete popup must fit above chat`,
			);
		}
		await page.keyboard.press("Escape");
		await popup.waitFor({ state: "detached" });
		await page.waitForFunction(() =>
			document.activeElement?.matches(".picnic-history-button"),
		);
		const count = board.getByRole("button", {
			name: /당첨 제외 후보 \d+개 보기/,
		});
		await count.press("Enter");
		const exclusions = page.getByRole("dialog", { name: "당첨 제외 후보" });
		await exclusions.getByRole("list", { name: "당첨 제외 내역" }).waitFor();
		if (width === 320) {
			await exclusions
				.getByRole("button", { name: "제외 목록 초기화" })
				.click();
			const confirm = page.getByRole("alertdialog");
			assert.ok(await confirm.evaluate((el) => !!el.closest(".picnic-frame")));
			await confirm
				.getByRole("button", { name: "초기화", exact: true })
				.click();
			await exclusions.getByText("아직 제외된 후보가 없어요.").waitFor();
		}
		if (width === 1440) {
			const target = await exclusions.evaluate(async (el) => {
				await new Promise((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(resolve)),
				);
				const panel = el.getBoundingClientRect();
				const overlay = el.parentElement
					.querySelector(".ui-dialog-overlay")
					.getBoundingClientRect();
				const candidates = [
					{ x: (panel.right + overlay.right) / 2, y: panel.top + 24 },
					{ x: panel.left + 24, y: (panel.bottom + overlay.bottom) / 2 },
				];
				return candidates.find(({ x, y }) =>
					document.elementFromPoint(x, y)?.matches(".ui-dialog-overlay"),
				);
			});
			assert.ok(
				target,
				"the board overlay must expose a pointer dismissal target",
			);
			await page.mouse.click(target.x, target.y);
		} else await page.keyboard.press("Escape");
		await exclusions.waitFor({ state: "detached" });
		await page.waitForFunction(
			(selector) => document.activeElement?.matches(selector),
			width === 320
				? '.picnic-exclusion [role="switch"]'
				: ".picnic-exclusion-count",
		);

		assert.equal((await board.boundingBox()).height, idleHeight);
		console.log(`${width}px passed (board height: ${idleHeight}px)`);
	}
	await page.getByRole("button", { name: "후보", exact: true }).click();
	await page.getByRole("button", { name: "김치찌개 이름 수정" }).click();
	const nameField = page.getByRole("textbox", { name: "1번 후보 이름" });
	await nameField.fill("된장찌개");
	await nameField.press("Enter");
	await page.getByRole("button", { name: "마감", exact: true }).click();
	await history.press("Enter");
	await popup.getByText("현재 후보로 당첨된 내역이 없어요.").waitFor();
	const previous = popup.getByRole("checkbox", { name: "이전 게임 포함" });
	assert.equal(await previous.isChecked(), false);
	const height = (await popup.boundingBox()).height;
	await previous.press("Space");
	await popup.getByText("김치찌개 → 된장찌개").waitFor();
	assert.ok(await previous.isChecked());
	assert.equal((await popup.boundingBox()).height, height);
	await popup.getByText("이전 게임 포함", { exact: true }).click();
	await popup.getByText("현재 후보로 당첨된 내역이 없어요.").waitFor();
} finally {
	await browser.close();
}
function wheelPixels(canvas) {
	const wheel = canvas.parentElement
		.querySelector(".picnic-wheel")
		.getBoundingClientRect();
	const box = canvas.getBoundingClientRect();
	const scale = canvas.width / box.width,
		unit = (wheel.width * scale) / 440;
	const cx = (wheel.x + wheel.width / 2 - box.x) * scale,
		cy = (wheel.y + wheel.height / 2 - box.y) * scale;
	const side = Math.floor(420 * unit);
	const { data } = canvas
		.getContext("2d")
		.getImageData(
			Math.round(cx - side / 2),
			Math.round(cy),
			side,
			Math.floor(side / 2),
		);
	let rim = 0,
		disc = 0;
	for (let i = 0; i < data.length; i += 4) {
		const pixel = i / 4,
			r =
				Math.hypot((pixel % side) - side / 2, Math.floor(pixel / side)) / unit;
		if (r > 178 && r < 209) rim = Math.imul(rim ^ data[i], 16777619);
		if (r > 70 && r < 156) disc = Math.imul(disc ^ data[i], 16777619);
	}
	return { rim, disc };
}
