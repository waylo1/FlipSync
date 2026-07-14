#!/usr/bin/env node
// Checks STATIC (INVARIANT-SPEC.md §5, checks C-1/2/6/7, C-3, C-09, C-23, C-reg).
// Mode baseline/expected-fail (correction ERRATA E-6, MASTER-REMED.md §3.1) : les violations
// listées dans closure-check.baseline.json sont tolérées ; tout hit NOUVEAU fait échouer la CI.
// N'applique aucune décision — ce script exécute la doctrine (CLAUDE.md « Doctrine multi-canal »).
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASELINE_PATH = join(ROOT, 'scripts', 'closure-check.baseline.json');
const UPDATE_BASELINE = process.argv.includes('--update-baseline');

const POOL = ['leboncoin', 'lbc', 'vinted', 'ebay', 'shopify', 'rakuten', 'amazon', 'manomano', 'cdiscount', 'etsy'];
const POOL_RE = new RegExp(`\\b(${POOL.join('|')})\\b`, 'i');
const CHANNEL_MEMBERS = ['LEBONCOIN', 'VINTED', 'EBAY', 'SHOPIFY', 'RAKUTEN', 'AMAZON', 'MANOMANO', 'CDISCOUNT', 'ETSY'];
const CHANNEL_COMPARE_RE = new RegExp(`(===|case)\\s*['"\`]?\\s*(Marketplace\\.|SalesChannel\\.)?(${CHANNEL_MEMBERS.join('|')})\\b`);

const CORE_DIRS = [
  'packages/core/src',
  'packages/wallet/src',
  'packages/ai/src',
  'apps/api/src',
  'apps/mobile/src',
  'apps/web/src',
];
// Exclusion autorisée (INVARIANT-SPEC §5) : déclaration d'enum des canaux + enums générés.
const CORE_EXCLUDE_FILES = new Set(['packages/core/src/generated/enums.ts']);
const SCHEMA_PATH = 'packages/db/prisma/schema.prisma';

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '.turbo') continue;
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function relPath(p) {
  return relative(ROOT, p).split(sep).join('/');
}

function scanLines(absPath, matcher) {
  const rel = relPath(absPath);
  const lines = readFileSync(absPath, 'utf8').split('\n');
  const hits = [];
  lines.forEach((line, i) => {
    if (matcher(line)) hits.push(`${rel}:${i + 1}`);
  });
  return hits;
}

const violations = { 'C-1267': [], 'C-3': [], 'C-09': [] };

// C-1/2/6/7 : identifiant matchant POOL dans CORE (hors exclusions).
for (const dir of CORE_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    const rel = relPath(file);
    if (CORE_EXCLUDE_FILES.has(rel)) continue;
    violations['C-1267'].push(...scanLines(file, (line) => POOL_RE.test(line)));
  }
}
{
  const schemaFile = join(ROOT, SCHEMA_PATH);
  if (existsSync(schemaFile)) {
    // Exclusion : la ligne de déclaration de l'enum Marketplace elle-même.
    let inEnum = false;
    const lines = readFileSync(schemaFile, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/^\s*enum\s+Marketplace\b/.test(line)) inEnum = true;
      else if (inEnum && /^\s*}/.test(line)) inEnum = false;
      else if (!inEnum && POOL_RE.test(line)) violations['C-1267'].push(`${SCHEMA_PATH}:${i + 1}`);
    });
  }
}

// C-3 : comparaison/switch sur une valeur de l'enum canaux, hors packages/marketplace.
for (const dir of CORE_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    const rel = relPath(file);
    if (rel.startsWith('packages/marketplace/')) continue;
    violations['C-3'].push(...scanLines(file, (line) => CHANNEL_COMPARE_RE.test(line)));
  }
}

// C-09 : packages/marketplace n'importe jamais @flipsync/wallet.
for (const file of walk(join(ROOT, 'packages/marketplace/src'))) {
  violations['C-09'].push(...scanLines(file, (line) => /['"]@flipsync\/wallet['"]/.test(line)));
}

// C-23 / C-reg : sans porteur code (module FSM `step`, registre connecteurs) au 2026-07-13 —
// cf. INVARIANT-SPEC §7 « [à coder avec le Lot 1] » et THREAT-MODEL/E-4 (registre pas encore créé).
// Rien à grepper tant que ces modules n'existent pas ; le check s'activera de lui-même une fois
// les fichiers créés (walk() les trouvera alors sous CORE_DIRS / packages/marketplace).
const NOT_APPLICABLE = { 'C-23': 'module FSM non codé (Lot 1)', 'C-reg': 'registre connecteurs non codé (Lot 1)' };

const baseline = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : { checks: {} };

if (UPDATE_BASELINE) {
  const snapshot = { generatedAt: new Date().toISOString().slice(0, 10), checks: violations };
  writeFileSync(BASELINE_PATH, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`Baseline écrite : ${relPath(BASELINE_PATH)}`);
  process.exit(0);
}

let newViolations = false;
console.log('--- closure-check (INVARIANT-SPEC §5) — mode baseline/expected-fail ---\n');
for (const check of Object.keys(violations)) {
  const current = new Set(violations[check]);
  const known = new Set(baseline.checks?.[check] ?? []);
  const fresh = [...current].filter((h) => !known.has(h));
  const tolerated = [...current].filter((h) => known.has(h));
  const status = fresh.length > 0 ? '❌' : current.size > 0 ? '⚠️ (baseline)' : '✅';
  console.log(`${status} ${check} — ${current.size} hit(s) (${tolerated.length} baseline, ${fresh.length} nouveau(x))`);
  for (const h of fresh) console.log(`   NOUVEAU  ${h}`);
  if (fresh.length > 0) newViolations = true;
}
for (const [check, reason] of Object.entries(NOT_APPLICABLE)) {
  console.log(`⏭️  ${check} — N/A (${reason})`);
}
console.log();

if (newViolations) {
  console.error('closure-check: violation(s) NOUVELLE(S) hors baseline — build rouge.');
  process.exit(1);
}
console.log('closure-check: aucune violation nouvelle (baseline tolérée jusqu\'à C1).');
