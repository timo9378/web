import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';

// Removed duplicate import App from './App.jsx';

const root = createRoot(document.getElementById('root'));

// Temporarily disable StrictMode completely for testing
root.render(<App />);
