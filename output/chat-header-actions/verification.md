# 채팅 헤더 조작 구분

관련 이슈: https://github.com/acee90/random-number-generator/issues/67
상위 로드맵: https://github.com/acee90/random-number-generator/issues/7

- 내 상태 문구·점·프로필 꺾쇠 제거. 사진/이름 영역만 프로필 편집을 엽니다.
- 꺾쇠 한 개를 별도 shadcn Button으로 분리. 프로필과 참가자 사이 빈 공간도 이 버튼에 속하며 채팅 제목과 같은 toggleChat을 사용합니다.
- 프로필/참가자 메뉴, 초안·연결·숨김 상태·기존 읽지 않음 표시 유지.

로컬 검증: 전체1,490개/51파일 테스트, TypeScript·Biome·앱 빌드 통과. 실제 브라우저320/597/1280px에서 긴 닉네임, 헤더 꺾쇠 클릭·Space/Enter, 제목 Enter, 편집 진입·Escape 포커스 복귀, 참가자 온라인 표시, 초안 보존 확인. 가로넘침 없음. 대표 화면 첨부.

실제 모바일 가상키보드·RTL·200% 브라우저 확대·느린 모션은 미확인. 공통 기본 컴포넌트/새 모션은 변경하지 않았습니다.
운영 배포/검증은 이슈 #67에서 별도로 기록합니다.
