import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DEFAULT_DIRECTORY = fileURLToPath(new URL("./data/", import.meta.url));
// Only non-TourAPI snapshots are read. No SQLite, users or sessions.
export function createSnapshotReader(directory = DEFAULT_DIRECTORY) {
  return async (kind) => {
    if (!["ferry", "weather"].includes(kind)) return null;
    try {
      const payload = JSON.parse(await fs.readFile(path.join(directory, `${kind}-api.json`), "utf8"));
      return payload && typeof payload.islands === "object" ? payload : null;
    } catch { return null; }
  };
}
