const VIDEO_EXTENSIONS = ["mp4", "webm", "ogg", "ogv", "mov", "m4v", "mkv"];
const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];
const AUTO_LIBRARY_CANDIDATES = ["videos.php", "videos/videos.php", "video.php", "videos/video.php"];
const MANIFEST_CANDIDATES = ["videos/videos.json", "videos.json"];
const THUMBNAIL_TARGET_WIDTH = 480;
const THUMBNAIL_CONCURRENCY = 3;
const THUMBNAIL_CACHE_DB = "vp_thumb_cache_v1";
const THUMBNAIL_CACHE_STORE = "thumbs";
const METADATA_PROBE_CONCURRENCY = 2;
const MB_CANVAS_POOL_SIZE = 5;
const VOLUME_BOOST_MULTIPLIER = 2;
const SORT_KEYS = [
  "title-asc",
  "title-desc",
  "duration-desc",
  "duration-asc",
  "date-desc",
  "date-asc",
  "size-desc",
  "size-asc",
];
const PLACEHOLDER_POSTER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 360'><defs><linearGradient id='g' x1='0' x2='1'><stop stop-color='#182636' offset='0'/><stop stop-color='#20364e' offset='1'/></linearGradient></defs><rect width='640' height='360' fill='url(#g)'/><g fill='none' stroke='#4dd4ff' stroke-opacity='.4'><circle cx='540' cy='80' r='60'/><circle cx='120' cy='290' r='92'/></g><path d='M285 130v100l86-50-86-50z' fill='#e8f6ff' fill-opacity='.85'/></svg>`);

const state = {
  videos: [],
  filteredIndices: [],
  currentVideoIndex: -1,
  autoplayNext: true,
  repeatCurrent: false,
  theaterMode: false,
  settingsOpen: false,
  theme: "dark",
  accent: "default",
  searchTerm: "",
  sortKey: "title-asc",
  showRemaining: false,
  boostEnabled: false,
  zoomEnabled: false,
  zoomScale: 1,
  zoomX: 0,
  zoomY: 0,
  isDraggingZoom: false,
  panMoved: false,
  lastPointer: { x: 0, y: 0 },
  resumeMap: {},
  isScrubbing: false,
  scrubResumeAfterSeek: false,
  scrubPointerId: null,
  scrubTargetTime: 0,
  librarySource: "Unknown",
  localObjectUrls: [],
  activeEngine: "native",
};

const refs = {
  appShell: document.getElementById("appShell"),
  playerPanel: document.getElementById("playerPanel"),
  videoStage: document.getElementById("videoStage"),
  zoomLayer: document.getElementById("zoomLayer"),
  videoCanvas: document.getElementById("videoCanvas"),
  video: document.getElementById("video"),
  bigPlayBtn: document.getElementById("bigPlayBtn"),
  nowPlayingTitle: document.getElementById("nowPlayingTitle"),
  nowPlayingStats: document.getElementById("nowPlayingStats"),
  seekSlider: document.getElementById("seekSlider"),
  timelineWrap: document.getElementById("timelineWrap"),
  bufferBar: document.getElementById("bufferBar"),
  hoverPreview: document.getElementById("hoverPreview"),
  hoverPreviewCanvas: document.getElementById("hoverPreviewCanvas"),
  hoverTimeLabel: document.getElementById("hoverTimeLabel"),
  currentTimeLabel: document.getElementById("currentTimeLabel"),
  totalTimeLabel: document.getElementById("totalTimeLabel"),
  prevBtn: document.getElementById("prevBtn"),
  playPauseBtn: document.getElementById("playPauseBtn"),
  nextBtn: document.getElementById("nextBtn"),
  muteBtn: document.getElementById("muteBtn"),
  volumeSlider: document.getElementById("volumeSlider"),
  zoomToggleBtn: document.getElementById("zoomToggleBtn"),
  miniPlayerBtn: document.getElementById("miniPlayerBtn"),
  toastStack: document.getElementById("toastStack"),
  theaterBtn: document.getElementById("theaterBtn"),
  fullscreenBtn: document.getElementById("fullscreenBtn"),
  settingsBtn: document.getElementById("settingsBtn"),
  settingsPanel: document.getElementById("settingsPanel"),
  helpBtn: document.getElementById("helpBtn"),
  helpDialog: document.getElementById("helpDialog"),
  helpCloseBtn: document.getElementById("helpCloseBtn"),
  speedSelect: document.getElementById("speedSelect"),
  zoomSlider: document.getElementById("zoomSlider"),
  autoplayToggle: document.getElementById("autoplayToggle"),
  repeatToggle: document.getElementById("repeatToggle"),
  boostToggle: document.getElementById("boostToggle"),
  themeSelect: document.getElementById("themeSelect"),
  accentSelect: document.getElementById("accentSelect"),
  libraryList: document.getElementById("libraryList"),
  libraryPanel: document.getElementById("libraryPanel"),
  resultCount: document.getElementById("resultCount"),
  sortSelect: document.getElementById("sortSelect"),
  searchInput: document.getElementById("searchInput"),
  reloadLibraryBtn: document.getElementById("reloadLibraryBtn"),
  pickFolderBtn: document.getElementById("pickFolderBtn"),
  folderInput: document.getElementById("folderInput"),
  videoCardTemplate: document.getElementById("videoCardTemplate"),
};

let seekRAF = 0;
let scrubPreviewTimer = 0;
let scrubPreviewPendingTime = -1;
let lastResumeWrite = Object.create(null);
let libraryRenderTimer = 0;
let lastPanEndTime = 0;
let libraryLoadToken = 0;
const thumbnailInFlight = new Set();
const thumbnailDone = new Set();
const thumbnailQueued = new Set();
const thumbnailQueue = [];
const cardRefs = new Map();
let thumbnailWorkersActive = 0;
let thumbnailDbPromise = null;
let thumbObserver = null;
const playerState = {
  duration: 0,
  currentTime: 0,
  paused: true,
  playbackRate: 1,
  volume: 1,
  muted: false,
};

const mbEngine = {
  source: null,
  input: null,
  videoTrack: null,
  audioTrack: null,
  canvasSink: null,
  audioSink: null,
  audioContext: null,
  gainNode: null,
  isReady: false,
  isPlaying: false,
  playStartMediaTime: 0,
  playStartPerfMs: 0,
  stopToken: 0,
  audioSchedulerId: 0,
  audioScheduledUntil: 0,
  audioNodes: [],
  sourceMode: "",
  audioClockStartCtxTime: 0,
  audioClockStartMediaTime: 0,
};

const nativeEngine = {
  isReady: false,
  source: null,
  errorFallbackRunning: false,
  audioContext: null,
  audioGain: null,
};

const MEDIA_SESSION_SUPPORTED =
  "mediaSession" in navigator && "MediaMetadata" in window;

bootstrap();

function initMediaSessionHandlers() {
  if (!MEDIA_SESSION_SUPPORTED) {
    return;
  }
  try {
    const session = navigator.mediaSession;
    session.setActionHandler("play", () => {
      if (playerState.paused) {
        togglePlayback();
      }
    });
    session.setActionHandler("pause", () => {
      if (!playerState.paused) {
        togglePlayback();
      }
    });
    session.setActionHandler("previoustrack", () => playPrevious());
    session.setActionHandler("nexttrack", () => playNext());
    session.setActionHandler("seekbackward", (details) => {
      const fallback = typeof details?.seekOffset === "number" ? details.seekOffset : 5;
      seekPlaybackEngine(Math.max(0, getCurrentPlaybackTime() - fallback)).catch(console.warn);
    });
    session.setActionHandler("seekforward", (details) => {
      const fallback = typeof details?.seekOffset === "number" ? details.seekOffset : 5;
      seekPlaybackEngine(getCurrentPlaybackTime() + fallback).catch(console.warn);
    });
    if (typeof session.setActionHandler === "function") {
      try {
        session.setActionHandler("seekto", (details) => {
          if (typeof details?.seekTime === "number" && Number.isFinite(details.seekTime)) {
            seekPlaybackEngine(details.seekTime).catch(console.warn);
          }
        });
      } catch {
        // seekto unsupported on this browser
      }
    }
  } catch (error) {
    console.warn("MediaSession action handlers unavailable", error);
  }
}

function updateMediaSessionMetadata() {
  if (!MEDIA_SESSION_SUPPORTED) {
    return;
  }
  try {
    const videoMeta = state.videos[state.currentVideoIndex];
    if (!videoMeta) {
      return;
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: videoMeta.title,
      artist: videoMeta.codec || "",
      album: "VideoPlayer",
      artwork: videoMeta.poster
        ? [{ src: videoMeta.poster, sizes: "480x360", type: "image/jpeg" }]
        : [],
    });
  } catch (error) {
    console.warn("MediaSession metadata update failed", error);
  }
}

let lastPositionStateWrite = 0;

function syncMediaSessionState() {
  if (!MEDIA_SESSION_SUPPORTED) {
    return;
  }
  try {
    navigator.mediaSession.playbackState = playerState.paused ? "paused" : "playing";
    const duration = playerState.duration;
    const now = Date.now();
    if (
      duration > 0 &&
      now - lastPositionStateWrite > 500 &&
      typeof navigator.mediaSession.setPositionState === "function"
    ) {
      lastPositionStateWrite = now;
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: Math.max(0.01, playerState.playbackRate),
        position: clamp(getCurrentPlaybackTime(), 0, duration),
      });
    }
  } catch {
    // invalid position state values are fine to ignore
  }
}

function bootTheme() {
  hydrateTheme();
  initMediaSessionHandlers();
}

async function bootstrap() {
  try {
    bindEvents();
    hydratePreferences();
    bootTheme();
    refs.settingsPanel.hidden = true;
    refs.settingsBtn.setAttribute("aria-expanded", "false");
    if (refs.helpDialog.open) {
      refs.helpDialog.close();
    }
    setEngineUi("native");
    loadLibrary();
  } catch (error) {
    window.__vpErrors.push(`bootstrap: ${error?.stack || error}`);
  }
}

