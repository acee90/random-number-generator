# 한국 접속 경로와 실시간 지연 조사

진행 상태와 완료 기준은 [GitHub 이슈 #47](https://github.com/acee90/random-number-generator/issues/47)에서 관리한다. 이 문서는 2026-11-15 조사 근거와 재현 절차다. 로컬 구현·검증 결과를 운영 개선 완료로 해석하지 않는다.

## 네트워크에서 확인한 원인 범위

단일 한국 접속망에서 점메추에 할당된 Cloudflare 공유 anycast IPv4 주소는 `LAX`에서 처리됐으며 TCP 연결부터 약 140~216ms가 걸렸다. 같은 환경의 Cloudflare 대조 주소는 `ICN`, TCP 약 6~7ms였다.

| 요청 | 처리 위치 | 관측 |
| --- | --- | --- |
| `jeommechu.dev`의 두 A 주소 | LAX | TCP 142~149ms, trace 전체 812~2345ms |
| 같은 Worker의 `jeommechu.outshinelee.workers.dev` | LAX | trace·홈·DO를 거치지 않는 API 405 모두 동일 |
| `www.cloudflare.com`, `speed.cloudflare.com` | ICN | TCP 약 6~7ms |
| `speed.cloudflare.com`을 점메추 A 주소로 요청 단위 지정 | LAX | TCP 139ms, trace 전체 416ms |

`curl --resolve`는 해당 요청에만 적용했다. 실제 DNS·운영 설정은 바꾸지 않았다. 대조 ICN 주소에 점메추 호스트를 지정하면 403이므로 다른 서비스 IP로 DNS를 고정하는 방식은 사용할 수 없다.

traceroute에서는 통신사 구간 응답 RTT가 약 12ms에서 138~167ms로 증가한 뒤 첫 Cloudflare 주소가 약 143ms로 응답했다. 대조 경로는 Cloudflare까지 약 6~7ms였다. 공개 APNIC RDAP/BGP 자료는 통신사 구간을 KORNET-KR/AS4766(Korea Telecom)으로 식별한다. 개별 홉 RTT나 등록 국가로 라우터의 물리 위치·정확한 국제 구간을 확정하지 않는다.

이 결과는 **이 접속망에서 목적지 공유 IP 대역으로 가는 경로**가 기본 지연의 큰 요인임을 뒷받침한다. 닉네임·채팅 코드나 DO 요청 전에 TCP부터 차이가 나고, 다른 호스트도 같은 IP로 연결하면 같은 현상을 보였다. 어떤 ISP/Cloudflare 광고·피어링·용량 정책이 경로를 선택했는지는 공개 측정만으로 확인되지 않았다.

환경·시스템 프록시 활성 흔적은 없고 trace는 `loc=KR`, `warp=off`였다. IPv6는 이 환경에서 연결되지 않아 비교하지 못했다. 다른 ISP·모바일망은 미측정이다. `colo`/응답 `CF-Ray`는 처리 지점이며 최초 진입 지점이나 방 DO의 위치를 증명하지 않는다.

## 운영 대시보드 확인

로그인된 Cloudflare 대시보드에서 읽기 전용으로 확인했다.

- Worker `jeommechu`의 런타임 배치는 **기본값/off**다. 미국 실행 리전을 지정한 설정은 발견하지 못했다.
- 도메인 DNS의 루트는 **프록싱된 관리형 Worker 레코드**로 `jeommechu`에 직접 연결된다. 해외 원본 IP로 연결하는 A/CNAME 레코드는 없다.
- 도메인 zone은 Free이며 Workers 유료 구독이 활성 상태다. 이 사실만으로 요금제가 LA 경로의 원인이라고 단정하거나 업그레이드 효과를 보장하지 않는다.
- 조회 당시 운영 배포는 main `40753867f0b690f54d1643da4446c444d39ece0e`에 연결된 `ceffebbe` 버전으로 100%였다. DO 바인딩도 기존 `LunchRooms`를 사용한다.
- Smart Shield 화면은 시작 안내 상태였다. 이 화면만으로 별도 Argo/Regional Services 설정 전체를 검증했다고 간주하지 않는다.

CLI의 저장 로그인이 만료돼 재인증을 시도했으나 자동 승인 검토가 Workers·Routes·KV·Scripts 쓰기 권한을 포함한 재인증을 거절했다. 브라우저 조회는 완료했지만 CLI 쓰기 권한을 얻거나 운영 설정·배포를 변경하지 않았다.

## 앱 개선의 범위

닉네임 확인은 기존 `getServerByName`의 초기화 동기화 RPC와 실제 확인 RPC가 순차로 실행됐다. 이를 단일 DO `fetch`로 바꾸고, PartyServer의 `fetch → 초기화 → onRequest` 경로와 기존 인증·중복·만료 검사를 유지한다. 외부 Origin 검사·요청 크기 제한·비밀값 응답 제외도 보존한다.

응답 `Server-Timing`은 다음 중첩 구간을 표시한다. 단순 합산하지 않는다.

| 항목 | 범위 |
| --- | --- |
| `nickname` | DO 내부 요청 해석·순차 큐 대기·닉네임 검사. PartyServer 초기화 이전 시간은 제외 |
| `room` | Worker가 DO에 요청한 뒤 응답 본문을 읽기까지. 초기화·라우팅 포함 |
| `worker` | Worker 진입 뒤 응답 생성 직전까지. 클라이언트↔엣지 왕복은 제외 |

채팅은 본인 화면에 즉시 `전송 중`으로 표시하고 같은 ID의 서버 메시지가 오면 중복 없이 확정한다. 서버의 저장 후 공개 순서는 유지한다. 명시적 거절은 `전송 실패`, 응답 지연·연결 끊김은 `전송 확인 안 됨`으로 구분하며 자동 재전송하지 않는다. 실패 항목은 빈 입력창으로 다시 작성할 수 있고, 미확인 항목은 로컬 표시만 닫을 수 있다. 늦은 서버 승인은 계속 반영한다. 로컬 임시 항목은 새로고침 후 영구 복구되는 기록이 아니다.

동일 시각의 alarm 재기록만 생략한다. 성공한 쓰기만 캐시하고 시작·알람 소비·만료 시 무효화하며 메시지의 durable 저장은 생략하지 않는다.

신규 DO의 `apac-ne` 힌트는 **이번 변경에서 보류**한다. LAX Worker에서 APAC DO를 호출하면 왕복이 추가될 수 있다. 실제 위치와 A/B 성능을 확인하기 전에는 동북아 힌트가 현재 경로를 개선한다고 볼 수 없다. 힌트는 한국 엣지를 고정하거나 기존 DO를 이동시키는 설정도 아니다.

## 재현과 운영 전후 비교

```sh
npm run check:latency -- --origin http://127.0.0.1:3100 --samples 5
npm run check:latency -- --origin https://jeommechu.dev --samples 5
```

진단은 매번 새 시험 방 하나를 만들고 모든 소켓을 닫는다. 기존 방 ID나 인증 정보를 입력받지 않고 추첨도 하지 않는다. HTTP·닉네임·연결·입장 승인·ping·본인 및 상대 채팅 수신 시간을 요약한다. IP·방 ID·이름·메시지·토큰을 출력하지 않는다. 시험 데이터는 기존 24시간 만료 정책을 따른다. 적은 표본의 p95는 일반적인 서비스 보장이나 부하 시험 결과가 아니다.

실제 UI에서는 `?debugRoom=1`로 입장 단계와 `chat_ack` 로그를 확인한다. `chat_ack`는 전송 시점부터 같은 메시지의 서버 확정 snapshot 수신까지이며 본인 화면 즉시 표시 시간과 다르다. 명시적 실패는 성공 ACK 표본에 포함하지 않는다.

운영 반영 뒤 같은 네트워크·브라우저에서 `CF-Ray`/`colo`, HTTP 전체 시간, `Server-Timing`, 채팅 ACK를 함께 비교한다. 로컬의 빠른 왕복을 해외 경로 해결 증거로 사용하지 않는다. Cloudflare/ISP 조사에는 AS4766, 공개 목적지 IP, CF-Ray와 UTC 시각, 영향 받는 망의 trace·traceroute 근거가 필요하다. 고객 IP 등 개인 정보가 포함된 원본은 별도로 검토하고 승인 없이 외부에 보내지 않는다.

공식 근거: [Cloudflare 지리적 라우팅](https://developers.cloudflare.com/support/troubleshooting/general-troubleshooting/geographic-traffic-routing/), [Worker 배치](https://developers.cloudflare.com/workers/configuration/placement/), [DO 데이터 위치](https://developers.cloudflare.com/durable-objects/reference/data-location/).

## 배포 전 로컬 검증 기록 — 2026-11-15

- 전체 자동 테스트 1,141개/39파일, 타입 검사, 변경 파일 Biome, 앱·Storybook 빌드를 통과했다.
- 실제 workerd에서 새 방의 닉네임 확인·권한·양방향 채팅·재접속·투표·기록 보존 등 기존 방 검사 17항목을 통과했다. 모든 점검 소켓을 닫았다.
- 별도 로컬 진단 5표본의 닉네임 HTTP 중앙값은 10.1ms, DO 요청 구간은 2ms였다. 채팅 본인 ACK 중앙값은 5.5ms였다. 로컬 루프백 결과이며 운영의 2~3초 지연 개선 수치가 아니다.
- 실제 Chrome에서 방 생성·자동 입장, 채팅 승인, 빠른 연속 전송 거절의 실패 표시, 빈 입력창으로 다시 작성·재전송 후 승인과 중복 없음을 확인했다.
- 로컬 개발 서버를 종료·재시작한 뒤 저장된 방의 닉네임 검사, 방장 복귀, 승인된 기존 채팅 기록 보존을 확인했다. 브라우저 진단 로그도 단계·시간·가시성만 출력했다.
- 별도 코드 리뷰에서 발견한 미확인 항목 누적에 따른 전송 한도 문제를 수정하고 회귀 검사했다. 미확인 표시를 닫아도 늦은 서버 승인은 계속 수신한다.

이 절은 `codex/room-latency`의 배포 전 기록이다. 당시 운영 업로드·배포·main 병합·배포 후 비교는 미실시였으며, CLI 재인증 쓰기 권한이 자동 승인 검토에서 거절돼 운영 쓰기를 진행하지 않았다. 이후 사용자가 미리보기 검증·main 병합·운영 배포와 재측정을 명시 승인했다. 최신 실제 배포 상태와 측정 결과는 [#47](https://github.com/acee90/random-number-generator/issues/47)에서 확인한다. Cloudflare 지원 문의는 별도로 전송하지 않았다.

## 서울 Worker·동북아 DO 미리보기 비교 — 2026-11-16

관련 이슈 [#47](https://github.com/acee90/random-number-generator/issues/47), 실험 PR [#49](https://github.com/acee90/random-number-generator/pull/49).
**미리보기 구현·비교 완료, 운영 채택 보류. 개선 조건을 충족하지 않아 main 병합·지역 설정 운영 배포는 하지 않았다.**
원격 main은 `f6ea1fc54ddd7bdac1b2be212e1796eefe34ba96`을 유지한다.

### 비교 조건과 검증

- 기본: `codex/asia-placement-baseline`, `dde6c4f4f62df19a6c7fcb9cb5d4a5aab736d472`, `previews.placement.mode=off`, DO 힌트 없음.
- 아시아: `codex/asia-placement-seoul`, `92ad493d11759bb74182282a6156ea157955da80`, `previews.placement.region=aws:ap-northeast-2`, `previews.vars.LUNCH_ROOM_LOCATION_HINT=apac-ne`.
- 두 조건의 앱·진단 코드는 같고 위 지역 설정만 다르다. 두 Preview 모두 tracing 100%, query redaction, 동일한 미리보기 전용 KV를 사용한다. DO namespace는 Preview별 격리이고 운영 secret·사용자 방을 사용하지 않았다. 추첨은 하지 않았다.
- 생성·닉네임·WebSocket 최초 접근에 일관된 힌트를 전달한다. 환경 변수 미설정/다른 값은 기존 배치를 유지한다. 힌트는 새 객체 최초 접근에만 유효하며 기존 방의 이동·상태 복제는 하지 않는다.
- 위치 진단 응답은 `LUNCH_ROOM_DIAGNOSTICS=enabled`일 때만 제한된 값의 `x-room-worker-placement`, `x-room-request-colo`, `x-room-location-hint`를 반환한다. 101 Upgrade는 변형하지 않는다.
- 전체 자동 테스트 1,148개/40파일, 타입 검사, 변경 파일 Biome, 앱 빌드 통과. 독립 리뷰의 추가 P1/P2 발견 없음. 두 Cloudflare Preview 빌드도 성공했다.

2026-11-16 00:03:53~00:12:00 KST(11월15일 15:03:53~15:12:00 UTC), 같은 한국 AS4766 망에서 기본→아시아→아시아→기본→기본→아시아 순서로 각각 새 방 3개를 측정했다.
매 실행 `--samples 10 --idle-ms 20000`, 총 6회 종료 코드 0·실패 이벤트 0이다. 정상 종료의 finally에서 모든 소켓 정리를 수행했으며 별도 `socketsClosed` 관측 이벤트는 없다.
`post-create`와 20초 `after-idle`은 측정 단계명이며 콜드스타트·hibernation을 증명하지 않는다.

### 실제 위치와 관측 한계

전역 **관찰 가능성 → 추적**에서 실제 root/callee span을 확인했다. Preview별 Traces 화면은 비활성 표시였지만 개별 Settings에는 활성·100%였고 전역 화면에는 정상 수집됐다. 해당 비활성 표시를 수집 실패로 간주하지 않았으며 production의 tracing 설정은 변경하지 않았다.

| 조건 | Worker root 속성 | DO callee root 속성 |
| --- | --- | --- |
| 기본 | `cloudflare.colo=LAX`, `faas.invoked_region=WNAM` | `SJC`, `WNAM` |
| 서울 힌트 | `cloudflare.colo=LAX`, `faas.invoked_region=APAC` | `ICN`, `APAC` |

- 기본 닉네임 trace `02e41e749917e73965ba9b625c3d3dac`의 Worker wall 23ms, DO wall 1ms. DO는 `LunchRoomServer` callee root로 구분했다.
- 아시아 trace `9d1009c0e8f5238c362f766c0e96bf9c`의 Worker wall 44ms, DO wall 36ms. 별도 신규 방 trace `f2b55f6771d83be8da87cd955adef698`도 DO `ICN/APAC`를 확인했다.
- **DO의 서울 실행은 확인했다. Worker는 APAC 신호가 있으나 LAX colo와 상충해 정확한 도시는 미확정이다.** 공식 tracing 속성 정의는 이 불일치의 우선순위를 설명하지 않는다. Worker→DO 약8ms는 아시아 실행과 부합하지만, Worker=ICN 또는 특정 Cloudflare telemetry 버그로 확정하지 않는다.
- 두 조건 HTTP 각69응답과 WS 각6 handshake의 CF-Ray는 모두 LAX였다. `cf-placement`는 양쪽 모두 관찰되지 않아 정확한 Worker 위치 검증 수단으로 사용하지 못했다.
- 추가 읽기 전용 transport 비교에서 DNS를 제외한 TCP 연결 시간은 기본 Preview 약138~179ms, 아시아 Preview 약141~145ms, 운영 약138~144ms, 대조 `speed.cloudflare.com` 약6~7ms였다. 한국 접속의 긴 연결 경로는 지역 힌트로 해소되지 않았다. 이 수치만으로 최초 물리 ingress 위치나 피어링 정책을 확정하지 않는다.

### 지연 비교와 운영 판단

각 값은 **중앙값 / p95**, 단위 ms. p95는 회차별 p95의 평균이 아니라 원본 표본 전체에서 다시 계산했다.

| 지표 | 조건별 n | 기본 | 서울·동북아 |
| --- | --- | --- | --- |
| DO 없는 기본 HTTP | 30 | 391.7 / 1642.6 | 547.4 / 2277.4 |
| 닉네임 HTTP | 30 | 406.3 / 1798.3 | 568.8 / 1469.4 |
| 20초 유휴 후 닉네임 | 3 | 1038.7 / 2857.0 | 3189.9 / 4501.6 |
| WebSocket open | 6 | 1147.0 / 3672.4 | 1329.4 / 3658.3 |
| open 이후 join ACK | 6 | 354.2 / 962.3 | 490.7 / 506.4 |
| ping | 30 | 348.5 / 1575.6 | 462.8 / 1193.3 |
| 본인 채팅 서버 ACK | 30 | 353.9 / 1392.6 | 504.8 / 3316.4 |
| 상대 채팅 수신 | 30 | 350.5 / 2373.3 | 523.1 / 2109.3 |

닉네임 내부 `room` 중앙값은 22→8ms로 줄었지만 전체 HTTP와 채팅 중앙값은 악화했다. 유휴 후 아시아 닉네임 3.14~4.50초 표본에서도 `room`은 42~45ms였다. 기본 배치에도 닉네임 최대6.49초·ping 최대8.36초 변동이 있으므로 모든 outlier를 새 지역 설정의 효과로 돌리지 않는다.
한국 한 망·조건별 방3개의 소량 비교이며 다른 통신사나 전체 사용자 SLA로 일반화하지 않는다. 닉네임 HTTP에는 입력 debounce350ms가 없고 채팅 ACK는 본인 화면의 즉시 표시와 별도다.

**주요 중앙값과 본인 ACK p95가 악화해 운영 배포 조건을 충족하지 않았다.** PR은 실험 결과를 담은 draft로 유지하며 운영 재측정을 배포 후 결과라고 기록하지 않는다.
긴 사용자 접속 경로와 Worker 위치 계측 불일치는 미해결이며, 새 DO의 한국 처리와 사용자 체감 지연 개선은 구분한다. Cloudflare/ISP 문의는 전송하지 않았다.

공식 근거: [Placement](https://developers.cloudflare.com/workers/configuration/placement/), [Preview 설정](https://developers.cloudflare.com/workers/previews/configuration/), [Preview 관측](https://developers.cloudflare.com/workers/previews/test-and-debug/), [DO 위치](https://developers.cloudflare.com/durable-objects/reference/data-location/), [Trace 속성](https://developers.cloudflare.com/workers/observability/traces/spans-and-attributes/).

## DO 힌트만 적용하는 출시 범위 — 2026-11-16

위 비교는 서울 Worker와 동북아 DO를 함께 적용한 당시 실험 기록이다. 이후 사용자가 DO 지역 힌트의 main 반영·운영 배포를 명시 요청했다. 이번 출시 범위는 `vars.LUNCH_ROOM_LOCATION_HINT=apac-ne`와 일관된 최초 접근 힌트이며, Worker의 서울 리전 설정은 포함하지 않는다. 같은 브랜치의 Preview도 Worker 기본 배치 + 동북아 신규 DO로 바꿔 회귀를 확인한다.

기존 namespace와 `lunch-rooms-v1` migration은 유지하며 새 namespace를 만들거나 기존 방 데이터를 옮기지 않는다. 힌트는 신규 DO에만 적용된다. 앞선 조합의 지연 수치를 이번 DO-only 조건의 개선 증거로 사용하지 않는다. 실제 main 병합·운영 배포·새 방 검증 결과는 [#47](https://github.com/acee90/random-number-generator/issues/47)에서 구분해 관리한다.

## 메시지별 지연 구간 계측 — 2026-11-16

관련 이슈: [#47](https://github.com/acee90/random-number-generator/issues/47). 구현·검증·운영 배포 상태는 이슈에서 관리한다.

방 주소에 `?debugRoom=1`을 붙이고 입장한 뒤 채팅을 보내면 브라우저 콘솔에 `[room chat trace]` JSON이 출력된다. 각 전송마다 별도 UUID `diagnosticId`가 생성된다. Cloudflare Logs/Traces에서 같은 ID의 `[room chat trace]` 서버 로그를 검색해 해당 DO 호출을 찾는다. 메시지 ID·본문·닉네임·방 ID·인증 토큰은 진단 로그에 넣지 않는다. 일반 접속은 진단 ID·타이머·서버 진단 로그를 만들지 않는다.

| 필드 | 의미 |
| --- | --- |
| `clientSentAt`, `clientReceivedAt`, `clientAckAt` | 브라우저 전송 직전, message 핸들러 진입, 서버 확정 snapshot을 ACK로 처리한 절대시각(ms) |
| `rttMs` | 전송 직전부터 message 핸들러 진입까지의 단조시계 경과시간 |
| `parseMs`, `ackHandlingMs` | 수신 JSON·프로토콜 검증 시간, 이후 해당 메시지 ACK 확인까지의 처리 시간. React 화면 커밋 시간은 아님 |
| `server.serverReceivedAt`, `server.serverSendAt` | DO onMessage 진입, 발신자 snapshot 직렬화·소켓 enqueue 직전의 절대시각(ms) |
| `server.queueMs` | onMessage 이후 앱의 exclusive 큐 진입까지 |
| `server.prepareMs` | 프로토콜 파싱 및 큐 진입 후 load·만료·권한·중복/속도 검사와 메시지 준비까지(큐 대기 제외) |
| `server.saveMs`, `server.alarmMs` | durable 저장, 알람 갱신 대기 시간 |
| `server.serverTotalMs` | onMessage 진입부터 발신자 snapshot 직렬화 직전까지. 큐/사전처리/저장/알람 외 snapshot 준비 등도 포함 |
| `outsideServerMs` | `rttMs - serverTotalMs`의 0 이상 값. 네트워크뿐 아니라 DO 핸들러 이전 대기·직렬화·Cloudflare 전달·브라우저 스케줄링을 포함 |
| `maxEventLoopLagMs` | 해당 전송이 대기 중일 때 100ms 타이머의 최대 관측 지연. CPU 작업·브라우저 스케줄링·백그라운드 제한의 영향을 받으며 네트워크 시간은 아님 |
| `hiddenDuring` | 전송에서 ACK 사이 한 번이라도 문서가 숨겨졌는지 |
| `eventDispatchAgeMs` | MessageEvent 생성 시각과 핸들러 진입의 차이. 유효 범위일 때만 기록하며 네트워크 패킷 도착 시각은 아님 |

서버 로그는 `boundary=broadcast-enqueued`로 전체 broadcast enqueue 이후를 기록한다. 따라서 snapshot에 실린 직렬화 직전 시간과 로그의 broadcast 완료 시간은 경계가 다르며, 어느 쪽도 실제 네트워크 flush 완료를 보장하지 않는다. 서버 진단은 발신자 snapshot의 부가 필드이고 메시지 durable 저장/인증/속도 제한을 바꾸지 않는다. 다른 참가자에게 전파하거나 저장하지 않고 후속 snapshot에도 재사용하지 않는다.

`clockSynchronized=false`를 항상 기록한다. 클라이언트와 서버 시계 오차/경로 비대칭을 보정하지 않았으므로 절대시각을 빼서 상행/하행 지연을 확정하지 않는다. 기존 ping의 중간시각 추정도 일방향 시간을 보장하지 않는다. `server=null`이면 이전 서버/후속 snapshot 등으로 직접 계측이 연결되지 않은 상태다. 성공 ACK만 구간 로그를 내며 실패·연결 종료·15초 미확인·닫기·컴포넌트 해제 때 진단 타이머와 visibility listener를 정리한다. 늦은 ACK와 기존 채팅 상태 처리는 유지한다.

판독 예: RTT가 2600ms이고 서버 처리 10ms면 약2590ms는 서버 핸들러 밖의 구간이다. 동시에 이벤트 루프 지연이 2000ms면 브라우저 정지가 기여했을 수 있다. 이벤트 루프 지연이 작더라도 패킷 손실/TCP 재전송으로 확정하지 않으며 전송 계층 증거가 추가로 필요하다. 현재 계측은 본인 ACK를 대상으로 하고 다른 참가자의 수신 지연은 별도다.
