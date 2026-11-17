// Token launch radar (Node 22, standard library only).
//
// Reads the sealed snapshot, scores every pre-token protocol that passes the
// launch screen, and writes the ranked board, the dashboard's data, the
// dashboard itself, its screenshots, and the dossier the judge reads.
//
// Local run: mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
// In the grader: the snapshot sits at /input/snapshot.json and outputs go to /output.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBoard, buildDataScript, parseSnapshot, validateBoard } from './lib/radar.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const REPO_ROOT = fileURLToPath(new URL('.', import.meta.url));
const DOSSIER_TEXT_CAP = 65_536;
const SCREENSHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

/** Read --flag <value> or --flag=<value> from the arguments, else the fallback. */
function flag(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const joined = process.argv.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

function resolveInput(): string {
  const given = flag('input', '/input');
  const file = given.endsWith('.json') ? given : join(given, 'snapshot.json');
  if (!existsSync(file)) {
    fail(`no snapshot at ${file}: pass --input <snapshot.json|directory> or mount the sealed /input`);
  }
  return file;
}

/** Copy a directory's files recursively, skipping dot-names, into `to`. */
function copyTree(from: string, to: string): string[] {
  const copied: string[] = [];
  if (!existsSync(from)) return copied;
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const source = join(from, name);
    const target = join(to, name);
    if (statSync(source).isDirectory()) {
      copyTree(source, target);
      continue;
    }
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, target);
    copied.push(name);
  }
  return copied;
}

const snapshot = parseSnapshot(readFileSync(resolveInput(), 'utf8'));
const board = buildBoard(snapshot);
const issue = validateBoard(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

const out = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
mkdirSync(out, { recursive: true });
mkdirSync(join(out, 'dashboard'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });

writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board.rows })}\n`);
writeFileSync(join(out, 'data.js'), buildDataScript(board));

copyTree(join(REPO_ROOT, 'dashboard'), join(out, 'dashboard'));
const shots = copyTree(join(REPO_ROOT, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  fail(`screenshots/ holds ${shots.length} image(s): hand in 3, the board, a detail view and a filtered view`);
}
for (const name of shots) {
  if (!SCREENSHOT_NAME.test(name)) {
    fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: DOSSIER_TEXT_CAP,
    screenshots: { max: 4, max_bytes: 524_288 },
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  }),
);

process.stdout.write(
  `token radar: ${board.scanned} protocols scanned, ${board.preToken} record no token, ` +
    `${board.rows.length} ranked, ${board.setAside.length} set aside, ${board.tokened} already trading (comps only)\n` +
    `token radar: wrote board.json (${board.rows.length} rows), data.js, dashboard/, screenshots/ (${shots.length}) and dossier.json to ${out}\n`,
);
