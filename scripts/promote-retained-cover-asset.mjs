import { readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const basePath = resolve(root, 'content/catalog-manifest.json');
const statePath = resolve(root, 'content/content-production-state.json');
const catalogPath = resolve(root, 'server/catalog-templates.json');
const reportPath = resolve(root, 'content/catalog-ingestion-report.json');
const requestedId = process.argv.find((argument) => argument.startsWith('--id='))?.slice('--id='.length);

async function readJson(filePath) { return JSON.parse(await readFile(filePath, 'utf8')); }
async function writeJson(filePath, value) { await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
async function exists(filePath) { try { await stat(filePath); return true; } catch { return false; } }
function runIngestion(id) {
  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(process.execPath, [resolve(root, 'scripts/ingest-content-assets.mjs'), `--only-id=${id}`], { cwd: root, env: process.env, stdio: 'inherit' });
    child.once('error', rejectProcess);
    child.once('exit', (code, signal) => code === 0 ? resolveProcess() : rejectProcess(new Error(`cover ingestion failed with ${signal || `exit code ${code}`}`)));
  });
}

const [baseBefore, stateBefore] = await Promise.all([readJson(basePath), readJson(statePath)]);
const candidate = baseBefore.covers.find((entry) => entry.id === requestedId);
if (!candidate) throw new Error(`Base cover not found: ${requestedId}`);
if (candidate.qa_status === 'PASS') throw new Error(`Base cover is already accepted: ${candidate.id}`);
const sourcePath = resolve(root, candidate.source_asset);
if (!(await exists(sourcePath))) throw new Error(`Cover source asset is missing: ${candidate.source_asset}`);
const backups = new Map();
for (const filePath of [basePath, catalogPath, reportPath]) backups.set(filePath, await readFile(filePath));

try {
  await runIngestion(candidate.id);
  const baseAfter = await readJson(basePath);
  const promoted = baseAfter.covers.find((entry) => entry.id === candidate.id);
  if (!promoted || promoted.qa_status !== 'PASS') throw new Error(`Retained cover failed technical QA: ${candidate.id}`);
  const coverPass = baseAfter.covers.filter((entry) => entry.qa_status === 'PASS').length;
  await writeJson(statePath, {
    ...stateBefore,
    updated_at: new Date().toISOString(),
    run_status: coverPass === baseAfter.covers.length ? 'catalog-complete' : 'cover-production-in-progress',
    current_progress: { ...stateBefore.current_progress, covers_pass: coverPass },
    imagegen_history: [...(stateBefore.imagegen_history || []), {
      stage: 'retained catalog cover ingestion',
      id: candidate.id,
      generated: 1,
      qa_status: promoted.qa_status,
      qa_notes: promoted.qa_notes,
      cover_pass: coverPass,
    }],
  });
  console.log(JSON.stringify({ id: candidate.id, qa_status: promoted.qa_status, qa_notes: promoted.qa_notes, final_covers_pass: coverPass, final_covers_total: baseAfter.covers.length }, null, 2));
} catch (error) {
  for (const [filePath, contents] of backups) await writeFile(filePath, contents);
  const optimizedPath = resolve(root, candidate.optimized_asset);
  await unlink(optimizedPath).catch(() => {});
  throw error;
}
