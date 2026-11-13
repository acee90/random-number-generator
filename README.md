# 점메추 · Jeommechu

**[jeommechu.dev](https://jeommechu.dev)** — 방을 만들고 링크로 초대해, 같은 룰렛을 보며 채팅으로 점심 메뉴를 정하는 서비스입니다.

TanStack Start · React · Cloudflare Workers · Durable Objects · PartyServer/PartySocket으로 구현했습니다.

## 이용 방법

1. 방 이름과 닉네임을 정해 추첨방을 만듭니다.
2. 초대 링크를 공유합니다. 참가자는 닉네임 확인 후 직접 입장합니다.
3. 방장이 음식 분류와 개별 음식점을 선택하고 **후보 적용**을 누릅니다.
4. 방장이 룰렛을 시작하면 참가자가 같은 회차와 결과를 함께 봅니다.
5. 참가자는 현재 결과에 **좋아요 / 아쉬워요**를 남기고, 방장은 투표와 채팅을 보고 재추첨 여부를 정합니다.

혼자 사용할 때는 [단독 룰렛](https://jeommechu.dev/solo)을 이용할 수 있습니다.

## 주요 기능

### 함께 보는 추첨방

- 방 생성·링크 초대·실시간 룰렛과 채팅, 방장 전용 후보 변경·추첨 시작
- 닉네임 1~12자, 입력 중 중복 확인·확인 중 표시, 입장 후 이름 변경
- 내 메시지는 오른쪽, 다른 참가자는 왼쪽에 표시하고 입장·퇴장·이름 변경·추첨 알림 제공
- 참가자 온라인·5분 이상 자리비움·오프라인 상태와 재접속 지원
- 음식 분류 다중 선택·제외와 개별 후보 선택, 스크롤 중에도 사용할 수 있는 적용 도구
- 회차별 후보·확률·참가자·시각·난수 출처 기록과 복사
- 작은 화면, 키보드 조작과 동작 줄이기 설정 지원

방은 **생성 후 24시간** 유지됩니다. 방장이나 전원이 나가도 즉시 삭제되지 않으며 재입장해도 만료 시각은 연장되지 않습니다. 최대 30명, 최근 채팅·시스템 메시지 100개, 확정 결과 20개와 현재 회차를 보관하고 만료되면 방 데이터를 삭제합니다.

### 현재 결과의 up/down 투표

- 참가자는 **현재 완료된 결과에 회차별 한 번** 투표하며, 제출 후 취소·변경할 수 없습니다.
- 별도의 투표 시간제한은 없습니다. 방장은 투표하지 않고 실시간 집계를 확인합니다.
- 투표 당시 이름·결과 공개 후 반응 시간과 전체 선착순 세 명의 메달을 표시합니다. 반응 시간에는 네트워크 지연이 포함됩니다.
- 방장이 **다음 추첨을 시작하면 이전 결과와 투표를 확정 기록으로 고정**합니다. 과거 기록에는 투표할 수 없고 내용도 바뀌지 않습니다. 다음 추첨 준비가 실패해도 이전 기록을 다시 열지 않습니다.
- 같은 참가자의 재입장·닉네임 변경·다중 연결·서버 재시작 후에도 첫 표를 유지합니다. 결과당 최대 60표를 보관합니다.
- 투표가 다음 추첨의 확률을 바꾸거나 자동 재추첨을 실행하지는 않습니다.

참가자 구분은 같은 브라우저에서 공유하는 방별 비공개 증명을 사용합니다. 다른 브라우저나 저장소 삭제까지 같은 사람으로 판별하는 계정 기반 인증은 제공하지 않습니다. 방장 권한도 저장된 별도 증명으로 복원하며 자동 승계하지 않습니다.

### 단독 룰렛과 음식점 목록

기본 후보는 제공받은 회사 주변 음식점 엑셀의 **107곳·11개 분류**입니다. 음식 분류와 개별 후보를 골라 이름이 표시된 룰렛으로 추첨하고, 최근 20개의 개인 기록을 브라우저에 보관합니다.

거리 값은 엑셀에 기재된 회사 기준 거리이며 현재 기기 위치에서 측정하지 않습니다. 실시간 주변 검색·커스텀 목록·엑셀 업로드/내보내기는 후속 개발 항목입니다.

## 경로

| 경로 | 기능 |
| --- | --- |
| `/` | 점메추 메인·방 만들기 |
| `/lunch-room/<UUID>` | 닉네임 입장·공동 룰렛·채팅·투표·결과 기록 |
| `/solo` | 혼자 사용하는 점심 룰렛 |
| `/lunch` | 메인(`/`)으로 이동 |
| `/tools?tool=number` | 랜덤 정수 생성 |
| `/tools?tool=lotto` | 로또 6/45 번호 생성 |
| `/tools?tool=pension` | 연금복권 720+ 번호 생성 |

상단 메뉴에는 점메추만 표시합니다. 기존 번호 도구는 직접 주소로 사용할 수 있으며 검색 색인에서 제외합니다. 추첨방도 검색 색인에서 제외하고, 메인·단독 룰렛에는 `jeommechu.dev` 기준 canonical·Open Graph·공유 이미지를 제공합니다.

번호 도구에는 범위·중복·정렬 설정, 로또 고정/제외 번호와 게임 간 분산, 연금복권 조 선택, 개별/전체 복사와 브라우저 기록이 남아 있습니다. 복권 번호를 선택하는 도구이며 당첨 예측이나 구매 기능은 없습니다.

## 난수 출처

추첨 요청마다 새로운 난수를 가져오며 다음 순서로 사용 가능한 출처를 선택합니다.

1. **ANU Quantum Numbers** — API 키가 있을 때 양자 난수 요청
2. **Random.org** — 대기 잡음 기반 난수 요청
3. **서버 Web Crypto CSPRNG** — 외부 출처를 사용할 수 없을 때 암호학적 난수 생성

결과에는 실제 사용한 출처를 표시하고, 여러 출처를 사용한 요청은 혼합으로 표시합니다. 범위 변환에는 rejection sampling을 사용해 편향을 제거합니다. 외부 출처를 사용할 수 없으면 CSPRNG로 대체합니다. 기존 KV 시드 풀은 진단용이며 실제 추첨에서는 소비하지 않습니다.

## 로컬 실행

Node.js 22 계열(22.12 이상)과 npm을 사용합니다. 저장소 루트에서 실행합니다.

```powershell
npm ci
Copy-Item .env.example .env.local
# .env.local에 사용할 API 키를 입력한 뒤 실행합니다.
npm run cf-typegen
npm run dev
```

처음 설정할 때 `.env.example`을 복사하고 필요한 API 키를 입력합니다. 개발 주소는 **[localhost:3000](http://localhost:3000)**입니다.

| 환경 변수 | 용도 |
| --- | --- |
| `ANU_API_KEY` | [ANU Quantum Numbers](https://quantumnumbers.anu.edu.au/) 키. 비어 있으면 ANU를 건너뜁니다. |
| `RANDOM_ORG_API_KEY` | [Random.org](https://api.random.org/api-keys) 키. 있으면 JSON-RPC API, 없으면 공개 HTTP API를 사용합니다. |
| `RANDOM_ORG_HASHED_API_KEY` | 기존 설정 호환용. 현재 난수 요청 인증에는 사용하지 않습니다. |

키는 서버에서만 읽습니다. `.env.local`과 `.dev.vars`는 Git에서 제외됩니다. **`.dev.vars` 파일이 있으면 `.env.local`을 읽지 않으므로** 한 방식만 사용합니다. 키를 바꾸면 개발 서버를 다시 시작합니다. 키 없이도 이후 출처로 대체하며 로컬 개발에 Cloudflare 인증 토큰은 필요하지 않습니다.

로컬 KV와 Durable Object 저장소는 `.wrangler/` 아래에 생성됩니다. 로컬 방과 운영 방은 서로 별개입니다. 같은 브라우저의 여러 탭은 참가 정보를 공유하므로 방장·참가자를 따로 확인하려면 다른 브라우저나 별도 브라우저 프로필을 사용합니다.

## 검사와 빌드

```powershell
npm test
npx tsc --noEmit
npm run build
npm run serve
```

`npm run serve`는 빌드한 결과를 미리 봅니다. `npm run preview`는 빌드와 미리보기를 이어서 실행합니다. 바인딩을 변경하면 `npm run cf-typegen`으로 타입을 다시 생성합니다.

테스트는 난수 범위·추첨 조건, 방 입장·권한·접속 상태, 다중 연결·투표 중복 방지·기록 불변성과 UI 동작을 검증합니다. 운영 확인 범위와 남은 확인 항목은 [출시 체크리스트 #8](https://github.com/acee90/random-number-generator/issues/8)에서 관리합니다.

### 운영 검증 재현

```powershell
npm run check:release:web -- https://jeommechu.dev
npm run check:release:room -- --origin https://jeommechu.dev
```

웹 검사는 공개 경로의 검색·공유 메타데이터와 정적 파일을 확인합니다. 방 검사는 새 검증용 방을 만들어 최대 두 번 추첨하며, 권한·양방향 채팅·늦은 입장·재접속·투표·기록 보존을 확인한 뒤 연결을 모두 종료합니다. 키·인증 증명은 출력하지 않습니다. 생성한 방은 기존 24시간 정책에 따라 만료됩니다.

입장 시간을 구간별로 볼 때는 새 페이지를 `?debugRoom=1`로 열고 브라우저 콘솔의 `[room timing]`을 확인합니다. HTTP·응답 해석·화면 이동·닉네임 검사·소켓 연결·입장 승인·첫 화면 커밋 시간을 기록하며, 이름·주소·키는 기록하지 않습니다. 첫 화면 커밋은 React 갱신 완료 시점이며 실제 화면 표시나 일반적인 속도를 보장하는 수치가 아닙니다. 일반 페이지에서는 계측하지 않습니다.

버전·키 바인딩 확인과 복구 기준은 [운영 확인·복구 문서](docs/release-runbook.md)를 참고하세요.

## 배포

기존 GitHub 연결 Cloudflare Workers Builds를 사용합니다. 작업 브랜치의 미리보기 검사 후 `main`에 머지하면 운영 빌드·배포가 실행됩니다.

직접 배포할 때는 Cloudflare 계정에 인증하고, `wrangler.jsonc`의 KV 네임스페이스와 `LunchRooms` Durable Object 바인딩을 해당 계정에 맞게 준비합니다. 운영 API 키는 로컬 파일과 별도로 Worker secrets에 설정합니다.

```powershell
npx wrangler login
npx wrangler secret put ANU_API_KEY
# Random.org 키도 사용할 경우
npx wrangler secret put RANDOM_ORG_API_KEY
npm run deploy
```

최초 Durable Object 생성이나 새 migration은 `wrangler deploy`로 적용해야 합니다. `wrangler versions upload`에서 미적용 migration 오류가 나면 먼저 정식 배포한 뒤 미리보기를 다시 실행합니다. 상세 구성과 배포 절차는 [추첨방 운영 문서](docs/lunch-rooms.md#cloudflare-구성)를 참고하세요.

### 분석 태그

공통 문서에 Google Tag Manager `GTM-PH7KTBC8`을 설치했습니다. 운영 빌드와 로컬 운영 미리보기에서 로드하며 개발 서버에서는 로드하지 않습니다. GA4 수집은 별도로 GTM 컨테이너에 Google 태그와 측정 ID를 설정·게시하고 확인해야 합니다.

## 코드 구조

| 위치 | 역할 |
| --- | --- |
| `src/routes/` | 메인·추첨방·단독 룰렛·번호 도구 경로와 메타데이터 |
| `src/components/features/` | 룰렛·채팅·투표·기록 화면 |
| `src/hooks/useLunchRoom.ts` | 방 연결·입장·재연결·클라이언트 요청 |
| `src/rooms/LunchRoomServer.ts` | 방 상태·권한·추첨·투표·보관·만료 처리 |
| `src/server/lunchRoomHttp.ts` | 방 생성·닉네임 확인·WebSocket 진입점 |
| `src/services/` | 외부 난수 요청·범위 변환·출처 처리 |
| `wrangler.jsonc` | Worker·KV·SQLite Durable Object 설정 |
| `tests/` | Vitest 자동 검사 |

## 개발 계획과 상세 문서

개발 계획과 진행 상태의 기준은 **[GitHub 로드맵 #7](https://github.com/acee90/random-number-generator/issues/7)**과 연결된 이슈입니다. 공개/비공개방, 커스텀 목록·엑셀 편집, 실제 음식점 검색, 투표 가중치와 추가 추첨 연출은 여기서 관리합니다. 현재 결과에 반응하는 up/down 투표와 다음 추첨 확률을 바꾸는 투표 가중치는 별도 기능입니다.

- [추첨방 동작·보관·로컬 검증·배포](docs/lunch-rooms.md)
- [점메추 정보 구조와 방 수명 설계](docs/jeommechu-ia-plan.md)
- [프로토타입부터 완성품까지의 단계별 기록](docs/lunch-plan.md)
- [현재 결과 피드백 투표 #20](https://github.com/acee90/random-number-generator/issues/20)
- [운영 출시 확인 #8](https://github.com/acee90/random-number-generator/issues/8)
