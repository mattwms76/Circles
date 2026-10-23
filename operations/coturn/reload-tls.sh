#!/usr/bin/env bash
# Reload coturn TLS certificates after an already-authorized renewal. No secret
# material is read, generated, printed, or passed to systemd.
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  reload-tls.sh [--check] --tls-cert ABSOLUTE_PATH --tls-key ABSOLUTE_PATH
  reload-tls.sh --apply --acknowledge-tls-reload --tls-cert ABSOLUTE_PATH --tls-key ABSOLUTE_PATH

Default --check verifies only that the supplied certificate and key parse and
match. --apply additionally requires root and sends the systemd reload defined
by circles-coturn.service. It does not renew certificates or alter DNS/firewall.
USAGE
}

die() {
  printf '%s\n' "coturn TLS reload: $1" >&2
  exit 1
}

mode="check"
cert=""
key=""
acknowledged=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --help) usage; exit 0 ;;
    --check) mode="check"; shift ;;
    --apply) mode="apply"; shift ;;
    --acknowledge-tls-reload) acknowledged=true; shift ;;
    --tls-cert|--tls-key)
      [[ $# -ge 2 && -n "$2" ]] || die "$1 requires a path."
      if [[ "$1" == "--tls-cert" ]]; then cert="$2"; else key="$2"; fi
      shift 2
      ;;
    *) die "unknown argument. Use --help for supported arguments." ;;
  esac
done

[[ -n "$cert" && -n "$key" ]] || die "--tls-cert and --tls-key are required."
[[ "$cert" = /* && "$key" = /* ]] || die "TLS paths must be absolute."
[[ -f "$cert" && ! -L "$cert" && -r "$cert" ]] || die "TLS certificate must be a readable regular file."
[[ -f "$key" && ! -L "$key" && -r "$key" ]] || die "TLS key must be a readable regular file."
openssl x509 -in "$cert" -noout >/dev/null 2>&1 || die "TLS certificate does not parse."
cert_public_key="$(openssl x509 -in "$cert" -pubkey -noout 2>/dev/null | openssl pkey -pubin -pubout -outform DER 2>/dev/null | sha256sum | awk '{print $1}')"
key_public_key="$(openssl pkey -in "$key" -pubout -outform DER 2>/dev/null | sha256sum | awk '{print $1}')"
[[ -n "$cert_public_key" && "$cert_public_key" == "$key_public_key" ]] || die "TLS certificate and key must be a matching pair."

if [[ "$mode" == "check" ]]; then
  printf '%s\n' "coturn TLS reload check passed; no service action was made."
  exit 0
fi
[[ "$acknowledged" == true ]] || die "--apply requires --acknowledge-tls-reload."
[[ "$EUID" -eq 0 ]] || die "--apply must be run as root."
systemctl reload circles-coturn.service
printf '%s\n' "coturn TLS reload requested; verify the service journal and authorized TLS/relay checks separately."
