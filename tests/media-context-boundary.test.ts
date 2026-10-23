import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("protected media context dependency", () => {
  it("uses a UI-free shared consumer context rather than importing the provider UI", () => {
    const core = readFileSync("hooks/circles-context-core.ts", "utf8");
    const media = readFileSync("components/media-image.tsx", "utf8");
    const provider = readFileSync("hooks/circles-context.tsx", "utf8");
    expect(core).not.toMatch(
      /from\s+["'].*(?:components|circles-ui|media-image)/,
    );
    expect(media).toContain('from "@/hooks/circles-context-core"');
    expect(media).not.toContain('from "@/hooks/circles-context"');
    expect(provider).toContain("CirclesContext as Context");
    expect(provider).toContain(
      'export { useCircles } from "./circles-context-core"',
    );
    expect(provider).not.toContain("createContext");
  });
});
