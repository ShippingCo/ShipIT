import {describe,it,expect} from 'vitest';
import {messagingCells,assistantCells,queueCells} from '../../src/modules/reports/effectiveness-rules.ts';
describe('effectiveness disclosure and cohort rules',()=>{
  it('hides small message cells and complementary totals instead of exposing a hidden denominator',()=>{
    const rows=messagingCells([{category:'logical_intents',n:11,subjects:6},{category:'delivered',n:10,subjects:5},{category:'provider_failed',n:1,subjects:1},{category:'known_customers',n:6,subjects:6}]);
    expect(rows.find(r=>r.category==='delivered')?.count).toBe(10);expect(rows.find(r=>r.category==='provider_failed')?.count).toBeNull();expect(rows.find(r=>r.category==='logical_intents')?.count).toBeNull();expect(rows.find(r=>r.category==='known_customers')?.count).toBeNull();expect(rows.every(r=>r.denominator===null)).toBe(true);
    expect(rows.find(r=>r.category==='consent_suppressed')?.count).toBe(0);
  });
  it('keeps thanks and staff resolution separate and hides measured-turn denominators when reasons are suppressed',()=>{
    const rows=assistantCells([{category:'thanks',events:'5',conversations:'5',latency_ms:10},{category:'case_resolved',events:'5',conversations:'5',latency_ms:null},{category:'failure',events:'1',conversations:'1',latency_ms:20},{category:'failure_dependency',events:'1',conversations:'1',latency_ms:null}]);
    expect(rows.find(r=>r.category==='thanks')?.count).toBe(5);expect(rows.find(r=>r.category==='success')?.count).toBe(0);expect(rows.find(r=>r.category==='thanks')?.denominator).toBeNull();expect(rows.find(r=>r.category==='case_resolved')?.denominator_kind).toBe('case_events');
  });
  it('hides small known-age subsets while retaining a safe queue count and makes missing staffing unknown',()=>{
    const rows=queueCells([{category:'all_active',n:5,subjects:5,business_minutes:10,age_subjects:4,unknown_age:1},{category:'open',n:5,subjects:5,business_minutes:10,age_subjects:4,unknown_age:1},{category:'age_unknown',n:1,subjects:1,business_minutes:null,age_subjects:0,unknown_age:1}]);
    expect(rows.find(r=>r.category==='open')).toMatchObject({count:5,business_minutes:null,age_suppressed:true,excluded:null});expect(rows.find(r=>r.category==='age_unknown')?.count).toBeNull();
    expect(queueCells([{category:'open',n:5,subjects:5,business_minutes:null,age_subjects:0,unknown_age:5}]).find(r=>r.category==='open')?.business_minutes).toBeNull();
  });
});