function bindEvents() {
  refs.playPauseBtn.addEventListener("click", togglePlayback);
  refs.bigPlayBtn.addEventListener("click", togglePlayback);
  refs.prevBtn.addEventListener("click", playPrevious);
  refs.nextBtn.addEventListener("click", playNext);
  refs.muteBtn.addEventListener("click", toggleMute);
  refs.volumeSlider.addEventListener("input", onVolumeInput);
  refs.seekSlider.addEventListener("input", onSeekInput);
  refs.seekSlider.addEventListener("pointerdown", onSeekPointerDown);
  refs.seekSlider.addEventListener("pointerup", onSeekPointerUp);
  refs.seekSlider.addEventListener("pointercancel", onSeekPointerUp);
  refs.timelineWrap.addEventListener("pointermove", onTimelineHover);
  refs.timelineWrap.addEventListener("pointerleave", onTimelineHoverLeave);
  refs.totalTimeLabel.addEventListener("click", toggleRemainingTime);
  refs.sortSelect.addEventListener("change", onSortChange);
  refs.boostToggle.addEventListener("change", onBoostToggle);
  refs.themeSelect.addEventListener("change", onThemeChange);
  refs.accentSelect.addEventListener("change", onAccentChange);
  window.matchMedia?.("(prefers-color-scheme: light)")?.addEventListener?.("change", () => {
    if (state.theme === "auto") {
      applyTheme();
    }
  });
  document.addEventListener("dragover", (event) => event.preventDefault());
  document.addEventListener("drop", onDocumentDrop);
  refs.theaterBtn.addEventListener("click", toggleTheaterMode);
  refs.fullscreenBtn.addEventListener("click", toggleFullscreen);
  refs.settingsBtn.addEventListener("click", toggleSettingsPanel);
  refs.settingsBtn.addEventListener("pointerdown", (event) => event.stopPropagation());
  refs.settingsPanel.addEventListener("pointerdown", (event) => event.stopPropagation());
  refs.speedSelect.addEventListener("change", onSpeedChange);
  refs.zoomSlider.addEventListener("input", onZoomSliderInput);
  refs.zoomToggleBtn.addEventListener("click", toggleZoomMode);
  refs.autoplayToggle.addEventListener("change", onAutoplayToggle);
  refs.repeatToggle.addEventListener("change", onRepeatToggle);
  refs.miniPlayerBtn.addEventListener("click", toggleMiniPlayer);
  refs.helpBtn.addEventListener("click", toggleHelpDialog);
  refs.helpCloseBtn.addEventListener("click", toggleHelpDialog);
  refs.searchInput.addEventListener("input", onSearchInput);
  refs.reloadLibraryBtn.addEventListener("click", loadLibrary);
  refs.pickFolderBtn.addEventListener("click", onPickFolderClick);
  refs.folderInput.addEventListener("change", onFolderInputChange);

  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("pointerdown", onDocumentPointerDown);
  document.addEventListener("fullscreenchange", onFullscreenChange);
  document.addEventListener("webkitfullscreenchange", onFullscreenChange);
  refs.video.addEventListener("webkitbeginfullscreen", onFullscreenChange);
  refs.video.addEventListener("webkitendfullscreen", onFullscreenChange);
  window.addEventListener("resize", onViewportChange);

  refs.videoStage.addEventListener("wheel", onZoomWheel, { passive: false });

  refs.zoomLayer.addEventListener("pointerdown", onZoomPointerDown);
  refs.zoomLayer.addEventListener("pointermove", onZoomPointerMove);
  refs.zoomLayer.addEventListener("pointerup", onZoomPointerUp);
  refs.zoomLayer.addEventListener("pointercancel", onZoomPointerUp);
  refs.zoomLayer.addEventListener("pointerleave", onZoomPointerUp);

  refs.videoStage.addEventListener("click", onStageClick);
  refs.videoStage.addEventListener("dblclick", onStageDoubleClick);

  refs.video.addEventListener("loadedmetadata", onNativeLoadedMetadata);
  refs.video.addEventListener("durationchange", onNativeLoadedMetadata);
  refs.video.addEventListener("timeupdate", onNativeTimeUpdate);
  refs.video.addEventListener("ended", onNativeEnded);
  refs.video.addEventListener("play", onNativePlay);
  refs.video.addEventListener("pause", onNativePause);
  refs.video.addEventListener("error", onNativeError);
}

function hydrateTheme() {
  const themes = ["auto", "dark", "light"];
  const savedTheme = localStorage.getItem("vp_theme");
  state.theme = themes.includes(savedTheme) ? savedTheme : "dark";
  const accents = ["default", "amber", "teal", "rose", "violet"];
  const savedAccent = localStorage.getItem("vp_accent");
  state.accent = accents.includes(savedAccent) ? savedAccent : "default";
  refs.themeSelect.value = state.theme;
  refs.accentSelect.value = state.accent;
  applyTheme();
}

function applyTheme() {
  const theme = state.theme === "auto" && window.matchMedia ? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : state.theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.accent = state.accent || "default";
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) {
    themeColor.content = theme === "light" ? "#f4f5f7" : "#0f0f0f";
  }
}

function onThemeChange() {
  state.theme = refs.themeSelect.value;
  localStorage.setItem("vp_theme", state.theme);
  applyTheme();
}

function onAccentChange() {
  state.accent = refs.accentSelect.value;
  localStorage.setItem("vp_accent", state.accent);
  applyTheme();
}

function hydratePreferences() {
  try {
    state.resumeMap = JSON.parse(localStorage.getItem("vp_resume_map") || "{}");
  } catch {
    state.resumeMap = {};
  }

  state.theaterMode = localStorage.getItem("vp_theater_mode") === "1";
  state.autoplayNext = localStorage.getItem("vp_autoplay_next") !== "0";
  state.repeatCurrent = localStorage.getItem("vp_repeat_current") === "1";
  state.showRemaining = localStorage.getItem("vp_show_remaining") === "1";

  const savedSort = localStorage.getItem("vp_sort");
  if (SORT_KEYS.includes(savedSort)) {
    state.sortKey = savedSort;
  }
  refs.sortSelect.value = state.sortKey;

  state.boostEnabled = localStorage.getItem("vp_volume_boost") === "1";
  refs.boostToggle.checked = state.boostEnabled;

  const savedVolume = Number(localStorage.getItem("vp_volume") || "1");
  playerState.volume = Number.isFinite(savedVolume) ? clamp(savedVolume, 0, 1) : 1;
  playerState.muted = localStorage.getItem("vp_muted") === "1";

  const savedSpeed = localStorage.getItem("vp_speed") || "1";
  refs.speedSelect.value = savedSpeed;
  playerState.playbackRate = Number(savedSpeed) || 1;

  refs.autoplayToggle.checked = state.autoplayNext;
  refs.repeatToggle.checked = state.repeatCurrent;
  refs.volumeSlider.value = String(playerState.volume);
  syncRangeFill(refs.volumeSlider);
  syncRangeFill(refs.seekSlider);

  if (state.theaterMode) {
    refs.appShell.classList.add("theater");
  }

  onVolumeChange();
}

async function loadLibrary() {
  const loadToken = ++libraryLoadToken;
  setListStatus("Loading library...");
  stopPlayback();
  await teardownMediaBunnyEngine();
  detachNativeSource();
  cleanupLocalObjectUrls();
  thumbnailInFlight.clear();
  thumbnailDone.clear();
  thumbnailQueued.clear();
  thumbnailQueue.length = 0;
  thumbnailWorkersActive = 0;
  state.currentVideoIndex = -1;

  let loadedFrom = "Unknown";
  let autoLibraryError = "";

  try {
    const autoResult = await fetchAutoLibrary();
    state.videos = autoResult.videos.map(normalizeVideoItem).filter(Boolean);
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

  if (loadToken !== libraryLoadToken) {
    return;
  }

  state.filteredIndices = state.videos.map((_, index) => index);
  pruneResumeMap();
  renderLibrary();

  if (!state.videos.length) {
    if (loadedFrom === "Unknown" || window.location.protocol === "file:") {
      setListStatus("No source detected. Serve via HTTP/PHP, or click Open Folder.");
    } else if (autoLibraryError) {
      setListStatus(`PHP auto-scan failed: ${autoLibraryError}. Fix videos.php or use Open Folder.`);
    } else {
      setListStatus(
        "No videos found. Drop files into videos/, or provide videos/videos.json."
      );
    }
    return;
  }

  const preferredIndex = pickStartVideoIndex();
  await loadVideoAtIndex(preferredIndex, { autoplay: false, resetPosition: false });
  if (loadToken === libraryLoadToken) {
    hydrateVideoMetadataInBackground();
  }
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
      if (!Array.isArray(videos) || !videos.length) {
        failures.push(`${candidate} returned no videos`);
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
      if (!videos.length) {
        throw new Error("Empty manifest");
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
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (contentType && !contentType.includes("text/html")) {
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

function rankSources(sources) {
  const probe = document.createElement("video");
  return sources
    .map((source) => {
      const mime = source.type || detectMimeFromPath(source.src);
      return {
        ...source,
        type: mime,
        score: supportToScore(mime ? probe.canPlayType(mime) : ""),
      };
    })
    .sort((a, b) => b.score - a.score);
}

function chooseBestSource(sources) {
  return rankSources(sources)[0] || sources[0];
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

  state.filteredIndices = applySortToIndices(
    state.videos
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
      .map(({ index }) => index)
  );

  refs.resultCount.textContent = `${state.filteredIndices.length} video${
    state.filteredIndices.length === 1 ? "" : "s"
  }`;
  refs.libraryList.innerHTML = "";
  cardRefs.clear();
  disconnectThumbObserver();

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

    title.textContent = video.title;
    updateCardMetaForIndex(index, { duration, meta, codec });

    thumb.src = video.poster || PLACEHOLDER_POSTER;
    thumb.alt = `${video.title} thumbnail`;
    thumb.dataset.thumbIndex = String(index);
    thumb.addEventListener("error", () => {
      thumb.src = PLACEHOLDER_POSTER;
      if (!video.poster) {
        return;
      }
      video.poster = "";
      queueThumbnailGeneration(index);
    });

    if (index === state.currentVideoIndex) {
      node.classList.add("active");
    }

    node.addEventListener("click", () => {
      loadVideoAtIndex(index, { autoplay: true, resetPosition: false }).catch(console.error);
    });

    cardRefs.set(index, { root: node, thumb, duration, title, meta, codec });
    fragment.appendChild(node);
  }

  refs.libraryList.appendChild(fragment);
  observeThumbnailsForGeneration();
}

function updateCardMetaForIndex(index, card) {
  const video = state.videos[index];
  if (!video) {
    return;
  }

  card.duration.textContent = video.duration > 0 ? formatDuration(video.duration) : "--:--";

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

  card.meta.textContent = statBits.join(" | ") || "No metadata";
  card.codec.textContent = `${video.codec || "Unknown"}${
    video.tags.length ? ` | ${video.tags.join(", ")}` : ""
  }`;
}

function setActiveCard(index) {
  for (const [cardIndex, card] of cardRefs) {
    card.root.classList.toggle("active", cardIndex === index);
  }
}

function scheduleLibraryRender() {
  if (libraryRenderTimer) {
    return;
  }
  libraryRenderTimer = window.setTimeout(() => {
    libraryRenderTimer = 0;
    for (const [index, card] of cardRefs) {
      updateCardMetaForIndex(index, card);
    }
    const current = state.videos[state.currentVideoIndex];
    if (current) {
      refs.nowPlayingStats.textContent = buildNowPlayingStats(current);
    }
  }, 150);
}

function setListStatus(message) {
  refs.libraryList.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function observeThumbnailsForGeneration() {
  if (!("IntersectionObserver" in window)) {
    for (const index of state.filteredIndices) {
      queueThumbnailGeneration(index);
    }
    return;
  }

  thumbObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          continue;
        }
        const index = Number(entry.target.dataset.thumbIndex);
        if (Number.isInteger(index)) {
          queueThumbnailGeneration(index);
        }
        thumbObserver.unobserve(entry.target);
      }
    },
    { root: refs.libraryList, rootMargin: "300px 0px" }
  );

  for (const card of cardRefs.values()) {
    thumbObserver.observe(card.thumb);
  }
}

function disconnectThumbObserver() {
  if (thumbObserver) {
    thumbObserver.disconnect();
    thumbObserver = null;
  }
}

function queueThumbnailGeneration(index) {
  const videoMeta = state.videos[index];
  if (!videoMeta) {
    return;
  }

  const key = videoMeta.id || `index-${index}`;
  if (
    videoMeta.poster ||
    thumbnailInFlight.has(key) ||
    thumbnailDone.has(key) ||
    thumbnailQueued.has(key)
  ) {
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
      applyThumbnailToCard(job.index);
      return;
    }

    const thumbnailDataUrl = await generateThumbnailForVideo(videoMeta);
    if (!thumbnailDataUrl) {
      return;
    }

    videoMeta.poster = thumbnailDataUrl;
    applyThumbnailToCard(job.index);
    await setCachedThumbnail(cacheKey, thumbnailDataUrl);
  } finally {
    thumbnailInFlight.delete(job.key);
    thumbnailDone.add(job.key);
  }
}

