"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { twoFactor } from "@/lib/auth-client";

export function SellerTwoFactorClient() {
  const router = useRouter();
  const params = useSearchParams();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [retryAfter, setRetryAfter] = useState(0);
  async function send() {
    setLoading(true);
    setError(null);
    try {
      const { error: sendError } = await twoFactor.sendOtp({});
      if (sendError) {
        setError("Kod gonderilemedi. Lutfen daha sonra tekrar deneyin.");
        return;
      }
      setRetryAfter(60);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void send();
  }, []);
  useEffect(() => {
    if (!retryAfter) return;
    const id = window.setInterval(
      () => setRetryAfter((s) => Math.max(0, s - 1)),
      1000,
    );
    return () => window.clearInterval(id);
  }, [retryAfter]);
  async function verify(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { error: verificationError } = await twoFactor.verifyOtp({ code });
      if (verificationError) {
        setError("Kod geçersiz veya süresi dolmuş.");
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
      <h1 className="text-xl font-semibold">İki aşamalı doğrulama</h1>
      <p className="text-sm text-neutral-600">
        E-posta adresinize gönderilen 6 haneli kodu girin.
      </p>
      <input
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        inputMode="numeric"
        autoComplete="one-time-code"
        required
        className="w-full rounded-lg border px-3 py-2"
      />
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button
        disabled={loading || code.length !== 6}
        className="w-full rounded-lg bg-neutral-900 py-2.5 text-white disabled:opacity-50"
      >
        Doğrula
      </button>
      <button
        type="button"
        onClick={() => void send()}
        disabled={loading || retryAfter > 0}
        className="w-full text-sm underline disabled:no-underline disabled:opacity-50"
      >
        {retryAfter ? `Tekrar gönder (${retryAfter} sn)` : "Kodu tekrar gönder"}
      </button>
    </form>
  );
}
