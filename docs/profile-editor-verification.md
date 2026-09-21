# Profile Editor verification — 0.2.0

검증일: 2026-09-22. 숫자 좌표 Profile Editor, 설정 저장과 활성 프로필의 캡처 연결을 검증했다.

## 자동 검증

- macOS: `npm ci`, ESLint, Prettier, TypeScript, Electron production build.
- Vitest 47개 통과: 기존 픽셀 계약 18개와 프로필 저장·검증 29개. 설정 재시작 복원, 증가 ID, 명령 직렬화, 백업, 쓰기 실패 시 메모리 불변, 손상·외부 변경 파일 보존을 포함한다.
- 실제 Electron을 실행한 Playwright 5개에 대한 통과 증거 확보. 프로필/ROI CRUD, 편집 선택과 활성 선택의 분리, 저장 전 초안 보존, 저장된 좌표의 정확한 합성 PNG crop, 재시작 복원, 마지막 프로필 삭제, 설정 오류 표시를 확인했다.
- 첫 UI 실행에서 편집 프로필 선택 컨트롤의 접근성 이름 문제가 발견되어 `aria-label`을 추가했다. 통과한 나머지 4개 테스트는 반복하지 않고 해당 통합 테스트만 다시 실행해 통과했다.
- main IPC와 설정 저장 경계를 별도로 코드 리뷰했으며 수정이 필요한 추가 문제는 발견하지 못했다.

## Windows portable 검증

Windows 10 Pro x64 build 19045의 활성 콘솔 세션에서, Windows에 설치한 의존성으로 `npm ci`와 `npm run build:win`을 실행했다. 실제 portable EXE를 일반 실행한 뒤 loopback CDP로 UI를 조작했다. 합성 프레임과 키 입력 주입은 사용하지 않았다.

| 항목          | 결과                                                                      |
| ------------- | ------------------------------------------------------------------------- |
| UI 편집       | 새 프로필 #2와 ROI #1 `(31, 37, 137, 83)`, #2 `(301, 121, 89, 71)` 저장   |
| 설정 위치     | EXE 옆 `config.json`; 직전 유효 설정이 `config.json.bak`에 보존됨         |
| 재시작        | 활성 프로필, ID, 이름, 좌표와 카운터를 포함한 전체 설정 일치              |
| 실제 캡처     | GDI 원본 1920×1080, 원본과 ROI PNG 총 3개; 완료 1, 실패 0, busy skip 0    |
| ROI 픽셀      | 두 ROI의 모든 RGBA 바이트가 같은 이벤트의 원본 PNG에서 지정한 영역과 일치 |
| 이벤트 정보   | 재시작 후 활성 프로필 ID·이름·ROI가 capture result 및 metadata와 일치     |
| renderer 경계 | Node `require`/`process` 미노출; 허용된 preload 메서드 4개만 노출         |
| 종료          | 테스트 앱·프로세스 종료와 임시 Chromium 프로필 정리 완료                  |

실행 파일은 `DFragonCropper-0.2.0-x64-portable.exe`, 101,068,703 bytes다. SHA-256: `910bb16715d71d05800a0a12e6e212e0bf7356c708881d1d19436a6b217e8c8f`. 서명 인증서를 적용하지 않은 개발 빌드이며 바이너리와 캡처는 Git에 포함하지 않는다. 요약의 근거인 원시 결과는 로컬 `.dev-captures/windows-verification/profile-editor-report.json`에 보존했다.

재현은 Windows 10의 활성 사용자 데스크톱에서 수행한다. 먼저 `npm ci`, `npm run build:win`으로 Windows용 native 의존성과 portable EXE를 만든다. 테스트는 설정을 수정하므로 **EXE를 설정 파일이 없는 별도 테스트 폴더에 복사**해서 실행한다.

```powershell
node .\spike\windows-capture\portable-smoke.cjs `
  --executable-path <isolated-directory>\DFragonCropper-0.2.0-x64-portable.exe `
  --output <fresh-report-path>.json `
  --verify-profiles
```

이 모드는 UI에서 새 프로필과 ROI 두 개를 저장하고, EXE 옆 `config.json`과 `.bak`을 읽은 뒤 앱을 재시작한다. 다시 불러온 설정과 캡처 metadata의 활성 프로필이 일치하는지, 저장된 각 ROI의 모든 픽셀이 동일 이벤트의 원본 PNG에서 지정한 영역과 같은지 확인한다. 원래 앱과 테스트 프로세스를 닫고 임시 Chromium 프로필을 정리한다. EXE, 설정, 캡처와 결과 JSON은 테스트 폴더에 남긴다.

## 검증 범위

이번 변경은 숫자를 physical pixel 좌표로 저장한다. 화면 좌표를 DIP에서 변환하는 UI, 미리보기나 드래그 선택은 없다. `win32.ts`, `pixels.ts`, PrintScreen hook은 변경하지 않았다.

100%/150% 배율의 실제 원본 픽셀 일치, 커서 제외, 백그라운드 PrintScreen 감지와 Windows 기본 동작 보존은 [이전 Windows 실기 결과](../spike/windows-capture/results.md)의 증거를 재사용한다. 이번 Profile Editor 검증을 이유로 그 실험을 반복하지 않았다.

설정 저장은 한 앱 안에서 직렬화되며 파일 교체는 같은 디렉터리에서 수행한다. 여러 앱 인스턴스의 동시 설정 편집과 전원 차단 상황의 복구는 이번 검증 범위에 포함하지 않는다.