function applyThumbnailToCard(index) {
  const card = cardRefs.get(index);
  const videoMeta = state.videos[index];
  if (card && videoMeta?.poster) {
    card.thumb.src = videoMeta.poster;
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

function loadMediaBunnyModule() {
  if (typeof window.Mediabunny === "undefined") {
    return Promise.reject(
      new Error("MediaBunny global is missing — check vendor/mediabunny.min.cjs is loaded before app.js")
    );
  }
  return Promise.resolve(window.Mediabunny);
}

function createBlobMediaSource(mediabunnyModule, blob) {
  return new mediabunnyModule.BlobSource(blob, {
    maxCacheSize: 32 * 1024 * 1024,
  });
}

function createUrlMediaSource(mediabunnyModule, src) {
  return new mediabunnyModule.UrlSource(src, {
    requestInit: { cache: "force-cache" },
    parallelism: 1,
    getRetryDelay: (previousAttempts) => (previousAttempts >= 1 ? null : 0.25),
  });
}

async function createMediaBunnySource(mediabunnyModule, source, options = {}) {
  const mode = options.mode || "playback";
  const preferUrl = Boolean(options.preferUrl);

  if (source.file instanceof Blob) {
    return {
      source: createBlobMediaSource(mediabunnyModule, source.file),
      mode: "blob-local",
    };
  }

  if (!source?.src) {
    throw new Error("Missing media source path");
  }

  return {
    source: createUrlMediaSource(mediabunnyModule, source.src),
    mode: mode === "thumbnail" ? "url" : preferUrl ? "url-direct" : "url-fallback",
  };
}

async function extractFrameThumbnailWithMediaBunny(source) {
  const mediabunny = await loadMediaBunnyModule();
  const sourceDescriptor = await createMediaBunnySource(mediabunny, source, { mode: "thumbnail" });
  const input = new mediabunny.Input({
    formats: mediabunny.ALL_FORMATS,
    source: sourceDescriptor.source,
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
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const cleanupAndReject = (error) => {
      if (settled) return;
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
  if (!Array.isArray(videos) || videos.length !== 1) return false;
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
      await adoptLocalLibrary(videos);
      return;
    } catch (error) {
      if (error?.name === "AbortError") {
        return;
      }
      console.warn("Folder picker failed", error);
      setListStatus(`Folder import failed: ${error?.message || error}`);
      return;
    }
  }
  refs.folderInput.click();
}

async function onDocumentDrop(event) {
  event.preventDefault();
  const items = Array.from(event.dataTransfer?.items || []);
  if (!items.length) {
    return;
  }

  const descriptors = [];
  const plainFiles = [];
  for (const item of items) {
    if (item.kind !== "file") {
      continue;
    }
    const entry = typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null;
    if (entry) {
      descriptors.push({ entry, relativePath: entry.name });
    } else {
      const file = item.getAsFile();
      if (file) {
        plainFiles.push(file);
      }
    }
  }

  if (!descriptors.length && !plainFiles.length) {
    return;
  }

  const imported = [];
  try {
    for (const descriptor of descriptors) {
      await walkFsEntry(descriptor.entry, "", imported, descriptor.relativePath);
    }
  } catch (error) {
    console.warn("Drag & drop import failed", error);
    showToast(`Import failed: ${error?.message || "unknown error"}`);
    return;
  }

  const fileList = [
    ...imported,
    ...plainFiles.map((file) => ({ file, relativePath: file.name })),
  ];
  const library = buildLibraryFromFileList(fileList);

  if (!library.length) {
    showToast("No video files found in the dropped items.");
    return;
  }

  await adoptLocalLibrary(library);
  showToast(`Imported ${library.length} video${library.length === 1 ? "" : "s"}`);
}

async function walkFsEntry(entry, prefix, rootItems, forcedRelativePath) {
  if (!entry) {
    return;
  }
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) =>
      entry.file(resolve, reject)
    );
    const relativePath = forcedRelativePath || (prefix ? `${prefix}/${entry.name}` : entry.name);
    rootItems.push({ file, relativePath });
    return;
  }
  if (!entry.isDirectory) {
    return;
  }

  const nextPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
  const reader = entry.createReader();
  for (;;) {
    const batch = await new Promise((resolve, reject) =>
      reader.readEntries(resolve, reject)
    );
    if (!batch.length) {
      break;
    }
    for (const child of batch) {
      await walkFsEntry(child, nextPrefix, rootItems);
    }
  }
}

async function onFolderInputChange(event) {
  const input = event.target;
  const files = Array.from(input.files || []);
  if (!files.length) return;

  cleanupLocalObjectUrls();
  const videos = buildLibraryFromFileList(files);
  if (!videos.length) {
    setListStatus("No video files found in selected folder.");
    return;
  }

  await adoptLocalLibrary(videos);
  input.value = "";
}

async function adoptLocalLibrary(videos) {
  stopPlayback();
  await teardownMediaBunnyEngine();
  detachNativeSource();

  state.videos = videos.map(normalizeVideoItem).filter(Boolean);
  state.currentVideoIndex = -1;
  state.filteredIndices = state.videos.map((_, index) => index);
  renderLibrary();

  const preferredIndex = pickStartVideoIndex();
  await loadVideoAtIndex(preferredIndex, { autoplay: false, resetPosition: false });
  hydrateVideoMetadataInBackground();
}

