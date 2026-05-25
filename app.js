const VIDEO_EXTENSIONS = ["mp4", "webm", "ogg", "ogv", "mov", "m4v", "mkv"];
const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];
const AUTO_LIBRARY_CANDIDATES = ["videos.php", "videos/videos.php", "video.php", "videos/video.php"];
const MANIFEST_CANDIDATES = ["videos/videos.json", "videos.json"];
const MEDIABUNNY_CDN_URL = "https://esm.sh/mediabunny@1.13.0?bundle";
const THUMBNAIL_TARGET_WIDTH = 480;
const THUMBNAIL_CONCURRENCY = 3;
const THUMBNAIL_CACHE_DB = "vp_thumb_cache_v1";
const THUMBNAIL_CACHE_STORE = "thumbs";
const PLACEHOLDER_POSTER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 360'><defs><linearGradient id='g' x1='0' x2='1'><stop stop-color='#182636' offset='0'/><stop stop-color='#20364e' offset='1'/></linearGradient></defs><rect width='640' height='360' fill='url(#g)'/><g fill='none' stroke='#4dd4ff' stroke-opacity='.4'><circle cx='540' cy='80' r='60'/><circle cx='120' cy='290' r='92'/></g><path d='M285 130v100l86-50-86-50z' fill='#e8f6ff' fill-opacity='.85'/></svg>`);

const state = {
  videos: [],
  filteredIndices: [],
  currentVideoIndex: -1,
  autoplayNext: true,
  theaterMode: false,
  settingsOpen: false,
  searchTerm: "",
  zoomEnabled: false,
  zoomScale: 1,
  zoomX: 0,
  zoomY: 0,
  isDraggingZoom: false,
  lastPointer: { x: 0, y: 0 },
  resumeMap: {},
  metadataHydrationRunning: false,
  librarySource: "Unknown",
  localObjectUrls: [],
  playbackEngineLabel: "Native",
};

const refs = {
  appShell: document.getElementById("appShell"),
  mainGrid: document.getElementById("mainGrid"),
  playerPanel: document.getElementById("playerPanel"),
  videoStage: document.getElementById("videoStage"),
  zoomLayer: document.getElementById("zoomLayer"),
  video: document.getElementById("video"),
  bigPlayBtn: document.getElementById("bigPlayBtn"),
  nowPlayingTitle: document.getElementById("nowPlayingTitle"),
  nowPlayingStats: document.getElementById("nowPlayingStats"),
  seekSlider: document.getElementById("seekSlider"),
  currentTimeLabel: document.getElementById("currentTimeLabel"),
  totalTimeLabel: document.getElementById("totalTimeLabel"),
  prevBtn: document.getElementById("prevBtn"),
  playPauseBtn: document.getElementById("playPauseBtn"),
  nextBtn: document.getElementById("nextBtn"),
  muteBtn: document.getElementById("muteBtn"),
  volumeSlider: document.getElementById("volumeSlider"),
  zoomToggleBtn: document.getElementById("zoomToggleBtn"),
  miniPlayerBtn: document.getElementById("miniPlayerBtn"),
  theaterBtn: document.getElementById("theaterBtn"),
  fullscreenBtn: document.getElementById("fullscreenBtn"),
  settingsBtn: document.getElementById("settingsBtn"),
  settingsPanel: document.getElementById("settingsPanel"),
  speedSelect: document.getElementById("speedSelect"),
  zoomSlider: document.getElementById("zoomSlider"),
  fitSelect: document.getElementById("fitSelect"),
  autoplayToggle: document.getElementById("autoplayToggle"),
  libraryList: document.getElementById("libraryList"),
  resultCount: document.getElementById("resultCount"),
  searchInput: document.getElementById("searchInput"),
  reloadLibraryBtn: document.getElementById("reloadLibraryBtn"),
  pickFolderBtn: document.getElementById("pickFolderBtn"),
  folderInput: document.getElementById("folderInput"),
  engineBadge: document.getElementById("engineBadge"),
  librarySourceBadge: document.getElementById("librarySourceBadge"),
  videoCardTemplate: document.getElementById("videoCardTemplate"),
};

let seekRAF = 0;
let lastResumeWrite = 0;
let libraryRenderTimer = 0;
const thumbnailInFlight = new Set();
const thumbnailDone = new Set();
const thumbnailQueued = new Set();
const thumbnailQueue = [];
let thumbnailWorkersActive = 0;
let mediabunnyModulePromise = null;
let thumbnailDbPromise = null;
const mediaBunnyDecodeCache = new Map();

bootstrap();

async function bootstrap() {
  bindEvents();
  hydratePreferences();
  refs.settingsBtn.setAttribute("aria-expanded", "false");
  updatePlaybackEngineBadge("Native");
  updateLibrarySourceBadge("Loading...");
  await loadLibrary();
}

function bindEvents() {
  refs.playPauseBtn.addEventListener("click", togglePlayback);
  refs.bigPlayBtn.addEventListener("click", togglePlayback);
  refs.prevBtn.addEventListener("click", playPrevious);
  refs.nextBtn.addEventListener("click", playNext);
  refs.muteBtn.addEventListener("click", toggleMute);
  refs.volumeSlider.addEventListener("input", onVolumeInput);
  refs.seekSlider.addEventListener("input", onSeekInput);
  refs.theaterBtn.addEventListener("click", toggleTheaterMode);
  refs.fullscreenBtn.addEventListener("click", toggleFullscreen);
  refs.settingsBtn.addEventListener("click", toggleSettingsPanel);
  refs.speedSelect.addEventListener("change", onSpeedChange);
  refs.zoomSlider.addEventListener("input", onZoomSliderInput);
  refs.zoomToggleBtn.addEventListener("click", toggleZoomMode);
  refs.fitSelect.addEventListener("change", onFitChange);
  refs.autoplayToggle.addEventListener("change", onAutoplayToggle);
  refs.miniPlayerBtn.addEventListener("click", toggleMiniPlayer);
  refs.searchInput.addEventListener("input", onSearchInput);
  refs.reloadLibraryBtn.addEventListener("click", loadLibrary);
  refs.pickFolderBtn.addEventListener("click", onPickFolderClick);
  refs.folderInput.addEventListener("change", onFolderInputChange);

  refs.video.addEventListener("play", onPlayStateChange);
  refs.video.addEventListener("pause", onPlayStateChange);
  refs.video.addEventListener("loadedmetadata", onLoadedMetadata);
  refs.video.addEventListener("timeupdate", scheduleSeekUpdate);
  refs.video.addEventListener("ended", onVideoEnded);
  refs.video.addEventListener("volumechange", onVolumeChange);
  refs.video.addEventListener("error", onVideoError);

  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("pointerdown", onDocumentPointerDown);
  document.addEventListener("fullscreenchange", onFullscreenChange);
  refs.videoStage.addEventListener("wheel", onZoomWheel, { passive: false });

  refs.zoomLayer.addEventListener("pointerdown", onZoomPointerDown);
  refs.zoomLayer.addEventListener("pointermove", onZoomPointerMove);
  refs.zoomLayer.addEventListener("pointerup", onZoomPointerUp);
  refs.zoomLayer.addEventListener("pointercancel", onZoomPointerUp);
  refs.zoomLayer.addEventListener("pointerleave", onZoomPointerUp);
}

