/** Denetim kaydı işlemlerinin okunur karşılıkları. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "organization.register": "Ofis hesabı oluşturuldu",
  "auth.login": "Giriş yapıldı",
  "auth.logout": "Çıkış yapıldı",
  "auth.password_change": "Parola değiştirildi",
  "taxpayer.create": "Mükellef eklendi",
  "taxpayer.update": "Mükellef güncellendi",
  "taxpayer.assign": "Personel mükellefe atandı",
  "taxpayer.unassign": "Personel ataması kaldırıldı",
  "fiscal_period.create": "Mali dönem açıldı",
  "fiscal_period.close": "Mali dönem kapatıldı",
  "fiscal_period.reopen": "Mali dönem yeniden açıldı",
  "member.add": "Personel eklendi",
  "member.update": "Personel yetkisi değiştirildi",
};

export const auditLabel = (action: string) => AUDIT_ACTION_LABELS[action] ?? action;
