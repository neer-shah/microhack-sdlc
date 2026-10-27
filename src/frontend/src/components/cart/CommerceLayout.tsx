import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../../context/ThemeContext';
import { type CartItem, money } from '../../api/cart';

export const actionClass = 'inline-flex justify-center items-center rounded-lg bg-primary px-5 py-3 font-semibold text-gray-900 hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
export const secondaryClass = 'inline-flex justify-center rounded-lg border border-gray-500 px-4 py-2 font-medium hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50';
export const inputClass = 'mt-1 w-full rounded-lg border border-gray-400 bg-transparent px-3 py-3 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary';

export function CommerceLayout({ title, step, children }: { title: string; step: number; children: ReactNode }) {
  const { darkMode } = useTheme();
  return (
    <section className={`min-h-[75vh] pt-24 pb-16 px-4 ${darkMode ? 'bg-dark text-light' : 'bg-gray-100 text-gray-800'}`}>
      <div className="max-w-6xl mx-auto">
        <Link to="/products" className="text-sm underline underline-offset-4 focus-visible:outline focus-visible:outline-primary">Back to products</Link>
        <header className="mt-8 mb-8 border-b border-gray-500 pb-6">
          <p className="font-mono text-xs uppercase tracking-[0.2em] mb-3">OctoCAT / Supplies for your sidekick</p>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">{title}</h1>
          <ol aria-label="Checkout progress" className="flex flex-wrap gap-x-6 gap-y-2 mt-6 text-sm">
            {['Cart', 'Delivery', 'Review', 'Confirmed'].map((label, index) => (
              <li key={label} aria-current={index === step ? 'step' : undefined} className={index === step ? 'font-bold border-b-2 border-primary pb-1' : 'opacity-70'}>
                <span className="font-mono mr-2">{index + 1}.</span>{label}
              </li>
            ))}
          </ol>
        </header>
        {children}
      </div>
    </section>
  );
}

export function OrderSummary({ items, totalCents, children }: { items: CartItem[]; totalCents: number; children?: ReactNode }) {
  const { darkMode } = useTheme();
  return (
    <aside aria-label="Order summary" className={`rounded-xl border border-gray-500 p-6 h-fit ${darkMode ? 'bg-gray-900' : 'bg-white'}`}>
      <h2 className="text-xl font-bold mb-5">Your packing list</h2>
      <ul className="divide-y divide-gray-500">
        {items.map((item) => (
          <li key={item.productId} className="flex justify-between gap-4 py-3 text-sm">
            <span>{item.name} <span className="font-mono whitespace-nowrap">× {item.quantity}</span></span>
            <span className="font-mono whitespace-nowrap">{money(item.lineTotalCents)}</span>
          </li>
        ))}
      </ul>
      <div className="flex justify-between gap-4 border-t-2 border-primary pt-5 mt-3 text-xl font-bold">
        <span>Order total</span><span className="font-mono">{money(totalCents)}</span>
      </div>
      <p className="text-sm mt-4 opacity-80">USD. No payment is collected. No shipping or tax charges are added in this demo.</p>
      {children}
    </aside>
  );
}
