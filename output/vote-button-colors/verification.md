# 투표 색상 보완

관련 https://github.com/acee90/random-number-generator/issues/69 · 상위 #7 · 선행 PR70

초록/주황 팀 색을 유지하며 배경을 기본8%, hover18%, 선택28%로 혼합합니다. 기존 background/foreground/team 토큰을 사용하며 hover 밑줄은 제거했습니다. 선택 체크/내 선택·전송/완료 비활성 정책은 유지합니다.

CSS 한 파일의 상태 색상 변경으로 기능 테스트는 PR70의 전체1,490개 통과 결과를 사용합니다. Biome·diff검사·앱빌드 통과. 실제 Storybook320/597/1280px에서 양 팀 색조·선택·지연 전송·완료·키보드 포커스/비활성 확인.597px에서 실제 우클릭→Escape로 hover를 유지해 background 변경과 text-decoration:none을 확인했습니다. 가로 넘침 없음. screenshot은 pending/선택 상태입니다.

실제 모바일 기기·RTL·OS 모션 설정 전환은 미검증. 운영 반영은 같은 이슈 #69에서 최종 갱신합니다.
