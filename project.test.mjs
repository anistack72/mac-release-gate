import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { auditRelease, sha256, runTool } from './index.mjs';
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'release-gate-')); t.after(() => rm(root, { recursive: true, force: true }));
  const app = path.join(root, 'Example with spaces.app'), artifact = path.join(root, 'Example.dmg');
  await mkdir(app); await writeFile(artifact, 'abc'); return { app, artifact };
}
const pass = async (command, args) => ({ ok: true, output: args.includes('--display') ? 'Authority=Developer ID Application: Example\nTeamIdentifier=EXAMPLE' : 'accepted' });
test('computes a streaming SHA-256 and checks expected values', async t => {
  const { artifact } = await fixture(t); const digest = await sha256(artifact);
  assert.equal(digest.sha256, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal((await auditRelease({ artifact, expectedSha256: '0'.repeat(64) })).checks[0].status, 'fail');
});
test('native checks use argument arrays and support spaces safely', async t => {
  const f = await fixture(t), seen = [];
  const report = await auditRelease({ ...f, platform: 'darwin', runner: async (cmd,args) => { seen.push([cmd,args]); return pass(cmd,args); } });
  assert.equal(report.checks.some(c => c.status !== 'pass'), false);
  assert.ok(seen.some(([,args]) => args.includes(f.app)));
  assert.ok(!JSON.stringify(report).includes(path.dirname(f.app)));
});
test('ad-hoc signatures do not satisfy distribution identity', async t => {
  const f = await fixture(t);
  const r = await auditRelease({ ...f, platform: 'darwin', runner: async () => ({ ok: true, output: 'Signature=adhoc' }) });
  assert.equal(r.checks.find(c => c.id === 'app.identity').status, 'fail');
});
test('native checks on another platform are marked unperformed and fail', async t => {
  const f = await fixture(t); let called = false;
  const r = await auditRelease({ ...f, platform: 'linux', runner: async () => { called = true; } });
  assert.equal(called, false); assert.equal(r.checks.find(c => c.id === 'platform.macos').status, 'fail');
});
test('stapling can be advisory or required', async t => {
  const f = await fixture(t);
  const runner = async (cmd,args) => args[0] === 'stapler' ? { ok: false, output: 'no ticket' } : pass(cmd,args);
  for (const [requireStaple,status] of [[false,'warn'],[true,'fail']]) {
    const r = await auditRelease({ ...f, platform: 'darwin', runner, requireStaple }); assert.equal(r.checks.find(c => c.id === 'notarization.staple').status,status);
  }
});
test('does not treat a checksum-only artifact as a verified app', async t => {
  const { artifact } = await fixture(t); const r = await auditRelease({ artifact, platform: 'darwin', runner: pass }); assert.ok(r.checks.some(c => c.id === 'app.not-supplied' && c.status === 'warn'));
});
test('invalid checksums and missing inputs fail early', async () => {
  await assert.rejects(auditRelease()); await assert.rejects(auditRelease({ expectedSha256: 'abc', artifact: 'a' }));
});
test('missing system tools produce controlled errors', async () => {
  const result = await runTool('a-nonexistent-release-gate-tool', []); assert.equal(result.ok, false); assert.match(result.reason, /not found/);
});
