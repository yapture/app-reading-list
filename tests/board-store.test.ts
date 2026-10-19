import { describe, expect, test } from 'bun:test';
import { BoardStore, readLegacyBoard } from '../src/board-store';

const BOOKS = 'yapture.app-reading-list.books.v1';
const GOAL = 'yapture.app-reading-list.goal.v1';
const book = {
  id: 'book-1', title: 'One', tags: ['fiction'], priority: null,
  workspace: null, totalPages: 300, currentPage: 12,
  status: 'reading', addedAt: '2026-10-19T00:00:00.000Z',
};

function storage(values: Record<string, string | null>) {
  return { getItem(key: string) { return values[key] ?? null; } };
}

describe('legacy Reading List migration', () => {
  test('preserves every validated book field and the goal', () => {
    expect(readLegacyBoard(storage({ [BOOKS]: JSON.stringify([book]), [GOAL]: '24' })))
      .toEqual({ revision: 0, books: [book], goal: 24 });
  });

  test('an empty legacy collection gets a durable initial revision', () => {
    expect(readLegacyBoard(storage({}))).toEqual({ revision: 0, books: [], goal: 12 });
  });

  test('malformed or inaccessible legacy bytes stop migration', () => {
    for (const books of ['{', '{"books":[]}', '[{"title":"hidden"}]']) {
      expect(() => readLegacyBoard(storage({ [BOOKS]: books }))).toThrow();
    }
    expect(() => readLegacyBoard(storage({ [GOAL]: '12books' }))).toThrow();
    expect(() => readLegacyBoard({ getItem() { throw new DOMException('blocked', 'SecurityError'); } })).toThrow();
  });
});

/** Minimal serialized transaction model; browser acceptance remains a separate gate. */
function fakeIndexedDb() {
  let row: unknown;
  let writeTail: Promise<void> = Promise.resolve();
  const database = {
    createObjectStore() { return {}; },
    close() {},
    transaction(_name: string, mode: IDBTransactionMode) {
      let nextRow: unknown;
      let aborted = false;
      const tx = {
        oncomplete: null as null | (() => void),
        onabort: null as null | (() => void),
        onerror: null as null | (() => void),
        abort() { aborted = true; },
        objectStore() {
          return {
            get() {
              const request = { result: undefined as unknown, onsuccess: null as null | (() => void) };
              const run = async () => {
                let release: (() => void) | undefined;
                if (mode === 'readwrite') {
                  const prior = writeTail;
                  writeTail = new Promise<void>((resolve) => { release = resolve; });
                  await prior;
                }
                request.result = structuredClone(row);
                request.onsuccess?.();
                queueMicrotask(() => {
                  if (aborted) tx.onabort?.();
                  else {
                    if (nextRow !== undefined) row = structuredClone(nextRow);
                    tx.oncomplete?.();
                  }
                  release?.();
                });
              };
              queueMicrotask(() => { void run(); });
              return request;
            },
            put(value: unknown) { nextRow = value; },
          };
        },
      };
      return tx;
    },
  };
  return {
    open() {
      const request = { result: database, onupgradeneeded: null as null | (() => void), onsuccess: null as null | (() => void), onerror: null, onblocked: null };
      queueMicrotask(() => { request.onupgradeneeded?.(); request.onsuccess?.(); });
      return request;
    },
  } as unknown as IDBFactory;
}

test('two tabs cannot both commit from the same revision', async () => {
  const factory = fakeIndexedDb();
  const legacy = () => storage({ [BOOKS]: JSON.stringify([book]), [GOAL]: '12' });
  const [left, right] = await Promise.all([BoardStore.open(factory, legacy), BoardStore.open(factory, legacy)]);
  expect(left.board).toEqual(right.board);
  const changed = { ...book, currentPage: 20 };
  const outcomes = await Promise.all([
    left.store.commit(left.board.revision, [changed], 12),
    right.store.commit(right.board.revision, [book], 24),
  ]);
  expect(outcomes.filter((outcome) => outcome.state === 'saved')).toHaveLength(1);
  expect(outcomes.filter((outcome) => outcome.state === 'conflict')).toHaveLength(1);
  const latest = await BoardStore.open(factory, legacy);
  expect(latest.board.revision).toBe(1);
  left.store.close(); right.store.close(); latest.store.close();
});

test('a stale empty tab cannot restore a backup over a newly saved book', async () => {
  const factory = fakeIndexedDb();
  const legacy = () => storage({});
  const [restoreTab, writerTab] = await Promise.all([
    BoardStore.open(factory, legacy), BoardStore.open(factory, legacy),
  ]);
  expect(restoreTab.board).toEqual({ revision: 0, books: [], goal: 12 });
  expect(await writerTab.store.commit(writerTab.board.revision, [book], 12))
    .toEqual({ state: 'saved', revision: 1 });
  expect(await restoreTab.store.commit(restoreTab.board.revision, [], 24))
    .toEqual({ state: 'conflict' });
  const latest = await BoardStore.open(factory, legacy);
  expect(latest.board).toEqual({ revision: 1, books: [book], goal: 12 });
  restoreTab.store.close(); writerTab.store.close(); latest.store.close();
});
