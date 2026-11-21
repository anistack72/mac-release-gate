import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { clean } from './support.mjs';
const exec = promisify(execFile);
export async function runTool(command, args) {
  try {
    const result = await exec(command, args, { timeout: 20000, maxBuffer: 1024 * 1024, windowsHide: true });
    return { ok: true, output: result.stdout + result.stderr };
  } catch (error) {
    return { ok: false, output: `${error.stdout ?? ''}${error.stderr ?? ''}`, reason: error.killed ? 'Tool timed out' : error.code === 'ENOENT' ? 'Required system tool was not found' : `Tool exited with ${error.code ?? 'an error'}` };
  }
}
export async function sha256(file) {
  const before = await stat(file);
  if (!before.isFile()) throw new Error('Checksum input must be a regular file');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  const after = await stat(file);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('Artifact changed while hashing');
  return { sha256: hash.digest('hex'), sizeBytes: after.size };
}
export async function auditRelease({ app, artifact, expectedSha256, requireStaple = false, platform = process.platform, runner = runTool } = {}) {
  if (!app && !artifact) throw new Error('Provide an app bundle or an artifact');
  if (expectedSha256 && (!artifact || !/^[a-f0-9]{64}$/i.test(expectedSha256))) throw new Error('Expected SHA-256 requires an artifact and exactly 64 hexadecimal characters');
  const checks = [], evidence = {};
  if (artifact) {
    artifact = path.resolve(artifact);
    const digest = await sha256(artifact);
    evidence.artifact = { name: path.basename(artifact), ...digest };
    checks.push({ id: 'artifact.sha256', status: !expectedSha256 || digest.sha256 === expectedSha256.toLowerCase() ? 'pass' : 'fail', message: expectedSha256 ? digest.sha256 === expectedSha256.toLowerCase() ? 'Artifact SHA-256 matches the expected value.' : 'Artifact SHA-256 does not match the expected value.' : `SHA-256: ${digest.sha256}. No expected checksum supplied; integrity against a trusted source has not been established.` });
  }
  if (app) {
    app = path.resolve(app);
    if (!(await stat(app)).isDirectory() || !app.toLowerCase().endsWith('.app')) throw new Error('App must be an existing .app directory');
    evidence.app = { name: path.basename(app) };
  }
  const nativeRequired = Boolean(app || (artifact && /\.(dmg|pkg)$/i.test(artifact)));
  if (nativeRequired && platform !== 'darwin') {
    checks.push({ id: 'platform.macos', status: 'fail', message: 'Native signing, Gatekeeper and stapling checks require macOS. These checks were not performed.' });
  } else if (nativeRequired) {
    const tasks = [];
    if (app) {
      tasks.push({ id: 'app.signature', command: '/usr/bin/codesign', args: ['--verify', '--deep', '--strict', '--verbose=2', app], message: 'App bundle signature and nested-code verification' });
      tasks.push({ id: 'app.gatekeeper', command: '/usr/sbin/spctl', args: ['--assess', '--type', 'execute', '--verbose=2', app], message: 'Gatekeeper execution assessment under the current machine policy' });
      tasks.push({ id: 'app.identity', command: '/usr/bin/codesign', args: ['--display', '--verbose=4', app], identity: true, message: 'Distribution signing identity' });
    }
    const stapleTarget = artifact && /\.(dmg|pkg)$/i.test(artifact) ? artifact : app;
    if (stapleTarget) tasks.push({ id: 'notarization.staple', command: '/usr/bin/xcrun', args: ['stapler', 'validate', stapleTarget], staple: true, message: 'Stapled notarization ticket validation' });
    for (const task of tasks) {
      const result = await runner(task.command, task.args);
      const output = clean(result.output).replaceAll(app ?? '\u0000', app ? path.basename(app) : '').replaceAll(artifact ?? '\u0000', artifact ? path.basename(artifact) : '').slice(0, 1500);
      let ok = result.ok;
      if (task.identity) ok = ok && /Authority=Developer ID Application:/.test(result.output) && !/Signature=adhoc/.test(result.output);
      const status = ok ? 'pass' : task.staple && !requireStaple ? 'warn' : 'fail';
      checks.push({ id: task.id, status, message: `${task.message}: ${ok ? 'passed' : clean(result.reason ?? 'expected distribution evidence was not found')}.` });
      evidence[task.id] = { status, output };
    }
  }
  if (!app) checks.push({ id: 'app.not-supplied', status: 'warn', message: 'No app bundle supplied. A DMG checksum or ticket check does not verify the application inside it.' });
  return { schemaVersion: 1, tool: 'Mac Release Gate', summary: `${checks.filter(c => c.status === 'pass').length}/${checks.length} checks passed. Read-only verification; no signing, upload, installation or credential changes.`, checks, evidence, limitations: ['Gatekeeper results depend on the current machine policy.', 'This tool does not validate update migrations, permissions or every bundled dependency.', 'Notarization and code signing are separate from updater signatures.'] };
}
