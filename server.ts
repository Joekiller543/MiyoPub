import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import * as cheerio from 'cheerio';
import sanitizeHtml from 'sanitize-html';
import { randomUUID } from 'crypto';
import { rateLimit } from 'express-rate-limit';
import { createServer as createViteServer } from 'vite';
import { parseEpub, ParserError } from './server/parser';

const app = express();
const PORT = parseInt(process.env.PORT || '5000', 10);

// ── CORS ──────────────────────────────────────────────────────────────────────
// In production restrict to your domain; in dev allow all origins.
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? (process.env.ALLOWED_ORIGIN || false)
    : true,
  methods: ['GET', 'POST', 'DELETE'],
}));

app.use(express.json());

// ── Storage directories ───────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const RAW_DIR = path.join(UPLOADS_DIR, 'raw');
const EXTRACTED_DIR = path.join(UPLOADS_DIR, 'extracted');
const DB_FILE = path.join(UPLOADS_DIR, 'db.json');

for (const dir of [UPLOADS_DIR, RAW_DIR, EXTRACTED_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify([]));

// ── Path-traversal guard ──────────────────────────────────────────────────────
function assertPathInDir(fullPath: string, baseDir: string): void {
  const normalizedFull = path.normalize(fullPath);
  const normalizedBase = path.normalize(baseDir) + path.sep;
  if (!normalizedFull.startsWith(normalizedBase)) {
    throw Object.assign(new Error('Forbidden path'), { status: 403 });
  }
}

// ── Atomic DB write lock ──────────────────────────────────────────────────────
let dbLock: Promise<void> = Promise.resolve();

function withDbLock<T>(fn: () => T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    dbLock = dbLock.then(() => {
      try {
        resolve(fn());
      } catch (e) {
        reject(e);
      }
    });
  });
}

function readDb(): any[] {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return [];
  }
}

// ── HTML sanitizer config ─────────────────────────────────────────────────────
// Preserves semantic EPUB markup AND author CSS while stripping all executable content.
// allowVulnerableTags: true is required to permit <style> (author CSS); <script> is
// never added to allowedTags so it is still stripped.
const SANITIZE_OPTS: sanitizeHtml.IOptions = {
  allowedTags: [
    // Author stylesheet references — hrefs already rewritten to /api/books/…/assets/
    'style', 'link',
    // Headings & body structure
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'span', 'div', 'section', 'article', 'aside', 'main', 'header', 'footer',
    // Inline text
    'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins', 'mark', 'small',
    // Media & links
    'a', 'img', 'figure', 'figcaption',
    // Lists
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    // Tables
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
    // Misc semantic
    'blockquote', 'pre', 'code', 'hr', 'br',
    'sup', 'sub', 'abbr', 'cite', 'q', 'dfn', 'time',
    'ruby', 'rt', 'rp', 'rb',
    'details', 'summary',
  ],
  allowedAttributes: {
    // link — only stylesheet links pass (rel="stylesheet" enforced via transformTags below)
    'link': ['rel', 'type', 'href', 'media'],
    // style — no attributes; CSS text content passes through as-is
    'style': [],
    'a': ['href', 'title', 'name', 'id'],
    'img': ['src', 'alt', 'title', 'width', 'height'],
    'td': ['colspan', 'rowspan'],
    'th': ['colspan', 'rowspan', 'scope'],
    'col': ['span'],
    'colgroup': ['span'],
    'time': ['datetime'],
    '*': ['class', 'id', 'lang', 'dir', 'epub:type'],
  },
  allowedSchemes: ['http', 'https', 'data'],
  allowedSchemesByTag: {
    'img': ['http', 'https', 'data'],
    // Allow relative paths and our API paths for CSS links
    'link': ['http', 'https'],
  },
  // Required to allow <style>. <script> is deliberately absent from allowedTags.
  allowVulnerableTags: true,
  allowedScriptDomains: [],
  // Only pass through link tags with rel="stylesheet" — drop all others (icons, prefetch, etc.)
  transformTags: {
    'link': (tagName, attribs) => {
      if (attribs.rel !== 'stylesheet') return { tagName: 'link', attribs: {} };
      return { tagName, attribs };
    },
  },
};

