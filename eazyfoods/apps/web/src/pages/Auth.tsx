import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { post } from '../api';
import { useAuth } from '../auth';
import { useAction } from '../hooks';
import { Button, ErrorBox, Field, Input, Loading, Notice } from '../ui';

const safeNext = (n: string | null) => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/');
const values = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); return Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>; };

export function SignIn() {
  const [sp] = useSearchParams(); const nav = useNavigate(); const { reload } = useAuth();
  const next = safeNext(sp.get('next'));
  const go = useAction(async (e: FormEvent<HTMLFormElement>) => { await post('/auth/login', values(e)); await reload(); nav(next); });
  return (
    <form className="auth" onSubmit={go.run}>
      <h1>Sign in</h1>
      {go.error && <ErrorBox message={go.error} />}
      <Field label="Email"><Input name="email" type="email" required autoComplete="email" /></Field>
      <Field label="Password"><Input name="password" type="password" required autoComplete="current-password" /></Field>
      <Button type="submit" size="lg" busy={go.busy}>Sign in</Button>
      <p className="center"><Link to="/forgot">Forgot your password?</Link></p>
      <p className="center">New here? <Link to={`/register?next=${encodeURIComponent(next)}`}>Create an account</Link></p>
    </form>
  );
}

export function Register() {
  const [sp] = useSearchParams(); const nav = useNavigate(); const { reload } = useAuth();
  const go = useAction(async (e: FormEvent<HTMLFormElement>) => {
    const f = values(e);
    await post('/auth/register', { email: f.email, password: f.password, full_name: f.full_name });
    if (f.marketing) await fetch('/api/account/profile', { method: 'PUT', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ full_name: f.full_name, phone: null, notify_email: true, marketing_opt_in: true }) });
    await reload(); nav(safeNext(sp.get('next')));
  });
  return (
    <form className="auth" onSubmit={go.run}>
      <h1>Create your account</h1>
      {go.error && <ErrorBox message={go.error} />}
      <Field label="Full name"><Input name="full_name" required autoComplete="name" /></Field>
      <Field label="Email"><Input name="email" type="email" required autoComplete="email" /></Field>
      <Field label="Password" hint="At least 10 characters."><Input name="password" type="password" required minLength={10} autoComplete="new-password" /></Field>
      <label className="check"><input type="checkbox" name="marketing" value="1" /> Email me offers and new-store news (optional; you can stop any time)</label>
      <Button type="submit" size="lg" busy={go.busy}>Create account</Button>
      <p className="small muted">By creating an account you agree to our <Link to="/pages/terms">terms</Link> and <Link to="/pages/privacy">privacy policy</Link>.</p>
      <p className="center">Already have an account? <Link to="/signin">Sign in</Link></p>
    </form>
  );
}

export function Forgot() {
  const [sent, setSent] = useState(false);
  const go = useAction(async (e: FormEvent<HTMLFormElement>) => { await post('/auth/forgot', values(e)); setSent(true); });
  if (sent) return <div className="auth"><h1>Check your email</h1><Notice tone="ok">If that email has an account, we have sent a link to reset your password. It works for one hour.</Notice></div>;
  return (
    <form className="auth" onSubmit={go.run}>
      <h1>Reset your password</h1>
      {go.error && <ErrorBox message={go.error} />}
      <Field label="Email"><Input name="email" type="email" required autoComplete="email" /></Field>
      <Button type="submit" size="lg" busy={go.busy}>Send reset link</Button>
    </form>
  );
}

export function Reset() {
  const [sp] = useSearchParams(); const nav = useNavigate();
  const go = useAction(async (e: FormEvent<HTMLFormElement>) => { await post('/auth/reset', { token: sp.get('token'), password: values(e).password }); nav('/signin?reset=1'); });
  return (
    <form className="auth" onSubmit={go.run}>
      <h1>Choose a new password</h1>
      {go.error && <ErrorBox message={go.error} />}
      <Field label="New password" hint="At least 10 characters."><Input name="password" type="password" required minLength={10} autoComplete="new-password" /></Field>
      <Button type="submit" size="lg" busy={go.busy}>Save password</Button>
    </form>
  );
}

export function Verify() {
  const [sp] = useSearchParams(); const [state, setState] = useState<'busy' | 'ok' | string>('busy');
  useEffect(() => { post('/auth/verify', { token: sp.get('token') }).then(() => setState('ok'), (e) => setState(e.message)); }, [sp]);
  return <div className="auth"><h1>Email confirmation</h1>{state === 'busy' ? <Loading /> : state === 'ok' ? <Notice tone="ok">Thanks, your email is confirmed. <Link to="/">Continue shopping</Link></Notice> : <ErrorBox message={state} />}</div>;
}
