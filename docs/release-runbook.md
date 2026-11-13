# 점메추 운영 확인과 복구

출시 상태와 남은 작업은 [운영 반영 이슈 #8](https://github.com/acee90/random-number-generator/issues/8)에서 관리한다. 이 문서는 운영자가 같은 검증을 재현하기 위한 보조 자료다. 방 동작은 [실시간 방 설명](lunch-rooms.md)을 참고한다.

## 확인한 기준선

**2026-11-13 09:44 UTC(18:44 KST), API 키 설정 후 조회 결과.** 이후 배포·키 변경이 있으면 아래 읽기 전용 명령으로 최신 상태를 다시 확인한다.

| 항목 | 확인 결과 | 검증 범위 |
| --- | --- | --- |
| 운영 대상 | `https://jeommechu.dev`, Worker `jeommechu`, 계정 `434357ee2e3363aea69437f67e2053ef` | 실제 계정·배포 메타데이터 |
| 활성 배포 | `ae9ff126-8b30-4089-a556-4afa585cade0`, 2026-11-13 09:42:33 UTC | 실제 운영, 아래 버전 100% |
| 활성 버전 | `46d5a26a-875c-4b77-85f3-bedba18befcf` | 실제 운영 메타데이터; API 키 설정판 |
| 복구 대상 확정 | 아래 보안·TTL 수정 이후 검증한 배포에서 새로 지정 | 이 기준선의 `46d5...`는 수정 이전 버전이므로 정상 복구 대상으로 추천하지 않음 |
| 키 등록 전 코드 버전 | `9c7eea02-11f9-4958-aa0c-a2384a1ebf81`, 이전 `d483ad21-dd3e-497f-8e01-d8a42002a07e` | API 키 바인딩이 없어 현 운영의 복구 후보에서 제외 |
| 방 바인딩 | `LunchRooms` → `LunchRoomServer`, namespace `89c1044d01294bf6b444f39990e98188` | 활성·직전 버전에서 같은 namespace 확인 |
| DO 마이그레이션 | 활성판과 조회한 이전 코드 버전 모두 `migration_tag: lunch-rooms-v1` | 실제 버전 메타데이터 |
| SQLite 지정 | `wrangler.jsonc`의 `new_sqlite_classes: ["LunchRoomServer"]` | 로컬 선언과 원격 적용 태그 대조; namespace 저장소 종류의 별도 원격 조회는 미실시 |
| 난수 API 키 | `ANU_API_KEY`, `RANDOM_ORG_API_KEY` **2개**가 secret 목록과 활성판의 `secret_text` 바인딩에 존재 | 09:39 UTC의 빈 목록 발견 후 09:44 UTC 시정 확인. 키 값은 조회하지 않음 |
| TTL·복구·시계 보정 | 전체 **1,011개 자동 검사 통과**, 삭제 실패·재시작 회귀 포함 | 서버 시각·저장 실패를 제어한 검사와 일반 회귀 검사, 운영에서 24시간 대기하거나 실패를 주입한 결과 아님 |
| 운영에서 실제 24시간 경과 후 삭제 | **미검증** | 별도 실제 경과 확인 필요 |
| 키 설정 후 운영 smoke | 담당자의 실제 운영 검사 **14/14 통과**, snapshot 52개 비밀값 비노출 검사, 추첨 두 번 모두 `quantum` | 검사 연결 모두 종료. 실제 ANU 사용과 단순 키 이름 존재를 각각 확인 |
| Chrome·Edge UI | 실제 운영에서 닉네임 중복 거절·키보드 입장·양방향 채팅·동일 양자 결과·투표·복사·재입장 확인 | Edge 320px에서 가로 넘침 없음, 모바일 채팅 전환과 Shift+Enter 줄바꿈·전송 확인. 실제 iOS/Safari 검증은 아님 |

이후 릴리스에는 런타임 `seroval` 1.8.1 갱신과 TTL 정리 재시도 수정을 포함한다. 기준선 버전을 이 수정까지 반영된 버전으로 오인하지 않는다. 최종 배포 ID와 검증 결과는 #8에서 갱신한다.

현재 난수 요청에서 사용하는 키 이름은 `ANU_API_KEY`, `RANDOM_ORG_API_KEY`다. **이름의 존재와 실제 사용 출처를 구분**한다. 키가 없을 때도 서버의 다음 출처·Web Crypto 경로는 존재하지만, 그 자체가 ANU 인증 성공을 뜻하지 않는다. 로컬 설정의 `RANDOM_ORG_HASHED_API_KEY`를 운영 추첨에 필요한 별도 키로 간주하지 않는다.

## 웹·방 검증과 입장 구간 계측

```powershell
npm run check:release:web -- https://jeommechu.dev
npm run check:release:room -- --origin https://jeommechu.dev
```

웹 검사는 공개 경로 6개, 색인/공유 메타데이터, robots·sitemap·공유 이미지·manifest·확인 파일과 이전 경로 리다이렉트를 확인한다. 방 검사는 기존 방 주소나 인증 정보를 입력받지 않고 매번 새 검증용 방을 만들어 최대 두 번 추첨한다. 닉네임 조회의 무부작용·권한·양방향 채팅·공동 결과·늦은 입장·재접속·첫 투표 유지·기록 동결 및 공개 상태에 인증 값이 없는지를 확인하고 모든 연결을 종료한다. 방 데이터는 원래 24시간 정책으로 만료된다.

방 검사는 HTTP·WebSocket·입장 승인 시간의 표본 수와 중앙값·p95·최솟값·최댓값을 출력한다. 적은 수의 단일 방 관측이며 부하 시험이나 일반적인 응답 시간 보장이 아니다. 키 등록 전 두 추첨의 출처는 `csprng`, 등록 후 별도 방의 두 추첨은 `quantum`이었다.

UI 입장 진단은 새 페이지를 `https://jeommechu.dev/?debugRoom=1` 또는 검증용 방 주소의 `?debugRoom=1`로 열고 콘솔의 `[room timing]`을 읽는다. 초기 로드 시에만 켜지고 같은 SPA 화면 이동 동안 유지된다. 일반 페이지는 계측하지 않는다. 출력은 단계명·소요 시간·화면 표시 상태뿐이며 이름·방 ID·URL·요청 내용·키를 담지 않는다.

| 단계 | 측정 구간 |
| --- | --- |
| `create_http` | 방 생성 요청부터 HTTP 헤더 수신까지 |
| `create_decode` | 생성 응답 본문 해석 |
| `room_navigation` | 방 화면 이동 요청부터 라우터 완료까지. 코드/CSS 로딩이 포함될 수 있음 |
| `nickname_check` | 입력 대기 350ms 이후 실제 확인 요청·응답 해석. 입력 대기 자체는 제외 |
| `socket_open` | 연결 시도부터 WebSocket 열림까지 |
| `join_ack` | 입장 요청부터 본인 승인 snapshot 수신까지 |
| `room_commit` | 첫 승인 수신 이후 React의 연결 화면 커밋까지. 실제 페인트는 아님 |

구간이 겹칠 수 있으므로 단순 합산하지 않는다. HTTP와 소켓 시간은 네트워크·서버 대기를 포함하며 서버 CPU 시간과 같지 않다. 생성 화면의 기존 '방 만드는 중' 표시는 HTTP 외에도 응답 해석과 화면 이동을 포함하므로 표시만 보고 닉네임 API가 느리다고 판단하지 않는다. 이번 검증에서 수십 초 대기가 다시 발생하지 않았다면 원인 해결로 확정하지 않고, 이후 발생 시 이 단계들을 비교한다.

## 변경 없는 운영 메타데이터 확인

저장소 루트의 PowerShell에서 실행한다. 인증 정보·키 값·방 저장소는 읽거나 출력하지 않는다.

```powershell
$env:WRANGLER_LOG_PATH = '.wrangler/logs'
$env:CLOUDFLARE_ACCOUNT_ID = '434357ee2e3363aea69437f67e2053ef'
$deploys = npx wrangler deployments list --name jeommechu --json | ConvertFrom-Json
$deploys | Select-Object id, created_on, versions | ConvertTo-Json -Depth 4

$active = $deploys | Sort-Object created_on | Select-Object -Last 1
$activeVersion = $active.versions | Sort-Object percentage -Descending | Select-Object -First 1
$version = npx wrangler versions view $activeVersion.version_id --name jeommechu --json | ConvertFrom-Json
$version.resources.script_runtime | Select-Object migration_tag, compatibility_date
$version.resources.bindings | Select-Object name, type, class_name, namespace_id

$names = npx wrangler secret list --name jeommechu | ConvertFrom-Json
$names | Select-Object name, type
```

각 명령의 종료 코드가 0인지 확인한다. 여러 버전으로 트래픽이 분산되어 있다면 최대 비율의 한 건만 보지 말고 `$active.versions` 전체를 확인한다. 원본 버전 JSON에는 일반 변수 값이 포함될 수 있으므로 전체 응답을 로그·GitHub·이 문서에 붙이지 않는다.

## 배포와 최초 마이그레이션

로컬에서 `npm test`, `npx tsc --noEmit`, `npm run build`를 통과시킨다. 생성된 `dist/server/wrangler.json`의 Worker 이름이 `jeommechu`이며 DO 바인딩과 마이그레이션이 원본 설정과 일치하는지 확인한다.

DO 클래스를 생성·삭제·개명·이관하는 변경은 `wrangler versions upload`로 적용할 수 없다. 최초 `lunch-rooms-v1`은 `wrangler deploy`로 적용한다. 이는 [Cloudflare 버전 관리 명세](https://developers.cloudflare.com/workers/versions-and-deployments/deployment-management/)의 제약이다.

실제 배포에서 사용하는 명령 예시이며, 이번 메타데이터 감사에서는 실행하지 않았다.

```powershell
$env:WRANGLER_LOG_PATH = '.wrangler/logs'
npm run build
npx wrangler deploy --config dist/server/wrangler.json --keep-vars
```

기존 일반 변수를 유지하도록 `--keep-vars`를 명시한다. API 키를 등록·갱신할 때 값은 명령행 인자나 저장소에 포함하지 않는다. 빌드 환경에만 있는 키와 Worker 실행 시의 바인딩은 별개다.

마이그레이션 적용 이후 DO 수명 변경이 없는 버전은 `versions upload`를 사용할 수 있다. 업로드 성공과 운영 100% 반영을 구분하고 `deployments list`로 실제 배분을 확인한다. [Worker 버전과 배포](https://developers.cloudflare.com/workers/versions-and-deployments/)는 저장소 내용의 버전 관리가 아니다.

**키 등록 후 첫 CI 배포에서도** 활성 버전의 `secret_text` 두 이름과 `secret list` 결과를 다시 확인한다. 이전의 키 없는 버전이나 빌드 환경의 키 존재만으로 유지 여부를 판단하지 않는다. 테스트 방의 새 결과에 실제 난수 출처가 표시되는지도 확인하고 최종 deployment/version ID를 #8에 기록한다.

## 24시간 TTL과 복구의 근거

- HTTP 생성 처리는 서버의 `Date.now()`를 사용하고 `initialize()`가 `expiresAt = createdAt + 86,400,000`을 한 번 설정한다. 입퇴장·채팅·투표·재추첨·재기동으로 종료 시각을 바꾸는 경로는 없다.
- 초기화 RPC는 이미 만료된 생성 시각과 60초를 초과하는 미래 시각을 거부한다. 공개 생성 API는 사용자가 보낸 생성 시각을 채택하지 않는다. 저장 데이터 parser도 생성 후 24시간을 초과하는 종료 시각을 거부한다.
- `onStart`, 연결, 수신 메시지, alarm, 연결 종료 처리, 늦은 난수 응답의 확정 전에 종료 시각을 검사한다. 만료 시각 이상이면 기존 연결에 종료를 알리고 방의 저장 데이터와 alarm을 삭제한다. 삭제된 URL에서 방을 다시 생성하는 공개 경로는 없다.
- 닉네임 확인은 만료 시 410을 반환하는 조회이며, 종료 시각 연장이나 참가자 등록을 하지 않는다. 만료 데이터 삭제는 일반 alarm·연결 등의 만료 처리가 담당한다.
- `LunchRoomServer`는 자체 constructor에서 종료 시각이나 alarm을 재설정하지 않는다. PartyServer의 휴면 복귀 후에도 저장된 절대 종료 시각을 읽고 종료·자리비움·입장 대기 등의 가장 가까운 시각을 예약한다. 상시 JavaScript 타이머에 삭제를 맡기지 않는다.
- alarm은 중복 실행될 수 있다. `expireIfNeeded`와 완료 상태 검사로 같은 방을 되살리지 않고 이미 끝난 추첨의 완료 알림을 반복하지 않는다. [Cloudflare alarm 명세](https://developers.cloudflare.com/durable-objects/api/alarms/)상 물리적 삭제가 언제나 종료 시각과 같은 밀리초에 실행된다고 보장하지 않는다.
- 이번 수정은 `deleteAll()`·`deleteAlarm()`이 모두 성공한 뒤에만 방 캐시를 폐기한다. 삭제 실패 중에도 종료 상태를 유지하고 새 연결에는 방 내용 없이 종료만 알리며 다음 alarm에서 정리를 재시도한다. 데이터 삭제 후 alarm 삭제 전에 재기동하면 남은 alarm도 정리한다. 기존의 캐시 선행 폐기 문제를 자동 검사에서 보완한 것이며 실제 운영에서 해당 저장 실패가 발생한 증거는 없다.
- 브라우저는 snapshot / ping으로 서버와의 시차를 보정한다. 단말 시계나 클라이언트가 보낸 시각으로 서버의 TTL을 연장할 수 없다.

재현할 자동 검사:

```powershell
npx vitest run tests/LunchRoomServer.test.ts tests/lunchRoom.test.ts tests/useLunchRoom.test.tsx
```

주요 사례는 24시간 경계의 종료·저장 삭제·늦은 난수 결과 폐기, 10초 미입장 연결의 alarm 종료, 5분 자리비움 판정, 난수 조회 중 재기동 복구, 완료 시각을 지난 추첨 복구, 재접속 중 단말 시계의 오차다. 조회 중 재기동한 처리는 대기로 돌아가며 새 시작 ID로 재시도한다. 이미 처리한 시작 ID는 다시 실행하지 않는다.

실제 24시간 경과 추가 확인은 검증용 새 방만 사용하고 생성 시각·원래 종료 시각을 기록한다. 종료 직전 참가 등으로 종료 시각이 늘어나지 않는지, 만료 후 연결이 종료/방 없음으로 처리되는지 확인해 #8에 추가한다. 사용자 방이나 저장 내용을 조회하지 않는다. 이 대기 검증은 이번에 수행하지 않았다.

## 복구 후보 확인과 롤백

복구 대상은 **보안 패치와 TTL 정리 수정 이후 운영 검증을 통과한 버전**으로 정하고 #8에 UUID를 기록한다. 이 문서 작성 시에는 해당 최종 배포를 아직 확인하지 않았으므로 고정된 정상 복구 버전을 제시하지 않는다. 실제 롤백도 실행하지 않았다.

`46d5a26a-875c-4b77-85f3-bedba18befcf`는 키 설정 후 운영 smoke를 통과한 과거 기준선이지만 런타임 취약점과 TTL 정리 수정 이전이다. 키 등록 전의 `9c7eea02-11f9-4958-aa0c-a2384a1ebf81`·`d483ad21-dd3e-497f-8e01-d8a42002a07e`도 정상 복구 대상으로 추천하지 않는다.

런타임 보안 근거는 [Seroval GHSA-97r2-qh9m-474h](https://github.com/lxsmnsyc/seroval/security/advisories/GHSA-97r2-qh9m-474h)의 역직렬화 DoS 수정(1.6.8 이상)이며, 이번 lockfile의 실행 경로 `node_modules/seroval`은 1.8.1이다. 버전 트리의 다른 개발 의존성까지 모두 같은 버전으로 갱신했다고 해석하지 않는다. 기능을 되돌려야 한다면 패치 후 검증 버전을 고르거나, 보안·정리 수정을 유지한 브랜치에서 기능만 되돌려 새 버전을 배포한다.

실행 전 현재 버전과 후보를 다시 조회하고 DO 클래스·마이그레이션 경계, 현재 후보/투표/동결 기록을 후보 parser가 보존하는지, API 키 변경 후 사용처를 확인한다. DO 도입 전이나 다른 수명 변경을 가로지르는 버전은 선택하지 않는다. 사용자의 저장 데이터를 덮어쓰거나 삭제해 호환성 문제를 해결하지 않는다. [Cloudflare 롤백 제약](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)도 확인한다.

검토 후 운영자가 실행하는 예시다. **이번에는 실행하지 않았으며** `--yes`를 붙이지 않는다.

```powershell
$verifiedSafeVersion = Read-Host '#8에서 확인한 패치 후 검증 버전 UUID'
$rollbackInfo = npx wrangler versions view $verifiedSafeVersion --name jeommechu --json | ConvertFrom-Json
$rollbackInfo.resources.script_runtime | Select-Object migration_tag, compatibility_date
$rollbackInfo.resources.bindings | Select-Object name, type, class_name, namespace_id
npx wrangler rollback $verifiedSafeVersion --name jeommechu --message "Issue 8: reviewed rollback"
```

Wrangler는 대상 버전을 100%로 전환하는 새 deployment를 만든다. 코드와 관련 설정의 복구이며 DO·KV 데이터 내용이나 이미 삭제된 방을 되돌리지 않는다. 후보 버전 이후 키가 바뀌었다면 추가 확인 내용도 읽고 예상과 다르면 중단한다. 실제 복구 소요 시간·연결 중단·재접속은 이번에 검증하지 않았다.

실행했다면 deployment/version ID와 시각을 다시 읽고 검증용 새 방에서 입장·동일 닉네임 거부·채팅·권한·결과 표시를 확인한다. 실제 배분, 검증 결과와 남은 문제를 #8에 기록한다.
