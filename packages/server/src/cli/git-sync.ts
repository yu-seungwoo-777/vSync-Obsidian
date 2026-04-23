#!/usr/bin/env node
import { createDbClient } from "../config/database.js";
import { exportToDirectory } from "../services/export.js";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// CLI 인자 파싱
function parseArgs(args: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--push") {
      result["push"] = true;
    } else if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      result[key] = args[i + 1] ?? "";
      i++;
    }
  }

  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const vaultId = args["vault"] as string | undefined;
  const targetDir = (args["dir"] as string | undefined) ?? process.env.GIT_SYNC_DIR ?? `./sync-output/${vaultId}`;
  const shouldPush = args["push"] === true;

  if (!vaultId) {
    console.error("Error: --vault is required");
    process.exit(1);
  }

  // 타겟 디렉토리 생성
  fs.mkdirSync(targetDir, { recursive: true });

  // DB 클라이언트 (S3 클라이언트 불필요)
  const { db } = createDbClient();

  // 파일 내보내기
  await exportToDirectory(db, vaultId, targetDir);
  console.log(`Exported vault ${vaultId} to ${targetDir}`);

  // 파일 개수 확인
  const fileCount = countFiles(targetDir);
  console.log(`Total files: ${fileCount}`);

  // @MX:WARN 명령어 인젝션 방지: vault_id에서 안전한 문자만 허용
  // @MX:REASON vault_id가 셸 메타문자를 포함하면 execSync로 임의 명령 실행 가능
  const sanitizedVaultId = vaultId.replace(/[^a-zA-Z0-9-_]/g, "");

  // git add + commit
  execSync("git add -A", { cwd: targetDir });
  try {
    execSync(`git commit -m "sync: vault ${sanitizedVaultId} - ${fileCount} files"`, {
      cwd: targetDir,
    });
    console.log("Git commit created");
  } catch {
    console.log("No changes to commit");
  }

  // --push 시 git push
  if (shouldPush) {
    try {
      execSync("git push", { cwd: targetDir });
      console.log("Git push completed");
    } catch (error) {
      console.error("Git push failed:", error);
      process.exit(1);
    }
  }
}

function countFiles(dir: string): number {
  let count = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git") continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      count += countFiles(fullPath);
    } else {
      count++;
    }
  }
  return count;
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
