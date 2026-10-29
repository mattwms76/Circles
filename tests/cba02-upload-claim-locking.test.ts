import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("server/social-service.ts", "utf8");

function section(start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  if (startIndex < 0 || endIndex < 0) {
    throw new Error(`CBA-02 source section is unavailable: ${start}`);
  }
  return source.slice(startIndex, endIndex);
}

describe("CBA-02 upload claim locking contract", () => {
  it("locks managed upload metadata and requires a returned claim row", () => {
    const helper = section(
      "type LockedManagedUpload",
      "const POST_PHOTO_MIME_TYPES",
    );
    expect(helper).toContain('.for("update")');
    expect(helper).toContain(".returning({ id: socialUploads.id })");
    expect(helper).toContain("Unable to claim uploaded media");
  });

  it("acquires the upload lock before every owned attachment reference write", () => {
    const profile = section(
      "export async function updateProfile",
      "export async function toggleFollow",
    );
    const circle = section(
      "export async function createCircle",
      "export async function joinCircle",
    );
    const post = section(
      "export async function createPost",
      "export async function toggleLike",
    );
    const message = section(
      "export async function sendMessage",
      "export async function markConversationRead",
    );

    expect(profile.indexOf("assertMediaOwnership(tx")).toBeLessThan(
      profile.indexOf(".update(profiles)"),
    );
    expect(circle.indexOf("assertCircleCoverImageOwnership(")).toBeLessThan(
      circle.indexOf(".insert(circles)"),
    );
    expect(post.indexOf("assertPostMediaTypeOwnership(")).toBeLessThan(
      post.indexOf(".insert(posts)"),
    );
    expect(message.indexOf("assertMediaOwnership(tx")).toBeLessThan(
      message.indexOf(".insert(messages)"),
    );
  });
});
