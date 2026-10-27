import axios from 'axios';
import { api } from './config';

export interface CartItem {
  productId: number;
  name: string;
  imgName: string | null;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

export interface Cart {
  cartId: string;
  version: number;
  items: CartItem[];
  totalCents: number;
  itemCount: number;
}

export interface DeliveryDetails {
  name: string;
  email: string;
  address: string;
  city: string;
  postalCode: string;
  country: string;
}

export interface CheckoutRequest {
  checkoutId: string;
  expectedVersion: number;
  expectedTotalCents: number;
  branchId: number;
  delivery: DeliveryDetails;
}

export interface CheckoutReceipt {
  checkoutId: string;
  cartId: string;
  orderId: number;
  placedAt: string;
  delivery: DeliveryDetails;
  items: CartItem[];
  totalCents: number;
  itemCount: number;
}

export const cartUrl = (cartId: string) => `${api.baseURL}${api.endpoints.carts}/${encodeURIComponent(cartId)}`;

export const money = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

export function cartError(error: unknown): string {
  if (axios.isAxiosError<{ error?: { message?: string }; detail?: unknown }>(error)) {
    if (error.response?.data?.error?.message) {return error.response.data.error.message;}
    if (error.response?.status === 422) {return 'Check the delivery details and quantities, then try again.';}
    if (!error.response) {return 'Cannot reach the cart service. Check your connection and try again.';}
  }
  return error instanceof Error ? error.message : 'The cart could not be updated. Please try again.';
}
