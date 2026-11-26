import { PrismaClient } from "@prisma/client";

// Geliştirmede sıcak yeniden yüklemede bağlantı havuzu çoğalmasın diye tek örnek.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
