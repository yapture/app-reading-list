import type { Book } from './App';

const DATABASE = 'yapture.app-reading-list.board.v2';
const STORE = 'boards';
const KEY = 'main';
const LEGACY_BOOKS = 'yapture.app-reading-list.books.v1';
const LEGACY_GOAL = 'yapture.app-reading-list.goal.v1';

export interface BoardSnapshot {
  revision: number;
  books: Book[];
  goal: number;
}

function isBook(value: unknown): value is Book {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const b = value as Record<string, unknown>;
  return typeof b.id === 'string' && typeof b.title === 'string'
    && typeof b.addedAt === 'string' && Array.isArray(b.tags)
    && b.tags.every((tag: unknown) => typeof tag === 'string')
    && (b.priority === null || typeof b.priority === 'string')
    && (b.workspace === null || typeof b.workspace === 'string')
    && (b.totalPages === null || typeof b.totalPages === 'number' && Number.isFinite(b.totalPages) && b.totalPages >= 0)
    && (b.currentPage === null || typeof b.currentPage === 'number' && Number.isFinite(b.currentPage) && b.currentPage >= 0)
    && (b.status === 'to-read' || b.status === 'reading' || b.status === 'finished');
}

function validBoard(value: unknown): value is BoardSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const b = value as Record<string, unknown>;
  return typeof b.revision === 'number' && Number.isSafeInteger(b.revision) && b.revision >= 0
    && Array.isArray(b.books) && b.books.every(isBook)
    && typeof b.goal === 'number' && Number.isInteger(b.goal) && b.goal >= 1 && b.goal <= 999;
}

/** Strict migration: malformed or inaccessible legacy data is never replaced. */
export function readLegacyBoard(storage: Pick<Storage, 'getItem'>): BoardSnapshot {
  const booksRaw = storage.getItem(LEGACY_BOOKS);
  const goalRaw = storage.getItem(LEGACY_GOAL);
  const books: unknown = booksRaw === null ? [] : JSON.parse(booksRaw);
  const goal = goalRaw === null ? 12 : Number(goalRaw);
  const board = { revision: 0, books, goal };
  if (!validBoard(board) || (goalRaw !== null && !/^\d+$/.test(goalRaw))) {
    throw new Error('Legacy Reading List data needs recovery before migration');
  }
  return board;
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE, 1);
    let blocked = false;
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE); };
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error('Could not open Reading List storage'));
    request.onblocked = () => {
      blocked = true;
      reject(new Error('Close older Reading List tabs and reload'));
    };
  });
}

function readRow(db: IDBDatabase): Promise<BoardSnapshot | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(KEY);
    let value: unknown;
    request.onsuccess = () => { value = request.result; };
    tx.oncomplete = () => {
      if (value !== undefined && !validBoard(value)) reject(new Error('Reading List database needs recovery'));
      else resolve(value as BoardSnapshot | undefined);
    };
    tx.onabort = () => reject(tx.error ?? new Error('Could not read Reading List storage'));
    tx.onerror = () => reject(tx.error ?? new Error('Could not read Reading List storage'));
  });
}

function initializeRow(db: IDBDatabase, legacy: BoardSnapshot): Promise<BoardSnapshot> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    let chosen: BoardSnapshot | undefined;
    const request = store.get(KEY);
    request.onsuccess = () => {
      const existing: unknown = request.result;
      if (existing !== undefined) {
        if (!validBoard(existing)) { tx.abort(); return; }
        chosen = existing;
      } else {
        chosen = legacy;
        store.put(legacy, KEY);
      }
    };
    tx.oncomplete = () => resolve(chosen!);
    tx.onabort = () => reject(tx.error ?? new Error('Could not migrate Reading List storage'));
    tx.onerror = () => reject(tx.error ?? new Error('Could not migrate Reading List storage'));
  });
}

export type CommitResult = { state: 'saved'; revision: number } | { state: 'conflict' };

export class BoardStore {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(factory: IDBFactory, storage: () => Pick<Storage, 'getItem'>): Promise<{ store: BoardStore; board: BoardSnapshot }> {
    const db = await openDatabase(factory);
    try {
      let board = await readRow(db);
      if (board === undefined) board = await initializeRow(db, readLegacyBoard(storage()));
      return { store: new BoardStore(db), board };
    } catch (error) {
      db.close();
      throw error;
    }
  }

  close(): void { this.db.close(); }

  /** One readwrite transaction serializes competing tabs before the compare. */
  commit(expectedRevision: number, books: Book[], goal: number): Promise<CommitResult> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0
      || !Array.isArray(books) || !books.every(isBook)
      || !Number.isInteger(goal) || goal < 1 || goal > 999) {
      return Promise.reject(new Error('Invalid Reading List change'));
    }
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const request = store.get(KEY);
      let result: CommitResult | undefined;
      request.onsuccess = () => {
        const current: unknown = request.result;
        if (!validBoard(current)) { tx.abort(); return; }
        if (current.revision !== expectedRevision) {
          result = { state: 'conflict' };
          return;
        }
        if (current.revision === Number.MAX_SAFE_INTEGER) { tx.abort(); return; }
        const revision = current.revision + 1;
        store.put({ revision, books, goal }, KEY);
        result = { state: 'saved', revision };
      };
      tx.oncomplete = () => resolve(result!);
      tx.onabort = () => reject(tx.error ?? new Error('Could not save Reading List storage'));
      tx.onerror = () => reject(tx.error ?? new Error('Could not save Reading List storage'));
    });
  }
}
