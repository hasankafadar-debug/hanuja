"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { twoFactor } from "@/lib/auth-client";
import {
  getSellerOtpErrorMessage,
  type SellerOtpError,
} from "@/lib/seller-otp-errors";

export function SellerTwoFactorClient() {
  const router = useRouter();
  const params = useSearchParams();
  const initialSendStarted = useRef(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [challengeExpired, setChallengeExpired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [retryAfter, setRetryAfter] = useState(0);

  const showError = useCallback(
    (operation: "send" | "verify", authError: SellerOtpError) => {
      const mapped = getSellerOtpErrorMessage(operation, authError);
      setError(mapped.message);
      setChallengeExpired(mapped.challengeExpired);
    },
    [],
  );

  const send = useCallback(async () => {
    setLoading(true);
    setError(null);
    setChallengeExpired(false);
    try {
      const { error: sendError } = await twoFactor.sendOtp({
        trustDevice: false,
      });
      if (sendError) {
        showError("send", sendError);
        return;
      }
      setRetryAfter(60);
    } catch {
      showError("send", {});
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    if (initialSendStarted.current) return;
    initialSendStarted.current = true;
    void send();
  }, [send]);

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
    setChallengeExpired(false);
    try {
      const { error: verificationError } = await twoFactor.verifyOtp({
        code,
        trustDevice: false,
      });
      if (verificationError) {
        showError("verify", verificationError);
        return;
      }
      const callbackUrl = params.get("callbackUrl");
      router.replace(
        callbackUrl?.startsWith("/") && !callbackUrl.startsWith("//")
          ? callbackUrl
          : "/dashboard",
      );
    } catch {
      showError("verify", {});
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
        aria-label="6 haneli doğrulama kodu"
        required
        className="w-full rounded-lg border px-3 py-2"
      />
      {error ? (
        <div className="space-y-2 text-sm text-red-600" role="alert">
          <p>{error}</p>
          {challengeExpired ? (
            <Link href="/giris" className="inline-block underline">
              Giriş sayfasına dön
            </Link>
          ) : null}
        </div>
      ) : null}
      <button
        disabled={loading || code.length !== 6}
        className="w-full rounded-lg bg-neutral-900 py-2.5 text-white disabled:opacity-50"
      >
        {loading ? "Doğrulanıyor..." : "Doğrula"}
      </button>
      <button
        type="button"
        onClick={() => void send()}
        disabled={loading || retryAfter > 0}
        className="w-full text-sm underline disabled:no-underline disabled:opacity-50"
      >
        {retryAfter
          ? `Tekrar gönder (${retryAfter} sn)`
          : loading
            ? "Gönderiliyor..."
            : "Kodu tekrar gönder"}
      </button>
    </form>
  );
}
