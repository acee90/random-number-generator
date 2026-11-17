# 추첨 컨트롤·기록 창 UI 검증

관련 이슈: https://github.com/acee90/random-number-generator/issues/63
상위 로드맵: https://github.com/acee90/random-number-generator/issues/7

2026-11-17 로컬 검증 기록입니다. PR·머지·운영 배포의 최신 상태는 이슈 #63에서 관리합니다.

| 심각도 | 위치 | 변경 전 | 변경 후 | 이유 |
| --- | --- | --- | --- | --- |
| MEDIUM | RoomExclusionPanel / Switch | shadcn Thumb translate와 화면 CSS transform이 중복 | 공통 lg size API로 이동을 한 번만 적용 | 컨트롤 경계 안에서 상태 표시 |
| MEDIUM | 기록 창 헤더 | absolute 닫기와 최근 개수 겹침 | 헤더 내부 별도 슬롯 | 구조적 간격·44px 버튼 확보 |
| MEDIUM | 기록 항목 | 첫 항목 자동 포커스·큰 클릭 영역·복사 정렬 불일치 | 최초 제목 초점, 별도 상세/복사 행동·같은 크기 | 초기 포커스와 키보드 포커스 구분 |
| HIGH, 수정 완료 | solo 기록 복원 | 편집 후 listVersion > 새 세션 1이라 기록 읽기 거절 | 공통 draw archive 검증으로 분리·버전 유지 | 기록 재방문 복원·원본 보존 |

## 확인 결과
- 전체1,482개/51파일 테스트(`npm test -- --maxWorkers=4`), 타입·변경 Biome·앱/Storybook 빌드 통과.
- 실제 브라우저597×716에서 ON: track42×24px, thumb18px, 오른쪽 안쪽 여백3px. OFF는 왼쪽3px. Space 전환·추첨중 disabled 확인.
- 다른 실제 방의 기본 Switch32×18.4px도 OFF 왼쪽1px/ON 오른쪽1px로 유지. 후보 추천 접수 ON 상태 전환 확인.
- 기록 창320/597/1280px 및 긴 이름 확인. 닫기·개수 겹침과 가로넘침 없음. 최초 초점은 제목이며 outline 없음. Tab 상세 버튼은2px 링 유지. 상세 열기/닫기·Escape 트리거 복원 확인.
- 상세/복사 버튼 모두44px 높이. 597px에서는100px씩 나란히,320px에서는178px씩 세로. 복사→복사됨에도 크기 유지.
- 실제 후보 편집→추첨한 listVersion2 기록을 새 방문에서 복원. 이전 원본을 삭제하지 않음.
- 모션10% 재생·실기기 가상키보드·RTL 수동 검증은 미실시. 새 모션을 추가하지 않았고 이동 전환의 기존 motion-safe 규칙을 유지함.

판정: 확인한 수정 범위 Approve. 운영 반영 여부는 이슈에서 별도 기록합니다.
