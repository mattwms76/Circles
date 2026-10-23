import type { Request, Response } from "express";

export class BoundedOperationTimeoutError extends Error {
  constructor() {
    super("Operation timed out");
    this.name = "BoundedOperationTimeoutError";
  }
}

export class RequestAbortedError extends Error {
  constructor() {
    super("Request was aborted");
    this.name = "RequestAbortedError";
  }
}

/**
 * Bounds an operation that does not itself expose AbortSignal support. Callers
 * must still pass a signal to downstream APIs whenever their transport supports
 * cancellation (for example fetch). The losing promise remains observed, so a
 * later rejection cannot become unhandled after the caller has returned.
 */
export async function withOperationDeadline<T>(
  operation: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new RangeError("Operation timeout must be a positive integer");
  }
  if (signal?.aborted) throw new RequestAbortedError();

  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new BoundedOperationTimeoutError()), timeoutMs);
        abortListener = () => reject(new RequestAbortedError());
        signal?.addEventListener("abort", abortListener, { once: true });
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (abortListener) signal?.removeEventListener("abort", abortListener);
  }
}

export type RequestCancellation = {
  signal: AbortSignal;
  dispose: () => void;
};

/**
 * Exposes a handler-scoped signal that aborts only on a real client disconnect.
 * A normal response close after `writableEnded` is not treated as cancellation.
 */
export function requestCancellation(
  req: Pick<Request, "aborted" | "once" | "off">,
  res: Pick<Response, "writableEnded" | "once" | "off">,
): RequestCancellation {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const onResponseClose = () => {
    if (!res.writableEnded) abort();
  };

  if (req.aborted) {
    abort();
  } else {
    req.once("aborted", abort);
    res.once("close", onResponseClose);
  }

  return {
    signal: controller.signal,
    dispose: () => {
      req.off("aborted", abort);
      res.off("close", onResponseClose);
    },
  };
}
