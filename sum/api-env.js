import fs from "node:fs/promises";

export function parseApiEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) return [];
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    return value.trim() ? [[match[1], value.trim()]] : [];
  }));
}

export async function loadApiEnv({ directory = new URL("./", import.meta.url), environment = process.env } = {}) {
  const read = async (name) => {
    try { return parseApiEnv(await fs.readFile(new URL(name, directory), "utf8")); }
    catch (error) { if (error.code === "ENOENT") return {}; throw error; }
  };
  const legacy = await read(".env");
  // Treat the old TOUR_API_KEY as a shared key only for backwards compatibility.
  const shared = legacy.PUBLIC_DATA_SERVICE_KEY || legacy.SERVICE_KEY || legacy.TOUR_API_KEY;
  const settings = await read("API-설정.env");
  if (settings.PUBLIC_DATA_SERVICE_KEY && !settings.TOUR_API_KEY) delete legacy.TOUR_API_KEY;
  return { ...(shared ? { PUBLIC_DATA_SERVICE_KEY: shared } : {}), ...legacy, ...settings, ...Object.fromEntries(Object.entries(environment).filter(([, value]) => value?.trim())) };
}
