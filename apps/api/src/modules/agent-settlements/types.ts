export type AgentMoneyAction='agent_money.configure'|'agent_money.reserve'|'agent_money.read';
export const agentMoneyActions=['agent_money.configure','agent_money.reserve','agent_money.read'] as const;
export interface AgentMoneyCommandDto {command_id:string;resource_id:string;recorded_at:string}
export interface BeneficiaryRow {id:string;beneficiary_id:string;version:number;name:string;active:boolean;recorded_at:Date}
export interface CodRow {id:string;obligation_id:string;version:number;beneficiary_id:string;beneficiary_revision_id:string;amount_paise:string;active:boolean;booking_id:string;parcel_id:string;collected_paise:string}
export type AgentStatementAction='agent_statement.capture'|'agent_statement.read'|'agent_statement.submit'|'agent_statement.decide';