// ── Rate limiting ─────────────────────────────────────────────────────────────
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { error: { code: 'RATE_LIMIT', message: 'Too many uploads. Please try again later.', cause: 'Rate limit exceeded.', fix: 'Wait 15 minutes before uploading again.' } },
});

const apiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 300,
  message: { error: { code: 'RATE_LIMIT', message: 'Too many requests. Please slow down.', cause: 'Rate limit exceeded.', fix: 'Wait a few minutes before retrying.' } },
});

// ── Multer config with file-type validation ───────────────────────────────────
const upload = multer({
  dest: RAW_DIR,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB compressed limit
  fileFilter: (_req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith('.epub')) {
      return cb(Object.assign(new Error('Only .epub files are allowed'), { code: 'INVALID_FILE_TYPE' }) as any);
    }
    cb(null, true);
  },
});

// Magic-bytes check: EPUB = ZIP = PK\x03\x04
function isValidEpubMagic(filePath: string): boolean {
  try {
    const buf = Buffer.alloc(4);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    return buf[0] === 0x50 && buf[1] === 0x4B && buf[2] === 0x03 && buf[3] === 0x04;
  } catch {
    return false;
  }
}

// ── API ROUTES ────────────────────────────────────────────────────────────────

// Upload & parse EPUB
app.post('/api/upload', uploadLimiter, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      error: { code: 'NO_FILE', message: 'No file uploaded', cause: 'The request did not contain a file.', fix: 'Please select a file and try again.' }
    });
  }

  // Magic bytes validation
  if (!isValidEpubMagic(req.file.path)) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({
      error: { code: 'INVALID_FILE_TYPE', message: 'File is not a valid EPUB.', cause: 'The file does not have the correct ZIP/EPUB signature.', fix: 'Please upload a valid .epub file.' }
    });
  }

  try {
    const bookId = randomUUID();
    const metadata = parseEpub(bookId, req.file.path, EXTRACTED_DIR);

    // Atomic DB write
    await withDbLock(() => {
      const db = readDb();
      db.push(metadata);
      fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    });

    // Clean up raw upload file after successful parse
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

    res.json({ success: true, book: metadata });
  } catch (error: any) {
    console.error('EPUB Parse Error:', error);

    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

    if (error instanceof ParserError) {
      return res.status(400).json({
        error: { code: error.code, message: error.message, cause: error.causeDetail, fix: error.fix }
      });
    }
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
        cause: error.message || 'Unknown server error.',
        fix: 'Please try again later.'
      }
    });
  }
});

// List all books
app.get('/api/books', apiLimiter, (_req, res) => {
  try {
    const db = readDb();
    const books = db.map((b: any) => ({
      id: b.id,
      title: b.title,
      author: b.author,
      coverUrl: b.coverPath ? `/api/books/${b.id}/assets/${b.coverPath}` : null
    }));
    res.json(books);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'DB_ERROR', message: 'Failed to read database.', cause: error.message, fix: 'Check server logs.' } });
  }
});

// Get single book metadata
app.get('/api/books/:id', apiLimiter, (req, res) => {
  try {
    const db = readDb();
    const book = db.find((b: any) => b.id === req.params.id);
    if (!book) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Book not found.', cause: 'The requested book ID does not exist.', fix: 'Go back to the library and select a valid book.' } });
    res.json(book);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'DB_ERROR', message: 'Failed to read database.', cause: error.message, fix: 'Check server logs.' } });
  }
});

// Delete a book
app.delete('/api/books/:id', apiLimiter, async (req, res) => {
  try {
    const { id } = req.params;

    await withDbLock(() => {
      const db = readDb();
      const idx = db.findIndex((b: any) => b.id === id);
      if (idx === -1) throw Object.assign(new Error('Book not found'), { status: 404 });
      db.splice(idx, 1);
      fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    });

    // Remove extracted files
    const extractDir = path.join(EXTRACTED_DIR, id);
    if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true });

    res.json({ success: true });
  } catch (error: any) {
    const status = error.status || 500;
    res.status(status).json({ error: { code: status === 404 ? 'NOT_FOUND' : 'DELETE_ERROR', message: error.message, cause: '', fix: 'Try again or restart the server.' } });
  }
});

