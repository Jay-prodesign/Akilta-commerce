import { validateProvenance, loadJson } from '../../scripts/provenance-check.mjs';

function assert(condition, message) { if (!condition) throw new Error(message); }
const manifest=loadJson(process.env.MANIFEST_PATH);
const register=loadJson(process.env.REGISTER_PATH);
const dependencyBaseline=loadJson(process.env.BASELINE_PATH);
const packageJson=loadJson(process.env.PACKAGE_PATH);

// For the pre-upload local test, prospective provenance artifacts must already be present in manifest.
const base={manifest,register,dependencyBaseline,packageJson};
const tests=[
 ['actual provenance package passes',()=>assert(validateProvenance(base).status==='PASS',JSON.stringify(validateProvenance(base)))],
 ['unknown dependency license fails',()=>{const b=structuredClone(dependencyBaseline); b.packages.find(x=>x.name==='hono').license='UNKNOWN'; assert(validateProvenance({...base,dependencyBaseline:b}).errors.some(x=>x.startsWith('DEPENDENCY_LICENSE_UNKNOWN:hono')),'unknown license accepted');}],
 ['missing dependency baseline fails',()=>{const b=structuredClone(dependencyBaseline); b.packages=b.packages.filter(x=>x.name!=='zod'); assert(validateProvenance({...base,dependencyBaseline:b}).errors.some(x=>x==='DEPENDENCY_BASELINE_MISSING:zod'),'missing baseline accepted');}],
 ['version mismatch fails',()=>{const b=structuredClone(dependencyBaseline); b.packages.find(x=>x.name==='pg').version='0.0.0'; assert(validateProvenance({...base,dependencyBaseline:b}).errors.some(x=>x.startsWith('DEPENDENCY_VERSION_MISMATCH:pg')),'version mismatch accepted');}],
 ['missing license evidence fails',()=>{const b=structuredClone(dependencyBaseline); b.packages.find(x=>x.name==='vitest').evidence=''; assert(validateProvenance({...base,dependencyBaseline:b}).errors.some(x=>x==='DEPENDENCY_LICENSE_EVIDENCE_MISSING:vitest'),'missing evidence accepted');}],
 ['missing source provenance fails',()=>{const r=structuredClone(register); r.source_files=r.source_files.filter(x=>x.path!==manifest.files[0].path); assert(validateProvenance({...base,register:r}).errors.some(x=>x.startsWith('MISSING_SOURCE_PROVENANCE:')),'missing source provenance accepted');}],
 ['copied third-party source requires external ref',()=>{const r=structuredClone(register); r.source_files[0].third_party_code_copied=true; r.source_files[0].external_source_ref=null; assert(validateProvenance({...base,register:r}).errors.some(x=>x.startsWith('THIRD_PARTY_SOURCE_REF_REQUIRED:')),'third-party source without ref accepted');}],
 ['premature dependency production admission fails',()=>{const r=structuredClone(register); r.direct_dependencies.find(x=>x.name==='hono').production_admitted=true; assert(validateProvenance({...base,register:r}).errors.some(x=>x==='PREMATURE_PRODUCTION_ADMISSION:hono'),'premature admission accepted');}],
 ['production admission state cannot be promoted before scans',()=>{const r=structuredClone(register); r.production_admission_state='ADMITTED'; assert(validateProvenance({...base,register:r}).errors.includes('PRODUCTION_ADMISSION_STATE_MUST_REMAIN_PENDING'),'premature state accepted');}],
 ['lockfile gate cannot be disabled',()=>{const r=structuredClone(register); r.production_admission_rules.lockfile_required=false; assert(validateProvenance({...base,register:r}).errors.includes('ADMISSION_RULE_REQUIRED:lockfile_required'),'lockfile gate disable accepted');}],
];
for (const [name,fn] of tests) { fn(); console.log(`PASS ${name}`); }
console.log(`PROVENANCE_PASS ${tests.length}/${tests.length}`);
