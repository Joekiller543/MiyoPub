import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Loader2, Plus, Globe, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useError } from '../contexts/ErrorContext';
import { fetchWithTimeout } from '../lib/api';

interface Book {
  id: string;
  title: string;
  author: string;
  coverUrl: string | null;
}

export default function Library() {
  const { t, i18n } = useTranslation();
  const { showError } = useError();
  const [books, setBooks] = useState<Book[]>([]);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchBooks = async () => {
    try {
      const res = await fetchWithTimeout('/api/books');
      const data = await res.json();
      setBooks(data);
    } catch (err) {
      showError(err);
    }
  };

  useEffect(() => {
    fetchBooks();
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetchWithTimeout('/api/upload', {
        method: 'POST',
        body: formData,
        timeout: 120000
      });

      if (!res.ok) {
        const data = await res.json();
        throw data.error || new Error('Upload failed');
      }

      fetchBooks();
    } catch (err) {
      showError(err);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleDelete = async (e: React.MouseEvent, bookId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm('Remove this book from your library?')) return;

    setDeletingId(bookId);
    try {
      const res = await fetchWithTimeout(`/api/books/${bookId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw data.error || new Error('Delete failed');
      }
      setBooks(prev => prev.filter(b => b.id !== bookId));
    } catch (err) {
      showError(err);
    } finally {
      setDeletingId(null);
    }
  };

  const toggleLanguage = () => {
    const nextLang = i18n.language.startsWith('en') ? 'es' : i18n.language.startsWith('es') ? 'fr' : 'en';
    i18n.changeLanguage(nextLang);
  };

  return (
    <div className="max-w-6xl mx-auto p-6 md:p-12">
      <header className="flex items-center justify-between mb-12">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('library.title')}</h1>
          <p className="text-neutral-500 mt-1">{t('library.subtitle')}</p>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={toggleLanguage}
            className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            title="Change Language"
          >
            <Globe className="w-5 h-5" />
          </button>
          <label className="relative cursor-pointer bg-black dark:bg-white text-white dark:text-black px-4 py-2.5 rounded-full font-medium flex items-center gap-2 hover:opacity-90 transition-opacity shadow-sm">
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            <span>{t('library.upload')}</span>
            <input
              type="file"
              accept=".epub"
              className="hidden"
              onChange={handleFileUpload}
              disabled={uploading}
            />
          </label>
        </div>
      </header>

      {books.length === 0 && !uploading ? (
        <div className="text-center py-24 border-2 border-dashed border-neutral-200 dark:border-neutral-800 rounded-2xl">
          <BookOpen className="w-12 h-12 mx-auto text-neutral-300 dark:text-neutral-700 mb-4" />
          <h3 className="text-lg font-medium">{t('library.nobooks')}</h3>
          <p className="text-neutral-500 mt-1">{t('library.upload_prompt')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
          {books.map((book) => (
            <div key={book.id} className="group flex flex-col gap-3 relative">
              <Link
                to={`/read/${book.id}`}
                className="flex flex-col gap-3"
              >
                <div className="aspect-[2/3] bg-neutral-200 dark:bg-neutral-800 rounded-lg overflow-hidden shadow-sm group-hover:shadow-md transition-all group-hover:-translate-y-1 relative">
                  {book.coverUrl ? (
                    <img
                      src={book.coverUrl}
                      alt={book.title}
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center p-4 text-center">
                      <span className="text-neutral-400 font-serif text-sm line-clamp-3">{book.title}</span>
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors" />
                </div>
                <div>
                  <h3 className="font-medium text-sm line-clamp-1 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">{book.title}</h3>
                  <p className="text-xs text-neutral-500 line-clamp-1">{book.author}</p>
                </div>
              </Link>

              {/* Delete button — visible on hover */}
              <button
                onClick={(e) => handleDelete(e, book.id)}
                disabled={deletingId === book.id}
                title="Remove book"
                className="absolute top-2 right-2 p-1.5 rounded-full bg-black/50 text-white opacity-0 group-hover:opacity-100 hover:bg-red-600 transition-all disabled:opacity-50"
              >
                {deletingId === book.id
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Trash2 className="w-3.5 h-3.5" />
                }
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
