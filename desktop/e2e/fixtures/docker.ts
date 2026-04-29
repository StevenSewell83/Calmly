import { spawn } from "node:child_process";

// Probe whether the Docker daemon is reachable. Used by specs that depend on
// testcontainers so they can self-skip on dev machines without Docker rather
// than failing with an opaque "Cannot connect to Docker daemon" error.
//
// We exec `docker info` rather than touching testcontainers directly because
// testcontainers' own probe is slower (it pulls the reaper image) and we want
// the skip decision to land in <1s.
export async function isDockerAvailable(): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const p = spawn("docker", ["info", "--format", "{{.ServerVersion}}"], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    let stdout = "";
    p.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    const timer = setTimeout(() => {
      p.kill("SIGKILL");
      resolve(false);
    }, 3000);
    p.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code === 0 && stdout.trim().length > 0);
    });
    p.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}
