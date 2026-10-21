import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Source-level WCAG 2.2 AA regression checks for the single-screen SPA (src/App.tsx).
const ROOT = resolve(import.meta.dir, '..');
const src = readFileSync(join(ROOT, 'src/App.tsx'), 'utf8');

describe('a11y (source-level)', () => {
  test('no outline:none without a :focus-visible replacement rule', () => {
    expect(src).toMatch(/input:focus-visible,\s*select:focus-visible,\s*textarea:focus-visible\s*\{\s*outline:\s*2px solid var\(--yap-ring\)/);
    expect(/outline:\s*['"]none['"]/.test(src)).toBe(false);
  });

  test('every x remove button has an aria-label and an aria-hidden glyph', () => {
    const buttons = [...src.matchAll(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*?<\/button>/g)]
      .map(m => m[0]).filter(b => /&times;/.test(b));
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) {
      expect(/aria-label=\{`Remove /.test(b)).toBe(true);
      expect(b.includes('<span aria-hidden="true">&times;</span>')).toBe(true);
    }
  });

  test('main input has a programmatic label', () => {
    expect(src.includes('<label htmlFor="book-input" className="sr-only">Add a book</label>')).toBe(true);
    expect(src.includes('<input id="book-input"')).toBe(true);
  });

  test('always-mounted polite status region exists', () => {
    expect(/<p role="status" aria-live="polite"[^>]*className="sr-only"/.test(src)).toBe(true);
    expect(src.includes('.sr-only')).toBe(true);
  });

  test('footer links are underlined; the faint token is not used for text', () => {
    expect(new RegExp("footerLink: \\{[^}]*textDecoration: 'underline'").test(src)).toBe(true);
    expect(/(?<![a-zA-Z])color: 'var\(--yap-fg-faint\)'/.test(src)).toBe(false);
  });

  test('goal Target label is tied to its input', () => {
    expect(src.includes('<label htmlFor="goal-input"')).toBe(true);
    expect(src.includes('<input id="goal-input"')).toBe(true);
  });

  test('page-edit input is named per book', () => {
    expect(src.includes('aria-label={`Current page of ${book.title}`}')).toBe(true);
  });

  test('progress control is a real <button> (not a clickable div)', () => {
    expect(/<button type="button" disabled=\{conflict \|\| saving\} onClick=\{\(\) => \{ setEditingId[\s\S]*?aria-label=\{`\$\{book\.currentPage \?\? 0\} \/ \$\{book\.totalPages\} pages, update pages read`\}/.test(src)).toBe(true);
    expect(/<div[^>]*onClick/.test(src)).toBe(false);
  });

  test('filter buttons expose aria-pressed; status chip has a descriptive name', () => {
    expect(src.includes('aria-pressed={filter === f}')).toBe(true);
    expect(src.includes("aria-label={`Status: ${book.status.replace('-', ' ')}. Change status`}")).toBe(true);
  });

  test('book titles are h2 (no skipped heading level)', () => {
    expect(src.includes('<h3')).toBe(false);
    expect(src.includes('<h2 style={{ ...S.cardTitle')).toBe(true);
  });
  test("a blur never pulls focus back (only Enter/submit restores focus)", () => {
    expect(/onBlur=\{\(\) => \{ void updatePages\(book\.id, parseWholeNumberInput\(editPage\)\); \}\}/.test(src)).toBe(true);
    expect(/updatePages\(book\.id, parseWholeNumberInput\(editPage\), true\)/.test(src)).toBe(true);
    expect(/if \(restoreFocus\) \{\n\s+pendingFocus\.current/.test(src)).toBe(true);
  });
});
