import { useCallback, useState, type FormEvent } from 'react';

interface Book {
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

const STORAGE_KEY = 'yapture.app-reading-list.books.v1';

function loadBooks(): Book[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveBooks(books: Book[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(books));
}

function parseScript(text: string): Partial<Book> {
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
    const pagesM = metaMatch[1].match(/pages\s*:\s*(\d+)/);
    const currentM = metaMatch[1].match(/current\s*:\s*(\d+)/);
    if (pagesM) totalPages = parseInt(pagesM[1], 10);
    if (currentM) currentPage = parseInt(currentM[1], 10);
  }

  const title = text
    .replace(/#[!@+^~$?]?\w[\w-]*/g, '')
    .replace(/#\*\{[^}]*\}/g, '')
    .replace(/\bdue:\S+/g, '')
    .trim();

  return {
    title: title || text,
    tags,
    workspace: workspaces[0] ?? null,
    priority,
    totalPages,
    currentPage,
  };
}

const EXAMPLES = [
  'Designing Data-Intensive Applications #@technical #!high #*{pages:613,current:142}',
  'Project Hail Mary #@fiction #*{pages:476,current:476}',
  'The Pragmatic Programmer #@technical #*{pages:352}',
];

type Filter = 'all' | 'to-read' | 'reading' | 'finished';

export function App() {
  const [books, setBooks] = useState<Book[]>(loadBooks);
  const [input, setInput] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const addBook = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      const parsed = parseScript(text);
      const status: Book['status'] =
        parsed.currentPage && parsed.totalPages && parsed.currentPage >= parsed.totalPages
          ? 'finished'
          : parsed.currentPage
            ? 'reading'
            : 'to-read';
      const book: Book = {
        id: crypto.randomUUID(),
        title: parsed.title || text,
        tags: parsed.tags || [],
        priority: parsed.priority ?? null,
        workspace: parsed.workspace ?? null,
        totalPages: parsed.totalPages ?? null,
        currentPage: parsed.currentPage ?? null,
        status,
        addedAt: new Date().toISOString(),
      };
      const next = [book, ...books];
      setBooks(next);
      saveBooks(next);
      setInput('');
    },
    [books],
  );

  const cycleStatus = useCallback(
    (id: string) => {
      const next = books.map((b) => {
        if (b.id !== id) return b;
        const order: Book['status'][] = ['to-read', 'reading', 'finished'];
        const idx = order.indexOf(b.status);
        return { ...b, status: order[(idx + 1) % 3] };
      });
      setBooks(next);
      saveBooks(next);
    },
    [books],
  );

  const removeBook = useCallback(
    (id: string) => {
      const next = books.filter((b) => b.id !== id);
      setBooks(next);
      saveBooks(next);
    },
    [books],
  );

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    addBook(input);
  };

  const filtered = filter === 'all' ? books : books.filter((b) => b.status === filter);
  const counts = {
    all: books.length,
    'to-read': books.filter((b) => b.status === 'to-read').length,
    reading: books.filter((b) => b.status === 'reading').length,
    finished: books.filter((b) => b.status === 'finished').length,
  };

