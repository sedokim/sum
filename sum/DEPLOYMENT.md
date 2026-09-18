# 섬으로 공개 배포 체크리스트

공모전 기능심사에는 휴대전화에서 접속 가능한 공개 URL이 필요합니다. Live Server의 `5500` 주소는 같은 네트워크에서 확인하는 개발용 주소이며 상용 런칭 주소가 아닙니다.

## 필수 실행 환경

- 실행 명령: `npm start`
- Node.js: 24 이상
- 환경 변수: `TOUR_API_KEY` 또는 `PUBLIC_DATA_SERVICE_KEY`
- 선택 환경 변수: `PORT`(호스팅 서비스가 자동 지정), `HOST=0.0.0.0`
- 상태 확인: `/api/health`

## Docker로 배포

저장소 루트의 `Dockerfile`을 그대로 빌드할 수 있습니다. 호스팅 서비스에는 `TOUR_API_KEY`(또는 `PUBLIC_DATA_SERVICE_KEY`)를 비밀 환경 변수로 등록하고, 서비스 포트는 플랫폼이 주는 `PORT`를 사용합니다. 카카오 지도 키는 브라우저용 키이므로 배포 도메인을 카카오 Developers에 반드시 등록합니다.

`/api/health`의 `snapshots.fresh`가 `true`이면 한국 시간 오늘 기준 배편·날씨 스냅샷입니다. `false`여도 마지막 저장 데이터는 제공되지만, 기능심사 전에는 원인을 확인해야 합니다.

정적 파일만 올리는 호스팅은 사용할 수 없습니다. TourAPI 인증키를 브라우저에 노출하지 않도록 `server.js`가 함께 실행되는 Node.js 호스팅을 사용해야 합니다.

## 공개 전 확인

회원가입·로그인·SQLite는 사용하지 않습니다. 배편·날씨 JSON은 data 폴더에 생성하므로 서버에 쓰기 권한이 필요합니다. 재배포 직후 기준일을 확인하고 필요하면 npm run refresh를 실행하세요. 관광공사 데이터는 항상 실시간 호출합니다.

제출 시 로그인 방식은 ‘로그인 불필요’로 선택합니다. DB 서버나 심사용 로그인 계정은 필요하지 않습니다.

1. 배포 도메인을 카카오 Developers의 JavaScript 키 사이트 도메인에 등록합니다.
2. 휴대전화 LTE/5G에서 공개 URL을 열어 섬 목록, 지도, 날씨, 배편을 확인합니다.
3. `/api/health`가 `ok: true`를 반환하는지 확인합니다.
4. `/.env`, `/apikey`, `/server.js`가 모두 404인지 확인합니다.
5. 공공누리 제3유형 사진이 잘리거나 확대되지 않는지 확인합니다.
6. 관광공사 API 장애 때 오류·재시도 안내가 나오고, 배편·날씨 장애 때 마지막 데이터의 날짜가 표시되는지 확인합니다.
7. `/data/islands-api.json`이 404이고 `/api/health`의 `tourDelivery`가 `live-api`인지 확인합니다.
8. `/service-info.html`의 개인정보·출처 안내와 실제 호스팅 로그 보관 정책을 확인합니다.
9. `npm run submission:check -- https://공개주소`로 기술 점검합니다. 로컬 주소만으로는 제출 준비 완료가 아닙니다.

## 키 관리

로컬의 `API-설정.env`와 `.env`, `kakao-map-config.js`에 입력한 값은 이번 수정에서 변경하지 않았습니다. `API-설정.env`는 Git/Docker 업로드 제외 대상입니다. 호스팅의 비밀 환경변수에 `PUBLIC_DATA_SERVICE_KEY` 또는 개별 `TOUR_API_KEY`, `FERRY_SCHEDULE_API_KEY`, `FERRY_STATUS_API_KEY`, `FERRY_FORECAST_API_KEY`, `WEATHER_API_KEY`를 등록하세요. 새 호스팅에는 로컬 비밀키가 자동 전달되지 않습니다.

2026-09-18 로컬 점검에서 카카오 SDK가 `domain mismatched`(HTTP 401)를 반환했습니다. 카카오 개발자 콘솔에서 현재 확인할 주소 `http://localhost:4173`와 실제 공개 HTTPS 도메인을 등록해야 합니다. 코드로 등록을 우회하거나 지도가 정상인 것처럼 표시하지 않습니다. 실제 등록 여부 및 공개 도메인 접속은 배포 후 다시 검증하세요.

Dockerfile의 설정 로더 누락을 수정하고 관광정보 과거 JSON의 이미지 포함을 제외했습니다. 현재 환경에 Docker 실행 도구가 없어 실제 이미지 빌드는 검증하지 못했으며, 로컬 모듈 의존성 포함 여부는 자동 테스트로 검사합니다.

`.env`는 로컬 개발 전용입니다. 배포 서비스의 환경 변수 설정 화면에 키를 등록하고, 저장소나 브라우저용 JavaScript 파일에는 넣지 않습니다. 키가 외부에 노출되었다면 공공데이터포털에서 재발급합니다.
