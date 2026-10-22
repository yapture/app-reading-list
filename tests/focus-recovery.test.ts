import { describe, expect, test } from 'bun:test';
import { focusBookControl, type BookFocusTarget } from '../src/App';
import { createBackup, parseBackup, type Book } from '../src/backup';

const attributes = ['data-status-id', 'data-remove-id', 'data-progress-id'] as const;
const ids = ['ordinary', 'quote"id', 'slash\\id', 'line\nbreak', 'bracket]id', '', 'null\0id'];
const book: Book = {
  id: '', title: 'Restored book', tags: [], priority: null, workspace: null,
  totalPages: 300, currentPage: 120, status: 'reading', addedAt: '2026-10-21T00:00:00Z',
};

// DOM port for static attribute selectors and the old quoted-value selector.
// Reject CSS syntax this fixture cannot represent, so malformed imported IDs
// fail at selector lookup just as they do in the browser.
function fixture(attribute: BookFocusTarget['attribute'], id: string) {
  const focused: string[] = [];
  const attempted: string[] = [];
  const node = (name: string, attrs: Record<string, string> = {}) => ({
    disabled: false,
    getAttribute: (key: string) => attrs[key] ?? null,
    matches(selector: string) { expect(selector).toBe(':disabled'); return this.disabled; },
    focus() { attempted.push(name); if (!this.disabled) focused.push(name); },
  });
  const controls = [
    node('prefix', { [attribute]: `${id}-other` }),
    node('other-control', { 'data-unrelated-id': id }),
    node('exact', { [attribute]: id }),
  ];
  const fallbacks = new Map([['book-input', node('composer')], ['later', node('later')]]);
  const root = {
    querySelectorAll(selector: string) {
      const parsed = /^\[(data-(?:status|remove|progress)-id)(?:="([^"\\\n\r\f\0]*)")?\]$/.exec(selector);
      if (!parsed) throw new DOMException('Invalid attribute selector', 'SyntaxError');
      return controls.filter(n => n.getAttribute(parsed[1]) !== null
        && (parsed[2] === undefined || n.getAttribute(parsed[1]) === parsed[2]));
    },
    getElementById: (key: string) => fallbacks.get(key) ?? null,
  } as unknown as Pick<Document, 'querySelectorAll' | 'getElementById'>;
  return { focused, attempted, root, controls, fallbacks };
}

describe('focus after actions on restored Reading List books', () => {
  for (const attribute of attributes) {
    for (const id of ids) {
      test(`${attribute} matches accepted backup ID ${JSON.stringify(id)} exactly`, () => {
        const restored = parseBackup(createBackup([{ ...book, id }], 12)).books[0];
        expect(restored.id).toBe(id);
        const { focused, root } = fixture(attribute, restored.id);
        focusBookControl({ id: restored.id, attribute, fallbacks: ['book-input'] }, root);
        expect(focused).toEqual(['exact']);
      });
    }
    test(`${attribute} uses the first surviving fallback when target is absent`, () => {
      const { focused, root } = fixture(attribute, 'survivor');
      focusBookControl({ id: 'removed', attribute, fallbacks: ['missing', 'book-input', 'later'] }, root);
      expect(focused).toEqual(['composer']);
    });
  }
  test('no surviving neighbour focuses the composer', () => {
    const { focused, root } = fixture('data-remove-id', 'survivor');
    focusBookControl({ id: null, attribute: 'data-remove-id', fallbacks: ['book-input'] }, root);
    expect(focused).toEqual(['composer']);
  });
  test('missing controls and fallbacks are a no-op', () => {
    const { focused, root } = fixture('data-progress-id', 'survivor');
    focusBookControl({ id: 'missing', attribute: 'data-progress-id', fallbacks: ['missing'] }, root);
    expect(focused).toEqual([]);
  });
});


describe('Reading recovery focus skips disabled controls', () => {
  for (const attribute of attributes) test(attribute + ' uses the composer when the matching row is disabled', () => {
    const { focused, attempted, root, controls } = fixture(attribute, 'book');
    controls[2].disabled = true;
    focusBookControl({ id: 'book', attribute, fallbacks: ['book-input'] }, root);
    expect(focused).toEqual(['composer']); expect(attempted).toEqual(['composer']);
  });
  test('a disabled first fallback does not hide a usable later fallback', () => {
    const { focused, attempted, root, fallbacks } = fixture('data-remove-id', 'survivor');
    fallbacks.get('book-input')!.disabled = true;
    focusBookControl({ id: 'removed', attribute: 'data-remove-id', fallbacks: ['book-input', 'later'] }, root);
    expect(focused).toEqual(['later']); expect(attempted).toEqual(['later']);
  });
  test('accepted empty IDs retain the same disabled-control fallback', () => {
    const { focused, attempted, root, controls } = fixture('data-progress-id', '');
    controls[2].disabled = true;
    focusBookControl({ id: '', attribute: 'data-progress-id', fallbacks: ['book-input'] }, root);
    expect(focused).toEqual(['composer']); expect(attempted).toEqual(['composer']);
  });
  test('no usable target or fallback is a no-op without attempting disabled focus', () => {
    const { focused, attempted, root, controls, fallbacks } = fixture('data-status-id', 'book');
    controls[2].disabled = true; fallbacks.get('book-input')!.disabled = true;
    focusBookControl({ id: 'book', attribute: 'data-status-id', fallbacks: ['missing', 'book-input'] }, root);
    expect(focused).toEqual([]); expect(attempted).toEqual([]);
  });
});
