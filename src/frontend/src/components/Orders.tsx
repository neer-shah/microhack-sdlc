import { Link } from 'react-router-dom';
import { useQuery } from 'react-query';
import { http } from '../api/auth';
import { type CheckoutReceipt, cartError, money } from '../api/cart';
import { useAuth } from '../context/AuthContext';
import { actionClass, secondaryClass } from './cart/CommerceLayout';

export default function Orders() {
  const { session } = useAuth();
  const orders = useQuery(['my-orders', session?.user.userId], async () =>
    (await http.get<CheckoutReceipt[]>('/api/me/orders')).data, { enabled: !!session, retry: 1 });
  return <section className="pt-28 pb-16 px-4 max-w-6xl mx-auto dark:text-light">
    <p className="font-mono text-xs uppercase tracking-widest mb-3">OctoCAT / Your account</p>
    <h1 className="text-4xl font-bold mb-4">My orders</h1>
    <p className="mb-8">Your latest 100 orders, with the original prices and delivery details.</p>
    {orders.isLoading && <p role="status">Loading your orders…</p>}
    {orders.error ? <div role="alert"><p>{cartError(orders.error)}</p><button className={`${secondaryClass} mt-4`} onClick={() => void orders.refetch()}>Retry orders</button></div> : null}
    {orders.data?.length === 0 && <div className="rounded-xl border border-dashed border-gray-500 p-8">
      <h2 className="text-xl font-bold mb-3">No orders yet</h2><p className="mb-5">Your completed checkouts will appear here.</p>
      <Link to="/products" className={actionClass}>Browse products</Link>
    </div>}
    <ul className="divide-y divide-gray-500">
      {orders.data?.map((order) => <li key={order.orderId} className="py-6 flex flex-wrap items-center justify-between gap-5">
        <div>
          <h2 className="text-xl font-bold">Order #{order.orderId}</h2>
          <p className="text-sm mt-1">{new Date(order.placedAt).toLocaleString()} · {order.itemCount} items</p>
          <p className="mt-2">{order.items.map((item) => `${item.name} × ${item.quantity}`).join(', ')}</p>
        </div>
        <div className="flex items-center gap-5">
          <span className="font-mono font-bold">{money(order.totalCents)}</span>
          <Link className={secondaryClass} to={`/checkout/confirmation/${order.cartId}/${order.checkoutId}`}>View order</Link>
        </div>
      </li>)}
    </ul>
  </section>;
}
