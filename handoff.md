# Handoff — Capture Recording (2026-09-01 기준)

새 세션에서 이 문서 하나만 읽으면 이어서 작업할 수 있도록 정리한 **현재 상태 문서**입니다.
(시간순 작업 로그가 아니라, 지금 코드가 어떤 상태이고 무엇이 남았는지를 기준으로 씀)

## 0. 30초 요약

- Windows용 Electron 앱. 사용자가 작업하는 동안 **클릭/텍스트 입력을 자동 캡처**하고, 클릭한 UI 요소에
  붉은 테두리를 그려 **단계별 매뉴얼(PNG/PDF/DOCX/PPTX/HTML)로 내보내는** 도구.
- 기능 마일스톤 M1~M6 완료 + 2026-08~09에 **출시 준비 작업** 진행: 녹화 HUD, 라이선스/무료판 게이트,
  갤러리 드래그, 자르기, 편집기 전면 개편까지 **모두 커밋됨** (`9c999fd`, 작업 트리 clean).
- **수익화 방향 확정**: 무료판 + Pro 일시결제 ₩39,000($29), 평생 업데이트, 무료판 제한 = 내보내기 게이트.
- 남은 큰 덩어리: ① 최근 기능들의 **육안 검증**(자동 검증 불가한 것들) ② **제품명 확정** → 상수 교체
  ③ Phase 3(결제사 연동·랜딩) ④ Phase 4(코드사이닝·자동 업데이트).

## 1. 프로젝트 개요

- 경로: `C:\Users\doosung.oh\My_Projects\capture_recording` · 브랜치 `main` · Electron + Vite + React + TS
- 프로세스 구조: main([src/main](src/main)) / preload / renderer 3개 창
  - **메인 패널**(index.html) · **캡처 효과 오버레이**(overlay.html, 클릭 통과) · **녹화 HUD**(hud.html)
  - 세 창 모두 `setContentProtection(true)` → **어떤 캡처에도 찍히지 않음** (스크린샷으로 UI 검증 불가!)
- UI 요소 감지: C# UIA 사이드카 `native-helper.exe` (`native-helper/`, `pwsh native-helper/build.ps1`),
  클라이언트 [src/main/services/nativeHelper.ts](src/main/services/nativeHelper.ts)
- **비파괴 설계(핵심 불변식)**: raw PNG는 항상 깨끗하게 저장. 테두리·주석·자르기는 전부
  `session.json`의 메타데이터(`annotations`, `crop`)이고, 썸네일·편집기·내보내기 시점에
  [flatten.ts](src/main/services/flatten.ts)가 합성. → **raw 폴더 PNG로 결과를 확인하지 말 것.**
