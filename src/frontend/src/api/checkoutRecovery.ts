import { checkoutDraftKey } from './auth';
import type { Cart, CartItem, CheckoutRequest, DeliveryDetails } from './cart';

export interface CheckoutDraft {
  delivery: DeliveryDetails;
  branchId: string;
  review: { cart: Cart; request: CheckoutRequest } | null;
  submitted: boolean;
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isDelivery = (value: unknown): value is DeliveryDetails => record(value) &&
  ['name', 'email', 'address', 'city', 'postalCode', 'country'].every((field) => typeof value[field] === 'string');
const isItem = (value: unknown): value is CartItem => record(value) && integer(value.productId) &&
  typeof value.name === 'string' && (value.imgName === null || typeof value.imgName === 'string') &&
  integer(value.quantity) && value.quantity > 0 && value.quantity <= 999 && integer(value.unitPriceCents) && integer(value.lineTotalCents);
const isCart = (value: unknown): value is Cart => record(value) && uuid(value.cartId) && integer(value.version) &&
  integer(value.totalCents) && integer(value.itemCount) && Array.isArray(value.items) && value.items.every(isItem);
const isRequest = (value: unknown): value is CheckoutRequest => record(value) && uuid(value.checkoutId) &&
  integer(value.expectedVersion) && integer(value.expectedTotalCents) && integer(value.branchId) && value.branchId > 0 && isDelivery(value.delivery);

export const draftKey = (userId?: number) => `${checkoutDraftKey}:${userId ?? 'guest'}`;

export function readDraft(userId?: number): CheckoutDraft {
  const raw = sessionStorage.getItem(draftKey(userId));
  if (!raw) {return { delivery: { name: '', email: '', address: '', city: '', postalCode: '', country: '' }, branchId: '', review: null, submitted: false };}
  const value: unknown = JSON.parse(raw);
  if (!record(value) || !isDelivery(value.delivery) || typeof value.branchId !== 'string' || typeof value.submitted !== 'boolean') {
    throw new Error('Your saved checkout draft is invalid. Discard it to start again.');
  }
  let review: CheckoutDraft['review'] = null;
  if (value.review !== null) {
    if (!record(value.review) || !isCart(value.review.cart) || !isRequest(value.review.request)) {
      throw new Error('Your saved checkout review is invalid. Discard it to start again.');
    }
    review = { cart: value.review.cart, request: value.review.request };
  }
  return { delivery: value.delivery, branchId: value.branchId, submitted: value.submitted, review };
}

export function saveDraft(userId: number | undefined, draft: CheckoutDraft): void {
  sessionStorage.setItem(draftKey(userId), JSON.stringify(draft));
}

export function adoptGuestDraft(userId: number): void {
  const guest = sessionStorage.getItem(draftKey());
  if (guest && !sessionStorage.getItem(draftKey(userId))) {
    const draft = readDraft();
    saveDraft(userId, { ...draft, review: null, submitted: false });
  }
  sessionStorage.removeItem(draftKey());
}

export function clearCheckoutDrafts(): void {
  for (const key of Object.keys(sessionStorage)) {
    if (key.startsWith(`${checkoutDraftKey}:`)) {sessionStorage.removeItem(key);}
  }
}
