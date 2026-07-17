import { useCallback, useEffect, useState, type FormEvent } from 'react';

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
const GOAL_KEY = 'yapture.app-reading-list.goal.v1';

function loadBooks(): Book[] {
  try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : []; }
  catch { return []; }
}
function saveBooks(books: Book[]) { localStorage.setItem(STORAGE_KEY, JSON.stringify(books)); }
function loadGoal(): number { return parseInt(localStorage.getItem(GOAL_KEY) || '12', 10) || 12; }
function saveGoal(n: number) { localStorage.setItem(GOAL_KEY, String(n)); }

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

  const title = text.replace(/#[!@+^~$?]?\w[\w-]*/g, '').replace(/#\*\{[^}]*\}/g, '').replace(/\bdue:\S+/g, '').trim();
  return { title: title || text, tags, workspace: workspaces[0] ?? null, priority, totalPages, currentPage };
}

function bookToScript(b: Book): string {
  let line = b.title;
  if (b.workspace) line += ` #@${b.workspace}`;
  if (b.priority) line += ` #!${b.priority}`;
  b.tags.forEach((t) => (line += ` #${t}`));
  if (b.totalPages) {
    const parts = [`pages:${b.totalPages}`];
    if (b.currentPage) parts.push(`current:${b.currentPage}`);
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
      <circle cx={r + stroke} cy={r + stroke} r={r} fill="none" stroke="rgba(166,176,190,.12)" strokeWidth={stroke} />
      <circle cx={r + stroke} cy={r + stroke} r={r} fill="none" stroke="#F2B960" strokeWidth={stroke}
        strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)}
        transform={`rotate(-90 ${r + stroke} ${r + stroke})`} style={{ transition: 'stroke-dashoffset .5s' }} />
      <text x={r + stroke} y={r + stroke - 6} textAnchor="middle" fill="#f7f4ec" fontSize="18" fontWeight="700">
        {completed}/{target}
      </text>
      <text x={r + stroke} y={r + stroke + 12} textAnchor="middle" fill="#a6b0be" fontSize="11">
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

