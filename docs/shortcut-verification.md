# 0.6.0 단축키 설정 검증

[사용법](user-guide.md#단축키-바꾸기) · [문서 목록](README.md)

2026-09-22 기록입니다. 설정 저장·화면 동작, mock Win32 검사와 실제 Windows 합성 입력 검사를 구분합니다.

## 확인된 로컬 결과

| 검사               | 결과       | 범위                                                                        |
| ------------------ | ---------- | --------------------------------------------------------------------------- |
| 단위 테스트 전체   | 158개 통과 | 설정 이관·저장·오류, 단축키 검증·키 상태, 기존 데이터 계약                  |
| 후속 단축키 테스트 | 18개 통과  | 기존 14개와 새 Ctrl+Pause·Ctrl+Scroll Lock 거부 4개. 위 전체 검사 이후 실행 |
| Electron UI 전체   | 24개 통과  | 합성 프레임·Electron 생성 입력으로 화면과 저장 흐름 검사                    |

단위 테스트는 유효한 v1/v2 원문 백업과 v3 이관, 기존 프로필·옵션 보존, 저장 실패 시 기존 설정 유지와 재시도를 확인했습니다. mock native 테스트는 정확한 modifier 비교, 반복 입력 억제, 누른 도중 설정·modifier가 바뀌어도 ROI 키 해제를 처리하는 동작, 입력 전달과 훅 종료를 검사했습니다.

새 UI 테스트 3개는 다음 흐름을 포함합니다.

- 명시적 저장 전에는 기존 키 유지, 저장 후 캡처 F9·ROI Ctrl+Shift+F8 적용, 이전 키와 불완전한 조합 무시, 재시작 후 유지, 기본값 복원 후 저장
- 중복·문자 단독 조합 거부, 다른 설정 저장·탭 전환 중 단축키 초안 유지, 변경 취소
- 저장 대기 중 중복 쓰기 차단, IPC 저장 실패 후 초안·기존 키·파일 보존

로컬 UI 검사는 macOS에서 수행했으며 Windows 백그라운드 훅이나 물리 키보드의 증거가 아닙니다.

## Windows native 검사

**15개 phase 모두 통과했습니다.** [CI 실행 35704847115](https://github.com/blahaj94/dfragon-cropper/actions/runs/35704847115)은 커밋 `900266d`를 Windows Server 2022 (`10.0.20348`), Electron `44.4.3`에서 검사했습니다. 보고서의 `passed`는 `true`이며, 기준선·기본 단축키·단축키 변경 후 세 PrintScreen 검사에서 모두 클립보드 sequence 변경과 bitmap을 확인했습니다.

같은 실행에서 최종 단위 테스트는 **159개 통과·3개 플랫폼 제외**, Electron UI는 **23개 통과·1개 플랫폼 제외**였습니다. lint·format·typecheck와 Windows x64 portable 빌드도 통과했습니다.

[`shortcut-bindings-probe.cjs`](../spike/windows-capture/shortcut-bindings-probe.cjs)는 별도 프로세스를 foreground로 유지하고, 빌드된 listener를 background에서 실행합니다. 실제 Win32 훅에 `SendInput`으로 합성 키를 보내 다음 15개 phase를 검사합니다.

| Phase | 확인하려는 계약                                                                                            |
| ----- | ---------------------------------------------------------------------------------------------------------- |
| 1–3   | 훅 없는 PrintScreen 기준선, 기본 PrintScreen의 백그라운드 감지·키 전달·클립보드 bitmap 갱신, F12 반복 억제 |
| 4–6   | 변경 후 이전 PrintScreen·F12 전달, Windows PrintScreen 동작 유지, 새 F9 캡처의 반복 억제와 입력 전달       |
| 7–10  | 추가·누락된 modifier 거부, 정확한 Ctrl+Shift+F8의 ROI 요청과 반복 키 소비                                  |
| 11–12 | ROI 키를 누른 채 modifier를 떼거나 binding을 바꿔도 해당 키 쌍 소비 유지                                   |
| 13–15 | 뗀 이전 ROI 키 전달, 훅 재설치 없이 새 F7 적용, 종료 후 이전 캡처·선택 키 모두 전달                        |

각 phase는 foreground PID와 별도 관측 훅의 후속 확인 키까지 검사합니다. 이 fixture의 캡처 결과는 listener 콜백 횟수이며, 실제 앱의 PNG 저장이나 픽셀 일치를 새로 검증하는 검사는 아닙니다.

Windows CI의 합성 입력 결과는 **Windows 10 물리 키보드·전체화면 ROI·DPI·커서 제외의 새 실기 검증을 의미하지 않습니다.** 해당 Windows 10 실기는 이번 작업에서 수행하지 않았습니다. 이전 픽셀·PrintScreen 근거는 [Windows spike 결과](../spike/windows-capture/results.md)에 당시 범위로 보존합니다.
