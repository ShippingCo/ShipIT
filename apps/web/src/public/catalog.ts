/**
 * What the public site is allowed to say, and where each sentence comes from.
 *
 * Nothing here is marketing invention. Every line restates something the project already
 * records, so the website can never promise more than the software does:
 *
 * - The product description is README.md ("Who it is designed for" and the opening
 *   paragraph) and PRODUCT.md (the booking task, receipts and money received).
 * - The three stages reuse the captions the sign-in panel already shows
 *   (operator/AccessLayout.tsx).
 * - The capability list names screens that exist in the operator console today
 *   (pages/business/BusinessShell.tsx).
 *
 * PLANS. ShipIT has no commercial plans, prices, entitlements or payment provider yet.
 * SaaS subscriptions are milestone M8 (#77 plans and entitlements, #78 subscriptions and
 * billing webhooks, both blocked in docs/ISSUE_INDEX.md), and
 * docs/architecture/domain-contract.md says no subscriptions, entitlements or editions
 * exist. So no plan below carries a price, and Franchise carries nothing at all.
 *
 * "Individual" is the one setup path the backend does support: an owner with a verified
 * contact opens one business and its first branch through POST /api/v1/onboarding
 * (docs/architecture/independent-onboarding.md). That request has no payment in it.
 */

export const product = {
  name: 'ShippingCo',
  audience: 'For courier shops in India',
  headline: 'Book a parcel once. ShippingCo keeps your customer updated on WhatsApp.',
  lead: 'Courier counter software for small and mid-size Indian courier businesses. After a parcel is booked, '
    + 'the booking confirmation, dispatch, delay, out-for-delivery and delivery updates go to the customer '
    + 'on WhatsApp automatically, and routine customer questions are answered without anyone at the shop '
    + 'having to reply.',
} as const;

export type Capability = { icon: string; title: string; text: string };

/** Each of these is a working screen in the operator console. */
export const capabilities: readonly Capability[] = [
  { icon: 'inventory_2', title: 'Book at the counter',
    text: 'Choose or create the customer, pick the destination and service, then add each parcel with its own docket number, receiver and address.' },
  { icon: 'sell', title: 'Prices and GST from your rates',
    text: 'The server works out the price and tax from the rates you publish, so the counter never guesses a figure.' },
  { icon: 'forum', title: 'WhatsApp updates for customers',
    text: 'Booking, dispatch, delay, out-for-delivery and delivery messages go out on their own once WhatsApp is connected for your shop.' },
  { icon: 'route', title: 'Lots and routes',
    text: 'Send loads out together and see where each one is, parcel by parcel.' },
  { icon: 'task_alt', title: 'Proof at the door',
    text: 'A delivery is completed with the customer’s code, so a handover is recorded as proof.' },
  { icon: 'receipt_long', title: 'Receipts and money',
    text: 'Print the issued receipt, record money actually received, and keep the cashbook and reports in one place.' },
];

/** The sign-in panel's three stages, in the order the work happens. */
export const stages = [
  { name: 'At the counter', caption: 'Every parcel gets one docket, and the customer gets the number.' },
  { name: 'On the route', caption: 'Loads leave the branch together, and the shop can see where each one is.' },
  { name: 'At the door', caption: 'A handover is recorded as proof, not remembered as a promise.' },
] as const;

export type PlanId = 'individual' | 'franchise';
export type Plan = {
  id: PlanId;
  name: string;
  status: 'available' | 'coming_soon';
  summary: string;
  /** Always null today: no price is configured anywhere in the project. */
  price: null;
  /** What a shop on this plan can use. Empty when the plan is not configured. */
  includes: readonly string[];
};

export const individual: Plan = {
  id: 'individual',
  name: 'Individual',
  status: 'available',
  summary: 'For a courier shop setting up on its own: one business and its first branch.',
  price: null,
  includes: [
    'Counter booking with a docket number for every parcel',
    'Prices and GST worked out from your published rates',
    'Automatic WhatsApp updates once WhatsApp is connected',
    'Lots, routes and delivery proof',
    'Receipts, money received, cashbook and reports',
  ],
};

export const franchise: Plan = {
  id: 'franchise',
  name: 'Franchise',
  status: 'coming_soon',
  summary: 'Not configured in ShippingCo yet.',
  price: null,
  includes: [],
};

export const plans: readonly Plan[] = [individual, franchise];

/** Said wherever a price would be. Kept in one place so every screen says the same thing. */
export const priceNotSet = {
  label: 'Price not set yet',
  detail: 'ShippingCo has not published a price or billing terms for this plan. Setting up your shop takes no payment.',
} as const;
