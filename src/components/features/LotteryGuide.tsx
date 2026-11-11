export default function LotteryGuide({ kind }: { kind: "lotto" | "pension" }) {
	return (
		<section
			className="use-cases lottery-guide"
			aria-label="번호 선택 방식 안내"
		>
			<div className="use-cases-heading">
				<h2>선택 방식에 따른 차이</h2>
				<p>
					{kind === "pension"
						? "같은 발행 채널의 서로 다른 복권 5게임(5,000원)을 비교합니다."
						: "구매한 조합 수와 중복 여부에 따라 달라지는 점을 확인하세요."}
				</p>
			</div>
			{kind === "pension" ? (
				<>
					<div className="example-grid">
						<article className="strategy-card">
							<span className="strategy-label">모든 조 · 같은 여섯 자리</span>
							<h3>1등 1장 + 2등 4장</h3>
							<p>
								1~5조를 모두 구매한 번호가 본 추첨의 여섯 자리와 일치하면 함께
								당첨됩니다. 첫 10년은 월 1,100만원, 다음 10년은 월 700만원으로,
								세전 명목 합계는 <strong>21억 6천만원</strong>입니다.
							</p>
							<div className="strategy-stat">
								1등 포함 확률 <strong>1/1,000,000</strong>
							</div>
						</article>
						<article className="strategy-card">
							<span className="strategy-label">한 조 · 서로 다른 번호 5개</span>
							<h3>여러 번호로 기회 분산</h3>
							<p>
								같은 조에서 여섯 자리 번호를 다르게 선택하면, 1·2등 중 하나
								이상에 당첨될 확률은 <strong>1/200,000</strong>입니다. 다만
								1등을 포함할 확률은 모든 조에 같은 번호를 선택할 때와 같습니다.
							</p>
							<div className="strategy-stat">
								1등 포함 확률 <strong>1/1,000,000</strong>
							</div>
						</article>
						<article className="strategy-card">
							<span className="strategy-label">기댓값 비교 · 5게임 기준</span>
							<h3>기대당첨금은 동일</h3>
							<p>
								두 방식 모두 기대당첨금은 약 <strong>3,750원</strong>입니다.
								구매비 5,000원을 빼면 기대손익은 약 <strong>−1,250원</strong>
								입니다. 번호를 묶는 방식은 당첨 시 금액의 분포를 바꾸며,
								기대수익을 높이지 않습니다.
							</p>
							<div className="strategy-stat">
								세전 명목 합산 · 세금과 시간가치 미반영
							</div>
						</article>
					</div>
					<p className="guide-source">
						기대당첨금은 공식 당첨 구조로 계산한 장기 평균입니다. 실제 수령액과
						다르며, 공식 환급률은 준비금 할인율에 따라 달라질 수 있습니다.{" "}
						<a
							href="https://www.dhlottery.co.kr/pt720/intro"
							target="_blank"
							rel="noreferrer"
						>
							동행복권 공식 안내
						</a>{" "}
						·{" "}
						<a
							href="https://www.dhlottery.co.kr/pt720/result"
							target="_blank"
							rel="noreferrer"
						>
							등위별 당첨 조건
						</a>
					</p>
				</>
			) : (
				<>
					<div className="example-grid">
						<article className="strategy-card">
							<span className="strategy-label">번호 분산</span>
							<h3>5게임에 서로 다른 번호 30개</h3>
							<p>
								번호를 넓게 사용하려면 분산 방식을 선택하세요. 고정 번호 없이
								남은 번호가 30개 이상이면 5게임을 뽑아도 게임 안과 게임 사이에
								겹치는 번호가 없습니다. 한 번호에 여러 게임의 결과가 함께 묶이는
								것을 줄이는 방식입니다.
							</p>
						</article>
						<article className="strategy-card">
							<span className="strategy-label">번호 고정 + 나머지 분산</span>
							<h3>원하는 번호는 모든 게임에</h3>
							<p>
								1~5개의 번호를 고정할 수 있습니다. 두 번호를 고정하고 5게임을
								분산 추첨하면, 고정 번호 2개는 공통이고 나머지 20개는 서로
								다릅니다. 제외 번호는 모든 추첨 방식에 적용되며, 고정 번호와
								같은 번호를 선택할 수 없습니다.
							</p>
						</article>
						<article className="strategy-card">
							<span className="strategy-label">추첨 방식과 1등 확률</span>
							<h3>같은 게임 수의 1등 확률은 동일</h3>
							<p>
								서로 다른 5게임의 1등 당첨 확률은 어떤 방식을 선택해도
								5/8,145,060입니다. 분산과 고정은 번호 배분과 게임 간 겹침을
								바꾸는 기능이며, 당첨 확률을 높이는 예측 방법은 아닙니다.
							</p>
						</article>
					</div>
					<p className="guide-source">
						5게임의 확률은 한 회차에 서로 다른 조합을 구매한다는 조건으로
						계산했습니다.{" "}
						<a
							href="https://www.dhlottery.co.kr/lt645/intro"
							target="_blank"
							rel="noreferrer"
						>
							동행복권 로또 6/45 안내
						</a>
					</p>
				</>
			)}
		</section>
	);
}
