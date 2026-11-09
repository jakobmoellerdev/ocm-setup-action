// Installs the OCM v2 CLI from the open-component-model/open-component-model releases.
// Invoked from action.yaml through actions/github-script.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const platforms = { Linux: 'linux', macOS: 'darwin', Windows: 'windows' };
const architectures = { X64: 'amd64', ARM64: 'arm64' };

module.exports = async ({ github, core, exec }) => {
  const version = process.env.OCM_VERSION || 'latest';
  const [owner, repo] = (process.env.OCM_REPO || 'open-component-model/open-component-model').split('/');
  const verifyAttestation = (process.env.OCM_VERIFY_ATTESTATION || 'true').toLowerCase() === 'true';
  const token = process.env.OCM_TOKEN;

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

  const binDir = path.join(process.env.RUNNER_TEMP, 'ocm', tag, 'bin');
  const bin = path.join(binDir, os === 'windows' ? 'ocm.exe' : 'ocm');
  fs.mkdirSync(binDir, { recursive: true });

  core.info(`Installing ocm ${tag} (${os}/${arch}) from ${owner}/${repo}`);
  const res = await fetch(asset.browser_download_url);
  if (!res.ok) {
    throw new Error(`downloading ${asset.browser_download_url}: HTTP ${res.status}`);
  }
  const data = Buffer.from(await res.arrayBuffer());

  const actual = `sha256:${crypto.createHash('sha256').update(data).digest('hex')}`;
  if (actual !== asset.digest) {
    throw new Error(`digest mismatch for ${assetName}: expected ${asset.digest}, got ${actual}`);
  }
  fs.writeFileSync(bin, data, { mode: 0o755 });

  if (verifyAttestation) {
    await exec.exec('gh', ['attestation', 'verify', bin, '--repo', `${owner}/${repo}`], {
      env: { ...process.env, GH_TOKEN: token },
    });
  }

  core.addPath(binDir);
  core.setOutput('version', tag);
  core.setOutput('path', bin);
};
