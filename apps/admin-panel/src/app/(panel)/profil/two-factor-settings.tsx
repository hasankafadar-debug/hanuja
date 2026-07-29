"use client";

import { useMemo, useState } from "react";
import { Button, Input } from "@hanuja/ui";
import {
  Check,
  CheckCircle2,
  Copy,
  KeyRound,
  ShieldCheck,
  ShieldOff,
  Smartphone,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { twoFactor } from "@/lib/auth-client";

interface TwoFactorSettingsProps {
  initialEnabled: boolean;
}

interface SetupPayload {
  totpURI: string;
  backupCodes: string[];
}

type PendingAction = "enable" | "verify" | "disable" | "copy" | null;

function getManualSecret(totpURI: string): string {
  try {
    return new URL(totpURI).searchParams.get("secret") ?? "";
  } catch {
    return "";
  }
}

export function TwoFactorSettings({ initialEnabled }: TwoFactorSettingsProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [setup, setSetup] = useState<SetupPayload | null>(null);
  const [setupVerified, setSetupVerified] = useState(false);
  const [enablePassword, setEnablePassword] = useState("");
  const [disablePassword, setDisablePassword] = useState("");
  const [code, setCode] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const manualSecret = useMemo(
    () => (setup ? getManualSecret(setup.totpURI) : ""),
    [setup],
  );

  function resetFeedback() {
    setError(null);
    setMessage(null);
  }

  async function startSetup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enablePassword) return;

    resetFeedback();
    setPendingAction("enable");

    try {
      const { data, error: enableError } = await twoFactor.enable({
        password: enablePassword,
        issuer: "Hanuja Admin",
      });

      setEnablePassword("");

      if (enableError || !data?.totpURI || !Array.isArray(data.backupCodes)) {
        setError(
          "Şifre doğrulanamadı veya kurulum başlatılamadı. Lütfen tekrar deneyin.",
        );
        return;
      }

      setSetup({ totpURI: data.totpURI, backupCodes: data.backupCodes });
      setSetupVerified(false);
      setCode("");
    } finally {
      setPendingAction(null);
    }
  }

  async function verifySetup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!setup || code.length !== 6) return;

    resetFeedback();
    setPendingAction("verify");

    try {
      const { error: verificationError } = await twoFactor.verifyTotp({
        code,
        trustDevice: false,
      });

      if (verificationError) {
        setError(
          "Kod geçersiz veya süresi dolmuş. Google Authenticator’daki güncel kodu girin.",
        );
        return;
      }

      setEnabled(true);
      setSetupVerified(true);
      setCode("");
      setMessage("İki aşamalı doğrulama etkinleştirildi.");
    } finally {
      setPendingAction(null);
    }
  }

  async function disableTwoFactor(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!disablePassword) return;

    resetFeedback();
    setPendingAction("disable");

    try {
      const { data, error: disableError } = await twoFactor.disable({
        password: disablePassword,
      });

      setDisablePassword("");

      if (disableError || !data?.status) {
        setError(
          "Şifre doğrulanamadı veya iki aşamalı doğrulama kapatılamadı.",
        );
        return;
      }

      setEnabled(false);
      setSetup(null);
      setSetupVerified(false);
      setMessage("İki aşamalı doğrulama devre dışı bırakıldı.");
    } finally {
      setPendingAction(null);
    }
  }

  async function copyBackupCodes() {
    if (!setup?.backupCodes.length) return;

    resetFeedback();
    setPendingAction("copy");

    try {
      await navigator.clipboard.writeText(setup.backupCodes.join("\n"));
      setMessage("Yedek kodlar panoya kopyalandı.");
    } catch {
      setError(
        "Yedek kodlar kopyalanamadı. Kodları güvenli bir yere elle kaydedin.",
      );
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <section
      className="rounded-xl border p-5 sm:p-6"
      style={{
        borderColor: "var(--color-border)",
        backgroundColor: "var(--color-surface)",
      }}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span
            className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: "var(--color-muted)" }}
          >
            <ShieldCheck
              className="h-5 w-5"
              style={{ color: "var(--color-muted-fg)" }}
            />
          </span>
          <div>
            <h2
              className="font-semibold"
              style={{ color: "var(--color-primary)" }}
            >
              İki aşamalı doğrulama
            </h2>
            <p
              className="mt-1 max-w-xl text-sm"
              style={{ color: "var(--color-muted-fg)" }}
            >
              Admin girişlerinde parolanızdan sonra Google Authenticator kodu
              istenir.
            </p>
          </div>
        </div>

        <span
          className="inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium"
          style={
            enabled
              ? { backgroundColor: "#dcfce7", color: "#166534" }
              : {
                  backgroundColor: "var(--color-muted)",
                  color: "var(--color-muted-fg)",
                }
          }
        >
          {enabled ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <ShieldOff className="h-3.5 w-3.5" />
          )}
          {enabled ? "Etkin" : "Kapalı"}
        </span>
      </div>

      <div
        className="my-6 h-px"
        style={{ backgroundColor: "var(--color-border)" }}
      />

      {error ? (
        <p
          className="mb-5 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {message ? (
        <p
          className="mb-5 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700"
          role="status"
        >
          {message}
        </p>
      ) : null}

      {!enabled && !setup ? (
        <form onSubmit={startSetup} className="max-w-md space-y-4">
          <div>
            <label
              htmlFor="totp-enable-password"
              className="mb-1.5 block text-sm font-medium"
            >
              Mevcut şifreniz
            </label>
            <Input
              id="totp-enable-password"
              type="password"
              autoComplete="current-password"
              value={enablePassword}
              onChange={(event) => setEnablePassword(event.target.value)}
              placeholder="Şifrenizi girin"
              required
            />
            <p
              className="mt-2 text-xs"
              style={{ color: "var(--color-muted-fg)" }}
            >
              Güvenlik nedeniyle kurulum başlamadan önce şifreniz doğrulanır.
            </p>
          </div>
          <Button
            type="submit"
            loading={pendingAction === "enable"}
            disabled={!enablePassword}
          >
            <Smartphone className="h-4 w-4" />
            Google Authenticator kurulumunu başlat
          </Button>
        </form>
      ) : null}

      {!enabled && setup && !setupVerified ? (
        <div className="grid gap-8 md:grid-cols-[224px_1fr] md:items-start">
          <div
            className="w-fit rounded-xl border bg-white p-3"
            style={{ borderColor: "var(--color-border)" }}
          >
            <QRCodeSVG
              value={setup.totpURI}
              size={196}
              level="M"
              marginSize={2}
              title="Hanuja Admin Google Authenticator kurulum QR kodu"
            />
          </div>

          <div className="space-y-5">
            <div>
              <h3
                className="font-medium"
                style={{ color: "var(--color-primary)" }}
              >
                Google Authenticator’a ekleyin
              </h3>
              <ol
                className="mt-3 space-y-2 text-sm"
                style={{ color: "var(--color-muted-fg)" }}
              >
                <li>1. Google Authenticator uygulamasını açın.</li>
                <li>2. “+” düğmesine basıp “QR kodu tara” seçeneğini açın.</li>
                <li>3. Soldaki QR kodu tarayın.</li>
                <li>4. Uygulamadaki 6 haneli kodu aşağıya girin.</li>
              </ol>
            </div>

            {manualSecret ? (
              <details className="text-sm">
                <summary className="cursor-pointer font-medium">
                  QR taranamıyorsa kurulum anahtarını göster
                </summary>
                <code className="mt-2 block break-all rounded-lg bg-neutral-100 px-3 py-2 text-xs">
                  {manualSecret}
                </code>
              </details>
            ) : null}

            <form onSubmit={verifySetup} className="max-w-sm space-y-3">
              <label
                htmlFor="totp-setup-code"
                className="block text-sm font-medium"
              >
                6 haneli doğrulama kodu
              </label>
              <Input
                id="totp-setup-code"
                value={code}
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                }
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                className="font-mono text-lg tracking-[0.35em]"
                required
              />
              <Button
                type="submit"
                loading={pendingAction === "verify"}
                disabled={code.length !== 6}
              >
                <Check className="h-4 w-4" />
                Doğrula ve etkinleştir
              </Button>
            </form>
          </div>
        </div>
      ) : null}

      {enabled && setupVerified && setup ? (
        <div className="space-y-5">
          <div className="flex items-start gap-3">
            <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <h3 className="font-medium">Yedek kodlarınızı kaydedin</h3>
              <p
                className="mt-1 text-sm"
                style={{ color: "var(--color-muted-fg)" }}
              >
                Telefonunuza erişemediğinizde her kod yalnız bir kez
                kullanılabilir. Kodları bir parola yöneticisinde veya güvenli
                bir çevrimdışı yerde saklayın.
              </p>
            </div>
          </div>

          <div className="grid max-w-xl grid-cols-2 gap-2 rounded-xl bg-neutral-100 p-4 font-mono text-sm sm:grid-cols-5">
            {setup.backupCodes.map((backupCode) => (
              <span
                key={backupCode}
                className="rounded bg-white px-2 py-1 text-center"
              >
                {backupCode}
              </span>
            ))}
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={copyBackupCodes}
              loading={pendingAction === "copy"}
            >
              <Copy className="h-4 w-4" />
              Kodları kopyala
            </Button>
            <Button
              type="button"
              onClick={() => {
                setSetup(null);
                setSetupVerified(false);
                resetFeedback();
              }}
            >
              Kodları kaydettim
            </Button>
          </div>
        </div>
      ) : null}

      {enabled && !setupVerified ? (
        <div className="space-y-6">
          <div className="flex items-start gap-3 text-sm">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
            <p style={{ color: "var(--color-muted-fg)" }}>
              Google Authenticator etkin. Yeni girişlerde paroladan sonra 6
              haneli kod istenecek.
            </p>
          </div>

          <form
            onSubmit={disableTwoFactor}
            className="max-w-md space-y-3 border-t pt-5"
            style={{ borderColor: "var(--color-border)" }}
          >
            <div>
              <label
                htmlFor="totp-disable-password"
                className="mb-1.5 block text-sm font-medium"
              >
                İki aşamalı doğrulamayı kapat
              </label>
              <Input
                id="totp-disable-password"
                type="password"
                autoComplete="current-password"
                value={disablePassword}
                onChange={(event) => setDisablePassword(event.target.value)}
                placeholder="Mevcut şifrenizi girin"
                required
              />
            </div>
            <Button
              type="submit"
              variant="destructive"
              loading={pendingAction === "disable"}
              disabled={!disablePassword}
            >
              <ShieldOff className="h-4 w-4" />
              Devre dışı bırak
            </Button>
          </form>
        </div>
      ) : null}
    </section>
  );
}
