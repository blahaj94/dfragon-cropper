# 문서 안내

[DFragonCropper 제품 소개로 돌아가기](../README.md)

| 문서                              | 내용                                             |
| --------------------------------- | ------------------------------------------------ |
| [사용 가이드](user-guide.md)      | 프로필·ROI 편집, 캡처 기록, 옵션과 트레이 사용   |
| [설정과 데이터](configuration.md) | 파일 위치, v2 설정, 이관·백업·오류와 수동 복구   |
| [개발 가이드](development.md)     | 개발 환경, 검사·빌드 명령, 소스 구조와 구현 계약 |

## 검증 기록

각 기록은 해당 버전과 검사 범위의 근거입니다. 합성 프레임·합성 키 입력과 실제 Windows 환경·물리 키 검증을 구분하며, 과거 통과 결과가 이후 변경까지 검증한 것으로 해석하지 않습니다.

| 기록                                                        | 내용                                                 |
| ----------------------------------------------------------- | ---------------------------------------------------- |
| [Windows capture spike](../spike/windows-capture/README.md) | 초기 구현 선택 이유와 Windows 실기 fixture 실행법    |
| [Windows spike 결과](../spike/windows-capture/results.md)   | native 캡처, DPI, cursor 제외와 PrintScreen 근거     |
| [Profile Editor 검증](profile-editor-verification.md)       | 숫자 ROI 편집과 설정 저장·복구 검사                  |
| [로컬 MVP 검증](local-mvp-verification.md)                  | 0.3.0 드래그 편집, 이력·옵션, 트레이와 portable 동작 |
