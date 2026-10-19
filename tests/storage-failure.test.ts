import { describe, expect, test } from 'bun:test';
import { copyText, loadBooks, loadGoal, saveBooks, saveGoal } from '../src/App';

async function withClipboard(clipboard: unknown, run: () => Promise<void>) {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard } });
  try { await run(); }
  finally {
    if (prior) Object.defineProperty(globalThis, 'navigator', prior);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
}

function withStoredBooks(raw: string, run: () => void) {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => raw },
  });
  try { run(); }
  finally {
    if (prior) Object.defineProperty(globalThis, 'localStorage', prior);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
}

describe('blocked browser storage', () => {
  test('goal load falls back and writes fail without throwing', () => {
    const prior = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem() { throw new DOMException('blocked', 'SecurityError'); },
        setItem() { throw new DOMException('blocked', 'QuotaExceededError'); },
      },
    });
    try {
      expect(loadGoal()).toBe(12);
      expect(saveGoal(20)).toBe(false);
      expect(saveBooks([])).toBe(false);
    } finally {
      if (prior) Object.defineProperty(globalThis, 'localStorage', prior);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });

  test('book load returns an empty list for valid JSON of the wrong shape', () => {
    withStoredBooks('{"books":[]}', () => expect(loadBooks()).toEqual([]));
  });

  test('malformed books are discarded while valid books remain', () => {
    const valid = {
      id: 'one', title: 'Book', tags: ['fiction'], priority: null,
      workspace: null, totalPages: 120, currentPage: 10,
      status: 'reading', addedAt: '2026-10-19T00:00:00.000Z',
    };
    const raw = JSON.stringify([null, { ...valid, tags: {} }, { ...valid, totalPages: '120' }, valid]);
    withStoredBooks(raw, () => expect(loadBooks()).toEqual([valid]));
  });

  test('malformed saved books are never overwritten', () => {
    const prior = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    let writes = 0;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: () => '{"books":[]}', setItem: () => { writes++; } },
    });
    try {
      expect(saveBooks([])).toBe(false);
      expect(writes).toBe(0);
    } finally {
      if (prior) Object.defineProperty(globalThis, 'localStorage', prior);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });
});

describe('annual goal storage', () => {
  test('loads only whole goals within the displayed input range', () => {
    const prior = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    let raw: string | null = null;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: () => raw },
    });
    try {
      for (const invalid of ['-1', '0', '1000', '12books', '12.5', '']) {
        raw = invalid;
        expect(loadGoal()).toBe(12);
      }
      raw = '999';
      expect(loadGoal()).toBe(999);
      raw = '1';
      expect(loadGoal()).toBe(1);
    } finally {
      if (prior) Object.defineProperty(globalThis, 'localStorage', prior);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });

  test('refuses out-of-range goal writes', () => {
    const prior = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    let writes = 0;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { setItem: () => { writes++; } },
    });
    try {
      expect(saveGoal(0)).toBe(false);
      expect(saveGoal(1000)).toBe(false);
      expect(saveGoal(1.5)).toBe(false);
      expect(writes).toBe(0);
      expect(saveGoal(999)).toBe(true);
      expect(writes).toBe(1);
    } finally {
      if (prior) Object.defineProperty(globalThis, 'localStorage', prior);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });
});

describe('clipboard export', () => {
  test('reports an unavailable clipboard', async () => {
    await withClipboard(undefined, async () => expect(await copyText('book')).toBe(false));
  });

  test('catches a rejected clipboard permission request', async () => {
    await withClipboard({ writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) },
      async () => expect(await copyText('book')).toBe(false));
  });

  test('reports success only after the text was written', async () => {
    let written = '';
    await withClipboard({ writeText: async (text: string) => { written = text; } },
      async () => expect(await copyText('book')).toBe(true));
    expect(written).toBe('book');
  });
});
