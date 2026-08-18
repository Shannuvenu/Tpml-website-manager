import React from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleOAuthProvider } from '@react-oauth/google';
import App from './App';
// TypeScript may complain about side-effect CSS imports when no type
// declarations are present. Ignore the check for this import.
// @ts-ignore
import './index.css';

// Replace with the real Client ID from Google Cloud Console (Step 2).
// This value is NOT a secret — it's meant to be public, unlike a GitHub PAT.
const GOOGLE_CLIENT_ID = '776790988972-8oc731nl0mklhuu4ovjtuk2fkrcbnbmg.apps.googleusercontent.com';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <App />
    </GoogleOAuthProvider>
  </React.StrictMode>
);
