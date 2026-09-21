# Local Windows MVP verification — 0.3.0

검증일: 2026-09-22. 이번 범위는 로컬 Windows 앱이다. 화면에서 ROI 지정 → 활성 프로필 저장 → PrintScreen 캡처 → PNG 저장 → 이력 조회까지 구현했다. 서버 업로드, OCR, 멀티모니터는 포함하지 않는다.

## 코드와 자동 검증

- 기존 GDI capture, crop row copy, PrintScreen pass-through hook은 유지했다. 새 preview도 같은 native source 함수를 사용하며 PNG 픽셀을 재샘플링하지 않는다.
- 숫자 편집과 드래그 편집을 함께 제공한다. 드래그 좌표는 표시 이미지의 경계와 원본 PNG 크기로 환산하며, 최소 경계는 floor, 최대 경계는 ceil로 저장한다. Windows 배율을 좌표에 다시 곱하지 않는다.
- schemaVersion 1 설정은 원문을 `.bak`에 보존한 뒤 schemaVersion 2로 원자적으로 마이그레이션한다. 기존 프로필·ID·좌표·카운터는 유지한다.
- 원본 저장을 꺼도 화면은 한 번만 캡처하며 같은 프레임의 ROI PNG와 metadata를 저장한다. metadata의 `source.file`은 `null`이다.
- 새 portable 출력은 `captures/`이다. 예전 `.dev-captures/`도 이력에서 읽고 자동 이동·삭제하지 않는다. 최신 100개를 표시하며 오래된 이미지 파일을 모두 열지 않는다.
- 일반 실행은 단일 인스턴스로 제한한다. 트레이가 준비된 상태에서 닫기 옵션이 켜져 있으면 창만 숨긴다. 명시적 Quit은 진행 중인 캡처와 설정 쓰기를 기다린다.
- 단위 테스트 88개 통과: 캡처 19, 이력 21, 설정 44, 드래그 좌표 4.
- 실제 Electron Playwright 7개 통과 증거: 기존 프로필 기능, 드래그 → 실제 합성 PNG 영역 일치, 이력 이미지 읽기, 원본 저장 끄기, 재시작 복원, 캡처 직후 Quit의 파일 완결성을 포함한다.
- ESLint, Prettier, TypeScript 및 Electron production build를 실행했다. 의존성 버전은 0.2.0과 같으므로 기존 macOS/Windows native 설치를 재사용했다.

첫 UI 검사에서 이력이 아직 없을 때 선택 상태를 읽는 null 접근 오류가 발견되어 수정했다. 이후 6개 UI 테스트를 통과했고, 종료 중 저장 검증 1개를 추가해 해당 케이스만 실행했다.

코드 리뷰에서 PNG decoder의 interlaced 경로가 메모리 한도를 우회할 수 있어 앱이 생성하는 non-interlaced RGBA8 PNG만 허용하도록 제한했다. 관련 헤더 검증 테스트를 보강해 통과했다. Preview 중 트레이나 두 번째 실행이 창을 다시 표시하는 경합도 표시 요청을 프레임 획득 후로 미뤄 해결했다.

## 실제 Windows 결과

Windows 10 Pro x64 build 19045, Primary Monitor 1920×1080에서 실제 portable EXE로 검증했다.

100% 배율(Win32 96 DPI, renderer DPR 1)에서 preview PNG가 1920×1080임을 확인했다. 실제 pointer 이벤트와 표시 이미지 경계로 독립 계산한 ROI `(480, 270, 576, 325)`가 저장된 좌표와 일치했다. 이 ROI를 포함한 세 PNG의 모든 픽셀이 해당 이벤트 원본의 지정 영역과 일치했다.

창 닫기로 트레이에 숨긴 뒤, 별도 앱을 foreground에 둔 상태의 합성 PrintScreen 1회가 캡처 1회로 저장됐다. 총 완료 2, 실패 0, busy skip 0이었고 창은 숨겨진 상태를 유지했다. Windows 클립보드도 갱신됐으며 원본 저장을 끈 이벤트에는 ROI PNG 3개만 있었다.

이 실행은 두 번째 portable 실행이 기존 창을 복원하지 못해 전체적으로는 실패했다. 런처가 실행 중인 파일과 같은 임시 디렉터리에 다시 압축을 푸는 문제를 확인하고 `portable.unpackDirName: true`로 바꿨다. electron-builder 26.15.3의 실제 구현에서 이 값은 매 실행에 고유한 추출 폴더를 사용한다. Electron의 단일 인스턴스 로직은 변경하지 않았다. 초기 창 크기도 DPI 적용 후 작업 영역 안에 들어오도록 제한했다.

