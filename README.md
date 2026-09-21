# DFragonCropper

Windows 전용 Electron 앱의 **로컬 캡처 MVP**입니다. 현재 개발 버전은 0.3.0이며, 코드서명된 안정 릴리스가 아닙니다.

PrintScreen 또는 **Capture Now**로 Primary Monitor 한 프레임을 캡처하고, 저장된 활성 프로필의 ROI를 물리 픽셀 그대로 잘라 lossless PNG로 저장합니다. 처음 실행하면 기존 ROI 두 개를 가진 `Default` 프로필로 시작합니다.

## 프로필과 ROI 편집

`Edit profile`은 편집할 프로필을 고릅니다. 실제 캡처에 쓰는 활성 프로필과는 별도이며, `Use for captures`로 활성 프로필을 변경합니다. 새 프로필은 빈 ROI 목록으로 생성되고 바로 활성화됩니다.

- `Create profile`, `Use for captures`, 프로필·ROI 삭제는 실행 시 바로 저장됩니다.
- 이름을 수정한 뒤 `Save name`, ROI 좌표를 수정한 뒤 해당 행의 `Save ROI`를 눌러 저장합니다. 새 영역은 `Add ROI`로 저장합니다.
- 저장 전 입력은 draft입니다. 편집 대상을 바꾸거나 캡처 상태가 갱신되어도 유지되며, `Discard changes`로 취소합니다. 캡처는 draft가 아닌 저장된 활성 프로필을 사용합니다.
- 좌표는 Primary Monitor의 왼쪽 위 `(0, 0)`을 기준으로 한 물리 픽셀입니다. `x`, `y`는 0 이상, `width`, `height`는 1 이상의 안전한 정수여야 합니다. 화면 배율에 따라 DIP로 환산하지 않습니다.

프로필 이름은 앞뒤 공백을 제거한 뒤 1~100자입니다. 프로필과 ROI의 ID는 생성 후 고정되며, 삭제한 ID를 다시 사용하지 않습니다. 모든 프로필이나 모든 ROI를 삭제할 수 있습니다. 활성 프로필을 삭제하면 다음 프로필, 마지막 항목이었다면 첫 번째 남은 프로필이 활성화됩니다. 남은 프로필이 없으면 활성 프로필도 없습니다.

활성 프로필이 없거나 저장된 ROI가 없으면 **Capture Now**가 비활성화되고 PrintScreen에 의한 앱 캡처도 실행되지 않습니다. Windows의 기본 PrintScreen 동작은 그대로 전달됩니다. 실제 캡처 프레임을 벗어나는 ROI는 크기를 자동으로 줄이지 않고 오류로 처리합니다.

캡처가 시작되면 활성 프로필의 ID·이름·ROI 목록을 고정합니다. 그 이벤트의 모든 ROI는 하나의 source frame에서 생성되며, 프로필 ID와 이름도 `metadata.json`에 기록됩니다.

### 이미지에서 영역 그리기

`Profiles` 탭의 `Refresh screen preview`로 현재 Primary Monitor의 정지 이미지를 가져옵니다. 갱신 중 앱 창을 잠시 숨겨 뒤의 화면을 촬영합니다. 미리보기에서 드래그한 뒤 `X/Y/Width/Height physical pixels` 값을 확인하고 `Add drawn ROI`를 누르면 편집 중인 프로필에 저장됩니다. 숫자 입력을 통한 `Add ROI`도 사용할 수 있습니다.

화면에 표시되는 미리보기 크기는 원본 프레임의 크기와 다를 수 있습니다. 드래그 위치는 원본의 물리 픽셀 좌표로 변환되며, 캡처 PNG 자체를 확대·축소하는 기능은 아닙니다. 화면 해상도가 바뀌었으면 미리보기를 갱신한 뒤 좌표를 확인하세요.

## 캡처 기록과 앱 설정

`Captures` 탭의 `Refresh history`는 최근 캡처 이벤트 최대 100개를 표시합니다. `Capture event`와 `Capture image`에서 저장된 원본 또는 ROI 이미지를 고르고, `Open capture folder`로 해당 폴더를 열 수 있습니다. 목록 제한은 파일 보관 기간이 아니며, 오래된 캡처를 자동으로 삭제하지 않습니다.

Portable 앱은 새 `captures/`뿐 아니라 이전 버전의 `.dev-captures/` 기록도 읽습니다. 같은 이벤트 ID가 양쪽에 있으면 새 경로를 우선하며, 기존 파일을 이동하거나 삭제하지 않습니다.

`Settings` 탭에서 다음 옵션을 선택한 뒤 `Save settings`로 저장합니다. 저장 전에는 기존 설정을 계속 사용하며, `Discard settings changes`로 취소할 수 있습니다. 프로필과 설정의 draft는 탭을 바꿔도 유지됩니다.

