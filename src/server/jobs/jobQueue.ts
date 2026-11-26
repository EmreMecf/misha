import { hostname } from "node:os";
import { Prisma, type Job } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { Tx } from "@/server/tenancy/tenantDb";

/**
 * PostgreSQL tabanlı iş kuyruğu. Aynı iş idempotency anahtarıyla bir kez kuyruğa girer;
 * worker'lar `FOR UPDATE SKIP LOCKED` ile işi çakışmadan alır; hata alan iş üstel bekleme ile
 * yeniden denenir, deneme hakkı bitince DEAD olur. Kilitli kalan (çöken worker) iş süre aşımıyla geri alınır.
 */

export const STALE_LOCK_MS = 5 * 60 * 1000;
export const WORKER_ID = `${hostname()}:${process.pid}`;

export type JobHandler = (job: Job) => Promise<void>;

export async function enqueue(
  db: Tx | typeof prisma,
  job: { organizationId: string; type: string; idempotencyKey: string; payload: Prisma.InputJsonValue; maxAttempts?: number },
) {
  try {
    return await db.job.create({ data: { ...job, maxAttempts: job.maxAttempts ?? 3 } });
  } catch (error) {
    // Aynı iş zaten kuyrukta / işlendi: idempotent
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return null;
    throw error;
  }
}

/** Sıradaki uygun işi kilitleyip alır (yoksa null). */
export async function claimNext(workerId = WORKER_ID, now = new Date()): Promise<Job | null> {
  const staleBefore = new Date(now.getTime() - STALE_LOCK_MS);
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE jobs SET status = 'RUNNING', locked_at = ${now}, locked_by = ${workerId}, attempts = attempts + 1, updated_at = ${now}
    WHERE id = (
      SELECT id FROM jobs
      WHERE (status = 'PENDING' AND run_after <= ${now})
         OR (status = 'RUNNING' AND locked_at < ${staleBefore})
      ORDER BY run_after
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id`;
  if (rows.length === 0) return null;
  return prisma.job.findUnique({ where: { id: rows[0].id } });
}

/** Yeniden deneme beklemesi: 10 sn, 20 sn, 40 sn … (en fazla 1 saat). */
export const backoffMs = (attempt: number) => Math.min(10_000 * 2 ** Math.max(0, attempt - 1), 60 * 60 * 1000);

export async function completeJob(job: Job) {
  await prisma.job.updateMany({ where: { id: job.id, lockedBy: job.lockedBy }, data: { status: "SUCCEEDED", lockedAt: null, lastError: null } });
}

export async function failJob(job: Job, error: unknown, now = new Date()) {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
  const dead = job.attempts >= job.maxAttempts;
  await prisma.job.updateMany({
    where: { id: job.id, lockedBy: job.lockedBy },
    data: {
      status: dead ? "DEAD" : "PENDING",
      lockedAt: null,
      lockedBy: null,
      lastError: message,
      runAfter: dead ? undefined : new Date(now.getTime() + backoffMs(job.attempts)),
    },
  });
  return { dead };
}

/**
 * Bekleyen işleri sırayla çalıştırır (en fazla `limit` iş). Worker döngüsü ve geliştirmede
 * istek sonrası (`after`) tetikleme aynı fonksiyonu kullanır.
 */
export async function runPendingJobs(handlers: Record<string, JobHandler>, limit = 20, workerId = WORKER_ID) {
  let processed = 0;
  while (processed < limit) {
    const job = await claimNext(workerId);
    if (!job) break;
    processed += 1;
    const handler = handlers[job.type];
    try {
      if (!handler) throw new Error(`Bilinmeyen iş türü: ${job.type}`);
      await handler(job);
      await completeJob(job);
    } catch (error) {
      await failJob(job, error);
    }
  }
  return processed;
}
