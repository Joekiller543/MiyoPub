/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import Library from './pages/Library';
import Reader from './pages/Reader';
import { ErrorProvider } from './contexts/ErrorContext';

export default function App() {
  return (
    <ErrorProvider>
      <Router>
        <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 font-sans selection:bg-blue-200 dark:selection:bg-blue-900">
          <Routes>
            <Route path="/" element={<Library />} />
            <Route path="/read/:bookId" element={<Reader />} />
          </Routes>
        </div>
      </Router>
    </ErrorProvider>
  );
}
