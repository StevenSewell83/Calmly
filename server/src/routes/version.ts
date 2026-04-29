import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface PackageJson {
  version?: string;
}

const pkg = JSON.parse(
  readFileSync(join(__dirname, "../../package.json"), "utf-8"),
) as PackageJson;

export const SERVER_VERSION: string = pkg.version ?? "0.0.0";

export async function versionRoute(app: FastifyInstance): Promise<void> {
  app.get("/version", async () => ({ version: SERVER_VERSION }));
}
