export const ADMIN_AUTH_RATE_LIMIT = {
  enabled: true,
  window: 60,
  max: 60,
  customRules: {
    "/change-password": { window: 60, max: 5 },
    // Middleware reaches this read-only endpoint over loopback for each page
    // navigation, so it must not share one IP bucket across all admins.
    "/get-session": false,
  },
} as const;
