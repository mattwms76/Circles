# Messages inbox — design audit

**Screen:** Messages inbox (`/messages`)  
**Capture set:** signed-out gates at 320×740, 390×844, 768×1024, and 1440×1000.  
**Overall:** The signed-out state is visually coherent and responsive: coral/cream/sage identity is preserved, 20px mobile/tablet and 30px wide content insets are consistent, and no horizontal overflow, clipping, or fixed-header/bottom-nav occlusion is visible. The main actionable defects are shared compact-control sizing and a long-conversation-name layout risk in the data-populated state.

## Findings

| Severity | Finding | Evidence | Minimal fix |
|---|---|---|---|
| **Medium** | Filter pills are below the 44px touch-target goal. | **Visually confirmed** across all four captures: `All`/`Direct`/`Circles` are compact at roughly 38px high. Source `components/circles-ui.tsx:257-283` sets `paddingVertical: 9` around an 18px line-height (about 38px including borders), with no `hitSlop`. | Give `Pill` a minimum height of 44px (center the existing label), or add a shared vertical hit area without materially increasing visual chrome. Preserve the intentionally compact noninteractive badge styling elsewhere. |
| **Low** | Search placeholder/input text is 13px, below the 14–16px body goal. | **Visually confirmed** as small but readable in the four screenshots; source `app/(tabs)/messages.tsx:68-74` sets `fontSize: 13`. | Use 14px for the input text/placeholder (retain the current 14px vertical padding and geometry), unless the product intentionally standardizes compact search fields. |
| **Medium** | Populated rows can collide or become awkward with long conversation names. | **Source risk; not visually verified** because active conversations do not exist in the signed-out captures. Source `app/(tabs)/messages.tsx:157-167` leaves `conversation.name` unconstrained while reserving a right-side timestamp/unread column; only `lastMessage` is `numberOfLines={1}` at `161-163`. A long name may wrap into the metadata column’s vertical rhythm or make rows unexpectedly tall. | Constrain the name to one line with ellipsis (`numberOfLines={1}`/`ellipsizeMode="tail"`), or explicitly reserve the metadata width and test long names/localized strings. Keep the 12px last-message text and 10px timestamp hierarchy deliberate. |

## Responsive/state notes

- **Visually confirmed:** mobile/tablet gutters are 20px (`messages-small`/`mobile`/`tablet`), wide main content is 30px inside the centered shell; search fields stay within the viewport; the 320px supporting sentence and signed-out title wrap cleanly rather than overflow. The 1440px layout cleanly separates main inbox, left navigation, and community sidebar.
- **Visually confirmed:** title/eyebrow hierarchy, 14px+ body copy, 19px empty-state heading, 46–66px empty-state vertical breathing room, and coral CTA maintain the Circles identity. The large empty-state whitespace is intentional and does not occlude the bottom navigation.
- **Source-reviewed only:** signed-in loading, error, empty-after-filter, and populated conversation branches (`app/(tabs)/messages.tsx:96-195`) were not captured. Conversation rows have 51px avatars and 19px vertical padding, so their primary row target is adequate; unread count is an intentional compact badge and is not flagged. The compose icon routes to Discover (`47-49`); no message editing, moderation controls, or inbox overlay is implemented in this assigned file. Any chat-level editing/moderation/keyboard overlays are outside this item and cannot be claimed visually verified.
- **Shared-cause context:** `AppShell` supplies the consistent responsive gutters and safe-area top padding (`components/app-shell.tsx:71-95`, `280-287`); its wide breakpoint is 900px (`63-64`). `IconButton` has an 8px hit slop (`components/circles-ui.tsx:215-226`), but `Pill` does not, which is why only the filters are called out for touch sizing.

## Scope / caveat

This is a read-only visual/source audit of the Messages item only. No server/browser was started, no sign-in or data mutation was performed, and no test suite was run. Metrics were read from `design-audit/before/metrics.json`; the metrics file contains unrelated route text entries, so screenshot inspection—not those unrelated entries—was used for Messages visual conclusions.
