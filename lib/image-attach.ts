/**
 * image-attach.ts
 *
 * Pipeline for accepting arbitrary uploaded image bytes (JPEG / PNG / TIFF /
 * WebP / AVIF / GIF / HEIC), normalizing them through sharp to JPEG with the
 * same color-fidelity rules used by scripts/cache-images.ts, committing the
 * three variants (thumb 400 / label 1200 / hero 2000) to the data repo at
 * `images/<artwork_id>/<variant>.jpg`, and inserting a row in
 * `artwork_images` pointing at them.
 *
 * Color fidelity (DO NOT regress):
 *   - .rotate()           applies EXIF orientation, then strips that tag (so
 *                         downstream viewers don't double-rotate)
 *   - .withMetadata()     preserves ICC profile + remaining EXIF
 *   - chromaSubsampling   "4:4:4" — never 4:2:0
 *
 * Compression ladder kicks in only if a variant exceeds 10 MB:
 *   mozjpeg q98 → q92 → q85 → q78. Stops at the first step under budget.
 *
 * Concurrency / atomicity:
 *   - Variant blobs commit to the data repo first (idempotent — overwrites
 *     existing path with new sha). These commits are NOT inside runDbWrite
 *     because runDbWrite's callback can re-run on OCC retry, and we don't
 *     want to re-encode + re-upload variants on every retry.
 *   - DB row insert happens AFTER all variant commits succeed, inside
 *     runDbWrite. If the DB write fails permanently the blobs become
 *     orphaned — acceptable because they're keyed by artwork_id + variant
 *     and the next upload for the same artwork_id will overwrite them.
 */

import sharp from "sharp";
import { Octokit } from "@octokit/rest";
import { runDbWrite } from "./db";

const OWNER = process.env.INVENTORY_DATA_OWNER || "ragskk";
const REPO = process.env.INVENTORY_DATA_REPO || "raghavakk-inventory-data";
const BRANCH = process.env.INVENTORY_DATA_BRANCH || "main";

const VARIANTS: { name: string; width: number }[] = [
  { name: "thumb", width: 400 },
  { name: "label", width: 1200 },
  { name: "hero", width: 2000 },
];

const MAX_BYTES = 10 * 1024 * 1024;

const LADDER: { label: string; quality: number }[] = [
  { label: "q98 4:4:4 +ICC", quality: 98 },
  { label: "q92 4:4:4 +ICC", quality: 92 },
  { label: "q85 4:4:4 +ICC", quality: 85 },
  { label: "q78 4:4:4 +ICC", quality: 78 },
];

export type ImageType =
  | "main"
  | "detail"
  | "process"
  | "studio"
  | "installation"
  | "mockup";

export interface AttachOptions {
  image_type?: ImageType;
  caption?: string | null;
  alt_text?: string | null;
  credit?: string | null;
  /**
   * - true  → make this the primary_image_id no matter what
   * - false → never touch primary_image_id
   * - undef → set as primary only if the artwork currently has none
   */
  set_as_primary?: boolean;
}

export interface AttachResult {
  image_id: number;
  artwork_id: number;
  variants: { name: string; bytes: number; quality_label: string }[];
}

async function encodeVariant(
  srcBytes: Uint8Array,
  width: number,
): Promise<{ bytes: Uint8Array; quality_label: string }> {
  // Always start at q98. If under budget, return. Otherwise descend.
  let bestBytes: Uint8Array | null = null;
  let bestLabel = "";
  for (const step of LADDER) {
    const out = await sharp(srcBytes)
      .rotate() // apply EXIF orientation
      .resize({ width, withoutEnlargement: false })
      .withMetadata()
      .jpeg({
        mozjpeg: true,
        quality: step.quality,
        chromaSubsampling: "4:4:4",
      })
      .toBuffer();
    const u8 = new Uint8Array(out);
    if (bestBytes === null || u8.length < bestBytes.length) {
      bestBytes = u8;
      bestLabel = step.label;
    }
    if (u8.length <= MAX_BYTES) return { bytes: u8, quality_label: step.label };
  }
  // None fit under MAX_BYTES — commit the smallest produced anyway.
  return { bytes: bestBytes!, quality_label: bestLabel };
}

