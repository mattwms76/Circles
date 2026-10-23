# Deferred coturn setup

The owner deferred self-hosted coturn setup on 23 October 2026 and asked to continue independent work. The production-relay outcome stays open in TODO.md; no hosting, relay address/shared secret, account, payment or native/live verification is claimed.

The code-side short-lived authenticated credential issuance, web/native refresh and production fail-closed guards are already implemented. Defer only infrastructure/input/network proof, not the safety checks. Feed, circle, direct-message and authentication work can continue without a configured production relay.

Before closing coturn: approve a persistent host/public addressing and direct DNS, configure exact shared-secret authentication/TLS and bounded UDP relay ports, restrict peer access/admin exposure, verify certificate renewal, securely supply matching server-only values, then exercise real forced-relay host/viewer media on approved standalone/native builds across networks. Do not treat a socket, candidate list, browser Preview or Expo Go as this proof. No paid service may be provisioned without authorization.

The detailed owner guide remains in the private task artifacts: Circles-TURN-Providers-and-Coturn-Setup.md. It compares coturn with hosted providers; those hosted providers require a separate backend credential adapter, not a provider API key in TURN_SHARED_SECRET. No relay input card should be reopened until the owner resumes setup.
