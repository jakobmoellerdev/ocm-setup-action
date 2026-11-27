# Open Component Model CLI setup action

[![REUSE status](https://api.reuse.software/badge/github.com/open-component-model/ocm-setup-action)](https://api.reuse.software/info/github.com/open-component-model/ocm-setup-action)

This GitHub Action installs a dedicated version of the [OCM v2](https://github.com/open-component-model/open-component-model) `ocm` CLI to be used in further steps. For example, it could be used in a Makefile executed as subsequent step to build a project.

It installs the `ocm` binary matching the runner OS (Linux, macOS, Windows) and architecture (x64, arm64), verifies its SHA-256 digest against the digest GitHub records for the release asset and its build provenance attestation, and adds it to the `PATH`.

Two sub-actions sign and verify component versions keyless with [Sigstore](https://www.sigstore.dev/), see [Signing and verifying component versions](#signing-and-verifying-component-versions).

## Versions

| Action ref | Installs | Releases |
|---|---|---|
| `@v2.Y.Z` | OCM v2 CLI | [open-component-model/open-component-model](https://github.com/open-component-model/open-component-model/releases) |
| `@v1` | OCM v1 (legacy) CLI | [open-component-model/ocm](https://github.com/open-component-model/ocm/releases) |

`main` tracks `v2`. Workflows that still need the legacy CLI must reference `@v1`. The two major versions take different inputs and produce different outputs, see [Migrating from v1](#migrating-from-v1) and [v1 (legacy)](#v1-legacy).

Reference an exact [release](https://github.com/open-component-model/ocm-setup-action/releases) such as `@v2.0.0`, or its commit SHA, and let Renovate or Dependabot update it. The `v1` and `v2` tags are no longer moved: `v1` stays at v1.1.0 (the last v1 release) and `v2` at v2.0.0.

## Inputs

| Input | Default | Description |
|---|---|---|
| `version` | `latest` | `latest` or a release version such as `0.23.0` / `v0.23.0`. `latest` resolves to the highest stable (non-draft, non-prerelease) semantic version, independent of publication order. |
| `repo` | `open-component-model/open-component-model` | GitHub repository (`owner/name`) to install from. Only needed for forks or mirrors (e.g. on GitHub Enterprise Server) that publish GitHub releases with the same `ocm-<os>-<arch>` assets; arbitrary download URLs are not supported. |
| `verify-attestation` | `true` | Verify the build provenance attestation with `gh attestation verify`. Needs the `gh` CLI on the runner (preinstalled on GitHub-hosted runners); set to `false` on runners without it. |
| `cache` | `true` | Cache the binary with `actions/cache`, keyed by repository, release tag, platform and asset digest. Cached binaries are re-checked against the release digest before use. |
| `token` | `${{ github.token }}` | Token for GitHub API calls and attestation verification. |

## Outputs

| Output | Description |
|---|---|
| `version` | Installed release tag, e.g. `v0.23.0`. |
| `path` | Absolute path of the installed `ocm` binary. |
| `cache-hit` | Whether an existing binary (restored cache, or the runner tool cache on self-hosted runners) was reused instead of downloaded. |

## Example usage

```yaml
jobs:
  ocm:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: open-component-model/ocm-setup-action@v2.0.0
        with:
          version: 0.23.0
      - run: ocm version
```

## Signing and verifying component versions

`open-component-model/ocm-setup-action/sign/<method>` and `open-component-model/ocm-setup-action/verify/<method>` sign and verify component versions without any OCM configuration from you: they generate the signing configuration and run `ocm sign cv` / `ocm verify cv`. The method is part of the path; `cosign` (keyless [Sigstore](https://www.sigstore.dev/)) is the only one so far. Both need the `ocm` CLI on the `PATH`, so run the setup action first. They take the same ref as the setup action, e.g. `@v2.1.0`.

No cosign installation is needed: `ocm` uses the cosign on the `PATH`, or downloads its pinned, checksum-verified FIPS cosign build itself.

### Signing with cosign

`sign/cosign` signs as the running workflow with the job's GitHub OIDC token, so the job needs `id-token: write`. The signing certificate names the workflow file that defines the job; in a reusable workflow that is the called workflow, not the caller. Each signature is verified against that identity right after signing.

```yaml
jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
      id-token: write # sign keyless with the workflow identity
    steps:
      - uses: actions/checkout@v7
      - uses: open-component-model/ocm-setup-action@v2.1.0
      - run: ocm add cv --constructor component-constructor.yaml # creates ./transport-archive
      # Signs every component version in ./transport-archive
      - uses: open-component-model/ocm-setup-action/sign/cosign@v2.1.0
        id: sign
      # The signature is part of the component descriptor and is transferred with it.
      - run: ocm transfer cv transport-archive//github.com/acme/app:1.0.0 ghcr.io/acme/components
      - run: echo "Signed as $IDENTITY"
        env:
          IDENTITY: ${{ steps.sign.outputs.certificate-identity }}
```

| Input | Default | Description |
|---|---|---|
| `component-versions` | `transport-archive` | Component versions to sign, one per line: component version references, or repositories whose component versions are all signed. The default is the default repository of `ocm add cv`. Empty: only write the configuration, see the `config` output. |
| `signature` | `default` | Name of the signature. |
| `config` | | OCM configuration files (resolvers, credentials, ...) to use, one per line, see [Configuration](#configuration). |
| `verify` | `true` | Verify each signature against the workflow identity right after signing. |

| Output | Description |
|---|---|
| `config` | Path of the generated OCM configuration with the Sigstore signer and verifier for the signature. |
| `certificate-identity` | Identity in the signing certificate, e.g. `https://github.com/acme/app/.github/workflows/release.yaml@refs/heads/main`. Consumers verify against it. |
| `certificate-oidc-issuer` | OIDC issuer in the signing certificate, `https://token.actions.githubusercontent.com` on github.com. |

### Verifying cosign signatures

`verify/cosign` checks that the signature was made by a GitHub Actions workflow of the expected repository. Without further inputs, the repository is pinned per component version:

- a component named `github.com/<owner>/<repo>[/...]` must be signed by a workflow of `<owner>/<repo>`, e.g. `github.com/openmcp-project/openmcp` by `openmcp-project/openmcp`;
- any other component must be signed by a workflow of the running repository.

The pin comes from the reference you verify, not from the signature, so a component signed in another repository is rejected. Narrow it further with `workflow` and `ref`, or override it with `repository`:

```yaml
      - uses: open-component-model/ocm-setup-action@v2.1.0
      # Signed by any workflow of openmcp-project/openmcp
      - uses: open-component-model/ocm-setup-action/verify/cosign@v2.1.0
        with:
          component-versions: ghcr.io/openmcp-project/components//github.com/openmcp-project/openmcp:v0.0.7
      # Signed by release.yaml of acme/app on a release tag
      - uses: open-component-model/ocm-setup-action/verify/cosign@v2.1.0
        with:
          component-versions: ghcr.io/acme/components//acme.org/app:1.0.0
          repository: acme/app
          workflow: release.yaml
          ref: refs/tags/v*
```

The certificate names the repository of the workflow file that signed. If the component is signed in a reusable workflow of another repository, e.g. a shared `acme/.github` release workflow, set `repository` to that repository.

Any workflow of a repository can be run by anyone with write access to it, on any branch. When verifying releases, set `workflow` and `ref`.

| Input | Default | Description |
|---|---|---|
| `component-versions` | `transport-archive` | Component versions to verify, one per line: component version references, or repositories whose component versions are all verified. The default is the default repository of `ocm add cv`. Empty: only write the configuration, see the `config` output. |
| `repository` | derived, see above | Repository (`owner/name`) whose workflows must have signed every listed component version. |
| `workflow` | any | Workflow file that must have signed, e.g. `release.yaml`. `*` matches any characters. |
| `ref` | any | Git ref the workflow must have run on, e.g. `refs/heads/main` or `refs/tags/v*`. `*` matches any characters. |
| `certificate-identity` | | Exact identity the signing certificate must carry, instead of `repository`, `workflow` and `ref`, e.g. the `certificate-identity` output of `sign`. |
| `certificate-identity-regexp` | | Regular expression the identity must match, instead of `repository`, `workflow` and `ref`. |
| `certificate-oidc-issuer` | `https://token.actions.githubusercontent.com` | Exact OIDC issuer of the signing certificate. |
| `certificate-oidc-issuer-regexp` | | Regular expression the OIDC issuer must match, instead of `certificate-oidc-issuer`. |
| `signature` | `default` | Name of the signature. |
| `config` | | OCM configuration files to use, one per line, see [Configuration](#configuration). |

| Output | Description |
|---|---|
| `config` | Path of the generated OCM configuration with the Sigstore verifier for the signature. Without component names to derive from, it expects the `repository` input, else the running repository. |

### Configuration

The generated configuration holds one `signing.config.ocm.software/v1alpha1` entry scoped to the signature. `ocm` reads your configuration first and the generated file last (`--config` for each), so the generated signer and verifier always win, also over a signing entry for the same signature in a `./.ocmconfig` of the checked out repository. Your configuration is:

- `config` set: these files;
- otherwise: the files `ocm` finds by itself, in its order: `OCM_CONFIG`, `$XDG_CONFIG_HOME/ocm/config`, `$XDG_CONFIG_HOME/.ocmconfig`, `~/.config/ocm/config`, `~/.config/.ocmconfig`, `~/.ocm/config`, `~/.ocmconfig`, `./.ocm/config`, `./.ocmconfig`. Unlike `ocm`'s own lookup, a file that cannot be read fails the action instead of being skipped.

To run `ocm` yourself, e.g. from a Makefile or Taskfile, set `component-versions` to an empty string and pass the `config` output:

```yaml
      - uses: open-component-model/ocm-setup-action/sign/cosign@v2.1.0
        id: sign
        with:
          component-versions: ""
      - run: task release # runs ocm sign cv --config "$OCM_SIGNING_CONFIG" ...
        env:
          OCM_SIGNING_CONFIG: ${{ steps.sign.outputs.config }}
```

## Migrating from v1

| | `@v1` | `@v2` |
|---|---|---|
| Installs | OCM v1 CLI | OCM v2 CLI |
| `version` | `latest` or a version such as `v0.19.0` from [open-component-model/ocm](https://github.com/open-component-model/ocm/releases) | `latest` or a version such as `0.23.0` / `v0.23.0` from [open-component-model/open-component-model](https://github.com/open-component-model/open-component-model/releases) |
| `repo` | default `open-component-model/ocm` | default `open-component-model/open-component-model` |
| `verify-attestation`, `cache`, `token` | — | see [Inputs](#inputs) |
| Outputs | none | `version`, `path`, `cache-hit` |
| Platforms | Linux x64 only | Linux, macOS, Windows on x64 and arm64 |
| Integrity checks | none | release asset SHA-256 digest, build provenance attestation |
| Install location | `~/.local/bin` | `$RUNNER_TOOL_CACHE/ocm/<version>/<arch>` |

The CLI itself changed between v1 and v2: commands and flags of v1 workflows do not carry over unchanged. Only switch to `@v2` once the workflow's `ocm` invocations are migrated to the OCM v2 CLI.

## v1 (legacy)

`@v1` installs the OCM v1 CLI (`ocm-<version>-linux-amd64.tar.gz`) on Linux x64 runners into `~/.local/bin`.

| Input | Default | Description |
|---|---|---|
| `version` | `latest` | `latest` or a release version of [open-component-model/ocm](https://github.com/open-component-model/ocm/releases), e.g. `v0.19.0`. |
| `repo` | `open-component-model/ocm` | Repository hosting the releases. |

It has no outputs.

```yaml
jobs:
  ocm:
    runs-on: ubuntu-latest
    steps:
      - uses: open-component-model/ocm-setup-action@v1
        with:
          version: v0.19.0
      - run: ocm --version
```

## Releasing

Releases are created by the release bot from a gated workflow, not by hand:

1. Run the [Release](https://github.com/open-component-model/ocm-setup-action/actions/workflows/release.yaml) workflow
   from `main` with the version, for example `v2.1.0`.
2. After the tests pass, a reviewer approves the `release-automation` deployment. The bot then tags the commit and
   creates a draft release with generated notes.
3. Edit the notes and publish the draft.

## Licensing

Please see our [LICENSE](LICENSE) for copyright and license information.
Detailed information including third-party components and their licensing/copyright information is available
[via the REUSE tool](https://api.reuse.software/info/github.com/open-component-model/ocm-setup-action).

---

<p align="center"><img alt="Bundesministerium für Wirtschaft und Energie (BMWE)-EU funding logo" src="https://apeirora.eu/assets/img/BMWK-EU.png" width="400"/></p>
