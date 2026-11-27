// Signs and verifies OCM component versions keyless with Sigstore (cosign) through the ocm CLI.
// Invoked from sign/cosign/action.yaml and verify/cosign/action.yaml through actions/github-script.
// No cosign is installed here: ocm runs the cosign on PATH, or downloads its pinned,
// checksum-verified FIPS cosign build itself.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const GITHUB_ACTIONS_ISSUER = 'https://token.actions.githubusercontent.com';

const lines = (value) => (value || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

const bool = (value, fallback) => (value || fallback).toLowerCase() === 'true';

// Writes an OCM configuration holding one signing entry for the signature and returns its path.
// The entry is scoped to the signature, so it wins over unscoped signing entries in other files.
function writeConfig(signature, entry) {
  const dir = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP, 'ocm-sigstore-'));
  const file = path.join(dir, 'config.json');
  const config = {
    type: 'generic.config.ocm.software/v1',
    configurations: [{ type: 'signing.config.ocm.software/v1alpha1', signature, ...entry }],
  };
  // JSON is valid YAML for ocm and quotes identities and regular expressions safely.
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
  return file;
}

// Returns the files of ocm's configuration lookup without --config, in ocm's order: OCM_CONFIG, then
// the XDG and home directory, then the working directory. The directory of the ocm binary is left out;
// the setup action installs it into the tool cache, which holds no configuration.
function discoveredConfigs() {
  const home = os.homedir();
  const xdg = process.env.XDG_CONFIG_HOME;
  const candidates = [
    process.env.OCM_CONFIG,
    ...(xdg ? [path.join(xdg, 'ocm', 'config'), path.join(xdg, '.ocmconfig')] : []),
    path.join(home, '.config', 'ocm', 'config'),
    path.join(home, '.config', '.ocmconfig'),
    path.join(home, '.ocm', 'config'),
    path.join(home, '.ocmconfig'),
    path.join(process.cwd(), '.ocm', 'config'),
    path.join(process.cwd(), '.ocmconfig'),
  ];
  return [...new Set(candidates.filter((p) => p && fs.statSync(p, { throwIfNoEntry: false })?.isFile()).map((p) => fs.realpathSync(p)))];
}

// Returns the --config arguments: the user's files (the config input, else what ocm would discover),
// then the generated file. ocm lets later files win, so a signing entry for the same signature in a
// user file (e.g. a ./.ocmconfig in the checked out repository) cannot replace the generated signer
// or verifier.
function configArgs(generated, userConfigs) {
  const configs = lines(userConfigs);
  return [...(configs.length > 0 ? configs : discoveredConfigs()), generated].flatMap((c) => ['--config', c]);
}

async function requireOcm(io) {
  try {
    await io.which('ocm', true);
  } catch {
    throw new Error('ocm is not on PATH: run open-component-model/ocm-setup-action before this action');
  }
}

