import axios from 'axios';
import { api } from './config';

export const http = axios.create({ baseURL: api.baseURL, withCredentials: true });
export const guestCartKey = 'octocat-cart-id';
export const authChangedKey = 'octocat-auth-changed';
export const checkoutDraftKey = 'octocat-checkout-draft';

export interface Customer {
  userId: number;
  name: string;
  email: string;
  role: 'customer' | 'admin';
}
export interface AuthSession { user: Customer; cartId: string }

export function guestCartId(): string {
  let id = localStorage.getItem(guestCartKey);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(guestCartKey, id);
  }
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('The saved guest cart ID is invalid. Clear this site’s cart storage and reload.');
  }
  return id;
}

export function safeReturnPath(value: string | null): string {
  return value?.startsWith('/') && !value.startsWith('//') && !value.includes('\\') ? value : '/';
}
