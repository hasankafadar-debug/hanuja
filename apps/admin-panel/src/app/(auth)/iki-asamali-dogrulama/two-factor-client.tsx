"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { twoFactor } from "@/lib/auth-client";

export function AdminTwoFactorClient() {
  const router = useRouter();
  const params = useSearchParams();
  const [code, setCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { error: verificationError } = await twoFactor.verifyTotp({
        code,
        trustDevice,
      });
      if (verificationError) {
        setError("Dogrulama kodu gecersiz veya suresi dolmus.");
        return;
      }
      const callbackUrl = params.get("callbackUrl");
      router.replace(
        callbackUrl?.startsWith("/") && !callbackUrl.startsWith("//")
          ? callbackUrl
          : "/dashboard",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={verify}
      className="rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm space-y-4"
    >
      <h1 className="text-lg font-semibold">Iki asamali dogrulama</h1>
      <p className="text-sm text-neutral-600">
        Authenticator uygulamanizdaki 6 haneli kodu girin.
      </p>
      <input
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        inputMode="numeric"
        autoComplete="one-time-code"
        required
        className="w-full rounded-lg border px-3 py-2"
      />
      <label className="flex gap-2 text-sm">
        <input
          type="checkbox"
          checked={trustDevice}
          onChange={(e) => setTrustDevice(e.target.checked)}
        />{" "}
        Bu tarayiciya guven (400 gun)
      </label>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button
        disabled={loading || code.length !== 6}
        className="w-full rounded-lg bg-neutral-900 py-2.5 text-white disabled:opacity-50"
      >
        {loading ? "Dogrulaniyor..." : "Dogrula"}
      </button>
    </form>
  );
}
