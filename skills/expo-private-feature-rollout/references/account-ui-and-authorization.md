# Account-aware UI and mutation authority

## Server authority

Derive actor identity from validated context. If the request carries viewerScope, compare it to actual context before service/data work; nullable guest scope is not permission to become a member. Keep schemas strict against injected actor fields. Revalidate role under existing circle/resource serialization, and recheck active durable session authority at protected write boundaries using existing architecture.

Scope pin/attachment/resource SELECT by both target ID and parent ID. Return the same safe unavailable error for nonexistent and foreign inaccessible targets. Never SELECT globally then disclose a different foreign-parent error. Read mapped post/media content only through normal viewer authorization. Public discovery may expose sanctioned circle metadata, not private Home text or posts.

## Account and route scope

Use query keys containing parent and viewer scope; additionally require response IDs to match current route and account before rendering. Changing account must not adopt a prior account's cache or completion. Do not treat disabled queries as current authority.

On mount, refetch account-sensitive content and require a settled current response before allowing edits. Error state takes precedence over cached server content. During a normal background fetch, a previously current read may remain visible only under the defined visibility policy, but disable edit authority until refresh completes. On membership/role errors, hide protected server content and retain only user-authored draft state when appropriate.

## Draft lifecycle

Key the editor by route/account identity and retain its mounted draft across normal query invalidation, pin refetch and recoverable errors. Pass fresh server authority separately from draft values: never reset all draft values whenever a DTO object changes.

A confirmed fresh `canManage=false` should clear/unmount the draft and disable actions immediately, not reopen it after a later fetch. Use a deliberate reducer/state transition or guarded same-component adjustment that converges; do not defer a setter with a zero-delay timer merely to evade hook lint. Clear identity-bound state on account/route changes.

Capture operation scope and suppress stale completion effects after navigation/account change or unmount. Reset mounted refs in Strict Mode effect setup as well as cleanup. Disable conflicting actions while pending. Avoid accepting late successful old-account mutations as current cache authority; resource authorization remains server-enforced regardless of UI.

## Pin and text editing

Use independent desired-state endpoints: `setText(welcome,rules)` and `setPinnedPost(postId|null)` rather than a stale all-fields replace. Retrying the same desired value is safe. Replacing or unpinning must not resave stale welcome/rules; saving text must not overwrite the newer pin.

Keep configured content distinct from empty placeholders. Use neutral empty copy rather than invented administrator instructions. Maintain cancel/retry actions and native keyboard-safe controls. Do not auto-publish a draft or join a circle simply to make onboarding/home look complete.
