# Handoff — 클릭 지점 붉은 박스 미표시 이슈 (2026-08-21, 개선 3종 적용 완료)

새 세션에서 이 문서만 읽으면 이어서 작업할 수 있도록 정리한 문서.

## 프로젝트 개요

- Electron + Vite 기반 화면 캡처/기록 앱 (`c:\Users\doosung.oh\My_Projects\capture_recording`)
- 클릭/텍스트 입력 시 화면을 캡처하고, 클릭한 UI 요소에 붉은 박스(border)를 표시
- **비파괴(non-destructive) 설계**: raw 이미지는 항상 깨끗하게 저장. 붉은 박스는 `session.json`의 `border` annotation(메타데이터)으로만 저장하고, 갤러리 썸네일·에디터·내보내기 시점에 합성함
  - 근거: [src/main/services/capture.ts](src/main/services/capture.ts) `capture()` 주석("Saves a CLEAN raw image") 및 `encode()` 주석("raw stays CLEAN — no border baked in")
- UI 요소 감지는 C# UIA 사이드카(`native-helper.exe`)가 담당. 클라이언트: [src/main/services/nativeHelper.ts](src/main/services/nativeHelper.ts)
- 세션 데이터 위치: `C:\Users\doosung.oh\AppData\Roaming\capture-recording\sessions\current\` (raw 폴더 + session.json)

## 보고된 문제

`sessions\current\raw\step-001-2026-07-22_16-50-23-940.png`에 클릭 영역 붉은 박스가 표시되지 않음.

## 조사 결과 (완료)

1. **raw 파일에 박스가 없는 것 자체는 정상.** 비파괴 설계상 raw PNG에는 어떤 캡처든 박스가 그려지지 않음. step-002~004의 raw PNG를 픽셀 검사해도 붉은 박스 없음을 확인함. 박스 확인은 갤러리 썸네일이나 내보내기 결과물로 해야 함.
2. **진짜 문제: step-001만 annotation 자체가 생성되지 않음.** session.json 확인 결과:
   - step-001: `element: null`, `annotations: []` → 갤러리/내보내기에서도 박스가 안 나옴
   - step-002~004: element + `border` annotation(색 `#ff3b30`, 두께 6) 정상 생성
3. **원인 분석**: [nativeHelper.ts](src/main/services/nativeHelper.ts)의 `query()` 타임아웃이 500ms인데, 첫 조회는 다음 두 콜드 스타트 비용 때문에 이를 초과하기 쉬움:
   - C# 사이드카의 .NET JIT + UIA 초기화
   - Chromium은 접근성 트리를 첫 UIA 조회 시점에 lazy하게 빌드 → 첫 `ElementFromPoint`가 타임아웃/빈 결과
   - `query()`가 null이면 [capture.ts](src/main/services/capture.ts)에서 fullscreen 모드로 강등되고 border 없이 저장됨. 재시도 없음. 이번 세션의 "첫 클릭만 실패, 이후 정상" 패턴과 정확히 일치.

## 개선안 3가지 (사용자와 합의됨) — 모두 적용 완료

1. ✅ **워밍업 조회**: 녹화 시작 시 더미 `query()`로 사이드카/접근성 트리를 미리 깨움
2. ✅ **실패 시 1회 재시도**: mouseup 시점에 press 시점 query가 null이면 한 번 더 조회
3. ✅ **폴백 마커**: 요소를 못 찾아도 클릭 지점 중심에 고정 크기 붉은 박스 annotation을 넣어 클릭 위치만이라도 항상 표시

## 적용한 변경

### 1번 — 워밍업 (커밋 `71bc0bf`에 포함됨)

[src/main/controller.ts](src/main/controller.ts) — `start()`에서 `warmUpHelper()` 호출:

- `warmUpHelper()`: 현재 커서 위치의 물리 좌표로 `this.helper.query(phys.x, phys.y, 3000)`을 fire-and-forget 호출. 헬퍼가 없으면 skip
- 워밍업 타임아웃은 3초(결과를 기다리지 않으므로 넉넉히), 실제 클릭 조회는 기존 500ms 유지

### 2번 — 재시도 (2026-08-21 적용, 미커밋)

[src/main/controller.ts](src/main/controller.ts) `handleClick()`:

- press 시점(또는 폴백 경로) query가 `null`로 끝나면 mouseup 시점에 `query(x, y, 1000)`으로 1회 재시도
- 프레임은 press 시점에 이미 동결되어 있으므로 재시도는 지연만 늘릴 뿐 이미지 정합성에는 영향 없음
- capture.ts의 기존 `containsClick` sanity check가 내비게이션 후 잘못된 요소가 잡히는 경우를 걸러줌

### 3번 — 폴백 마커 (2026-08-21 적용, 미커밋)

