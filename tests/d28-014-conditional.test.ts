import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  d28014PrivacyPillControlStyle,
  d28014PrivacyPillLabelStyle,
} from "../lib/d28-014-privacy-pill";

const createScreenSource = readFileSync(
  new URL("../app/create.tsx", import.meta.url),
  "utf8",
);

describe("D28-014 Circle privacy-pill compact text policy", () => {
  it("bounds and shrinks only the privacy control while retaining the 44-point target", () => {
    expect(d28014PrivacyPillControlStyle).toMatchObject({
      flexShrink: 1,
      maxWidth: "100%",
      minHeight: 44,
      minWidth: 0,
    });
    expect(d28014PrivacyPillLabelStyle).toMatchObject({ flexShrink: 1 });
  });

  it("applies the layout contract to both privacy choices through the existing pill", () => {
    expect(createScreenSource).toContain(
      "privacyPill && d28014PrivacyPillControlStyle",
    );
    expect(createScreenSource).toContain(
      "privacyPill && d28014PrivacyPillLabelStyle",
    );

    const privacySection = createScreenSource.slice(
      createScreenSource.indexOf("<T style={s.eyebrow}>WHO CAN JOIN?</T>"),
      createScreenSource.indexOf("              ) : (", 1000),
    );
    expect(privacySection).toContain('title="Public · anyone can join"');
    expect(privacySection).toContain('title="Private · approval needed"');
    expect(privacySection.match(/privacyPill/g)).toHaveLength(2);
  });
});
