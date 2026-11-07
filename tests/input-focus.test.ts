import { expect, test } from 'bun:test';
import { bookToScript, focusBookControl, parseReadingScript, parseWholeNumberInput, type BookFocusTarget } from '../src/App';

function fixture(attribute: BookFocusTarget['attribute'], id: string) {
  const focused: string[] = [];
  const node = (name: string, attrs: Record<string, string> = {}) => ({ getAttribute: (key: string) => attrs[key] ?? null, focus: () => focused.push(name) });
  const controls = [node('prefix', { [attribute]: `${id}-other` }), node('unrelated', { 'data-unrelated-id': id }), node('exact', { [attribute]: id })];
  const root = {
    querySelectorAll(selector: string) {
      expect(selector).toBe(`[${attribute}]`);
      return controls.filter(n => n.getAttribute(attribute) !== null);
    },
    getElementById: (key: string) => key === 'book-input' ? node('composer') : null,
  } as unknown as Pick<Document, 'querySelectorAll' | 'getElementById'>;
  return { focused, root };
}

test('all row controls focus opaque IDs exactly without building CSS values', () => {
  for (const attribute of ['data-status-id', 'data-remove-id', 'data-progress-id'] as const) {
    for (const id of ['ordinary', 'quote"id', 'slash\\id', 'line\nbreak', 'bracket]id', '', 'null\0id']) {
      const { focused, root } = fixture(attribute, id);
      focusBookControl({ id, attribute, fallbacks: ['book-input'] }, root);
      expect(focused).toEqual(['exact']);
    }
  }
});

test('absent neighbours use the first fallback and unmounted controls do nothing', () => {
  for (const id of [null, 'removed']) {
    const { focused, root } = fixture('data-remove-id', 'survivor');
    focusBookControl({ id, attribute: 'data-remove-id', fallbacks: ['missing', 'book-input'] }, root);
    expect(focused).toEqual(['composer']);
  }
  const { focused, root } = fixture('data-progress-id', 'survivor');
  focusBookControl({ id: 'removed', attribute: 'data-progress-id', fallbacks: ['missing'] }, root);
  expect(focused).toEqual([]);
});

test('numeric controls parse the entire finite value before clamping', () => {
  for (const [value, expected] of [['1e2', 100], ['2E2', 200], ['1e+2', 100], ['1e-2', 0], ['1.5e2', 150], ['-1e2', -100], ['12.9', 12], ['-12.9', -12], ['', 0]] as const) {
    expect(parseWholeNumberInput(value)).toBe(expected);
  }
  for (const value of ['NaN', 'Infinity', '-Infinity', '1e309', '12x']) expect(parseWholeNumberInput(value)).toBe(0);
});

test('page metadata rejects incomplete, negative and non-finite numbers', () => {
  for (const field of ['pages', 'current']) {
    for (const value of ['', '4junk', '-2', '1e999', 'Infinity', 'NaN', '2:3', '9'.repeat(400)]) {
      expect(parseReadingScript(`Book #*{${field}:${value}}`)).toBeNull();
    }
  }
  expect(parseReadingScript('Book #*{notpages:12,notcurrent:3}')?.totalPages).toBeNull();
  expect(parseReadingScript('Book #*{notpages:12,notcurrent:3}')?.currentPage).toBeNull();
});

test('ordinary page metadata and tags retain their meaning', () => {
  expect(parseReadingScript('Book #history #@technical #!high #*{pages:352,current:42}')).toEqual({
    title: 'Book', tags: ['history'], workspace: 'technical', priority: 'high', totalPages: 352, currentPage: 42,
  });
});

test('copy round-trips independently present, zero, decimal and exponent page values', () => {
  for (const [totalPages, currentPage] of [[null, 42], [0, null], [10, 0], [null, 0], [null, null], [1e21, 1e-7], [1.5, Number.MAX_VALUE]] as const) {
    const book = { id: 'fixture', title: 'Book', tags: [], priority: null, workspace: null, totalPages, currentPage, status: 'reading' as const, addedAt: '2026-10-21T00:00:00Z' };
    const parsed = parseReadingScript(bookToScript(book));
    expect(parsed?.totalPages).toBe(totalPages);
    expect(parsed?.currentPage).toBe(currentPage);
  }
});
