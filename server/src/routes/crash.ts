// POL-03: Crash report ingest endpoint.
//
// Accepts multipart/form-data minidump uploads from Electron crashReporter.
// Stores the raw dump file to the configured crash dump directory.
// No user content, no email, no anonymous_id — only stack + metadata.
import type { FastifyInstance } from "fastify";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import multipart from "@fastify/multipart";

const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

export async function crashRoute(app: FastifyInstance): Promise<void> {
  await app.register(multipart, {
    limits: { fileSize: MAX_PAYLOAD_BYTES, files: 1 },
  });

  app.post("/crash/ingest", async (req, reply) => {
    const contentLength = parseInt(req.headers["content-length"] ?? "0", 10);
    if (contentLength > MAX_PAYLOAD_BYTES) {
      return reply.code(413).send({ error: "payload_too_large" });
    }

    let dumpData: Buffer | null = null;
    const meta: Record<string, string> = {};

    try {
      const parts = req.parts();
      for await (const part of parts) {
        if (part.type === "file" && part.fieldname === "upload_file_minidump") {
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) {
            chunks.push(chunk as Buffer);
          }
          dumpData = Buffer.concat(chunks);
        } else if (part.type === "field") {
          const allowed = ["prod", "ver", "ptype"];
          if (allowed.includes(part.fieldname)) {
            meta[part.fieldname] = part.value as string;
          }
        }
      }
    } catch {
      return reply.code(400).send({ error: "multipart_parse_error" });
    }

    if (!dumpData || dumpData.length === 0) {
      return reply.code(400).send({ error: "missing_dump" });
    }

    const dumpDir =
      process.env["CALMLY_CRASH_DUMP_DIR"] ?? "/tmp/calmly-crashes";
    try {
      await mkdir(dumpDir, { recursive: true });
      const filename = `${Date.now()}-${randomUUID()}.dmp`;
      const fullPath = join(dumpDir, filename);
      await new Promise<void>((resolve, reject) => {
        const ws = createWriteStream(fullPath);
        ws.write(dumpData!, (err) => {
          if (err) {
            ws.destroy();
            reject(err);
            return;
          }
          ws.end(resolve);
        });
        ws.on("error", reject);
      });
      app.log.info(
        { path: fullPath, size: dumpData.length, ...meta },
        "[crash] dump stored",
      );
    } catch (err) {
      app.log.error({ err }, "[crash] failed to store dump");
      return reply.code(500).send({ error: "internal" });
    }

    return reply.code(202).send({ accepted: true });
  });
}
