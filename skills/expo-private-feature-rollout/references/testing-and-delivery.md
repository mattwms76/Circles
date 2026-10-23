# Testing layers and delivery evidence

## Name the actual tested boundary

| Evidence | What it proves | What it does not prove |
|---|---|---|
| Pure/unit/source test | Declared transformation, validation or seam under the supplied fixtures | Actual DB, UI interaction or OAuth |
| Disposable PostgreSQL drill | Actual SQL, private grants/constraints and migration compatibility for the synthetic fixture | Production data parity, provider platform recovery or native behavior |
| Real HTTP→tRPC→service→local PostgreSQL | Serialization, router validation, real service queries/transactions and durable feature state | Native rendered UI or production OAuth if context uses fixture authentication |
| Browser journey | Actual rendered Web interaction and its wired network behavior | iOS/Android device APIs, SecureStore, camera or signed-native compatibility |
| JS platform export | Source bundles compile for that target | Signed build, device install, permissions or native E2E |
| Approved native-device journey | Named actions observed on the actual build/device/account | Unsupported networks/providers or unexecuted paths |

Prefer actual HTTP and a real temporary PostgreSQL instance for isolated backend E2E. A test-only auth context may select fixed synthetic users within the harness, but keep it outside shipped application code and state that OAuth/token issuance was not tested. Do not mock database results and then label the suite full E2E. Do not add a general localhost DB bypass or magic testing account to production code.

Keep isolated E2E files outside default unit discovery using a dedicated config/include or a non-test default suffix. Make its runner create the target rather than accepting an arbitrary remote URL. A named temporary service/marker plus endpoint/DB/role identity checks are stronger than `hostname=localhost` alone. Ignore inherited real credentials; reject unexpected injected settings. Test failed-start/cleanup paths and enforce finite deadlines.

Integrate PostgreSQL tooling into credential-free CI explicitly. Discover the installed major/binary path and require the expected version; do not silently use a different major. Ensure CI does not expose app or provider secrets, and use read-only repository permissions. Run E2E in a separate job if normal unit/build parallelism would otherwise discover it or exhaust the fixture budget.

For native requests, inspect authorized device/build/account availability. If unavailable and the user offers automated testing as an alternative, proceed with isolated automation and leave native open instead of repeatedly blocking for credentials. Never bypass CAPTCHA, create unsolicited accounts, or write fixture rows into the shared app database.

## Evidence and source saving

Keep private runtime/audit logs outside repositories and redact error categories before reporting. Record source SHA/tree, command/mode, actual counts/conclusions, fixture cleanup and skipped boundaries. Keep failed run evidence when correcting a confirmed issue; do not overwrite it with the success summary.

Fetch current canonical history before normal saving and preserve concurrent changes. Compare canonical and authorized mirror trees after copying only intended files; commits differ because histories differ. Do not force-push, change mobile repository ownership or copy app credentials. Follow platform attribution/checkpoint guidance.

Wait for the exact-source CI result; do not claim a superseded success covers changed code. A docs-only outcome closure does not change the tested code. Separate transport acceptance from missing checkpoint receipt, Preview from publication, and container smoke with synthetic required config from real datastore readiness. End once the requested deliverable is complete; do not silently start another feature or full audit.
