import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { cartError } from '../api/cart';
import { safeReturnPath } from '../api/auth';
import { actionClass, inputClass } from './cart/CommerceLayout';

export default function Login({ register = false }: { register?: boolean }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const auth = useAuth();
  const { darkMode } = useTheme();
  const [params] = useSearchParams();
  const returnTo = safeReturnPath(params.get('returnTo'));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(''); setBusy(true);
    try {
      if (register) {await auth.register(name, email, password);}
      else {await auth.login(email, password);}
      navigate(returnTo, { replace: true });
    } catch (error) { setError(cartError(error)); }
    finally { setBusy(false); }
  };
  if (auth.loading) {return <p role="status" className="pt-24 px-4">Checking your session…</p>;}
  if (auth.isLoggedIn) {return <Navigate to={returnTo} replace />;}
  return (
    <section className={`min-h-[80vh] pt-28 pb-16 px-4 ${darkMode ? 'bg-dark text-light' : 'bg-gray-100 text-gray-800'}`}>
      <div className={`max-w-md mx-auto rounded-xl border border-gray-500 p-6 sm:p-8 ${darkMode ? 'bg-gray-900' : 'bg-white'}`}>
        <p className="font-mono text-xs uppercase tracking-widest mb-3">OctoCAT / Your account</p>
        <h1 className="text-3xl font-bold mb-3">{register ? 'Create your account' : 'Sign in'}</h1>
        <p className="text-sm mb-6">Save your cart across devices and find your previous orders.</p>
        {error && <p role="alert" className="border border-red-400 rounded-lg p-3 mb-4">{error}</p>}
        <form onSubmit={submit} className="space-y-5">
          {register && <label className="block text-sm font-medium">Name<input required autoComplete="name" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} className={inputClass} /></label>}
          <label className="block text-sm font-medium">Email address<input required type="email" autoComplete="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} className={inputClass} /></label>
          <label className="block text-sm font-medium">Password<input required type="password" autoComplete={register ? 'new-password' : 'current-password'} minLength={12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} className={inputClass} /></label>
          <p className="text-xs opacity-80">Use 12–128 characters. Email verification and password reset are not available yet.</p>
          <button type="submit" className={`${actionClass} w-full`} disabled={busy}>{busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'}</button>
        </form>
        <p className="mt-6 text-sm">{register ? 'Already registered? ' : 'New to OctoCAT? '}<Link to={`${register ? '/login' : '/register'}?returnTo=${encodeURIComponent(returnTo)}`} className="underline">{register ? 'Sign in' : 'Create an account'}</Link></p>
        <Link to="/cart" className="block text-sm underline mt-4">Return to cart</Link>
      </div>
    </section>
  );
}
