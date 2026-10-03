// #52: immutable turn evidence, not a second event queue or transcript store.
exports.up=pgm=>{pgm.sql(String.raw`
ALTER TABLE shipit.customer_conversation_turns
 ADD COLUMN metric_category text NOT NULL DEFAULT 'unmeasured'
  CHECK(metric_category IN ('unmeasured','success','clarification','handoff','paused','consent','thanks','control','failure','queued')),
 ADD COLUMN metric_reason text NOT NULL DEFAULT 'none'
  CHECK(metric_reason IN ('none','authorization','missing_data','dependency','interpretation','invalid_input','stale','provider_pending')),
 ADD COLUMN metric_latency_ms integer CHECK(metric_latency_ms BETWEEN 0 AND 900000),
 ADD COLUMN metric_locale text CHECK(metric_locale IN ('en','hi'));
CREATE INDEX conversation_metrics_time ON shipit.customer_conversation_turns(organization_id,franchise_id,recorded_at);
-- Old writers/records remain explicitly unmeasured. Never infer success in a backfill.
`);};
exports.down=()=>{throw new Error('Forward-only migration');};
