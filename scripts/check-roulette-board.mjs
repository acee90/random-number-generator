// Run against npm run dev. Use a fresh browser profile and a local room for each run.
import assert from "node:assert/strict";
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
	await page.goto(new URL(joinPath, origin).href);
	await page.getByRole("textbox", { name: "닉네임" }).fill("방장");
	await page.getByRole("button", { name: "입장하기" }).click();
	await page.getByRole("button", { name: "마감", exact: true }).click();
	const board = page.getByRole("region", { name: "게임 보드" });
	const idle = board.locator('canvas[data-painted][data-scene="idle"]');
	await idle.waitFor();
	const options = board.getByRole("button", { name: /^중복 없이 추첨/ });
	const popup = page.getByRole("dialog", { name: "중복 없이 추첨" });
	await options.click();
	const exclude = popup.getByRole("switch");
	if (!(await exclude.isChecked())) await exclude.click();
	await popup.getByRole("button", { name: "닫기" }).click();
	for (const { width, height } of [
		{ width: 320, height: 760 },
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
		const center = await wheel.evaluate((el) => {
			const box = el.getBoundingClientRect();
			const canvas = el
				.closest(".picnic-frame")
				.querySelector("canvas")
				.getBoundingClientRect();
			const x = canvas.left + canvas.width / 2,
				y = box.top + box.height / 2;
			const hit = document
				.elementFromPoint(x, y)
				?.closest('button[data-hit="draw"]');
			const button = hit?.getBoundingClientRect();
			return {
				x,
				y,
				aligned: Boolean(
					button &&
						Math.abs(x - button.x - button.width / 2) < 1 &&
						Math.abs(y - button.y - button.height / 2) < 1,
				),
			};
		});
		assert.ok(
			center.aligned,
			`${width}px: the painted hub must receive the click`,
		);
		const before = await idle.evaluate(wheelPixels);
		if (width < 700) await page.touchscreen.tap(center.x, center.y);
		else await page.mouse.click(center.x, center.y);
		const spinning = board.locator(
			'canvas[data-painted][data-scene="spinning"]',
		);
		await spinning.waitFor();
		if (!reduce)
			await page.waitForFunction(
				() =>
					document.querySelector(".lunch-wheel-rotor")?.getAnimations()[0]
						?.currentTime > 250,
			);
		await page.evaluate(
			() =>
				new Promise((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(resolve)),
				),
		);
		const during = await spinning.evaluate(wheelPixels);
		assert.equal(
			during.rim,
			before.rim,
			`${width}px: the rim and background must stay fixed`,
		);
		if (!reduce)
			assert.notEqual(
				during.disc,
				before.disc,
				`${width}px: the inner disc must turn`,
			);
		const result = board.locator('canvas[data-painted][data-scene="result"]');
		await result.waitFor();
		const like = board.getByRole("button", { name: "좋아요 투표" });
		await like.click();
		await board
			.getByRole("heading", { name: "좋아요 1", exact: true })
			.waitFor();
		const motion = await result.evaluate(async (canvas) => {
			const card = canvas.parentElement
				.querySelector('[data-hit="up"]')
				.getBoundingClientRect();
			const box = canvas.getBoundingClientRect(),
				scale = canvas.width / box.width;
			const frames = new Set();
			const ctx = canvas.getContext("2d");
			// Sample only the number after selection, so changing the count alone cannot pass.
			for (let i = 0; i < 8; i++) {
				await new Promise(requestAnimationFrame);
				const { data } = ctx.getImageData(
					(card.x - box.x + card.width * 0.65) * scale,
					(card.y - box.y + 5) * scale,
					card.width * 0.3 * scale,
					(card.height - 10) * scale,
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
		for (const choice of ["up", "down"]) {
			const group = board.locator(`[data-choice="${choice}"]`);
			const button = await group.getByRole("button").boundingBox();
			const list = await group
				.locator("ul, .room-feedback-empty")
				.boundingBox();
			assert.ok(button.height >= 44 && Math.abs(button.x - list.x) <= 1);
			assert.ok(
				list.y >= button.y + button.height &&
					list.y - button.y - button.height <= 12,
			);
		}
		assert.equal(
			await board.getByRole("list", { name: "당첨 제외 내역" }).count(),
			0,
		);
		await options.focus();
		await options.press("Enter");
		await popup.waitFor();
		assert.ok(
			await popup.getByRole("list", { name: "당첨 제외 내역" }).isVisible(),
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
		if (width === 320) {
			await popup.getByRole("button", { name: "제외 목록 초기화" }).click();
			const confirm = page.getByRole("alertdialog");
			assert.ok(await confirm.evaluate((el) => !!el.closest(".picnic-frame")));
			await confirm
				.getByRole("button", { name: "초기화", exact: true })
				.click();
			await popup.getByText("아직 제외된 후보가 없어요.").waitFor();
		}
		if (width === 1440) {
			const box = await popup.boundingBox();
			await page.mouse.click(box.x + box.width + 12, box.y + 24);
		} else await page.keyboard.press("Escape");
		await popup.waitFor({ state: "detached" });
		await page.waitForFunction(() =>
			document.activeElement?.matches(".picnic-exclusion"),
		);

		await board.getByRole("button", { name: "다음 게임" }).click();
		await idle.waitFor();
		console.log(`${width}px passed`);
	}
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
