import { createBackup, isBook, type Book } from './backup';

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

interface LegacyBaseline { books: string | null; goal: string | null }
type StoredBoard = BoardSnapshot & { legacyBaseline: LegacyBaseline };

function validStoredBoard(value: unknown): value is StoredBoard {
  if (!validBoard(value)) return false;
  const baseline = (value as unknown as Record<string, unknown>).legacyBaseline;
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) return false;
  const record = baseline as Record<string, unknown>;
  return (record.books === null || typeof record.books === 'string')
    && (record.goal === null || typeof record.goal === 'string');
}

function snapshot(value: StoredBoard): BoardSnapshot {
  return { revision: value.revision, books: value.books, goal: value.goal };
}

function readLegacyBaseline(storage: Pick<Storage, 'getItem'>): LegacyBaseline {
  return { books: storage.getItem(LEGACY_BOOKS), goal: storage.getItem(LEGACY_GOAL) };
}

function validBoard(value: unknown): value is BoardSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const b = value as Record<string, unknown>;
  return typeof b.revision === 'number' && Number.isSafeInteger(b.revision) && b.revision >= 0
    && Array.isArray(b.books) && b.books.every(isBook)
    && new Set((b.books as Book[]).map((book) => book.id)).size === b.books.length
    && typeof b.goal === 'number' && Number.isInteger(b.goal) && b.goal >= 1 && b.goal <= 999;
}

/** Strict migration: malformed or inaccessible legacy data is never replaced. */
export function readLegacyBoard(storage: Pick<Storage, 'getItem'>): BoardSnapshot {
  return snapshot(readLegacyRecord(storage));
}

function readLegacyRecord(storage: Pick<Storage, 'getItem'>): StoredBoard {
  return parseLegacyBaseline(readLegacyBaseline(storage));
}

function parseLegacyBaseline(legacyBaseline: LegacyBaseline): StoredBoard {
  const booksRaw = legacyBaseline.books;
  const goalRaw = legacyBaseline.goal;
  const books: unknown = booksRaw === null ? [] : JSON.parse(booksRaw);
  const goal = goalRaw === null ? 12 : Number(goalRaw);
  const board = { revision: 0, books, goal, legacyBaseline };
  if (!validBoard(board) || (goalRaw !== null && !/^\d+$/.test(goalRaw))) {
    throw new Error('Legacy Reading List data needs recovery before migration');
  }
  try { createBackup(board.books, board.goal); }
  catch { throw new Error('Legacy Reading List data exceeds the restorable backup size'); }
  return board;
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE, 1);
    let blocked = false;
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE); };
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else {
        const db = request.result;
        db.onversionchange = () => { db.close(); };
        resolve(db);
      }
    };
    request.onerror = () => reject(request.error ?? new Error('Could not open Reading List storage'));
    request.onblocked = () => {
      blocked = true;
      reject(new Error('Close older Reading List tabs and reload'));
    };
  });
}

function readRow(db: IDBDatabase): Promise<StoredBoard | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(KEY);
    let value: unknown;
    request.onsuccess = () => { value = request.result; };
    tx.oncomplete = () => {
      if (value !== undefined && !validStoredBoard(value)) reject(new Error('Reading List database needs recovery'));
      else resolve(value as StoredBoard | undefined);
    };
    tx.onabort = () => reject(tx.error ?? new Error('Could not read Reading List storage'));
    tx.onerror = () => reject(tx.error ?? new Error('Could not read Reading List storage'));
  });
}

function initializeRow(db: IDBDatabase, legacy: StoredBoard): Promise<StoredBoard> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    let chosen: StoredBoard | undefined;
    const request = store.get(KEY);
    request.onsuccess = () => {
      const existing: unknown = request.result;
      if (existing !== undefined) {
        if (!validStoredBoard(existing)) { tx.abort(); return; }
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
  private constructor(private readonly db: IDBDatabase, private readonly storage: () => Pick<Storage, 'getItem'>) {}

  static async open(factory: IDBFactory, storage: () => Pick<Storage, 'getItem'>): Promise<{ store: BoardStore; board: BoardSnapshot; legacyChanged: boolean }> {
    const db = await openDatabase(factory);
    try {
      let board = await readRow(db);
      if (board === undefined) board = await initializeRow(db, parseLegacyBaseline(readLegacyBaseline(storage())));
      let legacyChanged = false;
      try {
        const latest = readLegacyBaseline(storage());
        legacyChanged = board.legacyBaseline.books !== latest.books || board.legacyBaseline.goal !== latest.goal;
      } catch { legacyChanged = true; }
      return { store: new BoardStore(db, storage), board: snapshot(board), legacyChanged };
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
      || new Set(books.map((book) => book.id)).size !== books.length
      || !Number.isInteger(goal) || goal < 1 || goal > 999) {
      return Promise.reject(new Error('Invalid Reading List change'));
    }
    try { createBackup(books, goal); }
    catch { return Promise.reject(new Error('Change exceeds the restorable backup size')); }
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const request = store.get(KEY);
      let result: CommitResult | undefined;
      request.onsuccess = () => {
        const current: unknown = request.result;
        if (!validStoredBoard(current)) { tx.abort(); return; }
        if (current.revision !== expectedRevision) {
          result = { state: 'conflict' };
          return;
        }
        let legacyChanged = false;
        try {
          const latest = readLegacyBaseline(this.storage());
          legacyChanged = current.legacyBaseline.books !== latest.books || current.legacyBaseline.goal !== latest.goal;
        } catch { legacyChanged = true; }
        if (legacyChanged) { result = { state: 'conflict' }; return; }
        if (current.revision === Number.MAX_SAFE_INTEGER) { tx.abort(); return; }
        const revision = current.revision + 1;
        store.put({ revision, books, goal, legacyBaseline: current.legacyBaseline }, KEY);
        result = { state: 'saved', revision };
      };
      tx.oncomplete = () => resolve(result!);
      tx.onabort = () => reject(tx.error ?? new Error('Could not save Reading List storage'));
      tx.onerror = () => reject(tx.error ?? new Error('Could not save Reading List storage'));
    });
  }
}
