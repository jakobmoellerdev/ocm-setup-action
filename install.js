// Installs the OCM v2 CLI from the open-component-model/open-component-model releases.
// Invoked from action.yaml through actions/github-script in two steps around actions/cache:
// resolve() picks the release asset and install directory, install() fills the directory
// (unless a restored cache already holds the verified binary) and puts it on PATH.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const platforms = { Linux: 'linux', macOS: 'darwin', Windows: 'windows' };
const architectures = { X64: 'amd64', ARM64: 'arm64' };

const sha256 = (data) => `sha256:${crypto.createHash('sha256').update(data).digest('hex')}`;

async function resolve({ github, core }) {
  const version = process.env.OCM_VERSION || 'latest';
  const [owner, repo] = (process.env.OCM_REPO || 'open-component-model/open-component-model').split('/');

  const os = platforms[process.env.RUNNER_OS];
  const arch = architectures[process.env.RUNNER_ARCH];
  if (!os || !arch) {
    throw new Error(`unsupported runner ${process.env.RUNNER_OS}/${process.env.RUNNER_ARCH}`);
  }

  let release;
  try {
    release = version === 'latest'
      ? (await github.rest.repos.getLatestRelease({ owner, repo })).data
      : (await github.rest.repos.getReleaseByTag({ owner, repo, tag: `v${version.replace(/^v/, '')}` })).data;
  } catch (err) {
    throw new Error(`cannot resolve release ${version} of ${owner}/${repo}: ${err.message}`);
  }
  const tag = release.tag_name;

  const assetName = `ocm-${os}-${arch}`;
  const asset = release.assets.find((a) => a.name === assetName);
  if (!asset) {
    throw new Error(`release ${tag} of ${owner}/${repo} has no asset ${assetName}`);
  }
  if (!asset.digest?.startsWith('sha256:')) {
    throw new Error(`release ${tag} of ${owner}/${repo} publishes no sha256 digest for ${assetName}`);
  }

  const dir = path.join(process.env.RUNNER_TOOL_CACHE || process.env.RUNNER_TEMP, 'ocm', tag.replace(/^v/, ''), arch);
  core.setOutput('version', tag);
  core.setOutput('url', asset.url);
  core.setOutput('digest', asset.digest);
  core.setOutput('dir', dir);
  core.setOutput('path', path.join(dir, os === 'windows' ? 'ocm.exe' : 'ocm'));
  core.setOutput('cache-key', `ocm-${owner}-${repo}-${tag}-${os}-${arch}-${asset.digest}`);
}

async function install({ core, exec }) {
  const { OCM_REPO: repo, OCM_VERSION: tag, OCM_URL: url, OCM_DIGEST: digest, OCM_DIR: dir, OCM_PATH: bin } = process.env;

  // A restored cache (or a persistent tool cache on self-hosted runners) is only trusted
  // if it still matches the digest GitHub records for the release asset.
  const cached = fs.existsSync(bin) && sha256(fs.readFileSync(bin)) === digest;
  if (cached) {
    core.info(`Using cached ocm ${tag} from ${bin}`);
  } else {
    core.info(`Installing ocm ${tag} from ${url}`);
    // The API asset endpoint redirects to the blob storage; fetch drops the Authorization
    // header on that cross-origin redirect. Authenticated requests avoid anonymous rate limits.
    const headers = { accept: 'application/octet-stream' };
    if (process.env.OCM_TOKEN) {
      headers.authorization = `Bearer ${process.env.OCM_TOKEN}`;
    }
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`downloading ${url}: HTTP ${res.status}`);
    }
    const data = Buffer.from(await res.arrayBuffer());
    const actual = sha256(data);
    if (actual !== digest) {
      throw new Error(`digest mismatch for ${url}: expected ${digest}, got ${actual}`);
    }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(bin, data, { mode: 0o755 });
  }

  if ((process.env.OCM_VERIFY_ATTESTATION || 'true').toLowerCase() === 'true') {
    await exec.exec('gh', ['attestation', 'verify', bin, '--repo', repo], {
      env: { ...process.env, GH_TOKEN: process.env.OCM_TOKEN },
    });
  }

  core.addPath(dir);
  core.setOutput('cache-hit', String(cached));
}

module.exports = { resolve, install };
