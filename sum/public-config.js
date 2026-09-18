export const publicConfig = Object.freeze({
  localApiPort: 4173,
  contentTypeLabels: Object.freeze({
    "12": "관광지", "14": "문화시설", "15": "축제", "25": "여행코스",
    "28": "레포츠", "32": "숙박", "38": "쇼핑", "39": "음식점"
  }),
  endpoints: Object.freeze({
    islands: "./api/islands",
    ferrySnapshot: "./data/ferry-api.json",
    weatherSnapshot: "./data/weather-api.json",
    mapPage: "./map.html"
  }),
  publicSites: Object.freeze({
    visitKoreaSearch: "https://korean.visitkorea.or.kr/search/search_list.do",
    yeosuShipInfo: "https://www.yeosu.go.kr/tour/information/trafficinfo/traffic/ship",
    ferryReservation: "https://island.theksa.co.kr/page/booking?lang="
  }),
  apiSources: Object.freeze([
    Object.freeze({ label: "한국관광공사 TourAPI", url: "https://www.data.go.kr/data/15101578/openapi.do", status: "사용 중" }),
    Object.freeze({ label: "여객선 운항 스케줄", url: "https://www.data.go.kr/data/15142302/openapi.do", status: "사용 중" }),
    Object.freeze({ label: "여객선 운항 상태", url: "https://www.data.go.kr/data/15142304/openapi.do", status: "사용 중" }),
    Object.freeze({ label: "여객선 운항 예보", url: "https://www.data.go.kr/data/15144520/openapi.do", status: "사용 중" }),
    Object.freeze({ label: "기상청 단기예보", url: "https://www.data.go.kr/data/15084084/openapi.do", status: "사용 중" })
  ]),
  map: Object.freeze({ sdkUrl: "https://dapi.kakao.com/v2/maps/sdk.js" })
});
