import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useMutation, useQuery } from 'react-query';
import { api } from '../../api/config';
import { type CheckoutReceipt, type DeliveryDetails, cartError, cartUrl } from '../../api/cart';
import { useCart } from '../../context/CartContext';
import { CommerceLayout, OrderSummary, actionClass, inputClass, secondaryClass } from './CommerceLayout';
import { useAuth } from '../../context/AuthContext';
import { http } from '../../api/auth';
import { draftKey, readDraft, saveDraft, type CheckoutDraft } from '../../api/checkoutRecovery';

interface Branch { branchId: number; name: string }
const initialDelivery: DeliveryDetails = { name: '', email: '', address: '', city: '', postalCode: '', country: '' };
const labels: Record<keyof DeliveryDetails, string> = {
  name: 'Full name', email: 'Email', address: 'Street address', city: 'City', postalCode: 'Postal code', country: 'Country',
};
const autocomplete: Record<keyof DeliveryDetails, string> = {
  name: 'name', email: 'email', address: 'street-address', city: 'address-level2', postalCode: 'postal-code', country: 'country-name',
};

export default function Checkout() {
  const auth = useAuth();
  const userId = auth.session?.user.userId;
  const { cart, loading, busy, error, notifyChanged } = useCart();
  const [restored] = useState(() => {
    try { return { draft: readDraft(userId), error: '' }; }
    catch (error) { return { draft: null, error: cartError(error) }; }
  });
  const [delivery, setDelivery] = useState(restored.draft?.delivery ?? initialDelivery);
  const [branchId, setBranchId] = useState(restored.draft?.branchId ?? '');
  const [review, setReview] = useState<CheckoutDraft['review']>(restored.draft?.review ?? null);
  const [submitted, setSubmitted] = useState(restored.draft?.submitted ?? false);
  const [storageError, setStorageError] = useState(restored.error);
  const navigate = useNavigate();
  useEffect(() => {
    if (auth.loading || storageError) {return;}
    try { saveDraft(userId, { delivery, branchId, review, submitted }); }
    catch (error) { setStorageError(`Checkout recovery is unavailable: ${cartError(error)}`); }
  }, [delivery, branchId, review, submitted, userId, storageError, auth.loading]);
  const confirmed = (receipt: CheckoutReceipt) => {
    sessionStorage.removeItem(draftKey(userId));
    notifyChanged();
    navigate(`/checkout/confirmation/${receipt.cartId}/${receipt.checkoutId}`, { replace: true });
  };
  const recovery = useQuery(['recover-checkout', userId, review?.request.checkoutId], async () => {
    if (!review) {throw new Error('No checkout to recover');}
    try {
      return (await http.get<CheckoutReceipt>(`${cartUrl(review.cart.cartId)}/checkouts/${review.request.checkoutId}`)).data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {return null;}
      throw error;
    }
  }, { enabled: !!auth.session && submitted && !!review, retry: 1, onSuccess: (receipt) => { if (receipt) {confirmed(receipt);} } });
  const branches = useQuery('checkout-branches', async () => {
    const { data } = await http.get<Branch[]>(`${api.baseURL}${api.endpoints.branches}`);
    return data;
  });
  const checkout = useMutation(async () => {
    if (!review) {throw new Error('Review your order before placing it.');}
    if (!auth.session) {throw new Error('Sign in before placing your order.');}
    saveDraft(userId, { delivery, branchId, review, submitted: true });
    setSubmitted(true);
    const { data } = await http.post<CheckoutReceipt>(`${cartUrl(review.cart.cartId)}/checkout`, review.request);
    return data;
  }, {
    retry: false,
    onSuccess: confirmed,
    onError: () => { notifyChanged(); void recovery.refetch(); },
  });
  const changed = !!review && !!cart && (review.cart.version !== cart.version || review.cart.totalCents !== cart.totalCents);
  const startReview = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!cart || !cart.items.length) {
      return;
    }
    saveDraft(userId, { delivery, branchId, review: null, submitted: false });
    if (!auth.session) {
      navigate('/login?returnTo=%2Fcheckout');
      return;
    }
    checkout.reset();
    setSubmitted(false);
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
          {storageError && <div role="alert" className="border border-red-400 rounded-lg p-4 mb-6">
            <p>{storageError}</p><p className="mt-2">Checkout must save a recovery ID before placing an order.</p>
            <button type="button" className={`${secondaryClass} mt-3`} onClick={() => {
              try {
                if (restored.error) { sessionStorage.removeItem(draftKey(userId)); setReview(null); setSubmitted(false); }
                saveDraft(userId, { delivery, branchId, review: restored.error ? null : review, submitted: restored.error ? false : submitted });
                setStorageError('');
              } catch (error) { setStorageError(cartError(error)); }
            }}>{restored.error ? 'Discard invalid draft' : 'Retry saving checkout'}</button>
          </div>}
          {(!!checkout.error || !!recovery.error) && <p role="alert" className="border border-red-400 rounded-lg p-4 mb-6">{cartError(checkout.error ?? recovery.error)}</p>}
          {submitted && recovery.isFetching && <p role="status" className="mb-4">Checking whether your order was already placed…</p>}
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
              <button className={secondaryClass} disabled={checkout.isLoading || (submitted && (recovery.isFetching || recovery.data !== null))} onClick={() => { setReview(null); setSubmitted(false); checkout.reset(); }}>Edit delivery / review latest cart</button>
            </section>
          ) : (
            <form id="delivery-form" onSubmit={(event) => {
              try { startReview(event); } catch (error) { setStorageError(cartError(error)); }
            }} className="space-y-5">
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
            <button type="button" className={`${actionClass} w-full mt-6`} disabled={checkout.isLoading || busy || (changed && !submitted) || !!error || !!storageError || !auth.session || recovery.isFetching} onClick={() => checkout.mutate()}>
              {checkout.isLoading ? 'Placing order…' : submitted ? 'Retry / check order' : 'Place order'}
            </button>
          ) : (
            <button form="delivery-form" type="submit" className={`${actionClass} w-full mt-6`} disabled={busy || !!error || !!storageError || branches.isLoading || !!branches.error || !branches.data?.length}>{auth.session ? 'Review order' : 'Sign in to continue'}</button>
          )}
          {!auth.session && <p className="mt-4 text-sm">You must sign in or register before placing an order. Your delivery draft will be kept in this tab.</p>}
          <Link to="/cart" className="block text-center underline mt-4">Return to cart</Link>
        </OrderSummary>
      </div>
    </CommerceLayout>
  );
}
