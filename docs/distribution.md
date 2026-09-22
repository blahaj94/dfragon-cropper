# 다운로드와 배포

[제품 소개](../README.md) · [문서 목록](README.md)

## 실행 파일 받기

[GitHub Releases](https://github.com/blahaj94/dfragon-cropper/releases)에서 사용할 버전의 `DFragonCropper-<version>-x64-portable.exe`를 받습니다. GitHub가 함께 표시하는 Source code 압축 파일은 실행 파일이 아닙니다.

Windows x64에서 EXE를 쓰기 가능한 폴더에 두고 실행하세요. 설치 과정은 없습니다. 현재 0.x 버전은 코드서명되지 않은 미리보기 릴리스이며, Windows 10에서 주 모니터 캡처를 지원합니다.

각 릴리스에는 `SHA256SUMS.txt`도 포함됩니다. 다운로드한 EXE의 SHA-256을 PowerShell로 계산해 해당 파일의 값과 비교할 수 있습니다.

```powershell
Get-FileHash .\DFragonCropper-0.5.0-x64-portable.exe -Algorithm SHA256
```

## 새 버전으로 업데이트

1. 앱이나 트레이 메뉴에서 **Quit**를 눌러 완전히 종료합니다.
2. 기존 `config.json`, `config.json.bak`, `captures/`를 보존한 채 새 EXE를 **같은 폴더**에 둡니다. 이전 버전의 `.dev-captures/`가 있다면 함께 보존합니다. 새 EXE를 다른 폴더에서 실행하면 그 폴더에 별도의 설정과 캡처를 사용합니다.
3. 새 EXE를 실행해 활성 프로필과 저장된 ROI를 확인합니다. 0.3.x·0.4.0에서 0.5.0으로는 설정 형식이 바뀌지 않습니다. `Ground Truth`에서 이전 캡처도 정답을 작성할 수 있습니다.
4. 새 버전이 정상 동작하면 이전 버전의 EXE를 별도로 보관하거나 삭제할 수 있습니다. 설정·캡처 파일을 함께 지우지 마세요.

자동 업데이트는 제공하지 않습니다. 설정을 복구해야 하면 [백업 복구 안내](configuration.md#백업으로-수동-복구)를 참고하세요.

0.5.0에서 정답을 저장하면 해당 이벤트의 `metadata.json`에 선택적 `groundTruth` 필드를 추가하고, 직전 정상 내용을 `metadata.json.bak`에 한 세대 보관합니다. 업데이트나 백업 시 이벤트 폴더 전체를 보존하세요. PNG 파일은 정답 편집으로 변경하지 않습니다.

## 개발자를 위한 배포 흐름

자동화 정의는 [Windows workflow](../.github/workflows/windows.yml)에 있습니다.

| 실행 계기                          | 결과                                                        |
| ---------------------------------- | ----------------------------------------------------------- |
| Pull request 또는 기본 브랜치 push | Windows x64 검사와 portable 빌드, EXE·SHA-256 artifact 보관 |
| Actions의 수동 실행                | 선택한 ref 검사·빌드, artifact 보관. 릴리스는 게시하지 않음 |
| `v<version>` 태그 push             | 같은 검사·빌드 후 해당 버전의 GitHub Release 게시           |

검사는 lint, format, typecheck, 단위 테스트와 실제 Electron의 **합성 프레임 UI 테스트**를 포함합니다. 패키지는 Windows runner에서 native 의존성을 설치해 만듭니다. Hosted runner 검사를 실제 Windows 10의 물리 키보드·DPI·커서 제외 검증으로 해석하지 않습니다. 그 근거는 별도의 [실기 기록](local-mvp-verification.md)에 있습니다.

브랜치의 최신 빌드를 확인하려면 [Actions](https://github.com/blahaj94/dfragon-cropper/actions/workflows/windows.yml)의 성공한 실행에서 artifact를 내려받습니다. artifact는 개발 빌드를 확인하기 위한 보관 파일이며, 공개 다운로드는 Releases를 사용합니다.

### 버전 발행

1. `package.json`과 lockfile의 버전을 함께 변경하고 `docs/releases/<version>.md`에 변경사항을 작성합니다.
2. 변경사항을 커밋하고 기본 브랜치에 push합니다. 브랜치 검사 결과를 확인합니다.
3. 발행할 커밋에 패키지 버전과 같은 태그를 붙이고 push합니다.

```sh
git tag v0.5.0
git push origin v0.5.0
```

태그와 패키지 버전이 다르거나 릴리스 노트가 없으면 배포가 실패합니다. 0.x 버전은 미리보기 릴리스로 표시합니다. 코드서명과 자동 업데이트는 이 워크플로에 포함하지 않습니다.
