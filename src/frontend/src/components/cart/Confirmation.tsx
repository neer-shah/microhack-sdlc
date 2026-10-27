import axios from 'axios';
import { useQuery } from 'react-query';
import { Link, useParams } from 'react-router-dom';
import { type CheckoutReceipt, cartError, cartUrl } from '../../api/cart';
import { CommerceLayout, OrderSummary, actionClass, secondaryClass } from './CommerceLayout';

export default function Confirmation() {
  const { cartId, checkoutId } = useParams();
  const receipt = useQuery(['checkout', cartId, checkoutId], async () => {
    if (!cartId || !checkoutId) {throw new Error('The order confirmation link is incomplete.');}
    const { data } = await axios.get<CheckoutReceipt>(`${cartUrl(cartId)}/checkouts/${encodeURIComponent(checkoutId)}`);
    return data;
  }, { retry: 1 });
  return (
    <CommerceLayout title="Order confirmed" step={3}>
      {receipt.isLoading && <p role="status">Loading your order confirmation…</p>}
      {receipt.error ? <div role="alert"><p>{cartError(receipt.error)}</p><button className={`${secondaryClass} mt-4`} onClick={() => void receipt.refetch()}>Retry confirmation</button></div> : null}
      {receipt.data && (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-6">
            <div className="border-l-4 border-primary pl-6">
              <p className="font-mono text-sm uppercase tracking-widest">Order #{receipt.data.orderId} / Pending</p>
              <h2 className="text-3xl font-bold mt-3">On the list. Ready for the next step.</h2>
              <p className="mt-4">Your order has been saved. No payment was collected and no confirmation email was sent.</p>
              <p className="mt-2 text-sm">Placed {new Date(receipt.data.placedAt).toLocaleString()}</p>
            </div>
            <section aria-label="Delivery address">
              <h3 className="font-bold mb-2">Deliver to</h3>
              <address className="not-italic">
                {receipt.data.delivery.name}<br />
                {receipt.data.delivery.address}<br />
                {receipt.data.delivery.city}, {receipt.data.delivery.postalCode}<br />
                {receipt.data.delivery.country}
              </address>
            </section>
            <Link to="/products" className={actionClass}>Continue shopping</Link>
          </div>
          <OrderSummary items={receipt.data.items} totalCents={receipt.data.totalCents} />
        </div>
      )}
    </CommerceLayout>
  );
}
