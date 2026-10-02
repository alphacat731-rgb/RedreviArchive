import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { URL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

loadDotEnv(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const X_BEARER_TOKEN = process.env.X_BEARER_TOKEN || "";
const X_API_BASE = "https://api.x.com/2";
const USERNAME = "redrevi_VRC";
const MAX_PAGES = Math.min(32, Math.max(1, Number(process.env.SYNC_MAX_PAGES || 32)));

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "archive.json");
const PUBLIC_DIR = path.join(__dirname, "public");

function loadDotEnv(file) {
  return fs.readFile(file, "utf8")
    .then(text => {
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        if (eq <= 0) continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = value;
      }
    })
    .catch(() => {});
}

// Run the tiny .env loader before using the token.
await loadDotEnv(path.join(__dirname, ".env"));
const bearerToken = process.env.X_BEARER_TOKEN || X_BEARER_TOKEN;

async function ensureStorage() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, JSON.stringify({
      profile: {
        id: "",
        username: USERNAME,
        name: "Redrevi",
        description: "",
        profile_image_url: "",
        verified: false,
        public_metrics: {}
      },
      posts: [],
      lastSync: null
    }, null, 2));
  }
}

async function readArchive() {
  await ensureStorage();
  const raw = await fs.readFile(DATA_FILE, "utf8");
  try {
    const parsed = JSON.parse(raw);
    parsed.posts ||= [];
    return parsed;
  } catch {
    return { profile: { username: USERNAME, name: "Redrevi" }, posts: [], lastSync: null };
  }
}

async function writeArchive(archive) {
  await fs.writeFile(DATA_FILE, JSON.stringify(archive, null, 2));
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function htmlOrStatic(res, file, contentType) {
  return fs.readFile(file)
    .then(buffer => {
      res.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": file.endsWith("index.html") ? "no-cache" : "public, max-age=3600"
      });
      res.end(buffer);
    })
    .catch(() => json(res, 404, { error: "Not found" }));
}

async function xRequest(endpoint) {
  if (!bearerToken) {
    const err = new Error("X_BEARER_TOKEN is not configured on the server.");
    err.code = "NO_X_TOKEN";
    throw err;
  }

  const response = await fetch(X_API_BASE + endpoint, {
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      Accept: "application/json"
    }
  });

  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    const err = new Error(body?.detail || body?.title || `X API request failed (${response.status})`);
    err.status = response.status;
    err.body = body;
    throw err;
  }

  return body;
}

function chooseVideoVariant(media) {
  const variants = Array.isArray(media?.variants) ? media.variants : [];
  const mp4 = variants
    .filter(v => v?.content_type === "video/mp4" && v?.url)
    .sort((a, b) => Number(b.bit_rate || 0) - Number(a.bit_rate || 0));
  return mp4[0]?.url || null;
}

function normaliseMedia(media) {
  if (!media?.media_key) return null;
  const kind = media.type === "photo" ? "image" : (media.type === "video" || media.type === "animated_gif" ? "video" : media.type);
  return {
    key: media.media_key,
    type: kind,
    xType: media.type,
    url: media.url || media.preview_image_url || "",
    previewUrl: media.preview_image_url || media.url || "",
    width: media.width || null,
    height: media.height || null,
    durationMs: media.duration_ms || null,
    variants: Array.isArray(media.variants) ? media.variants : [],
    downloadUrl: kind === "video" ? chooseVideoVariant(media) : null,
    altText: media.alt_text || ""
  };
}

function normalisePost(post, includes) {
  const mediaMap = new Map((includes?.media || []).map(m => [m.media_key, m]));
  const mediaKeys = post?.attachments?.media_keys || [];
  const media = mediaKeys.map(key => normaliseMedia(mediaMap.get(key))).filter(Boolean);

  return {
    id: post.id,
    text: post.text || "",
    createdAt: post.created_at || null,
    conversationId: post.conversation_id || null,
    publicMetrics: post.public_metrics || {},
    authorId: post.author_id || null,
    media,
    entities: post.entities || {},
    raw: {
      replySettings: post.reply_settings || null
    }
  };
}

async function fetchUser() {
  const endpoint = `/users/by/username/${encodeURIComponent(USERNAME)}?user.fields=id,name,username,description,profile_image_url,verified,public_metrics`;
  const body = await xRequest(endpoint);
  if (!body?.data?.id) throw new Error("The X account could not be found.");
  return body.data;
}

async function syncArchive() {
  const user = await fetchUser();
  const existing = await readArchive();
  const newestId = existing.posts
    .map(p => p.id)
    .filter(Boolean)
    .sort()
    .at(-1);

  let paginationToken = "";
  const fetched = new Map();
  let pages = 0;

  do {
    const params = new URLSearchParams({
      max_results: "100",
      "tweet.fields": "created_at,public_metrics,attachments,conversation_id,author_id,entities,reply_settings",
      expansions: "attachments.media_keys,author_id",
      "media.fields": "type,url,preview_image_url,width,height,duration_ms,variants,alt_text",
      exclude: "retweets,replies"
    });

    if (newestId) params.set("since_id", newestId);
    if (paginationToken) params.set("pagination_token", paginationToken);

    const body = await xRequest(`/users/${user.id}/tweets?${params.toString()}`);
    for (const post of body?.data || []) {
      fetched.set(post.id, normalisePost(post, body.includes));
    }

    paginationToken = body?.meta?.next_token || "";
    pages += 1;

    // Incremental sync only needs the first page. Initial sync can walk the full timeline.
    if (newestId) break;
  } while (paginationToken && pages < MAX_PAGES);

  const merged = new Map(existing.posts.map(p => [p.id, p]));
  for (const [id, post] of fetched) merged.set(id, post);

  const posts = [...merged.values()]
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

  existing.profile = {
    id: user.id,
    username: user.username || USERNAME,
    name: user.name || "Redrevi",
    description: user.description || "",
    profile_image_url: user.profile_image_url || "",
    verified: Boolean(user.verified),
    public_metrics: user.public_metrics || {}
  };
  existing.posts = posts.slice(0, 3200);
  existing.lastSync = new Date().toISOString();

  await writeArchive(existing);

  return {
    profile: existing.profile,
    fetched: fetched.size,
    total: existing.posts.length,
    lastSync: existing.lastSync,
    pages
  };
}