function hydratePreferences() {
  try {
    state.resumeMap = JSON.parse(localStorage.getItem("vp_resume_map") || "{}");
  } catch {
    state.resumeMap = {};
  }

  state.theaterMode = localStorage.getItem("vp_theater_mode") === "1";
  state.autoplayNext = localStorage.getItem("vp_autoplay_next") !== "0";

  const savedVolume = Number(localStorage.getItem("vp_volume") || "1");
  refs.video.volume = Number.isFinite(savedVolume) ? clamp(savedVolume, 0, 1) : 1;
  refs.video.muted = localStorage.getItem("vp_muted") === "1";

  const savedSpeed = localStorage.getItem("vp_speed") || "1";
  refs.speedSelect.value = savedSpeed;
  refs.video.playbackRate = Number(savedSpeed) || 1;

  refs.autoplayToggle.checked = state.autoplayNext;
  refs.volumeSlider.value = String(refs.video.volume);
  refs.fitSelect.value = localStorage.getItem("vp_fit") || "contain";
  refs.video.style.objectFit = refs.fitSelect.value;

  if (state.theaterMode) {
    refs.appShell.classList.add("theater");
  }

  onVolumeChange();
}

async function loadLibrary() {
  setListStatus("Loading library...");
  cleanupLocalObjectUrls();
  thumbnailInFlight.clear();
  thumbnailDone.clear();
  thumbnailQueued.clear();
  thumbnailQueue.length = 0;
  thumbnailWorkersActive = 0;
  mediaBunnyDecodeCache.clear();

  let loadedFrom = "Unknown";
  let autoLibraryError = "";

  try {
    const autoResult = await fetchAutoLibrary();
    const autoDiscovered = autoResult.videos;
    state.videos = autoDiscovered.map(normalizeVideoItem).filter(Boolean);
    loadedFrom = "PHP auto-scan";
  } catch (error) {
    autoLibraryError = error?.message || "Unknown auto-scan error";
    try {
      const manifest = await fetchManifest();
      state.videos = manifest.map(normalizeVideoItem).filter(Boolean);
      loadedFrom = "JSON manifest";
    } catch {
      const fallbackVideos = await fetchDirectoryIndexFallback("videos/");
      state.videos = fallbackVideos.map(normalizeVideoItem).filter(Boolean);
      loadedFrom = "Directory listing";
    }
  }

  state.librarySource = loadedFrom;
  updateLibrarySourceBadge(
    loadedFrom,
    loadedFrom === "JSON manifest" || loadedFrom === "Directory listing" || loadedFrom === "Unknown"
  );
  if (autoLibraryError && loadedFrom !== "PHP auto-scan") {
    updateLibrarySourceBadge(`${loadedFrom} (PHP failed)`, true);
  }

  state.filteredIndices = state.videos.map((_, index) => index);
  renderLibrary();

  if (!state.videos.length) {
    setListStatus(
      "No videos found. Drop files into videos/ and enable videos.php on your host, or provide videos/videos.json."
    );
    if (loadedFrom === "JSON manifest") {
      setListStatus("Manifest loaded but empty. Add videos or use PHP auto-scan.");
    }
    if (loadedFrom === "Unknown" || window.location.protocol === "file:") {
      setListStatus("No source detected. Serve via HTTP/PHP, or click Open Folder.");
      updateLibrarySourceBadge("No source detected", true);
    }
    if (autoLibraryError) {
      setListStatus(`PHP auto-scan failed: ${autoLibraryError}. Fix videos.php or use Open Folder.`);
    }
    return;
  }

  const preferredIndex = pickStartVideoIndex();
  await loadVideoAtIndex(preferredIndex, { autoplay: false, resetPosition: false });
  hydrateVideoMetadataInBackground();
}

async function fetchAutoLibrary() {
  const params = new URLSearchParams(window.location.search);
  const apiOverride = params.get("libraryApi");
  const candidates = apiOverride ? [apiOverride] : AUTO_LIBRARY_CANDIDATES;
  const failures = [];

  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, { cache: "no-store" });
      if (!response.ok) {
        let detail = `${candidate} returned HTTP ${response.status}`;
        try {
          const text = await response.text();
          if (text) {
            detail += ` (${text.slice(0, 180).replace(/\s+/g, " ").trim()})`;
          }
        } catch {
          // no-op
        }
        failures.push(detail);
        continue;
      }
      const payload = await response.json();
      const videos = Array.isArray(payload) ? payload : payload.videos;
      if (!Array.isArray(videos)) {
        failures.push(`${candidate} returned invalid JSON shape`);
        continue;
      }
      return { videos, candidate };
    } catch (error) {
      failures.push(`${candidate} request failed: ${error?.message || "unknown error"}`);
    }
  }

  throw new Error(failures.length ? failures.join(" | ") : "auto library endpoint not found");
}

async function fetchManifest() {
  const params = new URLSearchParams(window.location.search);
  const manifestOverride = params.get("manifest");
  const candidates = manifestOverride ? [manifestOverride] : MANIFEST_CANDIDATES;

  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, { cache: "no-store" });
      if (!response.ok) {
        continue;
      }
      const data = await response.json();
      const videos = Array.isArray(data) ? data : data.videos;
      if (!Array.isArray(videos)) {
        throw new Error(`Invalid manifest shape in ${candidate}`);
      }
      if (isLikelySampleManifest(videos)) {
        throw new Error("Sample manifest skipped");
      }
      return videos;
    } catch {
      // keep trying candidates
    }
  }
  throw new Error("Manifest not found");
}

async function fetchDirectoryIndexFallback(baseDir) {
  const params = new URLSearchParams(window.location.search);
  const dir = params.get("dir") || baseDir;

  try {
    const response = await fetch(dir, { cache: "no-store" });
    if (!response.ok) {
      return [];
    }
    const html = await response.text();
    const hrefMatches = [...html.matchAll(/href=["']([^"']+)["']/gi)].map((match) => match[1]);

    const unique = new Set();
    const files = [];

    for (const href of hrefMatches) {
      const cleanedHref = href.split("?")[0].split("#")[0];
      const fileName = cleanedHref.split("/").pop() || "";
      const extension = fileName.split(".").pop()?.toLowerCase() || "";
      if (!VIDEO_EXTENSIONS.includes(extension)) {
        continue;
      }
      const source = new URL(cleanedHref, new URL(dir, window.location.href)).pathname;
      if (!unique.has(source)) {
        unique.add(source);
        files.push({ src: source, title: fileName.replace(/\.[^.]+$/, "") });
      }
    }

    return files;
  } catch {
    return [];
  }
}