[src/main/services/capture.ts](src/main/services/capture.ts) `capture()`:

- `trigger === 'click'`이고 요소 border를 만들지 못한 경우, 클릭 지점 중심에 `FALLBACK_MARKER_DIP`(36 DIP × scaleFactor) 크기의 정사각형을 `borderInCrop`으로 사용
- 이후 파이프라인(annotation 생성, 썸네일 합성, 내보내기)은 요소 border와 동일하게 처리되므로 별도 분기 없음
- manual/text-commit 트리거에는 적용하지 않음 (manual은 커서 위치 마커가 노이즈, text-commit은 요소가 항상 존재)

`npm run typecheck` (node + web) 통과 확인.

## 녹화 UX 개편 (2026-08-21 두 번째 세션, 미커밋)

사용자 요청 4가지 반영:

1. **시작 시 메인 창 숨김**: `controller.start()`에서 `windows.hidePanel()` 호출
2. **녹화 중 표시 + 정지 단축키 안내**: 새 **녹화 HUD** 창 — 화면 상단 중앙의 알약(pill) UI.
   깜빡이는 빨간 점 + 상태 텍스트 + 경과 시간 + "Ctrl+Shift+R 로 정지" 힌트. 드래그로 이동 가능
3. **일시정지/재개 + 정지 버튼**: HUD 안에 포함 (기존 패널의 일시정지 버튼은 그대로)
4. **정지 시 메인 창 복귀**: `controller.stop()`에서 `windows.showPanel()` (앱 종료 중에는
   `quitting` 플래그로 재생성 방지)

구현 파일:

- [src/main/windows.ts](src/main/windows.ts): `createHud()`(frameless·transparent·always-on-top·
  focusable:false·**setContentProtection(true)** → 캡처에 절대 안 찍힘), `showHud()`/`hideHud()`/
  `hidePanel()`, `isPointOnOwnUi()` (DIP 좌표가 HUD/패널 위인지 검사)
- [src/main/controller.ts](src/main/controller.ts): start/stop에서 창 전환, `setStatus()`가 HUD에도
  상태 브로드캐스트, `handlePress`/`handleClick`에서 자체 UI 위 클릭은 캡처 트리거에서 제외
- [src/renderer/hud.html](src/renderer/hud.html) + [src/renderer/src/hud.tsx](src/renderer/src/hud.tsx):
  HUD renderer (React + 기존 i18n 재사용, 경과 시간은 timestamp 기반으로 일시정지 누적 처리)
- [electron.vite.config.ts](electron.vite.config.ts): `hud` renderer 엔트리 추가
- locales ko/en: `hud.*` 문자열 추가

검증: `npm run typecheck` ✓, `npm run build` ✓, `CR_SMOKE=1` 스모크 전체 통과 ✓ (start/stop/quit
경로 크래시 없음, HUD renderer 프로세스 기동 확인). HUD는 content-protected라 스크린샷 검증 불가 —
육안 확인 필요. ⚠️ 스모크가 current 세션을 조작하므로(중복 정리·삭제·reorder) 실데이터 있을 때 주의.

## 추가 요구사항 3건 (2026-08-21 세 번째 세션)

1. ✅ **OS 언어 자동 감지** (미커밋): [src/main/services/settings.ts](src/main/services/settings.ts)에
   `systemLanguage()` — `app.getLocale()`이 ko면 'ko', 아니면 'en'을 첫 실행 기본값으로.
   동적 defaults라 기존 사용자의 언어 선택은 유지됨. renderer [i18n.ts](src/renderer/src/i18n.ts)도
   초기 추정을 `navigator.language` 기반으로 변경(설정 로드 전 한국어 UI 깜빡임 방지). typecheck ✓
2. 📄 **수익화 검토 → 방향 확정(2026-08-21)**: 분석 문서(아티팩트) —
   https://claude.ai/code/artifact/7a77c030-47d0-44fb-a148-a44a7cb56f13
   **사용자가 "무료판 + 일시결제 Pro" 채택 확정.** Pro 일시결제 ₩39,000~49,000, 결제는
   MoR(Paddle/Lemon Squeezy). 근거: 로컬 앱은 구독 정당화 약함, 데스크톱 기준가 Folge $89.
   향후 개발 과제: 라이선스 키 검증, Free/Pro 게이팅(경계선 미정: 단계 수 제한 vs 워터마크),
   구매·복원 UI. 차별화 포인트(기능 경쟁 분석): 요소 단위 UIA 테두리 + 사전 프레임 동결 +
   완전 로컬 + 한국어 캡션 (경쟁: FlowShare $40/월 구독, Scribe/Tango SaaS, Folge $89).
