import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/* Merges Tailwind classes so a caller's class always wins over a component default.
   Every shadcn / 21st.dev component imported into this project expects this helper. */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
