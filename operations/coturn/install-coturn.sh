#!/usr/bin/env bash
# Ubuntu 24.04 coturn installation/preflight tool. It never mutates a host unless
# invoked as root with both --apply and --acknowledge-host-modification.
set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly DEFAULT_RELAY_MIN_PORT=49160
readonly DEFAULT_RELAY_MAX_PORT=49200

usage() {
  cat <<'USAGE'
Usage:
  install-coturn.sh [--preflight] \
    --public-ip IPV4 --dns-name FQDN --tls-cert ABSOLUTE_PATH --tls-key ABSOLUTE_PATH \
    --secret-file ABSOLUTE_PATH [--relay-min-port PORT --relay-max-port PORT]

  install-coturn.sh --apply --acknowledge-host-modification \
    --public-ip IPV4 --dns-name FQDN --tls-cert ABSOLUTE_PATH --tls-key ABSOLUTE_PATH \
    --secret-file ABSOLUTE_PATH [--relay-min-port PORT --relay-max-port PORT] \
    [--configure-ufw --acknowledge-ufw-changes]

Default mode is preflight. It validates direct public addressing, matching DNS,
TLS material, a root-owned 0600 secret file, and a bounded UDP relay range. It
installs nothing, starts nothing, changes no service, and changes no firewall.

--apply is intentionally refused unless run as root and accompanied by
--acknowledge-host-modification. UFW is untouched unless both --configure-ufw
and --acknowledge-ufw-changes are supplied. This tool does not generate secrets,
request certificates, create DNS records, or write application runtime settings.
USAGE
}

die() {
  printf '%s\n' "coturn preflight: $1" >&2
  exit 1
}

