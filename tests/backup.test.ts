import { describe, expect, test } from 'bun:test';
import { createBackup, MAX_BACKUP_BYTES, parseBackup, type Book } from '../src/backup';

const book: Book = {
  id: 'book-1', title: 'The Book', tags: ['history'], priority: 'high',
  workspace: 'reading', totalPages: 300, currentPage: 120,
  status: 'reading', addedAt: '2026-10-19T00:00:00.000Z',
};

describe('Reading List backup', () => {
  test('round trips all record fields and annual goal', () => {
    const backup = parseBackup(createBackup([book], 24));
    expect(backup.app).toBe('yapture-reading-list');
    expect(backup.schemaVersion).toBe(1);
    expect(backup.books).toEqual([book]);
    expect(backup.goal).toBe(24);
  });

  test('rejects malformed, foreign and future formats without dropping rows', () => {
    const valid = JSON.parse(createBackup([book], 12));
    for (const changed of [
      { ...valid, app: 'other' },
      { ...valid, schemaVersion: 2 },
      { ...valid, books: [book, { ...book, currentPage: '120' }] },
      { ...valid, books: [book, book] },
      { ...valid, goal: 0 },
    ]) expect(() => parseBackup(JSON.stringify(changed))).toThrow();
    expect(() => parseBackup('{')).toThrow();
  });

  test('rejects minified input that cannot be downloaded again within the backup cap', () => {
    const payload = JSON.parse(createBackup([book], 12));
    payload.books[0].title = '';
    const baseBytes = new TextEncoder().encode(JSON.stringify(payload)).length;
    payload.books[0].title = 'x'.repeat(MAX_BACKUP_BYTES - baseBytes - 1);
    const minified = JSON.stringify(payload);
    expect(new TextEncoder().encode(minified).length).toBe(MAX_BACKUP_BYTES - 1);
    expect(() => parseBackup(minified)).toThrow('1 MiB');
  });

  test('caps imported and exported backup bytes', () => {
    expect(() => parseBackup(' '.repeat(MAX_BACKUP_BYTES + 1))).toThrow('1 MiB');
    expect(() => createBackup([{ ...book, title: 'x'.repeat(MAX_BACKUP_BYTES) }], 12)).toThrow('1 MiB');
  });
});