- `Save original PNG`: 기본값은 켜짐입니다. 끄면 이후 캡처에서 ROI PNG와 metadata만 저장합니다. ROI 생성에 필요한 한 source frame은 여전히 메모리에서 캡처하며, 원본 파일이 없는 이벤트에서는 ROI 이미지를 볼 수 있습니다.
- `Close window to tray`: 기본값은 켜짐입니다. 트레이를 사용할 수 있을 때 창의 닫기 버튼은 앱을 백그라운드로 보내고 PrintScreen 감지를 유지합니다.

`Hide to tray`로 창을 숨기거나 트레이에서 다시 열 수 있습니다. 트레이 생성에 실패했거나 `Close window to tray`가 꺼져 있으면 창의 닫기 버튼은 앱을 종료합니다. macOS 개발 실행에서는 트레이 숨기기를 지원하지 않습니다.

앱을 완전히 종료하려면 창이나 트레이 메뉴의 `Quit`를 사용합니다. 진행 중인 PNG·설정 저장을 마친 뒤 종료합니다. 같은 사용자 데이터 폴더를 쓰는 중복 실행은 기존 창을 복원해 설정 쓰기와 PrintScreen 처리가 중복되지 않게 합니다. `Open output folder`는 캡처 저장 폴더를 엽니다.

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

빌드 결과는 `dist/DFragonCropper-0.3.0-x64-portable.exe`입니다. `dist/`, 로컬 캡처·로그·설정 파일은 Git에서 제외됩니다. portable 앱은 임시 extraction 폴더 대신 실행 EXE의 디렉터리를 사용하므로, EXE가 있는 폴더에 쓰기 권한이 필요합니다.

## 설정과 캡처 데이터

| 데이터              | 개발 실행                     | Portable 실행            |
| ------------------- | ----------------------------- | ------------------------ |
| 프로필 설정         | `.dev-config/config.json`     | EXE 옆 `config.json`     |
| 직전 유효 설정 백업 | `.dev-config/config.json.bak` | EXE 옆 `config.json.bak` |
| 캡처 파일           | `.dev-captures/`              | EXE 옆 `captures/`       |
| 진단 로그           | `.dev-logs/app.log`           | EXE 옆 `logs/app.log`    |

설정 파일은 `schemaVersion: 2` JSON이며, 프로필과 함께 `preferences.saveOriginal`, `preferences.closeToTray`를 저장합니다. 개발 모드에서만 `DFRAGON_CONFIG_FILE`로 설정 파일 위치를 바꿀 수 있습니다. portable 실행에서는 이 환경 변수로 저장 위치를 바꾸지 않습니다.

유효한 v1 설정은 기존 프로필·이름·ID·증가 카운터·활성 선택을 유지한 채 v2로 자동 이관합니다. 두 새 옵션은 모두 켜짐으로 시작합니다. 이관 전에 정확한 v1 원문을 `config.json.bak`에 보존하고 v2를 원자적으로 교체합니다. v2 파일을 다시 여는 것만으로 백업을 교체하지 않으며, 이후 정상 설정 저장부터 직전 유효 v2 설정으로 백업을 갱신합니다.

설정과 백업이 모두 없는 첫 실행에는 기본 설정 파일을 만듭니다. 정상 설정을 변경할 때는 직전 유효 설정을 `config.json.bak`에 보존하고 새 설정을 임시 파일에서 원자적으로 교체합니다. 백업은 한 세대만 유지되며, 최초 실행 직후에는 없을 수 있습니다. 저장에 실패하면 메모리의 설정도 성공한 것처럼 변경하지 않습니다.

유효한 설정을 사용하던 중 일반적인 저장 실패가 발생하면 폼에 오류를 표시하고 이전에 저장된 설정을 유지합니다. 이전 설정이 유효하면 캡처는 계속 사용할 수 있습니다.

앱은 중복 인스턴스를 막고 저장 직전 외부 변경을 검사합니다. 외부 편집기 등 다른 프로그램과의 동시 쓰기를 막는 범용 파일 잠금은 제공하지 않습니다.

잘못된 JSON, 지원하지 않는 schema version, 유효하지 않은 값, 실행 중 외부 변경이 발견되면 기존 파일을 덮어쓰지 않고 오류를 표시합니다. 설정 오류 상태에서는 프로필 편집과 앱 캡처를 차단합니다. `config.json`은 없지만 `.bak`이 있는 경우도 새 기본값으로 초기화하지 않습니다. 백업을 자동으로 불러오거나 손상 파일을 자동으로 삭제하지 않습니다.

각 캡처는 별도 이벤트 폴더에 ROI PNG들과 `metadata.json`을 저장하고, 원본 저장 옵션이 켜져 있으면 `original.png`도 저장합니다. 프로필이나 원본 저장 옵션을 변경해도 이미 저장된 캡처를 지우지 않습니다. `.bak`은 설정 백업이며, 캡처 파일의 백업이나 버전 이력은 아닙니다.

진단 로그 `app.log`는 5 MiB를 넘으면 `app.previous.log`로 한 세대만 보관합니다. 로그 저장 실패가 이미 성공한 캡처 결과를 실패로 바꾸지는 않습니다. 문제를 확인할 때 캡처 metadata와 로그를 함께 확인하되, 개인 화면·경로가 포함된 로컬 자료를 Git에 추가하지 마세요.

