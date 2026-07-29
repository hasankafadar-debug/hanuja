export type SellerOtpError = {
  code?: string;
  message?: string;
  status?: number;
};

type SellerOtpOperation = "send" | "verify";

export type SellerOtpErrorMessage = {
  message: string;
  challengeExpired: boolean;
};

const CHALLENGE_ERROR_CODES = new Set([
  "INVALID_TWO_FACTOR_COOKIE",
  "INVALID_TWO_FACTOR_CHALLENGE",
]);

function normalizedErrorValue(error: SellerOtpError): string {
  return `${error.code ?? ""} ${error.message ?? ""}`.toLocaleUpperCase("en-US");
}

export function isSellerOtpChallengeError(error: SellerOtpError): boolean {
  const value = normalizedErrorValue(error);
  return (
    Array.from(CHALLENGE_ERROR_CODES).some((code) => value.includes(code)) ||
    value.includes("INVALID TWO FACTOR COOKIE")
  );
}

export function getSellerOtpErrorMessage(
  operation: SellerOtpOperation,
  error: SellerOtpError,
): SellerOtpErrorMessage {
  const value = normalizedErrorValue(error);

  if (isSellerOtpChallengeError(error)) {
    return {
      message:
        "Doğrulama oturumunuz sona erdi. Lütfen tekrar giriş yapın.",
      challengeExpired: true,
    };
  }

  if (error.status === 429) {
    const hourly =
      value.includes("SAATLIK") ||
      value.includes("HOURLY") ||
      value.includes("HOUR");
    return {
      message: hourly
        ? "Saatlik kod gönderim limitine ulaştınız. Lütfen daha sonra tekrar deneyin."
        : "Yeni kod istemek için 60 saniye bekleyin.",
      challengeExpired: false,
    };
  }

  if (value.includes("TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE")) {
    return {
      message:
        "Bu kod için deneme hakkınız doldu. Lütfen yeni kod isteyin.",
      challengeExpired: false,
    };
  }

  if (value.includes("OTP_HAS_EXPIRED") || value.includes("OTP HAS EXPIRED")) {
    return {
      message: "Kodun süresi doldu. Lütfen yeni kod isteyin.",
      challengeExpired: false,
    };
  }

  if (value.includes("INVALID_CODE") || value.includes("INVALID CODE")) {
    return {
      message: "Girdiğiniz kod hatalı.",
      challengeExpired: false,
    };
  }

  if (
    value.includes("TWO_FACTOR_NOT_ENABLED") ||
    value.includes("TWO FACTOR ISN'T ENABLED")
  ) {
    return {
      message:
        "Hesabınızın doğrulama ayarı hazırlanamadı. Lütfen tekrar giriş yapın.",
      challengeExpired: true,
    };
  }

  return {
    message:
      operation === "send"
        ? "Kod gönderilemedi. Lütfen daha sonra tekrar deneyin."
        : "Kod doğrulanamadı. Lütfen tekrar deneyin.",
    challengeExpired: false,
  };
}
