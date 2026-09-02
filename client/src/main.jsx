import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './lib/auth.jsx';
import { ToastProvider } from './components/Toast.jsx';
import { ConfirmProvider } from './components/ConfirmModal.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <ToastProvider>
          <ConfirmProvider>
            <ErrorBoundary>
              <App />
            </ErrorBoundary>
          </ConfirmProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