// Serve extracted assets (images, CSS) — with path-traversal protection
app.get('/api/books/:id/assets/*', apiLimiter, (req, res) => {
  const bookId = req.params.id;
  const rawAssetPath = req.params[0];

  const bookExtractDir = path.join(EXTRACTED_DIR, bookId);
  const fullPath = path.normalize(path.join(bookExtractDir, rawAssetPath));

  try {
    assertPathInDir(fullPath, bookExtractDir);
  } catch {
    return res.status(403).send('Forbidden');
  }

  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    return res.status(404).send('Asset not found');
  }

  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(fullPath);
});

// Get chapter HTML — sanitized before delivery
app.get('/api/books/:id/chapters/:chapterId', apiLimiter, (req, res) => {
  try {
    const { id, chapterId } = req.params;
    const db = readDb();
    const book = db.find((b: any) => b.id === id);

    if (!book) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Book not found.', cause: 'The requested book ID does not exist.', fix: 'Go back to the library and select a valid book.' } });

    const chapter = book.chapters.find((c: any) => c.id === chapterId);
    if (!chapter) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Chapter not found.', cause: 'The requested chapter ID does not exist in this book.', fix: 'Try reloading the book.' } });

    const chapterPath = path.normalize(path.join(EXTRACTED_DIR, id, book.opfDir, chapter.href));
    const bookDir = path.join(EXTRACTED_DIR, id);

    try {
      assertPathInDir(chapterPath, bookDir);
    } catch {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Invalid chapter path.', cause: 'Path traversal detected.', fix: 'This EPUB may be malicious.' } });
    }

    if (!fs.existsSync(chapterPath)) {
      return res.status(404).json({ error: { code: 'FILE_MISSING', message: 'Chapter file missing.', cause: 'The HTML file for this chapter was not found in the extracted EPUB.', fix: 'The EPUB might be corrupted. Try re-uploading it.' } });
    }

    const html = fs.readFileSync(chapterPath, 'utf8');
    const $ = cheerio.load(html);
    const chapterDir = path.posix.dirname(path.posix.join(book.opfDir, chapter.href));

    // Rewrite image src to point to asset server
    $('img, image').each((_, el) => {
      const src = $(el).attr('src') || $(el).attr('xlink:href');
      if (src && !src.startsWith('http') && !src.startsWith('data:')) {
        const absoluteAssetPath = path.posix.join(chapterDir, src);
        $(el).attr('src', `/api/books/${id}/assets/${absoluteAssetPath}`);
      }
    });

    // Rewrite stylesheet hrefs (in <head> and in <body>)
    $('link[rel="stylesheet"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href && !href.startsWith('http')) {
        const absoluteAssetPath = path.posix.join(chapterDir, href);
        $(el).attr('href', `/api/books/${id}/assets/${absoluteAssetPath}`);
      }
    });

    // ── Collect author CSS from <head> before extracting body ─────────────────
    // $('body').html() drops the <head> entirely, so we lift stylesheets out
    // manually and prepend them to the body content. Browsers accept <link> and
    // <style> elements in the body, so the combined string is valid to inject.
    const headParts: string[] = [];
    $('head link[rel="stylesheet"]').each((_, el) => { headParts.push($.html(el)); });
    $('head style').each((_, el) => { headParts.push($.html(el)); });

    const bodyHtml = $('body').html() || $.html();
    const rawContent = headParts.join('\n') + bodyHtml;

    // ── SANITIZE: strip all scripts and dangerous attributes ──────────────────
    const safeContent = sanitizeHtml(rawContent, SANITIZE_OPTS);

    res.json({
      id: chapter.id,
      title: chapter.title,
      content: safeContent
    });
  } catch (error: any) {
    console.error('Chapter Load Error:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to load chapter.', cause: error.message, fix: 'Please try again later.' } });
  }
});

// ── VITE MIDDLEWARE ───────────────────────────────────────────────────────────
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, allowedHosts: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
