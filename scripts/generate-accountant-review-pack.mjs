import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
// Fictional review fixture only. This is not a production exporter or a qualification claim.
const root=new URL('../docs/fixtures/accountant/gnucash-5.17-candidate-v1/',import.meta.url);
const events=[];
const add=(id,day,kind,splits,correction_of=null)=>events.push({id:'SIT-'+id+'-v1',day:'2026-09-'+day,kind,correction_of,splits:splits.map(([account,paise])=>({account,paise:String(paise)}))});
const pair=(id,day,kind,debit,credit,paise)=>add(id,day,kind,[[debit,paise],[credit,-paise]]);
pair('sale-0001','01','sale','Assets:Customer receivables','Income:Freight',100000);
pair('receipt-0001','02','receipt','Assets:Cash','Liabilities:Customer advances',60000);
pair('allocation-0001','02','allocation','Liabilities:Customer advances','Assets:Customer receivables',60000);
pair('receipt-0002','03','receipt','Assets:UPI clearing','Liabilities:Customer advances',40000);
pair('allocation-0002','03','allocation','Liabilities:Customer advances','Assets:Customer receivables',40000);
pair('advance-0003','04','receipt','Assets:Cash','Liabilities:Customer advances',20000);
pair('sale-0002','05','sale','Assets:Customer receivables','Income:Freight',10000);
pair('receipt-0004','05','receipt','Assets:Cash','Liabilities:Customer advances',210000);
pair('allocation-0004','05','allocation','Liabilities:Customer advances','Assets:Customer receivables',10000);
pair('cod-0001','05','cod_reservation','Liabilities:Customer advances','Liabilities:Seller COD',200000);
add('sale-0003','06','sale',[['Assets:Customer receivables',105000],['Income:Freight',-100000],['Liabilities:CGST',-2500],['Liabilities:SGST',-2500]]);
pair('receipt-0005','06','receipt','Assets:Card clearing','Liabilities:Customer advances',105000);
pair('allocation-0005','06','allocation','Liabilities:Customer advances','Assets:Customer receivables',105000);
pair('expense-0001','07','expense','Expenses:Processor fees','Assets:Card clearing',10000);
pair('transfer-0001','07','actual_transfer','Assets:Bank','Assets:Card clearing',95000);
pair('advance-return-0001','08','advance_return','Liabilities:Customer advances','Assets:Cash',5000);
pair('cod-remittance-0001','09','cod_remittance','Liabilities:Seller COD','Assets:Cash',50000);
pair('agent-advance-0001','10','agent_advance','Assets:Agent advances','Assets:Cash',10000);
add('agent-expense-0001','11','agent_expense',[['Expenses:Agent fees',12000],['Assets:Agent advances',-5000],['Assets:Cash',-3000],['Liabilities:Agent fees payable',-4000]]);
pair('agent-payment-0001','12','agent_payment','Liabilities:Agent fees payable','Assets:Cash',4000);
const correctionStart=events.length;
add('adjustment-0001','20','charge_reduction',[['Income:Freight',10000],['Assets:Customer receivables',-10000]],'SIT-sale-0001-v1');
add('refund-0001','21','refund',[['Assets:Customer receivables',8000],['Assets:Cash',-8000]],'SIT-sale-0001-v1');
add('refund-correction-0001','22','refund_correction',[['Assets:Cash',1000],['Assets:Customer receivables',-1000]],'SIT-refund-0001-v1');
const quote=v=>'"'+String(v).replaceAll('"','""')+'"';
const csv=(columns,rows)=>[columns,...rows].map(r=>r.map(quote).join(',')).join('\r\n')+'\r\n';
const decimal=n=>{const a=n<0n?-n:n;return String(a/100n)+'.'+String(a%100n).padStart(2,'0');};
for(const e of events)if(e.splits.reduce((n,s)=>n+BigInt(s.paise),0n)!==0n)throw new Error('UNBALANCED_FICTIONAL_EVENT');
const transactions=list=>csv(['Date','Number','Description','Account','Deposit','Withdrawal'],list.flatMap(e=>e.splits.map(s=>{const n=BigInt(s.paise);return [e.day,e.id,e.id+' '+e.kind,s.account,n>0n?decimal(n):'',n<0n?decimal(n):''];})));
const accountNames=[...new Set(events.flatMap(e=>e.splits.map(s=>s.account)))].sort();
const balances=list=>Object.fromEntries(accountNames.map(account=>[account,String(list.flatMap(e=>e.splits).filter(s=>s.account===account).reduce((n,s)=>n+BigInt(s.paise),0n))]));
const initial=events.slice(0,correctionStart),corrections=events.slice(correctionStart),before=balances(initial),after=balances(events);
if(before['Assets:Customer receivables']!=='0'||after['Assets:Customer receivables']!=='-3000'||after['Liabilities:Seller COD']!=='-150000'||after['Liabilities:Customer advances']!=='-15000')throw new Error('FICTIONAL_SOURCE_CONTROL_MISMATCH');
const files={
 'fictional-month.csv':transactions(initial),
 'fictional-correction.csv':transactions(corrections),
 'fictional-source-events.json':JSON.stringify({mapping_version:'gnucash-5.17-candidate-v1',qualification:'pending_import_and_accountant_review',currency:'INR',sign:'positive debit; negative credit; exact integer paise',events},null,2)+'\n',
 'required-accounts.csv':csv(['full_account_name','type','currency'],accountNames.map(name=>[name,name.split(':')[0]==='Assets'?'ASSET':name.split(':')[0]==='Liabilities'?'LIABILITY':name.split(':')[0]==='Income'?'INCOME':'EXPENSE','INR'])),
 'expected-balances.csv':csv(['account','initial_signed_paise','after_corrections_signed_paise','actual_initial_paise','actual_after_corrections_paise','difference_paise'],accountNames.map(name=>[name,before[name],after[name],'PENDING','PENDING','PENDING'])),
 'import-log-template.csv':csv(['mapping_version','event_id','correction_of','target_transaction_reference','accepted_file_sha256','reviewer','imported_at'],events.map(e=>['gnucash-5.17-candidate-v1',e.id,e.correction_of??'','PENDING','PENDING','PENDING','PENDING'])),
 'expected-controls.json':JSON.stringify({status:'expected_only_no_target_results',initial_transactions:initial.length,initial_splits:initial.reduce((n,e)=>n+e.splits.length,0),correction_transactions:corrections.length,correction_splits:corrections.reduce((n,e)=>n+e.splits.length,0),source_totals_paise:{original_sales_gross:'215000',original_freight:'210000',cgst:'2500',sgst:'2500',igst:'0',actual_receipts:'435000',allocations:'215000',cod_reserved:'200000',cod_remitted:'50000',advance_returned:'5000',ordinary_expense:'10000',agent_expense:'12000',agent_advance:'10000',agent_advance_applied:'5000',agent_fee_cash_paid:'7000',charge_reduction:'10000',original_refund:'8000',refund_correction:'-1000',net_refund:'7000'},initial_debits_paise:String(initial.flatMap(e=>e.splits).filter(s=>BigInt(s.paise)>0n).reduce((n,s)=>n+BigInt(s.paise),0n)),correction_debits_paise:'19000',repeat_expected_new_events:0,after_corrections_transactions:events.length},null,2)+'\n',
};
files['SHA256SUMS']=Object.entries(files).map(([name,content])=>createHash('sha256').update(content).digest('hex')+'  '+name).join('\n')+'\n';
if(process.argv.includes('--check')){for(const [name,content] of Object.entries(files))if(await readFile(new URL(name,root),'utf8')!==content)throw new Error('REVIEW_FIXTURE_CHANGED: '+name);console.log('Fictional mapping files, exact balances and checksums verified; target import remains pending.');}
else{await mkdir(root,{recursive:true});for(const [name,content] of Object.entries(files))await writeFile(new URL(name,root),content);console.log('Fictional review pack saved: '+fileURLToPath(root));}