export function App() {
  const [books, setBooks] = useState<Book[]>(loadBooks);
  const [input, setInput] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPage, setEditPage] = useState('');
  const [goal, setGoal] = useState(loadGoal);
  const [copyFeedback, setCopyFeedback] = useState(false);

  useEffect(() => { saveGoal(goal); }, [goal]);

  const persist = useCallback((next: Book[]) => { setBooks(next); saveBooks(next); }, []);

  const addBook = useCallback((text: string) => {
    if (!text.trim()) return;
    const parsed = parseScript(text);
    const status: Book['status'] =
      parsed.currentPage && parsed.totalPages && parsed.currentPage >= parsed.totalPages
        ? 'finished' : parsed.currentPage ? 'reading' : 'to-read';
    const book: Book = {
      id: crypto.randomUUID(), title: parsed.title || text, tags: parsed.tags || [],
      priority: parsed.priority ?? null, workspace: parsed.workspace ?? null,
      totalPages: parsed.totalPages ?? null, currentPage: parsed.currentPage ?? null,
      status, addedAt: new Date().toISOString(),
    };
    persist([book, ...books]);
    setInput('');
  }, [books, persist]);

  const cycleStatus = useCallback((id: string) => {
    const order: Book['status'][] = ['to-read', 'reading', 'finished'];
    persist(books.map((b) => b.id !== id ? b : { ...b, status: order[(order.indexOf(b.status) + 1) % 3] }));
  }, [books, persist]);

  const removeBook = useCallback((id: string) => { persist(books.filter((b) => b.id !== id)); }, [books, persist]);

  const updatePages = useCallback((id: string, pages: number) => {
    persist(books.map((b) => {
      if (b.id !== id) return b;
      const cp = Math.max(0, Math.min(pages, b.totalPages ?? Infinity));
      const status: Book['status'] = b.totalPages && cp >= b.totalPages ? 'finished' : cp > 0 ? 'reading' : 'to-read';
      return { ...b, currentPage: cp, status };
    }));
    setEditingId(null);
  }, [books, persist]);

  const exportAsScript = useCallback(() => {
    const text = books.map(bookToScript).join('\n');
    navigator.clipboard.writeText(text).then(() => { setCopyFeedback(true); setTimeout(() => setCopyFeedback(false), 2000); });
  }, [books]);

  const handleSubmit = (e: FormEvent) => { e.preventDefault(); addBook(input); };

  const filtered = filter === 'all' ? books : books.filter((b) => b.status === filter);
  const counts = {
    all: books.length,
    'to-read': books.filter((b) => b.status === 'to-read').length,
    reading: books.filter((b) => b.status === 'reading').length,
    finished: books.filter((b) => b.status === 'finished').length,
  };

  return (
    <div style={S.root}>
      <style>{`
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
            <span style={{ color: '#F2B960' }}>Reading List</span>
            <span style={S.logoSub}>by Yapture</span>
          </h1>
          <a href="https://yapture.com/market/reading-list" style={S.marketLink}>View on Market &rarr;</a>
        </div>
      </header>

      <main style={S.main}>
        {/* Annual reading goal */}
        <div className="rl-goal" style={S.goalSection}>
          <ProgressRing completed={counts.finished} target={goal} />
          <div>
            <div style={{ fontSize: 15, color: '#a6b0be', marginBottom: 8 }}>Annual reading goal</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ fontSize: 13, color: '#738091' }}>Target:</label>
              <input type="number" min={1} max={999} value={goal}
                onChange={(e) => setGoal(Math.max(1, parseInt(e.target.value) || 1))}
                style={{ ...S.input, width: 64, padding: '6px 10px', fontSize: 14, textAlign: 'center' }} />
              <span style={{ fontSize: 13, color: '#738091' }}>books</span>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="rl-form" style={S.form}>
          <input type="text" value={input} onChange={(e) => setInput(e.target.value)}
            placeholder="Add a book — try: Title #@genre #!priority #*{pages:300,current:50}" style={S.input} />
          <button type="submit" disabled={!input.trim()} style={S.addBtn}>Add</button>
        </form>

        <div className="rl-examples" style={S.examples}>
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" onClick={() => addBook(ex)} style={S.exBtn}>+ {ex.split('#')[0].trim()}</button>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
          <div className="rl-filters" style={S.filters}>
            {(['all', 'to-read', 'reading', 'finished'] as Filter[]).map((f) => (
              <button key={f} type="button" onClick={() => setFilter(f)}
                style={{ ...S.filterBtn, ...(filter === f ? S.filterBtnActive : {}) }}>
                {f.replace('-', ' ')} ({counts[f]})
              </button>
            ))}
          </div>
          {books.length > 0 && (
            <button type="button" onClick={exportAsScript}
              style={{ ...S.exBtn, borderColor: 'rgba(77,107,255,.3)', color: copyFeedback ? '#43D6AD' : '#7B93FF' }}>
              {copyFeedback ? 'Copied!' : 'Export as Script'}
            </button>
          )}
        </div>

        {filtered.length === 0 ? (
          <div style={S.empty}>
            {books.length === 0 ? 'No books yet. Add one above or click an example.' : `No ${filter.replace('-', ' ')} books.`}
          </div>
        ) : (
          <div className="rl-grid" style={S.grid}>
            {filtered.map((book) => (
              <div key={book.id} style={S.card}
                onMouseEnter={(e) => { Object.assign(e.currentTarget.style, { background: '#1d2636', borderColor: 'rgba(166,176,190,.28)' }); }}
                onMouseLeave={(e) => { Object.assign(e.currentTarget.style, { background: '#151c27', borderColor: 'rgba(166,176,190,.18)' }); }}>
                <div style={S.cardTop}>
                  <button type="button" onClick={() => cycleStatus(book.id)} style={{
                    ...S.statusChip,
                    background: book.status === 'finished' ? 'rgba(67,214,173,.15)' : book.status === 'reading' ? 'rgba(77,107,255,.15)' : 'rgba(166,176,190,.1)',
                    color: book.status === 'finished' ? '#5EEDC4' : book.status === 'reading' ? '#93A8FF' : '#E2E6EC',
                  }}>{book.status.replace('-', ' ')}</button>
                  <button type="button" onClick={() => removeBook(book.id)} style={S.removeBtn}>&times;</button>
                </div>
                <h3 style={{ ...S.cardTitle, ...(book.status === 'finished' ? { textDecoration: 'line-through', opacity: 0.6 } : {}) }}>
                  {book.title}
                </h3>
                {book.totalPages && (
                  <div style={S.progress}>
                    {editingId === book.id ? (
                      <form onSubmit={(e) => { e.preventDefault(); updatePages(book.id, parseInt(editPage) || 0); }}
                        style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input type="number" min={0} max={book.totalPages} value={editPage} autoFocus
                          onChange={(e) => setEditPage(e.target.value)}
                          onBlur={() => updatePages(book.id, parseInt(editPage) || 0)}
                          style={{ ...S.input, width: 72, padding: '4px 8px', fontSize: 13 }} />
                        <span style={{ fontSize: 12, color: '#738091' }}>/ {book.totalPages} pages</span>
                      </form>
                    ) : (
                      <div onClick={() => { setEditingId(book.id); setEditPage(String(book.currentPage ?? 0)); }}
                        style={{ cursor: 'pointer' }} title="Click to update page count">
                        <div style={S.progressBar}>
                          <div style={{ ...S.progressFill, width: `${Math.min(100, ((book.currentPage ?? 0) / book.totalPages) * 100)}%` }} />
                        </div>
                        <span style={S.progressLabel}>{book.currentPage ?? 0} / {book.totalPages} pages</span>
                      </div>
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
  root: { minHeight: '100vh', background: '#080b10', color: '#f7f4ec', fontFamily: 'Inter, system-ui, -apple-system, sans-serif', display: 'flex', flexDirection: 'column' },
  header: { borderBottom: '1px solid rgba(166,176,190,.18)', padding: '16px 0' },
  headerInner: { maxWidth: 960, margin: '0 auto', padding: '0 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  logo: { fontSize: 20, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'baseline', gap: 8 },
  logoSub: { fontSize: 13, fontWeight: 400, color: '#a6b0be' },
  marketLink: { fontSize: 14, color: '#4d6bff', textDecoration: 'none', fontWeight: 500 },
  main: { flex: 1, maxWidth: 960, margin: '0 auto', padding: '40px 24px', width: '100%', boxSizing: 'border-box' as const },
  goalSection: { display: 'flex', alignItems: 'center', gap: 24, padding: 20, borderRadius: 14, border: '1px solid rgba(166,176,190,.18)', background: '#151c27', marginBottom: 32 },
  form: { display: 'flex', gap: 12, marginBottom: 16 },
  input: { flex: 1, padding: '12px 16px', borderRadius: 10, border: '1px solid rgba(166,176,190,.18)', background: '#0f141c', color: '#f7f4ec', fontSize: 15, fontFamily: '"JetBrains Mono", monospace', outline: 'none' },
  addBtn: { padding: '12px 24px', borderRadius: 10, border: 'none', background: '#4d6bff', color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer' },
  examples: { display: 'flex', flexWrap: 'wrap' as const, gap: 8, marginBottom: 32 },
  exBtn: { padding: '6px 14px', borderRadius: 999, border: '1px solid rgba(166,176,190,.14)', background: 'rgba(255,255,255,.04)', color: '#a6b0be', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' },
  filters: { display: 'flex', gap: 8, marginBottom: 0 },
  filterBtn: { padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(166,176,190,.14)', background: 'transparent', color: '#a6b0be', fontSize: 14, fontWeight: 500, cursor: 'pointer', textTransform: 'capitalize' as const, fontFamily: 'inherit' },
  filterBtnActive: { background: 'rgba(77,107,255,.12)', color: '#7B93FF', borderColor: 'rgba(77,107,255,.3)' },
  empty: { textAlign: 'center' as const, color: '#738091', fontSize: 15, padding: '60px 0' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 },
  card: { padding: 20, borderRadius: 14, border: '1px solid rgba(166,176,190,.18)', background: '#151c27', transition: 'background .15s, border-color .15s' },
  cardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  statusChip: { padding: '4px 10px', borderRadius: 999, border: 'none', fontSize: 12, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '.06em', cursor: 'pointer', fontFamily: '"JetBrains Mono", monospace' },
  removeBtn: { border: 'none', background: 'none', color: '#738091', fontSize: 18, cursor: 'pointer', padding: '0 4px' },
  cardTitle: { fontSize: 17, fontWeight: 600, margin: '0 0 12px', lineHeight: 1.35 },
  progress: { marginBottom: 12 },
  progressBar: { height: 6, borderRadius: 3, background: 'rgba(166,176,190,.15)', overflow: 'hidden' as const, marginBottom: 6 },
  progressFill: { height: '100%', borderRadius: 3, background: '#F2B960', transition: 'width .3s' },
  progressLabel: { fontSize: 13, color: '#a6b0be' },
  tags: { display: 'flex', flexWrap: 'wrap' as const, gap: 6 },
  tag: { padding: '3px 8px', borderRadius: 6, background: 'rgba(166,176,190,.1)', color: '#a6b0be', fontSize: 12, fontWeight: 500 },
  tagWorkspace: { background: 'rgba(5,150,105,.12)', color: '#34d399' },
  tagPriority: { background: 'rgba(234,88,12,.12)', color: '#fb923c' },
  footer: { borderTop: '1px solid rgba(166,176,190,.18)', padding: '20px 24px', display: 'flex', justifyContent: 'center', gap: 12, fontSize: 13, color: '#738091' },
  footerLink: { color: '#4d6bff', textDecoration: 'none' },
};