async function buildLibraryFromDirectoryHandle(rootHandle) {
  cleanupLocalObjectUrls();
  const fileEntries = [];

  async function walk(handle, prefix = "") {
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
    const relativePath = String(
      item?.relativePath || file.webkitRelativePath || file.name || ""
    ).replaceAll("\\", "/");
    const ext = (relativePath.split(".").pop() || "").toLowerCase();
    if (!ext) continue;

    const stem = relativePath.replace(/\.[^.]+$/, "");
    if (IMAGE_EXTENSIONS.includes(ext)) {
      posterByStem.set(stem, trackLocalObjectUrl(URL.createObjectURL(file)));
      continue;
    }

    if (!VIDEO_EXTENSIONS.includes(ext)) continue;

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
        modifiedAt: Number(entry.file.lastModified)
          ? new Date(entry.file.lastModified).toISOString()
          : "",
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

async function hydrateVideoMetadataInBackground() {
  const queue = state.videos
    .map((video, index) => ({ video, index }))
    .filter(({ video }) => !video.duration || !video.resolution);

  let cursor = 0;
  const worker = async () => {
    while (cursor < queue.length) {
      const current = queue[cursor];
      cursor += 1;
      const preferredSource = chooseBestSource(current.video.sources);

      try {
        const meta = await probeVideoMetadata(preferredSource);
        if (!meta) continue;

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

        scheduleLibraryRender();
      } catch {
        // ignore unsupported files
      }
    }
  };

  await Promise.all(Array.from({ length: METADATA_PROBE_CONCURRENCY }, () => worker()));
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
  const sourceDescriptor = await createMediaBunnySource(mediabunny, source, { mode: "thumbnail" });
  const input = new mediabunny.Input({
    formats: mediabunny.ALL_FORMATS,
    source: sourceDescriptor.source,
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

    const sink = new mediabunny.CanvasSink(videoTrack, { width: 320, fit: "contain" });
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
      if (settled) return;
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

function stopPlayback() {
  if (state.activeEngine === "native") {
    try {
      refs.video.pause();
    } catch {
      // ignore
    }
  } else if (state.activeEngine === "mediabunny") {
    pauseMediaBunnyEngine();
  }
  playerState.paused = true;
  syncPlaybackUi();
}

function detachNativeSource() {
  nativeEngine.isReady = false;
  nativeEngine.source = null;
  try {
    refs.video.pause();
    refs.video.removeAttribute("src");
    refs.video.load();
  } catch {
    // ignore
  }
}

async function teardownMediaBunnyEngine() {
  mbEngine.stopToken += 1;
  mbEngine.isPlaying = false;
  clearScheduledAudioNodes();
  if (scrubPreviewTimer) {
    window.clearTimeout(scrubPreviewTimer);
    scrubPreviewTimer = 0;
  }
  scrubPreviewPendingTime = -1;
  state.isScrubbing = false;
  state.scrubResumeAfterSeek = false;
  state.scrubPointerId = null;

  if (mbEngine.audioSchedulerId) {
    window.clearTimeout(mbEngine.audioSchedulerId);
    mbEngine.audioSchedulerId = 0;
  }

  if (mbEngine.input && typeof mbEngine.input.dispose === "function") {
    mbEngine.input.dispose();
  }

  mbEngine.source = null;
  mbEngine.input = null;
  mbEngine.videoTrack = null;
  mbEngine.audioTrack = null;
  mbEngine.canvasSink = null;
  mbEngine.audioSink = null;
  mbEngine.isReady = false;
  mbEngine.audioScheduledUntil = 0;
  mbEngine.sourceMode = "";
  mbEngine.audioClockStartCtxTime = 0;
  mbEngine.audioClockStartMediaTime = 0;
}

function clearScheduledAudioNodes() {
  for (const node of mbEngine.audioNodes) {
    try {
      node.stop();
    } catch {
      // ignore nodes that already ended
    }
    try {
      node.disconnect();
    } catch {
      // ignore disconnect failures
    }
  }
  mbEngine.audioNodes = [];
}

async function initAudioContextIfNeeded() {
  if (!mbEngine.audioContext) {
    const audioContext = new AudioContext();
    const gainNode = audioContext.createGain();
    gainNode.connect(audioContext.destination);
    mbEngine.audioContext = audioContext;
    mbEngine.gainNode = gainNode;
  }

  if (mbEngine.audioContext.state === "suspended") {
    await mbEngine.audioContext.resume();
  }

  if (mbEngine.gainNode) {
    mbEngine.gainNode.gain.value = playerState.muted ? 0 : playerState.volume;
  }
}

function updateVideoStageAspect(width, height) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  const valid = w > 0 && h > 0;
  const aspectRatio = valid ? w / h : 16 / 9;
  const aspectRatioValue = String(aspectRatio);
  if (refs.videoStage.dataset.aspectRatio === aspectRatioValue) {
    return;
  }

  refs.videoStage.dataset.aspectRatio = aspectRatioValue;
  refs.videoStage.dataset.orientation = valid && h > w ? "portrait" : "landscape";
  updateVideoStageSize();
}

function updateVideoStageSize() {
  const aspectRatio = Number(refs.videoStage.dataset.aspectRatio) || 16 / 9;
  const isPortrait = refs.videoStage.dataset.orientation === "portrait";
  const viewportHeight = Math.max(
    1,
    Number(window.visualViewport?.height) ||
      Number(document.documentElement.clientHeight) ||
      Number(window.innerHeight) ||
      1
  );
  const isFullscreen = getFullscreenElement() === refs.playerPanel;
  let maximumHeight;
  if (isFullscreen) {
    maximumHeight = viewportHeight;
  } else if (state.theaterMode) {
    maximumHeight = Math.min(viewportHeight * 0.82, 1200);
  } else if (isPortrait) {
    maximumHeight = Math.min(viewportHeight * 0.85, 900);
  } else {
    maximumHeight = Math.min(viewportHeight * 0.72, 820);
  }
  const panelWidth = Math.max(1, Number(refs.playerPanel.clientWidth) || 1280);
  const stageHeight = Math.min(maximumHeight, Math.max(240, panelWidth / aspectRatio));
  refs.videoStage.style.setProperty("--stage-height", `${Math.floor(stageHeight)}px`);
  syncLibraryPanelHeight();
}

async function prepareNativePlayback(source, startTimeSeconds = 0) {
  detachNativeSource();
  nativeEngine.isReady = false;
  nativeEngine.source = source;

  refs.video.src = source.src;
  refs.video.preload = "auto";

  await waitForNativeMetadata();

  playerState.duration = Number(refs.video.duration) || 0;
  playerState.currentTime = clamp(
    startTimeSeconds,
    0,
    playerState.duration || startTimeSeconds || 0
  );
  playerState.paused = true;
  refs.video.playbackRate = playerState.playbackRate;
  refs.video.volume = playerState.volume;
  refs.video.muted = playerState.muted;
  try {
    refs.video.currentTime = playerState.currentTime;
  } catch {
    // ignore failed initial seek; frame will appear once played
  }

  nativeEngine.isReady = true;
  const width = Number(refs.video.videoWidth) || 0;
  const height = Number(refs.video.videoHeight) || 0;
  updateVideoStageAspect(width, height);
}

function waitForNativeMetadata() {
  return new Promise((resolve, reject) => {
    if (refs.video.readyState >= 1) {
      resolve();
      return;
    }

    const cleanup = () => {
      refs.video.removeEventListener("loadedmetadata", onSuccess);
      refs.video.removeEventListener("error", onError);
    };
    const onSuccess = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Native playback failed to load source"));
    };

    refs.video.addEventListener("loadedmetadata", onSuccess, { once: true });
    refs.video.addEventListener("error", onError, { once: true });
  });
}

async function prepareMediaBunnyPlayback(source, startTimeSeconds = 0) {
  await teardownMediaBunnyEngine();
  const mediabunny = await loadMediaBunnyModule();

  const sourceDescriptor = await createMediaBunnySource(mediabunny, source, {
    mode: "playback",
    preferUrl: true,
  });
  const input = new mediabunny.Input({
    formats: mediabunny.ALL_FORMATS,
    source: sourceDescriptor.source,
  });

  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) {
      throw new Error("No decodable video track found");
    }

    const videoDecodable = await videoTrack.canDecode();
    if (!videoDecodable) {
      throw new Error("Video track cannot be decoded by MediaBunny");
    }

    const audioTrack = await input.getPrimaryAudioTrack();
    const audioDecodable = audioTrack ? await audioTrack.canDecode() : false;
    const canvasWidth = Math.max(320, Math.round(refs.videoStage.clientWidth || 1280));
    const canvasSink = new mediabunny.CanvasSink(videoTrack, {
      width: canvasWidth,
      fit: "contain",
      poolSize: MB_CANVAS_POOL_SIZE,
    });
    const audioSink =
      audioTrack && audioDecodable ? new mediabunny.AudioBufferSink(audioTrack) : null;

    let duration = 0;
    try {
      duration = Number(await input.computeDuration()) || 0;
    } catch {
      duration = 0;
    }

    mbEngine.source = source;
    mbEngine.input = input;
    mbEngine.videoTrack = videoTrack;
    mbEngine.audioTrack = audioTrack;
    mbEngine.canvasSink = canvasSink;
    mbEngine.audioSink = audioSink;
    mbEngine.isReady = true;
    mbEngine.sourceMode = sourceDescriptor.mode;

    playerState.duration = Math.max(0, duration);
    playerState.currentTime = clamp(
      startTimeSeconds,
      0,
      playerState.duration || startTimeSeconds || 0
    );
    playerState.paused = true;

    if (audioSink) {
      await initAudioContextIfNeeded();
    }

    const resolution = await readTrackResolution(videoTrack);
    updateVideoStageAspect(resolution.width, resolution.height);
    if (!resolution.width || !resolution.height) {
      await renderMbFrameAt(playerState.currentTime);
    }

    console.info(
      `VideoPlayer: MediaBunny canvas engine (${sourceDescriptor.mode})` +
        (!audioSink && audioTrack ? " — audio track found but not decodable" : "")
    );
  } catch (error) {
    if (typeof input.dispose === "function") {
      input.dispose();
    }
    throw error;
  }
}

async function readTrackResolution(videoTrack) {
  const candidates = [
    typeof videoTrack.getDisplayWidth === "function" &&
    typeof videoTrack.getDisplayHeight === "function"
      ? [await videoTrack.getDisplayWidth(), await videoTrack.getDisplayHeight()]
      : null,
    typeof videoTrack.getWidth === "function" && typeof videoTrack.getHeight === "function"
      ? [await videoTrack.getWidth(), await videoTrack.getHeight()]
      : null,
    [videoTrack?.displayWidth, videoTrack?.displayHeight],
    [videoTrack?.codedWidth, videoTrack?.codedHeight],
  ];

  for (const entry of candidates) {
    if (!entry) continue;
    const width = Number(entry[0]) || 0;
    const height = Number(entry[1]) || 0;
    if (width > 0 && height > 0) {
      return { width, height };
    }
  }

  return { width: 0, height: 0 };
}

function getCurrentPlaybackTime() {
  if (state.activeEngine === "native") {
    return refs.video.currentTime || 0;
  }

  if (!mbEngine.isPlaying) {
    return playerState.currentTime;
  }
  if (mbEngine.audioSink && mbEngine.audioContext && mbEngine.audioClockStartCtxTime > 0) {
    const elapsedAudio = Math.max(
      0,
      mbEngine.audioContext.currentTime - mbEngine.audioClockStartCtxTime
    );
    return mbEngine.audioClockStartMediaTime + elapsedAudio * Math.max(0.01, playerState.playbackRate);
  }
  if (playerState.playbackRate <= 0) {
    return mbEngine.playStartMediaTime;
  }
  const elapsedSeconds = Math.max(0, (performance.now() - mbEngine.playStartPerfMs) / 1000);
  return mbEngine.playStartMediaTime + elapsedSeconds * playerState.playbackRate;
}

function syncPlaybackUi() {
  scheduleSeekUpdate();
  onPlayStateChange();
  syncMediaSessionState();
}

function onPlayStateChange() {
  const paused = playerState.paused;
  refs.playPauseBtn.setAttribute("data-state", paused ? "paused" : "playing");
  refs.playPauseBtn.setAttribute("aria-label", paused ? "Play" : "Pause");
  refs.bigPlayBtn.classList.toggle("hidden", !paused);
}

async function startPlaybackEngine() {
  if (state.activeEngine === "native") {
    if (!nativeEngine.isReady) {
      throw new Error("Native engine is not ready");
    }
    if (state.boostEnabled) {
      ensureNativeBoostGraph();
    }
    await refs.video.play();
    return;
  }

  if (!mbEngine.isReady || mbEngine.isPlaying) {
    return;
  }

  if (mbEngine.audioSink) {
    await initAudioContextIfNeeded();
  }

  mbEngine.stopToken += 1;
  const token = mbEngine.stopToken;
  mbEngine.isPlaying = true;
  playerState.paused = false;
  mbEngine.playStartMediaTime = playerState.currentTime;
  mbEngine.playStartPerfMs = performance.now();
  mbEngine.audioScheduledUntil = playerState.currentTime;
  mbEngine.audioClockStartMediaTime = playerState.currentTime;
  mbEngine.audioClockStartCtxTime = mbEngine.audioContext
    ? mbEngine.audioContext.currentTime + 0.08
    : 0;

  runMbPresentationLoop(token).catch((error) => {
    console.warn("MediaBunny presentation loop stopped", error);
  });
  startMbAudioScheduler(token);
  syncPlaybackUi();
}

function pauseMediaBunnyEngine() {
  if (!mbEngine.isReady) {
    playerState.paused = true;
    syncPlaybackUi();
    return;
  }

  if (mbEngine.isPlaying) {
    playerState.currentTime = clamp(getCurrentPlaybackTime(), 0, playerState.duration || Infinity);
  }

  mbEngine.isPlaying = false;
  playerState.paused = true;
  mbEngine.stopToken += 1;

  if (mbEngine.audioSchedulerId) {
    window.clearTimeout(mbEngine.audioSchedulerId);
    mbEngine.audioSchedulerId = 0;
  }
  clearScheduledAudioNodes();
  syncPlaybackUi();
}

function startMbAudioScheduler(token) {
  if (!mbEngine.audioSink || !mbEngine.audioContext || !mbEngine.gainNode) {
    return;
  }

  const tick = () => {
    if (!mbEngine.isPlaying || token !== mbEngine.stopToken) {
      return;
    }

    scheduleMbAudioAhead(token).catch(console.warn);
    mbEngine.audioSchedulerId = window.setTimeout(tick, 180);
  };

  tick();
}

async function scheduleMbAudioAhead(token) {
  if (!mbEngine.audioSink || !mbEngine.audioContext || !mbEngine.gainNode || !mbEngine.isPlaying) {
    return;
  }

  const horizonSeconds = 6;
  const rate = Math.max(0.01, playerState.playbackRate);
  const currentMedia = clamp(getCurrentPlaybackTime(), 0, playerState.duration || Infinity);
  const scheduleStart = Math.max(currentMedia, mbEngine.audioScheduledUntil);
  const scheduleEnd = Math.min(
    playerState.duration || currentMedia + horizonSeconds,
    currentMedia + horizonSeconds
  );

  if (scheduleEnd <= scheduleStart + 0.001) {
    return;
  }

  for await (const wrapped of mbEngine.audioSink.buffers(scheduleStart, scheduleEnd)) {
    if (!mbEngine.isPlaying || token !== mbEngine.stopToken) {
      break;
    }
    if (!wrapped?.buffer) {
      continue;
    }

    const sourceNode = mbEngine.audioContext.createBufferSource();
    sourceNode.buffer = wrapped.buffer;
    sourceNode.playbackRate.value = playerState.playbackRate;
    sourceNode.connect(mbEngine.gainNode);

    const when =
      mbEngine.audioClockStartCtxTime +
      (wrapped.timestamp - mbEngine.audioClockStartMediaTime) / rate;
    const now = mbEngine.audioContext.currentTime;
    if (when + wrapped.duration < now - 0.02) {
      // Late buffer — skip it and re-anchor the audio clock so later buffers
      // stay aligned with the presentation clock after a stall or seek.
      mbEngine.audioClockStartMediaTime = wrapped.timestamp + wrapped.duration;
      mbEngine.audioClockStartCtxTime = when + wrapped.duration / rate;
      continue;
    }
    sourceNode.start(Math.max(now + 0.005, when));
    sourceNode.onended = () => {
      mbEngine.audioNodes = mbEngine.audioNodes.filter((node) => node !== sourceNode);
    };
    mbEngine.audioNodes.push(sourceNode);
  }

  mbEngine.audioScheduledUntil = scheduleEnd;
}

async function runMbPresentationLoop(token) {
  const frames = mbEngine.canvasSink.canvases(playerState.currentTime, undefined);
  let prefetch = frames.next();
  let current = null;

  const pullFrame = async () => {
    const { value, done } = await prefetch;
    if (done) {
      prefetch = null;
      return null;
    }
    prefetch = frames.next();
    return value || null;
  };

  try {
    current = await pullFrame();
    if (!current && prefetch === null) {
      handlePlaybackEnded();
      return;
    }

    while (mbEngine.isPlaying && token === mbEngine.stopToken) {
      const now = getCurrentPlaybackTime();

      if (playerState.duration > 0 && now >= playerState.duration) {
        playerState.currentTime = playerState.duration;
        scheduleSeekUpdate();
        handlePlaybackEnded();
        return;
      }

      if (!current && prefetch === null) {
        // Frame stream ended before the duration clock did — finish up.
        handlePlaybackEnded();
        return;
      }

      if (current && current.timestamp <= now) {
        drawMbFrame(current);
        scheduleSeekUpdate();
        current = await pullFrame();
        continue;
      }

      await nextAnimationFrame();
    }
  } finally {
    try {
      await frames.return?.();
    } catch {
      // iterator already closed
    }
  }
}

function drawMbFrame(wrappedCanvas) {
  if (!wrappedCanvas?.canvas) {
    return;
  }

  const renderTarget = refs.videoCanvas;
  const sourceCanvas = wrappedCanvas.canvas;
  const width = Number(sourceCanvas.width) || 0;
  const height = Number(sourceCanvas.height) || 0;

  if (width > 0 && height > 0 && (renderTarget.width !== width || renderTarget.height !== height)) {
    renderTarget.width = width;
    renderTarget.height = height;
  }

  const context = renderTarget.getContext("2d");
  if (!context || !width || !height) {
    return;
  }
  context.drawImage(sourceCanvas, 0, 0, width, height);
}

async function renderMbFrameAt(timestamp) {
  if (!mbEngine.canvasSink) {
    return;
  }
  const wrappedCanvas = await mbEngine.canvasSink.getCanvas(Math.max(0, timestamp));
  if (wrappedCanvas) {
    drawMbFrame(wrappedCanvas);
  }
}

function nextAnimationFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function seekPlaybackEngine(targetTimeSeconds, options = {}) {
  const target = clamp(targetTimeSeconds, 0, playerState.duration || targetTimeSeconds || 0);
  const shouldResume =
    typeof options.resume === "boolean" ? options.resume : !playerState.paused;

  if (state.activeEngine === "native") {
    playerState.currentTime = target;
    try {
      refs.video.currentTime = target;
    } catch {
      // ignore invalid seek
    }
    scheduleSeekUpdate();
    return;
  }

  if (!mbEngine.isReady) {
    playerState.currentTime = target;
    scheduleSeekUpdate();
    return;
  }

  pauseMediaBunnyEngine();
  if (scrubPreviewTimer) {
    window.clearTimeout(scrubPreviewTimer);
    scrubPreviewTimer = 0;
  }
  scrubPreviewPendingTime = -1;
  playerState.currentTime = target;
  try {
    await renderMbFrameAt(target);
  } catch {
    // ignore transient preview errors
  }
  scheduleSeekUpdate();

  if (shouldResume) {
    await startPlaybackEngine();
  } else {
    syncPlaybackUi();
  }
}

function handlePlaybackEnded() {
  pauseMediaBunnyEngine();
  playerState.currentTime = playerState.duration || playerState.currentTime;
  scheduleSeekUpdate();
  onVideoEnded();
}

let videoLoadSequence = Promise.resolve();

function loadVideoAtIndex(index, options = {}) {
  // Serialize loads: back-to-back clicks must never run two engines at once,
  // otherwise click A's async prepare/teardown can interleave with click B's
  // and leave both audio timelines running together.
  const run = Promise.resolve(videoLoadSequence).then(() => {
    stopPlayback();
    return loadVideoAtIndexNow(index, options);
  });
  videoLoadSequence = run.catch(() => {
    // keep the queue alive; failures were already surfaced
  });
  return run;
}

async function loadVideoAtIndexNow(index, options = {}) {
  if (index < 0 || index >= state.videos.length) {
    return;
  }

  const videoMeta = state.videos[index];
  const rankedSources = rankSources(videoMeta.sources);

  const previousVideo = state.videos[state.currentVideoIndex];
  const previousKey = state.currentVideoIndex >= 0 && previousVideo ? previousVideo.id : "";
  maybePersistResume(previousKey);

  state.currentVideoIndex = index;
  refs.nowPlayingTitle.textContent = videoMeta.title;
  refs.nowPlayingStats.textContent = buildNowPlayingStats(videoMeta);
  setActiveCard(index);

  resetZoom();

  const resumeSeconds = !options.resetPosition
    ? Number(state.resumeMap[videoMeta.id] || 0)
    : 0;

  const startEngine = decideStartEngine(rankedSources);
  let engine = startEngine;

  const tryLoad = async (candidateEngine) => {
    if (candidateEngine === "native") {
      await prepareNativePlayback(rankedSources[0], resumeSeconds > 2 ? resumeSeconds : 0);
    } else {
      await prepareMediaBunnyPlayback(rankedSources[0], resumeSeconds > 2 ? resumeSeconds : 0);
    }
    setEngineUi(candidateEngine);
  };

  try {
    await tryLoad(engine);
  } catch (error) {
    const fallbackEngine = engine === "native" ? "mediabunny" : "native";
    console.warn(`VideoPlayer: ${engine} engine failed, falling back`, error);
    try {
      await tryLoad(fallbackEngine);
      engine = fallbackEngine;
    } catch (fallbackError) {
      console.error("VideoPlayer: both playback engines failed", fallbackError);
      refs.nowPlayingStats.textContent = `${buildNowPlayingStats(videoMeta)} | Load failed`;
      showToast("Could not load this video with either engine");
      return;
    }
  }

  playerState.currentTime = engine === "native" ? refs.video.currentTime || 0 : playerState.currentTime;
  if (playerState.duration > 0 && !videoMeta.duration) {
    videoMeta.duration = playerState.duration;
  }
  refs.totalTimeLabel.textContent = formatDuration(playerState.duration || 0);
  refs.currentTimeLabel.textContent = formatDuration(playerState.currentTime || 0);

  if (options.autoplay) {
    revealPlayer();
    try {
      await startPlaybackEngine();
    } catch (error) {
      console.warn("Autoplay blocked", error);
      playerState.paused = true;
      syncPlaybackUi();
    }
  } else {
    playerState.paused = true;
    if (engine === "mediabunny") {
      await renderMbFrameAt(playerState.currentTime || 0);
    }
    syncPlaybackUi();
  }

  updateMediaSessionMetadata();

  saveCurrentVideoPreference(videoMeta.id);
}

function decideStartEngine(rankedSources) {
  const nativeCapable = rankedSources.some((source) => source.score > 0);
  return nativeCapable ? "native" : "mediabunny";
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

function revealPlayer() {
  if (!state.theaterMode) {
    return;
  }
  const panelRect = refs.playerPanel.getBoundingClientRect();
  if (panelRect.top >= 0) {
    return;
  }
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  refs.playerPanel.scrollIntoView({
    behavior: reduceMotion ? "auto" : "smooth",
    block: "start",
  });
}

function saveCurrentVideoPreference(id) {
  localStorage.setItem("vp_current_video_id", id);
}

function buildNowPlayingStats(videoMeta) {
  const bits = [];
  bits.push(videoMeta.duration > 0 ? formatDuration(videoMeta.duration) : "--:--");
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

function togglePlayback() {
  if (state.activeEngine === "native" && !nativeEngine.isReady) {
    return;
  }
  if (state.activeEngine === "mediabunny" && !mbEngine.isReady) {
    return;
  }

  if (playerState.paused) {
    startPlaybackEngine().catch((error) => {
      console.warn("Playback could not start", error);
    });
  } else {
    if (state.activeEngine === "native") {
      refs.video.pause();
    } else {
      pauseMediaBunnyEngine();
    }
  }
}

async function fallbackToMediaBunnyEngine() {
  const videoMeta = state.videos[state.currentVideoIndex];
  if (!videoMeta) {
    return;
  }

  const resumeSeconds = playerState.currentTime || 0;
  try {
    await prepareMediaBunnyPlayback(chooseBestSource(videoMeta.sources), resumeSeconds);
    setEngineUi("mediabunny");
    await startPlaybackEngine();
  } catch (error) {
    console.error("VideoPlayer: MediaBunny fallback failed", error);
  }
}

function scheduleSeekUpdate() {
  if (seekRAF) {
    return;
  }
  seekRAF = requestAnimationFrame(() => {
    seekRAF = 0;
    const duration = playerState.duration || 0;
    const current = clamp(getCurrentPlaybackTime(), 0, duration || Infinity);
    if (!state.isScrubbing) {
      playerState.currentTime = current;
      const ratio = duration > 0 ? current / duration : 0;
      refs.seekSlider.value = String(Math.round(ratio * 1000));
      syncRangeFill(refs.seekSlider);
      refs.currentTimeLabel.textContent = formatDuration(current);
    } else {
      refs.currentTimeLabel.textContent = formatDuration(playerState.currentTime || 0);
    }
    refs.totalTimeLabel.textContent =
      state.showRemaining && duration > 0
        ? `-${formatDuration(Math.max(0, duration - current))}`
        : formatDuration(duration);
    updateBufferBar();

    const currentVideo = state.videos[state.currentVideoIndex];
    if (currentVideo) {
      maybePersistResume(currentVideo.id);
    }
  });
  syncMediaSessionState();
}

function syncRangeFill(input) {
  const min = Number(input.min) || 0;
  const max = Number(input.max) || 100;
  const value = Number(input.value) || 0;
  const ratio = max > min ? ((value - min) / (max - min)) * 100 : 0;
  input.style.setProperty("--fill", `${clamp(ratio, 0, 100)}%`);
}

function onTimelineHover(event) {
  if (!(playerState.duration > 0) || state.isScrubbing || state.isDraggingZoom) {
    return;
  }
  const rect = refs.seekSlider.getBoundingClientRect();
  const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  const time = ratio * playerState.duration;

  refs.hoverTimeLabel.textContent = formatDuration(time);
  refs.hoverPreview.hidden = false;

  const wrapRect = refs.timelineWrap.getBoundingClientRect();
  const x = clamp(event.clientX - wrapRect.left, 60, Math.max(60, wrapRect.width - 60));
  refs.hoverPreview.style.left = `${Math.round(x)}px`;

  const thumbCapable =
    state.activeEngine === "native" ||
    (state.activeEngine === "mediabunny" && mbEngine.isReady && !mbEngine.isPlaying);
  if (thumbCapable && Math.abs(time - hoverFrameLastTime) > 0.2) {
    hoverFrameLatestTime = time;
    queueHoverFramePreview();
  } else if (!thumbCapable) {
    hideHoverThumbnail();
  }
}

function onTimelineHoverLeave() {
  refs.hoverPreview.hidden = true;
  hideHoverThumbnail();
  hoverFrameLastTime = -1;
}

const hoverProbeVideo = document.createElement("video");
hoverProbeVideo.preload = "metadata";
hoverProbeVideo.muted = true;
hoverProbeVideo.playsInline = true;
hoverProbeVideo.crossOrigin = "anonymous";
hoverProbeVideo.style.display = "none";

let hoverProbeSrc = "";
let hoverProbeLoading = null;
let hoverProbeLastSeekedAt = -1;
let hoverFrameLastTime = -1;
let hoverFrameLatestTime = -1;
let hoverFrameQueuedTime = -1;
let hoverFrameChain = Promise.resolve();

function hideHoverThumbnail() {
  refs.hoverPreviewCanvas.parentElement.hidden = true;
}

function queueHoverFramePreview() {
  const time = hoverFrameLatestTime;
  if (time < 0 || time === hoverFrameQueuedTime) {
    return;
  }
  hoverFrameQueuedTime = time;
  hoverFrameChain = hoverFrameChain
    .then(() => renderHoverFrame(time))
    .catch(() => hideHoverThumbnail());
}

function probeWaitEvent(target, event, timeoutMs) {
  return new Promise((resolve) => {
    const onEvent = () => settle(true);
    const settle = (value) => {
      target.removeEventListener(event, onEvent);
      window.clearTimeout(timer);
      resolve(value);
    };
    const timer = window.setTimeout(() => settle(false), timeoutMs);
    target.addEventListener(event, onEvent, { once: true });
  });
}

async function ensureHoverProbeLoaded(src) {
  if (
    hoverProbeSrc === src &&
    Number.isFinite(hoverProbeVideo.duration) &&
    hoverProbeVideo.duration > 0
  ) {
    return true;
  }
  hoverProbeLoading = (async () => {
    hoverProbeVideo.removeAttribute("src");
    hoverProbeSrc = src;
    hoverProbeVideo.src = src;
    return probeWaitEvent(hoverProbeVideo, "loadedmetadata", 5000);
  })();
  const ok = await hoverProbeLoading;
  hoverProbeLoading = ok;
  return ok;
}

async function renderHoverFrame(time) {
  if (refs.hoverPreview.hidden || state.isScrubbing) {
    return;
  }

  if (state.activeEngine === "mediabunny") {
    if (!mbEngine.isReady || !mbEngine.canvasSink || mbEngine.isPlaying) {
      hideHoverThumbnail();
      return;
    }
    const wrapped = await mbEngine.canvasSink.getCanvas(Math.max(0, time));
    if (refs.hoverPreview.hidden || state.isScrubbing || !wrapped?.canvas) {
      return;
    }
    drawHoverPreviewFromFrame(
      wrapped.canvas,
      Number(wrapped.canvas.width) || 0,
      Number(wrapped.canvas.height) || 0
    );
    return;
  }

  const videoMeta = state.videos[state.currentVideoIndex];
  const src = chooseBestSource(videoMeta?.sources || [])?.src || refs.video.src;
  if (!src || !(await ensureHoverProbeLoaded(src))) {
    hideHoverThumbnail();
    return;
  }
  if (refs.hoverPreview.hidden || state.isScrubbing) {
    return;
  }
  let changed;
  try {
    changed = Math.abs(hoverProbeLastSeekedAt - time) > 0.001;
    if (changed) {
      hoverProbeLastSeekedAt = time;
      hoverProbeVideo.currentTime = Math.max(0, time);
    }
  } catch {
    return;
  }
  const seekEventOk = changed ? await probeWaitEvent(hoverProbeVideo, "seeked", 2000) : true;
  if (!seekEventOk || refs.hoverPreview.hidden || state.isScrubbing) {
    return;
  }
  drawHoverPreviewFromFrame(
    hoverProbeVideo,
    Number(hoverProbeVideo.videoWidth) || 0,
    Number(hoverProbeVideo.videoHeight) || 0
  );
}

function drawHoverPreviewFromFrame(source, sourceW, sourceH) {
  if (!(sourceW > 0) || !(sourceH > 0)) {
    hideHoverThumbnail();
    return;
  }
  const canvas = refs.hoverPreviewCanvas;
  const container = canvas.parentElement;
  const targetW = 240;
  const targetH = Math.round(targetW / (sourceW / sourceH));
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }
  const context = canvas.getContext("2d");
  if (!context) {
    hideHoverThumbnail();
    return;
  }
  context.drawImage(source, 0, 0, targetW, targetH);
  if (container) {
    container.hidden = false;
  }
}

function updateBufferBar() {
  const bar = refs.bufferBar;
  if (state.activeEngine !== "native" || !(playerState.duration > 0)) {
    bar.hidden = true;
    return;
  }
  const buffered = refs.video.buffered;
  const now = refs.video.currentTime;
  let start = 0;
  let end = 0;
  for (let i = 0; i < buffered.length; i += 1) {
    if (buffered.start(i) <= now && buffered.end(i) >= now) {
      start = buffered.start(i);
      end = buffered.end(i);
      break;
    }
  }
  const duration = playerState.duration;
  if (end - start > 0.2) {
    bar.hidden = false;
    bar.style.left = `${clamp((start / duration) * 100, 0, 100)}%`;
    bar.style.width = `${clamp(((end - start) / duration) * 100, 0, 100)}%`;
  } else {
    bar.hidden = true;
  }
}

function toggleRemainingTime() {
  state.showRemaining = !state.showRemaining;
  localStorage.setItem("vp_show_remaining", state.showRemaining ? "1" : "0");
  scheduleSeekUpdate();
}

function onSortChange() {
  const value = refs.sortSelect.value;
  if (!SORT_KEYS.includes(value)) {
    return;
  }
  state.sortKey = value;
  localStorage.setItem("vp_sort", value);
  renderLibrary();
}

function applySortToIndices(indices) {
  const parts = state.sortKey.split("-");
  const field = parts[0];
  const direction = parts[1] === "desc" ? -1 : 1;
  const readValue = {
    title: (video) => video.title.toLowerCase(),
    duration: (video) => video.duration,
    date: (video) => video.createdAt || "",
    size: (video) => video.sizeBytes,
  }[field];

  if (!readValue) {
    return indices.slice();
  }

  const indexed = indices.map((index) => ({ index, video: state.videos[index] }));
  indexed.sort((a, b) => {
    const compareResult = compareSortValues(readValue(a.video), readValue(b.video)) * direction;
    if (compareResult !== 0) {
      return compareResult;
    }
    return a.video.title.toLowerCase().localeCompare(b.video.title.toLowerCase());
  });
  return indexed.map((entry) => entry.index);
}

function compareSortValues(a, b) {
  if (typeof a === "number" && typeof b === "number") {
    if (Math.abs(a - b) < 1e-9) {
      return 0;
    }
    return a < b ? -1 : 1;
  }
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

function onBoostToggle() {
  state.boostEnabled = refs.boostToggle.checked;
  localStorage.setItem("vp_volume_boost", state.boostEnabled ? "1" : "0");
  if (state.boostEnabled && state.activeEngine === "native" && nativeEngine.isReady) {
    ensureNativeBoostGraph();
  }
  onVolumeChange();
  if (state.boostEnabled) {
    showToast(`Volume boost x${VOLUME_BOOST_MULTIPLIER} active`);
  }
}

function ensureNativeBoostGraph() {
  if (nativeEngine.audioGain) {
    if (nativeEngine.audioContext?.state === "suspended") {
      nativeEngine.audioContext.resume().catch(() => {
        // will retry on next play gesture
      });
    }
    return;
  }
  try {
    const context = new AudioContext();
    const sourceNode = context.createMediaElementSource(refs.video);
    const gainNode = context.createGain();
    sourceNode.connect(gainNode);
    gainNode.connect(context.destination);
    nativeEngine.audioContext = context;
    nativeEngine.audioGain = gainNode;
  } catch (error) {
    console.warn("Volume boost unavailable", error);
    showToast("Volume boost is not available for this video");
    state.boostEnabled = false;
    refs.boostToggle.checked = false;
    localStorage.setItem("vp_volume_boost", "0");
  }
}

function showToast(message, timeoutMs = 3500) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  refs.toastStack.appendChild(toast);
  window.setTimeout(() => {
    toast.classList.add("leaving");
    window.setTimeout(() => {
      toast.remove();
    }, 220);
  }, timeoutMs);
}

function adjustVolume(delta) {
  const nextVolume = clamp(playerState.volume + delta, 0, 1);
  if (delta > 0 && playerState.muted) {
    playerState.muted = false;
  }
  playerState.volume = nextVolume;
  onVolumeChange();
}

function stepFrame(direction) {
  if (!(playerState.duration > 0)) {
    return;
  }
  if (state.activeEngine === "native" && !nativeEngine.isReady) {
    return;
  }
  if (state.activeEngine === "mediabunny" && !mbEngine.isReady) {
    return;
  }

  const fps = getTrackFrameRate();
  const stepSeconds = direction * (fps > 0 ? 1 / fps : 1 / 30);
  const target = clamp(playerState.currentTime + stepSeconds, 0, playerState.duration);

  if (state.activeEngine === "native") {
    try {
      refs.video.pause();
    } catch {
      // ignore
    }
    playerState.paused = true;
  } else {
    pauseMediaBunnyEngine();
  }
  seekPlaybackEngine(target, { resume: false }).catch(console.warn);
}

function getTrackFrameRate() {
  if (state.activeEngine === "mediabunny" && mbEngine.videoTrack) {
    const candidates = [
      mbEngine.videoTrack.fps,
      mbEngine.videoTrack.estimationFps,
      mbEngine.videoTrack.frameRate,
      mbEngine.videoTrack?.decoderConfig?.framerate,
    ];
    for (const value of candidates) {
      const fps = Number(value);
      if (Number.isFinite(fps) && fps > 1 && fps < 240) {
        return fps;
      }
    }
  }
  return 0;
}

function onSeekInput() {
  if (!(playerState.duration > 0)) {
    return;
  }
  syncRangeFill(refs.seekSlider);
  const ratio = Number(refs.seekSlider.value) / 1000;
  const target = ratio * playerState.duration;
  state.scrubTargetTime = clamp(target, 0, playerState.duration || target || 0);

  if (state.isScrubbing) {
    playerState.currentTime = state.scrubTargetTime;
    refs.currentTimeLabel.textContent = formatDuration(state.scrubTargetTime);
    if (state.activeEngine === "mediabunny") {
      queueScrubPreview(state.scrubTargetTime);
    } else {
      try {
        refs.video.currentTime = state.scrubTargetTime;
      } catch {
        // ignore
      }
    }
    return;
  }

  seekPlaybackEngine(state.scrubTargetTime).catch(console.warn);
}

function onSeekPointerDown(event) {
  if (!(playerState.duration > 0)) {
    return;
  }
  state.isScrubbing = true;
  state.scrubResumeAfterSeek = !playerState.paused;
  state.scrubPointerId = event.pointerId;
  refs.hoverPreview.hidden = true;
  try {
    refs.seekSlider.setPointerCapture(event.pointerId);
  } catch {
    // ignore capture errors
  }
  if (state.activeEngine === "native") {
    try {
      refs.video.pause();
    } catch {
      // ignore
    }
  } else {
    pauseMediaBunnyEngine();
  }
}

function onSeekPointerUp(event) {
  if (!state.isScrubbing) {
    return;
  }
  if (state.scrubPointerId !== null && event.pointerId !== state.scrubPointerId) {
    return;
  }
  try {
    if (refs.seekSlider.hasPointerCapture(event.pointerId)) {
      refs.seekSlider.releasePointerCapture(event.pointerId);
    }
  } catch {
    // ignore capture errors
  }
  onSeekCommit();
}

function onSeekCommit() {
  const ratio = Number(refs.seekSlider.value) / 1000;
  const target = clamp(ratio * playerState.duration, 0, playerState.duration || 0);
  const shouldResume = state.isScrubbing ? state.scrubResumeAfterSeek : !playerState.paused;
  state.isScrubbing = false;
  state.scrubResumeAfterSeek = false;
  state.scrubPointerId = null;
  seekPlaybackEngine(target, { resume: shouldResume }).catch(console.warn);
}

function queueScrubPreview(targetTime) {
  scrubPreviewPendingTime = targetTime;
  if (scrubPreviewTimer) {
    return;
  }

  scrubPreviewTimer = window.setTimeout(async () => {
    scrubPreviewTimer = 0;
    const snapshot = scrubPreviewPendingTime;
    if (!mbEngine.isReady || !state.isScrubbing || !(snapshot >= 0)) {
      return;
    }

    try {
      await renderMbFrameAt(snapshot);
    } catch {
      // ignore transient preview errors
    }

    if (state.isScrubbing && Math.abs(scrubPreviewPendingTime - snapshot) > 0.001) {
      queueScrubPreview(scrubPreviewPendingTime);
    }
  }, 45);
}

function onVideoEnded() {
  if (state.repeatCurrent) {
    seekPlaybackEngine(0, { resume: true }).catch(console.warn);
    return;
  }
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
  playerState.muted = !playerState.muted;
  onVolumeChange();
}

function onVolumeInput() {
  playerState.volume = clamp(Number(refs.volumeSlider.value), 0, 1);
  playerState.muted = playerState.volume === 0;
  onVolumeChange();
}

function onVolumeChange() {
  const volume = playerState.muted ? 0 : playerState.volume;
  refs.volumeSlider.value = String(volume);
  syncRangeFill(refs.volumeSlider);
  refs.muteBtn.setAttribute("data-level", volume === 0 ? "mute" : volume < 0.5 ? "low" : "high");
  refs.muteBtn.setAttribute("aria-label", volume === 0 ? "Unmute" : "Mute");
  if (state.activeEngine === "native") {
    refs.video.volume = volume;
    refs.video.muted = playerState.muted;
    if (nativeEngine.audioGain) {
      nativeEngine.audioGain.gain.value = state.boostEnabled ? VOLUME_BOOST_MULTIPLIER : 1;
    }
  }
  if (mbEngine.gainNode) {
    mbEngine.gainNode.gain.value = state.boostEnabled
      ? volume * VOLUME_BOOST_MULTIPLIER
      : volume;
  }

  localStorage.setItem("vp_volume", String(playerState.volume));
  localStorage.setItem("vp_muted", playerState.muted ? "1" : "0");
}

function toggleTheaterMode() {
  state.theaterMode = !state.theaterMode;
  refs.appShell.classList.toggle("theater", state.theaterMode);
  localStorage.setItem("vp_theater_mode", state.theaterMode ? "1" : "0");
  onViewportChange();
}

function getFullscreenElement() {
  return (
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement ||
    null
  );
}

function exitFullscreenCompat() {
  if (document.exitFullscreen) {
    return document.exitFullscreen();
  }
  if (document.webkitExitFullscreen) {
    return document.webkitExitFullscreen();
  }
  if (document.msExitFullscreen) {
    return document.msExitFullscreen();
  }
  return Promise.reject(new Error("No fullscreen exit API"));
}

function requestFullscreenCompat(target) {
  if (target?.requestFullscreen) {
    return target.requestFullscreen();
  }
  if (target?.webkitRequestFullscreen) {
    return target.webkitRequestFullscreen();
  }
  if (target?.mozRequestFullScreen) {
    return target.mozRequestFullScreen();
  }
  if (target?.msRequestFullscreen) {
    return target.msRequestFullscreen();
  }
  return Promise.reject(new Error("No fullscreen API"));
}

async function enterFullscreenOnPlayer() {
  try {
    await requestFullscreenCompat(refs.playerPanel);
    return true;
  } catch {
    // e.g. iOS Safari: element fullscreen is not supported outside <video>
  }

  // iOS Safari fallback: the native <video> element can always go fullscreen
  // when it is what is playing (and the call happens inside a user gesture).
  const nativeVideo = refs.video;
  if (
    state.activeEngine === "native" &&
    nativeEngine.isReady &&
    typeof nativeVideoWebKitEnter === "function"
  ) {
    try {
      nativeVideoWebKitEnter();
      return true;
    } catch {
      // fall through
    }
  }

  return false;
}

function nativeVideoWebKitEnter() {
  const fn = refs.video.webkitEnterFullscreen || refs.video.enterFullscreen;
  if (typeof fn !== "function") {
    throw new Error("Video fullscreen unavailable");
  }
  return fn.call(refs.video);
}

async function toggleFullscreen() {
  if (getFullscreenElement()) {
    await exitFullscreenCompat().catch(() => {
      // ignore exit failures
    });
    return;
  }

  const entered = await enterFullscreenOnPlayer();
  if (!entered) {
    showToast("Fullscreen is not available on this device/browser");
  }
}

function onFullscreenChange() {
  const isFullscreen = Boolean(getFullscreenElement());
  refs.fullscreenBtn.setAttribute("data-state", isFullscreen ? "exit" : "enter");
  refs.fullscreenBtn.setAttribute(
    "aria-label",
    isFullscreen ? "Exit fullscreen" : "Fullscreen"
  );
  onViewportChange();
}

function toggleSettingsPanel() {
  state.settingsOpen = !state.settingsOpen;
  refs.settingsPanel.hidden = !state.settingsOpen;
  refs.settingsBtn.setAttribute("aria-expanded", state.settingsOpen ? "true" : "false");
  refs.settingsBtn.setAttribute("data-state", state.settingsOpen ? "open" : "closed");
  if (state.settingsOpen) {
    positionSettingsPanel();
  }
}

function closeSettingsPanel() {
  state.settingsOpen = false;
  refs.settingsPanel.hidden = true;
  refs.settingsBtn.setAttribute("aria-expanded", "false");
  refs.settingsBtn.setAttribute("data-state", "closed");
}

function toggleHelpDialog() {
  if (refs.helpDialog.open) {
    refs.helpDialog.close();
  } else {
    refs.helpDialog.showModal();
  }
}

function onViewportChange() {
  updateVideoStageSize();
  syncLibraryPanelHeight();
  if (!state.settingsOpen) {
    return;
  }
  positionSettingsPanel();
}

const LIBRARY_STACKED_BREAKPOINT = 1080;

function syncLibraryPanelHeight() {
  const library = refs.libraryPanel;
  if (!library) {
    return;
  }
  const skip =
    state.theaterMode ||
    window.innerWidth <= LIBRARY_STACKED_BREAKPOINT ||
    !state.videos.length ||
    !refs.playerPanel.offsetHeight;
  if (skip) {
    library.style.maxHeight = "";
    return;
  }
  // Match the library sidebar to the player's height so the two panels form
  // one tidy block instead of the sidebar stretching past the viewport.
  library.style.maxHeight = `${refs.playerPanel.offsetHeight}px`;
}

function positionSettingsPanel() {
  const panel = refs.settingsPanel;
  const buttonRect = refs.settingsBtn.getBoundingClientRect();
  const playerRect = refs.playerPanel.getBoundingClientRect();
  const anchorGap = 10;

  panel.hidden = false;
  panel.style.visibility = "hidden";
  panel.style.left = "0px";
  panel.style.top = "0px";

  const panelRect = panel.getBoundingClientRect();
  let left = buttonRect.right - playerRect.left - panelRect.width;
  let top = buttonRect.top - playerRect.top - panelRect.height - anchorGap;

  if (top < anchorGap) {
    top = Math.min(
      playerRect.height - panelRect.height - anchorGap,
      buttonRect.bottom - playerRect.top + anchorGap
    );
  }
  left = clamp(left, anchorGap, Math.max(anchorGap, playerRect.width - panelRect.width - anchorGap));

  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
  panel.style.visibility = "visible";
}

function onDocumentPointerDown(event) {
  if (!state.settingsOpen) {
    return;
  }
  const path = typeof event.composedPath === "function" ? event.composedPath() : [];
  if (path.includes(refs.settingsPanel) || path.includes(refs.settingsBtn)) {
    return;
  }
  closeSettingsPanel();
}

function onSpeedChange() {
  const speed = Number(refs.speedSelect.value) || 1;
  playerState.playbackRate = speed;
  localStorage.setItem("vp_speed", String(speed));

  if (state.activeEngine === "native") {
    refs.video.playbackRate = speed;
  } else if (mbEngine.isPlaying) {
    const current = getCurrentPlaybackTime();
    seekPlaybackEngine(current).catch(console.warn);
  }
}

function onAutoplayToggle() {
  state.autoplayNext = refs.autoplayToggle.checked;
  localStorage.setItem("vp_autoplay_next", state.autoplayNext ? "1" : "0");
}

function onRepeatToggle() {
  state.repeatCurrent = refs.repeatToggle.checked;
  localStorage.setItem("vp_repeat_current", state.repeatCurrent ? "1" : "0");
}

function onZoomSliderInput() {
  syncRangeFill(refs.zoomSlider);
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
    syncRangeFill(refs.zoomSlider);
  }
  applyZoomTransform();
}

function resetZoom() {
  state.zoomEnabled = false;
  state.zoomScale = 1;
  state.zoomX = 0;
  state.zoomY = 0;
  refs.zoomSlider.value = "1";
  syncRangeFill(refs.zoomSlider);
  applyZoomTransform();
}

function applyZoomTransform() {
  const scale = state.zoomEnabled ? state.zoomScale : 1;
  const x = state.zoomEnabled ? state.zoomX : 0;
  const y = state.zoomEnabled ? state.zoomY : 0;

  refs.zoomLayer.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  refs.zoomToggleBtn.setAttribute("data-active", state.zoomEnabled ? "true" : "false");
}

function onZoomPointerDown(event) {
  if (!state.zoomEnabled || state.zoomScale <= 1) {
    return;
  }
  state.isDraggingZoom = true;
  state.panMoved = false;
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

  if (dx !== 0 || dy !== 0) {
    state.panMoved = true;
  }
  state.zoomX += dx;
  state.zoomY += dy;
  clampZoomOffsets();
  applyZoomTransform();
}

function onZoomPointerUp(event) {
  if (!state.isDraggingZoom) {
    return;
  }
  const panned = state.panMoved;
  state.isDraggingZoom = false;
  state.panMoved = false;
  if (panned) {
    lastPanEndTime = Date.now();
  }
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

  syncRangeFill(refs.zoomSlider);
  applyZoomTransform();
}

function clampZoomOffsets() {
  const rect = refs.videoStage.getBoundingClientRect();
  const maxX = ((state.zoomScale - 1) * rect.width) / 2;
  const maxY = ((state.zoomScale - 1) * rect.height) / 2;
  state.zoomX = clamp(state.zoomX, -maxX, maxX);
  state.zoomY = clamp(state.zoomY, -maxY, maxY);
}

async function toggleMiniPlayer() {
  if (state.activeEngine !== "native") {
    showToast("Mini player requires the native engine");
    return;
  }

  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture?.();
    } else {
      await refs.video.requestPictureInPicture?.();
    }
  } catch (error) {
    console.warn("Picture-in-Picture failed", error);
  }
}