3. 📄 **웹사이트**: 판매 시작 시점부터 필수. 지금은 GitHub Releases → 판매 시 정적 랜딩+MoR
   체크아웃 → 성장기 문서/SEO. 선결 과제: 코드사이닝(SmartScreen).

## 수익화 실행 (2026-08-21 확정: 무료판+일시결제 Pro ₩39,000, 평생 업데이트, 내보내기 게이트)

**Phase 1 — 라이선스 인프라 (구현 완료, 미커밋)**

- 오프라인 Ed25519 서명 키: `CR1.<payloadB64url>.<sigB64url>`, 서명은 payload 문자열 바이트에
  직접(정규화 문제 없음). [src/main/services/license.ts](src/main/services/license.ts) —
  `verifyLicenseKey()` + `LicenseService`(electron-store 'license'에 키 보관, activate/deactivate)
- **개인키: `C:\Users\doosung.oh\.capture-recording-keys\private.pem` — 저장소 밖. 백업 필수!**
  공개키는 license.ts에 임베드. 발급: `node scripts/license-issue.mjs <email>`
- IPC: license:get/activate/deactivate + evt:licenseChanged. 설정 화면 최상단 라이선스 섹션
  (플랜 배지, 키 입력/활성화, 해제). 크립토 라운드트립·변조 거부 검증 완료

**Phase 2 — 내보내기 게이트 (구현 완료, 미커밋)**

- main에서 강제([controller.ts](src/main/controller.ts) `exportSession`): 무료 = PNG/JPG만 +
  워터마크("Made with Capture Recording" 필, flatten 직후 합성이라 전 포맷 상속), Pro = 전 포맷 +
  워터마크 없음. `CR_SMOKE=1`은 게이트 우회(파이프라인 테스트 보전)
- ExportModal: Pro 전용 포맷 잠금 표시(Pro 칩) + 무료판 워터마크 안내. 워터마크 렌더링 시각 검증 완료

**Phase 3 (남음)**: MoR 가입(Paddle/Lemon Squeezy, 한국 판매자 자격 확인) → 상품 등록 →
웹훅으로 키 자동 발급 or 수동 발급 운영 → 랜딩 페이지(구매 버튼). 제품 영문명·도메인 결정 필요
**Phase 4 (남음)**: 코드사이닝(OV or Azure Trusted Signing) → electron-updater + GitHub Releases

## 출시 준비 개선 3건 + HUD 캡처 버튼 (2026-08-21, 미커밋)

- **HUD 📷 캡처 버튼**: 녹화 중 메인 창이 숨겨져 "지금 캡처" 버튼을 쓸 수 없던 문제 → HUD에
  추가([hud.tsx](src/renderer/src/hud.tsx)). `controller.manualCapture()`는 커서가 자체 UI 위면
  UIA 조회를 건너뜀(보이지 않는 HUD 버튼에 테두리가 그려지는 것 방지). HUD 폭 460→540.
- **제품명**: 웹 조사 결과 StepSnap(Windows 작업기록 도구 등 2개 존재)·ClickTrail·StepCapture·
  StepCap 모두 기존 제품 있음. **StepTrail**만 소프트웨어 사용 사례 없음(상표·도메인 확인은 별도).
  결정 전이므로 [src/shared/product.ts](src/shared/product.ts) `PRODUCT_NAME`은 'Capture Recording'
  유지 — 이름 확정 시 이 상수 한 줄만 바꾸면 기본 폴더·워터마크에 반영.
- **기본 내보내기 폴더**: `storage.saveDir`(비면 `Documents\<PRODUCT_NAME>`) + 내보내기마다
  `guide-YYYY-MM-DD_HH-mm` 하위 폴더(덮어쓰기 방지). IPC `export:defaults`, ExportModal이 경로를
  미리 채움, 설정 ▸ 파일에 "기본 내보내기 폴더" 변경/기본값 UI.
- **편집기 자르기(영역 선택)**: 비파괴 — `CaptureItem.crop?: Rect|null`(raw px). 편집기 '자르기'
  도구로 드래그 → 바깥 영역 어둡게, 선택 시 이동/크기 조절, '자르기 해제' 버튼/Delete.
  `flattenItem()`이 주석을 구운 뒤 crop을 적용하므로 모든 내보내기 포맷·썸네일에 반영.
  `controller.updateItem()`이 crop/annotations 변경 시 flatten 기반으로 갤러리 썸네일을 재생성
  (async로 변경, 스모크의 updateItem 호출도 await로 수정).
  - 2026-09-01: 모서리 앵커 드래그 시 비율이 고정되던 문제 → Konva Transformer 기본값
    (`keepRatio: true`)이 원인. `keepRatio={false}` + `shiftBehavior="inverted"`(Shift 누르면 비율
    유지)로 변경. 자르기뿐 아니라 테두리·사각형·형광펜·블러 주석에도 동일 적용.

