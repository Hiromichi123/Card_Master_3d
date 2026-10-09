import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App';
import './ui/global.css';
import './ui/theme.css';
import './ui/buttons.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('找不到 #root 挂载点，请检查 index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