function onSearchInput() {
  state.searchTerm = refs.searchInput.value.trim();
  renderLibrary();
}

function onStageClick(event) {
  const target = event.target;
  if (!event.isTrusted) {
    return;
  }
  if (target.closest("#playerOverlay")) {
    return;
  }
  if (target.closest("#bigPlayBtn")) {
    return;
  }
  if (event.detail === 2) {
    return;
  }
  if (state.isDraggingZoom || Date.now() - lastPanEndTime < 250) {
    return;
  }
  togglePlayback();
}

function onStageDoubleClick(event) {
  const target = event.target;
  if (!event.isTrusted) {
    return;
  }
  if (target.closest("#playerOverlay")) {
    return;
  }
  if (state.isDraggingZoom || Date.now() - lastPanEndTime < 250) {
    return;
  }
  toggleFullscreen().catch(console.warn);
}

function onNativeLoadedMetadata() {
  if (state.activeEngine !== "native" || !nativeEngine.isReady) {
    return;
  }
  playerState.duration = Number(refs.video.duration) || 0;
  updateVideoStageAspect(refs.video.videoWidth, refs.video.videoHeight);

  const current = state.videos[state.currentVideoIndex];
  if (current) {
    if (!current.duration && playerState.duration > 0) {
      current.duration = playerState.duration;
    }
    if (!current.resolution && refs.video.videoWidth > 0) {
      current.resolution = `${refs.video.videoWidth}x${refs.video.videoHeight}`;
    }
  }
  scheduleLibraryRender();
  scheduleSeekUpdate();
}