  return (
    <div style={styles.root}>
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <h1 style={styles.logo}>
            <span style={{ color: '#F2B960' }}>Reading List</span>
            <span style={styles.logoSub}>by Yapture</span>
          </h1>
          <a href="https://yapture.com/market/reading-list" style={styles.marketLink}>
            View on Market &rarr;
          </a>
        </div>
      </header>

      <main style={styles.main}>
        <form onSubmit={handleSubmit} style={styles.form}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Add a book — try: Title #@genre #!priority #*{pages:300,current:50}"
            style={styles.input}
          />
          <button type="submit" disabled={!input.trim()} style={styles.addBtn}>
            Add
          </button>
        </form>

        <div style={styles.examples}>
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" onClick={() => addBook(ex)} style={styles.exBtn}>
              + {ex.split('#')[0].trim()}
            </button>
          ))}
        </div>

        <div style={styles.filters}>
          {(['all', 'to-read', 'reading', 'finished'] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              style={{
                ...styles.filterBtn,
                ...(filter === f ? styles.filterBtnActive : {}),
              }}
            >
              {f.replace('-', ' ')} ({counts[f]})
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div style={styles.empty}>
            {books.length === 0
              ? 'No books yet. Add one above or click an example.'
              : `No ${filter.replace('-', ' ')} books.`}
          </div>
        ) : (
          <div style={styles.grid}>
            {filtered.map((book) => (
              <div key={book.id} style={styles.card}>
                <div style={styles.cardTop}>
                  <button
                    type="button"
                    onClick={() => cycleStatus(book.id)}
                    style={{
                      ...styles.statusChip,
                      background:
                        book.status === 'finished'
                          ? 'rgba(67,214,173,.15)'
                          : book.status === 'reading'
                            ? 'rgba(77,107,255,.15)'
                            : 'rgba(166,176,190,.1)',
                      color:
                        book.status === 'finished'
                          ? '#43D6AD'
                          : book.status === 'reading'
                            ? '#7B93FF'
                            : '#A6B0BE',
                    }}
                  >
                    {book.status.replace('-', ' ')}
                  </button>
                  <button type="button" onClick={() => removeBook(book.id)} style={styles.removeBtn}>
                    &times;
                  </button>
                </div>
                <h3
                  style={{
                    ...styles.cardTitle,
                    ...(book.status === 'finished' ? { textDecoration: 'line-through', opacity: 0.6 } : {}),
                  }}
                >
                  {book.title}
                </h3>
                {book.totalPages && (
                  <div style={styles.progress}>
                    <div style={styles.progressBar}>
                      <div
                        style={{
                          ...styles.progressFill,
                          width: `${Math.min(100, ((book.currentPage ?? 0) / book.totalPages) * 100)}%`,
                        }}
                      />
                    </div>
                    <span style={styles.progressLabel}>
                      {book.currentPage ?? 0} / {book.totalPages} pages
                    </span>
                  </div>
                )}
                <div style={styles.tags}>
                  {book.workspace && <span style={{ ...styles.tag, ...styles.tagWorkspace }}>{book.workspace}</span>}
                  {book.priority && <span style={{ ...styles.tag, ...styles.tagPriority }}>{book.priority}</span>}
                  {book.tags.map((t) => (
                    <span key={t} style={styles.tag}>
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <footer style={styles.footer}>
        <span>
          Built on{' '}
          <a href="https://yapture.com" style={styles.footerLink}>
            Yapture
          </a>{' '}
          Script and list primitives
        </span>
        <span>&middot;</span>
        <a href="https://yapture.com/docs/script" style={styles.footerLink}>
          Script docs
        </a>
        <span>&middot;</span>
        <a href="https://yapture.com/.well-known/yapture-api.md" style={styles.footerLink}>
          API reference
        </a>
      </footer>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: '100vh',
    background: '#080b10',
    color: '#f7f4ec',
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
    display: 'flex',
    flexDirection: 'column',
  },
  header: { borderBottom: '1px solid rgba(166,176,190,.18)', padding: '16px 0' },
  headerInner: {
    maxWidth: 960,
    margin: '0 auto',
    padding: '0 24px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logo: { fontSize: 20, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'baseline', gap: 8 },
  logoSub: { fontSize: 13, fontWeight: 400, color: '#a6b0be' },
  marketLink: { fontSize: 14, color: '#4d6bff', textDecoration: 'none', fontWeight: 500 },
  main: { flex: 1, maxWidth: 960, margin: '0 auto', padding: '40px 24px', width: '100%', boxSizing: 'border-box' },
  form: { display: 'flex', gap: 12, marginBottom: 16 },
  input: {
    flex: 1,
    padding: '12px 16px',
    borderRadius: 10,
    border: '1px solid rgba(166,176,190,.18)',
    background: '#0f141c',
    color: '#f7f4ec',
    fontSize: 15,
    fontFamily: '"JetBrains Mono", monospace',
    outline: 'none',
  },
  addBtn: {
    padding: '12px 24px',
    borderRadius: 10,
    border: 'none',
    background: '#4d6bff',
    color: '#fff',
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
  },
  examples: { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 32 },
  exBtn: {
    padding: '6px 14px',
    borderRadius: 999,
    border: '1px solid rgba(166,176,190,.14)',
    background: 'rgba(255,255,255,.04)',
    color: '#a6b0be',
    fontSize: 13,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  filters: { display: 'flex', gap: 8, marginBottom: 24 },
  filterBtn: {
    padding: '8px 16px',
    borderRadius: 8,
    border: '1px solid rgba(166,176,190,.14)',
    background: 'transparent',
    color: '#a6b0be',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    textTransform: 'capitalize',
    fontFamily: 'inherit',
  },
  filterBtnActive: { background: 'rgba(77,107,255,.12)', color: '#7B93FF', borderColor: 'rgba(77,107,255,.3)' },
  empty: { textAlign: 'center', color: '#738091', fontSize: 15, padding: '60px 0' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 },
  card: {
    padding: 20,
    borderRadius: 14,
    border: '1px solid rgba(166,176,190,.14)',
    background: 'linear-gradient(135deg, rgba(255,255,255,.03), transparent 36%), #0f141c',
  },
  cardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  statusChip: {
    padding: '4px 10px',
    borderRadius: 999,
    border: 'none',
    fontSize: 12,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '.06em',
    cursor: 'pointer',
    fontFamily: '"JetBrains Mono", monospace',
  },
  removeBtn: {
    border: 'none',
    background: 'none',
    color: '#738091',
    fontSize: 18,
    cursor: 'pointer',
    padding: '0 4px',
  },
  cardTitle: { fontSize: 17, fontWeight: 600, margin: '0 0 12px', lineHeight: 1.35 },
  progress: { marginBottom: 12 },
  progressBar: { height: 6, borderRadius: 3, background: 'rgba(166,176,190,.12)', overflow: 'hidden', marginBottom: 6 },
  progressFill: { height: '100%', borderRadius: 3, background: '#F2B960', transition: 'width .3s' },
  progressLabel: { fontSize: 13, color: '#a6b0be' },
  tags: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  tag: {
    padding: '3px 8px',
    borderRadius: 6,
    background: 'rgba(166,176,190,.1)',
    color: '#a6b0be',
    fontSize: 12,
    fontWeight: 500,
  },
  tagWorkspace: { background: 'rgba(5,150,105,.12)', color: '#34d399' },
  tagPriority: { background: 'rgba(234,88,12,.12)', color: '#fb923c' },
  footer: {
    borderTop: '1px solid rgba(166,176,190,.18)',
    padding: '20px 24px',
    display: 'flex',
    justifyContent: 'center',
    gap: 12,
    fontSize: 13,
    color: '#738091',
  },
  footerLink: { color: '#4d6bff', textDecoration: 'none' },
};