function normalizeVideoItem(raw, index) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const sources = normalizeSources(raw);
  if (!sources.length) {
    return null;
  }

  const preferred = chooseBestSource(sources);
  const title = raw.title?.trim() || inferTitleFromPath(preferred.src);

  return {
    id: raw.id || `video-${index + 1}`,
    title,
    description: raw.description || "",
    poster: raw.poster || raw.thumbnail || "",
    duration: Number(raw.duration) || 0,
    sizeBytes: Number(raw.sizeBytes) || 0,
    resolution: raw.resolution || "",
    codec: raw.codec || preferred.label || guessCodecLabel(preferred.type),
    createdAt: raw.createdAt || "",
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    views: Number(raw.views) || 0,
    sources,
  };
}

function normalizeSources(raw) {
  if (Array.isArray(raw.sources)) {
    return raw.sources
      .map((source) => ({
        src: source.src || source.url,
        type: source.type || detectMimeFromPath(source.src || source.url || ""),
        label: source.label || "",
        file: source.file || null,
        sizeBytes: Number(source.sizeBytes) || 0,
        modifiedAt: source.modifiedAt || source.mtime || "",
      }))
      .filter((source) => typeof source.src === "string" && source.src.length > 0);
  }

  if (typeof raw.src === "string" && raw.src.length > 0) {
    return [
      {
        src: raw.src,
        type: raw.type || detectMimeFromPath(raw.src),
        label: raw.label || "",
        file: raw.file || null,
        sizeBytes: Number(raw.sizeBytes) || 0,
        modifiedAt: raw.modifiedAt || "",
      },
    ];
  }

  return [];
}

function chooseBestSource(sources) {
  const video = document.createElement("video");
  const ranked = sources
    .map((source) => {
      const mime = source.type || detectMimeFromPath(source.src);
      const supportScore = mime ? supportToScore(video.canPlayType(mime)) : 0;
      return {
        ...source,
        type: mime,
        score: supportScore,
      };
    })
    .sort((a, b) => b.score - a.score);

  return ranked[0] || sources[0];
}

function supportToScore(value) {
  if (value === "probably") {
    return 3;
  }
  if (value === "maybe") {
    return 2;
  }
  return 0;
}

function detectMimeFromPath(path) {
  const extension = (path.split(".").pop() || "").toLowerCase();
  switch (extension) {
    case "mp4":
    case "m4v":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "mov":
      return "video/quicktime";
    case "ogg":
    case "ogv":
      return "video/ogg";
    case "mkv":
      return "video/x-matroska";
    default:
      return "";
  }
}

function inferTitleFromPath(path) {
  const fileName = path.split("/").pop() || "Untitled";
  return fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
}

function guessCodecLabel(mime) {
  if (!mime) {
    return "Unknown codec";
  }
  if (mime.includes("mp4")) {
    return "MP4";
  }
  if (mime.includes("webm")) {
    return "WebM";
  }
  if (mime.includes("quicktime")) {
    return "QuickTime/MOV";
  }
  if (mime.includes("ogg")) {
    return "Ogg";
  }
  if (mime.includes("matroska")) {
    return "Matroska";
  }
  return mime;
}

