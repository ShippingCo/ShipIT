import {describe,it,expect} from 'vitest';
import {input,instant,upload,filter} from '../../src/modules/shipment-costs/validation.ts';
import {contributionRow,contributionTotals,contributionGroups,contributionCsv} from '../../src/modules/shipment-costs/contribution-service.ts';
import {parseEnvironment} from '../../src/env.ts';
import type {ContributionCost,ContributionSnapshot} from '@shippingco/shared';
const id='10000000-0000-0000-0000-000000000001',at='2026-10-12T01:02:03.123456Z';
const body={source_id:null,expected_version:0,category:'courier',state:'actual',amount_paise:6000,effective_at:at,reason:'Synthetic source',reference:'SYN-REF',supplier:'syn supplier',document:'syn invoice',line:'1',expense_id:null,rate_import_id:null,rate_booking_id:null,allocations:[{booking_id:id,parcel_id:null,amount_paise:6000}]};
const cost=(category:ContributionCost['category'],state:ContributionCost['state']='not_applicable'):ContributionCost=>({source_id:id,revision_id:id,version:1,category,state,amount_paise:state==='not_applicable'?'0':'6000',source_amount_paise:state==='not_applicable'?'0':'6000',remainder_paise:'0',effective_at:at,recorded_at:at,expense_root_id:null,expense_head_id:null,expense_effect_id:null,earning_id:null,proof_id:null,reference:'SYN-REF',verification:'recorded_unverified'});
const raw={id,franchise_id:id,confirmed_at:at,customer_id:id,service:'standard',destination:'SYN_DEST',courier:'mixed',booking_command_id:id,financial_change_ids:[],dispatch_command_ids:[],revenue_paise:'10000',costs:[cost('courier','actual'),cost('packing'),cost('agent'),cost('payment')]};
describe('shipment-cost strict domain boundaries',()=>{
 it('preserves microsecond UTC cutoffs and rejects invalid calendar/coercion/mass assignment',()=>{
  expect(instant(at)).toBe(at);expect(instant('2026-10-12T01:02:03Z')).toBe('2026-10-12T01:02:03.000000Z');
  for(const value of ['2026-02-30T00:00:00Z','2026-10-12T24:00:00Z','2026-10-12T01:02:03.1234567Z','2026-10-12T01:02:03+05:30'])expect(()=>instant(value)).toThrow();
  expect(input(body).supplier).toBe('SYN SUPPLIER');for(const bad of [{...body,organization_id:id},{...body,amount_paise:'6000'},{...body,amount_paise:-1},{...body,allocations:[...body.allocations,...body.allocations]},{...body,allocations:[{...body.allocations[0],amount_paise:6001}]},{...body,state:'not_applicable'},{...body,document:null}])expect(()=>input(bad)).toThrow();
 });
 it('requires native rate identity and explicit bounded allocation rules',()=>{
  expect(input({...body,state:'estimated',supplier:null,document:null,line:null,rate_import_id:id,rate_booking_id:id,amount_paise:0,allocations:[{booking_id:id,parcel_id:null,amount_paise:0}]}).amount_paise).toBe(0);
  expect(()=>input({...body,state:'estimated',rate_import_id:id,rate_booking_id:null})).toThrow();expect(()=>filter({from_day:'2026-10-01',to_day:'2026-11-01'},id)).toThrow();
 });
 it('decodes only the labelled bounded native invoice CSV',()=>{
  const source='category,state,amount_paise,effective_at,reason,reference,supplier,document,line,booking_id,parcel_id\ncourier,actual,6000,2026-10-12T01:02:03Z,Synthetic source,SYN-REF,SYN-SUPPLIER,SYN-INVOICE,1,'+id+',\n';
  expect(upload({format:'shipit_cost_csv_v1',content_base64:Buffer.from(source).toString('base64')})).toHaveLength(1);
  expect(()=>upload({format:'supplier_invoice_v1',content_base64:Buffer.from(source).toString('base64')})).toThrow();expect(()=>upload({format:'shipit_cost_csv_v1',content_base64:Buffer.from(source.replace('6000','6e3')).toString('base64')})).toThrow();
 });
 it('missing and partial source allocations never become zero cost, NA cannot erase applicable costs',()=>{
  const row=contributionRow(raw);expect(row.contribution_paise).toBe('4000');expect(row.coverage.packing).toBe('not_applicable');
  expect(contributionRow({...raw,costs:raw.costs.filter(c=>c.category!=='courier')}).contribution_paise).toBeNull();
  expect(contributionRow({...raw,costs:[...raw.costs,cost('courier')]}).contribution_paise).toBe('4000');
  expect(contributionRow({...raw,costs:raw.costs.map(c=>c.category==='courier'?{...c,remainder_paise:'1'}:c)}).state).toBe('incomplete');
  const estimate=contributionRow({...raw,costs:raw.costs.map(c=>c.category==='courier'?{...c,state:'estimated'}:c)});expect(estimate.contribution_paise).toBeNull();expect(estimate.estimated_contribution_paise).toBe('4000');
 });
 it('group totals reconcile once per booking and CSV excludes private reasons while neutralizing formulas',()=>{
  const row=contributionRow({...raw,destination:'=HYPERLINK("bad")'}),totals=contributionTotals([row]),groups=contributionGroups([row]);expect(groups).toHaveLength(5);expect(groups.every(g=>g.revenue_paise===totals.revenue_paise)).toBe(true);
  const snapshot={id,as_of:at,effective_at:at,recorded_at:at,definition:'shipment_contribution_v1'} as ContributionSnapshot,csv=contributionCsv(snapshot,[row]);expect(csv).toContain("'=HYPERLINK");expect(csv).not.toContain('Synthetic source');expect(csv).toContain('mixed');
 });
 it('validates the default-off rollout switch without a demo write path',()=>{
  const base={NODE_ENV:'development',HOST:'127.0.0.1',PORT:'3000',LOG_LEVEL:'info',ALLOWED_ORIGINS:'http://localhost:5173',TRUSTED_PROXY_HOPS:'0',DATABASE_SECRET_REF:'local:database',DATABASE_TLS_MODE:'disable'};
  expect(parseEnvironment(base).shipmentCostWritesEnabled).toBe(false);expect(parseEnvironment({...base,SHIPMENT_COST_WRITES_ENABLED:'true'}).shipmentCostWritesEnabled).toBe(true);expect(()=>parseEnvironment({...base,SHIPMENT_COST_WRITES_ENABLED:'yes'})).toThrow();
 });
});
