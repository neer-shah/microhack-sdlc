import { useState } from 'react';
import { Link } from 'react-router-dom';
import { money, cartError } from '../../api/cart';
import { useCart } from '../../context/CartContext';
import { useAuth } from '../../context/AuthContext';
import { CommerceLayout, OrderSummary, actionClass, secondaryClass } from './CommerceLayout';

export default function CartPage() {
  const { cart, loading, busy, error, addItem, setQuantity, removeItem } = useCart();
  const [notice, setNotice] = useState('');
  const { isLoggedIn } = useAuth();
  const update = async (operation: Promise<void>, success: string) => {
    try { await operation; setNotice(success); }
    catch (error) { setNotice(cartError(error)); }
  };

  return (
    <CommerceLayout title="Your cart" step={0}>
      <p role="status" className="mb-4">{loading ? 'Loading your cart…' : notice}</p>
      {!loading && cart && !cart.items.length && (
        <div className="rounded-xl border border-dashed border-gray-500 p-10 text-center">
          <h2 className="text-2xl font-bold mb-3">Your cat’s next upgrade starts here.</h2>
          <p className="mb-6">Your cart is empty. Choose a product and add it to your packing list.</p>
          <Link to="/products" className={actionClass}>Browse products</Link>
        </div>
      )}
      {cart && cart.items.length > 0 && (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div>
            <h2 className="text-lg font-semibold mb-4">{cart.itemCount} {cart.itemCount === 1 ? 'item' : 'items'} ready to go</h2>
            <ul className="divide-y divide-gray-500 border-y border-gray-500">
              {cart.items.map((item) => (
                <li key={item.productId} className="py-6 flex gap-4 sm:gap-6">
                  {item.imgName && <img src={`/${item.imgName}`} alt={item.name} width={96} height={96} className="w-20 h-20 sm:w-24 sm:h-24 object-contain rounded-lg bg-white" />}
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold text-lg">{item.name}</h3>
                    <p className="text-sm mt-1">{money(item.unitPriceCents)} each</p>
                    <div className="flex flex-wrap items-center gap-3 mt-4">
                      <div role="group" aria-label={`Quantity for ${item.name}`} className="flex items-center rounded-lg border border-gray-500">
                        <button className="px-3 py-2 focus-visible:outline focus-visible:outline-primary disabled:opacity-40" aria-label={`Decrease quantity of ${item.name}`} disabled={busy || item.quantity <= 1} onClick={() => void update(setQuantity(item.productId, item.quantity - 1), 'Quantity updated.')}>−</button>
                        <span className="px-3 font-mono" aria-label={`Quantity: ${item.quantity}`}>{item.quantity}</span>
                        <button className="px-3 py-2 focus-visible:outline focus-visible:outline-primary disabled:opacity-40" aria-label={`Increase quantity of ${item.name}`} disabled={busy || item.quantity >= 999} onClick={() => void update(addItem(item.productId, 1), 'Quantity updated.')}>+</button>
                      </div>
                      <button className={secondaryClass} disabled={busy} aria-label={`Delete ${item.name}`} onClick={() => void update(removeItem(item.productId), `${item.name} removed.`)}>Delete item</button>
                    </div>
                    <p className="font-mono font-semibold mt-3 sm:text-right">{money(item.lineTotalCents)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <OrderSummary items={cart.items} totalCents={cart.totalCents}>
            {busy || error ? <button className={`${actionClass} w-full mt-6`} disabled>Continue to checkout</button> :
              <Link to="/checkout" className={`${actionClass} w-full mt-6`}>Continue to checkout</Link>}
            <p className="text-xs mt-4 opacity-80">{isLoggedIn ? 'Your cart is saved to your account, across devices.' : 'Your guest cart is saved on this browser. Sign in at checkout to place your order.'}</p>
          </OrderSummary>
        </div>
      )}
    </CommerceLayout>
  );
}
