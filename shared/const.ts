export const SESSION_COOKIE_SUFFIX = "252278368451773";
export const LEGACY_COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
/** OAuth application sessions require fresh interactive OAuth at least twice daily. */
export const APPLICATION_SESSION_TTL_MS = 1000 * 60 * 60 * 12;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = "Please login (10001)";
export const NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";
