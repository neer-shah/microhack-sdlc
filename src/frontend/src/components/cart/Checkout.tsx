import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useMutation, useQuery } from 'react-query';
import { api } from '../../api/config';
import { type Cart, type CheckoutReceipt, type CheckoutRequest, type DeliveryDetails, cartError, cartUrl } from '../../api/cart';
import { useCart } from '../../context/CartContext';
import { CommerceLayout, OrderSummary, actionClass, inputClass, secondaryClass } from './CommerceLayout';

interface Branch { branchId: number; name: string }
const initialDelivery: DeliveryDetails = { name: '', email: '', address: '', city: '', postalCode: '', country: '' };
const labels: Record<keyof DeliveryDetails, string> = {
  name: 'Full name', email: 'Email', address: 'Street address', city: 'City', postalCode: 'Postal code', country: 'Country',
};
const autocomplete: Record<keyof DeliveryDetails, string> = {
  name: 'name', email: 'email', address: 'street-address', city: 'address-level2', postalCode: 'postal-code', country: 'country-name',
};

export default function Checkout() {
  const { cart, loading, busy, error, notifyChanged } = useCart();
  const [delivery, setDelivery] = useState(initialDelivery);
  const [branchId, setBranchId] = useState('');
  const [review, setReview] = useState<{ cart: Cart; request: CheckoutRequest } | null>(null);
  const navigate = useNavigate();
  const branches = useQuery('checkout-branches', async () => {
    const { data } = await axios.get<Branch[]>(`${api.baseURL}${api.endpoints.branches}`);
    return data;
  });
  const checkout = useMutation(async () => {
    if (!review) {throw new Error('Review your order before placing it.');}
    const { data } = await axios.post<CheckoutReceipt>(`${cartUrl(review.cart.cartId)}/checkout`, review.request);
    return data;
  }, {
    retry: false,
    onSuccess: (receipt) => {
      notifyChanged();
      navigate(`/checkout/confirmation/${receipt.cartId}/${receipt.checkoutId}`, { replace: true });
    },
    onError: () => { notifyChanged(); },
  });
  const changed = !!review && !!cart && (review.cart.version !== cart.version || review.cart.totalCents !== cart.totalCents);
  const startReview = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!cart || !cart.items.length) {
      return;
    }
    checkout.reset();
    setReview({
      cart,
      request: {
        checkoutId: crypto.randomUUID(), branchId: Number(branchId), delivery,
        expectedVersion: cart.version, expectedTotalCents: cart.totalCents,
      },
    });
  };

  if (loading) {return <CommerceLayout title="Checkout" step={1}><p role="status">Loading your cart…</p></CommerceLayout>;}
  const summary = review?.cart ?? cart;
  if (!summary || (!review && !summary.items.length)) {return (
    <CommerceLayout title="Checkout" step={1}>
      <p className="mb-6">{error ? 'Your cart is unavailable. Use Retry cart to reconnect.' : 'Your cart is empty. Add products before checking out.'}</p>
      <Link to="/products" className={actionClass}>Browse products</Link>
    </CommerceLayout>
  );}
  return (
    <CommerceLayout title={review ? 'Review your order' : 'Where should it go?'} step={review ? 2 : 1}>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div>
          {!!checkout.error && <p role="alert" className="border border-red-400 rounded-lg p-4 mb-6">{cartError(checkout.error)}</p>}
          {changed && <p role="alert" className="border border-primary rounded-lg p-4 mb-6">Your cart or its prices changed in another tab. Return to delivery details and review the latest cart before ordering.</p>}
          {review ? (
            <section aria-label="Delivery review" className="space-y-6">
              <div className="border-l-4 border-primary pl-5">
                <h2 className="text-xl font-bold mb-3">Delivery details</h2>
                <address className="not-italic space-y-1">
                  <p>{review.request.delivery.name}</p>
                  <p>{review.request.delivery.address}</p>
                  <p>{review.request.delivery.city}, {review.request.delivery.postalCode}</p>
                  <p>{review.request.delivery.country}</p>
                  <p>{review.request.delivery.email}</p>
                </address>
                <p className="mt-4"><strong>Ordering branch:</strong> {branches.data?.find((branch) => branch.branchId === review.request.branchId)?.name}</p>
              </div>
              <p>Placing this order saves it as pending. This demo does not collect payment or send a confirmation email.</p>
              <button className={secondaryClass} disabled={checkout.isLoading} onClick={() => { setReview(null); checkout.reset(); }}>Edit delivery / review latest cart</button>
            </section>
          ) : (
            <form id="delivery-form" onSubmit={startReview} className="space-y-5">
              <h2 className="text-xl font-bold">Delivery details</h2>
              <div className="grid sm:grid-cols-2 gap-5">
                {(Object.keys(labels) as (keyof DeliveryDetails)[]).map((field) => (
                  <label key={field} className={`block text-sm font-medium ${field === 'address' ? 'sm:col-span-2' : ''}`}>
                    {labels[field]}
                    <input name={field} value={delivery[field]} type={field === 'email' ? 'email' : 'text'} autoComplete={autocomplete[field]} required maxLength={field === 'address' ? 500 : field === 'email' ? 254 : field === 'postalCode' ? 32 : 120} pattern={field === 'email' ? undefined : '.*\\S.*'} onChange={(event) => setDelivery({ ...delivery, [field]: event.target.value })} className={inputClass} />
                  </label>
                ))}
              </div>
              <label className="block text-sm font-medium">
                Ordering branch
                <select required value={branchId} onChange={(event) => setBranchId(event.target.value)} className={`${inputClass} dark:bg-gray-900`} disabled={branches.isLoading || !!branches.error}>
                  <option value="">{branches.isLoading ? 'Loading branches…' : 'Choose a branch'}</option>
                  {branches.data?.map((branch) => <option key={branch.branchId} value={branch.branchId}>{branch.name}</option>)}
                </select>
              </label>
              {branches.error ? <div role="alert"><p>{cartError(branches.error)}</p><button type="button" className={secondaryClass} onClick={() => void branches.refetch()}>Retry branches</button></div> : null}
              {branches.data?.length === 0 && <p role="alert">No ordering branches are available. Contact your administrator before ordering.</p>}
            </form>
          )}
        </div>
        <OrderSummary items={summary.items} totalCents={summary.totalCents}>
          {review ? (
            <button type="button" className={`${actionClass} w-full mt-6`} disabled={checkout.isLoading || busy || (changed && !checkout.error) || !!error} onClick={() => checkout.mutate()}>
              {checkout.isLoading ? 'Placing order…' : checkout.error ? 'Retry / check order' : 'Place order'}
            </button>
          ) : (
            <button form="delivery-form" type="submit" className={`${actionClass} w-full mt-6`} disabled={busy || !!error || branches.isLoading || !!branches.error || !branches.data?.length}>Review order</button>
          )}
          <Link to="/cart" className="block text-center underline mt-4">Return to cart</Link>
        </OrderSummary>
      </div>
    </CommerceLayout>
  );
}
