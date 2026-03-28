import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseBuffer } from "music-metadata";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const releasesRoot = path.join(repoRoot, "releases");
const outputPath = path.join(repoRoot, "releases.json");
const assetsBaseUrl = withTrailingSlash(
  process.env.OPENBARS_ASSETS_BASE_URL ?? "https://alexmacflai.github.io/openbars-assets/",
);

async function main() {
  const files = await walkFiles(releasesRoot, (relativePath) =>
    /^\d{4}\/\d{2}\/\d{8}\.(mp3|zip)$/i.test(relativePath),
  );
  const grouped = new Map();

  for (const relativeFile of files) {
    const id = path.basename(relativeFile, path.extname(relativeFile));
    const entry = grouped.get(id) ?? {};

    if (relativeFile.toLowerCase().endsWith(".mp3")) {
      entry.audioPath = normalizeSlashes(path.join("releases", relativeFile));
    }

    if (relativeFile.toLowerCase().endsWith(".zip")) {
      entry.downloadPath = normalizeSlashes(path.join("releases", relativeFile));
    }

    grouped.set(id, entry);
  }

  const releases = [];

  for (const [id, media] of grouped) {
    if (!/^\d{8}$/.test(id)) {
      throw new Error(`Invalid release id "${id}". Expected YYYYMMDD.`);
    }

    const year = id.slice(0, 4);
    const month = id.slice(4, 6);
    const expectedPrefix = `releases/${year}/${month}/`;

    if (!media.audioPath || !media.downloadPath) {
      throw new Error(`Expected both MP3 and ZIP for release ${id}.`);
    }

    if (
      !media.audioPath.startsWith(expectedPrefix) ||
      !media.downloadPath.startsWith(expectedPrefix)
    ) {
      throw new Error(`Release ${id} is not stored under ${expectedPrefix}.`);
    }

    const durationSeconds = await readMp3DurationSeconds(path.join(repoRoot, media.audioPath));

    releases.push({
      id,
      slug: id,
      date: `${year}-${month}-${id.slice(6, 8)}`,
      year,
      audioPath: media.audioPath,
      downloadPath: media.downloadPath,
      audioUrl: toPublicUrl(assetsBaseUrl, media.audioPath),
      downloadUrl: toPublicUrl(assetsBaseUrl, media.downloadPath),
      durationSeconds,
    });
  }

  releases.sort((a, b) => b.date.localeCompare(a.date));

  const manifest = {
    generatedAt: new Date().toISOString(),
    releases,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Wrote ${releases.length} releases to ${outputPath}`);
}

async function walkFiles(rootDir, matcher) {
  const matches = [];

  async function visit(currentDir) {
    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name === ".DS_Store") {
        continue;
      }

      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = normalizeSlashes(path.relative(rootDir, absolutePath));

      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }

      if (matcher(relativePath)) {
        matches.push(relativePath);
      }
    }
  }

  const rootStats = await stat(rootDir).catch(() => null);
  if (!rootStats?.isDirectory()) {
    throw new Error(`Source directory not found: ${rootDir}`);
  }

  await visit(rootDir);

  return matches.sort();
}

async function readMp3DurationSeconds(absolutePath) {
  const fileBuffer = await readFile(absolutePath);
  const metadata = await parseBuffer(fileBuffer, {
    mimeType: "audio/mpeg",
    size: fileBuffer.byteLength,
  });
  const duration = metadata.format.duration;

  if (!Number.isFinite(duration)) {
    throw new Error(`Could not determine MP3 duration for ${absolutePath}`);
  }

  return Math.round(duration);
}

function toPublicUrl(baseUrl, relativePath) {
  return new URL(relativePath, baseUrl).toString();
}

function withTrailingSlash(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function normalizeSlashes(value) {
  return value.split(path.sep).join("/");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
