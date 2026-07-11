// MBS Radio web player backend / admin interface.
//
// Integration via:
//   - Icecast: HTTP API (now-playing metadata, stream proxy for direct access)
//   - Liquidsoap: flag files on the shared /recordings volume, 
//       .recording-disabled   create/delete, liquidsoap enables/disables auto recording
//       .live-status.json     liquidsoap writes who is connected to primary/guest
//       .metadata.json        display titles + hidden flags per recording
//       incoming/             liquidsoap writes in-progress recordings here

const express = require("express");
const cookieParser = require("cookie-parser");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const PORT = parseInt(process.env.PORT || "8010", 10);
const REC_DIR = process.env.RECORDINGS_DIR || "/recordings";
const ICECAST_URL = process.env.ICECAST_URL || "http://icecast:8000";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const RECORD_BITRATE = 192000; // must match %mp3(bitrate=192) in radio.liq

if (!ADMIN_PASSWORD) {
  console.error("ADMIN_PASSWORD is not set — refusing to start.");
  process.exit(1);
}

const INCOMING_DIR = path.join(REC_DIR, "incoming");
const DISABLE_FLAG = path.join(REC_DIR, ".recording-disabled");
const LIVE_STATUS_FILE = path.join(REC_DIR, ".live-status.json");
const META_FILE = path.join(REC_DIR, ".metadata.json");
const SHOWS_FILE = path.join(REC_DIR, ".shows.json"); // admin-curated upcoming show schedule
const LIVE_NOW_FILE = path.join(REC_DIR, ".live-now.json"); // manually toggled "Live Now" card

const COOKIE_NAME = "mbs_admin";
const SESSION_MS = 14 * 24 * 3600 * 1000;

const app = express();
app.set("trust proxy", true);
app.use(express.json());
app.use(cookieParser(crypto.createHash("sha256").update("mbs-radio-session|" + ADMIN_PASSWORD).digest("hex")));

// ---------- helpers ----------

const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.mp3$/;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
const readMeta = () => readJson(META_FILE, {});

async function writeJsonAtomic(file, data) {
  await fsp.writeFile(file + ".tmp", JSON.stringify(data, null, 2));
  await fsp.rename(file + ".tmp", file);
}

