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