function getOctokit(): Octokit {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN not set");
  return new Octokit({ auth: token });
}

async function commitBlob(
  ok: Octokit,
  path: string,
  bytes: Uint8Array,
  message: string,
): Promise<void> {
  // Look up existing sha so we overwrite cleanly instead of erroring.
  let existingSha: string | undefined;
  try {
    const res = await ok.repos.getContent({
      owner: OWNER,
      repo: REPO,
      path,
      ref: BRANCH,
    });
    if (!Array.isArray(res.data) && "sha" in res.data) {
      existingSha = (res.data as { sha: string }).sha;
    }
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status !== 404) throw err;
  }

  await ok.repos.createOrUpdateFileContents({
    owner: OWNER,
    repo: REPO,
    path,
    message,
    content: Buffer.from(bytes).toString("base64"),
    branch: BRANCH,
    sha: existingSha,
  });
}

/**
 * Accept arbitrary bytes, normalize, commit variants, insert DB row.
 */
export async function attachArtworkImage(
  artwork_id: number,
  srcBytes: Uint8Array,
  opts: AttachOptions = {},
): Promise<AttachResult> {
  // 1. Encode all variants in parallel. sharp handles its own threading.
  const encoded = await Promise.all(
    VARIANTS.map(async (v) => ({
      name: v.name,
      ...(await encodeVariant(srcBytes, v.width)),
    })),
  );

  // 2. Commit each variant blob to the data repo.
  const ok = getOctokit();
  for (const v of encoded) {
    const path = `images/${artwork_id}/${v.name}.jpg`;
    await commitBlob(
      ok,
      path,
      v.bytes,
      `image: upload ${path} (${v.quality_label}, ${v.bytes.length}B)`,
    );
  }

  // 3. Insert artwork_images row inside runDbWrite. The callback is
  //    idempotent across OCC retries because the INSERT happens against a
  //    fresh DB snapshot each time — duplicate inserts cannot survive a
  //    failed commit.
  const imageType: ImageType = opts.image_type ?? "main";
  let imageId = 0;

  await runDbWrite(async (db) => {
    // Reset locals each retry — runDbWrite's callback may execute multiple
    // times if there's a sha conflict during commit.
    imageId = 0;

    // next display_order
    const orderRes = db.exec(
      `SELECT COALESCE(MAX(display_order), -1) + 1 AS next
       FROM artwork_images WHERE artwork_id = $a`,
      { $a: artwork_id },
    );
    const nextOrder = (orderRes[0]?.values?.[0]?.[0] as number) ?? 0;

    db.run(
      `INSERT INTO artwork_images
         (artwork_id, image_type, source_url, caption, alt_text, credit,
          display_order, visibility)
       VALUES (?, ?, NULL, ?, ?, ?, ?, 'internal')`,
      [
        artwork_id,
        imageType,
        opts.caption ?? null,
        opts.alt_text ?? null,
        opts.credit ?? null,
        nextOrder,
      ],
    );
    const idRes = db.exec(`SELECT last_insert_rowid() AS id`);
    imageId = (idRes[0]?.values?.[0]?.[0] as number) ?? 0;

    // primary_image_id logic
    if (opts.set_as_primary === true) {
      db.run(
        `UPDATE artworks SET primary_image_id = ?, updated_at = datetime('now') WHERE id = ?`,
        [imageId, artwork_id],
      );
    } else if (opts.set_as_primary !== false) {
      const cur = db.exec(
        `SELECT primary_image_id FROM artworks WHERE id = $id`,
        { $id: artwork_id },
      );
      const curPrim = cur[0]?.values?.[0]?.[0];
      if (curPrim == null) {
        db.run(
          `UPDATE artworks SET primary_image_id = ?, updated_at = datetime('now') WHERE id = ?`,
          [imageId, artwork_id],
        );
      }
    }
  }, `image: attach to artwork ${artwork_id} (${imageType})`);

  return {
    image_id: imageId,
    artwork_id,
    variants: encoded.map((v) => ({
      name: v.name,
      bytes: v.bytes.length,
      quality_label: v.quality_label,
    })),
  };
}
