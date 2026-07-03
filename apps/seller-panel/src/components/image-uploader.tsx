"use client";

import { useRef, useState } from "react";
import {
  getConfirmErrorMessage,
  getCorsOrNetworkMessage,
  getPresignErrorMessage,
  parseConfirmPayload,
  parseUploadFailure,
  parseUploadUrlPayload,
} from "./image-upload-errors";

interface Props {
  value: string | null;
  onUpload: (url: string) => void;
  folder: "stores" | "avatars";
  label: string;
  aspectLabel?: string;
  disabled?: boolean;
}

export default function ImageUploader({
  value,
  onUpload,
  folder,
  label,
  aspectLabel,
  disabled,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    const mimeType = file.type as "image/jpeg" | "image/png" | "image/webp";
    if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
      setError("Yalnızca JPEG, PNG veya WebP dosyaları kabul edilir.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Dosya boyutu 5 MB'ı geçemez.");
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const urlRes = await fetch("/api/media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder, mimeType }),
      });

      if (!urlRes.ok) {
        const responseBody = await urlRes.json().catch(async () => {
          const text = await urlRes.text().catch(() => "");
          return { message: text };
        });
        throw new Error(getPresignErrorMessage(responseBody));
      }

      const { asset, uploadUrl } = parseUploadUrlPayload(await urlRes.json());

      let putRes: Response;
      try {
        putRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": mimeType },
          body: file,
        });
      } catch (uploadError) {
        throw new Error(getCorsOrNetworkMessage(uploadError));
      }

      if (!putRes.ok) {
        const bodyText = await putRes.text().catch(() => "");
        throw new Error(
          parseUploadFailure({
            status: putRes.status,
            statusText: putRes.statusText,
            bodyText,
          }),
        );
      }

      const confirmRes = await fetch(`/api/media/${asset.id}/confirm`, {
        method: "POST",
      });
      if (!confirmRes.ok) {
        const confirmBody = await confirmRes.json().catch(async () => {
          const text = await confirmRes.text().catch(() => "");
          return { message: text };
        });
        throw new Error(getConfirmErrorMessage(confirmBody));
      }

      const confirmed = parseConfirmPayload(await confirmRes.json(), asset);
      onUpload(confirmed.url);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Yükleme sırasında hata oluştu.",
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      <p
        className="text-sm font-medium"
        style={{ color: "var(--color-primary)" }}
      >
        {label}
      </p>
      {aspectLabel && (
        <p className="text-xs" style={{ color: "var(--color-muted-fg)" }}>
          {aspectLabel}
        </p>
      )}

      <button
        type="button"
        disabled={disabled || uploading}
        onClick={() => inputRef.current?.click()}
        className="relative overflow-hidden rounded-xl border-2 border-dashed flex items-center justify-center transition-colors"
        style={{
          borderColor: "var(--color-border)",
          backgroundColor: "var(--color-surface-alt, var(--color-surface))",
          width: folder === "avatars" ? "96px" : "100%",
          height: folder === "avatars" ? "96px" : "120px",
          cursor: disabled || uploading ? "not-allowed" : "pointer",
        }}
      >
        {value ? (
          <img
            src={value}
            alt="Önizleme"
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <span
            className="text-xs text-center px-2"
            style={{ color: "var(--color-muted-fg)" }}
          >
            {uploading ? "Yükleniyor..." : "Tıkla veya sürükle"}
          </span>
        )}

        {uploading && (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
          >
            <span className="text-xs text-white">Yükleniyor...</span>
          </div>
        )}

        {value && !uploading && (
          <div
            className="absolute bottom-0 left-0 right-0 py-1 text-center text-xs text-white"
            style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          >
            Değiştir
          </div>
        )}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />

      {error && (
        <p className="text-xs" style={{ color: "var(--color-destructive)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
