import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pdf, validateDemo, validateResult } from '../automation/worker.mjs';

const brief = {
  title: 'Сайт мастерской', summary: 'Запись на ремонт велосипеда', clientMessage: 'ТЗ и демо готовы.',
  assumptions: ['Данные демонстрационные'], acceptanceCriteria: ['Форма позволяет выбрать дату'], externalCosts: ['Хостинг'],
  options: [
    { title: 'Первая версия', features: ['Форма записи'], limitations: ['Без интеграции'], days: 3, priceRubles: 10000 },
    { title: 'Расширение', features: ['Личный кабинет'], limitations: ['Требуется согласование'], days: 7, priceRubles: 25000 },
  ],
};
describe('worker artifacts', () => {
  it('validates the brief and creates an actual PDF with Russian text', async () => {
    validateResult(brief);
    const directory = await mkdtemp(join(tmpdir(), 'lazysoft-pdf-test-'));
    const path = join(directory, 'brief.pdf');
    await pdf(brief, path);
    const bytes = await readFile(path);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(() => validateResult({ ...brief, options: [] })).toThrow();
  });
  it('rejects symlinks before reading or publishing a demo', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lazysoft-demo-test-'));
    const demo = join(directory, 'demo');
    await mkdir(demo);
    await writeFile(join(demo, 'index.html'), '<html><head><title>Демо</title></head><body>Запись</body></html>');
    await validateDemo(demo);
    await writeFile(join(directory, 'outside.js'), 'private');
    await symlink(join(directory, 'outside.js'), join(demo, 'escape.js'));
    await expect(validateDemo(demo)).rejects.toThrow('Unsafe demo file');
    await symlink(demo, join(directory, 'linked-demo'));
    await expect(validateDemo(join(directory, 'linked-demo'))).rejects.toThrow('Unsafe demo directory');
  });
});
