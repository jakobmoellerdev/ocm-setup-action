#!/usr/bin/env bash
# Installs the OCM v2 CLI from the open-component-model/open-component-model releases.
#
# Environment (set by action.yaml):
#   version             release to install ("latest" or a semver with or without leading "v")
#   repo                GitHub repository hosting the releases
#   token               GitHub token for API calls (optional, avoids rate limits)
#   verify_attestation  "true" to verify the GitHub build provenance attestation via gh
set -euo pipefail

repo="${repo:-open-component-model/open-component-model}"
version="${version:-latest}"
api="${GITHUB_API_URL:-https://api.github.com}"

case "${RUNNER_OS:-$(uname -s)}" in
  Linux) os=linux ;;
  macOS | Darwin) os=darwin ;;
  Windows | MINGW* | MSYS* | CYGWIN*) os=windows ;;
  *) echo "::error::unsupported runner OS: ${RUNNER_OS:-$(uname -s)}" >&2; exit 1 ;;
esac

case "${RUNNER_ARCH:-$(uname -m)}" in
  X64 | x86_64 | amd64) arch=amd64 ;;
  ARM64 | arm64 | aarch64) arch=arm64 ;;
  *) echo "::error::unsupported runner architecture: ${RUNNER_ARCH:-$(uname -m)}" >&2; exit 1 ;;
esac

curl_api=(curl -fsSL --retry 3 -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28")
if [ -n "${token:-}" ]; then
  curl_api+=(-H "Authorization: Bearer ${token}")
fi

if [ "$version" = latest ]; then
  release_url="${api}/repos/${repo}/releases/latest"
else
  release_url="${api}/repos/${repo}/releases/tags/v${version#v}"
fi
if ! release="$("${curl_api[@]}" "$release_url")"; then
  echo "::error::cannot resolve release ${version} of ${repo} (${release_url})" >&2
  exit 1
fi
tag="$(jq -r .tag_name <<<"$release")"

asset="ocm-${os}-${arch}"
download_url="$(jq -r --arg n "$asset" '.assets[] | select(.name == $n) | .browser_download_url' <<<"$release")"
digest="$(jq -r --arg n "$asset" '.assets[] | select(.name == $n) | .digest // empty' <<<"$release")"
if [ -z "$download_url" ]; then
  echo "::error::release ${tag} of ${repo} has no asset ${asset}" >&2
  exit 1
fi
if [[ "$digest" != sha256:* ]]; then
  echo "::error::release ${tag} of ${repo} publishes no sha256 digest for ${asset}" >&2
  exit 1
fi

bin_dir="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/ocm/${tag}/bin"
bin="${bin_dir}/ocm"
[ "$os" = windows ] && bin="${bin}.exe"
mkdir -p "$bin_dir"

echo "Installing ocm ${tag} (${os}/${arch}) from ${repo}"
curl -fsSL --retry 3 -o "$bin" "$download_url"

# Hash stdin: sha256sum escapes paths containing backslashes (Windows) with a leading "\".
if command -v sha256sum >/dev/null; then
  actual="$(sha256sum <"$bin" | cut -d' ' -f1)"
else
  actual="$(shasum -a 256 <"$bin" | cut -d' ' -f1)"
fi
if [ "sha256:${actual}" != "$digest" ]; then
  echo "::error::digest mismatch for ${asset}: expected ${digest}, got sha256:${actual}" >&2
  exit 1
fi

if [ "${verify_attestation:-false}" = true ]; then
  GH_TOKEN="${token:-}" gh attestation verify "$bin" --repo "$repo"
fi

chmod a+x "$bin"
echo "$bin_dir" >>"$GITHUB_PATH"
{
  echo "version=${tag}"
  echo "path=${bin}"
} >>"$GITHUB_OUTPUT"
