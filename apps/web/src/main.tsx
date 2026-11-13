import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/workspace.css';
import './operations/logistics-layouts.css';
import './operations/finance-layouts.css';
import './operations/service-layouts.css';
import './styles/studio.css';
import './styles/forms.css';
import './styles/readability.css'; // after every screen sheet: the 15px/44px floor wins
import './styles/tailwind.css'; // last: utilities must be able to win

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
