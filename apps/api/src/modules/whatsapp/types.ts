import type { SecretResolver } from '../../secrets.ts';

export interface Binding {
  readonly key:string; readonly organization_id:string; readonly franchise_id:string;
  readonly waba_id:string; readonly phone_number_id:string; readonly credential_ref:string;
}
export interface AutomationPolicyBinding {
  readonly policy_id:string; readonly policy_version:number; readonly template_name:string; readonly template_language:string;
  readonly variables:readonly string[];
}
export interface WhatsappConfiguration { readonly graph_version:string; readonly bindings:readonly Binding[]; readonly webhook?:import('./webhook-payload.ts').BusinessWebhookConfig; readonly outbound_enabled?:boolean; readonly automation?:{readonly policies:readonly AutomationPolicyBinding[]} }
export interface Template {
  provider_id:string|null; name:string; language:string; status:string; category:string;
  shape_hash:string; variables:readonly {type:'text'}[]; supported:boolean;
}
export interface Installation {
  id:string; organization_id:string; franchise_id:string; binding_key:string; waba_id:string;
  phone_number_id:string; credential_ref:string; version:number; state:'validated'|'disabled';
  validated_at:Date; command_id:string; credential_revision:number;
}
export interface RegisteredTemplate extends Template {
  installation_id:string; version:number; checked_at:Date; credential_revision:number;
}
export type SendOutcome = {kind:'accepted';provider_message_id:string} |
  {kind:'unavailable'|'configuration_failure'|'retryable_not_accepted'|'permanent_failure'|'uncertain';reason:string;retry_after_seconds?:number};
export interface Provider {
  validate(binding:Binding):Promise<void>;
  template(binding:Binding,name:string,language:string):Promise<Template>;
  send(binding:Binding,template:Template,recipient:string,variables:unknown,purpose?:'delivery_otp'|'updates'|'requested_assistance'|'consent_disclosure'):Promise<SendOutcome>;
  sendText?(binding:Binding,recipient:string,text:string):Promise<SendOutcome>;
}
export interface WhatsappDependencies { configuration:WhatsappConfiguration; provider:Provider; clock?:()=>Date }
export interface AdapterOptions { configuration:WhatsappConfiguration; secrets:SecretResolver; transport?:typeof fetch }
