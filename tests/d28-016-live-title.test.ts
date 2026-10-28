import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../app/live/[id].tsx", import.meta.url),
  "utf8",
);
const sourceFile = ts.createSourceFile(
  "app/live/[id].tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

function jsxTagName(node: ts.JsxElement | ts.JsxSelfClosingElement): string {
  return ts.isJsxElement(node)
    ? node.openingElement.tagName.getText(sourceFile)
    : node.tagName.getText(sourceFile);
}

function primaryLiveTitleHeading(): ts.JsxElement {
  let heading: ts.JsxElement | undefined;

  const visit = (node: ts.Node) => {
    if (!ts.isJsxElement(node) || jsxTagName(node) !== "Heading") {
      ts.forEachChild(node, visit);
      return;
    }

    const rendersLiveTitle = node.children.some(
      (child) =>
        ts.isJsxExpression(child) &&
        child.expression?.getText(sourceFile) === "live.title",
    );
    if (rendersLiveTitle) heading = node;

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  if (!heading)
    throw new Error("Missing the primary live detail title Heading");
  return heading;
}

function hasAncestorTag(node: ts.Node, tagName: string): boolean {
  let current = node.parent;
  while (current) {
    if (
      (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current)) &&
      jsxTagName(current) === tagName
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

describe("D28-016 primary Live detail title", () => {
  it("leaves the complete title uncapped within the existing scrollable detail surface", () => {
    const heading = primaryLiveTitleHeading();
    const attributes = heading.openingElement.attributes.properties;

    expect(
      attributes.some(
        (attribute) =>
          ts.isJsxAttribute(attribute) &&
          attribute.name.getText(sourceFile) === "numberOfLines",
      ),
    ).toBe(false);
    expect(hasAncestorTag(heading, "ScrollView")).toBe(true);
  });
});
