import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { BoardStore } from './board-store';
import { createBackup, isBook, MAX_BACKUP_BYTES, parseBackup, type Book } from './backup';

const STORAGE_KEY = 'yapture.app-reading-list.books.v1';
const GOAL_KEY = 'yapture.app-reading-list.goal.v1';

export function loadBooks(): Book[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isBook) : [];
  }
  catch { return []; }
}
export function saveBooks(books: Book[]): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const prior: unknown = JSON.parse(raw);
      if (!Array.isArray(prior) || !prior.every(isBook)) return false;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(books));
    return true;
  }
  catch { return false; }
}
export function loadGoal(): number {
  try {
    const raw = localStorage.getItem(GOAL_KEY);
    if (raw === null) return 12;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 999 ? parsed : 12;
  }
  catch { return 12; }
}
export function saveGoal(n: number): boolean {
  if (!Number.isInteger(n) || n < 1 || n > 999) return false;
  try { localStorage.setItem(GOAL_KEY, String(n)); return true; }
  catch { return false; }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch { return false; }
}

const PAGE_INPUT_ERROR = 'Use finite numbers of zero or more for pages and current.';

export function parseReadingScript(text: string): Partial<Book> | null {
  const tags: string[] = [];
  const workspaces: string[] = [];
  let priority: string | null = null;
  let totalPages: number | null = null;
  let currentPage: number | null = null;

  const tokenRegex = /#([!@+^~$?])?(\w[\w-]*)/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRegex.exec(text)) !== null) {
    const prefix = m[1];
    const value = m[2];
    if (prefix === '!') priority = value;
    else if (prefix === '@') workspaces.push(value);
    else tags.push(value);
  }

  const metaMatch = text.match(/#\*\{([^}]+)\}/);
  if (metaMatch) {
    const seen = new Set<string>();
    for (const entry of metaMatch[1].split(',')) {
      const [field, ...parts] = entry.split(':').map(value => value.trim());
      if ((field !== 'pages' && field !== 'current') || seen.has(field)) continue;
      seen.add(field);
      const raw = parts.join(':');
      const amount = Number(raw);
      if (!raw || !Number.isFinite(amount) || amount < 0) return null;
      if (field === 'pages') totalPages = amount;
      else currentPage = amount;
    }
  }

  const title = text.replace(/#[!@+^~$?]?\w[\w-]*/g, '').replace(/#\*\{[^}]*\}/g, '').replace(/\bdue:\S+/g, '').trim();
  return { title: title || text, tags, workspace: workspaces[0] ?? null, priority, totalPages, currentPage };
}

export function bookToScript(b: Book): string {
  let line = b.title;
  if (b.workspace) line += ` #@${b.workspace}`;
  if (b.priority) line += ` #!${b.priority}`;
  b.tags.forEach((t) => (line += ` #${t}`));
  if (b.totalPages !== null || b.currentPage !== null) {
    const parts: string[] = [];
    if (b.totalPages !== null) parts.push(`pages:${b.totalPages}`);
    if (b.currentPage !== null) parts.push(`current:${b.currentPage}`);
    line += ` #*{${parts.join(',')}}`;
  }
  return line;
}

function ProgressRing({ completed, target }: { completed: number; target: number }) {
  const r = 40, stroke = 6, size = (r + stroke) * 2;
  const circ = 2 * Math.PI * r;
  const pct = target > 0 ? Math.min(1, completed / target) : 0;
  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      <circle cx={r + stroke} cy={r + stroke} r={r} fill="none" stroke="var(--yap-border-subtle)" strokeWidth={stroke} />
      <circle cx={r + stroke} cy={r + stroke} r={r} fill="none" stroke="var(--yap-warning)" strokeWidth={stroke}
        strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)}
        transform={`rotate(-90 ${r + stroke} ${r + stroke})`} style={{ transition: 'stroke-dashoffset .5s' }} />
      <text x={r + stroke} y={r + stroke - 6} textAnchor="middle" fill="var(--yap-fg)" fontSize="18" fontWeight="700">
        {completed}/{target}
      </text>
      <text x={r + stroke} y={r + stroke + 12} textAnchor="middle" fill="var(--yap-fg-muted)" fontSize="11">
        finished
      </text>
    </svg>
  );
}