// A reference names a repository only (e.g. transport-archive, the default of ocm add cv) unless it has
// a "//" separating the component, ignoring the one of a URL scheme.
const isRepository = (ref) => !ref.replace(/^[A-Za-z0-9]+::/, '').replace(/^[a-z]+:\/\//, '').includes('//');

// Replaces repository references by references to every component version they hold.
async function expand(exec, refs, args) {
  const expanded = [];
  for (const ref of refs) {
    if (!isRepository(ref)) {
      expanded.push(ref);
      continue;
    }
    const { exitCode, stdout, stderr } = await exec.getExecOutput('ocm', ['get', 'component-version', ...args, ref, '-o', 'json'],
      { silent: true, ignoreReturnCode: true });
    if (exitCode !== 0) {
      throw new Error(`listing the component versions in ${ref} failed: ${stderr.trim()}`);
    }
    const versions = [].concat(JSON.parse(stdout)).map(({ component: c }) => `${ref}//${c.name}:${c.version}`);
    if (versions.length === 0) {
      throw new Error(`${ref} holds no component versions`);
    }
    expanded.push(...versions);
  }
  return expanded;
}

// configFor(ref) returns the generated configuration to use for a component version reference,
// configFor() the one reported as the config output.
async function run({ core, exec, io }, signature, configFor, refs, commands) {
  const file = configFor();
  core.setOutput('config', file);
  if (refs.length === 0) {
    core.info(`Wrote the OCM signing configuration for signature "${signature}" to ${file}`);
    return;
  }
  await requireOcm(io);
  const listing = configArgs(file, process.env.OCM_USER_CONFIG);
  for (const ref of await expand(exec, refs, listing)) {
    const args = configArgs(configFor(ref), process.env.OCM_USER_CONFIG);
    for (const command of commands) {
      await exec.exec('ocm', [command, 'component-version', ...args, '--signature', signature, ref]);
    }
  }
}

// Returns the identity Fulcio certifies for this job's OIDC token. The certificate names the workflow
// file defining the job (job_workflow_ref), which inside a reusable workflow is the called workflow,
// not github.workflow_ref of the caller.
async function workflowIdentity(core) {
  if (!process.env.ACTIONS_ID_TOKEN_REQUEST_URL) {
    throw new Error('keyless signing needs the GitHub OIDC token: grant the job "permissions: id-token: write"');
  }
  const token = await core.getIDToken('sigstore');
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  if (!claims.iss || !claims.job_workflow_ref) {
    throw new Error('the GitHub OIDC token has no iss or job_workflow_ref claim');
  }
  return { issuer: claims.iss, identity: `${process.env.GITHUB_SERVER_URL}/${claims.job_workflow_ref}` };
}

async function sign({ core, exec, io }) {
  const signature = process.env.OCM_SIGNATURE || 'default';
  const { issuer, identity } = await workflowIdentity(core);
  core.setOutput('certificate-identity', identity);
  core.setOutput('certificate-oidc-issuer', issuer);
  core.info(`Signing as ${identity} (issuer ${issuer})`);

  const file = writeConfig(signature, {
    signer: { type: 'SigstoreSigningConfiguration/v1alpha1' },
    verifier: {
      type: 'SigstoreVerificationConfiguration/v1alpha1',
      certificateIdentity: identity,
      certificateOIDCIssuer: issuer,
    },
  });
  const commands = bool(process.env.OCM_VERIFY, 'true') ? ['sign', 'verify'] : ['sign'];
  await run({ core, exec, io }, signature, () => file, lines(process.env.OCM_COMPONENT_VERSIONS), commands);
}

// Returns the repository whose workflows must have signed: the repository input, else the repository
// the component name points to (<server host>/<owner>/<repo>[/...]), else the running repository.
// The component name comes from the reference the caller asked for, not from the signature.
function signerRepository(ref) {
  if (process.env.OCM_REPOSITORY) {
    return process.env.OCM_REPOSITORY;
  }
  const name = ref?.includes('//') ? ref.slice(ref.lastIndexOf('//') + 2).split(/[:@]/)[0] : '';
  const [host, owner, repo] = name.split('/');
  if (host === new URL(process.env.GITHUB_SERVER_URL).host && owner && repo) {
    return `${owner}/${repo}`;
  }
  return process.env.GITHUB_REPOSITORY;
}

// Matches the workflows of the repository, optionally narrowed to a workflow file and a ref; "*" in
// either matches any characters. The repository matches case-insensitively like GitHub does, since
// component names are lowercase.
function repositoryIdentityRegexp(repository) {
  const { OCM_WORKFLOW: workflow, OCM_REF: ref } = process.env;
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const glob = (s, any) => escape(s).replaceAll('\\*', any);
  const file = workflow ? glob(path.basename(workflow), '[^/@]*') : '[^/@]+';
  return `^${escape(process.env.GITHUB_SERVER_URL)}/(?i:${escape(repository)})/\\.github/workflows/${file}@${ref ? glob(ref, '.*') : '.+'}$`;
}

async function verify({ core, exec, io }) {
  const signature = process.env.OCM_SIGNATURE || 'default';
  const {
    OCM_CERTIFICATE_IDENTITY: identity,
    OCM_CERTIFICATE_IDENTITY_REGEXP: identityRegexp,
    OCM_CERTIFICATE_OIDC_ISSUER: issuer,
    OCM_CERTIFICATE_OIDC_ISSUER_REGEXP: issuerRegexp,
  } = process.env;
  if (identity && identityRegexp) {
    throw new Error('set at most one of certificate-identity and certificate-identity-regexp');
  }
  if ((identity || identityRegexp) && (process.env.OCM_WORKFLOW || process.env.OCM_REF)) {
    throw new Error('workflow and ref cannot be combined with certificate-identity or certificate-identity-regexp');
  }
  if (issuer && issuerRegexp) {
    throw new Error('set at most one of certificate-oidc-issuer and certificate-oidc-issuer-regexp');
  }

  const issuerConstraint = issuerRegexp
    ? { certificateOIDCIssuerRegexp: issuerRegexp }
    : { certificateOIDCIssuer: issuer || GITHUB_ACTIONS_ISSUER };
  const files = new Map();
  const configFor = (ref) => {
    const identityConstraint = identity
      ? { certificateIdentity: identity }
      : { certificateIdentityRegexp: identityRegexp || repositoryIdentityRegexp(signerRepository(ref)) };
    const expected = `${Object.values(identityConstraint)[0]} (issuer ${Object.values(issuerConstraint)[0]})`;
    core.info(`Expecting signer ${expected}${ref ? ` for ${ref}` : ''}`);
    if (!files.has(expected)) {
      files.set(expected, writeConfig(signature, {
        verifier: { type: 'SigstoreVerificationConfiguration/v1alpha1', ...identityConstraint, ...issuerConstraint },
      }));
    }
    return files.get(expected);
  };
  await run({ core, exec, io }, signature, configFor, lines(process.env.OCM_COMPONENT_VERSIONS), ['verify']);
}

module.exports = { sign, verify };
