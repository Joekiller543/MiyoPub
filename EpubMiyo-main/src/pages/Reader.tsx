import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Menu, Settings, ArrowLeft, Type, Moon, Sun, Coffee, Globe } from 'lucide-react';
import { cn } from '../lib/utils';
import { useTranslation } from 'react-i18next';
import { useError } from '../contexts/ErrorContext';
import { fetchWithTimeout } from '../lib/api';

interface ChapterDef {
  id: string;
  title: string;
  href: string;
}

interface BookDetails {
  id: string;
  title: string;
  author: string;
  chapters: ChapterDef[];
}

type Theme = 'light' | 'dark' | 'sepia';

const MAX_CACHE_SIZE = 5;

export default function Reader() {
  const { t, i18n } = useTranslation();
  const { showError } = useError();
  const { bookId } = useParams();
  const navigate = useNavigate();

  const [book, setBook] = useState<BookDetails | null>(null);
  const [currentChapterIdx, setCurrentChapterIdx] = useState(0);
  const [chapterContent, setChapterContent] = useState<string>('');
  const [loading, setLoading] = useState(true);

  const [showSidebar, setShowSidebar] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // ── LRU cache: tracks access order so least-recently-used chapter is evicted
  const chapterCache = useRef<Record<string, string>>({});
  const cacheOrder = useRef<string[]>([]);

  // ── Refs for use inside event listeners (avoid stale closure over state) ─────
  const bookRef = useRef<BookDetails | null>(null);
  const currentChapterIdxRef = useRef(0);
  // loadChapterRef lets the message handler always call the latest loadChapter
  // without being in its dependency array (avoids the "used before declaration" issue).
  const loadChapterRef = useRef<(id: string, book: BookDetails) => void>(() => {});

  const [fontSize, setFontSize] = useState(18);
  const [theme, setTheme] = useState<Theme>('light');

  const progressKey = `reader_progress_${bookId}`;

  // ── LRU cache management ──────────────────────────────────────────────────
  const touchCache = (chapterId: string, content?: string) => {
    // Move to end of access list (most recently used)
    cacheOrder.current = cacheOrder.current.filter(k => k !== chapterId);
    cacheOrder.current.push(chapterId);

    if (content !== undefined) {
      chapterCache.current[chapterId] = content;
    }

    // Evict LRU entries if over limit
    while (cacheOrder.current.length > MAX_CACHE_SIZE) {
      const lruKey = cacheOrder.current.shift()!;
      delete chapterCache.current[lruKey];
    }
  };

  // ── Keep refs in sync with state ─────────────────────────────────────────────
  useEffect(() => { bookRef.current = book; }, [book]);
  useEffect(() => { currentChapterIdxRef.current = currentChapterIdx; }, [currentChapterIdx]);

  // ── Internal EPUB link navigation ─────────────────────────────────────────────
  // The iframe sends a postMessage when a link is clicked. We resolve the raw
  // href (relative path) against the current chapter to find the target chapter.
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!event.data || event.data.type !== 'link') return;
      const rawHref: string = event.data.href || '';
      const currentBook = bookRef.current;
      if (!currentBook || !rawHref) return;

      // Split off anchor fragment (anchor ignored — iframe handles same-chapter scrolling)
      const [targetPath] = rawHref.split('#');

      // Anchor-only links (#something) scroll within the iframe naturally
      if (!targetPath) return;

      const currentChapter = currentBook.chapters[currentChapterIdxRef.current];
      const currentHref = currentChapter?.href || '';

      // Resolve targetPath relative to the directory of the current chapter
      const currentDir = currentHref.includes('/')
        ? currentHref.substring(0, currentHref.lastIndexOf('/') + 1)
        : '';
      const parts = (currentDir + targetPath).split('/');
      const stack: string[] = [];
      for (const p of parts) {
        if (p === '..') stack.pop();
        else if (p !== '.' && p !== '') stack.push(p);
      }
      const resolvedPath = stack.join('/');

      // Find a chapter whose href matches the resolved path
      const target = currentBook.chapters.find(c =>
        c.href === resolvedPath ||
        c.href === targetPath ||
        c.href.endsWith('/' + resolvedPath) ||
        c.href.endsWith('/' + targetPath) ||
        c.href.split('/').pop() === targetPath.split('/').pop()
      );

      if (target) loadChapterRef.current(target.id, currentBook);
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []); // stable — uses refs only, no direct state/callback dependencies

  useEffect(() => {
    const savedSize = localStorage.getItem('reader_fontSize');
    const savedTheme = localStorage.getItem('reader_theme') as Theme;
    if (savedSize) setFontSize(parseInt(savedSize));
    if (savedTheme) setTheme(savedTheme);

    fetchWithTimeout(`/api/books/${bookId}`)
      .then(res => res.json())
      .then(data => {
        setBook(data);
        if (data.chapters && data.chapters.length > 0) {
          // Restore last-read chapter index
          const savedIdx = parseInt(localStorage.getItem(progressKey) || '0', 10);
          const startIdx = isNaN(savedIdx) || savedIdx >= data.chapters.length ? 0 : savedIdx;
          loadChapter(data.chapters[startIdx].id, data, false, startIdx);
        }
      })
      .catch(err => {
        showError(err);
        navigate('/');
      });
  }, [bookId]);

  useEffect(() => {
    localStorage.setItem('reader_fontSize', fontSize.toString());
    localStorage.setItem('reader_theme', theme);
    document.documentElement.classList.remove('theme-light', 'theme-dark', 'theme-sepia');
    document.documentElement.classList.add(`theme-${theme}`);
  }, [fontSize, theme]);

  const loadChapter = useCallback(async (
    chapterId: string,
    currentBook: BookDetails | null = book,
    preloadOnly = false,
    forceIdx?: number
  ) => {
    if (!preloadOnly) setLoading(true);

    if (chapterCache.current[chapterId]) {
      touchCache(chapterId); // Mark as recently used
      if (!preloadOnly) {
        setChapterContent(chapterCache.current[chapterId]);
        updateChapterState(chapterId, currentBook, forceIdx);
        setLoading(false);
      }
      return;
    }

    try {
      const res = await fetchWithTimeout(`/api/books/${bookId}/chapters/${chapterId}`);
      if (!res.ok) throw new Error('Failed to load chapter');
      const data = await res.json();

      touchCache(chapterId, data.content); // Store and mark as recently used

      if (!preloadOnly) {
        setChapterContent(data.content);
        updateChapterState(chapterId, currentBook, forceIdx);
      }
    } catch (err) {
      if (!preloadOnly) showError(err);
    } finally {
      if (!preloadOnly) setLoading(false);
    }
  }, [book, bookId]);

  // Keep ref in sync so the message handler always calls the latest version
  loadChapterRef.current = loadChapter;

  const updateChapterState = (chapterId: string, currentBook: BookDetails | null, forceIdx?: number) => {
    if (!currentBook) return;
    const idx = forceIdx !== undefined
      ? forceIdx
      : currentBook.chapters.findIndex(c => c.id === chapterId);
    if (idx === -1) return;

    setCurrentChapterIdx(idx);
    // Persist reading progress
    localStorage.setItem(progressKey, idx.toString());

    // Preload the next chapter
    if (idx < currentBook.chapters.length - 1) {
      loadChapter(currentBook.chapters[idx + 1].id, currentBook, true);
    }
  };

  const handlePrev = () => {
    if (book && currentChapterIdx > 0) {
      loadChapter(book.chapters[currentChapterIdx - 1].id, book);
    }
  };

  const handleNext = () => {
    if (book && currentChapterIdx < book.chapters.length - 1) {
      loadChapter(book.chapters[currentChapterIdx + 1].id, book);
    }
  };

  const toggleLanguage = () => {
    const nextLang = i18n.language.startsWith('en') ? 'es' : i18n.language.startsWith('es') ? 'fr' : 'en';
    i18n.changeLanguage(nextLang);
  };

  if (!book) return <div className="min-h-screen flex items-center justify-center">{t('reader.loading')}</div>;

  const themeClasses = {
    light: 'bg-white text-neutral-900',
    dark: 'bg-neutral-950 text-neutral-300',
    sepia: 'bg-[#f4ecd8] text-[#5b4636]'
  };

  // Adaptive Memory-Safe Iframe Pagination (AMSIP) — isolates EPUB DOM,
  // prevents stylesheet leakage and main-thread reflows.
  // Note: sandbox="allow-scripts" only — allow-same-origin removed so the iframe
  // cannot access parent cookies/localStorage. EPUB HTML is sanitised server-side;
  // the only scripts running are the link-interceptor we inject below.
  const iframeSrcDoc = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
      <style>
        :root {
          --bg: ${theme === 'dark' ? '#0a0a0a' : theme === 'sepia' ? '#f4ecd8' : '#ffffff'};
          --fg: ${theme === 'dark' ? '#d4d4d4' : theme === 'sepia' ? '#5b4636' : '#171717'};
          --link: ${theme === 'dark' ? '#60a5fa' : '#3b82f6'};
        }
        html, body {
          margin: 0;
          padding: 0;
          width: 100%;
          height: 100%;
          background-color: var(--bg);
          color: var(--fg);
          font-family: system-ui, -apple-system, sans-serif;
          font-size: ${fontSize}px;
          line-height: 1.6;
          overflow-x: hidden;
          overflow-y: auto;
          -webkit-font-smoothing: antialiased;
        }
        .epub-container {
          padding: 20px 24px;
          max-width: 800px;
          margin: 0 auto;
        }
        img, svg, video {
          max-width: 100%;
          height: auto;
          border-radius: 4px;
          margin: 1em auto;
          display: block;
        }
        a { color: var(--link); text-decoration: none; }
        p { margin-top: 0; margin-bottom: 1em; text-indent: 1.5em; }
        p:first-of-type { text-indent: 0; }
        h1, h2, h3, h4, h5, h6 { margin-top: 1.5em; margin-bottom: 0.5em; line-height: 1.2; }
        blockquote { border-left: 3px solid var(--fg); margin: 1em 0; padding-left: 1em; opacity: 0.8; }
        hr { border: 0; border-bottom: 1px solid var(--fg); opacity: 0.2; margin: 2em 0; }
        table { border-collapse: collapse; width: 100%; margin: 1em 0; }
        th, td { border: 1px solid var(--fg); padding: 0.5em; opacity: 0.9; }
      </style>
    </head>
    <body>
      <div class="epub-container">
        ${chapterContent}
      </div>
      <script>
        document.addEventListener('click', function(e) {
          var a = e.target.closest('a');
          if (!a) return;
          var rawHref = a.getAttribute('href') || '';
          if (!rawHref) return;
          // Let anchor-only links (#section) scroll within the iframe naturally
          if (rawHref.charAt(0) === '#') return;
          e.preventDefault();
          // Send the raw attribute value — NOT a.href, which resolves against
          // about:srcdoc and gives garbage URLs in a sandboxed srcdoc iframe.
          window.parent.postMessage({ type: 'link', href: rawHref }, '*');
        });
      </script>
    </body>
    </html>
  `;

  return (
    <div className={cn("min-h-screen flex flex-col transition-colors duration-300", themeClasses[theme])}>
      {/* Top Navigation Bar */}
      <header className={cn(
        "sticky top-0 z-40 flex items-center justify-between px-4 h-14 border-b transition-colors",
        theme === 'dark' ? 'border-neutral-800 bg-neutral-950/90' :
        theme === 'sepia' ? 'border-[#e8dcc1] bg-[#f4ecd8]/90' :
        'border-neutral-200 bg-white/90 backdrop-blur-sm'
      )}>
        <div className="flex items-center gap-2">
          <button onClick={() => navigate('/')} className="p-2 -ml-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <button onClick={() => setShowSidebar(!showSidebar)} className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10">
            <Menu className="w-5 h-5" />
          </button>
          <span className="font-medium text-sm hidden sm:inline-block line-clamp-1 ml-2">{book.title}</span>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={() => setShowSettings(!showSettings)} className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10">
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>

      <div className="flex-1 flex relative overflow-hidden">
        {/* Sidebar TOC */}
        <aside className={cn(
          "absolute inset-y-0 left-0 z-30 w-72 border-r transform transition-transform duration-300 ease-in-out overflow-y-auto",
          theme === 'dark' ? 'bg-neutral-900 border-neutral-800' :
          theme === 'sepia' ? 'bg-[#e8dcc1] border-[#d5c5a3]' :
          'bg-neutral-50 border-neutral-200',
          showSidebar ? "translate-x-0" : "-translate-x-full"
        )}>
          <div className="p-4">
            <h3 className="font-bold mb-4 uppercase text-xs tracking-wider opacity-60">{t('reader.toc')}</h3>
            <ul className="space-y-1">
              {book.chapters.map((chap, idx) => (
                <li key={chap.id}>
                  <button
                    onClick={() => {
                      loadChapter(chap.id, book);
                      setShowSidebar(false);
                    }}
                    className={cn(
                      "w-full text-left px-3 py-2 rounded-md text-sm transition-colors",
                      currentChapterIdx === idx
                        ? (theme === 'dark' ? 'bg-neutral-800 font-medium' : 'bg-black/5 font-medium')
                        : 'hover:bg-black/5 dark:hover:bg-white/5 opacity-80 hover:opacity-100'
                    )}
                  >
                    {chap.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* Settings Dropdown */}
        {showSettings && (
          <div className={cn(
            "absolute top-0 right-4 z-50 mt-2 w-64 rounded-xl shadow-xl border p-4 animate-in fade-in slide-in-from-top-2",
            theme === 'dark' ? 'bg-neutral-900 border-neutral-800' :
            theme === 'sepia' ? 'bg-[#e8dcc1] border-[#d5c5a3]' :
            'bg-white border-neutral-200'
          )}>
            <div className="space-y-6">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider opacity-60 mb-3 block">{t('reader.theme')}</span>
                <div className="flex gap-2">
                  <button onClick={() => setTheme('light')} className={cn("flex-1 py-2 rounded-lg border flex justify-center items-center", theme === 'light' ? 'border-blue-500 ring-1 ring-blue-500' : 'border-neutral-200 bg-white text-black')}>
                    <Sun className="w-4 h-4" />
                  </button>
                  <button onClick={() => setTheme('sepia')} className={cn("flex-1 py-2 rounded-lg border flex justify-center items-center", theme === 'sepia' ? 'border-blue-500 ring-1 ring-blue-500' : 'border-[#d5c5a3] bg-[#f4ecd8] text-[#5b4636]')}>
                    <Coffee className="w-4 h-4" />
                  </button>
                  <button onClick={() => setTheme('dark')} className={cn("flex-1 py-2 rounded-lg border flex justify-center items-center", theme === 'dark' ? 'border-blue-500 ring-1 ring-blue-500' : 'border-neutral-700 bg-neutral-950 text-white')}>
                    <Moon className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div>
                <span className="text-xs font-bold uppercase tracking-wider opacity-60 mb-3 block">{t('reader.text_size')}</span>
                <div className="flex items-center gap-3">
                  <button onClick={() => setFontSize(Math.max(12, fontSize - 2))} className="p-2 rounded-lg border hover:bg-black/5 dark:hover:bg-white/5 border-current opacity-60 hover:opacity-100">
                    <Type className="w-4 h-4" />
                  </button>
                  <span className="flex-1 text-center text-sm font-medium">{fontSize}px</span>
                  <button onClick={() => setFontSize(Math.min(32, fontSize + 2))} className="p-2 rounded-lg border hover:bg-black/5 dark:hover:bg-white/5 border-current opacity-60 hover:opacity-100">
                    <Type className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div>
                <span className="text-xs font-bold uppercase tracking-wider opacity-60 mb-3 block">{t('reader.language')}</span>
                <button onClick={toggleLanguage} className="w-full py-2 rounded-lg border flex justify-center items-center gap-2 hover:bg-black/5 dark:hover:bg-white/5 border-current opacity-80 hover:opacity-100">
                  <Globe className="w-4 h-4" />
                  <span className="text-sm font-medium uppercase">{i18n.language.substring(0, 2)}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Main Content Area */}
        <main
          className="flex-1 flex flex-col relative"
          onClick={() => {
            if (showSidebar) setShowSidebar(false);
            if (showSettings) setShowSettings(false);
          }}
        >
          {loading ? (
            <div className="flex-1 flex justify-center py-20 opacity-50 px-6 max-w-3xl mx-auto w-full">
              <div className="animate-pulse flex flex-col gap-4 w-full">
                <div className="h-8 bg-current rounded w-3/4 opacity-20"></div>
                <div className="h-4 bg-current rounded w-full opacity-20 mt-8"></div>
                <div className="h-4 bg-current rounded w-full opacity-20"></div>
                <div className="h-4 bg-current rounded w-5/6 opacity-20"></div>
                <div className="h-4 bg-current rounded w-full opacity-20 mt-4"></div>
                <div className="h-4 bg-current rounded w-4/5 opacity-20"></div>
              </div>
            </div>
          ) : (
            <iframe
              title="EPUB Content"
              srcDoc={iframeSrcDoc}
              className="flex-1 w-full border-none bg-transparent"
              sandbox="allow-scripts"
            />
          )}

          {/* Chapter Navigation Footer */}
          {!loading && (
            <div className="p-4 border-t border-current border-opacity-10 flex items-center justify-between bg-inherit z-10">
              <button
                onClick={handlePrev}
                disabled={currentChapterIdx === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
              >
                <ChevronLeft className="w-5 h-5" />
                <span>{t('reader.prev')}</span>
              </button>

              <span className="text-xs uppercase tracking-wider opacity-50">
                {currentChapterIdx + 1} / {book.chapters.length}
              </span>

              <button
                onClick={handleNext}
                disabled={currentChapterIdx === book.chapters.length - 1}
                className="flex items-center gap-2 px-4 py-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
              >
                <span>{t('reader.next')}</span>
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
