/**
 * 섬으로 외부 API 중앙 설정
 *
 * 사용법
 * 1. 공공데이터포털에서 각 API의 활용신청을 합니다.
 * 2. 발급받은 일반 인증키(Decoding)를 환경변수에 저장합니다.
 *    PUBLIC_DATA_SERVICE_KEY=...
 * 3. 아래 buildApiUrl()로 호출 URL을 만듭니다.
 *
 * 비밀키를 이 파일에 직접 입력하거나 Git에 커밋하지 마세요.
 * 지도는 카카오맵 JavaScript SDK만 사용하며 키는 kakao-map-config.js에서 설정합니다.
 */

const PUBLIC_DATA_KEY_NAMES = Object.freeze([
  "PUBLIC_DATA_SERVICE_KEY",
  "SERVICE_KEY",
  "TOUR_API_KEY"
]);

export const apiConfig = Object.freeze({
  server: Object.freeze({
    port: 4173,
    cacheSeconds: 300,
    requestTimeoutMs: 8_000
  }),

  providers: Object.freeze({
    tourApi: provider({
      label: "한국관광공사 국문 관광정보 서비스",
      baseUrl: "https://apis.data.go.kr/B551011/KorService2",
      docsUrl: "https://www.data.go.kr/data/15101578/openapi.do",
      envKeys: ["TOUR_API_KEY", ...PUBLIC_DATA_KEY_NAMES],
      endpoints: {
        areaCode: "/areaCode2",
        categoryCode: "/categoryCode2",
        areaBased: "/areaBasedList2",
        locationBased: "/locationBasedList2",
        keywordSearch: "/searchKeyword2",
        festivals: "/searchFestival2",
        stays: "/searchStay2",
        detailCommon: "/detailCommon2",
        detailIntro: "/detailIntro2",
        detailInfo: "/detailInfo2",
        detailImages: "/detailImage2"
      },
      defaultParams: {
        MobileOS: "ETC",
        MobileApp: "Seomuro",
        _type: "json",
        numOfRows: "20",
        pageNo: "1",
        arrange: "Q",
        areaCode: "38",
        sigunguCode: "13"
      }
    }),

    ferrySchedule: provider({
      label: "한국해양교통안전공단 운항 스케줄 정보",
      baseUrl: "https://apis.data.go.kr/B554035/oprt-schd-info-v2",
      docsUrl: "https://www.data.go.kr/data/15142302/openapi.do",
      envKeys: ["FERRY_SCHEDULE_API_KEY", ...PUBLIC_DATA_KEY_NAMES],
      endpoints: {
        schedules: "/get-oprt-schd-info-v2"
      },
      defaultParams: {
        pageNo: "1",
        numOfRows: "1000",
        dataType: "JSON"
      }
    }),

    ferryStatus: provider({
      label: "한국해양교통안전공단 여객선 운항상태 정보",
      baseUrl: "https://apis.data.go.kr/B554035/ferry-route-info-v4",
      docsUrl: "https://www.data.go.kr/data/15142304/openapi.do",
      envKeys: ["FERRY_STATUS_API_KEY", ...PUBLIC_DATA_KEY_NAMES],
      endpoints: {
        statuses: "/get-ferry-route-info-v4"
      },
      defaultParams: {
        pageNo: "1",
        numOfRows: "1000",
        dataType: "JSON"
      }
    }),

    ferryForecast: provider({
      label: "한국해양교통안전공단 내일의 운항예보(상세)",
      baseUrl: "https://apis.data.go.kr/B554035/tmr-forecastnew",
      docsUrl: "https://www.data.go.kr/data/15144520/openapi.do",
      envKeys: ["FERRY_FORECAST_API_KEY", ...PUBLIC_DATA_KEY_NAMES],
      endpoints: {
        tomorrow: "/get_tmr_forecastnew"
      },
      defaultParams: {
        pageNo: "1",
        numOfRows: "1000"
      }
    }),

    weatherForecast: provider({
      label: "기상청 단기예보 조회서비스(JSON/XML)",
      baseUrl: "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0",
      docsUrl: "https://www.data.go.kr/data/15084084/openapi.do",
      envKeys: ["WEATHER_API_KEY", ...PUBLIC_DATA_KEY_NAMES],
      endpoints: {
        ultraShortNow: "/getUltraSrtNcst",
        ultraShortForecast: "/getUltraSrtFcst",
        villageForecast: "/getVilageFcst",
        forecastVersion: "/getFcstVersion"
      },
      defaultParams: {
        dataType: "JSON",
        numOfRows: "1000",
        pageNo: "1"
      }
    })
  }),

  islands: Object.freeze({
    geumodo: island("금오도", ["금오도", "함구미", "비렁길"], ["함구미", "여천", "우학", "송고"], { lat: 34.522593, lon: 127.749484 }),
    geomundo: island("거문도", ["거문도", "백도"], ["거문"], { lat: 34.027490, lon: 127.308948 }),
    sado: island("사도", ["사도"], ["사도"], { lat: 34.592734, lon: 127.555632 }),
    nangdo: island("낭도", ["낭도"], ["낭도"], { lat: 34.629301, lon: 127.511513 }),
    gaedo: island("개도", ["개도", "사람길"], ["개도(화산)", "개도", "여석"], { lat: 34.617500, lon: 127.635800 }),
    odongdo: island("오동도", ["오동도"], [], { lat: 34.744401, lon: 127.767810 }, false),
    dolsando: island("돌산도", ["돌산도", "향일암"], [], { lat: 34.593822, lon: 127.803024 }, false),
    jangdo: island("장도", ["장도", "예울마루"], [], { lat: 34.728200, lon: 127.671700 }, false),
    hahwado: island("하화도", ["하화도", "꽃섬길"], ["하화"], { lat: 34.594618, lon: 127.619293 }),
    yeojado: island("여자도", ["여자도", "붕장어다리"], ["여자"], { lat: 34.755600, lon: 127.507900 }),
    sonjukdo: island("손죽도", ["손죽도", "손죽해수욕장"], ["손죽"], { lat: 34.290278, lon: 127.361248 })
  }),

  contentTypeLabels: Object.freeze({
    "12": "관광지",
    "14": "문화시설",
    "15": "축제",
    "25": "여행코스",
    "28": "레포츠",
    "32": "숙박",
    "38": "쇼핑",
    "39": "음식점"
  }),

  publicSites: Object.freeze({
    visitKoreaSearch: "https://korean.visitkorea.or.kr/search/search_list.do",
    ferryBooking: "https://island.theksa.co.kr/page/booking?lang=",
    yeosuShipInfo: "https://www.yeosu.go.kr/tour/information/trafficinfo/traffic/ship",
    marineWeather: "https://www.weather.go.kr/w/ocean/today.do",
    geumodoFerry: "https://www.geumodoferry.com/"
  }),

  localData: Object.freeze({
    islandSnapshot: "./data/islands-api.json",
    ferrySnapshot: "./data/ferry-api.json",
    weatherSnapshot: "./data/weather-api.json",
    mapPage: "./map.html"
  }),

  map: Object.freeze({
    library: "Kakao Maps JavaScript SDK",
    sdkUrl: "https://dapi.kakao.com/v2/maps/sdk.js",
    configFile: "./kakao-map-config.js",
    requiredKeyType: "JavaScript 키"
  })
});