async function handleDownload(res, postId, mediaKey) {
  const archive = await readArchive();
  const post = archive.posts.find(p => p.id === postId);
  const media = post?.media?.find(m => m.key === mediaKey);
  const downloadUrl = media?.downloadUrl;

  if (!downloadUrl) {
    return json(res, 404, { error: "No downloadable video variant is available for this media item." });
  }

  const upstream = await fetch(downloadUrl, {
    headers: { "User-Agent": "RedreviArchive/0.1" }
  });

  if (!upstream.ok || !upstream.body) {
    return json(res, upstream.status || 502, { error: "The media server did not return the video." });
  }

  const contentType = upstream.headers.get("content-type") || "video/mp4";
  const filename = `redrevi-${postId}-${mediaKey}.mp4`;

  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store"
  });

  for await (const chunk of upstream.body) {
    res.write(chunk);
  }
  res.end();
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/health" && req.method === "GET") {
    return json(res, 200, {
      ok: true,
      xConfigured: Boolean(bearerToken),
      username: USERNAME,
      lastSync: (await readArchive()).lastSync
    });
  }

  if (url.pathname === "/api/posts" && req.method === "GET") {
    const archive = await readArchive();
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 50)));
    const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
    const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
    const mode = String(url.searchParams.get("mode") || "all");

    let posts = archive.posts;
    if (q) posts = posts.filter(p => p.text.toLowerCase().includes(q));
    if (mode === "media") posts = posts.filter(p => p.media?.length);
    if (mode === "videos") posts = posts.filter(p => p.media?.some(m => m.type === "video"));

    const stats = archive.posts.reduce((acc, post) => {
      for (const media of post.media || []) {
        if (media.type === "image") acc.images += 1;
        if (media.type === "video") acc.videos += 1;
      }
      return acc;
    }, { images: 0, videos: 0 });

    return json(res, 200, {
      profile: archive.profile,
      lastSync: archive.lastSync,
      stats,
      posts: posts.slice(offset, offset + limit),
      pagination: {
        offset,
        limit,
        total: posts.length,
        hasMore: offset + limit < posts.length
      }
    });
  }

  if (url.pathname === "/api/videos" && req.method === "GET") {
    const archive = await readArchive();
    const videos = [];
    for (const post of archive.posts) {
      for (const media of post.media || []) {
        if (media.type === "video") {
          videos.push({
            postId: post.id,
            postText: post.text,
            createdAt: post.createdAt,
            mediaKey: media.key,
            previewUrl: media.previewUrl,
            width: media.width,
            height: media.height,
            durationMs: media.durationMs,
            downloadAvailable: Boolean(media.downloadUrl),
            downloadEndpoint: `/api/download/${encodeURIComponent(post.id)}/${encodeURIComponent(media.key)}`
          });
        }
      }
    }
    return json(res, 200, { videos });
  }

  if (url.pathname === "/api/profile" && req.method === "GET") {
    const archive = await readArchive();
    return json(res, 200, { profile: archive.profile, lastSync: archive.lastSync });
  }

  if (url.pathname === "/api/sync" && req.method === "POST") {
    try {
      const result = await syncArchive();
      return json(res, 200, { ok: true, ...result });
    } catch (error) {
      const status = error.status === 401 || error.status === 403 ? 502 : 500;
      return json(res, status, {
        ok: false,
        error: error.code === "NO_X_TOKEN"
          ? "X_BEARER_TOKEN is not configured on the server."
          : error.message,
        xStatus: error.status || null,
        details: error.body || null
      });
    }
  }

  const match = url.pathname.match(/^\/api\/download\/([^/]+)\/([^/]+)$/);
  if (match && req.method === "GET") {
    try {
      return await handleDownload(res, decodeURIComponent(match[1]), decodeURIComponent(match[2]));
    } catch (error) {
      return json(res, 500, { error: error.message });
    }
  }

  return json(res, 404, { error: "API endpoint not found." });
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (url.pathname.startsWith("/api/")) {
    return handleApi(req, res, url);
  }

  if (url.pathname === "/" || url.pathname === "/index.html") {
    return htmlOrStatic(res, path.join(PUBLIC_DIR, "index.html"), "text/html; charset=utf-8");
  }

  const safePath = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
  const target = path.join(PUBLIC_DIR, safePath);
  if (!target.startsWith(PUBLIC_DIR)) return json(res, 403, { error: "Forbidden." });

  const ext = path.extname(target).toLowerCase();
  const types = {
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon"
  };

  return htmlOrStatic(res, target, types[ext] || "application/octet-stream");
}

await ensureStorage();

const server = http.createServer(handle);
server.listen(PORT, HOST, () => {
  console.log(`RedreviArchive listening on http://${HOST}:${PORT}`);
  console.log(`Dedicated account: @${USERNAME}`);
  console.log(`X API configured: ${Boolean(bearerToken)}`);
});
