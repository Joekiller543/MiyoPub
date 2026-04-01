import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';
import path from 'path';
import fs from 'fs';

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

const MAX_UNCOMPRESSED_BYTES = 1 * 1024 * 1024 * 1024; // 1 GB zip-bomb guard

export interface BookMetadata {
  id: string;
  title: string;
  author: string;
  coverPath?: string;
  opfDir: string;
  chapters: { id: string; title: string; href: string }[];
}

export class ParserError extends Error {
  constructor(
    public code: string,
    message: string,
    public causeDetail: string,
    public fix: string
  ) {
    super(message);
    this.name = 'ParserError';
  }
}

// ── NCX helpers ──────────────────────────────────────────────────────────────

function buildNavPointMap(navPoints: any[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const np of navPoints) {
    const src: string = np?.content?.["@_src"] || '';
    const label: string =
      np?.navLabel?.text ?? np?.navLabel?.["#text"] ?? '';
    const cleanSrc = src.split('#')[0];
    if (cleanSrc && label) map[cleanSrc] = String(label).trim();
    if (np?.navPoint) {
      const children = Array.isArray(np.navPoint) ? np.navPoint : [np.navPoint];
      Object.assign(map, buildNavPointMap(children));
    }
  }
  return map;
}

function parseNcx(ncxPath: string): Record<string, string> {
  try {
    const xml = fs.readFileSync(ncxPath, 'utf8');
    const obj = xmlParser.parse(xml);
    const navPoints =
      obj?.ncx?.navMap?.navPoint ?? obj?.["ncx:ncx"]?.["ncx:navMap"]?.["ncx:navPoint"];
    if (!navPoints) return {};
    const arr = Array.isArray(navPoints) ? navPoints : [navPoints];
    return buildNavPointMap(arr);
  } catch {
    return {};
  }
}

function parseNavXhtml(navPath: string): Record<string, string> {
  try {
    const xml = fs.readFileSync(navPath, 'utf8');
    const obj = xmlParser.parse(xml);

    const map: Record<string, string> = {};

    function walkOl(ol: any) {
      if (!ol) return;
      const items = Array.isArray(ol.li) ? ol.li : ol.li ? [ol.li] : [];
      for (const li of items) {
        const a = li?.a;
        if (a) {
          const href: string = a['@_href'] || '';
          const text: string = typeof a === 'string' ? a : a['#text'] || a['__text'] || '';
          const cleanHref = href.split('#')[0];
          if (cleanHref && text) map[cleanHref] = text.trim();
        }
        if (li?.ol) walkOl(li.ol);
      }
    }

    function findNav(node: any): any {
      if (!node || typeof node !== 'object') return null;
      for (const key of Object.keys(node)) {
        const val = node[key];
        if (key === 'nav' || key === 'html:nav') {
          const navArr = Array.isArray(val) ? val : [val];
          for (const nav of navArr) {
            const type = nav['@_epub:type'] || nav['@_type'] || '';
            if (type.includes('toc') || type === '') return nav;
          }
        }
        const found = findNav(val);
        if (found) return found;
      }
      return null;
    }

    const nav = findNav(obj);
    if (nav?.ol) walkOl(nav.ol);
    return map;
  } catch {
    return {};
  }
}

// ── Main parser ───────────────────────────────────────────────────────────────

