/**
 * Arka plan worker'ı: belge işleme kuyruğunu çalıştırır.
 *   npm run worker          (sürekli; Ctrl+C ile durur)
 *   npm run worker -- --once (bekleyenleri işleyip çıkar)
 * Ayrı worker kullanırken web sunucusunda INLINE_JOBS=false yapın.
 */
import { prisma } from "../src/lib/db";
import { JOB_HANDLERS } from "../src/server/documents/documentProcessor";
import { runPendingJobs, WORKER_ID } from "../src/server/jobs/jobQueue";

const POLL_MS = 2000;
let stopping = false;
process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));

async function main() {
  const once = process.argv.includes("--once");
  console.log(`Worker başladı (${WORKER_ID})${once ? " — tek tur" : ""}`);
  do {
    const processed = await runPendingJobs(JOB_HANDLERS, 50);
    if (processed > 0) console.log(`${new Date().toISOString()} ${processed} iş işlendi`);
    if (once) break;
    await new Promise((r) => setTimeout(r, POLL_MS));
  } while (!stopping);
}

main().finally(() => prisma.$disconnect());
