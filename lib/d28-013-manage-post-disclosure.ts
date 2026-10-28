export type D28013ManagePostDisclosure = {
  scope: string;
  postId: number;
};

export function createD28013ManagePostDisclosure(
  scope: string | null,
  postId: number,
): D28013ManagePostDisclosure | null {
  if (!scope || !Number.isSafeInteger(postId) || postId <= 0) return null;
  return { scope, postId };
}

export function isCurrentD28013ManagePostDisclosure({
  disclosure,
  currentScope,
  postId,
  canManage,
}: {
  disclosure: D28013ManagePostDisclosure | null;
  currentScope: string | null;
  postId: number;
  canManage: boolean;
}) {
  return (
    canManage &&
    disclosure?.scope === currentScope &&
    disclosure.postId === postId
  );
}
