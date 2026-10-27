import { expect, test } from 'bun:test';
import { bookToScript, parseReadingScript } from '../src/App';
import { createBackup, isBook, parseBackup, type Book } from '../src/backup';

for (const field of ['pages', 'current']) {
  for (const digits of [400, 1000]) {
    test(`overflowing ${field} with ${digits} digits is an input error`, () => {
      expect(parseReadingScript(`Book #*{${field}:${'9'.repeat(digits)}}`)).toBeNull();
    });
  }
}
test('both page counts overflowing are an input error', () => {
  const value = '9'.repeat(400);
  expect(parseReadingScript(`Book #*{pages:${value},current:${value}}`)).toBeNull();
});

for (const text of [
  'The Book',
  'New book #*{pages:0,current:0}',
  'Started book #*{pages:10,current:3}',
  'Current only #*{current:0}',
  'Large finite count #*{pages:9007199254740991}',
  'Designing Data-Intensive Applications #@technical #!high #*{pages:613,current:142}',
  'Project Hail Mary #@fiction #*{pages:476,current:476}',
  'The Pragmatic Programmer #@technical #*{pages:352}',
]) {
  test(`ordinary script remains storable and restorable: ${text}`, () => {
    const draft = parseReadingScript(text);
    expect(draft).not.toBeNull();
    const book: Book = {
      id: 'fixture', title: '', tags: [], priority: null, workspace: null,
      totalPages: null, currentPage: null, status: 'to-read', addedAt: '2026-10-21T00:00:00Z',
      ...draft,
    };
    expect(isBook(book)).toBe(true);
    expect(parseBackup(createBackup([book], 12)).books).toEqual([book]);
  });
}

test('page values and existing tags retain their meaning', () => {
  expect(parseReadingScript('Book #history #@technical #!high #*{pages:352,current:42}')).toEqual({
    title: 'Book', tags: ['history'], workspace: 'technical', priority: 'high',
    totalPages: 352, currentPage: 42,
  });
});

test('copied scripts preserve independently present and zero page counts', () => {
  for (const [totalPages, currentPage] of [[null, 42], [0, null], [10, 0], [null, 0], [null, null]] as const) {
    const book: Book = { id: 'fixture', title: 'Book', tags: [], priority: null, workspace: null,
      totalPages, currentPage, status: 'reading', addedAt: '2026-10-21T00:00:00Z' };
    const parsed = parseReadingScript(bookToScript(book));
    expect(parsed?.totalPages).toBe(totalPages);
    expect(parsed?.currentPage).toBe(currentPage);
  }
});

test('copied scripts preserve accepted finite decimal and exponent page values', () => {
  for (const value of [1e21, 1e100, 1e-7, 1.5, Number.MAX_VALUE]) {
    const book: Book = { id: 'fixture', title: 'Book', tags: [], priority: null, workspace: null,
      totalPages: value, currentPage: value, status: 'reading', addedAt: '2026-10-21T00:00:00Z' };
    expect(isBook(book)).toBe(true);
    const parsed = parseReadingScript(bookToScript(book));
    expect(parsed?.totalPages).toBe(value);
    expect(parsed?.currentPage).toBe(value);
  }
});

test('script page fields reject incomplete or invalid numbers and match complete field names', () => {
  for (const field of ['pages', 'current']) {
    for (const value of ['', '4junk', '-2', '1e999', 'Infinity', 'NaN', '2:3']) {
      expect(parseReadingScript(`Book #*{${field}:${value}}`)).toBeNull();
    }
  }
  expect(parseReadingScript('Book #*{notpages:12,notcurrent:3}')?.totalPages).toBeNull();
  expect(parseReadingScript('Book #*{notpages:12,notcurrent:3}')?.currentPage).toBeNull();
});
