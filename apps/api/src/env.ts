// Loads .env.local and .env from the repo root (local dev). In AWS, set real environment
// variables instead (App Runner / ECS task definition, secrets from Secrets Manager).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** The folder whose package.json declares the npm workspaces, or null when running from a bundle. */
function findRepoRoot(from: string): string | null {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const pkg = path.join(dir, "package.json");
    if (existsSync(pkg) && "workspaces" in JSON.parse(readFileSync(pkg, "utf8"))) return dir;
    if (path.dirname(dir) === dir) return null;
  }
}

export const REPO_ROOT = findRepoRoot(process.cwd());

// Vercel functions can only write to /tmp, which is per instance and wiped when it stops: saved AI
// assessments don't last there. Point ASSESSMENT_STORE_DIR elsewhere once there is a database.
if (process.env.VERCEL) process.env.ASSESSMENT_STORE_DIR ||= "/tmp/ai-assessments";

if (REPO_ROOT) {
  // loadEnvFile never overrides a variable that is already set, so .env.local wins over .env.
  for (const name of [".env.local", ".env"]) {
    const file = path.join(REPO_ROOT, name);
    if (existsSync(file)) process.loadEnvFile(file);
  }
  process.env.ASSESSMENT_STORE_DIR ||= path.join(REPO_ROOT, ".data", "ai-assessments");
}

export const PORT = Number(process.env.PORT) || 3000;
export const HOST = process.env.HOST || "0.0.0.0";
/** Built Vue app to serve (production). Unset in dev, where Vite serves the front end. */
export const WEB_DIST = process.env.WEB_DIST || (REPO_ROOT ? path.join(REPO_ROOT, "apps/web/dist") : undefined);