export function parseEpub(bookId: string, filePath: string, extractedDir: string): BookMetadata {
  const extractPath = path.join(extractedDir, bookId);

  let zip: AdmZip;
  try {
    zip = new AdmZip(filePath);
  } catch (err: any) {
    throw new ParserError(
      'CORRUPT_EPUB',
      'Failed to open EPUB file.',
      err.message || 'The file might be corrupted or not a valid ZIP/EPUB archive.',
      'Please ensure the file is a valid .epub and try uploading again.'
    );
  }

  // ── Zip-bomb guard: check total uncompressed size before extracting ─────────
  let totalUncompressed = 0;
  for (const entry of zip.getEntries()) {
    totalUncompressed += entry.header.size;
    if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) {
      throw new ParserError(
        'ZIP_BOMB',
        'EPUB expansion limit exceeded.',
        `The EPUB expands to more than ${MAX_UNCOMPRESSED_BYTES / (1024 ** 3)} GB when uncompressed.`,
        'This file may be malicious or corrupt. Try a different EPUB.'
      );
    }
  }

  try {
    zip.extractAllTo(extractPath, true);
  } catch (err: any) {
    throw new ParserError(
      'CORRUPT_EPUB',
      'Failed to extract EPUB file.',
      err.message || 'The file might be corrupted, incomplete, or not a valid ZIP/EPUB archive.',
      'Please ensure the file is a valid .epub and try uploading again.'
    );
  }

  // 1. Read container.xml to find OPF
  let containerXml: string;
  try {
    containerXml = fs.readFileSync(path.join(extractPath, 'META-INF', 'container.xml'), 'utf8');
  } catch {
    throw new ParserError(
      'MISSING_CONTAINER',
      'Invalid EPUB structure.',
      'META-INF/container.xml is missing.',
      'The EPUB file is malformed. Try converting it again using a tool like Calibre.'
    );
  }

  let containerObj: any;
  try {
    containerObj = xmlParser.parse(containerXml);
  } catch {
    throw new ParserError('MALFORMED_XML', 'Failed to parse container.xml.', 'The XML structure is invalid.', 'Check the EPUB file integrity.');
  }

  const rootfile = containerObj?.container?.rootfiles?.rootfile;
  if (!rootfile) {
    throw new ParserError('NO_ROOTFILE', 'Invalid EPUB structure.', 'No rootfile defined in container.xml.', 'The EPUB file is malformed.');
  }

  const opfRelPath: string = Array.isArray(rootfile) ? rootfile[0]["@_full-path"] : rootfile["@_full-path"];
  const opfFullPath = path.join(extractPath, opfRelPath);
  const opfDir = path.dirname(opfRelPath);

  // 2. Parse OPF
  let opfXml: string;
  try {
    opfXml = fs.readFileSync(opfFullPath, 'utf8');
  } catch {
    throw new ParserError('MISSING_OPF', 'Missing OPF file.', `The file ${opfRelPath} could not be found.`, 'The EPUB file is malformed.');
  }

  let opfObj: any;
  try {
    opfObj = xmlParser.parse(opfXml);
  } catch {
    throw new ParserError('MALFORMED_OPF', 'Failed to parse OPF file.', 'The OPF XML structure is invalid.', 'Check the EPUB file integrity.');
  }

  const metadata = opfObj?.package?.metadata;
  if (!metadata) {
    throw new ParserError('NO_METADATA', 'Missing metadata.', 'The OPF file does not contain a metadata section.', 'The EPUB file is malformed.');
  }

  const titleRaw = metadata['dc:title'] || metadata['title'] || 'Unknown Title';
  const title = typeof titleRaw === 'string' ? titleRaw : titleRaw['#text'] || 'Unknown Title';

  let author = 'Unknown Author';
  if (metadata['dc:creator']) {
    author = typeof metadata['dc:creator'] === 'string'
      ? metadata['dc:creator']
      : metadata['dc:creator']['#text'] || 'Unknown Author';
  }

  // 3. Parse Manifest & Spine
  const manifest = opfObj?.package?.manifest?.item;
  const spine = opfObj?.package?.spine?.itemref;

  if (!manifest || !spine) {
    throw new ParserError('NO_SPINE', 'Missing reading order.', 'The EPUB manifest or spine is missing.', 'The EPUB file is malformed and cannot be read.');
  }

  const manifestItems: any[] = Array.isArray(manifest) ? manifest : [manifest];
  const spineItems: any[] = Array.isArray(spine) ? spine : [spine];

  const manifestMap: Record<string, any> = {};
  let coverHref = '';
  let ncxId = '';
  let navId = '';

  for (const item of manifestItems) {
    const id: string = item['@_id'] || '';
    manifestMap[id] = item;
    const mediaType: string = item['@_media-type'] || '';
    const href: string = item['@_href'] || '';
    const props: string = item['@_properties'] || '';

    if (id.toLowerCase().includes('cover') && mediaType.startsWith('image/')) {
      coverHref = href;
    }
    if (mediaType === 'application/x-dtbncx+xml') ncxId = id;
    if (props.includes('nav') || mediaType === 'application/xhtml+xml' && props.includes('nav')) navId = id;
  }

  // Also find nav from spine's toc attribute
  const tocId: string = opfObj?.package?.spine?.["@_toc"] || '';

  // 4. Build title map from NCX or nav.xhtml
  let titleMap: Record<string, string> = {};

  // Try EPUB 3 nav.xhtml first
  if (navId && manifestMap[navId]) {
    const navHref: string = manifestMap[navId]['@_href'] || '';
    const navFullPath = path.join(extractPath, opfDir, navHref);
    titleMap = parseNavXhtml(navFullPath);
  }

  // Fall back to EPUB 2 NCX
  if (Object.keys(titleMap).length === 0) {
    const ncxItemId = ncxId || tocId;
    if (ncxItemId && manifestMap[ncxItemId]) {
      const ncxHref: string = manifestMap[ncxItemId]['@_href'] || '';
      const ncxFullPath = path.join(extractPath, opfDir, ncxHref);
      titleMap = parseNcx(ncxFullPath);
    }
  }

  // 5. Build Chapters from Spine
  const chapters = spineItems.map((itemref: any, index: number) => {
    const idref: string = itemref['@_idref'] || '';
    const manifestItem = manifestMap[idref];
    const href: string = manifestItem ? manifestItem['@_href'] : '';

    // Look up real title from navigation document
    const navTitle = titleMap[href] || titleMap[path.posix.basename(href)] || '';
    const chapterTitle = navTitle || `Chapter ${index + 1}`;

    return { id: idref, title: chapterTitle, href };
  }).filter((c: any) => c.href);

  if (chapters.length === 0) {
    throw new ParserError('EMPTY_BOOK', 'No readable chapters found.', 'The spine contains no valid HTML documents.', 'The EPUB file might be empty or uses an unsupported format.');
  }

  return {
    id: bookId,
    title,
    author,
    coverPath: coverHref ? path.posix.join(opfDir, coverHref) : undefined,
    opfDir,
    chapters
  };
}
