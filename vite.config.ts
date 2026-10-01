// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { execSync } from "node:child_process";

function git(cmd: string): string | null {
  try {
    return execSync(`git ${cmd}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || null;
  } catch {
    return null;
  }
}

// Only the project UUID is extracted from the remote — never the credentials.
const remote = git("remote get-url origin") ?? "";
const buildInfo = {
  commitSha: git("rev-parse HEAD"),
  commitCount: Number(git("rev-list --count HEAD")) || null,
  commitDate: git("log -1 --format=%cI"),
  builtAt: new Date().toISOString(),
  lovableProjectId:
    remote.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.git$/i)?.[1] ?? null,
};

export default defineConfig({
  vite: {
    define: { __BUILD_INFO__: JSON.stringify(buildInfo) },
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
