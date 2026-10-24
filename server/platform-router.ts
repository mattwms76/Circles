import { publicProcedure, router } from "./_core/trpc";
import { getPlatformStatus } from "./platform-settings";

/**
 * This endpoint intentionally exposes only the bounded, mobile-safe platform
 * status DTO. It has no administrative mutation or configuration surface.
 */
export const platformRouter = router({
  status: publicProcedure.query(async () => getPlatformStatus()),
});