function renderLibrary() {
  const term = state.searchTerm.toLowerCase();

  state.filteredIndices = state.videos
    .map((video, index) => ({ video, index }))
    .filter(({ video }) => {
      if (!term) {
        return true;
      }
      const haystack = [
        video.title,
        video.description,
        video.codec,
        video.resolution,
        ...video.tags,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    })
    .map(({ index }) => index);

  refs.resultCount.textContent = `${state.filteredIndices.length} video${state.filteredIndices.length === 1 ? "" : "s"}`;
  refs.libraryList.innerHTML = "";

  if (!state.filteredIndices.length) {
    setListStatus("No matching videos.");
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const index of state.filteredIndices) {
    const video = state.videos[index];
    const node = refs.videoCardTemplate.content.firstElementChild.cloneNode(true);
    const thumb = node.querySelector(".thumb");
    const duration = node.querySelector(".duration-pill");
    const title = node.querySelector(".card-title");
    const meta = node.querySelector(".card-meta");
    const codec = node.querySelector(".card-codec");

    if (video.poster) {
      thumb.src = video.poster;
    } else {
      thumb.src = PLACEHOLDER_POSTER;
      queueThumbnailGeneration(index);
    }
    thumb.alt = `${video.title} thumbnail`;
    thumb.onerror = () => {
      thumb.src = PLACEHOLDER_POSTER;
      if (!video.poster) {
        return;
      }
      video.poster = "";
      queueThumbnailGeneration(index);
    };

    duration.textContent = video.duration > 0 ? formatDuration(video.duration) : "--:--";
    title.textContent = video.title;

    const statBits = [];
    if (video.resolution) {
      statBits.push(video.resolution);
    }
    if (video.sizeBytes) {
      statBits.push(formatBytes(video.sizeBytes));
    }
    if (video.createdAt) {
      statBits.push(formatDate(video.createdAt));
    }

    meta.textContent = statBits.join(" | ") || "No metadata";
    codec.textContent = `${video.codec || "Unknown"}${video.tags.length ? ` | ${video.tags.join(", ")}` : ""}`;

    if (index === state.currentVideoIndex) {
      node.classList.add("active");
    }

    node.addEventListener("click", () => {
      loadVideoAtIndex(index, { autoplay: true, resetPosition: false }).catch(console.error);
    });

    fragment.appendChild(node);
  }

  refs.libraryList.appendChild(fragment);
}

function setListStatus(message) {
  refs.libraryList.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function queueThumbnailGeneration(index) {
  const videoMeta = state.videos[index];
  if (!videoMeta) {
    return;
  }

  const key = videoMeta.id || `index-${index}`;
  if (videoMeta.poster || thumbnailInFlight.has(key) || thumbnailDone.has(key) || thumbnailQueued.has(key)) {
    return;
  }

  thumbnailQueued.add(key);
  thumbnailQueue.push({ index, key });
  pumpThumbnailQueue();
}

function pumpThumbnailQueue() {
  while (thumbnailWorkersActive < THUMBNAIL_CONCURRENCY && thumbnailQueue.length > 0) {
    const job = thumbnailQueue.shift();
    if (!job) {
      return;
    }

    thumbnailWorkersActive += 1;
    runThumbnailJob(job)
      .catch(() => {
        // ignore thumbnail generation failures
      })
      .finally(() => {
        thumbnailWorkersActive -= 1;
        pumpThumbnailQueue();
      });
  }
}

async function runThumbnailJob(job) {
  const videoMeta = state.videos[job.index];
  if (!videoMeta) {
    thumbnailQueued.delete(job.key);
    thumbnailDone.add(job.key);
    return;
  }

  thumbnailQueued.delete(job.key);
  thumbnailInFlight.add(job.key);

  try {
    const cacheKey = buildThumbnailCacheKey(videoMeta);
    const cached = await getCachedThumbnail(cacheKey);
    if (cached) {
      videoMeta.poster = cached;
      scheduleLibraryRender();
      return;
    }

    const thumbnailDataUrl = await generateThumbnailForVideo(videoMeta);
    if (!thumbnailDataUrl) {
      return;
    }

    videoMeta.poster = thumbnailDataUrl;
    scheduleLibraryRender();
    await setCachedThumbnail(cacheKey, thumbnailDataUrl);
  } finally {
    thumbnailInFlight.delete(job.key);
    thumbnailDone.add(job.key);
  }
}

function buildThumbnailCacheKey(videoMeta) {
  const source = chooseBestSource(videoMeta.sources || []);
  const src = source?.src || videoMeta.id || "";
  const sourceSize = Number(source?.sizeBytes) || 0;
  const sourceModified = source?.modifiedAt || "";
  const size = Number(videoMeta.sizeBytes) || 0;
  const date = videoMeta.createdAt || "";
  return `${src}::${sourceSize}::${sourceModified}::${size}::${date}`;
}

function getThumbnailDb() {
  if (!("indexedDB" in window)) {
    return Promise.resolve(null);
  }

  if (!thumbnailDbPromise) {
    thumbnailDbPromise = new Promise((resolve, reject) => {
      const openReq = window.indexedDB.open(THUMBNAIL_CACHE_DB, 1);
      openReq.onupgradeneeded = () => {
        const db = openReq.result;
        if (!db.objectStoreNames.contains(THUMBNAIL_CACHE_STORE)) {
          db.createObjectStore(THUMBNAIL_CACHE_STORE);
        }
      };
      openReq.onsuccess = () => resolve(openReq.result);
      openReq.onerror = () => reject(openReq.error || new Error("IndexedDB open failed"));
    }).catch(() => null);
  }

  return thumbnailDbPromise;
}

async function getCachedThumbnail(cacheKey) {
  try {
    const db = await getThumbnailDb();
    if (!db) {
      return "";
    }

    return await new Promise((resolve) => {
      const tx = db.transaction(THUMBNAIL_CACHE_STORE, "readonly");
      const store = tx.objectStore(THUMBNAIL_CACHE_STORE);
      const req = store.get(cacheKey);
      req.onsuccess = () => resolve(typeof req.result === "string" ? req.result : "");
      req.onerror = () => resolve("");
    });
  } catch {
    return "";
  }
}

async function setCachedThumbnail(cacheKey, dataUrl) {
  try {
    const db = await getThumbnailDb();
    if (!db) {
      return;
    }

    await new Promise((resolve) => {
      const tx = db.transaction(THUMBNAIL_CACHE_STORE, "readwrite");
      const store = tx.objectStore(THUMBNAIL_CACHE_STORE);
      store.put(dataUrl, cacheKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    // ignore cache write failures
  }
}

async function generateThumbnailForVideo(videoMeta) {
  const source = chooseBestSource(videoMeta.sources || []);
  if (!source || !source.src) {
    return "";
  }

  try {
    const thumbnail = await extractFrameThumbnailWithMediaBunny(source);
    if (thumbnail) {
      return thumbnail;
    }
  } catch {
    // Fall back to native frame extraction.
  }

  return extractFrameThumbnail(source.src);
}

async function loadMediaBunnyModule() {
  if (!mediabunnyModulePromise) {
    mediabunnyModulePromise = import(MEDIABUNNY_CDN_URL).catch((error) => {
      mediabunnyModulePromise = null;
      throw error;
    });
  }
  return mediabunnyModulePromise;
}

function getMediaBunnySource(mediabunnyModule, source) {
  if (source.file instanceof Blob) {
    return new mediabunnyModule.BlobSource(source.file);
  }
  return new mediabunnyModule.UrlSource(source.src);
}

async function extractFrameThumbnailWithMediaBunny(source) {
  const mediabunny = await loadMediaBunnyModule();
  const input = new mediabunny.Input({
    formats: mediabunny.ALL_FORMATS,
    source: getMediaBunnySource(mediabunny, source),
  });

  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) {
      return "";
    }

    const decodable = await videoTrack.canDecode();
    if (!decodable) {
      return "";
    }

    const sink = new mediabunny.CanvasSink(videoTrack, {
      width: THUMBNAIL_TARGET_WIDTH,
      fit: "cover",
    });

    let duration = 0;
    try {
      duration = Number(await input.computeDuration()) || 0;
    } catch {
      duration = 0;
    }

    const timestamp = duration > 1.2 ? Math.min(1.2, Math.max(duration * 0.1, 0.05)) : 0;
    const wrappedCanvas = await sink.getCanvas(timestamp);
    if (!wrappedCanvas?.canvas) {
      return "";
    }

    return canvasToDataUrl(wrappedCanvas.canvas);
  } finally {
    if (typeof input.dispose === "function") {
      input.dispose();
    }
  }
}

function canvasToDataUrl(canvas) {
  if (canvas && typeof canvas.toDataURL === "function") {
    return canvas.toDataURL("image/jpeg", 0.82);
  }

  if (canvas && typeof canvas.convertToBlob === "function") {
    return canvas
      .convertToBlob({ type: "image/jpeg", quality: 0.82 })
      .then((blob) => blobToDataUrl(blob));
  }

  return "";
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read blob as data URL"));
    reader.readAsDataURL(blob);
  });
}

function extractFrameThumbnail(src) {
  return new Promise((resolve, reject) => {
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.muted = true;
    probe.playsInline = true;
    probe.crossOrigin = "anonymous";

    const timeout = window.setTimeout(() => cleanupAndReject(new Error("thumbnail timeout")), 12000);
    let settled = false;

    const cleanup = () => {
      window.clearTimeout(timeout);
      probe.removeAttribute("src");
      probe.load();
    };

    const cleanupAndResolve = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    };

    const cleanupAndReject = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    const capture = () => {
      const width = Number(probe.videoWidth) || 0;
      const height = Number(probe.videoHeight) || 0;
      if (!width || !height) {
        cleanupAndReject(new Error("invalid dimensions"));
        return;
      }

      const targetWidth = Math.min(width, THUMBNAIL_TARGET_WIDTH);
      const targetHeight = Math.max(1, Math.round((targetWidth / width) * height));
      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const context = canvas.getContext("2d");
      if (!context) {
        cleanupAndReject(new Error("canvas unavailable"));
        return;
      }

      context.drawImage(probe, 0, 0, targetWidth, targetHeight);
      cleanupAndResolve(canvas.toDataURL("image/jpeg", 0.82));
    };

    probe.addEventListener(
      "loadedmetadata",
      () => {
        const duration = Number.isFinite(probe.duration) ? probe.duration : 0;
        const captureTime = duration > 1.2 ? Math.min(1.2, Math.max(duration * 0.1, 0.05)) : 0;

        if (captureTime <= 0) {
          if (probe.readyState >= 2) {
            capture();
          } else {
            probe.addEventListener("loadeddata", capture, { once: true });
          }
          return;
        }

        probe.addEventListener("seeked", capture, { once: true });
        try {
          probe.currentTime = captureTime;
        } catch {
          probe.removeEventListener("seeked", capture);
          if (probe.readyState >= 2) {
            capture();
          } else {
            probe.addEventListener("loadeddata", capture, { once: true });
          }
        }
      },
      { once: true }
    );

    probe.addEventListener(
      "error",
      () => {
        cleanupAndReject(new Error("thumbnail decode error"));
      },
      { once: true }
    );

    probe.src = src;
  });
}

