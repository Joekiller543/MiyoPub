import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

const resources = {
  en: {
    translation: {
      "library.title": "My Library",
      "library.subtitle": "Your personal EPUB collection",
      "library.upload": "Upload EPUB",
      "library.nobooks": "No books yet",
      "library.upload_prompt": "Upload an EPUB file to start reading.",
      "reader.toc": "Table of Contents",
      "reader.theme": "Theme",
      "reader.text_size": "Text Size",
      "reader.language": "Language",
      "reader.prev": "Previous",
      "reader.next": "Next",
      "reader.loading": "Loading book...",
      "reader.chapter": "Chapter"
    }
  },
  es: {
    translation: {
      "library.title": "Mi Biblioteca",
      "library.subtitle": "Tu colección personal de EPUB",
      "library.upload": "Subir EPUB",
      "library.nobooks": "No hay libros aún",
      "library.upload_prompt": "Sube un archivo EPUB para empezar a leer.",
      "reader.toc": "Índice",
      "reader.theme": "Tema",
      "reader.text_size": "Tamaño de texto",
      "reader.language": "Idioma",
      "reader.prev": "Anterior",
      "reader.next": "Siguiente",
      "reader.loading": "Cargando libro...",
      "reader.chapter": "Capítulo"
    }
  },
  fr: {
    translation: {
      "library.title": "Ma Bibliothèque",
      "library.subtitle": "Votre collection personnelle d'EPUB",
      "library.upload": "Télécharger EPUB",
      "library.nobooks": "Aucun livre pour le moment",
      "library.upload_prompt": "Téléchargez un fichier EPUB pour commencer à lire.",
      "reader.toc": "Table des matières",
      "reader.theme": "Thème",
      "reader.text_size": "Taille du texte",
      "reader.language": "Langue",
      "reader.prev": "Précédent",
      "reader.next": "Suivant",
      "reader.loading": "Chargement du livre...",
      "reader.chapter": "Chapitre"
    }
  }
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false
    }
  });

export default i18n;
