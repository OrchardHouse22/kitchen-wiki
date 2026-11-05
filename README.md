# 부엌 위키

유튜브 링크, 인스타 캡션, 캡쳐본을 넣으면 Gemini가 재료와 조리 순서로 정리해 주는 개인용 레시피 앱(PWA)입니다.

- 인분 조절: 재료와 조리 순서 속 분량이 함께 바뀝니다.
- 요리 모드: 한 단계씩 크게 보여주고, 시간이 있는 단계엔 타이머가 붙습니다. 화면이 꺼지지 않습니다.
- 레시피는 휴대폰(브라우저)에 저장됩니다. 설정 → 백업 파일 받기로 백업하세요.

## 배포 (Vercel)
1. vercel.com에서 GitHub로 로그인 → Add New → Project → 이 저장소 Import
2. Environment Variables에 추가
   - `GEMINI_API_KEY`: Google AI Studio에서 받은 키
   - `APP_PASSWORD`: 아무 비밀번호 (앱 설정 화면에 같은 값 입력)
   - (선택) `GEMINI_MODEL`: 기본값 `gemini-2.5-flash`
3. Deploy → 나온 주소를 휴대폰에서 열고 "홈 화면에 추가"

## 구조
- `index.html`, `style.css`, `app.js`: 앱 화면
- `api/extract.js`: Gemini 호출 서버 함수 (API 키는 여기서만 사용)
- `manifest.webmanifest`, `sw.js`, `icons/`: 홈 화면 설치·오프라인용
