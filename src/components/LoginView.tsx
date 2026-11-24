import { Activity, ArrowRight, Eye, EyeOff, KeyRound, Loader2, Lock, UserPlus } from 'lucide-react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import type { AuthUser, Organisation, SiteCheckResult, UserSettings } from '../types/upsite';

type LoginTab = 'token' | 'register' | 'login';

export interface AuthSuccessPayload {
  sessionToken: string;
  rememberMe: boolean;
  user: AuthUser;
  workspace?: {
    history: SiteCheckResult[];
    organisations: Organisation[];
    settings: UserSettings;
    checkerInput?: string;
  };
}

interface LoginViewProps {
  onAuthenticated: (payload: AuthSuccessPayload) => void;
}

const LAST_USERNAME_KEY = 'upsite_last_username';

function readSavedUsername(): string {
  try {
    return window.localStorage.getItem(LAST_USERNAME_KEY) || '';
  } catch {
    return '';
  }
}

export function LoginView({ onAuthenticated }: LoginViewProps) {
  const initialSavedUsername = readSavedUsername();
  const [activeTab, setActiveTab] = useState<LoginTab>(
    initialSavedUsername ? 'login' : 'token',
  );
  const [accessToken, setAccessToken] = useState('');
  const [username, setUsername] = useState(initialSavedUsername);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [tokenLockedNotice, setTokenLockedNotice] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const effectiveRemember = activeTab === 'register' ? true : rememberMe;
      let endpoint = '/api/auth/token-login';
      let body: Record<string, string | boolean> = { accessToken, rememberMe: effectiveRemember };

      if (activeTab === 'register') {
        endpoint = '/api/auth/register';
        body = { username, password, accessToken, rememberMe: true };
      } else if (activeTab === 'login') {
        endpoint = '/api/auth/login';
        body = { username, password, rememberMe };
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'upsite-app',
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Authentication failed.');
      }

      try {
        if (effectiveRemember && (activeTab === 'register' || activeTab === 'login') && username.trim()) {
          window.localStorage.setItem(LAST_USERNAME_KEY, username.trim());
        } else if (!effectiveRemember) {
          window.localStorage.removeItem(LAST_USERNAME_KEY);
        }
      } catch {
        // Ignore storage quota errors
      }

      onAuthenticated({
        sessionToken: data.sessionToken,
        rememberMe: effectiveRemember,
        user: data.user,
        workspace: data.workspace,
      });
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Unable to verify credentials.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-slate-100 dark:bg-[#0F111A] text-slate-900 dark:text-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#151824] p-7 sm:p-8 space-y-6">
        {/* Brand Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-white/[0.06] border border-slate-200 dark:border-white/[0.08] flex items-center justify-center text-slate-900 dark:text-slate-100 shrink-0">
              <Activity className="w-4 h-4" strokeWidth={1.8} />
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                upsite
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Local Access Portal
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setTokenLockedNotice(true)}
            aria-disabled="true"
            title="Token issuance is currently locked"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 dark:bg-white/[0.05] text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-white/[0.08] cursor-not-allowed whitespace-nowrap shrink-0"
          >
            <Lock className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
            <span>Get Token</span>
          </button>
        </div>

        {tokenLockedNotice && (
          <div className="rounded-lg border border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-[#10121C] px-4 py-2.5 text-xs text-slate-600 dark:text-slate-300 flex items-center gap-2">
            <Lock className="w-3.5 h-3.5 shrink-0 text-slate-400" strokeWidth={1.75} />
            <span>
              Token generation is locked for now. Enter an existing 10-character access token below.
            </span>
          </div>
        )}

        {/* Mode Switcher */}
        <div
          role="tablist"
          aria-label="Login mode"
          className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#10121C] border border-slate-200 dark:border-white/[0.07]"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'token'}
            onClick={() => {
              setActiveTab('token');
              setErrorMessage(null);
            }}
            className={`px-3 py-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
              activeTab === 'token'
                ? 'bg-white dark:bg-white/[0.1] text-slate-900 dark:text-white'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Use Token
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'register'}
            onClick={() => {
              setActiveTab('register');
              setErrorMessage(null);
            }}
            className={`px-3 py-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
              activeTab === 'register'
                ? 'bg-white dark:bg-white/[0.1] text-slate-900 dark:text-white'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Create Account
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'login'}
            onClick={() => {
              setActiveTab('login');
              setErrorMessage(null);
            }}
            className={`px-3 py-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
              activeTab === 'login'
                ? 'bg-white dark:bg-white/[0.1] text-slate-900 dark:text-white'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Sign In
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {(activeTab === 'token' || activeTab === 'register') && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="access-token-input"
                  className="text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  10-Character Access Token
                </label>
                <span className="text-xs font-mono tabular-nums text-slate-400">
                  {accessToken.trim().length}/10
                </span>
              </div>
              <input
                id="access-token-input"
                name="accessToken"
                type="text"
                maxLength={10}
                required
                autoComplete="off"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder="Enter 10-char mixed token"
                className="w-full rounded-lg bg-slate-50 dark:bg-[#10121C] border border-slate-300 dark:border-white/[0.08] px-3.5 py-2.5 text-sm font-mono text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-rose-500"
              />
            </div>
          )}

          {(activeTab === 'register' || activeTab === 'login') && (
            <>
              <div className="space-y-1.5">
                <label
                  htmlFor="username-input"
                  className="text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Username
                </label>
                <input
                  id="username-input"
                  name="username"
                  type="text"
                  required
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter username"
                  className="w-full rounded-lg bg-slate-50 dark:bg-[#10121C] border border-slate-300 dark:border-white/[0.08] px-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-rose-500"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="password-input"
                  className="text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password-input"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    autoComplete={activeTab === 'register' ? 'new-password' : 'current-password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={activeTab === 'register' ? 'Minimum 6 characters' : 'Enter password'}
                    className="w-full rounded-lg bg-slate-50 dark:bg-[#10121C] border border-slate-300 dark:border-white/[0.08] pl-3.5 pr-10 py-2.5 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-rose-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    title={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" strokeWidth={1.75} />
                    ) : (
                      <Eye className="w-4 h-4" strokeWidth={1.75} />
                    )}
                  </button>
                </div>
              </div>
            </>
          )}

          <label
            htmlFor="remember-me-checkbox"
            className="flex items-center justify-between gap-3 pt-0.5 cursor-pointer select-none"
          >
            <span className="flex items-center gap-2.5 text-xs text-slate-700 dark:text-slate-300">
              <input
                id="remember-me-checkbox"
                name="rememberMe"
                type="checkbox"
                checked={activeTab === 'register' ? true : rememberMe}
                disabled={activeTab === 'register'}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 dark:border-white/[0.2] bg-slate-50 dark:bg-[#10121C] text-rose-600 focus:ring-rose-500 accent-rose-600 cursor-pointer disabled:opacity-80"
              />
              <span className="font-medium">Remember me</span>
            </span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              {activeTab === 'register'
                ? 'Auto signed in until Sign Out'
                : 'Keep signed in'}
            </span>
          </label>

          {errorMessage && (
            <div
              role="alert"
              className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-700 dark:text-rose-300"
            >
              {errorMessage}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-rose-600 hover:bg-rose-500 text-white transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
          >
            {isSubmitting ? (
              <Loader2 className="w-4 h-4 animate-spin shrink-0" strokeWidth={2} />
            ) : activeTab === 'register' ? (
              <UserPlus className="w-4 h-4 shrink-0" strokeWidth={1.75} />
            ) : activeTab === 'token' ? (
              <KeyRound className="w-4 h-4 shrink-0" strokeWidth={1.75} />
            ) : (
              <ArrowRight className="w-4 h-4 shrink-0" strokeWidth={1.75} />
            )}
            <span>
              {isSubmitting
                ? 'Verifying...'
                : activeTab === 'register'
                  ? 'Create & Save Account'
                  : activeTab === 'token'
                    ? 'Unlock with Token'
                    : 'Sign In'}
            </span>
          </button>
        </form>

        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed pt-2 border-t border-slate-200 dark:border-white/[0.06]">
          {activeTab === 'token'
            ? 'Access requires a valid 10-character token. Switch to Create Account to set up a personal username and password to save your workspace.'
            : activeTab === 'register'
              ? 'Any valid 10-character token lets you create an account. Your credentials, organisations, history, and settings are saved locally.'
              : 'Sign in with your saved account credentials to restore your organisations and check history.'}
        </p>
      </div>
    </div>
  );
}