150% 최종 실행은 새 좌표 계약과 수정된 portable lifecycle을 함께 확인하기 위해 전체 모드로 실행했고 모두 통과했다.

| 확인 항목    | 150% 최종 결과                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------- |
| 실제 배율    | Win32 window DPI 144, renderer DPR 1.5                                                          |
| Preview      | 창이 숨겨진 상태에서 1920×1080 native PNG 획득, 캡처 이벤트 추가 없음                           |
| 드래그 좌표  | 실제 pointer/이미지 경계에서 독립 계산한 `(479, 270, 577, 324)`와 저장된 ROI 일치               |
| 실제 PNG     | 원본 1920×1080; 세 ROI의 모든 RGBA 바이트가 같은 이벤트 원본의 지정 영역과 일치                 |
| 설정·재시작  | EXE 옆 config와 이전 유효본 백업 확인; 재시작 후 전체 설정 일치                                 |
| 트레이 캡처  | 창을 닫은 후 합성 PrintScreen 1회 → 원본 없는 ROI PNG 3개; foreground와 기본 클립보드 동작 유지 |
| 결과 카운터  | 완료 2, 실패 0, busy skip 0                                                                     |
| 두 번째 실행 | 기존 PID와 창 유지·복원, 두 번째 런처 정상 종료, 추가 캡처 없음                                 |
| 이력 조회    | 이벤트 2개; 최신 이벤트 원본 미저장 상태와 ROI preview 바이트가 Windows 파일과 일치             |
| 보안·정리    | renderer에 Node 미노출; 테스트 앱·fixture·임시 프로필 모두 정리, 강제 프로세스 종료 없음        |

검증 후 사용자가 Windows를 100%, 1920×1080으로 복원했다. 원시 결과는 Git에서 제외된 `.dev-captures/windows-verification/local-mvp-100-attempt1.json`과 `local-mvp-150-report.json`에 보존했다. 100%와 150%의 드래그 숫자가 다른 것은 실제 pointer와 CSS 경계의 소수점 좌표가 다르기 때문이며, 각각 표시한 정수 ROI와 저장 PNG의 대응을 검증했다.

이 검증에 사용한 실행 파일은 용 아이콘을 적용하기 전의 `DFragonCropper-0.3.0-x64-portable.exe`이며, 101,082,160 bytes다. SHA-256: `5d875f51dce41e2db0a69e5ee26f458e61e9dd6f8f12ddeaa429a40e74ca0eef`. 이후 아이콘 리소스를 교체한 빌드의 해시와 구분한다.

새 좌표 입력과 트레이 lifecycle 때문에 Windows 실기 검증을 추가한다. 이전에 충분한 증거를 얻은 물리 키보드 20회 입력, 커서 제외와 GDI 원본 픽셀 충실도는 [기존 실기 결과](../spike/windows-capture/results.md)를 재사용한다.

## 재현

Windows native 의존성으로 `npm run build:win`을 실행한다. portable EXE를 `config.json`과 `.bak`이 없는 별도의 테스트 폴더에 복사한다. 이 검증은 테스트용 프로필과 캡처 파일을 만든다. 실제 사용자 설정 폴더에서 실행하지 않는다.

100% 배율의 활성 Windows 데스크톱:

```powershell
node .\spike\windows-capture\portable-smoke.cjs `
  --executable-path <isolated-directory>\DFragonCropper-0.3.0-x64-portable.exe `
  --output <fresh-report>.json --verify-local-mvp --scale 1
```

150% 배율에서는 다른 빈 테스트 폴더와 결과 경로로 좌표 계약만 검증한다:

```powershell
node .\spike\windows-capture\portable-smoke.cjs `
  --executable-path <another-isolated-directory>\DFragonCropper-0.3.0-x64-portable.exe `
  --output <another-fresh-report>.json --verify-local-mvp --scale 1.5 --coordinates-only
```

100% 전체 모드는 합성 PrintScreen 1회를 사용하며 실제 native 화면을 캡처한다. 150% 좌표 모드는 키를 주입하지 않는다. 테스트 앱·포커스 fixture·임시 Chromium 프로필을 정리하고, EXE·설정·PNG·결과 JSON은 테스트 폴더에 보존한다.

## 한계

Unsigned Windows 개발 빌드다. 자동 업로드·자동 업데이트·자동 시작은 구현하지 않았다. 이력에는 최신 100개를 표시하며 자동 삭제나 삭제 버튼은 없다. 매우 큰 PNG는 이력 미리보기 한도(파일 64MiB / 디코딩 RGBA 256MiB)를 넘으면 열지 않는다. 캡처 PNG의 저장 형식은 변경하지 않는다.