function onNativeTimeUpdate() {
  if (state.activeEngine !== "native") {
    return;
  }
  playerState.currentTime = refs.video.currentTime || 0;
  scheduleSeekUpdate();
}

function onNativeEnded() {
  if (state.activeEngine !== "native") {
    return;
  }
  playerState.paused = true;
  syncPlaybackUi();
  onVideoEnded();
}

function onNativePlay() {
  if (state.activeEngine !== "native") {
    return;
  }
  playerState.paused = false;
  if (
    state.boostEnabled &&
    nativeEngine.audioContext &&
    nativeEngine.audioContext.state === "suspended"
  ) {
    nativeEngine.audioContext.resume().catch(() => {
      // gesture-less play; retry on next interaction
    });
  }
  syncPlaybackUi();
}

function onNativePause() {
  if (state.activeEngine !== "native") {
    return;
  }
  playerState.paused = true;
  syncPlaybackUi();
}

function onNativeError() {
  // During initial load, the prepare flow's own error handling picks the
  // fallback engine — only react to errors mid-playback here.
  if (
    state.activeEngine !== "native" ||
    !nativeEngine.isReady ||
    nativeEngine.errorFallbackRunning
  ) {
    return;
  }
  nativeEngine.errorFallbackRunning = true;
  fallbackToMediaBunnyEngine().finally(() => {
    nativeEngine.errorFallbackRunning = false;
  });
}