### 백업으로 수동 복구

1. `Quit`로 앱을 완전히 종료합니다. 창의 닫기 버튼만 누르면 트레이에서 실행 중일 수 있습니다.
2. 손상되었거나 지원되지 않는 `config.json`이 있으면 다른 이름이나 폴더로 복사해 별도로 보존합니다. 복구 전에 원본을 삭제하지 않습니다.
3. `config.json.bak`이 이전의 유효한 설정인지 확인하고, 백업 파일은 남겨 둔 채 그 내용을 `config.json`으로 복사합니다.
4. 앱을 다시 실행해 프로필, 활성 선택과 ROI를 확인합니다. 백업도 유효하지 않으면 계속 오류 상태로 두고 다른 유효한 설정 사본을 복구합니다.

설정 파일을 직접 교체하거나 편집할 때도 먼저 앱을 닫으세요. 앱이 실행 중인 상태에서 파일을 바꾸어 현재 메모리의 설정과 충돌시키지 않습니다.

## 구조

```text
src/main/                    Electron 창, IPC, PrintScreen 수명 관리
src/main/printscreen.ts      Win32 pass-through 키보드 훅
src/main/capture/            Primary Monitor GDI 캡처, 픽셀 crop, PNG 저장
src/main/profiles/           프로필 검증, 설정·백업 저장
src/preload/                한정된 typed API
src/shared/                 프로필과 typed IPC 계약
src/renderer/               숫자·드래그 ROI 편집, 캡처 기록과 설정 화면
tests/unit/                 좌표·픽셀·프로필·설정 계약 테스트
tests/ui/                   Playwright Electron 편집·캡처 테스트
spike/windows-capture/      보존된 비교 실험, 실기 fixture, 결과와 한계
resources/                  향후 packaging 리소스 위치
```

단일 패키지이며 `ldb/apps/desktop`의 main/preload/renderer 분리, native main 의존성, preload 번들링, 보안 경계를 참고했습니다. 현재 편집·캡처 화면에 필요한 범위를 넘는 `@ldb/ui`·인증·OCR·상태 프레임워크 의존성은 가져오지 않았습니다.

## 현재 범위

- Windows 10 x64, Primary Monitor, 창 모드와 테두리 없는 전체 화면
- PrintScreen pass-through 감지; 등록 API와의 비교 실험 보존
- Primary Monitor 원점 `(0, 0)`의 absolute physical pixel 좌표
- 프로필 생성·이름 변경·삭제·활성 선택과 숫자·이미지 드래그 ROI 편집
- 로컬 JSON 설정의 원자 저장, 직전 유효본 백업과 오류 시 차단
- v1 설정의 v2 이관, 원본 PNG 저장 옵션과 트레이 닫기 옵션
- 최근 100개 캡처 이벤트 열람, 파일 자동 삭제 없음
- 트레이 백그라운드 실행, 명시적 종료, 중복 인스턴스 방지와 진단 로그
- 활성 프로필 snapshot의 모든 ROI를 같은 source frame에서 생성, resize·JPEG·필터 없음
- 커서 합성 없는 GDI 캡처, PNG 저장

Multi-monitor capture is intentionally out of scope for the initial version.

Secondary monitor 선택, virtual-screen/음수 좌표, per-monitor profile, exclusive fullscreen 보장은 지원하지 않습니다. HDR·색 관리·보호된 영상·보안 데스크톱의 픽셀 충실도는 보장하지 않습니다. GDI 32-bit desktop 캡처와 thread DPI API가 필요하며, 실제 검증 환경은 Windows 10 build 19045입니다.

서버·업로드·재시도, OCR·모델·dataset, 인증·Credential Manager, 자동 시작 및 범용 설정 프레임워크는 현재 로컬 MVP 범위 밖입니다. 서버 연동 정보가 정해지기 전에는 로컬 파일만 사용하며 네트워크 업로드를 추가하지 않습니다.

## 검증 기록

구체적인 방법, 실행 환경, 성공·실패 및 미검증 항목은 [Windows spike 기록](spike/windows-capture/README.md)을 먼저 읽으세요. Windows 캡처 방식을 바꿀 때는 이 근거와 픽셀 계약을 유지해야 합니다.

기존 Windows spike 문서와 결과는 당시의 캡처 구현 및 검증 근거로 보존합니다. 그 결과만으로 새 Profile Editor, 설정 저장이나 복구 경로가 검증되었다고 판단하지 않습니다. 새 변경의 검사 범위와 결과는 [Profile Editor 검증 기록](docs/profile-editor-verification.md)에서 별도로 관리합니다.

0.3.0의 미리보기 좌표 변환, 설정 이관, 기록, 트레이 동작과 해당 Windows 확인은 [로컬 MVP 검증 기록](docs/local-mvp-verification.md)에서 구분해 기록합니다. 이전 native 결과만으로 새 UI나 백그라운드 경로의 성공을 판단하지 않습니다.
