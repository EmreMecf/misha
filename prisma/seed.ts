/**
 * Yerel geliştirme için demo ofis (yalnızca geliştirme veritabanında; üretimde çalıştırmayın).
 *   npm run db:seed
 * Giriş: DEMO_EMAIL / DEMO_PASSWORD (aşağıda). Kayıt varsa tekrar oluşturulmaz.
 */
import { prisma } from "../src/lib/db";
import { registerOffice } from "../src/server/auth/authService";

export const DEMO_EMAIL = "demo@mihsap.local";
export const DEMO_PASSWORD = "demo-parola-2026";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Seed üretimde çalıştırılmaz");
  const existing = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (existing) {
    console.log(`Demo kullanıcı zaten var: ${DEMO_EMAIL}`);
    return;
  }
  await registerOffice({ organizationName: "Demo Mali Müşavirlik", fullName: "Demo Kullanıcı", email: DEMO_EMAIL, password: DEMO_PASSWORD });
  console.log(`Demo ofis oluşturuldu. Giriş: ${DEMO_EMAIL} (parola prisma/seed.ts içinde)`);
}

main().finally(() => prisma.$disconnect());
