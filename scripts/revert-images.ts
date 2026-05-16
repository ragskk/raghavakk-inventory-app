/**
 * Wipe the images/ directory from raghavakk-inventory-data.
 *
 * After running this, /api/work-image falls back to live source_url fetches
 * for every variant. Use when cached blobs are degraded and you want a
 * clean slate before re-running scripts/cache-images.ts with corrected
 * compression settings.
 *
 * Usage:
 *   GITHUB_TOKEN=<pat> npx tsx scripts/revert-images.ts
 *   GITHUB_TOKEN=<pat> npx tsx scripts/revert-images.ts --only=12,17,42
 *
 * --only filters by artwork_id (matches the second path segment under
 * images/). Each delete is one commit — verbose in audit log but lets
 * you cherry-pick a single deletion if needed.
 */

import { Octokit } from "@octokit/rest";

const OWNER = process.env.INVENTORY_DATA_OWNER || "ragskk";
const REPO = process.env.INVENTORY_DATA_REPO || "raghavakk-inventory-data";
const BRANCH = process.env.INVENTORY_DATA_BRANCH || "main";

function getOctokit(): Octokit {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN not set");
  return new Octokit({ auth: token });
}

interface TreeEntry {
  path: string;
  sha: string;
  type: "blob" | "tree";
}

async function listImageBlobs(ok: Octokit): Promise<TreeEntry[]> {
  const branchRes = await ok.repos.getBranch({
    owner: OWNER,
    repo: REPO,
    branch: BRANCH
  });
  const treeSha = branchRes.data.commit.commit.tree.sha;
  const treeRes = await ok.git.getTree({
    owner: OWNER,
    repo: REPO,
    tree_sha: treeSha,
    recursive: "1"
  });
  return treeRes.data.tree
    .filter(
      (e) =>
        typeof e.path === "string" &&
        e.path.startsWith("images/") &&
        e.type === "blob" &&
        typeof e.sha === "string"
    )
    .map((e) => ({
      path: e.path as string,
      sha: e.sha as string,
      type: "blob" as const
    }));
}

async function deleteFile(
  ok: Octokit,
  path: string,
  sha: string
): Promise<void> {
  await ok.repos.deleteFile({
    owner: OWNER,
    repo: REPO,
    path,
    message: `revert-images: drop ${path}`,
    branch: BRANCH,
    sha
  });
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const onlyFlag = [...args].find((a) => a.startsWith("--only="));
  const onlyIds = onlyFlag
    ? new Set(
        onlyFlag
          .slice("--only=".length)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      )
    : null;

  const ok = getOctokit();
  const all = await listImageBlobs(ok);
  const target = onlyIds
    ? all.filter((e) => {
        // path shape is images/<artwork_id>/<variant>.jpg
        const parts = e.path.split("/");
        return parts.length >= 2 && onlyIds.has(parts[1]);
      })
    : all;

  console.log(
    `revert: ${target.length} blob(s) to delete${onlyIds ? " (filtered)" : ""}`
  );

  let done = 0;
  let failed = 0;
  for (const entry of target) {
    try {
      await deleteFile(ok, entry.path, entry.sha);
      done++;
      console.log(`  drop ${entry.path}`);
    } catch (err) {
      failed++;
      console.error(`  fail ${entry.path}:`, (err as Error).message);
    }
  }
  console.log(`done. deleted=${done} failed=${failed}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