const EXAMPLES = [
  'Designing Data-Intensive Applications #@technical #!high #*{pages:613,current:142}',
  'Project Hail Mary #@fiction #*{pages:476,current:476}',
  'The Pragmatic Programmer #@technical #*{pages:352}',
];

type Filter = 'all' | 'to-read' | 'reading' | 'finished';

export function parseWholeNumberInput(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

type BookControlAttribute = 'data-status-id' | 'data-remove-id' | 'data-progress-id';
export interface BookFocusTarget {
  id: string | null;
  attribute: BookControlAttribute;
  fallbacks: string[];
}

export function focusBookControl(target: BookFocusTarget, root: Pick<Document, 'querySelectorAll' | 'getElementById'> = document): void {
  // Backup IDs are opaque strings, including characters with CSS syntax.
  const control = target.id !== null
    ? Array.from(root.querySelectorAll<HTMLElement>(`[${target.attribute}]`))
      .find((el) => el.getAttribute(target.attribute) === target.id)
    : undefined;
  const el = control || target.fallbacks.map((id) => root.getElementById(id)).find(Boolean);
  el?.focus();
}

export function App() {
  const [books, setBooks] = useState<Book[]>([]);
  const [input, setInput] = useState('');
  const [inputError, setInputError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPage, setEditPage] = useState('');
  const [goal, setGoal] = useState(12);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const storeRef = useRef<BoardStore | null>(null);
  const revisionRef = useRef<number | null>(null);
  const boardRef = useRef<{ books: Book[]; goal: number }>({ books: [], goal: 12 });
  const savingRef = useRef(false);
  const conflictRef = useRef(false);
  const legacyWriteRef = useRef(false);
  const [storageWarning, setStorageWarning] = useState(false);
  const [recoveryFeedback, setRecoveryFeedback] = useState('');
  const [backupFeedback, setBackupFeedback] = useState('');
  const backupInput = useRef<HTMLInputElement>(null);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [status, setStatus] = useState('');
  const flip = useRef(false);
  const pendingFocus = useRef<BookFocusTarget | null>(null);

  useEffect(() => {
    let cancelled = false;
    let opened: BoardStore | null = null;
    let opening: ReturnType<typeof BoardStore.open>;
    try { opening = BoardStore.open(indexedDB, () => localStorage); }
    catch { setLoadError(true); return; }
    void opening.then(({ store, board, legacyChanged }) => {
      if (cancelled) { store.close(); return; }
      opened = store;
      storeRef.current = store;
      revisionRef.current = board.revision;
      boardRef.current = { books: board.books, goal: board.goal };
      setBooks(board.books);
      setGoal(board.goal);
      if (legacyChanged) { legacyWriteRef.current = true; setStorageWarning(true); }
      setReady(true);
    }).catch(() => { if (!cancelled) setLoadError(true); });
    return () => {
      cancelled = true;
      opened?.close();
      if (storeRef.current === opened) storeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onLegacyWrite = (event: StorageEvent) => {
      if (event.key === null || event.key === STORAGE_KEY || event.key === GOAL_KEY) {
        legacyWriteRef.current = true;
        setStorageWarning(true);
      }
    };
    window.addEventListener('storage', onLegacyWrite);
    return () => window.removeEventListener('storage', onLegacyWrite);
  }, []);

  const persist = useCallback(async (nextBooks: Book[], nextGoal = goal): Promise<boolean> => {
    if (conflictRef.current || savingRef.current || !storeRef.current || revisionRef.current === null) return false;
    if (legacyWriteRef.current) {
      boardRef.current = { books: nextBooks, goal: nextGoal };
      conflictRef.current = true;
      setBooks(nextBooks);
      setGoal(nextGoal);
      setConflict(true);
      setStorageWarning(true);
      return false;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const result = await storeRef.current.commit(revisionRef.current, nextBooks, nextGoal);
      if (result.state === 'saved') {
        revisionRef.current = result.revision;
        boardRef.current = { books: nextBooks, goal: nextGoal };
        setBooks(nextBooks);
        setGoal(nextGoal);
        return true;
      }
    } catch { /* Keep the unsaved collection available for export. */ }
    finally { savingRef.current = false; setSaving(false); }
    boardRef.current = { books: nextBooks, goal: nextGoal };
    conflictRef.current = true;
    setBooks(nextBooks);
    setGoal(nextGoal);
    setConflict(true);
    setStorageWarning(true);
    return false;
  }, [goal]);

  /* Polite live-region message; alternate a trailing nbsp so repeats are re-announced. */
  const announce = useCallback((msg: string) => {
    flip.current = !flip.current;
    setStatus(flip.current ? msg : msg + '\u00a0');
  }, []);

  /* After a remove/status/page change, restore focus to a surviving control, else the composer. */
  useEffect(() => {
    const p = pendingFocus.current;
    if (!p) return;
    pendingFocus.current = null;
    focusBookControl(p);
  }, [books]);

  const visible = filter === 'all' ? books : books.filter((b) => b.status === filter);
  /* The book to focus when `id` leaves the visible list: its neighbour, else the composer. */
  const neighbourId = (id: string) => {
    const i = visible.findIndex((b) => b.id === id);
    const n = visible[i + 1] ?? visible[i - 1];
    return n ? n.id : null;
  };

  const addBook = useCallback(async (text: string) => {
    if (!text.trim()) return;
    const parsed = parseReadingScript(text);
    if (!parsed) { setInputError(PAGE_INPUT_ERROR); announce(PAGE_INPUT_ERROR); return; }
    setInputError('');
    const status: Book['status'] =
      parsed.currentPage && parsed.totalPages && parsed.currentPage >= parsed.totalPages
        ? 'finished' : parsed.currentPage ? 'reading' : 'to-read';
    const book: Book = {
      id: crypto.randomUUID(), title: parsed.title || text, tags: parsed.tags || [],
      priority: parsed.priority ?? null, workspace: parsed.workspace ?? null,
      totalPages: parsed.totalPages ?? null, currentPage: parsed.currentPage ?? null,
      status, addedAt: new Date().toISOString(),
    };
    if (!(await persist([book, ...books]))) return;
    // A completed save must not erase a draft typed while it was pending.
    setInput(current => current === text ? '' : current);
    announce(`Added ${book.title}`);
  }, [books, persist, announce]);

  const cycleStatus = useCallback(async (id: string) => {
    const order: Book['status'][] = ['to-read', 'reading', 'finished'];
    const cur = books.find((b) => b.id === id);
    if (!cur) return;
    const next = order[(order.indexOf(cur.status) + 1) % 3];
    pendingFocus.current = {
      id: filter !== 'all' && next !== filter ? neighbourId(id) : id,
      attribute: 'data-status-id',
      fallbacks: ['book-input'],
    };
    if (!(await persist(books.map((b) => b.id !== id ? b : { ...b, status: next })))) return;
    announce(`${cur.title}: ${next.replace('-', ' ')}`);
  }, [books, persist, announce, filter, visible]);

  const removeBook = useCallback(async (id: string) => {
    const gone = books.find((b) => b.id === id);
    pendingFocus.current = { id: neighbourId(id), attribute: 'data-remove-id', fallbacks: ['book-input'] };
    if (!(await persist(books.filter((b) => b.id !== id)))) return;
    if (gone) announce(`Removed ${gone.title}`);
  }, [books, persist, announce, visible]);

  // restoreFocus only on submit (Enter): a blur means the user is already moving focus elsewhere.
  const updatePages = useCallback(async (id: string, pages: number, restoreFocus = false) => {
    const cur = books.find((b) => b.id === id);
    if (!cur) { setEditingId(null); return; }
    const cp = Math.max(0, Math.min(pages, cur.totalPages ?? Infinity));
    const next: Book['status'] = cur.totalPages && cp >= cur.totalPages ? 'finished' : cp > 0 ? 'reading' : 'to-read';
    if (restoreFocus) {
      pendingFocus.current = {
        id: filter !== 'all' && next !== filter ? neighbourId(id) : id,
        attribute: filter !== 'all' && next !== filter ? 'data-status-id' : 'data-progress-id',
        fallbacks: ['book-input'],
      };
    }
    if (!(await persist(books.map((b) => b.id !== id ? b : { ...b, currentPage: cp, status: next })))) return;
    setEditingId(null);
    announce(`${cur.title}: ${cp} of ${cur.totalPages ?? cp} pages read`);
  }, [books, persist, announce, filter, visible]);

  const exportAsScript = useCallback(async () => {
    setCopyError(false);
    const text = books.map(bookToScript).join('\n');
    if (!(await copyText(text))) {
      setCopyFeedback(false);
      setCopyError(true);
      announce('Could not copy. Check clipboard permissions.');
      return;
    }
    setCopyFeedback(true);
    announce('Copied');
    setTimeout(() => setCopyFeedback(false), 2000);
  }, [books, announce]);

  const downloadBackup = useCallback(() => {
    try {
      const url = URL.createObjectURL(new Blob([createBackup(books, goal)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `reading-list-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link);
      try { link.click(); }
      finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000); }
      setBackupFeedback('Backup download started. Keep the JSON file somewhere safe.');
      announce('Backup download started');
    } catch {
      setBackupFeedback('Could not create backup.');
      announce('Could not create backup');
    }
  }, [books, goal, announce]);

  const restoreBackup = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setBackupFeedback('');
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('Backup exceeds 1 MiB');
      const backup = parseBackup(await file.text());
      const before = boardRef.current;
      const revision = revisionRef.current;
      if (!storeRef.current || revision === null || savingRef.current || conflictRef.current || legacyWriteRef.current || before.books.length !== 0) {
        throw new Error('Restore requires an empty, available reading list. Download a backup of this list first.');
      }
      if (!window.confirm(`Restore ${backup.books.length} books and annual goal ${backup.goal}?`)) return;
      if (savingRef.current || conflictRef.current || legacyWriteRef.current || revisionRef.current !== revision || boardRef.current !== before) {
        throw new Error('Reading list changed while restoring. Reload before trying again.');
      }
      if (!(await persist(backup.books, backup.goal))) {
        throw new Error('Restore was not saved. Download the unsaved JSON before reloading.');
      }
      setBackupFeedback(`Restored ${backup.books.length} books and annual goal ${backup.goal}.`);
      announce(`Restored ${backup.books.length} books`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not restore backup';
      setBackupFeedback(message);
      announce(message);
    } finally {
      if (backupInput.current) backupInput.current.value = '';
    }
  }, [persist, announce]);

  const downloadRecovery = useCallback(() => {
    try {
      const data = JSON.stringify({
        app: 'yapture-reading-list', schemaVersion: 1,
        exportedAt: new Date().toISOString(), books, goal,
      }, null, 2);
      const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `reading-list-unsaved-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link);
      try { link.click(); }
      finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000); }
      setRecoveryFeedback('Unsaved Reading List JSON download started. Keep it before reloading.');
      announce('Unsaved Reading List download started');
    } catch {
      setRecoveryFeedback('Could not download unsaved data. Keep this tab open.');
      announce('Could not download unsaved data');
    }
  }, [books, goal, announce]);

  const downloadLegacyRecovery = () => {
    try {
      const data = JSON.stringify({
        app: 'yapture-reading-list', schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        legacyBooksRaw: localStorage.getItem(STORAGE_KEY),
        legacyGoalRaw: localStorage.getItem(GOAL_KEY),
      }, null, 2);
      const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `reading-list-legacy-recovery-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link);
      try { link.click(); }
      finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000); }
      setRecoveryFeedback('Original browser data download started. Keep it before changing this browser.');
    } catch {
      setRecoveryFeedback('Browser storage could not be read. Keep this tab and browser profile intact.');
    }
  };

  const handleSubmit = (e: FormEvent) => { e.preventDefault(); void addBook(input); };

  const filtered = visible;
  const counts = {
    all: books.length,
    'to-read': books.filter((b) => b.status === 'to-read').length,
    reading: books.filter((b) => b.status === 'reading').length,
    finished: books.filter((b) => b.status === 'finished').length,
  };

  if (loadError) return <main role="alert">
    <p>Reading List storage could not be opened. Your older browser data was left untouched. Close older tabs and reload after saving a recovery copy.</p>
    <button type="button" onClick={downloadLegacyRecovery}>Download original browser data</button>
    {recoveryFeedback && <p role="status">{recoveryFeedback}</p>}
  </main>;
  if (!ready) return <main role="status">Loading Reading List…</main>;

  return (
    <div style={S.root}>
      <style>{`
        .sr-only{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}
        input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid var(--yap-ring);outline-offset:2px}
        @media(max-width:640px){
          .rl-grid{grid-template-columns:1fr!important}
          .rl-goal{flex-direction:column;align-items:center;text-align:center}
          .rl-goal svg{width:72px;height:72px}
          .rl-filters{flex-wrap:wrap}
          .rl-form{flex-direction:column}
          .rl-examples{justify-content:center}
        }
      `}</style>

      <header style={S.header}>
        <div style={S.headerInner}>
          <h1 style={S.logo}>
            <span style={{ color: 'var(--yap-warning)' }}>Reading List</span>
            <span style={S.logoSub}>by Yapture</span>
          </h1>
          <a href="https://yapture.com/market/reading-list" style={S.marketLink}>View on Market &rarr;</a>
        </div>
      </header>

      <main style={S.main}>
        {storageWarning && <p role="alert" style={{ padding: 12, border: '1px solid var(--yap-warning)', borderRadius: 8, background: 'var(--yap-warning-bg)', color: 'var(--yap-fg)' }}>
          {conflict ? 'Another tab changed this list or storage failed. This tab holds unsaved data. Download its JSON before reloading to see the saved version.' : 'Older browser storage changed or cannot be read. This tab is read-only. Download the current backup and, if available, the original browser data before resolving the copies.'}
        </p>}
        {storageWarning && <button type="button" onClick={downloadLegacyRecovery} style={S.exBtn}>Download original browser data</button>}
        {conflict && <div>
          <button type="button" onClick={downloadRecovery} style={S.exBtn}>Download unsaved JSON</button>
        </div>}
        {storageWarning && recoveryFeedback && <p role="status">{recoveryFeedback}</p>}
        {/* Annual reading goal */}
        <div className="rl-goal" style={S.goalSection}>
          <ProgressRing completed={counts.finished} target={goal} />
          <div>
            <div style={{ fontSize: 15, color: 'var(--yap-fg-muted)', marginBottom: 8 }}>Annual reading goal</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label htmlFor="goal-input" style={{ fontSize: 13, color: 'var(--yap-fg-muted)' }}>Target:</label>
              <input id="goal-input" type="number" min={1} max={999} value={goal} disabled={conflict || saving}
                onChange={(e) => {
                  const next = Math.min(999, Math.max(1, parseWholeNumberInput(e.target.value) || 1));
                  void persist(books, next);
                }}
                style={{ ...S.input, width: 64, padding: '6px 10px', fontSize: 14, textAlign: 'center' }} />
              <span style={{ fontSize: 13, color: 'var(--yap-fg-muted)' }}>books</span>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="rl-form" style={S.form}>
          <label htmlFor="book-input" className="sr-only">Add a book</label>
          <input id="book-input" type="text" value={input} onChange={(e) => { setInput(e.target.value); setInputError(''); }}
            aria-invalid={!!inputError} aria-describedby={inputError ? 'book-input-error' : undefined}
            placeholder="Add a book — try: Title #@genre #!priority #*{pages:300,current:50}" style={S.input} />
          <button type="submit" disabled={conflict || saving || !input.trim()} style={S.addBtn}>Add</button>
        </form>
        {inputError && <p id="book-input-error" role="alert">{inputError}</p>}

        <div className="rl-examples" style={S.examples}>
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" disabled={conflict || saving} onClick={() => { void addBook(ex); }} style={S.exBtn}>+ {ex.split('#')[0].trim()}</button>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
          <div className="rl-filters" style={S.filters}>
            {(['all', 'to-read', 'reading', 'finished'] as Filter[]).map((f) => (
              <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f}
                style={{ ...S.filterBtn, ...(filter === f ? S.filterBtnActive : {}) }}>
                {f.replace('-', ' ')} ({counts[f]})
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={downloadBackup} style={S.exBtn}>Download backup</button>
          <input ref={backupInput} type="file" accept="application/json,.json" className="sr-only"
            aria-label="Choose Reading List backup" onChange={(e) => { void restoreBackup(e.target.files?.[0]); }} />
          <button type="button" disabled={conflict || saving} onClick={() => backupInput.current?.click()} style={S.exBtn}>Restore backup</button>
          {books.length > 0 && (
            <button type="button" onClick={exportAsScript}
              style={{ ...S.exBtn, borderColor: 'var(--yap-accent-muted)', color: copyFeedback ? 'var(--yap-success)' : 'var(--yap-accent-hover)' }}>
              {copyFeedback ? 'Copied!' : 'Export as Script'}
            </button>
          )}
          </div>
        </div>
        {copyError && <p role="alert">Could not copy. Check clipboard permissions and try again.</p>}
        {backupFeedback && <p role="alert">{backupFeedback}</p>}

        {filtered.length === 0 ? (
          <div style={S.empty}>
            {books.length === 0 ? 'No books yet. Add one above or click an example.' : `No ${filter.replace('-', ' ')} books.`}
          </div>
        ) : (
          <div className="rl-grid" style={S.grid}>
            {filtered.map((book) => (
              <div key={book.id} style={S.card}
                onMouseEnter={(e) => { Object.assign(e.currentTarget.style, { background: 'var(--yap-bg-elevated)', borderColor: 'var(--yap-border)' }); }}
                onMouseLeave={(e) => { Object.assign(e.currentTarget.style, { background: 'var(--yap-card-bg)', borderColor: 'var(--yap-border-subtle)' }); }}>
                <div style={S.cardTop}>
                  <button type="button" disabled={conflict || saving} onClick={() => { void cycleStatus(book.id); }} data-status-id={book.id}
                    aria-label={`Status: ${book.status.replace('-', ' ')}. Change status`} style={{
                    ...S.statusChip,
                    background: book.status === 'finished' ? 'var(--yap-success-bg)' : book.status === 'reading' ? 'var(--yap-info-bg)' : 'var(--yap-border-subtle)',
                    color: book.status === 'finished' ? 'var(--yap-success-fg)' : book.status === 'reading' ? 'var(--yap-info-fg)' : 'var(--yap-fg)',
                  }}>{book.status.replace('-', ' ')}</button>
                  <button type="button" disabled={conflict || saving} onClick={() => { void removeBook(book.id); }} style={S.removeBtn}
                    aria-label={`Remove ${book.title}`} data-remove-id={book.id}><span aria-hidden="true">&times;</span></button>
                </div>
                <h2 style={{ ...S.cardTitle, ...(book.status === 'finished' ? { textDecoration: 'line-through', opacity: 0.6 } : {}) }}>
                  {book.title}
                </h2>
                {book.totalPages !== null && book.totalPages > 0 && (
                  <div style={S.progress}>
                    {editingId === book.id ? (
                      <form onSubmit={(e) => { e.preventDefault(); void updatePages(book.id, parseWholeNumberInput(editPage), true); }}
                        style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input type="number" min={0} max={book.totalPages} value={editPage} autoFocus disabled={conflict || saving}
                          aria-label={`Current page of ${book.title}`}
                          onChange={(e) => setEditPage(e.target.value)}
                          onBlur={() => { void updatePages(book.id, parseWholeNumberInput(editPage)); }}
                          style={{ ...S.input, width: 72, padding: '4px 8px', fontSize: 13 }} />
                        <span style={{ fontSize: 12, color: 'var(--yap-fg-muted)' }}>/ {book.totalPages} pages</span>
                      </form>
                    ) : (
                      <button type="button" disabled={conflict || saving} onClick={() => { setEditingId(book.id); setEditPage(String(book.currentPage ?? 0)); }}
                        data-progress-id={book.id} aria-label={`${book.currentPage ?? 0} / ${book.totalPages} pages, update pages read`}
                        style={S.progressBtn} title="Click to update page count">
                        <span style={S.progressBar}>
                          <span style={{ ...S.progressFill, width: `${Math.min(100, ((book.currentPage ?? 0) / book.totalPages) * 100)}%` }} />
                        </span>
                        <span style={S.progressLabel}>{book.currentPage ?? 0} / {book.totalPages} pages</span>
                      </button>
                    )}
                  </div>
                )}
                <div style={S.tags}>
                  {book.workspace && <span style={{ ...S.tag, ...S.tagWorkspace }}>{book.workspace}</span>}
                  {book.priority && <span style={{ ...S.tag, ...S.tagPriority }}>{book.priority}</span>}
                  {book.tags.map((t) => <span key={t} style={S.tag}>{t}</span>)}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">{status}</p>

      <footer style={S.footer}>
        <span>Built on{' '}<a href="https://yapture.com" style={S.footerLink}>Yapture</a></span>
        <span>&middot;</span>
        <a href="https://yapture.com/docs/script" style={S.footerLink}>Script docs</a>
        <span>&middot;</span>
        <a href="https://yapture.com/docs/api" style={S.footerLink}>API reference</a>
      </footer>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  root: { minHeight: '100vh', background: '#080b10', color: 'var(--yap-fg)', fontFamily: 'var(--yap-font-sans)', display: 'flex', flexDirection: 'column' },
  header: { borderBottom: '1px solid var(--yap-border)', padding: '16px 0' },
  headerInner: { maxWidth: 960, margin: '0 auto', padding: '0 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  logo: { fontSize: 20, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'baseline', gap: 8 },
  logoSub: { fontSize: 13, fontWeight: 400, color: 'var(--yap-fg-muted)' },
  marketLink: { fontSize: 14, color: 'var(--yap-accent)', textDecoration: 'none', fontWeight: 500 },
  main: { flex: 1, maxWidth: 960, margin: '0 auto', padding: '40px 24px', width: '100%', boxSizing: 'border-box' as const },
  goalSection: { display: 'flex', alignItems: 'center', gap: 24, padding: 20, borderRadius: 14, border: '1px solid var(--yap-border)', background: 'var(--yap-card-bg)', marginBottom: 32 },
  form: { display: 'flex', gap: 12, marginBottom: 16 },
  input: { flex: 1, padding: '12px 16px', borderRadius: 10, border: '1px solid var(--yap-fg-faint)', background: 'var(--yap-input-bg)', color: 'var(--yap-fg)', fontSize: 15, fontFamily: 'var(--yap-font-mono)' },
  addBtn: { padding: '12px 24px', borderRadius: 10, border: 'none', background: 'var(--yap-accent)', color: 'var(--yap-bg)', fontSize: 15, fontWeight: 600, cursor: 'pointer' },
  examples: { display: 'flex', flexWrap: 'wrap' as const, gap: 8, marginBottom: 32 },
  exBtn: { padding: '6px 14px', borderRadius: 999, border: '1px solid var(--yap-border-subtle)', background: 'rgba(255,255,255,.04)', color: 'var(--yap-fg-muted)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' },
  filters: { display: 'flex', gap: 8, marginBottom: 0 },
  filterBtn: { padding: '8px 16px', borderRadius: 8, border: '1px solid var(--yap-border-subtle)', background: 'transparent', color: 'var(--yap-fg-muted)', fontSize: 14, fontWeight: 500, cursor: 'pointer', textTransform: 'capitalize' as const, fontFamily: 'inherit' },
  filterBtnActive: { background: 'var(--yap-accent-muted)', color: 'var(--yap-info-fg)', borderColor: 'var(--yap-accent)' },
  empty: { textAlign: 'center' as const, color: 'var(--yap-fg-muted)', fontSize: 15, padding: '60px 0' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 },
  card: { padding: 20, borderRadius: 14, border: '1px solid var(--yap-border-subtle)', background: 'var(--yap-card-bg)', transition: 'background .15s, border-color .15s' },
  cardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  statusChip: { padding: '4px 10px', borderRadius: 999, border: 'none', fontSize: 12, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '.06em', cursor: 'pointer', fontFamily: 'var(--yap-font-mono)' },
  removeBtn: { border: 'none', background: 'none', color: 'var(--yap-fg-muted)', fontSize: 18, cursor: 'pointer', padding: '0 4px' },
  cardTitle: { fontSize: 17, fontWeight: 600, margin: '0 0 12px', lineHeight: 1.35 },
  progress: { marginBottom: 12 },
  progressBtn: { display: 'block', width: '100%', padding: 0, border: 'none', background: 'none', color: 'inherit', font: 'inherit', textAlign: 'left' as const, cursor: 'pointer' },
  progressBar: { display: 'block', height: 6, borderRadius: 3, background: 'var(--yap-border-subtle)', overflow: 'hidden' as const, marginBottom: 6 },
  progressFill: { display: 'block', height: '100%', borderRadius: 3, background: 'var(--yap-warning)', transition: 'width .3s' },
  progressLabel: { fontSize: 13, color: 'var(--yap-fg-muted)' },
  tags: { display: 'flex', flexWrap: 'wrap' as const, gap: 6 },
  tag: { padding: '3px 8px', borderRadius: 6, background: 'var(--yap-border-subtle)', color: 'var(--yap-fg-muted)', fontSize: 12, fontWeight: 500 },
  tagWorkspace: { background: 'var(--yap-success-bg)', color: 'var(--yap-success-fg)' },
  tagPriority: { background: 'var(--yap-warning-bg)', color: 'var(--yap-warning-fg)' },
  footer: { borderTop: '1px solid var(--yap-border)', padding: '20px 24px', display: 'flex', justifyContent: 'center', gap: 12, fontSize: 13, color: 'var(--yap-fg-muted)' },
  footerLink: { color: 'var(--yap-accent)', textDecoration: 'underline' },
};
