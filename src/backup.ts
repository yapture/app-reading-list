export interface Book {
  id: string;
  title: string;
  tags: string[];
  priority: string | null;
  workspace: string | null;
  totalPages: number | null;
  currentPage: number | null;
  status: 'to-read' | 'reading' | 'finished';
  addedAt: string;
}

export const MAX_BACKUP_BYTES = 1024 * 1024;

export function isBook(value: unknown): value is Book {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const book = value as Record<string, unknown>;
  const nullableString = (field: string) => book[field] === null || typeof book[field] === 'string';
  const nullablePage = (field: string) => book[field] === null
    || (typeof book[field] === 'number' && Number.isFinite(book[field]) && (book[field] as number) >= 0);
  return typeof book.id === 'string'
    && typeof book.title === 'string'
    && typeof book.addedAt === 'string'
    && Array.isArray(book.tags) && book.tags.every((tag: unknown) => typeof tag === 'string')
    && nullableString('priority') && nullableString('workspace')
    && nullablePage('totalPages') && nullablePage('currentPage')
    && (book.status === 'to-read' || book.status === 'reading' || book.status === 'finished');
}

export interface ReadingListBackup {
  app: 'yapture-reading-list';
  schemaVersion: 1;
  exportedAt: string;
  books: Book[];
  goal: number;
}

export function createBackup(books: Book[], goal: number): string {
  const backup: ReadingListBackup = {
    app: 'yapture-reading-list', schemaVersion: 1,
    exportedAt: new Date().toISOString(), books, goal,
  };
  const serialized = JSON.stringify(backup, null, 2);
  if (new TextEncoder().encode(serialized).length > MAX_BACKUP_BYTES) throw new Error('Backup exceeds 1 MiB');
  return serialized;
}

export function parseBackup(text: string): ReadingListBackup {
  if (new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) throw new Error('Backup exceeds 1 MiB');
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new Error('Backup is not valid JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid backup');
  const backup = value as Record<string, unknown>;
  if (backup.app !== 'yapture-reading-list' || backup.schemaVersion !== 1
    || typeof backup.exportedAt !== 'string' || Number.isNaN(Date.parse(backup.exportedAt))
    || typeof backup.goal !== 'number' || !Number.isInteger(backup.goal) || backup.goal < 1 || backup.goal > 999
    || !Array.isArray(backup.books) || !backup.books.every(isBook)) {
    throw new Error('Invalid or unsupported Reading List backup');
  }
  const ids = new Set((backup.books as Book[]).map((book) => book.id));
  if (ids.size !== backup.books.length) throw new Error('Backup contains duplicate book IDs');
  createBackup(backup.books as Book[], backup.goal as number);
  return backup as unknown as ReadingListBackup;
}