## 편집기 전면 개편 (2026-09-01, 미커밋) — "다른 편집기 없이도 되게"

그림판 리본 + 캡처 도구 플로팅 툴바를 참고해 [Editor.tsx](src/renderer/src/components/Editor.tsx)
재작성 (+ [icons.tsx](src/renderer/src/components/icons.tsx) 인라인 SVG 아이콘 세트):

- **새 도구**: 타원(E), 직선(L), 펜/자유곡선(P, 연속 스트로크 유지), 말풍선(Q, 채움 박스+텍스트,
  배경색 대비로 글자색 자동), 모자이크(K, 픽셀화). 사각형·타원 **채우기** 토글(30% 투명).
  Annotation 타입에 ellipse/line/pen/mosaic/callout 추가, rect/ellipse에 `fill?`.
  [flatten.ts](src/main/services/flatten.ts)가 전부 렌더(모자이크는 nearest 축소→확대).
- **되돌리기/다시 실행**(Ctrl+Z / Ctrl+Y·Shift+Z): 스냅샷 스택(최대 100). 그리기 시작·드래그
  시작·변형 시작·삭제·색/굵기 변경·텍스트 편집 세션(포커스) 시점에 undo 포인트 기록.
- **아이콘 툴바**(그룹: 선택 | 도형 | 마스킹 | 텍스트 | 자르기), 단축키 V B R E A L P H M K T Q N C,
  16색 팔레트 + 사용자 색상(`input type=color`), 컨텍스트 컨트롤(굵기/글자/채우기/블러 강도/셀 크기).
- **확대/축소**(−/+/맞춤/100%, 캔버스 스크롤), **이미지 복사**(Ctrl+C, 클립보드) / **PNG 저장**
  (Ctrl+S, 저장 대화상자·기본 위치 = 내보내기 기본 폴더). main: `copyItemImage`/`saveItemImage`
  — flatten + crop + 무료판 워터마크 적용(내보내기 게이트 우회 방지). `applyWatermark` export.
- Esc: 선택 해제 → 도구 해제 → 닫기 순. 토스트로 복사/저장 피드백.

## 남은 작업 / 다음 단계

1. **실사용 검증 (첫 클릭 박스)**: 녹화 시작 → Chrome에서 첫 클릭 → 갤러리 썸네일에 붉은 박스 확인
   (raw 폴더 PNG로 확인하지 말 것 — 비파괴 설계상 raw는 항상 깨끗함)
   - 이제 최악의 경우(워밍업·재시도 모두 실패)에도 폴백 마커가 클릭 위치를 표시하므로 "박스가 아예 없는" 케이스는 사라져야 정상
2. **실사용 검증 (녹화 UX)**: 시작 → 패널 숨고 HUD 등장 / HUD 일시정지·재개·정지 버튼 동작 /
   HUD 위 클릭이 캡처로 저장되지 않는지 / 정지 → 패널 복귀
3. **실사용 검증 (갤러리 드래그 순서 변경, 2026-08-21 pointer 재구현)**: 네이티브 HTML5 DnD가
   이 환경(Electron/Windows)에서 2회 시도 모두 드래그 개시조차 안 됨(전역 차단 코드 없음을 grep으로
   확인 — dragstart/user-drag/preventDefault 전무). → **pointer 이벤트 기반 커스텀 드래그로 교체**:
   figcaption(번호·제목 바)에서 pointerdown+setPointerCapture, 6px 임계값 후 드래그 시작,
   fixed-position 고스트 카드가 커서 추적, elementFromPoint(data-card-id)로 드롭 대상 판정,
   drop-before/after accent 바 유지, pointerup에서 reorder. 이미지 클릭 = 편집 열기(분리 유지),
   ✕ 버튼은 드래그 제외. 앞으로 이 앱에서 요소 드래그는 HTML5 DnD 대신 pointer 이벤트를 쓸 것.
4. 검증 완료 후 전체 변경 커밋

## 참고 파일 지도

| 파일 | 역할 |
|---|---|
| [src/main/controller.ts](src/main/controller.ts) | 캡처 오케스트레이션. mousedown pre-grab, 클릭 처리, `start()`/`warmUpHelper()` |
| [src/main/services/capture.ts](src/main/services/capture.ts) | 캡처 파이프라인. 모드 강등 로직, border annotation 생성, 썸네일 합성 |
| [src/main/services/nativeHelper.ts](src/main/services/nativeHelper.ts) | UIA 사이드카 클라이언트. `query()` 타임아웃 500ms |
| `AppData\Roaming\capture-recording\sessions\current\session.json` | 캡처 아이템 메타데이터(annotations 포함) |
