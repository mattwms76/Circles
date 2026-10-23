#!/usr/bin/env bash
# Render a root-provided coturn template without logging credential contents.
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  render-turnserver-config.sh --validate-credential PATH
  render-turnserver-config.sh --template PATH --output PATH --credential PATH [--owner USER:GROUP]

The credential file must contain one UTF-8 TURN REST secret (at least 32 bytes),
with no leading/trailing whitespace or control characters. This program never
prints the credential or the rendered configuration.
USAGE
}

die() {
  printf '%s\n' "coturn renderer: $1" >&2
  exit 1
}

validate_credential() {
  local credential_path="$1"
  [[ -f "$credential_path" && ! -L "$credential_path" ]] || die "credential must be a regular, non-symlink file."
  python3 - "$credential_path" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
try:
    value = path.read_bytes()
except OSError:
    raise SystemExit(1)
if value.endswith(b"\n"):
    value = value[:-1]
if not value or b"\n" in value or b"\r" in value:
    raise SystemExit(1)
try:
    text = value.decode("utf-8")
except UnicodeDecodeError:
    raise SystemExit(1)
if len(value) < 32 or text != text.strip() or any(ord(char) < 32 or ord(char) == 127 for char in text):
    raise SystemExit(1)
PY
  [[ $? -eq 0 ]] || die "credential must be one non-empty, single-line UTF-8 secret with at least 32 bytes."
}

if [[ $# -eq 0 || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ "${1:-}" == "--validate-credential" ]]; then
  [[ $# -eq 2 ]] || die "--validate-credential requires exactly one path."
  validate_credential "$2"
  exit 0
fi

template=""
output=""
credential=""
owner=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --template)
      [[ $# -ge 2 ]] || die "--template requires a path."
      template="$2"
      shift 2
      ;;
    --output)
      [[ $# -ge 2 ]] || die "--output requires a path."
      output="$2"
      shift 2
      ;;
    --credential)
      [[ $# -ge 2 ]] || die "--credential requires a path."
      credential="$2"
      shift 2
      ;;
    --owner)
      [[ $# -ge 2 ]] || die "--owner requires USER:GROUP."
      owner="$2"
      shift 2
      ;;
    *)
      die "unknown argument. Use --help for supported arguments."
      ;;
  esac
done

[[ -n "$template" && -n "$output" && -n "$credential" ]] || die "--template, --output, and --credential are required."
[[ "$template" = /* && "$output" = /* && "$credential" = /* ]] || die "template, output, and credential paths must be absolute."
[[ -f "$template" && ! -L "$template" ]] || die "template must be a regular, non-symlink file."
[[ ! -e "$output" || ! -L "$output" ]] || die "output must not be a symlink."
validate_credential "$credential"

output_dir="$(dirname "$output")"
[[ -d "$output_dir" ]] || die "output directory does not exist."
umask 0077
temp_output="$(mktemp "$output_dir/.turnserver.conf.XXXXXX")"
trap 'rm -f "$temp_output"' EXIT

python3 - "$template" "$credential" "$temp_output" <<'PY'
import pathlib
import sys

template_path, credential_path, output_path = map(pathlib.Path, sys.argv[1:])
template = template_path.read_text(encoding="utf-8")
secret = credential_path.read_bytes()
if secret.endswith(b"\n"):
    secret = secret[:-1]
secret_text = secret.decode("utf-8")
marker = "__TURN_STATIC_AUTH_SECRET__"
if template.count(marker) != 1:
    raise SystemExit(1)
rendered = template.replace(marker, secret_text)
if marker in rendered:
    raise SystemExit(1)
output_path.write_text(rendered, encoding="utf-8")
PY
chmod 0600 "$temp_output"
if [[ -n "$owner" ]]; then
  [[ "$owner" =~ ^[a-z_][a-z0-9_-]*:[a-z_][a-z0-9_-]*$ ]] || die "--owner must use a local USER:GROUP name."
  chown "$owner" "$temp_output"
fi
mv -f "$temp_output" "$output"
trap - EXIT
