import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/tailwind.css'; // last: utilities must be able to win

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
