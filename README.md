# 섬섬여수 데이터 아일랜드

여수 섬 관광지를 한국관광공사 TourAPI와 Kakao Maps로 추천하는 HTML 기반 웹앱입니다.
공모전 제출을 염두에 두고 **한국관광공사 API 사용을 필수 조건**으로 만들었습니다.

## 실행 방법

1. 한국관광공사 TourAPI 서비스키를 준비합니다.
2. PowerShell에서 이 폴더로 이동합니다.
3. 서비스키를 환경변수로 넣습니다.

```powershell
$env:KTO_SERVICE_KEY="발급받은_서비스키"
python server.py
```

4. 브라우저에서 아래 주소를 엽니다.

```text
http://127.0.0.1:4173/
```

TourAPI 키가 없으면 앱은 추천 데이터를 표시하지 않고 설정 안내를 보여줍니다.
이 동작은 공모전 제출 조건에 맞춰 TourAPI 사용을 우회하지 않기 위한 의도입니다.

## API 사용 구조

프론트엔드는 정적 샘플 데이터를 직접 사용하지 않습니다.

```text
index.html
  -> GET /api/islands
  -> server.py
  -> 한국관광공사 KorService2 TourAPI 호출
  -> TourAPI 결과 + 여수 섬 추천 메타데이터 결합
  -> Kakao 지도와 추천 카드 렌더링
```

서버에서 사용하는 TourAPI 기능:

- `searchKeyword2`: 섬 이름/키워드 기반 관광 콘텐츠 검색
- `detailCommon2`: 주소, 좌표, 개요, 대표 이미지 보강
- `detailImage2`: 추가 관광 이미지 확보
- `areaBasedList2`: 원천 API 확인용 프록시 엔드포인트

로컬 API:

```text
GET /api/status
GET /api/islands
GET /api/recommend?interest=trekking&duration=day
GET /api/tourapi/areaBasedList2
```

## Kakao 지도

Kakao Maps JavaScript API 키는 `config.js`에 반영되어 있습니다.
Kakao Developers의 Web 플랫폼 도메인에 아래 주소를 등록해야 지도가 정상 표시됩니다.

```text
http://127.0.0.1:4173
http://localhost:4173
```

JavaScript 키는 브라우저에서 노출되는 키입니다.
실제 배포 시에는 반드시 도메인 제한을 걸어주세요.

## 주요 기능

- TourAPI 연결 상태 표시
- Kakao 지도 마커와 정보창
- 섬별 관광 이미지, 설명, 위치 데이터 보강
- 취향, 일정, 난이도, 계절, 검색어 필터
- 추천 점수 기반 정렬
- 섬별 당일/1박 코스 생성
- 카카오맵 큰 지도/길찾기 링크

## 공모전 설명 포인트

- 여수 섬 여행의 실제 문제인 배편, 거리, 난이도, 체류 시간을 추천 기준으로 사용합니다.
- TourAPI 원천 관광 콘텐츠를 단순 목록이 아니라 여행 의사결정 데이터로 재가공합니다.
- 지도 기반 UI로 섬의 위치와 이동 부담을 즉시 파악하게 합니다.
- 서버에서 API 키를 보호하고, 프론트는 정리된 추천 데이터만 받는 구조입니다.
