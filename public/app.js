const state = {
  view: "home",
  posts: [],
  total: 0,
  offset: 0,
  limit: 50,
  query: "",
  profile: null,
  videos: [],
  saved: new Set(JSON.parse(localStorage.getItem("redrevi-saved") || "[]"))
};

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

function formatDate(value) {
  if (!value) return "Unknown date";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit"
  }).format(new Date(value));
}

function compactNumber(value) {
  const n = Number(value || 0);
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

function relativeDate(value) {
  if (!value) return "—";
  const ms = Date.now() - new Date(value).getTime();
  const mins = Math.max(0, Math.floor(ms / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(value);
}

function toast(message) {
  const node = $("toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(window.__toast);
  window.__toast = setTimeout(() => node.classList.remove("show"), 2200);
}

function setSync(status, message) {
  const pill = $("syncPill");
  pill.className = `sync-pill ${status}`;
  $("syncStatus").textContent = message;
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `Request failed (${response.status})`);
  }
  return body;
}

function postCard(post) {
  const profileImage = state.profile?.profile_image_url || "/icon.svg";
  const media = (post.media || []).map(m => {
    const isVideo = m.type === "video";
    return `
      <div class="media-tile">
        <img src="${escapeHtml(m.previewUrl || m.url)}" alt="${escapeHtml(m.altText || "Archived media")}" loading="lazy">
        <div class="media-overlay">
          <span class="media-label">${isVideo ? "VIDEO" : "IMAGE"}</span>
          ${isVideo
            ? `<button class="download-button" data-download="${escapeHtml(m.key)}" data-post="${escapeHtml(post.id)}" ${m.downloadUrl ? "" : "disabled"}>${m.downloadUrl ? "Download" : "Unavailable"}</button>`
            : ""}
        </div>
      </div>
    `;
  }).join("");

  const metrics = post.publicMetrics || {};
  const saved = state.saved.has(post.id);

  return `
    <article class="post-card">
      <div class="post-top">
        <img class="avatar avatar-lg" src="${escapeHtml(profileImage)}" alt="" loading="lazy">
        <div class="post-body">
          <div class="post-author-row">
            <div class="post-author">
              <strong>${escapeHtml(state.profile?.name || "Redrevi")}</strong>
              <span>@redrevi_VRC</span>
            </div>
            <span class="post-date" title="${escapeHtml(formatDate(post.createdAt))}">${escapeHtml(relativeDate(post.createdAt))}</span>
          </div>
          <div class="post-text">${escapeHtml(post.text)}</div>
          ${media ? `<div class="media-grid">${media}</div>` : ""}
          <div class="post-footer">
            <div class="metrics">
              <span>♡ ${compactNumber(metrics.like_count)}</span>
              <span>↻ ${compactNumber(metrics.retweet_count)}</span>
              <span>💬 ${compactNumber(metrics.reply_count)}</span>
              <span>◉ ${compactNumber(metrics.impression_count)}</span>
            </div>
            <div class="post-actions">
              <button class="small-button ${saved ? "saved" : ""}" data-save="${escapeHtml(post.id)}">${saved ? "★ Saved" : "☆ Save"}</button>
            </div>
          </div>
        </div>
      </div>
    </article>
  `;
}

function renderFeed(posts, containerId = "feed") {
  const container = $(containerId);
  if (!posts.length) {
    container.innerHTML = `<div class="empty">No archived posts match this view yet.</div>`;
    return;
  }
  container.innerHTML = posts.map(postCard).join("");
}

function renderGallery(posts) {
  const media = [];
  for (const post of posts) for (const item of post.media || []) {
    media.push({ ...item, post });
  }

  $("gallery").innerHTML = media.length ? media.map(item => `
    <div class="gallery-card">
      <img src="${escapeHtml(item.previewUrl || item.url)}" alt="${escapeHtml(item.altText || "Archived media")}" loading="lazy">
      <div class="gallery-meta">
        <strong>${item.type === "video" ? "Video" : "Image"} · ${escapeHtml(relativeDate(item.post.createdAt))}</strong>
        <span>${escapeHtml(item.post.text.slice(0, 90) || "Media-only post")}</span>
      </div>
    </div>
  `).join("") : `<div class="empty" style="grid-column:1/-1">No media has been archived yet.</div>`;
}

function renderVideos() {
  $("downloads").innerHTML = state.videos.length ? state.videos.map(video => `
    <div class="download-row">
      <img class="download-thumb" src="${escapeHtml(video.previewUrl || "/icon.svg")}" alt="" loading="lazy">
      <div class="download-copy">
        <strong>${escapeHtml(video.postText || "Video post")}</strong>
        <span>${escapeHtml(formatDate(video.createdAt))}</span>
        <div class="download-meta">
          <span class="tag">${video.width || "?"}×${video.height || "?"}</span>
          <span class="tag">${video.durationMs ? Math.round(video.durationMs / 1000) + "s" : "duration unknown"}</span>
          <span class="tag">${video.downloadAvailable ? "download ready" : "no variant"}</span>
        </div>
      </div>
      <a class="download-action" href="${video.downloadAvailable ? escapeHtml(video.downloadEndpoint) : "#"}" ${video.downloadAvailable ? 'download' : 'aria-disabled="true"'}>${video.downloadAvailable ? "Download" : "Unavailable"}</a>
    </div>
  `).join("") : `<div class="empty">No videos are archived yet.</div>`;
}

function updateProfile(profile, lastSync) {
  state.profile = profile || state.profile;
  const p = state.profile || {};
  const avatar = p.profile_image_url || "/icon.svg";
  $("heroAvatar").src = avatar;
  $("topAvatar").style.backgroundImage = `url("${avatar}")`;
  $("topAvatar").style.backgroundSize = "cover";
  $("topAvatar").style.backgroundPosition = "center";
  $("heroName").textContent = p.name || "Redrevi";
  $("heroDescription").textContent = p.description || "Dedicated archive feed. No external X UI.";
  $("sidebarProfile").innerHTML = `
    <img class="avatar avatar-lg" src="${escapeHtml(avatar)}" alt="">
    <div class="profile-mini-copy">
      <strong>@redrevi_VRC</strong>
      <span>${escapeHtml(lastSync ? "Synced " + relativeDate(lastSync) : "Not synced yet")}</span>
    </div>
    <span class="verified-dot">${p.verified ? "✓" : "•"}</span>
  `;
}

function updateStats(posts, total, lastSync) {
  let images = 0;
  let videos = 0;
  for (const post of posts) {
    for (const media of post.media || []) {
      if (media.type === "image") images++;
      if (media.type === "video") videos++;
    }
  }
  $("postCount").textContent = compactNumber(total);
  $("imageCount").textContent = compactNumber(images);
  $("videoCount").textContent = compactNumber(videos);
  $("archiveSize").textContent = `${compactNumber(total)} posts`;
  $("lastSyncText").textContent = lastSync ? relativeDate(lastSync) : "—";
}

async function loadPosts(reset = true) {
  if (reset) {
    state.offset = 0;
    state.posts = [];
  }
  const params = new URLSearchParams({
    limit: String(state.limit),
    offset: String(state.offset),
    q: state.query
  });
  const data = await api(`/api/posts?${params.toString()}`);
  state.profile = data.profile;
  state.total = data.pagination.total;
  state.posts = reset ? data.posts : state.posts.concat(data.posts);
  state.offset += data.posts.length;

  updateProfile(data.profile, data.lastSync);
  updateStats(state.posts, state.total, data.lastSync);
  renderFeed(state.posts);
  $("loadMoreButton").hidden = !data.pagination.hasMore;
  $("clearSearchButton").hidden = !state.query;
  return data;
}

async function loadAllViews() {
  const data = await loadPosts(true);
  const mediaData = await api("/api/posts?limit=100&offset=0&mode=media");
  renderGallery(mediaData.posts);

  const videos = await api("/api/videos");
  state.videos = videos.videos;
  renderVideos();

  return data;
}

async function healthCheck() {
  const health = await api("/api/health");
  $("apiState").textContent = health.xConfigured ? "Configured" : "Not configured";
  setSync(health.xConfigured ? "ok" : "error", health.xConfigured ? "Server connected" : "X API token missing");
  if (health.lastSync) $("lastSyncText").textContent = relativeDate(health.lastSync);
  return health;
}

async function sync() {
  setSync("busy", "Syncing from X…");
  $("refreshButton").disabled = true;
  try {
    const result = await api("/api/sync", { method: "POST" });
    setSync("ok", `Synced ${result.fetched} new`);
    toast(`Sync complete · ${result.fetched} new posts`);
    await loadAllViews();
  } catch (error) {
    setSync("error", "Sync failed");
    toast(error.message);
    console.error(error);
  } finally {
    $("refreshButton").disabled = false;
  }
}

function saveState() {
  localStorage.setItem("redrevi-saved", JSON.stringify([...state.saved]));
}

function toggleSave(id) {
  if (state.saved.has(id)) state.saved.delete(id);
  else state.saved.add(id);
  saveState();
  renderFeed(state.posts);
  renderSaved();
  toast(state.saved.has(id) ? "Post saved locally" : "Post removed from saved");
}

function renderSaved() {
  const savedPosts = state.posts.filter(p => state.saved.has(p.id));
  renderFeed(savedPosts, "savedFeed");
}

function switchView(view) {
  state.view = view;
  const names = {
    home: "Home",
    media: "Media Gallery",
    videos: "Video Downloads",
    saved: "Saved Posts",
    settings: "Settings"
  };
  $("pageTitle").textContent = names[view] || "Home";
  document.querySelectorAll(".nav-item").forEach(btn => btn.classList.toggle("active", btn.dataset.view === view));
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  $(`view${view[0].toUpperCase() + view.slice(1)}`).classList.remove("hidden");

  if (view === "saved") renderSaved();
}

document.addEventListener("click", async (event) => {
  const saveButton = event.target.closest("[data-save]");
  if (saveButton) toggleSave(saveButton.dataset.save);

  const downloadButton = event.target.closest("[data-download]");
  if (downloadButton) {
    const href = `/api/download/${encodeURIComponent(downloadButton.dataset.post)}/${encodeURIComponent(downloadButton.dataset.download)}`;
    window.location.href = href;
  }

  const navButton = event.target.closest("[data-view]");
  if (navButton) switchView(navButton.dataset.view);
});

$("refreshButton").addEventListener("click", sync);
$("settingsButton").addEventListener("click", () => switchView("settings"));
$("loadMoreButton").addEventListener("click", () => loadPosts(false));
$("clearSavedButton").addEventListener("click", () => {
  state.saved.clear();
  saveState();
  renderSaved();
  toast("Saved posts cleared");
});
$("clearSearchButton").addEventListener("click", () => {
  $("searchInput").value = "";
  state.query = "";
  loadPosts(true).catch(err => toast(err.message));
});

let searchTimer;
$("searchInput").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.query = $("searchInput").value.trim();
    loadPosts(true).catch(err => toast(err.message));
  }, 280);
});

async function boot() {
  try {
    await healthCheck();
    await loadAllViews();
  } catch (error) {
    $("feed").innerHTML = `<div class="error-box"><strong>Archive unavailable.</strong><br><br>${escapeHtml(error.message)}</div>`;
    setSync("error", "Server unavailable");
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

boot();
