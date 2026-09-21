# DFragonCropper

Windows 전용 Electron 앱의 **초기 스캐폴딩 + 캡처 기술 spike**입니다. Profile Editor나 완성된 제품이 아닙니다.

PrintScreen 또는 **Capture Now** → Primary Monitor 한 프레임 → 물리 픽셀 ROI → lossless PNG 저장을 다룹니다. 기본 ROI 두 개는 `src/main/index.ts`에 있습니다.

## 개발

Node.js 22.12 이상과 npm을 사용합니다. Windows 캡처는 Windows 10 x64에서 실행해야 합니다. macOS에서는 UI와 합성 프레임 테스트만 실행할 수 있습니다.

```sh
npm ci
npm run dev
npm run lint
npm run format:check
npm run typecheck
npm test
npm run test:ui
npm run build
npm run start
```

`npm ci`는 고정된 lockfile을 사용하고 Electron 실행 파일을 설치합니다. npm 12의 native 설치 스크립트 허용 목록은 `package.json`에 고정되어 있습니다. `npm run test:ui`는 실제 Electron을 Playwright로 실행하므로 그래픽 세션이 필요합니다. 합성 프레임 테스트는 Windows 실기 검증을 대체하지 않습니다.

Windows x64 PC에서 `npm ci`를 실행한 후 portable 빌드를 만듭니다. macOS에서 설치한 native 의존성으로 cross-build하는 방식은 지원하지 않습니다.

```powershell
npm run build:win
```

`dist/`의 portable EXE와 개발용 `.dev-captures/`는 Git에서 제외됩니다. 개발 출력은 저장소의 `.dev-captures/`, portable 출력은 실행 EXE 옆 `.dev-captures/`입니다. portable extraction 내부 경로 대신 `PORTABLE_EXECUTABLE_DIR`를 사용합니다. 실행 폴더에 쓰기 권한이 필요합니다.

## 구조

```text
src/main/                    Electron 창, IPC, PrintScreen 수명 관리
src/main/printscreen.ts      Win32 pass-through 키보드 훅
src/main/capture/            Primary Monitor GDI 캡처, 픽셀 crop, PNG 저장
src/preload/                한정된 typed API
src/shared/contracts.ts     renderer에 전달하는 상태 타입
src/renderer/               최소 React 개발 화면
tests/unit/                 좌표·픽셀·PNG·동일 프레임 계약 테스트
tests/ui/                   Playwright Electron smoke tests
spike/windows-capture/      보존된 비교 실험, 실기 fixture, 결과와 한계
resources/                  향후 packaging 리소스 위치
```

단일 패키지이며 `ldb/apps/desktop`의 main/preload/renderer 분리, native main 의존성, preload 번들링, 보안 경계를 참고했습니다. 단순 버튼과 상태 출력에 필요한 범위를 넘는 `@ldb/ui`·인증·OCR·상태 프레임워크 의존성은 가져오지 않았습니다.

## 현재 범위

- Windows 10 x64, Primary Monitor, 창 모드와 테두리 없는 전체 화면
- PrintScreen pass-through 감지; 등록 API와의 비교 실험 보존
- Primary Monitor 원점 `(0, 0)`의 absolute physical pixel 좌표
- 같은 source frame에서 모든 ROI 생성, resize·JPEG·필터 없음
- 커서 합성 없는 GDI 캡처, PNG 저장

Multi-monitor capture is intentionally out of scope for the initial version.

Secondary monitor 선택, virtual-screen/음수 좌표, per-monitor profile, exclusive fullscreen 보장은 지원하지 않습니다. HDR·색 관리·보호된 영상·보안 데스크톱의 픽셀 충실도는 보장하지 않습니다. GDI 32-bit desktop 캡처와 thread DPI API가 필요하며, 실제 검증 환경은 Windows 10 build 19045입니다.

Profile Editor, ROI drawing/history UI, 서버·업로드·재시도, OCR·모델·dataset, 인증·Credential Manager, tray·자동 시작·single-instance·설정 시스템은 이번 범위 밖입니다.

## 검증과 다음 작업

구체적인 방법, 실행 환경, 성공·실패 및 미검증 항목은 [Windows spike 기록](spike/windows-capture/README.md)을 먼저 읽으세요. Windows 캡처 방식을 바꿀 때는 이 근거와 픽셀 계약을 유지해야 합니다.

다음 Profile Editor는 `src/renderer/src/App.tsx`에서 화면을 시작하고, `src/shared/contracts.ts`의 `Region`을 기반으로 profile 타입을 추가하면 됩니다. 현재 main의 고정 ROI를 검증된 profile 입력으로 교체하되 ID는 profile 내부의 불변 증가형 정수로 유지합니다. ROI 좌표는 DIP가 아닌 캡처 PNG의 물리 픽셀입니다. 아직 config 저장·업로드 경로는 구현하지 않습니다.