// show_2026-07-06_20-15-00.mp3 -> Date, else null
function dateFromName(name) {
  const m = name.match(/(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/);
  return m && new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

async function listRecordings({ includeHidden }) {
  const names = (await fsp.readdir(REC_DIR).catch(() => [])).filter((n) => FILE_RE.test(n));
  const meta = readMeta();
  const out = [];
  for (const name of names) {
    const st = await fsp.stat(path.join(REC_DIR, name)).catch(() => null);
    if (!st || !st.isFile()) continue;
    const m = meta[name] || {};
    if (m.hidden && !includeHidden) continue;
    out.push({
      id: name,
      title: m.title || "",
      hidden: !!m.hidden,
      date: (dateFromName(name) || st.mtime).toISOString(),
      size: st.size,
      // recordings are CBR mp3, so duration follows from size
      duration: Math.round((st.size * 8) / RECORD_BITRATE),
      url: "/recordings/" + encodeURIComponent(name),
    });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
}

const byDate = (a, b) => (a.date > b.date ? 1 : -1);
const readShows = () => readJson(SHOWS_FILE, []).sort(byDate);

function readLiveNow() {
  const l = readJson(LIVE_NOW_FILE, {});
  return { active: !!l.active, name: String(l.name || ""), description: String(l.description || "") };
}

// manage.html converts datetime-local input to ISO in the browser, so the
// admin's timezone wins, not the container's. Returns ISO string or null.
function parseShowDate(v) {
  const d = new Date(v || "");
  return isNaN(d) ? null : d.toISOString();
}

function liveStatus() {
  const s = readJson(LIVE_STATUS_FILE, {});
  return { primary: !!s.primary, guest: !!s.guest };
}

const pauseState = () => ({ paused: fs.existsSync(DISABLE_FLAG) });

const inProgressFiles = () =>
  fsp.readdir(INCOMING_DIR).then((ns) => ns.filter((n) => FILE_RE.test(n)), () => []);

// Icecast status API: global stats + the mounted sources (one per stream).
async function icecastStats() {
  const r = await fetch(ICECAST_URL + "/status-json.xsl", { signal: AbortSignal.timeout(4000) });
  const stats = (await r.json()).icestats || {};
  return { stats, sources: [stats.source || []].flat() };
}

function nowPlayingOf(sources) {
  const src = sources.find((s) => s.listenurl?.includes("/stream.mp3")) || sources[0];
  return ((src && (src.title || src.yp_currently_playing || src.artist)) || "").trim();
}

// ---------- auth ----------
function requireAdmin(req, res, next) {
  if (+req.signedCookies[COOKIE_NAME] > Date.now()) return next();
  res.status(401).json({ error: "not logged in" });
}

const sha = (s) => crypto.createHash("sha256").update(s).digest();

app.post("/api/login", (req, res) => {
  const given = String((req.body && req.body.password) || "");
  if (!crypto.timingSafeEqual(sha(given), sha(ADMIN_PASSWORD)))
    return res.status(403).json({ error: "wrong password" });
  res.cookie(COOKIE_NAME, String(Date.now() + SESSION_MS), {
    signed: true, httpOnly: true, sameSite: "lax", maxAge: SESSION_MS, secure: req.secure,
  });
  res.json({ ok: true });
});

app.post("/api/logout", (_req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

// ---------- public API ----------

app.get("/api/recordings", async (_req, res) => {
  res.json({ recordings: await listRecordings({ includeHidden: false }) });
});

// Live/now-playing status for the player page.
app.get("/api/status", async (_req, res) => {
  const live = liveStatus();
  let nowPlaying = "";
  try { nowPlaying = nowPlayingOf((await icecastStats()).sources); } catch {}
  res.json({ live, anyLive: live.primary || live.guest, nowPlaying, recordingPaused: pauseState().paused });
});

// Upcoming live shows; keep a show listed until 3h after its start time
// so an in-progress broadcast doesn't vanish from the page.
app.get("/api/shows", (_req, res) => {
  const cutoff = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
  const ln = readLiveNow();
  res.json({
    shows: readShows().filter((s) => s.date > cutoff),
    liveNow: ln.active ? { name: ln.name, description: ln.description } : null,
  });
});

// /api/nowplaying.txt is a simple text version of the above
app.get("/api/nowplaying.txt", async (_req, res) => {
  let nowPlaying = "";
  try { nowPlaying = nowPlayingOf((await icecastStats()).sources); } catch {}
  res.type("text/plain").send(nowPlaying);
});

// Serve recording files (with range so seeking works).
app.get("/recordings/:id", (req, res) => {
  const id = req.params.id;
  if (!FILE_RE.test(id)) return res.status(400).send("bad name");
  const file = path.join(REC_DIR, id);
  if (!fs.existsSync(file)) return res.status(404).send("not found");
  if ("download" in req.query) {
    const meta = readMeta()[id] || {};
    const nice = (meta.title || id.replace(/\.mp3$/, "")).replace(/[^\w \-.]+/g, "_") + ".mp3";
    return res.download(file, nice);
  }
  res.sendFile(file);
});


// ---------- admin API ----------

app.get("/api/admin/state", requireAdmin, async (_req, res) => {
  // Listener stats for the Status card; null when icecast is unreachable.
  let icecast = null;
  try {
    const { stats, sources } = await icecastStats();
    icecast = {
      serverId: stats.server_id || "",
      serverStart: stats.server_start_iso8601 || null,
      mounts: sources.map((s) => ({
        mount: (s.listenurl || "").split("/").pop() || "?",
        listeners: s.listeners || 0,
        peak: s.listener_peak || 0,
        bitrate: s.bitrate || s["ice-bitrate"] || null,
        type: s.server_type || "",
      })),
    };
  } catch {}
  res.json({
    live: liveStatus(),
    pause: pauseState(),
    icecast,
    inProgress: await inProgressFiles(),
    recordings: await listRecordings({ includeHidden: true }),
    shows: readShows(),
    liveNow: readLiveNow(),
  });
});

app.put("/api/admin/live-now", requireAdmin, async (req, res) => {
  const cur = readLiveNow();
  if (typeof req.body.active === "boolean") cur.active = req.body.active;
  if (typeof req.body.name === "string") cur.name = req.body.name.trim().slice(0, 200);
  if (typeof req.body.description === "string") cur.description = req.body.description.trim().slice(0, 1000);
  await writeJsonAtomic(LIVE_NOW_FILE, cur);
  res.json({ liveNow: cur });
});

app.post("/api/admin/shows", requireAdmin, async (req, res) => {
  const name = String(req.body?.name || "").trim().slice(0, 200);
  const date = parseShowDate(req.body?.date);
  if (!name || !date) return res.status(400).json({ error: "name and a valid date are required" });
  const show = {
    id: crypto.randomUUID(),
    name,
    description: String(req.body?.description || "").trim().slice(0, 1000),
    date,
  };
  await writeJsonAtomic(SHOWS_FILE, [...readShows(), show]);
  res.json({ show });
});

app.patch("/api/admin/shows/:id", requireAdmin, async (req, res) => {
  const shows = readShows();
  const show = shows.find((s) => s.id === req.params.id);
  if (!show) return res.status(404).json({ error: "not found" });
  if (typeof req.body.name === "string") show.name = req.body.name.trim().slice(0, 200);
  if (typeof req.body.description === "string") show.description = req.body.description.trim().slice(0, 1000);
  if (req.body.date !== undefined) show.date = parseShowDate(req.body.date);
  if (!show.name || !show.date) return res.status(400).json({ error: "name and a valid date are required" });
  await writeJsonAtomic(SHOWS_FILE, shows);
  res.json({ show });
});

app.delete("/api/admin/shows/:id", requireAdmin, async (req, res) => {
  await writeJsonAtomic(SHOWS_FILE, readShows().filter((s) => s.id !== req.params.id));
  res.json({ ok: true });
});

app.post("/api/admin/pause", requireAdmin, async (req, res) => {
  if (req.body && req.body.paused) await fsp.writeFile(DISABLE_FLAG, "");
  else await fsp.rm(DISABLE_FLAG, { force: true });
  res.json({ pause: pauseState() });
});

app.patch("/api/admin/recordings/:id", requireAdmin, async (req, res) => {
  const id = req.params.id;
  if (!FILE_RE.test(id) || !fs.existsSync(path.join(REC_DIR, id))) return res.status(404).json({ error: "not found" });
  const meta = readMeta();
  const entry = meta[id] || {};
  if (typeof req.body.title === "string") entry.title = req.body.title.trim().slice(0, 200);
  if (typeof req.body.hidden === "boolean") entry.hidden = req.body.hidden;
  meta[id] = entry;
  await writeJsonAtomic(META_FILE, meta);
  res.json({ ok: true });
});

app.delete("/api/admin/recordings/:id", requireAdmin, async (req, res) => {
  const id = req.params.id;
  if (!FILE_RE.test(id)) return res.status(400).json({ error: "bad name" });
  await fsp.rm(path.join(REC_DIR, id), { force: true });
  const meta = readMeta();
  delete meta[id];
  await writeJsonAtomic(META_FILE, meta);
  res.json({ ok: true });
});

// ---------- pages ----------

app.get("/manage", (_req, res) => res.sendFile(path.join(__dirname, "public", "manage.html")));
app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => console.log(`MBS Radio webapp on :${PORT}, recordings in ${REC_DIR}`));
