import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".ogg", ".ogv", ".mov", ".m4v", ".mkv"]);
const POSTER_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

const cwd = process.cwd();
const videoDir = path.resolve(cwd, process.argv[2] || "videos");
const outputPath = path.resolve(videoDir, "videos.json");

async function run() {
  const entries = await fs.readdir(videoDir, { withFileTypes: true });

  const byStem = new Map();

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const absolutePath = path.join(videoDir, entry.name);
    const extension = path.extname(entry.name).toLowerCase();
    if (!VIDEO_EXTENSIONS.has(extension)) {
      continue;
    }

    const stem = path.basename(entry.name, extension);
    const stats = await fs.stat(absolutePath);
    const relPath = toPosix(path.relative(videoDir, absolutePath));

    const source = {
      src: relPath,
      type: detectMimeType(extension),
      label: `${extension.slice(1).toUpperCase()} source`,
      sizeBytes: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      absolutePath,
    };

    if (!byStem.has(stem)) {
      byStem.set(stem, []);
    }
    byStem.get(stem).push(source);
  }

  const videos = [];
  for (const [stem, sources] of byStem) {
    sources.sort((a, b) => priorityForExt(a.src) - priorityForExt(b.src));

    const primary = sources[0];
    const probe = await probeVideo(primary.absolutePath);
    const poster = await findPoster(videoDir, stem);

    const videoRecord = {
      id: slugify(stem),
      title: humanize(stem),
      poster,
      duration: probe.duration,
      sizeBytes: sources.reduce((sum, source) => sum + source.sizeBytes, 0),
      resolution: probe.resolution,
      codec: probe.codec,
      createdAt: new Date(
        Math.min(...sources.map((source) => new Date(source.modifiedAt).getTime()))
      )
        .toISOString()
        .slice(0, 10),
      tags: [path.extname(primary.src).slice(1).toLowerCase()],
      sources: sources.map(({ src, type, label }) => ({ src, type, label })),
    };

    videos.push(videoRecord);
  }

  videos.sort((a, b) => a.title.localeCompare(b.title));

  await fs.writeFile(outputPath, `${JSON.stringify({ videos }, null, 2)}\n`, "utf8");
  console.log(`Wrote ${videos.length} video records to ${outputPath}`);
}

function detectMimeType(extension) {
  switch (extension) {
    case ".mp4":
    case ".m4v":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".mov":
      return "video/quicktime";
    case ".ogg":
    case ".ogv":
      return "video/ogg";
    case ".mkv":
      return "video/x-matroska";
    default:
      return "";
  }
}

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function priorityForExt(src) {
  const ext = path.extname(src).toLowerCase();
  switch (ext) {
    case ".mp4":
      return 0;
    case ".webm":
      return 1;
    case ".ogg":
    case ".ogv":
      return 2;
    case ".mov":
      return 3;
    case ".mkv":
      return 4;
    default:
      return 10;
  }
}

async function findPoster(videoDir, stem) {
  const postersDir = path.join(videoDir, "posters");
  for (const extension of POSTER_EXTENSIONS) {
    const candidate = path.join(postersDir, `${stem}${extension}`);
    try {
      await fs.access(candidate);
      return toPosix(path.relative(videoDir, candidate));
    } catch {
      // continue
    }
  }
  return "";
}

async function probeVideo(videoPath) {
  const fallback = { duration: 0, resolution: "", codec: "" };
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=width,height,codec_name",
      "-of",
      "json",
      videoPath,
    ]);

    const parsed = JSON.parse(stdout);
    const duration = Math.max(0, Number(parsed?.format?.duration) || 0);
    const firstVideoStream = Array.isArray(parsed?.streams)
      ? parsed.streams.find((stream) => stream.width && stream.height)
      : null;

    const resolution = firstVideoStream ? `${firstVideoStream.width}x${firstVideoStream.height}` : "";
    const codec = firstVideoStream?.codec_name ? String(firstVideoStream.codec_name).toUpperCase() : "";

    return { duration, resolution, codec };
  } catch {
    return fallback;
  }
}

function humanize(value) {
  return value
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