function updateLibrarySourceBadge(label, warn = false) {
  if (!refs.librarySourceBadge) {
    return;
  }
  refs.librarySourceBadge.textContent = `Source: ${label}`;
  refs.librarySourceBadge.classList.toggle("warn", Boolean(warn));
}

function updatePlaybackEngineBadge(label, warn = false) {
  if (!refs.engineBadge) {
    return;
  }
  state.playbackEngineLabel = label;
  refs.engineBadge.textContent = `Engine: ${label}`;
  refs.engineBadge.classList.toggle("warn", Boolean(warn));
}

async function detectPlaybackEngineForSource(source) {
  const cacheKey = `${source?.type || ""}|${source?.src || ""}`;
  if (mediaBunnyDecodeCache.has(cacheKey)) {
    return mediaBunnyDecodeCache.get(cacheKey);
  }

  try {
    const mediabunny = await loadMediaBunnyModule();
    const input = new mediabunny.Input({
      formats: mediabunny.ALL_FORMATS,
      source: getMediaBunnySource(mediabunny, source),
    });

    try {
      const videoTrack = await input.getPrimaryVideoTrack();
      const audioTrack = await input.getPrimaryAudioTrack();
      const videoOk = videoTrack ? await videoTrack.canDecode() : false;
      const audioOk = audioTrack ? await audioTrack.canDecode() : true;
      const label = videoOk && audioOk ? "MediaBunny active (native output)" : "Native fallback";
      mediaBunnyDecodeCache.set(cacheKey, label);
      return label;
    } finally {
      if (typeof input.dispose === "function") {
        input.dispose();
      }
    }
  } catch {
    mediaBunnyDecodeCache.set(cacheKey, "Native fallback");
    return "Native fallback";
  }
}

function cleanupLocalObjectUrls() {
  for (const url of state.localObjectUrls) {
    URL.revokeObjectURL(url);
  }
  state.localObjectUrls = [];
}

function trackLocalObjectUrl(url) {
  state.localObjectUrls.push(url);
  return url;
}

function isLikelySampleManifest(videos) {
  if (!Array.isArray(videos) || videos.length !== 1) {
    return false;
  }
  const first = videos[0];
  const id = String(first?.id || "").toLowerCase();
  const title = String(first?.title || "").toLowerCase();
  return id === "sample-1" || title === "sample showcase";
}

async function onPickFolderClick() {
  if (window.showDirectoryPicker && window.isSecureContext) {
    try {
      const handle = await window.showDirectoryPicker({ mode: "read" });
      const videos = await buildLibraryFromDirectoryHandle(handle);
      if (!videos.length) {
        setListStatus("Folder selected, but no video files were found.");
        return;
      }
      state.videos = videos.map(normalizeVideoItem).filter(Boolean);
      state.librarySource = "Local folder";
      updateLibrarySourceBadge("Local folder");
      state.filteredIndices = state.videos.map((_, index) => index);
      renderLibrary();
      const preferredIndex = pickStartVideoIndex();
      await loadVideoAtIndex(preferredIndex, { autoplay: false, resetPosition: false });
      hydrateVideoMetadataInBackground();
      return;
    } catch (error) {
      if (error?.name !== "AbortError") {
        console.warn("Folder picker failed", error);
      }
    }
  }
  refs.folderInput.click();
}

async function onFolderInputChange(event) {
  const input = event.target;
  const files = Array.from(input.files || []);
  if (!files.length) {
    return;
  }

  cleanupLocalObjectUrls();
  const videos = buildLibraryFromFileList(files);
  if (!videos.length) {
    setListStatus("No video files found in selected folder.");
    return;
  }

  state.videos = videos.map(normalizeVideoItem).filter(Boolean);
  state.librarySource = "Local folder";
  updateLibrarySourceBadge("Local folder");
  state.filteredIndices = state.videos.map((_, index) => index);
  renderLibrary();
  const preferredIndex = pickStartVideoIndex();
  await loadVideoAtIndex(preferredIndex, { autoplay: false, resetPosition: false });
  hydrateVideoMetadataInBackground();
  input.value = "";
}

async function buildLibraryFromDirectoryHandle(rootHandle) {
  cleanupLocalObjectUrls();
  const fileEntries = [];

  async function walk(handle, prefix = "") {
    // eslint-disable-next-line no-restricted-syntax
    for await (const [name, entry] of handle.entries()) {
      const nextPath = prefix ? `${prefix}/${name}` : name;
      if (entry.kind === "directory") {
        await walk(entry, nextPath);
      } else if (entry.kind === "file") {
        const file = await entry.getFile();
        fileEntries.push({ file, relativePath: nextPath });
      }
    }
  }

  await walk(rootHandle, "");
  return buildLibraryFromFileList(fileEntries);
}

function buildLibraryFromFileList(files) {
  const grouped = new Map();
  const posterByStem = new Map();

  for (const item of files) {
    const file = item?.file || item;
    const relativePath = String(item?.relativePath || file.webkitRelativePath || file.name || "").replaceAll("\\", "/");
    const ext = (relativePath.split(".").pop() || "").toLowerCase();
    if (!ext) {
      continue;
    }

    const stem = relativePath.replace(/\.[^.]+$/, "");
    if (IMAGE_EXTENSIONS.includes(ext)) {
      posterByStem.set(stem, trackLocalObjectUrl(URL.createObjectURL(file)));
      continue;
    }

    if (!VIDEO_EXTENSIONS.includes(ext)) {
      continue;
    }

    if (!grouped.has(stem)) {
      grouped.set(stem, []);
    }

    grouped.get(stem).push({
      file,
      relativePath,
      ext,
      src: trackLocalObjectUrl(URL.createObjectURL(file)),
      type: file.type || detectMimeFromPath(relativePath),
    });
  }

  const records = [];
  for (const [stem, entries] of grouped) {
    entries.sort((a, b) => sourceRankForExt(a.ext) - sourceRankForExt(b.ext));
    const totalSize = entries.reduce((sum, entry) => sum + (entry.file.size || 0), 0);
    const earliest = Math.min(...entries.map((entry) => entry.file.lastModified || Date.now()));

    records.push({
      id: slugify(stem),
      title: inferTitleFromPath(stem),
      poster: posterByStem.get(stem) || "",
      duration: 0,
      sizeBytes: totalSize,
      resolution: "",
      codec: "",
      createdAt: Number.isFinite(earliest) ? new Date(earliest).toISOString().slice(0, 10) : "",
      tags: [entries[0].ext],
      sources: entries.map((entry) => ({
        src: entry.src,
        type: entry.type,
        label: `${entry.ext.toUpperCase()} source`,
        file: entry.file,
        sizeBytes: Number(entry.file.size) || 0,
        modifiedAt: Number(entry.file.lastModified) ? new Date(entry.file.lastModified).toISOString() : "",
      })),
    });
  }

  return records.sort((a, b) => a.title.localeCompare(b.title));
}

