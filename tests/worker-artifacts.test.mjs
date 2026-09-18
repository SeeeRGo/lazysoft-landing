import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readdir, symlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { command, validateDemo, validateResult, completionMessage, generationPrompt, restoreSource, prepareRevisionWorkspace, assembleVersionBundle, ensureProjectReadme } from '../automation/worker.mjs';

const brief = { title: "Сайт мастерской", variants: [
  { id: "1", title: "Спокойный каталог" },
] };
describe('worker artifacts', () => {
  it('publishes through the bundled AWS CLI even when PATH lacks it (production failure of #2547a43f)', async () => {
    await expect(command('aws', ['--version'], { env: { ...process.env, PATH: '/usr/bin:/bin' } })).resolves.toContain('aws-cli/');
  });
  it('handles early stdin closure without crashing the worker', async () => {
    await expect(command(process.execPath, ['-e', 'process.exit(0)'], {input:'x'.repeat(1024*1024)})).resolves.toBe('');
  });
  it('reports missing executables without an unhandled stdin error', async () => {
    await expect(command('/nonexistent/lazysoft-test-command', [], {input:'test'})).rejects.toMatchObject({code:'ENOENT'});
  });
  it('captures output from commands that need no stdin', async () => {
    await expect(command(process.execPath, ['-e', 'process.stdout.write("ready")'])).resolves.toBe('ready');
  });
  it('packages a nested README but refuses a symlink instead of copying it', async () => {
    const project=await mkdtemp(join(tmpdir(),'readme-test-'));
    await mkdir(join(project,'versions','1'),{recursive:true});
    await writeFile(join(project,'versions','1','README.md'),'Launch index.html');
    await ensureProjectReadme(project,'1');
    expect(await readFile(join(project,'README.md'),'utf8')).toBe('Launch index.html');
    const unsafe=await mkdtemp(join(tmpdir(),'readme-unsafe-'));
    await mkdir(join(unsafe,'versions','1'),{recursive:true});
    await symlink(join(project,'README.md'),join(unsafe,'versions','1','README.md'));
    await expect(ensureProjectReadme(unsafe,'1')).rejects.toThrow('Unsafe source artifact');
  });
  it('exposes only the new version to the generator and preserves previous files when packaging', async () => {
    const root = await mkdtemp(join(tmpdir(), 'version-history-test-'));
    const previous = join(root, 'previous'), project = join(root, 'project'), bundle = join(root, 'bundle');
    const content = id => `<html><title>Версия ${id}</title><body>Original ${id}</body></html>`;
    for (const id of ['1', '2']) { await mkdir(join(previous, 'versions', id), {recursive:true}); await writeFile(join(previous,'versions',id,'index.html'),content(id)); }
    const job = {kind:'revision',targetDemoId:'3',baseDemoId:'2',demoOptions:[{id:'1'},{id:'2'}],idea:'Каталог работ',instructions:'Добавьте цены'};
    await prepareRevisionWorkspace(previous, project, job);
    expect(await readdir(join(project,'versions'))).toEqual(['3']);
    expect(await readFile(join(project,'versions','3','index.html'),'utf8')).toBe(content('2'));
    await writeFile(join(project,'versions','3','index.html'),content('3'));
    await writeFile(join(project,'README.md'),'How to launch');
    await assembleVersionBundle(previous,project,bundle,job);
    for(const id of ['1','2','3'])expect(await readFile(join(bundle,'versions',id,'index.html'),'utf8')).toBe(content(id));
    expect(await readFile(join(previous,'versions','2','index.html'),'utf8')).toBe(content('2'));
    const prompt=generationPrompt(job);expect(prompt).toContain('versions/3');expect(prompt).toContain('copy of version 2');expect(prompt).not.toContain('three distinct');
  });
  it('rejects traversal and symlinks in restored archives before extraction', async () => {
    const root=await mkdtemp(join(tmpdir(),'restore-source-test-'));
    for(const kind of ['traversal','symlink']){
      const archive=join(root,kind+'.zip');
      execFileSync('python3',['-c',`import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],'w') as z:\n i=zipfile.ZipInfo('../outside' if sys.argv[2]=='traversal' else 'versions/1/link')\n i.external_attr=(0o120777 if sys.argv[2]=='symlink' else 0o100644)<<16\n z.writestr(i,'unsafe')`,archive,kind]);
      await expect(restoreSource(archive,join(root,'output'))).rejects.toThrow();
    }
    await expect(readFile(join(root,'outside'))).rejects.toThrow();
  });
  it('describes regenerated artifacts without forwarding stale generator delivery claims', () => {
    const message = completionMessage({ ...brief, clientMessage: 'PDF устарел, откройте /workspace/demo/index.html' }, 'revision');
    expect(message).toContain('Предыдущие версии сохранены');
    expect(message).not.toMatch(/PDF|ТЗ/);
    expect(message).not.toContain('устарел');
    expect(message).not.toContain('/workspace');
  });
  it('requires exactly the requested new version, without a specification', () => {
    validateResult(brief, "1");
    expect(() => validateResult(brief, "2")).toThrow("Unexpected version ID");
    expect(() => validateResult({ title: '' })).toThrow();
    expect(() => validateResult({ title: brief.title, variants: [] })).toThrow();
    expect(() => validateResult({ ...brief, variants: [...brief.variants, ...brief.variants] })).toThrow();
  });
  it('does not generate, upload or package specification files', async () => {
    const source = await readFile(new URL('../automation/worker.mjs', import.meta.url), 'utf8');
    expect(source).not.toMatch(/pdfmake|pdfStorageId|specification\\.(pdf|json|txt)/);
    expect(source).toContain('"versions", "README.md"');
    expect(source).toContain('buildPackages(join(versions, id), packages)');
    expect(source).toContain('sourceVariants');
  });
  it('rejects symlinks before reading or publishing a demo', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lazysoft-demo-test-'));
    const demo = join(directory, 'demo');
    await mkdir(demo);
    await writeFile(join(demo, 'index.html'), '<html><head><title>Демо</title></head><body>Запись</body></html>');
    await validateDemo(demo);
    await writeFile(join(demo, 'TECHNICAL_SPEC.md'), '# Демонстрационная документация');
    await validateDemo(demo);
    await writeFile(join(directory, 'outside.js'), 'private');
    await symlink(join(directory, 'outside.js'), join(demo, 'escape.js'));
    await expect(validateDemo(demo)).rejects.toThrow('Unsafe demo file');
    await symlink(demo, join(directory, 'linked-demo'));
    await expect(validateDemo(join(directory, 'linked-demo'))).rejects.toThrow('Unsafe demo directory');
  });
});
