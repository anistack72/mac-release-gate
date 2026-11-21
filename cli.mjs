#!/usr/bin/env node
import { auditRelease } from './index.mjs';
import { options, formatReport, exitCode, clean } from './support.mjs';
try {
  const args = options({ app: { type: 'string' }, artifact: { type: 'string' }, 'expect-sha256': { type: 'string' }, 'require-staple': { type: 'boolean' }, strict: { type: 'boolean' } });
  if (args.help) console.log('Mac Release Gate\n\nnode cli.mjs --app /path/Example.app [--artifact /path/Example.dmg]\n  [--expect-sha256 HEX] [--require-staple] [--strict]\n  [--format text|json|markdown|html]\n\nNative checks require macOS. Hashing works on all supported Node platforms.');
  else {
    if (args.positionals.length) throw new Error('Unexpected positional arguments');
    const report = await auditRelease({ ...args, expectedSha256: args['expect-sha256'], requireStaple: args['require-staple'] });
    console.log(formatReport(report, args.format)); process.exitCode = exitCode(report, args.strict);
  }
} catch (error) { console.error(`Mac Release Gate: ${clean(error.message)}`); process.exitCode = 2; }