function sourceRankForExt(ext) {
  switch (ext) {
    case "mp4":
      return 0;
    case "webm":
      return 1;
    case "ogg":
    case "ogv":
      return 2;
    case "mov":
      return 3;
    case "mkv":
      return 4;
    default:
      return 99;
  }
}

function scheduleLibraryRender() {
  if (libraryRenderTimer) {
    return;
  }
  libraryRenderTimer = window.setTimeout(() => {
    libraryRenderTimer = 0;
    renderLibrary();
  }, 150);
}

async function hydrateVideoMetadataInBackground() {
  if (state.metadataHydrationRunning) {
    return;
  }
  state.metadataHydrationRunning = true;

  const queue = state.videos
    .map((video, index) => ({ video, index }))
    .filter(({ video }) => !video.duration || !video.resolution);

  const concurrency = 2;
  let cursor = 0;

  const worker = async () => {
    while (cursor < queue.length) {
      const current = queue[cursor];
      cursor += 1;
      const preferredSource = chooseBestSource(current.video.sources);

      try {
        const meta = await probeVideoMetadata(preferredSource);
        if (!meta) {
          continue;
        }

        if (!current.video.duration && meta.duration > 0) {
          current.video.duration = meta.duration;
        }
        if (!current.video.resolution && meta.width > 0 && meta.height > 0) {
          current.video.resolution = `${meta.width}x${meta.height}`;
        }
        if (!current.video.codec) {
          if (meta.codec) {
            current.video.codec = meta.codec;
          } else if (preferredSource.type) {
            current.video.codec = guessCodecLabel(preferredSource.type);
          }
        }

        if (current.index === state.currentVideoIndex) {
          refs.nowPlayingStats.textContent = buildNowPlayingStats(current.video);
        }
        scheduleLibraryRender();
      } catch {
        // ignore unsupported files
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  } finally {
    state.metadataHydrationRunning = false;
  }
}

async function probeVideoMetadata(source) {
  try {
    const meta = await probeVideoMetadataWithMediaBunny(source);
    if (meta && (meta.duration > 0 || (meta.width > 0 && meta.height > 0))) {
      return meta;
    }
  } catch {
    // fall back to native metadata probing
  }

  return probeVideoMetadataNative(source?.src || "");
}

async function probeVideoMetadataWithMediaBunny(source) {
  if (!source || !source.src) {
    return { duration: 0, width: 0, height: 0, codec: "" };
  }

  const mediabunny = await loadMediaBunnyModule();
  const input = new mediabunny.Input({
    formats: mediabunny.ALL_FORMATS,
    source: getMediaBunnySource(mediabunny, source),
  });

  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) {
      return { duration: 0, width: 0, height: 0, codec: "" };
    }

    let duration = 0;
    try {
      duration = Number(await input.computeDuration()) || 0;
    } catch {
      duration = 0;
    }

    const parsedDims = readTrackDimensions(videoTrack);
    const codec = readTrackCodec(videoTrack);
    if (parsedDims.width > 0 && parsedDims.height > 0) {
      return { duration, width: parsedDims.width, height: parsedDims.height, codec };
    }

    const sink = new mediabunny.CanvasSink(videoTrack, {
      width: 320,
      fit: "contain",
    });
    const frame = await sink.getCanvas(0);
    const width = Number(frame?.canvas?.width) || 0;
    const height = Number(frame?.canvas?.height) || 0;

    return { duration, width, height, codec };
  } finally {
    if (typeof input.dispose === "function") {
      input.dispose();
    }
  }
}

function readTrackDimensions(videoTrack) {
  const candidates = [
    [videoTrack?.displayWidth, videoTrack?.displayHeight],
    [videoTrack?.codedWidth, videoTrack?.codedHeight],
    [videoTrack?.width, videoTrack?.height],
    [videoTrack?.decoderConfig?.codedWidth, videoTrack?.decoderConfig?.codedHeight],
    [videoTrack?.decoderConfig?.displayWidth, videoTrack?.decoderConfig?.displayHeight],
  ];

  for (const [w, h] of candidates) {
    const width = Number(w) || 0;
    const height = Number(h) || 0;
    if (width > 0 && height > 0) {
      return { width, height };
    }
  }

  return { width: 0, height: 0 };
}

function readTrackCodec(videoTrack) {
  const candidates = [
    videoTrack?.codec,
    videoTrack?.codecName,
    videoTrack?.decoderConfig?.codec,
    videoTrack?.configuration?.codec,
  ];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function probeVideoMetadataNative(sourcePath) {
  return new Promise((resolve, reject) => {
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.muted = true;
    probe.playsInline = true;

    let settled = false;
    const timer = window.setTimeout(() => finish(new Error("metadata timeout")), 12000);

    const cleanup = () => {
      window.clearTimeout(timer);
      probe.removeAttribute("src");
      probe.load();
    };

    const finish = (error, payload) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (error) {
        reject(error);
      } else {
        resolve(payload);
      }
    };

    probe.addEventListener(
      "loadedmetadata",
      () => {
        finish(null, {
          duration: Number(probe.duration) || 0,
          width: Number(probe.videoWidth) || 0,
          height: Number(probe.videoHeight) || 0,
        });
      },
      { once: true }
    );

    probe.addEventListener(
      "error",
      () => {
        finish(new Error("metadata error"));
      },
      { once: true }
    );

    probe.src = sourcePath;
  });
}

