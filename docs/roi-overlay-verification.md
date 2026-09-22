# 0.4.0 ROI 선택창 검증

[문서 목록](README.md)

0.4.0은 앱 안의 드래그 미리보기를 F12 전체화면 선택창으로 교체합니다. 창을 띄우기 전에 주 모니터를 한 번 캡처하고, 그 정지 이미지로 선택과 확대경을 표시합니다. 실제 캡처 PNG의 처리 방식은 유지합니다.

## 자동 검사 범위

로컬 macOS의 실제 Electron과 합성 프레임으로 UI를 검사합니다. 이 검사는 실제 Windows 데스크톱 캡처나 Windows 배율을 재현한 것이 아닙니다.

로컬 단위 테스트 98개가 통과했습니다. UI 테스트 15개도 전체 실행과 수정 후 해당 사례 재실행을 합쳐 모두 통과했습니다. 확대경은 화면에 표시된 합성 원본의 픽셀 RGBA 값까지 정확히 비교했습니다.

- `tests/unit/printscreen.test.ts`: Koffi를 대체한 단위 테스트로 PrintScreen 전달, F12만 처리하는 선택 콜백, 각각의 키 반복 억제와 종료 정리를 확인합니다. native hook 실기 증거는 아닙니다.
- `tests/unit/roi-selection.test.ts`: 전체화면 선택 결과의 필드·정수·원본 프레임 경계를 검증합니다.
- `tests/ui/roi-redraw.spec.ts`: 별도 선택창, 원본 좌표, 확대경의 실제 표시 픽셀, Esc 취소, 변경 초안, 기존 ROI ID 유지, PNG 행 바이트 일치, 제한된 preload API, 잘못된 좌표 거부와 선택 중 앱 종료를 검사합니다.
- `tests/ui/history-preview.spec.ts`: 큰 합성 PNG의 맞춤·100% 보기, 스크롤과 지연된 이전 이미지 응답을 검사합니다.
- 기존 설정·백업·오류·이미지 저장 테스트도 유지합니다. 이전 앱 내부의 스크롤 드래그 UI 검사는 새 선택창 흐름으로 교체했으며 좌표 변환 함수의 단위 테스트는 유지합니다.

F12 UI 검사는 Electron의 `webContents.sendInputEvent`로 입력합니다. 이 환경의 Playwright CDP 키 입력은 Electron의 `before-input-event`를 통과하지 않는 것을 확인했습니다. 어느 입력도 물리 키보드나 백그라운드 Windows hook 검증으로 표현하지 않습니다.

확대경의 화면 픽셀 검사는 `tests/ui/native-cursor.ts`로 실제 커서 위치와 자동 입력 위치를 맞추고, 화면에 반영된 프레임을 확인한 뒤 비교합니다. 검사 후 커서는 원래 위치로 복원합니다. 이는 합성 이미지의 표시 검사이며 실제 데스크톱 캡처·커서 제외·Windows 배율 검증은 아닙니다.

## Windows 10 실기 상태

**새 F12 선택창의 실제 Windows 10 검증은 미완료**입니다. 이 버전의 변경을 실제 Windows 10 데스크톱에서 실행하지 못했습니다. GitHub Windows runner의 빌드와 합성 UI 검사도 이를 대체하지 않습니다.

후속 실기 확인 범위는 다음과 같습니다.

1. 다른 프로그램에 포커스를 둔 상태와 트레이 상태에서 F12를 눌러 주 모니터 전체에 테두리 없는 선택창이 열리는지 확인합니다.
2. 배율 100%·150%에서 화면 가장자리까지 선택할 수 있는지, 원본 물리 좌표와 PNG crop이 맞는지 확인합니다. 확대경의 중심 픽셀과 표시 좌표도 함께 확인합니다.
3. 새 창·확대경·OS 커서가 원본 캡처에 들어가지 않는지, Esc와 포커스 이탈·종료 뒤 창이 남지 않는지 확인합니다.
4. F12 감지를 추가한 native listener에서 PrintScreen의 백그라운드 저장과 Windows 기본 키 전달이 유지되는지 확인합니다.

기존 Windows 10의 캡처·커서·물리 키·DPI 근거는 [spike 결과](../spike/windows-capture/results.md)와 [0.3.0 검증 기록](local-mvp-verification.md)에 있습니다. 그 결과가 새 선택창과 변경된 키 감지까지 검증한 것은 아닙니다.

`spike/windows-capture/portable-smoke.cjs`는 0.3.0의 내장 미리보기 UI와 preload 메서드를 사용하는 당시 fixture입니다. 0.4.0 선택창의 통과 판정에 그대로 사용하지 않습니다.
