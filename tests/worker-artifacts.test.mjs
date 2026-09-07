import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateDemo, validateResult, completionMessage } from '../automation/worker.mjs';

const brief = { title: "Сайт мастерской" };
describe('worker artifacts', () => {
  it('describes regenerated artifacts without forwarding stale generator delivery claims', () => {
    const message = completionMessage({ ...brief, clientMessage: 'PDF устарел, откройте /workspace/demo/index.html' }, 'revision');
    expect(message).toContain('Демо обновлено');
    expect(message).not.toMatch(/PDF|ТЗ/);
    expect(message).not.toContain('устарел');
    expect(message).not.toContain('/workspace');
  });
  it('requires only a demo title, without a specification', () => {
    validateResult(brief);
    expect(() => validateResult({ title: '' })).toThrow();
    expect(() => validateResult({ ...brief, options: [] })).toThrow();
  });
  it('does not generate, upload or package specification files', async () => {
    const source = await readFile(new URL('../automation/worker.mjs', import.meta.url), 'utf8');
    expect(source).not.toMatch(/pdfmake|pdfStorageId|specification\\.(pdf|json|txt)/);
    expect(source).toContain('"demo", "README.md"');
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
