import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/newsreader/400.css';
import App from './App';
import DreamStudio from './dream/DreamStudio';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {window.location.pathname === '/dream' ? <DreamStudio /> : <App />}
  </React.StrictMode>,
);
