import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { cartError } from '../api/cart';
import { actionClass, secondaryClass } from './cart/CommerceLayout';

export default function RequireSignIn({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();
  if (auth.isLoggedIn) {return <>{children}</>;}
  return <section className="pt-28 pb-16 px-4 max-w-3xl mx-auto dark:text-light">
    {auth.loading ? <p role="status">Checking your session…</p> : auth.error ? <div role="alert">
      <p>{cartError(auth.error)}</p><button className={`${secondaryClass} mt-4`} onClick={() => void auth.refresh()}>Retry sign-in status</button>
    </div> : <>
      <h1 className="text-3xl font-bold mb-4">Sign in to view your orders</h1>
      <p className="mb-6">Your order details are only available in your account.</p>
      <Link to={`/login?returnTo=${encodeURIComponent(location.pathname)}`} className={actionClass}>Sign in</Link>
    </>}
  </section>;
}
