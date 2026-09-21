# 개발 가이드

[제품 소개](../README.md) · [문서 목록](README.md)

DFragonCropper는 main/preload/renderer를 분리한 단일 Electron 패키지입니다. 현재 버전은 0.3.0이며, 로컬 Windows MVP를 개발하고 검증하는 절차를 이 문서에 정리합니다.

## 실행 환경

Node.js 22.12 이상과 npm이 필요합니다. 실제 화면 캡처와 PrintScreen 검증은 Windows 10 x64의 잠금 해제된 대화형 데스크톱에서 실행합니다. macOS에서는 UI와 합성 프레임 테스트를 실행할 수 있습니다.

```sh
npm ci
npm run dev
```

`npm ci`는 고정된 lockfile을 사용하고 Electron 실행 파일을 설치합니다. npm 12의 native 설치 스크립트 허용 목록은 `package.json`에 고정되어 있습니다.

## 검사와 빌드

```sh
npm run lint
npm run format:check
npm run typecheck
npm test
npm run test:ui
npm run build
npm run start
```

`npm run test:ui`는 빌드 후 실제 Electron을 Playwright로 실행하므로 그래픽 세션이 필요합니다. `npm run start`는 빌드한 앱을 실행합니다. lint부터 UI 테스트까지 한 번에 실행하려면 `npm run verify`를 사용합니다.

검증 범위는 변경 위험에 맞춥니다. 문서·단순 UI·boilerplate는 우선 코드 검토로 확인하고, 픽셀·데이터 계약은 의미 있는 단위 테스트, UI 흐름은 Playwright로 확인합니다. native capture, cursor 제외, DPI와 PrintScreen 동작은 합성 테스트만으로 성공했다고 판단하지 않습니다. 이미 확보한 근거는 해당 계약이 바뀌거나 새로운 불확실성이 생긴 경우에 다시 확인합니다.

### Windows portable 빌드

Windows x64 PC에서 `npm ci`를 실행한 뒤 빌드합니다. macOS에서 설치한 native 의존성을 이용한 cross-build는 지원하지 않습니다.

```powershell
npm run build:win
```

결과는 `dist/DFragonCropper-0.3.0-x64-portable.exe`입니다. 현재 개발 빌드는 코드서명된 안정 릴리스가 아닙니다. 앱은 임시 extraction 폴더 대신 실행 EXE 옆에 설정·캡처·로그를 저장하므로, EXE가 있는 폴더에 쓰기 권한이 필요합니다.

`electron-builder` 26.15.3의 `portable.unpackDirName: true`를 유지합니다. 각 실행이 별도 임시 폴더를 사용해야 두 번째 실행이 첫 실행의 파일을 교체하려 하지 않고 Electron의 단일 인스턴스 처리까지 도달합니다.

`dist/`와 로컬 캡처·로그·설정 파일은 Git에서 제외됩니다. 저장 경로와 복구 절차는 [설정과 데이터](configuration.md)를 참조하세요.

### 앱 아이콘

`resources/icon.png`는 제공받은 원본 이미지이며, `resources/icon.ico`는 Windows의 여러 표시 크기에 맞춘 아이콘입니다. 원본을 교체한 뒤 저장소에 고정된 packaging 도구로 ICO를 다시 만듭니다.

```sh
node scripts/build-icon.mjs
```

Windows 빌드는 이 ICO를 실행 파일에 넣고, 창과 트레이에도 같은 아이콘을 사용합니다. PNG와 ICO는 패키지의 resources 디렉터리에도 함께 복사됩니다. 아이콘 크기 변환은 앱 리소스에만 적용하며 실제 캡처 PNG의 픽셀 처리에는 관여하지 않습니다.

## 소스 구조

```text
src/main/                  Electron 창, IPC, PrintScreen·트레이·종료 수명 관리
src/main/printscreen.ts    Win32 pass-through 키보드 훅
src/main/capture/          Primary Monitor GDI 캡처, 픽셀 crop, PNG 저장·이력
src/main/profiles/         프로필 검증, 설정·백업 저장과 v1 이관
src/main/logging.ts        로컬 진단 로그와 한 세대 회전
src/preload/              한정된 typed API
src/shared/               프로필과 typed IPC 계약
src/renderer/             숫자·드래그 ROI 편집, 캡처 기록과 설정 화면
tests/unit/               좌표·픽셀·프로필·설정·이력 계약 테스트
tests/ui/                 Playwright Electron 편집·캡처 테스트
spike/windows-capture/    보존된 비교 실험, 실기 fixture, 결과와 한계
resources/                앱 아이콘 원본 PNG와 Windows ICO
```

`ldb/apps/desktop`의 main/preload/renderer 분리, native main 의존성, preload 번들링과 보안 경계를 참고했습니다. 현재 화면에 필요한 범위를 넘는 `@ldb/ui`·인증·OCR·상태 프레임워크 의존성은 가져오지 않았습니다.

Renderer는 `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`로 실행하며, 이름과 타입이 정해진 preload 메서드만 사용합니다. 파일·native API는 main에서 처리하고 IPC 발신자·프레임·URL·인자를 검증합니다. Renderer의 입력 검증만을 신뢰하지 않습니다.

## 캡처 구현과 검증 근거

캡처는 저장된 활성 프로필과 원본 저장 옵션을 고정한 뒤 Primary Monitor에서 한 프레임만 가져옵니다. 모든 ROI는 그 프레임의 정확한 행 바이트를 복사해 생성합니다. 확대·축소, 필터, 정규화, JPEG 인코딩은 하지 않습니다. 미리보기의 표시 크기 변경은 실제 PNG의 크기나 픽셀을 바꾸지 않습니다.

PrintScreen의 native callback은 즉시 입력을 다음 hook으로 전달하고, 캡처와 파일 저장은 callback 바깥에서 처리합니다. 저장 중 들어온 추가 입력은 대기열에 쌓지 않고 skipped로 집계합니다. 캡처 구현을 교체할 때는 기존 비교 실험을 보존하고 변경 근거를 기록해야 합니다.

| 문서                                                      | 내용                                                                          |
| --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [Windows spike](../spike/windows-capture/README.md)       | globalShortcut 비교, native hook·GDI 선택 이유, 대화형 Windows fixture 실행법 |
| [Windows spike 결과](../spike/windows-capture/results.md) | 초기 실제 Windows 캡처·DPI·cursor·PrintScreen 근거와 한계                     |
| [Profile Editor 검증](profile-editor-verification.md)     | 숫자 편집, 설정 저장·오류·복구 검사                                           |
| [로컬 MVP 검증](local-mvp-verification.md)                | 0.3.0 드래그 좌표, 설정 이관, 이력, 트레이, portable 중복 실행 검사           |

Windows 검사는 대화형 데스크톱이 필요하며 SSH 세션 0만으로는 실기 캡처를 증명할 수 없습니다. fixture의 합성 키 입력과 실제 물리 키 입력을 구분해 기록합니다. 이전 spike 문서는 당시 상태를 보존한 역사적 기록이며, 그 안의 제한이나 통과 결과가 현재 앱의 전체 기능·검증 범위를 뜻하지는 않습니다.

원시 캡처 이미지와 로컬 보고서는 추적하지 않습니다. 개인 화면·경로·환경 정보나 자격 증명을 저장소에 추가하지 마세요.