- 세션 데이터: `%APPDATA%\capture-recording\sessions\current\` (raw/ + session.json).
  설정 `settings.json`, 라이선스 `license.json` 같은 폴더.

## 2. 완료된 작업 (최근 3커밋 기준)

### `82feb8a` — 첫 클릭 테두리 수정 · 녹화 HUD · 갤러리 드래그 · OS 언어
- **첫 클릭에 테두리가 없던 버그** 3중 수정: 녹화 시작 시 UIA 워밍업 조회(`warmUpHelper`), press 시점
  조회 실패 시 mouseup에서 1회 재시도, 요소를 못 찾아도 클릭 지점에 고정 크기 폴백 마커
  ([capture.ts](src/main/services/capture.ts) `FALLBACK_MARKER_DIP`).
- **녹화 HUD**: 시작 → 메인 창 숨김 + 상단 중앙 알약 HUD(깜빡이는 점·경과시간·📷캡처·일시정지·정지·
  단축키 안내). 정지 → 메인 창 복귀(종료 중엔 `quitting` 가드). HUD/패널 위 클릭은
  `windows.isPointOnOwnUi()`로 캡처 트리거에서 제외. [windows.ts](src/main/windows.ts), [hud.tsx](src/renderer/src/hud.tsx)
- **갤러리 드래그 순서 변경**: 네이티브 HTML5 DnD가 이 환경에서 개시조차 안 됨 → **pointer 이벤트
  커스텀 드래그**로 구현. 핸들 = 카드 하단 바(번호·제목), 이미지 클릭 = 편집. [Gallery.tsx](src/renderer/src/components/Gallery.tsx)
- **OS 언어 자동 감지**: 첫 실행 기본 언어 = `app.getLocale()`(ko/en), 사용자 변경은 유지. [settings.ts](src/main/services/settings.ts)

### `5b8fb7e` — 라이선스 인프라 + 내보내기 게이트 (수익화 Phase 1·2)
- **오프라인 Ed25519 라이선스 키** `CR1.<payloadB64url>.<sigB64url>` — 서명은 payload 문자열
  바이트에 직접(정규화 이슈 없음). [license.ts](src/main/services/license.ts) `verifyLicenseKey` / `LicenseService`.
  - **개인키: `C:\Users\doosung.oh\.capture-recording-keys\private.pem`** (저장소 밖, 반드시 백업).
    공개키는 license.ts에 임베드. 발급: `node scripts/license-issue.mjs <email>`
  - 설정 화면 최상단 "라이선스" 섹션(플랜 배지·키 입력·활성화·해제). IPC `license:*`.
- **내보내기 게이트(main에서 강제)**: 무료 = PNG/JPG만 + 워터마크 "Made with <제품명>", Pro = 전 포맷 +
  워터마크 없음. `controller.exportSession()`; `CR_SMOKE=1`은 게이트 우회. ExportModal에 Pro 칩/안내.

### `9c999fd` — HUD 📷 · 제품명 상수 · 기본 내보내기 폴더 · 자르기 · 편집기 전면 개편
- **HUD 📷 수동 캡처**: 커서가 자체 UI 위면 UIA 조회 생략(보이지 않는 HUD에 테두리 방지).
- **`PRODUCT_NAME` 상수** [src/shared/product.ts](src/shared/product.ts) — 기본 내보내기 폴더명·워터마크
  문구를 좌우. 현재 `'Capture Recording'`(미확정 상태의 플레이스홀더).
- **기본 내보내기 폴더**: `storage.saveDir`(비면 `문서\<PRODUCT_NAME>`) + 내보내기마다
  `guide-YYYY-MM-DD_HH-mm` 하위 폴더(덮어쓰기 방지). 설정 ▸ 파일에서 변경/기본값. IPC `export:defaults`.
- **자르기(영역 선택)**: 비파괴 `CaptureItem.crop`. 주석을 구운 뒤 crop 적용 → 모든 포맷·썸네일 반영.
  `controller.updateItem()`이 crop/annotations 변경 시 썸네일 재생성(async).
- **편집기 전면 개편** [Editor.tsx](src/renderer/src/components/Editor.tsx) + [icons.tsx](src/renderer/src/components/icons.tsx):
  - 도구: 선택 V · 테두리 B · 사각형 R · 타원 E · 화살표 A · 직선 L · 펜 P · 형광펜 H · 블러 M ·
    모자이크 K · 텍스트 T · 말풍선 Q · 번호 N · 자르기 C. 사각형/타원 채우기 토글.
  - **되돌리기/다시 실행** Ctrl+Z/Y (스냅샷 스택, 변경 "전"에 push).
  - 16색 팔레트 + 사용자 색상, 컨텍스트 슬라이더(굵기/글자/블러 강도/셀 크기), 확대/축소, Shift+드래그 비율 유지.
  - **이미지 복사 Ctrl+C / PNG 저장 Ctrl+S** — flatten+crop+무료판 워터마크 적용(`copyItemImage`/`saveItemImage`).
  - Annotation 종류: border, rect(+fill), ellipse(+fill), arrow, line, pen, highlight, blur, mosaic, text, callout, badge.
    [flatten.ts](src/main/services/flatten.ts)가 전부 렌더(모자이크 = nearest 축소→확대).

## 3. 확정된 결정 / 미결 사항

| 항목 | 상태 |
|---|---|
| 과금 모델 | ✅ 무료판 + **Pro 일시결제 ₩39,000 / $29**, **평생 업데이트** |
| 무료판 제한 | ✅ **내보내기 게이트**(캡처·편집·단계 수 무제한, 무료는 PNG/JPG+워터마크) |
| 결제 방식 | 방향만 확정: MoR(Paddle 또는 Lemon Squeezy). **한국 판매자 등록 가능 여부 확인이 첫 관문**. Stripe 직접은 한국 미지원 |
| 제품명 | ⬜ 미확정. 조사 결과 **StepTrail**만 소프트웨어 사용 사례 없음(StepSnap·ClickTrail·StepCapture·StepCap은 기존 제품 있음). 상표·도메인 확인 필요. 확정 시 `PRODUCT_NAME` 한 줄 교체 |
| 웹사이트 | 판매 시작 시점부터 필수. 지금은 GitHub Releases → 정적 랜딩+MoR 체크아웃 → 문서/SEO |
| 코드사이닝 | ⬜ 필수 선결 과제(SmartScreen). OV 인증서 vs Azure Trusted Signing. 현재 `signAndEditExecutable: false` |

분석 문서(경쟁 가격·근거): https://claude.ai/code/artifact/7a77c030-47d0-44fb-a148-a44a7cb56f13

## 4. 실행 · 검증 방법

```bash
npm run typecheck        # node + web
npm run build            # out/ 생성
# 실행 (이 PC의 셸에는 ELECTRON_RUN_AS_NODE=1이 전역 설정돼 있어 반드시 해제)
unset ELECTRON_RUN_AS_NODE && npx electron .
```
- PowerShell로 띄울 때: `$env:ELECTRON_RUN_AS_NODE=$null; Start-Process node_modules\electron\dist\electron.exe -ArgumentList '.'`
- **단일 인스턴스 락**: 이전 인스턴스가 떠 있으면 새 실행이 조용히 즉시 종료됨(로그도 없음).
  `Get-Process electron`으로 확인 후 메인 프로세스(`--type=` 없는 것) 종료.
- 헤드리스 스모크: `CR_SMOKE=1 npx electron .` → `[SMOKE] ok`. ⚠️ **current 세션을 실제로 조작**
  (중복 정리·삭제·순서 반전·테스트 주석) — 실데이터 있을 때 돌리지 말 것.
- Pro 테스트: `node scripts/license-issue.mjs <email>` 로 키 발급 → 설정 ▸ 라이선스에 붙여넣기.
- 렌더러 로그는 stdout으로 안 나옴. 렌더러 JS 오류는 UI가 비는 것으로만 드러남.

## 5. 알려진 함정 · 이 저장소의 규칙

1. **HTML5 drag&drop 금지** — 이 환경(Electron/Windows)에서 드래그가 개시되지 않음(2회 검증). 요소 드래그는
   pointer 이벤트(pointerdown+setPointerCapture, elementFromPoint)로. Gallery.tsx가 표준 패턴.
2. **dragstart/드로잉 시작 중 DOM 변경 금지** — Chromium이 네이티브 드래그를 취소함.
3. **자체 창은 캡처에 안 찍힘** — HUD/패널 UI는 스크린샷·CopyFromScreen으로 검증 불가. 육안 확인만 가능.
4. **비파괴 불변식 유지** — 원본 픽셀을 바꾸는 코드는 넣지 말 것. 새 시각 요소는 Annotation 종류 추가 +
   flatten.ts 렌더 + Editor.tsx 렌더 세 곳을 같이 수정.
5. **무료판 게이트 우회 경로 주의** — 완성 이미지가 나가는 모든 경로(내보내기·복사·저장)는 main에서
   `license.isPro()` 확인 + 워터마크. 렌더러 UI 잠금만으로는 부족.
6. **개인키 백업** — `~/.capture-recording-keys/private.pem` 분실 시 기존 고객 키 재발급 불가.
7. **저장소 정리 필요**: `82feb8a`에 0바이트 파일 7개(`1656`, `2204`, `2676`, `2940`, `3000`, `3888`,
   `3924`)가 실수로 커밋됨 → `git rm` 후 커밋.
8. 스모크 테스트는 `updateItem`이 async가 된 뒤 `await`로 수정돼 있음. 새 IPC 추가 시 index.ts 핸들러 +
   preload + ipc.ts `CaptureApi` 세 곳을 같이.

## 6. 미검증 항목 (사용자 육안 확인 필요 — 자동화 불가)

- [ ] 녹화 시작 → 첫 클릭 썸네일에 붉은 테두리(폴백 마커라도) 표시
- [ ] HUD: 표시/드래그 이동/📷/일시정지·재개/정지 → 패널 복귀, HUD 클릭이 캡처로 저장되지 않음
- [ ] 갤러리 하단 바 드래그로 순서 변경 + 번호 재부여
- [ ] 라이선스 키 활성화 → Pro 배지, 무료/Pro 내보내기 차이(포맷 잠금·워터마크)
- [ ] 편집기: 새 도구 전부, Ctrl+Z/Y, 자르기 자유 조절, 복사/저장, 썸네일·내보내기에 동일 렌더
- [ ] 내보내기 기본 경로 `문서\<제품명>\guide-…` 및 설정에서 폴더 변경

## 7. 다음 단계 (우선순위 순)

1. **6번 항목 육안 검증** → 발견된 버그 수정 → 커밋
2. **제품명 확정**(StepTrail 권장, 상표·도메인 확인) → `PRODUCT_NAME` 교체, 창 제목·i18n `app.title`·
   `electron-builder.yml` 제품명/appId 일괄 반영, 아이콘
3. **Phase 3 — 판매 연결**: MoR 가입(한국 판매자 자격) → 상품 등록 → 웹훅으로 키 자동 발급(또는 수동 발급
   운영) → 앱 내 "구매" 버튼(URL) → 정적 랜딩 페이지(다운로드·구매)
4. **Phase 4 — 배포**: 코드사이닝 → `electron-updater` + GitHub Releases → 설치 파일 배포
5. 기능 백로그(사용자 피드백 따라): 편집기 다중 선택/정렬, 말풍선 자동 줄바꿈(현재 `\n`만), 텍스트 폰트
   선택, 단계 합치기/분할, 캡션 일괄 편집, 세션 여러 개 관리(현재 `current` 하나)

## 8. 파일 지도

| 파일 | 역할 |
|---|---|
| [src/main/controller.ts](src/main/controller.ts) | 오케스트레이션: 녹화 start/stop, press pre-grab, 클릭 처리, 자체 UI 클릭 제외, 내보내기 게이트, 썸네일 재생성, 복사/저장, 기본 폴더 |
| [src/main/windows.ts](src/main/windows.ts) | 패널/오버레이/HUD 창 생성, `isPointOnOwnUi` |
| [src/main/services/capture.ts](src/main/services/capture.ts) | 캡처 파이프라인, 모드 강등, border/폴백 annotation, 초기 썸네일 |
| [src/main/services/flatten.ts](src/main/services/flatten.ts) | 주석·자르기 합성(모든 출력의 단일 진실) |
| [src/main/services/export.ts](src/main/services/export.ts) | 포맷별 내보내기, `applyWatermark` |
| [src/main/services/license.ts](src/main/services/license.ts) | 라이선스 검증/보관 |
| [src/main/services/nativeHelper.ts](src/main/services/nativeHelper.ts) | UIA 사이드카 클라이언트(query 500ms) |
| [src/main/services/settings.ts](src/main/services/settings.ts) | electron-store 설정, OS 언어 기본값 |
| [src/shared/types.ts](src/shared/types.ts) · [ipc.ts](src/shared/ipc.ts) · [product.ts](src/shared/product.ts) | 타입/Annotation, IPC 채널·API, 제품명 |
| [src/renderer/src/components/Editor.tsx](src/renderer/src/components/Editor.tsx) | 편집기(react-konva) |
| [src/renderer/src/components/Gallery.tsx](src/renderer/src/components/Gallery.tsx) | 갤러리 + pointer 드래그 |
| [src/renderer/src/components/ExportModal.tsx](src/renderer/src/components/ExportModal.tsx) · [SettingsPanel.tsx](src/renderer/src/components/SettingsPanel.tsx) | 내보내기 모달(Pro 잠금), 설정(라이선스·폴더) |
| [src/renderer/src/hud.tsx](src/renderer/src/hud.tsx) · [hud.html](src/renderer/hud.html) | 녹화 HUD |
| [scripts/license-keygen.mjs](scripts/license-keygen.mjs) · [license-issue.mjs](scripts/license-issue.mjs) | 키쌍 생성(1회 완료) · 키 발급 |
| [electron.vite.config.ts](electron.vite.config.ts) | renderer 엔트리 3개(index/overlay/hud) |

## 9. 관련 기록

- Claude 메모리(자동 로드): 프로젝트 개요, 수익화 결정, HTML5 DnD 금지, Electron 환경 주의사항
- 수익화 분석 아티팩트: https://claude.ai/code/artifact/7a77c030-47d0-44fb-a148-a44a7cb56f13
