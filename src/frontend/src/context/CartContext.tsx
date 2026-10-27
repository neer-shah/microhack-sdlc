/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { type Cart, cartError, cartUrl } from '../api/cart';
import { guestCartId, http } from '../api/auth';
import { useAuth } from './AuthContext';

const storageKey = 'octocat-cart-id';
const updateKey = 'octocat-cart-updated';
const uuidPattern = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
type ItemChange = { method: 'post' | 'put' | 'delete'; productId: number; quantity?: number };

interface CartContextValue {
  cart: Cart | undefined;
  loading: boolean;
  busy: boolean;
  error: string | null;
  addItem: (productId: number, quantity: number) => Promise<void>;
  setQuantity: (productId: number, quantity: number) => Promise<void>;
  removeItem: (productId: number) => Promise<void>;
  refresh: () => Promise<void>;
  notifyChanged: () => void;
}

const CartContext = createContext<CartContextValue | undefined>(undefined);

export function CartProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const [identity, setIdentity] = useState<{ id: string | null; error: string | null }>(() => {
    try {
      let id = localStorage.getItem(storageKey);
      if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem(storageKey, id);
      }
      if (!uuidPattern.test(id)) {
        throw new Error('The saved cart ID is invalid. Clear this site’s cart storage and reload.');
      }
      return { id, error: null };
    } catch (error) {
      return { id: null, error: cartError(error) };
    }
  });
  const [syncError, setSyncError] = useState<string | null>(null);
  useEffect(() => {
    if (!auth.session && !auth.loading) {
      try { setIdentity({ id: guestCartId(), error: null }); }
      catch (error) { setIdentity({ id: null, error: cartError(error) }); }
    }
  }, [auth.session, auth.loading]);
  const client = useQueryClient();
  const cartId = auth.session?.cartId ?? identity.id;
  const key = ['cart', cartId];
  const query = useQuery<Cart>(key, async () => {
    if (!cartId) {
      throw new Error(identity.error ?? 'Cart storage is unavailable');
    }
    const { data } = await http.get<Cart>(cartUrl(cartId));
    return data;
  }, { enabled: !!cartId && !auth.loading && !auth.error, refetchOnWindowFocus: true, refetchInterval: 15000, retry: 1 });

  const notifyChanged = () => {
    try {
      localStorage.setItem(updateKey, crypto.randomUUID());
    } catch (error) {
      setSyncError(`Cart saved, but tab synchronization failed: ${cartError(error)}`);
    }
    void client.invalidateQueries(['cart', cartId]);
  };

  useEffect(() => {
    const synchronize = (event: StorageEvent) => {
      if (event.key === storageKey && event.newValue) {
        try {
          const id = localStorage.getItem(storageKey);
          if (!id || !uuidPattern.test(id)) {
            throw new Error('The saved cart ID is invalid or missing. Clear this site’s cart storage and reload.');
          }
          setIdentity({ id, error: null });
        } catch (error) {
          setIdentity({ id: null, error: cartError(error) });
        }
      }
      if (event.key === updateKey || event.key === null) {
        void client.invalidateQueries(['cart', cartId]);
      }
    };
    window.addEventListener('storage', synchronize);
    return () => window.removeEventListener('storage', synchronize);
  }, [client, cartId]);

  const mutation = useMutation(async (change: ItemChange) => {
    if (!cartId || auth.loading || auth.error) {throw new Error(identity.error ?? 'Your session or cart is unavailable. Try again.');}
    const url = `${cartUrl(cartId)}/items`;
    const response = change.method === 'post'
      ? await http.post<Cart>(url, { productId: change.productId, quantity: change.quantity })
      : change.method === 'put'
        ? await http.put<Cart>(`${url}/${change.productId}`, { quantity: change.quantity })
        : await http.delete<Cart>(`${url}/${change.productId}`);
    return response.data;
  }, {
    onMutate: () => client.cancelQueries(['cart', cartId]),
    onSuccess: (cart) => {
      client.setQueryData(['cart', cartId], cart);
      notifyChanged();
    },
    onError: () => { void client.invalidateQueries(['cart', cartId]); },
  });
  const change = async (value: ItemChange) => { await mutation.mutateAsync(value); };

  return (
    <CartContext.Provider value={{
      cart: query.data, loading: auth.loading || query.isLoading, busy: mutation.isLoading,
      error: (auth.error ? cartError(auth.error) : null) ?? identity.error ?? syncError ?? (mutation.error ? cartError(mutation.error) : query.error ? cartError(query.error) : null),
      addItem: (productId, quantity) => change({ method: 'post', productId, quantity }),
      setQuantity: (productId, quantity) => change({ method: 'put', productId, quantity }),
      removeItem: (productId) => change({ method: 'delete', productId }),
      refresh: async () => { mutation.reset(); setSyncError(null); await auth.refresh(); await query.refetch(); },
      notifyChanged,
    }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) {throw new Error('useCart must be used within a CartProvider');}
  return context;
}

export function CartFeedback() {
  const { error, refresh } = useCart();
  if (!error) {return null;}
  return (
    <div role="alert" className="fixed bottom-4 left-4 right-4 sm:left-auto sm:max-w-md z-50 rounded-lg border border-red-300 bg-red-50 text-red-900 p-4 shadow-lg">
      <p>{error}</p>
      <button type="button" onClick={() => void refresh()} className="mt-2 underline font-semibold focus-visible:outline focus-visible:outline-2">Retry cart</button>
    </div>
  );
}
