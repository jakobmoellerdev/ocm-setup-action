# Open Component Model CLI setup action

[![REUSE status](https://api.reuse.software/badge/github.com/open-component-model/ocm-setup-action)](https://api.reuse.software/info/github.com/open-component-model/ocm-setup-action)

This GitHub Action installs a dedicated version of the ocm CLI to be used in further steps. For example, it could be used in a Makefile executed as subsequent step to build a project.

The repository provides two actions:

| Action | CLI | Releases |
|---|---|---|
| `open-component-model/ocm-setup-action/v2` | OCM v2 | [open-component-model/open-component-model](https://github.com/open-component-model/open-component-model/releases) |
| `open-component-model/ocm-setup-action` | OCM v1 (legacy) | [open-component-model/ocm](https://github.com/open-component-model/ocm/releases) |

## OCM v2

Installs the `ocm` binary matching the runner OS (Linux, macOS, Windows) and architecture (x64, arm64), verifies its SHA-256 digest against the digest GitHub records for the release asset and its build provenance attestation, and adds it to the `PATH`.

### Inputs

| Input | Default | Description |
|---|---|---|
| `version` | `latest` | `latest` or a release version such as `0.23.0` / `v0.23.0`. `latest` resolves to the newest non-prerelease. |
| `repo` | `open-component-model/open-component-model` | Repository hosting the releases. |
| `verify-attestation` | `true` | Verify the build provenance attestation with `gh attestation verify`. Needs the `gh` CLI on the runner (preinstalled on GitHub-hosted runners); set to `false` on runners without it. |
| `token` | `${{ github.token }}` | Token for GitHub API calls and attestation verification. |

### Outputs

| Output | Description |
|---|---|
| `version` | Installed release tag, e.g. `v0.23.0`. |
| `path` | Absolute path of the installed `ocm` binary. |

### Example usage

```yaml
jobs:
  ocm:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: open-component-model/ocm-setup-action/v2@main
        with:
          version: 0.23.0
      - run: ocm version
```

## OCM v1 (legacy)

### Inputs

#### `version`

**Optional** The ocm-cli version to install. By default the latest version is installed.

#### `repo`

**Optional** The repository of the ocm-cli to install. Default `"open-component-model/ocm"`.

### Example usage

```yaml
jobs:
  ocm-setup-action:
    runs-on: ubuntu-latest
    name: ocm-setup-action
    steps:
      - uses: open-component-model/ocm-setup-action@main
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
