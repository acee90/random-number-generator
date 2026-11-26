// Run against the local app. The canvas must contain the labels even when the native reel is still.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const origin = new URL(process.argv[2] ?? "http://localhost:3000").origin;
const browser = await chromium.launch(
	process.env.CHROME_PATH
		? { executablePath: process.env.CHROME_PATH }
		: { channel: "chrome" },
);

// Read just the light-colored lettering in the center row, away from the borders and brass marks.
function readLetters() {
	const canvas = document.querySelector(".slot-art[data-painted]");
	const drum = document.querySelector(".slot-drum").getBoundingClientRect();
	const box = canvas.getBoundingClientRect();
	const scale = canvas.width / box.width;
	const pixels = canvas
		.getContext("2d")
		.getImageData(
			Math.ceil((drum.left - box.left + 40) * scale),
			Math.ceil((drum.top - box.top + drum.height / 3 + 2) * scale),
			Math.floor((drum.width - 80) * scale),
			Math.floor((drum.height / 3 - 4) * scale),
		).data;
	let hash = 0,
		count = 0;
	for (let p = 0; p < pixels.length; p += 4) {
		if (pixels[p] < 190 || pixels[p + 1] < 155 || pixels[p + 2] < 110) continue;
		hash = (Math.imul(hash, 31) + p) >>> 0;
		count++;
	}
	return { hash, count };
}

async function join(page, path, name) {
	await page.goto(new URL(path, origin).href);
	await page.getByRole("textbox", { name: "닉네임" }).fill(name);
	await page.getByRole("button", { name: "입장하기" }).click();
}
const painted = (page) => page.locator("canvas.slot-art[data-painted]");
const button = (page, name) => page.getByRole("button", { name, exact: true });
const frame = (page) =>
	page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(resolve)),
			),
	);

// Sample the paper inside the native vote target, directly from the single Pixi canvas.
function paintedVote() {
	const canvas = document.querySelector(".slot-art[data-painted]");
	const target = document.querySelector('.slot-reveal [data-hit="up"]');
	if (!canvas || !target) return false;
	const box = canvas.getBoundingClientRect();
	const card = target.getBoundingClientRect();
	const scale = canvas.width / box.width;
	const x = Math.floor((card.left - box.left + 8) * scale);
	const y = Math.floor((card.top - box.top + 8) * scale);
	if (
		card.top <=
			document.querySelector(".slot-cabinet").getBoundingClientRect().bottom ||
		y >= canvas.height
	)
		return false;
	return canvas.getContext("2d").getImageData(x, y, 1, 1).data[3] > 245;
}

