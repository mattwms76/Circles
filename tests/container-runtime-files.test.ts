import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("production container TLS files", () => {
  it("has no inactive package patch inputs in the frozen container graph", () => {
    const dockerfile = readFileSync(resolve("Dockerfile"), "utf8");
    const manifest = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
    expect(manifest.pnpm.patchedDependencies ?? {}).toEqual({});
    expect(dockerfile).not.toContain("COPY patches ./patches");
  });

  it("copies the public pinned Supabase certificate into the nonroot runtime", () => {
    const dockerfile = readFileSync(resolve("Dockerfile"), "utf8");
    const runtime = dockerfile.slice(dockerfile.lastIndexOf(" AS runtime"));
    expect(runtime).toContain(
      "COPY --chown=circles:circles server/certificates ./server/certificates",
    );
    expect(runtime).toContain("USER circles");
    const certificate = new X509Certificate(
      readFileSync(resolve("server/certificates/supabase-root-2021.crt")),
    );
    expect(certificate.fingerprint256.replaceAll(":", "").toLowerCase()).toBe(
      "807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa",
    );
  });
});
