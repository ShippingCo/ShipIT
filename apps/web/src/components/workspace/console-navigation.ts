/** Presentation only. Each adapter supplies its authorized links and data. */
export const consoleTasks = [
  {area:'workspace',to:'/business',icon:'space_dashboard',label:'Dashboard'},
  {area:'booking',to:'/business/booking',icon:'add_circle',label:'New Booking'},
  {area:'packages',to:'/business/packages',icon:'inventory_2',label:'Packages'},
  {area:'lots',to:'/business/lots',icon:'layers',label:'Lots'},
  {area:'routes',to:'/business/routes',icon:'alt_route',label:'Dispatch Routes'},
  {area:'automation',to:'/business/feed',icon:'forward_to_inbox',label:'Automation Feed'},
  {area:'receipts',to:'/business/receipts',icon:'receipt_long',label:'Receipts'},
  {area:'reports',to:'/business/reports',icon:'query_stats',label:'Reports'},
  {area:'eway',to:'/business/eway',icon:'local_shipping',label:'E-way Bills'},
  {area:'settings',to:'/business/settings',icon:'settings',label:'Settings'},
] as const;

export interface ConsoleLink {area:string;to:string;icon:string;label:string;badge?:string|number}

/** Keep the reference's names/order without replacing authorized destinations. */
export function consoleLinks(links:readonly ConsoleLink[]):ConsoleLink[] {
  return [
    ...consoleTasks.flatMap(task=>{
      const link=links.find(item=>item.area===task.area);
      return link?[{...link,label:task.label,icon:task.icon}]:[];
    }),
    ...links.filter(link=>!consoleTasks.some(task=>task.area===link.area)),
  ];
}
