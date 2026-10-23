import { execFile } from "node:child_process";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const COTURN_DIR = join(process.cwd(), "operations", "coturn");
const INSTALLER = join(COTURN_DIR, "install-coturn.sh");
const RENDERER = join(COTURN_DIR, "render-turnserver-config.sh");
const RELOADER = join(COTURN_DIR, "reload-tls.sh");
const CONFIG_TEMPLATE = join(COTURN_DIR, "circles-turnserver.conf.template");
const UNIT_TEMPLATE = join(COTURN_DIR, "circles-coturn.service.template");

type CommandResult = Readonly<{
  code: number;
  output: string;
}>;

async function run(
  command: string,
  args: readonly string[],
): Promise<CommandResult> {
  try {
    const result = await execFileAsync(command, [...args], {
      encoding: "utf8",
      maxBuffer: 64 * 1024,
    });
    return { code: 0, output: `${result.stdout}${result.stderr}` };
  } catch (error) {
    const result = error as Readonly<{
      code?: number;
      stdout?: string;
      stderr?: string;
    }>;
    return {
      code: typeof result.code === "number" ? result.code : 1,
      output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    };
  }
}

describe("coturn Ubuntu 24 operations tooling", () => {
  it("has syntax-clean helpers and refuses absent host prerequisites in default dry-run mode", async () => {
    for (const script of [INSTALLER, RENDERER, RELOADER]) {
      const check = await run("bash", ["-n", script]);
      expect(check.code).toBe(0);
    }

    const missingHost = await run("bash", [INSTALLER]);
    expect(missingHost.code).not.toBe(0);
    expect(missingHost.output.includes("missing --public-ip")).toBe(true);

    const missingDns = await run("bash", [INSTALLER, "--public-ip", "8.8.8.8"]);
    expect(missingDns.code).not.toBe(0);
    expect(missingDns.output.includes("missing --dns-name")).toBe(true);

    const missingSecret = await run("bash", [
      INSTALLER,
      "--public-ip",
      "8.8.8.8",
      "--dns-name",
      "relay.example.test",
    ]);
    expect(missingSecret.code).not.toBe(0);
    expect(missingSecret.output.includes("missing --secret-file")).toBe(true);
  });

  it("requires TLS files and rejects host mutation unless root explicitly acknowledges --apply", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "circles-coturn-test-"));
    const secretPath = join(tempDir, "synthetic-turn-secret");
    const syntheticMarker =
      "synthetic-turn-secret-marker-with-at-least-32-bytes";
    try {
      await writeFile(secretPath, `${syntheticMarker}\n`, { mode: 0o600 });
      await chmod(secretPath, 0o600);

      const missingTls = await run("bash", [
        INSTALLER,
        "--public-ip",
        "8.8.8.8",
        "--dns-name",
        "relay.example.test",
        "--secret-file",
        secretPath,
      ]);
      expect(missingTls.code).not.toBe(0);
      expect(missingTls.output.includes("missing --tls-cert")).toBe(true);
      expect(missingTls.output.includes(syntheticMarker)).toBe(false);

      const noAcknowledgement = await run("bash", [INSTALLER, "--apply"]);
      expect(noAcknowledgement.code).not.toBe(0);
      expect(
        noAcknowledgement.output.includes("--acknowledge-host-modification"),
      ).toBe(true);

      const noRoot = await run("bash", [
        INSTALLER,
        "--apply",
        "--acknowledge-host-modification",
      ]);
      expect(noRoot.code).not.toBe(0);
      expect(
        noRoot.output.includes(
          process.getuid?.() === 0
            ? "missing --public-ip"
            : "must be run as root",
        ),
      ).toBe(true);
      expect(noRoot.output.includes(syntheticMarker)).toBe(false);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("renders a protected transient config without writing or logging the synthetic secret elsewhere", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "circles-coturn-test-"));
    const secretPath = join(tempDir, "secret");
    const outputPath = join(tempDir, "turnserver.conf");
    const syntheticMarker =
      "synthetic-turn-secret-marker-with-at-least-32-bytes";
    try {
      await writeFile(secretPath, `${syntheticMarker}\n`, { mode: 0o600 });
      await chmod(secretPath, 0o600);
      const rendered = await run("bash", [
        RENDERER,
        "--template",
        CONFIG_TEMPLATE,
        "--output",
        outputPath,
        "--credential",
        secretPath,
      ]);
      expect(rendered.code).toBe(0);
      expect(rendered.output.includes(syntheticMarker)).toBe(false);
      expect((await stat(outputPath)).mode & 0o777).toBe(0o600);
      const config = await readFile(outputPath, "utf8");
      expect(
        config.includes("static-auth-secret=__TURN_STATIC_AUTH_SECRET__"),
      ).toBe(false);
      expect(config.includes("static-auth-secret=")).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps the coturn template authenticated, bounded, TLS-capable, and closed to private peers", async () => {
    const [config, unit] = await Promise.all([
      readFile(CONFIG_TEMPLATE, "utf8"),
      readFile(UNIT_TEMPLATE, "utf8"),
    ]);
    expect(config.includes("use-auth-secret")).toBe(true);
    expect(
      config.includes("static-auth-secret=__TURN_STATIC_AUTH_SECRET__"),
    ).toBe(true);
    expect(config.includes("\nno-auth\n")).toBe(false);
    expect(config.includes("\nuser=")).toBe(false);
    expect(config.includes("tls-listening-port=5349")).toBe(true);
    expect(config.includes("cert=__TLS_CERT__")).toBe(true);
    expect(config.includes("pkey=__TLS_KEY__")).toBe(true);
    expect(config.includes("min-port=__RELAY_MIN_PORT__")).toBe(true);
    expect(config.includes("max-port=__RELAY_MAX_PORT__")).toBe(true);
    expect(config.includes("no-tcp-relay")).toBe(true);
    expect(config.includes("no-multicast-peers")).toBe(true);
    expect(config.includes("no-dynamic-ip-list")).toBe(true);
    expect(config.includes("no-dynamic-realms")).toBe(true);
    for (const range of [
      "10.0.0.0-10.255.255.255",
      "127.0.0.0-127.255.255.255",
      "169.254.0.0-169.254.255.255",
      "172.16.0.0-172.31.255.255",
      "192.168.0.0-192.168.255.255",
      "224.0.0.0-239.255.255.255",
      "::1",
      "fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
      "fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
      "ff00::-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    ]) {
      expect(config.includes(`denied-peer-ip=${range}`), range).toBe(true);
    }
    expect(
      unit.includes(
        "LoadCredential=turn_static_auth_secret:/etc/coturn/circles-turn.secret",
      ),
    ).toBe(true);
    expect(unit.includes("ExecReload=/bin/kill -USR2 $MAINPID")).toBe(true);
    expect(unit.includes("NoNewPrivileges=true")).toBe(true);
  });
});
