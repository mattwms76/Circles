import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../app/(tabs)/discover.tsx", import.meta.url),
  "utf8",
);
const sourceFile = ts.createSourceFile(
  "app/(tabs)/discover.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

type JsxTag = ts.JsxElement | ts.JsxSelfClosingElement;

function jsxTagName(node: JsxTag): string {
  return ts.isJsxElement(node)
    ? node.openingElement.tagName.getText(sourceFile)
    : node.tagName.getText(sourceFile);
}

function jsxAttributes(node: JsxTag): ts.JsxAttributes {
  return ts.isJsxElement(node)
    ? node.openingElement.attributes
    : node.attributes;
}

function attribute(node: JsxTag, name: string): ts.JsxAttribute | undefined {
  return jsxAttributes(node).properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && property.name.getText(sourceFile) === name,
  );
}

function attributeInitializerText(
  node: JsxTag,
  name: string,
): string | undefined {
  return attribute(node, name)?.initializer?.getText(sourceFile);
}

function expressionAttribute(
  node: JsxTag,
  name: string,
): ts.Expression | undefined {
  const initializer = attribute(node, name)?.initializer;
  return initializer && ts.isJsxExpression(initializer)
    ? initializer.expression
    : undefined;
}

function discoverLiveThumbnail(): ts.JsxSelfClosingElement {
  let thumbnail: ts.JsxSelfClosingElement | undefined;

  const visit = (node: ts.Node) => {
    if (
      ts.isJsxSelfClosingElement(node) &&
      jsxTagName(node) === "Image" &&
      expressionAttribute(node, "source")?.getText(sourceFile) ===
        "{ uri: live.thumbnail }"
    ) {
      thumbnail = node;
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  if (!thumbnail) throw new Error("Missing Discover Live thumbnail Image");
  return thumbnail;
}

function nearestAncestorTag(
  node: ts.Node,
  tagName: string,
): JsxTag | undefined {
  let current = node.parent;
  while (current) {
    if (
      (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current)) &&
      jsxTagName(current) === tagName
    ) {
      return current;
    }
    current = current.parent;
  }
  return undefined;
}

function objectProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | undefined {
  return object.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) &&
      property.name.getText(sourceFile) === name,
  );
}

describe("D28-004 Discover Live responsive thumbnails", () => {
  it("uses a responsive 16:9 cover frame instead of a fixed wide-thumbnail height", () => {
    const thumbnail = discoverLiveThumbnail();
    const style = expressionAttribute(thumbnail, "style");

    expect(style && ts.isObjectLiteralExpression(style)).toBe(true);
    if (!style || !ts.isObjectLiteralExpression(style)) return;

    expect(
      objectProperty(style, "width")?.initializer.getText(sourceFile),
    ).toBe('"100%"');
    expect(
      objectProperty(style, "aspectRatio")
        ?.initializer.getText(sourceFile)
        .replaceAll(" ", ""),
    ).toBe("16/9");
    expect(objectProperty(style, "height")).toBeUndefined();
  });

  it("retains the decorative cover image inside the named Live card target", () => {
    const thumbnail = discoverLiveThumbnail();
    const card = nearestAncestorTag(thumbnail, "Pressable");

    expect(attributeInitializerText(thumbnail, "contentFit")).toBe('"cover"');
    expect(attributeInitializerText(thumbnail, "accessible")).toBe("{false}");
    expect(card).toBeDefined();
    if (!card) return;

    expect(attributeInitializerText(card, "accessibilityLabel")).toBe(
      "{`Open live moment: ${live.title} by ${live.host.name}, ${live.viewers} watching`}",
    );
    expect(expressionAttribute(card, "onPress")?.getText(sourceFile)).toBe(
      "() => router.push(`/live/${live.id}`)",
    );
  });
});
