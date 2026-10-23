# Circle Home v1

Circle Home adds a Home section to each circle while retaining Feed, Members, About and Manage. It displays the circle's own welcome message and rules, plus at most one existing pinned post. Empty sections are clearly described as not yet configured; generic guidance is not presented as an owner's custom rules.

## Editing and pins

Current owners and moderators can edit Home in Manage. Welcome text allows 2,000 Unicode code points. Rules are plain text, one per line in the editor, with at most ten nonblank entries of 300 code points each. Supplementary characters such as emoji count as one code point; this is not a count of visual grapheme clusters. Stored rules must be trimmed and contain no CR/LF. Duplicate checks fold ASCII letter case while preserving other Unicode text exactly, so database collation cannot change the rule contract. Save is intentional; Cancel discards the local draft. Background refetch must not overwrite an unsaved editor draft. No post or membership is created automatically.

Manage uses the existing bounded feed pages to select a post from that same circle. Pin, replace and unpin are explicit desired-state operations. Editing welcome/rules does not alter the pin; pinning does not save or overwrite draft text. A post deleted by its author or authorized moderator has its pin pointer cleared by the private foreign key. The normal feed still contains its usual posts; Home renders only the separate single pinned slot.

## Access and storage

Public Home content follows existing public-feed visibility. Private Home content requires current approved membership; guests, pending applicants and nonmembers cannot read welcome, rules or the pin. Editing requires current circle owner/moderator authority, not a caller-supplied actor ID or a UI-only role check. Pinned post reads and mutations enforce the same-circle target independently. Home content is not appended to the discoverable Circle DTO.

The separate `circleHome.get`, `circleHome.update` and `circleHome.pin` procedures reuse existing authentication and resource authorization. Client query keys include account affinity as well as circle ID; a supplied `viewerScope` must match the actual authenticated context and never replaces its authority. Fresh fetch failures or viewer mismatches suppress old Home content and editing authority. Existing drafts survive ordinary background refreshes but do not carry across accounts/circles or confirmed role loss. Missing and foreign pin targets use the same unavailable response. Existing PostCard renders the selected post and retains normal protected media/comment/reaction behavior.

Storage is additive on `circles_app.circles`: `welcomeMessage`, `rules`, `pinnedPostId`. Applied reviewed migration `0008_circles_home.sql` and the exact health-shape-only replacement `0009_circles_ops_circle_home_health.sql` atomically after local rehearsal. This preserved the 22-table private RLS boundary, operational health Cron 7 and encrypted backup schedules unchanged. Current guarded recovery explicitly covers the new read-only procedure and exact appended circle columns; it must never save text or pin a post to fabricate verification fixtures.

## Validation boundary

Isolated PostgreSQL 17 and complete credential-free checks passed, including 385 unit tests. Live metadata confirmed three Home columns, four constraints, 22 private RLS tables, zero API-facing schema/table access and healthy native daily health with Cron 7 unchanged. Final API/Preview protocol checks and exact-source CI/source-save verification remain pending. Production circles/posts are not edited for tests. Authenticated device/account E2E, actual native release builds and existing unrelated security/provider/credential prerequisites remain separate. No application publication is part of this feature request.