async function loadVideoAtIndex(index, options = {}) {
  if (index < 0 || index >= state.videos.length) {
    return;
  }

  const videoMeta = state.videos[index];
  const source = chooseBestSource(videoMeta.sources);

  const previousKey = state.currentVideoIndex >= 0 ? state.videos[state.currentVideoIndex].id : "";
  maybePersistResume(previousKey);

  state.currentVideoIndex = index;
  refs.nowPlayingTitle.textContent = videoMeta.title;
  refs.nowPlayingStats.textContent = buildNowPlayingStats(videoMeta);
  updatePlaybackEngineBadge("Checking...");

  refs.video.pause();
  refs.video.src = source.src;
  refs.video.type = source.type || "";
  refs.video.load();

  resetZoom();
  renderLibrary();

  const resumeSeconds = !options.resetPosition ? Number(state.resumeMap[videoMeta.id] || 0) : 0;
  if (resumeSeconds > 2) {
    refs.video.currentTime = resumeSeconds;
  }

  updateSupportBadge(source.type);
  const selectedIndex = index;
  detectPlaybackEngineForSource(source).then((label) => {
    if (state.currentVideoIndex !== selectedIndex) {
      return;
    }
    updatePlaybackEngineBadge(label, label === "Native fallback");
  });

  if (options.autoplay) {
    try {
      await refs.video.play();
    } catch (error) {
      console.warn("Autoplay blocked", error);
    }
  }

  saveCurrentVideoPreference(videoMeta.id);
}

function pickStartVideoIndex() {
  const preferredId = localStorage.getItem("vp_current_video_id");
  if (preferredId) {
    const preferredIndex = state.videos.findIndex((video) => video.id === preferredId);
    if (preferredIndex >= 0) {
      return preferredIndex;
    }
  }
  return 0;
}

function saveCurrentVideoPreference(id) {
  localStorage.setItem("vp_current_video_id", id);
}

function buildNowPlayingStats(videoMeta) {
  const bits = [];
  bits.push(formatDuration(videoMeta.duration || 0));
  if (videoMeta.resolution) {
    bits.push(videoMeta.resolution);
  }
  if (videoMeta.codec) {
    bits.push(videoMeta.codec);
  }
  if (videoMeta.sizeBytes) {
    bits.push(formatBytes(videoMeta.sizeBytes));
  }
  return bits.join(" | ");
}

function updateSupportBadge(mimeType) {
  if (!mimeType || !navigator.mediaCapabilities) {
    return;
  }

  navigator.mediaCapabilities
    .decodingInfo({
      type: "file",
      video: {
        contentType: mimeType,
        width: refs.video.videoWidth || 1920,
        height: refs.video.videoHeight || 1080,
        bitrate: 5_000_000,
        framerate: 30,
      },
    })
    .then((result) => {
      if (!result.supported && !refs.nowPlayingStats.textContent.includes("Limited browser support")) {
        refs.nowPlayingStats.textContent += " | Limited browser support";
      }
    })
    .catch(() => {
      // ignore
    });
}

function togglePlayback() {
  if (!refs.video.src) {
    return;
  }
  if (refs.video.paused) {
    refs.video.play().catch(console.warn);
  } else {
    refs.video.pause();
  }
}

function onPlayStateChange() {
  const paused = refs.video.paused;
  refs.playPauseBtn.textContent = paused ? "PLAY" : "PAUSE";
  refs.bigPlayBtn.classList.toggle("hidden", !paused);
}

function onLoadedMetadata() {
  if (!Number.isFinite(refs.video.duration)) {
    return;
  }
  refs.totalTimeLabel.textContent = formatDuration(refs.video.duration);
  const currentVideo = state.videos[state.currentVideoIndex];
  if (currentVideo) {
    currentVideo.duration = refs.video.duration;
    refs.nowPlayingStats.textContent = buildNowPlayingStats(currentVideo);
    renderLibrary();
  }
}

function scheduleSeekUpdate() {
  if (seekRAF) {
    return;
  }
  seekRAF = requestAnimationFrame(() => {
    seekRAF = 0;
    const duration = refs.video.duration || 0;
    const current = refs.video.currentTime || 0;
    const ratio = duration > 0 ? current / duration : 0;
    refs.seekSlider.value = String(Math.round(ratio * 1000));
    refs.currentTimeLabel.textContent = formatDuration(current);

    const currentVideo = state.videos[state.currentVideoIndex];
    if (currentVideo) {
      maybePersistResume(currentVideo.id);
    }
  });
}

function onSeekInput() {
  if (!Number.isFinite(refs.video.duration)) {
    return;
  }
  const ratio = Number(refs.seekSlider.value) / 1000;
  refs.video.currentTime = ratio * refs.video.duration;
}

function onVideoEnded() {
  if (!state.autoplayNext) {
    return;
  }
  playNext();
}

function playNext() {
  const nextIndex = adjacentFilteredIndex(1);
  if (nextIndex >= 0) {
    loadVideoAtIndex(nextIndex, { autoplay: true, resetPosition: false }).catch(console.error);
  }
}

function playPrevious() {
  const prevIndex = adjacentFilteredIndex(-1);
  if (prevIndex >= 0) {
    loadVideoAtIndex(prevIndex, { autoplay: true, resetPosition: false }).catch(console.error);
  }
}

function adjacentFilteredIndex(delta) {
  if (!state.filteredIndices.length || state.currentVideoIndex < 0) {
    return -1;
  }
  const currentPos = state.filteredIndices.indexOf(state.currentVideoIndex);
  if (currentPos < 0) {
    return state.filteredIndices[0];
  }
  const nextPos = currentPos + delta;
  if (nextPos < 0) {
    return state.filteredIndices[state.filteredIndices.length - 1];
  }
  if (nextPos >= state.filteredIndices.length) {
    return state.filteredIndices[0];
  }
  return state.filteredIndices[nextPos];
}

function toggleMute() {
  refs.video.muted = !refs.video.muted;
  onVolumeChange();
}

function onVolumeInput() {
  refs.video.volume = clamp(Number(refs.volumeSlider.value), 0, 1);
  refs.video.muted = refs.video.volume === 0;
  onVolumeChange();
}

function onVolumeChange() {
  const volume = refs.video.muted ? 0 : refs.video.volume;
  refs.volumeSlider.value = String(volume);
  refs.muteBtn.textContent = volume === 0 ? "MUTE" : volume < 0.5 ? "VOL-" : "VOL+";

  localStorage.setItem("vp_volume", String(refs.video.volume));
  localStorage.setItem("vp_muted", refs.video.muted ? "1" : "0");
}

function toggleTheaterMode() {
  state.theaterMode = !state.theaterMode;
  refs.appShell.classList.toggle("theater", state.theaterMode);
  localStorage.setItem("vp_theater_mode", state.theaterMode ? "1" : "0");
}

async function toggleFullscreen() {
  if (!document.fullscreenElement) {
    await refs.playerPanel.requestFullscreen?.();
  } else {
    await document.exitFullscreen?.();
  }
}

function onFullscreenChange() {
  refs.fullscreenBtn.textContent = document.fullscreenElement ? "EXIT" : "FULL";
}

function toggleSettingsPanel() {
  state.settingsOpen = !state.settingsOpen;
  refs.settingsPanel.hidden = !state.settingsOpen;
  refs.settingsBtn.setAttribute("aria-expanded", state.settingsOpen ? "true" : "false");
}

