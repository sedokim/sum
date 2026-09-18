const BLOCKED_STATE = /비운|결항|통제|취소/;
const NORMAL_STATE = /정상|운항|출항|완료/;

export function ferryAvailability(record, date) {
  if (!record) return status("unknown", "정보 확인", "해당 섬의 운항정보가 없습니다.", false);
  if (record.ferryRequired === false) return status("road", "육로·도보", "여객선 없이 접근할 수 있습니다.", true);
  const trips = dateTrips(record.forecast, date);
  if (!trips.length) return status("unknown", "선사 확인", "선택 날짜의 운항예보가 없습니다.", false);
  const blocked = trips.filter((trip) => BLOCKED_STATE.test(trip.state || "")).length;
  const normal = trips.filter((trip) => NORMAL_STATE.test(trip.state || "") && !BLOCKED_STATE.test(trip.state || "")).length;
  if (blocked === trips.length) return status("blocked", "통제·비운", "현재 수집된 관련 항로가 모두 통제 또는 비운으로 표시됩니다.", false);
  if (blocked && normal) return status("partial", "일부 운항", "정상과 통제·비운 정보가 함께 있어 이용할 항로를 확인해야 합니다.", true);
  if (normal) return status("normal", "운항정보 있음", "정상 운항예보가 있습니다. 승선 전 선사 확인이 필요합니다.", true);
  return status("unknown", "선사 확인", "운항 상태를 확정할 수 없습니다.", false);
}

export function suggestFerryTimes(record, date) {
  if (!record || record.ferryRequired === false) return { inbound: "", outbound: "", source: "none", exact: false };
  const schedules = dateTrips(record.schedule, date).filter((trip) => trip.relation === "endpoint" && validTime(trip.time));
  const inbound = schedules.filter((trip) => matchesStop(trip.destination, trip.targetStop) && !matchesStop(trip.origin, trip.targetStop));
  const outbound = schedules.filter((trip) => matchesStop(trip.origin, trip.targetStop) && !matchesStop(trip.destination, trip.targetStop));
  return {
    inbound: earliest(inbound.map((trip) => trip.time)),
    outbound: latest(outbound.map((trip) => trip.time)),
    source: inbound.length || outbound.length ? "schedule" : "none",
    exact: false
  };
}

export function recommendationScore(island, companion = "all", walking = "all") {
  let score = 0;
  const audiences = Array.isArray(island.audiences) ? island.audiences : [];
  if (companion !== "all") score += audiences.includes(companion) ? 30 : -20;
  if (walking !== "all") score += island.difficultyLevel === walking ? 24 : -10;
  score += Math.min((island.facilities || []).length * 3, 12);
  score += (island.relatedItems || []).some((item) => item.contentTypeId === "25") ? 6 : 0;
  return score;
}

function dateTrips(items, date) {
  return Array.isArray(items) ? items.filter((item) => String(item.date || "") === String(date || "")) : [];
}

function status(level, label, description, potentiallyAvailable) {
  return { level, label, description, potentiallyAvailable };
}

function normalizeStop(value) {
  return String(value || "").replace(/\s+/g, "").replace(/\(.+\)$/, "");
}

function matchesStop(value, stop) {
  const left = normalizeStop(value);
  const right = normalizeStop(stop);
  return Boolean(left && right && (left === right || left.startsWith(right) || right.startsWith(left)));
}

function validTime(value) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));
}

function earliest(values) {
  return values.filter(validTime).sort()[0] || "";
}

function latest(values) {
  return values.filter(validTime).sort().at(-1) || "";
}
