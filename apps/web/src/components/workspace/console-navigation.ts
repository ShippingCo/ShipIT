/** Presentation only. Each adapter supplies its authorized links and data. */

export interface ConsoleLink {area:string;to:string;icon:string;label:string;badge?:string|number}

/**
 * One icon and one short label per destination, used by both the demo and the authenticated
 * console so the two can never drift. Every icon appears exactly once: these operators read
 * the picture before the word, so a shared icon makes two destinations look like one.
 */
export const consoleAreas: Record<string,{icon:string;label:string}> = {
  workspace:{icon:'space_dashboard',label:'Dashboard'},
  booking:{icon:'add_circle',label:'New Booking'},
  packages:{icon:'inventory_2',label:'Packages'},
  receipts:{icon:'receipt_long',label:'Receipts'},
  customers:{icon:'group',label:'Customers'},
  lots:{icon:'layers',label:'Bags'},
  routes:{icon:'alt_route',label:'Trips'},
  eway:{icon:'description',label:'E-way bills'},
  pickups:{icon:'pin_drop',label:'Pickups'},
  deliveries:{icon:'local_shipping',label:'Deliveries'},
  custody:{icon:'badge',label:'Who is holding what'},
  'money-receipts':{icon:'payments',label:'Money received'},
  cashbook:{icon:'account_balance_wallet',label:'Cash and expenses'},
  'customer-accounts':{icon:'account_balance',label:'Credit customers'},
  'agent-settlements':{icon:'currency_rupee',label:'Agent settlements'},
  financials:{icon:'approval',label:'Approvals and refunds'},
  reconciliation:{icon:'fact_check',label:'Match bank payments'},
  reports:{icon:'query_stats',label:'Reports'},
  automation:{icon:'forum',label:'Messages'},
  support:{icon:'support_agent',label:'Problems'},
  settings:{icon:'settings',label:'Settings'},
  // Hub screens. Reachable by address, never listed: the sidebar shows their children
  // directly, and listing a hub beside its own children is what pushed the list past the fold.
  delivery:{icon:'local_shipping',label:'Delivery work'},
  money:{icon:'account_balance_wallet',label:'Money'},
};

const present = (area:string,to:string,badge?:string|number):ConsoleLink =>
  ({area,to,badge,...(consoleAreas[area]??{icon:'chevron_right',label:area})});

/** The demo composition's route table. Labels and icons come from the shared presentation. */
export const consoleTasks:readonly ConsoleLink[] = [
  ['workspace','/business'],['booking','/business/booking'],['packages','/business/packages'],
  ['lots','/business/lots'],['routes','/business/routes'],['automation','/business/feed'],
  ['receipts','/business/receipts'],['reports','/business/reports'],['eway','/business/eway'],
  ['settings','/business/settings'],
].map(([area,to])=>present(area!,to!));

/**
 * Every destination sits in exactly one group and is always visible. The previous shell kept
 * twelve of them behind a "More tools" disclosure that then drew a second, nested tree; that
 * disclosure was the single largest source of apparent complexity and it hid half the product.
 */
export const consoleGroups:readonly {label:string;areas:readonly string[]}[] = [
  {label:'Counter',areas:['workspace','packages','receipts','customers']},
  {label:'Dispatch',areas:['lots','routes','eway','pickups','deliveries','custody']},
  {label:'Money',areas:['money-receipts','cashbook','customer-accounts','agent-settlements','financials','reconciliation']},
  {label:'Business',areas:['reports','automation','support','settings']},
];

/** Hub screens stay routable but are never listed beside the children they contain. */
export const consoleHubAreas:readonly string[] = ['delivery','money'];

/** An adapter supplies only the destination and its address; presentation is shared. */
export interface ConsoleDestination {area:string;to:string;badge?:string|number}

/** Keep one order and one presentation without ever adding an unauthorized destination. */
export function consoleLinks(links:readonly ConsoleDestination[]):ConsoleLink[] {
  const ordered = ['booking',...consoleGroups.flatMap(group=>group.areas)];
  const rank = (area:string) => { const at = ordered.indexOf(area); return at === -1 ? ordered.length : at; };
  return links
    .filter(link=>!consoleHubAreas.includes(link.area))
    .map(link=>present(link.area,link.to,link.badge))
    .sort((a,b)=>rank(a.area)-rank(b.area));
}

/** Groups that actually have an authorized destination, in order, plus anything unclassified. */
export function consoleSections(links:readonly ConsoleLink[]) {
  const grouped = consoleGroups.flatMap(group=>{
    const items = group.areas.flatMap(area=>links.filter(link=>link.area===area));
    return items.length?[{label:group.label,links:items}]:[];
  });
  const classified = new Set(consoleGroups.flatMap(group=>group.areas));
  const rest = links.filter(link=>link.area!=='booking'&&!classified.has(link.area));
  return rest.length?[...grouped,{label:'More',links:rest}]:grouped;
}
