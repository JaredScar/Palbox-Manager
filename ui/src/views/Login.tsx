import { useState, FormEvent } from 'react';
import { authApi } from '../api/client';

export function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await authApi.login(username, password);
      onLogin();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const inputCls = 'w-full bg-panel-raised border border-line rounded-lg px-3 py-2.5 text-[13px] text-bone placeholder:text-fog/50 focus:outline-none focus:border-aqua transition-colors';

  return (
    <div className="min-h-screen bg-void flex items-center justify-center p-4">
      <div className="w-full max-w-[340px] bg-panel border border-line rounded-2xl p-8 shadow-2xl">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-8">
          <div className="brand-mark" />
          <div className="leading-tight">
            <div className="text-[17px] font-display font-bold">Palbox</div>
            <div className="text-[11px] text-fog font-mono">palworld ops panel</div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[11.5px] text-fog font-medium uppercase tracking-wider">Username</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
              className={inputCls}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[11.5px] text-fog font-medium uppercase tracking-wider">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className={inputCls}
            />
          </div>

          {error && (
            <div className="text-[12.5px] text-rust bg-rust/10 border border-rust/30 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-1 py-2.5 rounded-lg bg-crimson text-void font-semibold text-[14px] hover:brightness-110 transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading && <span className="btn-spinner" />}
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
