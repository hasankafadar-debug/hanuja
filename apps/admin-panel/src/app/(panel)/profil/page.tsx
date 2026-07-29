import type { Metadata } from "next";
import { PageHeader } from "@hanuja/ui";
import { Mail } from "lucide-react";
import { getAdminSession } from "@/lib/admin-session";
import { TwoFactorSettings } from "./two-factor-settings";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Profil ve Guvenlik" };

export default async function AdminProfilePage() {
  const session = await getAdminSession();

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Profil"
        description="Hesap bilgileri ve giriş güvenliği"
      />

      <section
        className="rounded-xl border p-5"
        style={{
          borderColor: "var(--color-border)",
          backgroundColor: "var(--color-surface)",
        }}
      >
        <div className="flex items-start gap-3">
          <span
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: "var(--color-muted)" }}
          >
            <Mail
              className="h-4 w-4"
              style={{ color: "var(--color-muted-fg)" }}
            />
          </span>
          <div>
            <p
              className="text-sm font-medium"
              style={{ color: "var(--color-primary)" }}
            >
              Admin hesabı
            </p>
            <p
              className="mt-1 text-sm"
              style={{ color: "var(--color-muted-fg)" }}
            >
              {session.user.email}
            </p>
          </div>
        </div>
      </section>

      <TwoFactorSettings
        initialEnabled={Boolean(session.user.twoFactorEnabled)}
      />
    </div>
  );
}