require_value() {
  [[ $# -ge 2 && -n "$2" ]] || die "$1 requires a value."
}

is_public_ipv4() {
  python3 - "$1" <<'PY'
import ipaddress
import sys
try:
    address = ipaddress.ip_address(sys.argv[1])
except ValueError:
    raise SystemExit(1)
raise SystemExit(0 if address.version == 4 and address.is_global else 1)
PY
}

is_fqdn() {
  local name="$1"
  [[ ${#name} -le 253 && "$name" == *.* && "$name" != .* && "$name" != *. ]] || return 1
  [[ "$name" != *..* ]] || return 1
  [[ "$name" =~ ^[A-Za-z0-9.-]+$ ]] || return 1
  local label
  IFS='.' read -r -a labels <<< "$name"
  for label in "${labels[@]}"; do
    [[ ${#label} -ge 1 && ${#label} -le 63 ]] || return 1
    [[ "$label" =~ ^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$ ]] || return 1
  done
}

valid_port() {
  [[ "$1" =~ ^[0-9]{1,5}$ ]] && (( 1 <= 10#$1 && 10#$1 <= 65535 ))
}

validate_tls_pair() {
  [[ "$TLS_CERT" = /* && "$TLS_KEY" = /* ]] || die "--tls-cert and --tls-key must be absolute paths."
  [[ -f "$TLS_CERT" && ! -L "$TLS_CERT" && -r "$TLS_CERT" ]] || die "TLS certificate must be a readable regular file."
  [[ -f "$TLS_KEY" && ! -L "$TLS_KEY" && -r "$TLS_KEY" ]] || die "TLS key must be a readable regular file."
  openssl x509 -in "$TLS_CERT" -noout -checkhost "$DNS_NAME" >/dev/null 2>&1 || die "TLS certificate must parse and cover --dns-name."
  openssl x509 -in "$TLS_CERT" -noout -checkend 2592000 >/dev/null 2>&1 || die "TLS certificate expires within 30 days; renew it before installation."
  local cert_public_key key_public_key
  cert_public_key="$(openssl x509 -in "$TLS_CERT" -pubkey -noout 2>/dev/null | openssl pkey -pubin -pubout -outform DER 2>/dev/null | sha256sum | awk '{print $1}')"
  key_public_key="$(openssl pkey -in "$TLS_KEY" -pubout -outform DER 2>/dev/null | sha256sum | awk '{print $1}')"
  [[ -n "$cert_public_key" && "$cert_public_key" == "$key_public_key" ]] || die "TLS certificate and key must be a matching pair."
}

validate_secret_file() {
  [[ "$SECRET_FILE" = /* ]] || die "--secret-file must be an absolute path."
  [[ -f "$SECRET_FILE" && ! -L "$SECRET_FILE" && -r "$SECRET_FILE" ]] || die "secret file must be a readable regular, non-symlink file."
  [[ "$(stat -c '%u:%g:%a' "$SECRET_FILE")" == "0:0:600" ]] || die "secret file must be owned root:root with mode 0600."
  "$SCRIPT_DIR/render-turnserver-config.sh" --validate-credential "$SECRET_FILE" >/dev/null 2>&1 || die "secret file has an invalid TURN REST secret format."
}

validate_dns_mapping() {
  local resolved
  resolved="$(getent ahostsv4 "$DNS_NAME" 2>/dev/null | awk '{print $1}' | sort -u || true)"
  grep -Fxq "$PUBLIC_IP" <<< "$resolved" || die "DNS name must resolve to --public-ip over IPv4 before installation."
}

mode="preflight"
public_ip=""
dns_name=""
tls_cert=""
tls_key=""
secret_file=""
relay_min_port="$DEFAULT_RELAY_MIN_PORT"
relay_max_port="$DEFAULT_RELAY_MAX_PORT"
acknowledge_host_modification=false
configure_ufw=false
acknowledge_ufw_changes=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help)
      usage
      exit 0
      ;;
    --preflight)
      mode="preflight"
      shift
      ;;
    --apply)
      mode="apply"
      shift
      ;;
    --public-ip|--dns-name|--tls-cert|--tls-key|--secret-file|--relay-min-port|--relay-max-port)
      require_value "$1" "${2:-}"
      case "$1" in
        --public-ip) public_ip="$2" ;;
        --dns-name) dns_name="$2" ;;
        --tls-cert) tls_cert="$2" ;;
        --tls-key) tls_key="$2" ;;
        --secret-file) secret_file="$2" ;;
        --relay-min-port) relay_min_port="$2" ;;
        --relay-max-port) relay_max_port="$2" ;;
      esac
      shift 2
      ;;
    --acknowledge-host-modification)
      acknowledge_host_modification=true
      shift
      ;;
    --configure-ufw)
      configure_ufw=true
      shift
      ;;
    --acknowledge-ufw-changes)
      acknowledge_ufw_changes=true
      shift
      ;;
    *)
      die "unknown argument. Use --help for supported arguments."
      ;;
  esac
done

if [[ "$mode" == "apply" ]]; then
  [[ "$acknowledge_host_modification" == true ]] || die "--apply requires --acknowledge-host-modification."
  [[ "$EUID" -eq 0 ]] || die "--apply must be run as root after a successful preflight."
fi
[[ "$configure_ufw" == false || "$mode" == "apply" ]] || die "--configure-ufw is valid only with --apply."
[[ "$configure_ufw" == false || "$acknowledge_ufw_changes" == true ]] || die "--configure-ufw requires --acknowledge-ufw-changes."

PUBLIC_IP="$public_ip"
DNS_NAME="$dns_name"
TLS_CERT="$tls_cert"
TLS_KEY="$tls_key"
SECRET_FILE="$secret_file"
RELAY_MIN_PORT="$relay_min_port"
RELAY_MAX_PORT="$relay_max_port"

[[ -n "$PUBLIC_IP" ]] || die "missing --public-ip."
[[ -n "$DNS_NAME" ]] || die "missing --dns-name."
[[ -n "$SECRET_FILE" ]] || die "missing --secret-file."
[[ -n "$TLS_CERT" ]] || die "missing --tls-cert."
[[ -n "$TLS_KEY" ]] || die "missing --tls-key."
is_public_ipv4 "$PUBLIC_IP" || die "--public-ip must be a globally routable IPv4 address."
is_fqdn "$DNS_NAME" || die "--dns-name must be a DNS FQDN without wildcard or URL syntax."
valid_port "$RELAY_MIN_PORT" && valid_port "$RELAY_MAX_PORT" && (( 10#$RELAY_MIN_PORT <= 10#$RELAY_MAX_PORT )) || die "relay ports must be integers from 1 through 65535 with min <= max."
(( 10#$RELAY_MAX_PORT - 10#$RELAY_MIN_PORT + 1 <= 4096 )) || die "relay range exceeds the 4096-port safety bound."
validate_tls_pair
validate_secret_file
validate_dns_mapping

if [[ "$mode" == "preflight" ]]; then
  printf '%s\n' "coturn preflight passed; no host, daemon, firewall, DNS, certificate, or application-runtime change was made."
  exit 0
fi

# Explicit installation path. Refuse to displace a distribution coturn instance
# that might be serving another workload. The package is prevented from starting
# before this isolated unit/configuration is installed.
if systemctl is-active --quiet coturn.service || systemctl is-enabled --quiet coturn.service; then
  die "an existing coturn.service is active or enabled; refusing to alter an existing relay."
fi
command -v apt-get >/dev/null || die "Ubuntu apt-get is required for this installation path."
command -v systemctl >/dev/null || die "systemd is required for this installation path."

policy_rc_created=false
if [[ ! -e /usr/sbin/policy-rc.d ]]; then
  cat >/usr/sbin/policy-rc.d <<'POLICY'
#!/bin/sh
exit 101
POLICY
  chmod 0755 /usr/sbin/policy-rc.d
  policy_rc_created=true
fi
cleanup_policy_rc() {
  if [[ "$policy_rc_created" == true ]]; then
    rm -f /usr/sbin/policy-rc.d
  fi
}
trap cleanup_policy_rc EXIT

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y coturn
cleanup_policy_rc
trap - EXIT

id -u coturn >/dev/null 2>&1 || die "coturn package did not create its service user."
runuser -u coturn -- test -r "$TLS_CERT" || die "the coturn user cannot read --tls-cert."
runuser -u coturn -- test -r "$TLS_KEY" || die "the coturn user cannot read --tls-key."

install -d -o root -g root -m 0755 /etc/coturn /usr/local/libexec
install -o root -g root -m 0644 "$SCRIPT_DIR/circles-turnserver.conf.template" /etc/coturn/circles-turnserver.conf.template
install -o root -g root -m 0700 "$SCRIPT_DIR/render-turnserver-config.sh" /usr/local/libexec/circles-coturn-render-config
install -o root -g root -m 0600 "$SECRET_FILE" /etc/coturn/circles-turn.secret

python3 - "$SCRIPT_DIR/circles-turnserver.conf.template" /etc/coturn/circles-turnserver.conf.template "$PUBLIC_IP" "$DNS_NAME" "$TLS_CERT" "$TLS_KEY" "$RELAY_MIN_PORT" "$RELAY_MAX_PORT" <<'PY'
import pathlib
import sys
src, dst, public_ip, dns_name, tls_cert, tls_key, min_port, max_port = sys.argv[1:]
text = pathlib.Path(src).read_text(encoding="utf-8")
replacements = {
    "__PUBLIC_IP__": public_ip,
    "__DNS_NAME__": dns_name,
    "__TLS_CERT__": tls_cert,
    "__TLS_KEY__": tls_key,
    "__RELAY_MIN_PORT__": min_port,
    "__RELAY_MAX_PORT__": max_port,
}
for token, value in replacements.items():
    if token not in text:
        raise SystemExit(1)
    text = text.replace(token, value)
if "__" in text and "__TURN_STATIC_AUTH_SECRET__" not in text:
    raise SystemExit(1)
pathlib.Path(dst).write_text(text, encoding="utf-8")
PY
install -o root -g root -m 0644 "$SCRIPT_DIR/circles-coturn.service.template" /etc/systemd/system/circles-coturn.service

# Prevent the vendor unit from starting with its separate default configuration.
systemctl disable coturn.service
systemctl daemon-reload
systemctl enable --now circles-coturn.service

if [[ "$configure_ufw" == true ]]; then
  command -v ufw >/dev/null || die "--configure-ufw requested but ufw is not installed."
  ufw allow 3478/udp
  ufw allow 5349/tcp
  ufw allow "${RELAY_MIN_PORT}:${RELAY_MAX_PORT}/udp"
fi

printf '%s\n' "coturn installation completed. Record systemctl status and authorized cross-network forced-relay evidence separately; neither is produced by this tool."
