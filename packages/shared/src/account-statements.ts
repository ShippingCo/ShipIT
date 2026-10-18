export const statementMeasures=['opening','charges','credits','payments','refunds','closing','outstanding','refundable_credit'] as const;
export type StatementAmounts=Record<typeof statementMeasures[number],string>;
export interface StatementAdvance {receipt_id:string;version:number;received:string;allocated:string;cod_reserved:string;returned?:string;unallocated:string}
export interface AccountStatementLine {
 booking_id:string;due_date:string;confirmed_at:string;source_statement_id:string|null;
 payment_version:number;financial_version:number;receipt_id:string|null;
 original_gross:string;pre_tax:string;cgst:string;sgst:string;igst:string;rounding:string;
 payment_ids:string[];adjustment_ids:string[];amounts:StatementAmounts;
 payment_evidence:{id:string;kind:'collection'|'reversal';amount:string;recorded_at:string}[];
 adjustment_evidence:{id:string;kind:string;reason:string;credit:string;refund:string;recorded_at:string}[];
}
export interface AccountStatement {
 id:string|null;kind:'account_statement_v2';account_id:string;account_revision_id:string;account_name:string;customer_id:string;
 from_day:string;to_day:string;as_of:string;version:number;previous_statement_id:string|null;source_digest:string;
 totals:StatementAmounts;unallocated_advance:string;advance_sources:StatementAdvance[];lines:AccountStatementLine[];
}
