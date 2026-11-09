# Open Component Model CLI setup action

[![REUSE status](https://api.reuse.software/badge/github.com/open-component-model/ocm-setup-action)](https://api.reuse.software/info/github.com/open-component-model/ocm-setup-action)

This GitHub Action installs a dedicated version of the [OCM v2](https://github.com/open-component-model/open-component-model) `ocm` CLI to be used in further steps. For example, it could be used in a Makefile executed as subsequent step to build a project.

It installs the `ocm` binary matching the runner OS (Linux, macOS, Windows) and architecture (x64, arm64), verifies its SHA-256 digest against the digest GitHub records for the release asset and its build provenance attestation, and adds it to the `PATH`.

## Versions

| Action ref | Installs | Releases |
|---|---|---|
| `@v2` | OCM v2 CLI | [open-component-model/open-component-model](https://github.com/open-component-model/open-component-model/releases) |
| `@v1` | OCM v1 (legacy) CLI | [open-component-model/ocm](https://github.com/open-component-model/ocm/releases) |

`main` tracks `v2`. Workflows that still need the legacy CLI must reference `@v1`. The two major versions take different inputs and produce different outputs, see [Migrating from v1](#migrating-from-v1) and [v1 (legacy)](#v1-legacy).

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
      - uses: open-component-model/ocm-setup-action@v2
        with:
          version: 0.23.0
      - run: ocm version
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

## Licensing

Please see our [LICENSE](LICENSE) for copyright and license information.
Detailed information including third-party components and their licensing/copyright information is available
[via the REUSE tool](https://api.reuse.software/info/github.com/open-component-model/ocm-setup-action).

---

<p align="center"><img alt="Bundesministerium für Wirtschaft und Energie (BMWE)-EU funding logo" src="https://apeirora.eu/assets/img/BMWK-EU.png" width="400"/></p>