function onKeyDown(event) {
  if (event.key === "Escape") {
    if (state.settingsOpen) {
      closeSettingsPanel();
      return;
    }
    if (refs.helpDialog.open) {
      toggleHelpDialog();
      return;
    }
  }

  if (refs.helpDialog.open) {
    return;
  }

  const activeTag = document.activeElement?.tagName;
  const typing = activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT";

  if (event.key === "/" && !typing) {
    event.preventDefault();
    refs.searchInput.focus();
    return;
  }

  if (event.key === "?" || (event.key === "/" && event.shiftKey)) {
    event.preventDefault();
    toggleHelpDialog();
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
    const next = Math.min(getCurrentPlaybackTime() + 5, playerState.duration || Infinity);
    seekPlaybackEngine(next).catch(console.warn);
    return;
  }

  if (event.key === "ArrowLeft") {
    const prev = Math.max(getCurrentPlaybackTime() - 5, 0);
    seekPlaybackEngine(prev).catch(console.warn);
    return;
  }

  if (event.code === "ArrowUp") {
    event.preventDefault();
    adjustVolume(0.05);
    return;
  }

  if (event.code === "ArrowDown") {
    event.preventDefault();
    adjustVolume(-0.05);
    return;
  }

  if (event.key === "," || event.code === "Comma") {
    event.preventDefault();
    stepFrame(-1);
    return;
  }

  if (event.key === "." || event.code === "Period") {
    event.preventDefault();
    stepFrame(1);
    return;
  }

  if (event.key.toLowerCase() === "m") {
    toggleMute();
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

function pruneResumeMap() {
  const RESUME_CAP = 300;
  const ids = Object.keys(state.resumeMap);
  if (ids.length <= RESUME_CAP) {
    return;
  }
  const knownIds = new Set(state.videos.map((video) => video.id));
  for (const id of ids) {
    if (Object.keys(state.resumeMap).length <= RESUME_CAP) {
      break;
    }
    if (!knownIds.has(id)) {
      delete state.resumeMap[id];
    }
  }
  // Fall back to dropping arbitrary oldest-by-insertion entries if still over cap.
  while (Object.keys(state.resumeMap).length > RESUME_CAP) {
    delete state.resumeMap[Object.keys(state.resumeMap)[0]];
  }
  try {
    localStorage.setItem("vp_resume_map", JSON.stringify(state.resumeMap));
  } catch {
    // storage may be full or unavailable
  }
}

function maybePersistResume(videoId) {
  const currentTime = getCurrentPlaybackTime();
  if (!videoId || !Number.isFinite(currentTime)) {
    return;
  }

  const now = Date.now();
  if (now - (lastResumeWrite[videoId] || 0) < 1000) {
    return;
  }
  lastResumeWrite[videoId] = now;

  const current = currentTime;
  const duration = playerState.duration || 0;

  if (duration > 0 && current > duration - 3) {
    state.resumeMap[videoId] = 0;
  } else {
    state.resumeMap[videoId] = Math.max(0, current);
  }

  localStorage.setItem("vp_resume_map", JSON.stringify(state.resumeMap));
}

function setEngineUi(engine) {
  state.activeEngine = engine;
  refs.videoStage.dataset.engine = engine;
  refs.miniPlayerBtn.disabled = engine !== "native";
  if (engine === "native") {
    refs.video.hidden = false;
    refs.videoCanvas.hidden = true;
  } else {
    refs.video.hidden = true;
    refs.videoCanvas.hidden = false;
  }
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
