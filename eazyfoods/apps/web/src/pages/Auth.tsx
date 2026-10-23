import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { ErrorBox } from '../components';

export function AuthPage({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setBusy(true); setError(undefined);
    try {
      await api(`/auth/${mode}`, { method: 'POST', json: f });
      onDone(); nav('/');
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <form className="auth" onSubmit={submit}>
      <h1>{mode === 'login' ? 'Sign in' : 'Create your account'}</h1>
      {error && <ErrorBox message={error} />}
      {mode === 'register' && <label>Full name<input name="full_name" required autoComplete="name" /></label>}
      <label>Email<input name="email" type="email" required autoComplete="email" /></label>
      <label>Password<input name="password" type="password" required minLength={10} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
        {mode === 'register' && <span className="small muted">At least 10 characters.</span>}</label>
      <button type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
      <button type="button" className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
        {mode === 'login' ? 'New here? Create an account' : 'Have an account? Sign in'}
      </button>
    </form>
  );
}
