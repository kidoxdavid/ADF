import type { SVGProps } from 'react';

const P = (d: string) => (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={d} /></svg>
);
export const IconHome = P('M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10');
export const IconSearch = P('M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3');
export const IconBasket = P('M3 9h18l-2 11H5L3 9zM8 9l3-6M16 9l-3-6');
export const IconOrders = P('M6 3h12v18l-3-2-3 2-3-2-3 2V3zM9 8h6M9 12h6');
export const IconUser = P('M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 4-6 8-6s8 2 8 6');
export const IconHeart = P('M12 20s-8-5-8-11a4.5 4.5 0 018-2.8A4.5 4.5 0 0120 9c0 6-8 11-8 11z');
export const IconPlus = P('M12 5v14M5 12h14');
export const IconMinus = P('M5 12h14');
export const IconCheck = P('M5 12l5 5L20 7');
export const IconClose = P('M6 6l12 12M18 6L6 18');
export const IconStore = P('M4 9l1-5h14l1 5M4 9v11h16V9M4 9a3 3 0 006 0 3 3 0 006 0 3 3 0 004 0M10 20v-5h4v5');
export const IconTruck = P('M2 6h11v10H2zM13 9h4l3 3v4h-7M6 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM17 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3z');
export const IconChevron = P('M9 6l6 6-6 6');
export const IconBook = P('M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2V5zM4 19a2 2 0 012-2h13');
export const IconMenu = P('M4 7h16M4 12h16M4 17h16');
export const IconAlert = P('M12 4l10 17H2L12 4zM12 10v5M12 18h.01');
export const IconPin = P('M12 21s7-6 7-12a7 7 0 10-14 0c0 6 7 12 7 12zM12 11.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z');
export const IconShield = P('M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3zM9 12l2 2 4-4');
export const IconTag = P('M3 12V4h8l10 10-8 8L3 12zM7.5 8.5h.01');
export const IconStar = P('M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z');
export const IconChevronL = P('M15 6l-6 6 6 6');
export const IconSwap = P('M7 7h12l-3-3M17 17H5l3 3');
