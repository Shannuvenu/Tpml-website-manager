import { useState } from 'react';
import { GoogleLogin, googleLogout, type CredentialResponse } from '@react-oauth/google';
import { jwtDecode } from 'jwt-decode';

export const ALLOWED_EMAIL_DOMAIN = '@printersmysore.co.in';

export interface GoogleIdTokenPayload {
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
  exp: number; // Unix seconds
}

/**
 * Checks the email domain. Any address ending in @printersmysore.co.in is
 * allowed — not just one hardcoded example — so every current and future
 * employee/intern with a company Google account can sign in.
 */
export function isAllowedEmail(userEmail: string): boolean {
  const email = userEmail.trim().toLowerCase();
  return email.includes('@') && email.endsWith(ALLOWED_EMAIL_DOMAIN);
}

/**
 * Decodes the JWT payload only — this does NOT verify Google's cryptographic
 * signature on the token. That's an accepted trade-off for a backend-less
 * app: the token itself was handed to us directly by Google's own sign-in
 * flow in this browser session (never typed by the user), which is
 * meaningfully stronger than a plain email input box, but it is not the
 * same guarantee as server-side signature verification.
 */
export function decodeGoogleCredential(credential: string): GoogleIdTokenPayload | null {
  try {
    return jwtDecode<GoogleIdTokenPayload>(credential);
  } catch {
    return null;
  }
}

interface EmployeeLoginProps {
  onAuthorized: (email: string, credential: string) => void;
}

export default function EmployeeLogin({ onAuthorized }: EmployeeLoginProps) {
  const [deniedEmail, setDeniedEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleSuccess(response: CredentialResponse) {
    setError(null);
    if (!response.credential) {
      setError('Google did not return a credential. Please try again.');
      return;
    }
    const payload = decodeGoogleCredential(response.credential);
    if (!payload) {
      setError('Could not read the Google account details. Please try again.');
      return;
    }
    if (!payload.email_verified) {
      setError("This Google account's email address is not verified by Google.");
      return;
    }
    if (isAllowedEmail(payload.email)) {
      onAuthorized(payload.email, response.credential);
    } else {
      setDeniedEmail(payload.email);
    }
  }

  function handleTryAnother() {
    googleLogout();
    setDeniedEmail(null);
    setError(null);
  }

  if (deniedEmail) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center px-4">
        <div className="w-full max-w-sm bg-panel border border-border rounded-lg p-6 text-center">
          <h1 className="text-base font-semibold text-danger mb-2">Access Denied</h1>
          <p className="text-sm text-text-secondary mb-1">
            This application is restricted to Printers Mysore employees and authorized users.
          </p>
          <p className="text-xs text-text-muted font-mono mb-4 break-all">{deniedEmail}</p>
          <p className="text-xs text-text-secondary mb-5">
            Please sign in using your Printers Mysore Google account.
          </p>
          <button
            onClick={handleTryAnother}
            className="w-full py-2 rounded-md text-sm font-medium bg-accent text-white hover:bg-accent-hover transition-colors"
          >
            Sign out / Try another account
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <h1 className="text-lg font-semibold text-text-primary">Printers Mysore</h1>
          <p className="text-sm text-text-secondary">Internal Website Manager</p>
        </div>
        <div className="bg-panel border border-border rounded-lg p-6">
          <p className="text-sm text-text-secondary mb-5 text-center">
            Sign in with your Printers Mysore Google account to continue.
          </p>
          <div className="flex justify-center">
            <GoogleLogin
              onSuccess={handleSuccess}
              onError={() => setError('Google sign-in failed. Please try again.')}
            />
          </div>
          {error && (
            <p className="mt-4 text-xs text-danger bg-danger/10 rounded-md px-3 py-2 text-center">{error}</p>
          )}
        </div>
      </div>
    </div>
  );
}