try {
	const host = await browser.newPage({
		locale: "ko-KR",
		viewport: { width: 1280, height: 900 },
	});
	const guest = await browser.newPage({
		locale: "ko-KR",
		viewport: { width: 320, height: 800 },
		reducedMotion: "reduce",
	});
	const created = await host.request.post(`${origin}/api/lunch/rooms`, {
		headers: { Origin: origin },
		data: {
			title: "슬롯머신 동작 확인",
			hostName: "방장",
			candidateIds: [],
			candidates: Array.from({ length: 200 }, (_, i) => ({
				id: `menu-${i}`,
				name: `${["비빔밥", "들기름 막국수", "김치찌개"][i % 3]} ${i + 1} · 제철 채소와 직접 담근 장으로 준비한 한 상, 갓 지은 밥과 오늘의 국과 반찬을 함께 내는 점심 정식`,
				category: "점심",
			})),
		},
	});
	assert.equal(created.status(), 201);
	const { roomId, hostToken, joinPath } = await created.json();
	await host.addInitScript(
		({ roomId, hostToken }) =>
			localStorage.setItem(`randomlab:lunch-room-host:${roomId}`, hostToken),
		{ roomId, hostToken },
	);
	await join(host, joinPath, "방장");
	await join(guest, joinPath, "참가자");
	await button(host, "마감").click();
	await Promise.all([painted(host).waitFor(), painted(guest).waitFor()]);

	for (const width of [320, 597, 1280]) {
		await host.setViewportSize({ width, height: 900 });
		await frame(host);
		const idle = await host.evaluate(readLetters);
		assert.ok(
			idle.count > 40,
			`${width}px: the canvas must contain the center label`,
		);
		assert.equal(
			await host
				.locator(".slot-cabinet")
				.evaluate((el) => getComputedStyle(el).opacity),
			"0",
		);
		const buttons = host.locator(".slot-controls").getByRole("button");
		assert.equal(await buttons.count(), 1);
		assert.equal(await buttons.first().innerText(), "슬롯 돌리기");
		assert.equal(
			await guest.locator(".slot-controls").getByRole("button").count(),
			0,
		);
		await button(host, "당첨 내역 열기").press("Enter");
		const history = host.getByRole("dialog", { name: "당첨 내역" });
		await history.getByText("아직 당첨 내역이 없어요.").waitFor();
		assert.equal(
			await history.getByRole("checkbox", { name: "이전 게임 포함" }).count(),
			0,
		);
		await host.waitForFunction(() => {
			const panel = document.querySelector(".picnic-popup");
			const canvas = document.querySelector(".slot-art[data-painted]");
			if (
				!panel ||
				!canvas ||
				getComputedStyle(panel.parentElement).opacity !== "0"
			)
				return false;
			const popup = panel.getBoundingClientRect(),
				bounds = canvas.getBoundingClientRect();
			const scale = canvas.width / bounds.width;
			const pixel = canvas
				.getContext("2d")
				.getImageData(
					Math.floor((popup.left + 8 - bounds.left) * scale),
					Math.floor((popup.top + 24 - bounds.top) * scale),
					1,
					1,
				).data;
			return pixel[0] > 240 && pixel[1] > 220 && pixel[3] === 255;
		});
		await host.keyboard.press("Escape");
		await history.waitFor({ state: "detached" });
	}
	const reduced = await guest.evaluate(readLetters);
	const idle = await host.evaluate(readLetters);
	const spin = button(host, "슬롯 돌리기");
	const canvas = await painted(host).elementHandle();
	const controls = host.locator(".slot-controls");
	const spinNode = await spin.elementHandle();
	const spinBox = await spin.boundingBox();
	const controlsBox = await controls.boundingBox();
	const drumBox = await host.locator(".slot-drum").boundingBox();
	await spin.focus();
	await host.keyboard.down("Enter");
	await host.locator('.slot-machine[data-drive="held"]').waitFor();
	await guest.locator('.slot-machine[data-drive="held"]').waitFor();
	assert.ok(await spin.isEnabled());
	await frame(host);
	assert.notEqual((await host.evaluate(readLetters)).hash, idle.hash);
	await host.keyboard.up("Enter");
	const spinning = host.locator('.slot-machine[data-phase="spinning"]');
	await spinning.waitFor();
	const countdown = guest.getByText(/^결과 공개까지 \d초$/);
	await countdown.waitFor();
	const countdownBox = await countdown.boundingBox();
	assert.ok(countdownBox.y >= 0 && countdownBox.y + countdownBox.height <= 800);
	assert.ok(await spin.isEnabled());
	await spin.focus();
	await host.keyboard.down("Space");
	await guest.locator('.slot-machine[data-drive="held"]').waitFor();
	assert.equal(await countdown.count(), 0);
	await host.keyboard.up("Space");
	await countdown.waitFor();
	const deadline = Date.now() + 4500;
	let moving = await host.evaluate(readLetters);
	while (moving.hash === idle.hash && Date.now() < deadline) {
		await frame(host);
		moving = await host.evaluate(readLetters);
	}
	assert.notEqual(
		moving.hash,
		idle.hash,
		"Pixi must move the reel before the result is revealed",
	);
	assert.equal((await guest.evaluate(readLetters)).hash, reduced.hash);
	assert.equal(await button(guest, "좋아요 투표").count(), 0);
	await guest.reload();
	await button(guest, "입장하기").click();
	await painted(guest).waitFor();
	const result = host.locator('.slot-machine[data-phase="done"] h3');
	await host.waitForFunction(() =>
		document.querySelector('.slot-machine[data-phase="done"] h3'),
	);
	const settled = await host.locator(".slot-strip").evaluate(async (strip) => {
		await new Promise(requestAnimationFrame);
		const start = performance.now();
		const poses = new Set();
		while (performance.now() - start < 400) {
			await new Promise(requestAnimationFrame);
			poses.add(strip.style.transform);
		}
		return poses.size;
	});
	assert.equal(
		settled,
		1,
		"the stopped reel must stay seated throughout the result reveal",
	);
	const winner = await result.textContent();
	await host.waitForFunction(paintedVote);
	assert.ok(await host.locator(".slot-machine[data-clipped-winner]").count());
	assert.equal(await host.locator(".slot-full-name").innerText(), winner);
	assert.ok(
		await canvas.evaluate(
			(el) => el === document.querySelector(".slot-art[data-painted]"),
		),
	);
	assert.deepEqual(await host.locator(".slot-drum").boundingBox(), drumBox);
	assert.deepEqual(await controls.boundingBox(), controlsBox);
	assert.equal(await controls.getByRole("button").count(), 1);
	assert.ok(await spin.isEnabled());
	assert.ok(
		await spinNode.evaluate(
			(el) => el === document.querySelector(".slot-action"),
		),
	);
	assert.deepEqual(await spin.boundingBox(), spinBox);
	assert.equal(await button(host, "추첨 완료").count(), 0);
	assert.equal(
		await host.locator(".slot-reveal .room-result-actions").count(),
		0,
	);
	assert.equal(
		await host
			.locator(".slot-reveal")
			.evaluate((el) => getComputedStyle(el).opacity),
		"0",
	);
	assert.equal(await host.locator(".picnic-ticket").count(), 0);
	const guestResult = guest.locator('.slot-machine[data-phase="done"] h3');
	await guestResult.waitFor();
	assert.equal(await guestResult.textContent(), winner);
	assert.equal(await button(guest, "대기화면으로 이동").count(), 0);
	assert.equal(await button(guest, "바로 다시 뽑기").count(), 0);
	assert.equal(
		await result.evaluate((el) => document.activeElement === el),
		true,
	);
	await button(guest, "좋아요 투표").click();
	await host.getByRole("heading", { name: "좋아요 1", exact: true }).waitFor();
	assert.equal(await result.textContent(), winner);
	assert.ok(await guest.evaluate(paintedVote));
	assert.equal(
		await button(guest, "좋아요 투표").getAttribute("aria-pressed"),
		"true",
	);
	await host.emulateMedia({ forcedColors: "active" });
	await painted(host).waitFor({ state: "hidden" });
	assert.equal(
		await host
			.locator(".slot-cabinet")
			.evaluate((el) => getComputedStyle(el).opacity),
		"1",
	);
	assert.equal(await result.textContent(), winner);
	assert.equal(
		await host
			.locator(".slot-reveal")
			.evaluate((el) => getComputedStyle(el).opacity),
		"1",
	);
	await host.emulateMedia({ forcedColors: "none" });
	await painted(host).waitFor();
	for (const width of [320, 597, 1280]) {
		await host.setViewportSize({ width, height: 1600 });
		await frame(host);
		assert.equal(await controls.getByRole("button").count(), 1);
		if (process.env.SLOT_CAPTURE_DIR)
			await host.locator(".slot-machine").screenshot({
				path: process.env.SLOT_CAPTURE_DIR + "/result-" + width + ".png",
			});
	}
	await spin.press("Enter");
	await spinning.waitFor();
	await guest.locator('.slot-machine[data-phase="spinning"]').waitFor();
	assert.equal(
		await spin.evaluate((el) => document.activeElement === el),
		true,
	);
	console.log(
		"Passed: same canvas, fixed reel, persistent spin button in the cabinet above voting, 320/597/1280px, keyboard, reduced motion, rejoin, high contrast and next round.",
	);
} finally {
	await browser.close();
}
