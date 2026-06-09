# Capture Recording

발표·교육 자료 제작 시 반복되는 "클릭 → 캡처 → 입력 → 캡처 → 빨간 테두리/주석"을 자동화하는
Windows 데스크톱 도구. 프로그램을 켜두고 평소처럼 작업하면 클릭/입력 시점을 자동 감지해 캡처하고,
요소에 빨간 테두리를 입혀 단계별 가이드(PNG/PDF/HTML/DOCX·PPTX)로 내보낸다.

> An auto screen-capture tool that turns your normal clicks & text entry into a
> ready-to-edit, step-by-step guide. Korean / English UI.

## 기술 스택

- **Electron + TypeScript + React** (electron-vite)
- **uiohook-napi** — 글로벌 마우스/키보드 후킹
- **Electron desktopCapturer + sharp** — 화면 캡처 및 이미지 처리
- **electron-store** — 설정 저장 (모든 기능 on/off 토글)
- **i18next** — 한국어/영어
- **C# .NET 사이드카** (`native-helper/`) — Windows UIA로 클릭 요소 경계/타입/이름 + 창/프로세스 조회.
  Windows 내장 `csc.exe`로 빌드(.NET SDK 불필요), .NET Framework 4.8 런타임에서 실행

## 개발

```bash
npm install                          # 의존성 설치 (electron + uiohook-napi/sharp 네이티브 모듈)
pwsh native-helper/build.ps1         # C# UIA 사이드카 컴파일 → native-helper/bin/native-helper.exe
npm run dev                          # 개발 모드 (HMR)
npm run build                        # 프로덕션 번들
npm run typecheck                    # 타입 검사 (main + renderer)
npm run package:win                  # Windows 설치파일(NSIS) 생성 (사이드카 exe 포함)
```

### 헤드리스 스모크 테스트

GUI 클릭 없이 캡처 파이프라인 전체를 검증:

```bash
CR_SMOKE=1 npx electron-vite preview
# → [SMOKE] ok items=1 path=... size=WxH thumb=true
```

> 참고: 일부 자동화/CI 셸에는 `ELECTRON_RUN_AS_NODE=1`이 설정되어 Electron이 일반 Node로 실행될 수
> 있다. 그 경우 실행 전 `unset ELECTRON_RUN_AS_NODE` 가 필요하다 (일반 사용자 터미널에서는 불필요).

## 구조

```
src/
├─ main/            # Electron main: 후킹·캡처·세션·설정·트레이·창
│  ├─ services/     # settings, globalHook, capture, session
│  ├─ controller.ts # 오케스트레이션 (트리거 → 캡처 → 플래시 → 갤러리)
│  ├─ windows.ts    # 컨트롤 패널 + 투명 플래시 오버레이 (contentProtection)
│  └─ tray.ts
├─ preload/         # 안전한 contextBridge IPC 브리지 (window.api)
├─ renderer/        # React UI: ControlBar, Gallery, SettingsPanel, i18n(en/ko)
└─ shared/          # 공유 타입 / IPC 채널 / 기본 설정
```

## 마일스톤

- [x] **M1** — 동작하는 MVP: 클릭 → 전체화면 자동 캡처 → 플래시 효과 → 갤러리 → 설정 골격 + i18n + 트레이
- [x] **M2** — C# UIA 사이드카 + 요소 빨간 테두리(비파괴 합성) + 창/요소/커서 캡처 모드 + 해상도 설정 + 자동 캡션
- [x] **M3** — 텍스트 입력 완료 감지 캡처(탭/엔터/다른 곳 클릭) + 입력 캡션 ('입력' / `Enter "..."`)
- [x] **M4** — 후처리 편집기(react-konva: 테두리 보정/화살표/사각형/형광펜/블러/텍스트/번호) + 중복 감지·정리(pHash) + 드래그 재정렬 + 세션 영속화·크래시 복구
- [x] **M5** — 내보내기(주석 평탄화: 빨간 테두리·마킹·실제 블러 + 캡션/번호 배너) → PNG·PDF·HTML·Markdown·DOCX·PPTX, 사용자 선택
- [x] **M6** — 설정 UI 완성(전 항목) · 글로벌 단축키(시작/일시정지/수동/직전삭제) · 캡처 제외목록 · 설정 프로파일 · Windows 시작 시 실행 · NSIS 설치파일 패키징

## 핵심 설계: 비파괴 캡처 모델

캡처 순간엔 **원본 스크린샷만** 저장하고, 빨간 테두리·번호·주석·블러는 **메타데이터 + 합성 레이어**로
다룬다. 덕분에 사후에 테두리 위치를 보정하거나 마킹·문구를 자유롭게 추가/수정할 수 있고,
캡처 플래시 효과는 화면 피드백일 뿐 저장 이미지에는 절대 포함되지 않는다 (`setContentProtection`).
