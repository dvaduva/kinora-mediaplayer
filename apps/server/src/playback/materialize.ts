import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { subtitleAssets } from "../db/schema.js";
import { dataDir } from "../paths.js";
import { bins, run, tools } from "../process.js";
import { decodeSubtitle, ensureVtt, romanianOrthography, srtToVtt } from "./srt.js";

const TEXT_EXTERNAL = new Set(["srt", "vtt", "subrip"]);

export async function materializeSubtitle(
  asset: typeof subtitleAssets.$inferSelect,
  videoPath: string,
) {
  const codec = (asset.codec ?? "").toLowerCase();
  const textBased = TEXT_EXTERNAL.has(codec) || ["ass", "ssa", "mov_text", "webvtt", "text", "subrip"].includes(codec);
  if (!textBased) throw new Error("bitmap");
  const sourcePath = asset.origin === "external" && asset.path ? asset.path : videoPath;
  const sourceStat = fs.statSync(sourcePath);
  const cacheName = `${asset.id}-${sourceStat.size}-${Math.round(sourceStat.mtimeMs)}.vtt`;
  const destination = path.join(dataDir, "cache", "subtitles", cacheName);
  if (fs.existsSync(destination)) return destination;
  fs.mkdirSync(path.dirname(destination), { recursive: true });

  if (asset.origin === "external" && asset.path && (codec === "srt" || codec === "subrip" || codec === "vtt" || codec === "webvtt")) {
    const decoded = asset.language === "ro" ? romanianOrthography(decodeSubtitle(fs.readFileSync(asset.path))) : decodeSubtitle(fs.readFileSync(asset.path));
    const vtt = codec === "vtt" || codec === "webvtt" ? ensureVtt(decoded) : srtToVtt(decoded);
    fs.writeFileSync(destination, vtt, "utf8");
    return destination;
  }

  if (!tools.ffmpeg) throw new Error("needs_ffmpeg");
  const args =
    asset.origin === "external" && asset.path
      ? ["-y", "-i", asset.path, "-f", "webvtt", destination]
      : ["-y", "-i", videoPath, "-map", `0:${asset.streamIndex}`, "-f", "webvtt", destination];
  const result = await run(bins.ffmpeg, args, 60_000);
  if (result.code !== 0 || !fs.existsSync(destination)) throw new Error("extract_failed");
  return destination;
}

export function findSubtitle(fileId: string, subtitleId: string) {
  const asset = db.select().from(subtitleAssets).where(eq(subtitleAssets.id, subtitleId)).get();
  if (!asset || asset.fileId !== fileId) return null;
  return asset;
}
