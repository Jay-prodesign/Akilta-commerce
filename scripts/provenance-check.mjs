import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function validateProvenance({ manifest, register, dependencyBaseline, packageJson }) {
  const errors = [];
  const sourceByPath = new Map(register.source_files.map((row) => [row.path, row]));
  const manifestPaths = new Set(manifest.files.map((row) => row.path));

  for (const file of manifest.files) {
    const source = sourceByPath.get(file.path);
    if (!source) errors.push(`MISSING_SOURCE_PROVENANCE:${file.path}`);
    if (source?.third_party_code_copied && !source.external_source_ref) {
      errors.push(`THIRD_PARTY_SOURCE_REF_REQUIRED:${file.path}`);
    }
  }
  for (const source of register.source_files) {
    if (!manifestPaths.has(source.path)) errors.push(`PROVENANCE_PATH_NOT_IN_MANIFEST:${source.path}`);
    if (!Array.isArray(source.canonical_authority_refs) || source.canonical_authority_refs.length === 0) {
      errors.push(`AUTHORITY_REF_REQUIRED:${source.path}`);
    }
  }

  const baselineByName = new Map(dependencyBaseline.packages.map((row) => [row.name, row]));
  const provenanceDeps = new Map(register.direct_dependencies.map((row) => [row.name, row]));
  const declared = { ...(packageJson.dependencies ?? {}), ...(packageJson.devDependencies ?? {}) };
  const pm = packageJson.packageManager;
  if (pm && pm.includes('@')) {
    const split = pm.lastIndexOf('@');
    declared[pm.slice(0, split)] = pm.slice(split + 1);
  }

  for (const [name, version] of Object.entries(declared)) {
    const baseline = baselineByName.get(name);
    if (!baseline) {
      errors.push(`DEPENDENCY_BASELINE_MISSING:${name}`);
      continue;
    }
    if (baseline.version !== version) errors.push(`DEPENDENCY_VERSION_MISMATCH:${name}:${version}:${baseline.version}`);
    const license = String(baseline.license ?? '').trim().toUpperCase();
    if (!license || license === 'UNKNOWN' || license === 'UNLICENSED') errors.push(`DEPENDENCY_LICENSE_UNKNOWN:${name}`);
    if (!baseline.evidence) errors.push(`DEPENDENCY_LICENSE_EVIDENCE_MISSING:${name}`);
    const prov = provenanceDeps.get(name);
    if (!prov) errors.push(`DEPENDENCY_PROVENANCE_MISSING:${name}`);
    else {
      if (prov.version !== version) errors.push(`PROVENANCE_VERSION_MISMATCH:${name}`);
      if (prov.production_admitted !== false) errors.push(`PREMATURE_PRODUCTION_ADMISSION:${name}`);
    }
  }

  if (register.production_admission_state !== 'PENDING_TRANSITIVE_INSTALL_AUDIT') {
    errors.push('PRODUCTION_ADMISSION_STATE_MUST_REMAIN_PENDING');
  }
  for (const key of ['transitive_inventory_required','security_scan_required','license_scan_required','secret_scan_required','lockfile_required']) {
    if (register.production_admission_rules?.[key] !== true) errors.push(`ADMISSION_RULE_REQUIRED:${key}`);
  }

  return { status: errors.length === 0 ? 'PASS' : 'FAIL', errors };
}

export function loadJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

const here=fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(here)) {
  const [manifestPath, registerPath, baselinePath, packagePath] = process.argv.slice(2);
  if (!manifestPath || !registerPath || !baselinePath || !packagePath) {
    console.error('usage: provenance-check <manifest> <register> <dependency-baseline> <package-json>');
    process.exit(2);
  }
  const result=validateProvenance({manifest:loadJson(manifestPath), register:loadJson(registerPath), dependencyBaseline:loadJson(baselinePath), packageJson:loadJson(packagePath)});
  console.log(JSON.stringify(result));
  process.exit(result.status === 'PASS' ? 0 : 1);
}