/**
 * provider와 endpoint 이름으로 인증키가 포함된 URL을 생성합니다.
 * 환경변수에는 Decoding 인증키를 저장하세요. URLSearchParams가 안전하게 인코딩합니다.
 */
export function buildApiUrl(providerName, endpointName, params = {}, env = globalThis.process?.env || {}) {
  const selected = apiConfig.providers[providerName];
  if (!selected) throw new Error(`알 수 없는 API provider: ${providerName}`);

  const endpoint = selected.endpoints[endpointName];
  if (endpoint === undefined) {
    throw new Error(`알 수 없는 endpoint: ${providerName}.${endpointName}`);
  }

  const serviceKey = findServiceKey(selected.envKeys, env);
  if (!serviceKey) {
    throw new Error(`${selected.label} 인증키가 없습니다. 환경변수 ${selected.envKeys.join(" 또는 ")} 중 하나를 설정하세요.`);
  }

  const url = new URL(`${selected.baseUrl}${endpoint}`);
  const allParams = { ...selected.defaultParams, ...params };
  url.searchParams.set(selected.authParam, decodeServiceKey(serviceKey));

  for (const [name, value] of Object.entries(allParams)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(name, String(value));
    }
  }
  return url;
}

export function findServiceKey(envKeys, env = globalThis.process?.env || {}) {
  for (const name of envKeys) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return "";
}

function decodeServiceKey(value) {
  if (!value.includes("%")) return value;
  try { return decodeURIComponent(value); }
  catch { return value; }
}

function provider({
  label,
  baseUrl,
  docsUrl,
  envKeys,
  endpoints,
  defaultParams = { _type: "json", numOfRows: "50", pageNo: "1" },
  authParam = "serviceKey"
}) {
  return Object.freeze({
    label,
    baseUrl,
    docsUrl,
    envKeys: Object.freeze([...envKeys]),
    endpoints: Object.freeze({ ...endpoints }),
    defaultParams: Object.freeze({ ...defaultParams }),
    authParam
  });
}

function island(keyword, aliases, ferryStops, location, ferryRequired = true) {
  return Object.freeze({
    keyword,
    aliases: Object.freeze([...aliases]),
    ferryStops: Object.freeze([...ferryStops]),
    location: Object.freeze({ ...location }),
    ferryRequired
  });
}
