# Nexus EPUB Reader

A high-performance, hybrid EPUB reading platform built with React, Node.js, and React Native.

## 🌟 Key Features

- **Hybrid Architecture:** Node.js backend for robust EPUB parsing and a React frontend for a dynamic, responsive UI.
- **Multi-Language Support:** Full i18n integration (English, Spanish, French).
- **Large File Support:** Optimized backend handles EPUBs up to 100MB with direct-to-disk extraction to prevent memory overload.
- **Adaptive Memory-Safe Iframe Pagination (AMSIP):** A unique algorithm that isolates chapter rendering within an iframe, preventing massive DOM reflows and memory leaks, especially crucial for mobile devices.
- **Dynamic Memory Pruning Cache:** Intelligently caches a limited number of chapters (e.g., current, next, previous) and aggressively prunes older ones to maintain a tiny memory footprint.
- **Offline Capabilities:** Service Worker implementation with stale-while-revalidate and network-first strategies allows reading previously loaded chapters without an internet connection. PWA ready.
- **Cross-Platform:** Web-first design with a dedicated React Native WebView wrapper for seamless deployment to iOS and Android.
- **Robust Error Handling:** Global error boundary and detailed error modals guide users through issues (e.g., corrupted files, network timeouts) with suggested fixes.

## 🏗️ Architecture

- **Frontend:** React 19, Vite, Tailwind CSS v4, React Router, i18next.
- **Backend:** Node.js, Express, `adm-zip`, `fast-xml-parser`, `cheerio`.
- **Mobile Wrapper:** React Native, Expo, `react-native-webview`.

## 🚀 Getting Started (Web)

### Prerequisites
- Node.js (v18+ recommended)
- npm or yarn

### Installation

1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the development server (runs both backend and frontend):
   ```bash
   npm run dev
   ```
4. Open your browser to `http://localhost:3000`.

## 📱 React Native / WebView Support

Nexus EPUB Reader includes a dedicated React Native wrapper for deploying to iOS and Android.

### Setup (Expo)

1. Navigate to the `mobile` directory:
   ```bash
   cd mobile
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the Expo development server:
   ```bash
   npx expo start
   ```

### How it Works

The mobile wrapper uses `react-native-webview` to load the web application. It includes:
- Native loading indicators.
- Safe area handling for modern devices (notches, home indicators).
- Injected JavaScript for better control over the web environment (e.g., preventing unwanted scaling).

*Note: For production, you should point the `uri` in `mobile/App.tsx` to your deployed web application URL.*

## 🧠 Unique Algorithms & Performance

### Adaptive Memory-Safe Iframe Pagination (AMSIP)
Rendering large HTML chapters directly into the React DOM can cause severe performance degradation and memory leaks on mobile devices due to massive reflows. AMSIP solves this by rendering chapter content inside an isolated `iframe` using `srcDoc`. This sandboxes the CSS and DOM, ensuring smooth scrolling and preventing the main application thread from blocking.

### Dynamic Memory Pruning Cache
To ensure instant page turns without consuming excessive RAM, the reader implements a sliding window cache. It preloads the *next* chapter while reading the current one, but strictly limits the cache size (e.g., max 3 chapters). Older chapters are aggressively pruned from memory, preventing out-of-memory (OOM) crashes on lower-end devices.

## 🔌 API Documentation

The backend provides a RESTful API for managing EPUBs.

### `POST /api/upload` (or `/upload`)
Upload an EPUB file.
- **Body:** `multipart/form-data` with a `file` field.
- **Returns:** `{ id: string, message: string }`

### `GET /api/books`
Retrieve a list of uploaded books.
- **Returns:** `[{ id, title, author, coverPath }]`

### `GET /api/books/:id`
Retrieve metadata and table of contents for a specific book.
- **Returns:** `{ id, title, author, coverPath, chapters: [{ id, title, href }] }`

### `GET /api/books/:id/chapters/:chapterId`
Retrieve the HTML content of a specific chapter. Asset paths (images, CSS) are automatically rewritten to point to the backend.
- **Returns:** `{ id, title, content: string }`

### `GET /api/books/:id/assets/*`
Serve static assets (images, fonts, CSS) from the extracted EPUB. Includes `Cache-Control` headers for performance.

## 🛠️ Error Handling

The application features a comprehensive error handling system:
- **Network Timeouts:** Large uploads or slow connections trigger specific timeout errors after 120 seconds.
- **Parsing Errors:** Corrupted or malformed EPUBs return detailed error messages from the backend.
- **Global UI:** Errors are caught by a global `ErrorProvider` and displayed in a user-friendly modal with actionable advice.

## 🌐 Offline Support (PWA)

Nexus EPUB Reader is configured as a Progressive Web App (PWA).
- **Service Worker:** Caches the application shell (HTML, JS, CSS) and static assets.
- **API Caching:** Uses a stale-while-revalidate strategy for API requests, allowing users to continue reading previously loaded chapters even if they lose internet connection.
- **Installable:** Can be installed to the home screen on supported mobile browsers.
