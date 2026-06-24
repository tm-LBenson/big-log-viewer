import { execFileSync } from "node:child_process";
import { cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const frontendDir = join(root, "frontend");
const frontendDist = join(frontendDir, "dist");
const embedDist = join(root, "cmd", "biglog", "dist");
const viteBin = join(frontendDir, "node_modules", "vite", "bin", "vite.js");

rmSync(frontendDist, { recursive: true, force: true });
execFileSync(process.execPath, [viteBin, "build"], { cwd: frontendDir, stdio: "inherit" });
rmSync(embedDist, { recursive: true, force: true });
cpSync(frontendDist, embedDist, { recursive: true });
rmSync(frontendDist, { recursive: true, force: true });