function closeSettingsPanel() {
  state.settingsOpen = false;
  refs.settingsPanel.hidden = true;
  refs.settingsBtn.setAttribute("aria-expanded", "false");
}

function onDocumentPointerDown(event) {
  if (!state.settingsOpen) {
    return;
  }
  const target = event.target;
  if (refs.settingsPanel.contains(target) || refs.settingsBtn.contains(target)) {
    return;
  }
  closeSettingsPanel();
}

function onSpeedChange() {
  const speed = Number(refs.speedSelect.value) || 1;
  refs.video.playbackRate = speed;
  localStorage.setItem("vp_speed", String(speed));
}

function onFitChange() {
  refs.video.style.objectFit = refs.fitSelect.value;
  localStorage.setItem("vp_fit", refs.fitSelect.value);
}

function onAutoplayToggle() {
  state.autoplayNext = refs.autoplayToggle.checked;
  localStorage.setItem("vp_autoplay_next", state.autoplayNext ? "1" : "0");
}

function onZoomSliderInput() {
  const scale = clamp(Number(refs.zoomSlider.value), 1, 3);
  state.zoomScale = scale;
  if (scale > 1 && !state.zoomEnabled) {
    state.zoomEnabled = true;
  }
  if (scale === 1) {
    state.zoomX = 0;
    state.zoomY = 0;
  }
  applyZoomTransform();
}

function toggleZoomMode() {
  state.zoomEnabled = !state.zoomEnabled;
  if (!state.zoomEnabled) {
    resetZoom();
    return;
  }
  if (state.zoomScale <= 1) {
    state.zoomScale = 1.6;
    refs.zoomSlider.value = String(state.zoomScale);
  }
  applyZoomTransform();
}

function resetZoom() {
  state.zoomEnabled = false;
  state.zoomScale = 1;
  state.zoomX = 0;
  state.zoomY = 0;
  refs.zoomSlider.value = "1";
  applyZoomTransform();
}

function applyZoomTransform() {
  const scale = state.zoomEnabled ? state.zoomScale : 1;
  const x = state.zoomEnabled ? state.zoomX : 0;
  const y = state.zoomEnabled ? state.zoomY : 0;

  refs.zoomLayer.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  refs.zoomToggleBtn.style.borderColor = state.zoomEnabled ? "var(--accent)" : "var(--line)";
}

function onZoomPointerDown(event) {
  if (!state.zoomEnabled || state.zoomScale <= 1) {
    return;
  }
  state.isDraggingZoom = true;
  state.lastPointer = { x: event.clientX, y: event.clientY };
  refs.zoomLayer.setPointerCapture(event.pointerId);
}

function onZoomPointerMove(event) {
  if (!state.isDraggingZoom || !state.zoomEnabled) {
    return;
  }

  const dx = event.clientX - state.lastPointer.x;
  const dy = event.clientY - state.lastPointer.y;
  state.lastPointer = { x: event.clientX, y: event.clientY };

  state.zoomX += dx;
  state.zoomY += dy;
  clampZoomOffsets();
  applyZoomTransform();
}

function onZoomPointerUp(event) {
  if (!state.isDraggingZoom) {
    return;
  }
  state.isDraggingZoom = false;
  if (refs.zoomLayer.hasPointerCapture(event.pointerId)) {
    refs.zoomLayer.releasePointerCapture(event.pointerId);
  }
}

function onZoomWheel(event) {
  if (!state.zoomEnabled) {
    return;
  }
  event.preventDefault();
  const delta = Math.sign(event.deltaY) * -0.1;
  state.zoomScale = clamp(state.zoomScale + delta, 1, 3);
  refs.zoomSlider.value = String(state.zoomScale);

  if (state.zoomScale === 1) {
    state.zoomX = 0;
    state.zoomY = 0;
  } else {
    clampZoomOffsets();
  }

  applyZoomTransform();
}

function clampZoomOffsets() {
  const rect = refs.video.getBoundingClientRect();
  const maxX = ((state.zoomScale - 1) * rect.width) / 2;
  const maxY = ((state.zoomScale - 1) * rect.height) / 2;
  state.zoomX = clamp(state.zoomX, -maxX, maxX);
  state.zoomY = clamp(state.zoomY, -maxY, maxY);
}

async function toggleMiniPlayer() {
  if (!document.pictureInPictureEnabled || refs.video.disablePictureInPicture) {
    refs.nowPlayingStats.textContent += " | PiP not available";
    return;
  }

  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    } else {
      await refs.video.requestPictureInPicture();
    }
  } catch (error) {
    console.warn("PiP error", error);
  }
}

function onSearchInput() {
  state.searchTerm = refs.searchInput.value.trim();
  renderLibrary();
}

function onKeyDown(event) {
  if (event.key === "Escape" && state.settingsOpen) {
    closeSettingsPanel();
    return;
  }

  const activeTag = document.activeElement?.tagName;
  const typing = activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT";

  if (event.key === "/" && !typing) {
    event.preventDefault();
    refs.searchInput.focus();
    return;
  }

  if (typing) {
    return;
  }

  if (event.code === "Space") {
    event.preventDefault();
    togglePlayback();
    return;
  }

  if (event.key === "ArrowRight") {
    refs.video.currentTime = Math.min((refs.video.currentTime || 0) + 5, refs.video.duration || Infinity);
    return;
  }

  if (event.key === "ArrowLeft") {
    refs.video.currentTime = Math.max((refs.video.currentTime || 0) - 5, 0);
    return;
  }

  if (event.key.toLowerCase() === "f") {
    toggleFullscreen().catch(console.warn);
    return;
  }

  if (event.key.toLowerCase() === "t") {
    toggleTheaterMode();
    return;
  }

  if (event.key.toLowerCase() === "n") {
    playNext();
    return;
  }

  if (event.key.toLowerCase() === "p") {
    playPrevious();
  }
}

function onVideoError() {
  const currentVideo = state.videos[state.currentVideoIndex];
  if (!currentVideo) {
    return;
  }
  refs.nowPlayingStats.textContent = `${buildNowPlayingStats(currentVideo)} | Playback failed in this browser`;
}

function maybePersistResume(videoId) {
  if (!videoId || !Number.isFinite(refs.video.currentTime)) {
    return;
  }

  const now = Date.now();
  if (now - lastResumeWrite < 1000) {
    return;
  }
  lastResumeWrite = now;

  const current = refs.video.currentTime;
  const duration = refs.video.duration || 0;

  if (duration > 0 && current > duration - 3) {
    state.resumeMap[videoId] = 0;
  } else {
    state.resumeMap[videoId] = Math.max(0, current);
  }

  localStorage.setItem("vp_resume_map", JSON.stringify(state.resumeMap));
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "00:00";
  }

  const rounded = Math.floor(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) {
    return "";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(unitIndex > 1 ? 1 : 0)} ${units[unitIndex]}`;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

