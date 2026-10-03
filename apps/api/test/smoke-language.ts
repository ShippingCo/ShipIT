// Opt-in development-only smoke: at most four synthetic calls, never customer records.
import { parseEnvironment } from '../src/env.ts';
import { createGroqInterpreter,prepareInput,MODEL,REASONING_EFFORT } from '../src/modules/conversations/interpreter.ts';

const key=process.env.LLM_API_KEY;
if(!key){console.log('GROQ_SMOKE_NOT_RUN: LLM_API_KEY unavailable');process.exitCode=2;}
else {
 const config=parseEnvironment({NODE_ENV:'development',HOST:'127.0.0.1',PORT:'3000',LOG_LEVEL:'silent',ALLOWED_ORIGINS:'http://localhost:5173',
  TRUSTED_PROXY_HOPS:'0',DATABASE_SECRET_REF:'local:database',DATABASE_TLS_MODE:'disable',LLM_ENABLED:'true',
  LLM_API_KEY:key,LLM_MODEL:process.env.LLM_MODEL,LLM_PRIVACY_POLICY_REF:'synthetic-development-only'});
 const interpreter=createGroqInterpreter(config.interpreter!)!;
 console.log(JSON.stringify({model:MODEL,reasoning_effort:REASONING_EFFORT,synthetic_only:true,max_requests:4}));
 const fixtures=[['english_progress','has my parcel reached yet','tracking'],['hindi_eta','मेरा पार्सल कब आएगा','eta'],
  ['hinglish_progress','mera parcel kidhar hai','tracking'],['english_quote','how much to send a package','quote']];
 for(const [id,text,expected] of fixtures) {
  const input=prepareInput(text!)!;
  const result=await interpreter.interpret(input.text);
  const passed=result.category==='interpreted'&&result.value?.intent===expected;
  console.log(JSON.stringify({id,category:result.category,expected,actual:result.value?.intent??null,passed,latency_ms:result.latencyMs,input_tokens:result.inputTokens,output_tokens:result.outputTokens,estimated_micro_usd:result.estimatedMicroUsd}));
  if(!passed)process.exitCode=1;
  if(['authentication','rate_limited','timeout','unavailable'].includes(result.category))break;
 }
}
