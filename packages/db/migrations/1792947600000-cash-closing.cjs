// #145 Physical observations and reviewed discrepancies never enter a money-source table.
exports.up=pgm=>pgm.sql(String.raw`
CREATE TABLE shipit.cash_close_sessions (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,
 location_id uuid NOT NULL,location_revision_id uuid NOT NULL,custodian_id uuid NOT NULL REFERENCES shipit.auth_users(id),
 sequence integer NOT NULL CHECK(sequence>0),day date NOT NULL CHECK(day BETWEEN DATE '2000-01-01' AND DATE '9998-12-31'),
 predecessor_id uuid,initial_opening jsonb,actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),recorded_at timestamptz NOT NULL,
 version integer NOT NULL CHECK(version>0),state text NOT NULL CHECK(state IN ('open','submitted','approved','rejected')),
 count_id uuid,submission_id uuid,accepted_submission_id uuid,initial_opening_id uuid,initial_opening_review_id uuid,
 UNIQUE(organization_id,franchise_id,id),UNIQUE(organization_id,franchise_id,location_id,sequence),UNIQUE(organization_id,franchise_id,predecessor_id),
 FOREIGN KEY(organization_id,franchise_id,location_id) REFERENCES shipit.cash_locations(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,location_id,location_revision_id) REFERENCES shipit.cash_location_revisions(organization_id,franchise_id,location_id,id),
 FOREIGN KEY(organization_id,franchise_id,predecessor_id) REFERENCES shipit.cash_close_sessions(organization_id,franchise_id,id),
 CHECK((predecessor_id IS NULL)=(initial_opening IS NOT NULL))
);
CREATE INDEX cash_close_sessions_day ON shipit.cash_close_sessions(organization_id,franchise_id,day,id);
CREATE INDEX cash_close_sessions_review ON shipit.cash_close_sessions(organization_id,franchise_id,state,id);
CREATE TABLE shipit.cash_close_commands (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,session_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),operation text NOT NULL CHECK(operation IN ('open','count','submit','decide','reopen','revise_opening','review_opening')),
 expected_version integer NOT NULL CHECK(expected_version BETWEEN 0 AND 2147483646),version integer NOT NULL,
 input jsonb NOT NULL CHECK(jsonb_typeof(input)='object' AND octet_length(input::text)<=16384),
 result jsonb NOT NULL,source_frame jsonb,recorded_at timestamptz NOT NULL,
 count_id uuid,submission_id uuid,opening_submission_id uuid,previous_submission_id uuid,initial_opening_id uuid,opening_review_id uuid,
 correlation_id uuid NOT NULL,key_digest text NOT NULL CHECK(key_digest~'^[0-9a-f]{64}$'),fingerprint text NOT NULL CHECK(fingerprint~'^[0-9a-f]{64}$'),
 UNIQUE(organization_id,franchise_id,id),UNIQUE(organization_id,franchise_id,session_id,id),
 UNIQUE(organization_id,franchise_id,session_id,version),UNIQUE(organization_id,franchise_id,actor_id,operation,key_digest),
 FOREIGN KEY(organization_id,franchise_id,session_id) REFERENCES shipit.cash_close_sessions(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,session_id,count_id) REFERENCES shipit.cash_close_commands(organization_id,franchise_id,session_id,id),
 FOREIGN KEY(organization_id,franchise_id,session_id,submission_id) REFERENCES shipit.cash_close_commands(organization_id,franchise_id,session_id,id),
 FOREIGN KEY(organization_id,franchise_id,opening_submission_id) REFERENCES shipit.cash_close_commands(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,session_id,previous_submission_id) REFERENCES shipit.cash_close_commands(organization_id,franchise_id,session_id,id),
 FOREIGN KEY(organization_id,franchise_id,session_id,initial_opening_id) REFERENCES shipit.cash_close_commands(organization_id,franchise_id,session_id,id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(organization_id,franchise_id,session_id,opening_review_id) REFERENCES shipit.cash_close_commands(organization_id,franchise_id,session_id,id) DEFERRABLE INITIALLY DEFERRED,
 CHECK(source_frame IS NULL OR jsonb_typeof(source_frame)='object' AND octet_length(source_frame::text)<=8388608)
);
ALTER TABLE shipit.cash_close_sessions ADD FOREIGN KEY(organization_id,franchise_id,id,count_id) REFERENCES shipit.cash_close_commands(organization_id,franchise_id,session_id,id) DEFERRABLE INITIALLY DEFERRED,
 ADD FOREIGN KEY(organization_id,franchise_id,id,submission_id) REFERENCES shipit.cash_close_commands(organization_id,franchise_id,session_id,id) DEFERRABLE INITIALLY DEFERRED,
 ADD FOREIGN KEY(organization_id,franchise_id,id,accepted_submission_id) REFERENCES shipit.cash_close_commands(organization_id,franchise_id,session_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE shipit.cash_close_sessions ADD FOREIGN KEY(organization_id,franchise_id,id,initial_opening_id) REFERENCES shipit.cash_close_commands(organization_id,franchise_id,session_id,id) DEFERRABLE INITIALLY DEFERRED,
 ADD FOREIGN KEY(organization_id,franchise_id,id,initial_opening_review_id) REFERENCES shipit.cash_close_commands(organization_id,franchise_id,session_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX cash_close_command_cutoff ON shipit.cash_close_commands(organization_id,franchise_id,recorded_at,id);
CREATE INDEX cash_close_opening_dependency ON shipit.cash_close_commands(organization_id,franchise_id,opening_submission_id);
CREATE TABLE shipit.cash_close_dependencies (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,session_id uuid NOT NULL,location_id uuid NOT NULL,sequence integer NOT NULL,
 old_submission_id uuid NOT NULL,new_submission_id uuid NOT NULL,carry_changed boolean NOT NULL,recorded_at timestamptz NOT NULL,
 FOREIGN KEY(organization_id,franchise_id,session_id) REFERENCES shipit.cash_close_sessions(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,location_id) REFERENCES shipit.cash_locations(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,session_id,old_submission_id) REFERENCES shipit.cash_close_commands(organization_id,franchise_id,session_id,id),
 FOREIGN KEY(organization_id,franchise_id,session_id,new_submission_id) REFERENCES shipit.cash_close_commands(organization_id,franchise_id,session_id,id)
);
CREATE INDEX cash_close_dependency_chain ON shipit.cash_close_dependencies(organization_id,franchise_id,location_id,sequence,id);
CREATE FUNCTION shipit.cash_close_instant(p_time timestamptz) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $fn$
 SELECT to_char(p_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
$fn$;
CREATE FUNCTION shipit.cash_close_denominations(p_value jsonb,p_amount numeric) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $fn$
 SELECT CASE WHEN jsonb_typeof(p_value) IS DISTINCT FROM 'array' THEN false
 WHEN jsonb_array_length(p_value)=0 THEN true
 WHEN jsonb_array_length(p_value)>100 THEN false ELSE
 NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_value) d WHERE jsonb_typeof(d)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(d))<>2
 OR jsonb_typeof(d->'denomination_paise') IS DISTINCT FROM 'number' OR jsonb_typeof(d->'quantity') IS DISTINCT FROM 'number'
 OR COALESCE(d->>'denomination_paise','')!~'^[1-9][0-9]{0,15}$' OR COALESCE(d->>'quantity','')!~'^(0|[1-9][0-9]{0,15})$')
 AND (SELECT count(*)=count(DISTINCT d->>'denomination_paise') FROM jsonb_array_elements(p_value) d)
 AND (SELECT sum((d->>'denomination_paise')::numeric*(d->>'quantity')::numeric)=p_amount FROM jsonb_array_elements(p_value) d)
 END
$fn$;
-- One MVCC statement, native microsecond boundaries, independently aggregated controls.
CREATE FUNCTION shipit.cash_close_source_frame(p_org uuid,p_franchise uuid,p_location uuid,p_open timestamptz,p_count timestamptz) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 WITH frame AS (SELECT statement_timestamp() as_of,l.account_id FROM shipit.cash_locations l WHERE l.organization_id=p_org AND l.franchise_id=p_franchise AND l.id=p_location AND l.kind='cash'),
 facts AS (SELECT s.* FROM shipit.cashbook_source_facts s,frame f WHERE s.organization_id=p_org AND s.franchise_id=p_franchise AND s.location_id=p_location AND s.occurred_at<=p_count AND s.recorded_at<=f.as_of),
 selected AS (SELECT * FROM facts WHERE occurred_at>p_open),
 unknowns AS (SELECT s.* FROM shipit.cashbook_source_facts s,frame f WHERE s.organization_id=p_org AND s.franchise_id=p_franchise AND s.location_id IS NULL AND (s.account_id IS NULL OR s.account_id=f.account_id) AND (s.payment_method IS NULL OR s.payment_method='cash') AND s.occurred_at<=p_count AND s.recorded_at<=f.as_of),
 pending AS (SELECT h.id,h.source_location_id,h.target_location_id,COALESCE((SELECT c.remaining_paise::numeric FROM shipit.cash_handover_commands c WHERE c.organization_id=h.organization_id AND c.franchise_id=h.franchise_id AND c.handover_id=h.id AND c.recorded_at<=f.as_of AND c.recorded_at<=p_count ORDER BY c.version DESC LIMIT 1),h.amount_paise::numeric) remaining_paise
 FROM shipit.cash_handovers h,frame f WHERE h.organization_id=p_org AND h.franchise_id=p_franchise AND (h.source_location_id=p_location OR h.target_location_id=p_location) AND h.occurred_at<=p_count AND h.recorded_at<=f.as_of),
 rows AS (SELECT jsonb_build_object('source_kind',s.source_kind,'source_id',s.source_id,'location_id',s.location_id,'account_id',s.account_id,'direction',s.direction,'amount_paise',s.amount_paise::text,'occurred_at',shipit.cash_close_instant(s.occurred_at),'recorded_at',shipit.cash_close_instant(s.recorded_at),'request_id',s.request_id,'correction_of',s.correction_of,'unknown_reason',s.unknown_reason) value,s.occurred_at,s.recorded_at,s.source_kind,s.source_id,s.location_id,s.direction FROM (SELECT * FROM selected UNION ALL SELECT * FROM unknowns) s)
 SELECT jsonb_build_object('schema_version',1,'location_id',p_location,'opening_at',shipit.cash_close_instant(p_open),'counted_at',shipit.cash_close_instant(p_count),'as_of',shipit.cash_close_instant(f.as_of),
 'inflow_paise',COALESCE((SELECT sum(amount_paise::numeric) FROM selected WHERE direction='in'),0)::text,
 'outflow_paise',COALESCE((SELECT sum(amount_paise::numeric) FROM selected WHERE direction='out'),0)::text,
 'known_position_paise',COALESCE((SELECT sum(CASE direction WHEN 'in' THEN amount_paise::numeric ELSE -amount_paise::numeric END) FROM facts),0)::text,
 'unknown_sources',(SELECT count(*)::int FROM unknowns),'coverage',CASE WHEN EXISTS(SELECT 1 FROM unknowns) THEN 'incomplete' ELSE 'attributable' END,
 'source_count',(SELECT count(*)::int FROM rows)+(SELECT count(*)::int FROM pending WHERE remaining_paise>0),
 'rows',COALESCE((SELECT jsonb_agg(value ORDER BY occurred_at,recorded_at,source_kind,source_id,location_id,direction) FROM (SELECT * FROM rows ORDER BY occurred_at,recorded_at,source_kind,source_id,location_id,direction LIMIT 5001) x),'[]'::jsonb),
 'pending_handovers',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'source_location_id',source_location_id,'target_location_id',target_location_id,'remaining_paise',remaining_paise::text) ORDER BY id) FROM (SELECT * FROM pending WHERE remaining_paise>0 ORDER BY id LIMIT 5001) x),'[]'::jsonb)) FROM frame f
$fn$;
CREATE FUNCTION shipit.cash_close_source_identity(p_frame jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $fn$
 -- A known-position change before this physical opening is prior reconciliation, never new turnover.
 SELECT p_frame-'as_of'-'known_position_paise'
$fn$;
CREATE FUNCTION shipit.guard_cash_close_owned() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN
 IF pg_trigger_depth()<2 THEN RAISE EXCEPTION 'CASH_CLOSE_SERVER_OWNED' USING ERRCODE='23514';END IF;
 IF TG_OP='DELETE' OR TG_TABLE_NAME='cash_close_dependencies' AND TG_OP<>'INSERT' THEN RAISE EXCEPTION 'CASH_CLOSE_IMMUTABLE' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER cash_close_session_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.cash_close_sessions FOR EACH ROW EXECUTE FUNCTION shipit.guard_cash_close_owned();
CREATE TRIGGER cash_close_dependency_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.cash_close_dependencies FOR EACH ROW EXECUTE FUNCTION shipit.guard_cash_close_owned();
CREATE FUNCTION shipit.guard_cash_close_command() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE s shipit.cash_close_sessions;previous shipit.cash_close_sessions;l shipit.cash_locations;lr shipit.cash_location_revisions;
 cap shipit.cash_close_commands;submitted shipit.cash_close_commands;accepted shipit.cash_close_commands;oldcap shipit.cash_close_commands;
 admin boolean;operator boolean;admins integer;opening jsonb;fresh jsonb;reason text;amount numeric;expected numeric;variance numeric;mode text;newstate text;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'CASH_CLOSE_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF NEW.input->>'expected_version' IS DISTINCT FROM NEW.expected_version::text THEN RAISE EXCEPTION 'CASH_CLOSE_VERSION_INPUT' USING ERRCODE='23514';END IF;
 IF NEW.result IS NOT NULL OR NEW.source_frame IS NOT NULL OR NEW.recorded_at IS NOT NULL OR NEW.version IS NOT NULL OR NEW.count_id IS NOT NULL OR NEW.submission_id IS NOT NULL OR NEW.opening_submission_id IS NOT NULL OR NEW.previous_submission_id IS NOT NULL OR NEW.initial_opening_id IS NOT NULL OR NEW.opening_review_id IS NOT NULL THEN RAISE EXCEPTION 'CASH_CLOSE_SERVER_OWNED' USING ERRCODE='23514';END IF;
 PERFORM id FROM shipit.organizations WHERE id=NEW.organization_id AND lifecycle='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CASH_CLOSE_SCOPE' USING ERRCODE='23514';END IF;
 PERFORM id FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id AND lifecycle='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CASH_CLOSE_SCOPE' USING ERRCODE='23514';END IF;
 SELECT COALESCE(bool_or(m.role='franchise_admin' AND m.user_id=NEW.actor_id),false),COALESCE(bool_or(m.role='operator' AND m.user_id=NEW.actor_id),false),count(DISTINCT m.user_id) FILTER(WHERE m.role='franchise_admin') INTO admin,operator,admins
 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes ms ON ms.organization_id=m.organization_id AND ms.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
 WHERE m.organization_id=NEW.organization_id AND ms.franchise_id=NEW.franchise_id AND m.lifecycle='active';
 IF NOT(admin OR operator AND NEW.operation IN ('open','count','submit','revise_opening')) THEN RAISE EXCEPTION 'CASH_CLOSE_ACTOR' USING ERRCODE='42501';END IF;
 reason:=NEW.input->>'reason';
 IF reason IS NULL OR char_length(reason) NOT BETWEEN 1 AND 500 OR reason<>btrim(reason) OR reason~'[\x01-\x1f\x7f-\x9f]' THEN RAISE EXCEPTION 'CASH_CLOSE_REASON' USING ERRCODE='23514';END IF;
 NEW.recorded_at:=clock_timestamp();NEW.version:=NEW.expected_version+1;
 IF NEW.operation='open' THEN
 IF NEW.expected_version<>0 OR (SELECT count(*) FROM jsonb_object_keys(NEW.input))<>7 THEN RAISE EXCEPTION 'CASH_CLOSE_INPUT' USING ERRCODE='23514';END IF;
 SELECT * INTO l FROM shipit.cash_locations WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=(NEW.input->>'location_id')::uuid FOR UPDATE;
 SELECT * INTO lr FROM shipit.cash_location_revisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND location_id=l.id ORDER BY version DESC LIMIT 1;
 IF l.id IS NULL OR l.kind<>'cash' OR NOT lr.active OR lr.id IS DISTINCT FROM (NEW.input->>'location_revision_id')::uuid OR NOT(admin OR l.custodian_id=NEW.actor_id) THEN RAISE EXCEPTION 'CASH_CLOSE_LOCATION' USING ERRCODE='42501';END IF;
 SELECT * INTO previous FROM shipit.cash_close_sessions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND location_id=l.id ORDER BY sequence DESC LIMIT 1;
 IF previous.id IS DISTINCT FROM (NEW.input->>'predecessor_id')::uuid OR previous.id IS NOT NULL AND (previous.state<>'approved' OR previous.accepted_submission_id IS NULL) THEN RAISE EXCEPTION 'CASH_CLOSE_VERSION' USING ERRCODE='40001';END IF;
 IF previous.id IS NULL THEN
 opening:=NEW.input->'initial_opening';amount:=(opening->>'counted_paise')::numeric;
 IF jsonb_typeof(opening) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(opening))<>3 OR amount IS NULL OR amount<0 OR amount>9007199254740991 OR amount<>trunc(amount) OR NOT shipit.cash_close_denominations(opening->'denominations',amount) OR opening->>'counted_at' IS NULL OR (opening->>'counted_at')::timestamptz>NEW.recorded_at OR NOT isfinite((opening->>'counted_at')::timestamptz) THEN RAISE EXCEPTION 'CASH_CLOSE_OPENING' USING ERRCODE='23514';END IF;
 opening:=jsonb_build_object('kind','initial_count','opening_at',shipit.cash_close_instant((opening->>'counted_at')::timestamptz),'counted_paise',amount::text,'denominations',opening->'denominations','actor_id',NEW.actor_id,'reason',reason,'submission_id',NULL,'count_id',NULL,'initial_revision_id',NEW.id,'previous_initial_revision_id',NULL);
 ELSE IF NEW.input->'initial_opening'<>'null'::jsonb THEN RAISE EXCEPTION 'CASH_CLOSE_OPENING' USING ERRCODE='23514';END IF;END IF;
 INSERT INTO shipit.cash_close_sessions(id,organization_id,franchise_id,location_id,location_revision_id,custodian_id,sequence,day,predecessor_id,initial_opening,actor_id,recorded_at,version,state,initial_opening_id)
 VALUES(NEW.session_id,NEW.organization_id,NEW.franchise_id,l.id,lr.id,l.custodian_id,COALESCE(previous.sequence,0)+1,(NEW.input->>'day')::date,previous.id,opening,NEW.actor_id,NEW.recorded_at,1,'open',CASE WHEN previous.id IS NULL THEN NEW.id ELSE NULL END) RETURNING * INTO s;
 IF opening IS NOT NULL THEN NEW.result:=jsonb_build_object('opening',opening);END IF;
 ELSE
 SELECT * INTO s FROM shipit.cash_close_sessions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.session_id FOR UPDATE;
 IF s.id IS NULL OR NOT(admin OR s.custodian_id=NEW.actor_id) THEN RAISE EXCEPTION 'CASH_CLOSE_SESSION' USING ERRCODE='42501';END IF;
 IF s.version<>NEW.expected_version THEN RAISE EXCEPTION 'CASH_CLOSE_VERSION' USING ERRCODE='40001';END IF;
 END IF;
 newstate:=s.state;
 IF s.predecessor_id IS NOT NULL THEN
 SELECT * INTO previous FROM shipit.cash_close_sessions WHERE organization_id=s.organization_id AND franchise_id=s.franchise_id AND id=s.predecessor_id;
 SELECT * INTO accepted FROM shipit.cash_close_commands WHERE organization_id=s.organization_id AND franchise_id=s.franchise_id AND id=previous.accepted_submission_id;
 SELECT * INTO oldcap FROM shipit.cash_close_commands WHERE organization_id=s.organization_id AND franchise_id=s.franchise_id AND id=accepted.count_id;
 opening:=jsonb_build_object('kind','approved_predecessor','opening_at',oldcap.result->'count'->>'counted_at','counted_paise',oldcap.result->'count'->>'counted_paise','denominations',oldcap.result->'count'->'denominations','actor_id',oldcap.actor_id,'reason','Accepted physical predecessor count','submission_id',accepted.id,'count_id',oldcap.id,'initial_revision_id',NULL,'previous_initial_revision_id',NULL);
 ELSE IF NEW.operation<>'open' THEN SELECT result->'opening' INTO opening FROM shipit.cash_close_commands WHERE organization_id=s.organization_id AND franchise_id=s.franchise_id AND session_id=s.id AND id=s.initial_opening_id;END IF;END IF;
 IF NEW.operation='revise_opening' THEN
 IF s.predecessor_id IS NOT NULL OR s.state NOT IN ('open','rejected') OR (SELECT count(*) FROM jsonb_object_keys(NEW.input))<>6 THEN RAISE EXCEPTION 'CASH_CLOSE_VERSION' USING ERRCODE='40001';END IF;
 IF s.initial_opening_id IS DISTINCT FROM (NEW.input->>'opening_id')::uuid THEN RAISE EXCEPTION 'CASH_CLOSE_OPENING_CHANGED' USING ERRCODE='P0146';END IF;
 amount:=(NEW.input->>'counted_paise')::numeric;
 IF amount IS NULL OR amount<0 OR amount>9007199254740991 OR amount<>trunc(amount) OR NOT shipit.cash_close_denominations(NEW.input->'denominations',amount) OR NEW.input->>'counted_at' IS NULL OR (NEW.input->>'counted_at')::timestamptz>NEW.recorded_at OR NOT isfinite((NEW.input->>'counted_at')::timestamptz) THEN RAISE EXCEPTION 'CASH_CLOSE_OPENING' USING ERRCODE='23514';END IF;
 opening:=jsonb_build_object('kind','initial_count','opening_at',shipit.cash_close_instant((NEW.input->>'counted_at')::timestamptz),'counted_paise',amount::text,'denominations',NEW.input->'denominations','actor_id',NEW.actor_id,'reason',reason,'submission_id',NULL,'count_id',NULL,'initial_revision_id',NEW.id,'previous_initial_revision_id',s.initial_opening_id);
 s.initial_opening_id:=NEW.id;s.initial_opening_review_id:=NULL;newstate:='open';NEW.result:=jsonb_build_object('opening',opening);
 ELSIF NEW.operation='review_opening' THEN
 IF s.predecessor_id IS NOT NULL OR s.state NOT IN ('open','rejected','submitted') OR s.initial_opening_review_id IS NOT NULL OR (SELECT count(*) FROM jsonb_object_keys(NEW.input))<>4 OR jsonb_typeof(NEW.input->'sole_admin_acknowledged') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'CASH_CLOSE_VERSION' USING ERRCODE='40001';END IF;
 IF s.initial_opening_id IS DISTINCT FROM (NEW.input->>'opening_id')::uuid THEN RAISE EXCEPTION 'CASH_CLOSE_OPENING_CHANGED' USING ERRCODE='P0146';END IF;
 mode:='independent';IF NEW.actor_id=(opening->>'actor_id')::uuid THEN IF admins<>1 OR NOT (NEW.input->>'sole_admin_acknowledged')::boolean THEN RAISE EXCEPTION 'CASH_CLOSE_REVIEW_REQUIRED' USING ERRCODE='P0147';END IF;mode:='sole_admin_self';END IF;
 s.initial_opening_review_id:=NEW.id;NEW.opening_review_id:=NEW.id;
 NEW.result:=jsonb_build_object('opening_review',jsonb_build_object('id',NEW.id,'opening_id',s.initial_opening_id,'mode',mode,'actor_id',NEW.actor_id,'reason',reason,'recorded_at',shipit.cash_close_instant(NEW.recorded_at)));
 ELSIF NEW.operation='count' THEN
 IF s.state NOT IN ('open','rejected') OR (SELECT count(*) FROM jsonb_object_keys(NEW.input))<>5 THEN RAISE EXCEPTION 'CASH_CLOSE_VERSION' USING ERRCODE='40001';END IF;
 amount:=(NEW.input->>'counted_paise')::numeric;
 IF amount IS NULL OR amount<0 OR amount>9007199254740991 OR amount<>trunc(amount) OR NOT shipit.cash_close_denominations(NEW.input->'denominations',amount) OR NEW.input->>'counted_at' IS NULL OR (NEW.input->>'counted_at')::timestamptz<=(opening->>'opening_at')::timestamptz OR (NEW.input->>'counted_at')::timestamptz>NEW.recorded_at OR NOT isfinite((NEW.input->>'counted_at')::timestamptz) THEN RAISE EXCEPTION 'CASH_CLOSE_COUNT' USING ERRCODE='23514';END IF;
 NEW.source_frame:=shipit.cash_close_source_frame(s.organization_id,s.franchise_id,s.location_id,(opening->>'opening_at')::timestamptz,(NEW.input->>'counted_at')::timestamptz);
 IF (NEW.source_frame->>'source_count')::int>5000 OR octet_length(NEW.source_frame::text)>8388608 THEN RAISE EXCEPTION 'CASH_CLOSE_LIMIT' USING ERRCODE='54000';END IF;
 expected:=(opening->>'counted_paise')::numeric+(NEW.source_frame->>'inflow_paise')::numeric-(NEW.source_frame->>'outflow_paise')::numeric;variance:=amount-expected;
 NEW.opening_submission_id:=(opening->>'submission_id')::uuid;NEW.previous_submission_id:=s.submission_id;
 NEW.result:=jsonb_build_object('count',jsonb_build_object('id',NEW.id,'opening',opening,'counted_at',NEW.source_frame->'counted_at','counted_paise',amount::text,'denominations',NEW.input->'denominations','reason',reason,'actor_id',NEW.actor_id,'as_of',NEW.source_frame->'as_of','expected_paise',expected::text,'variance_paise',variance::text,'shortage_paise',greatest(-variance,0)::text,'excess_paise',greatest(variance,0)::text,'controls',NEW.source_frame-'rows'-'pending_handovers'));
 s.count_id:=NEW.id;newstate:='open';
 ELSIF NEW.operation='submit' THEN
 IF s.state<>'open' OR s.count_id IS DISTINCT FROM (NEW.input->>'count_id')::uuid OR (SELECT count(*) FROM jsonb_object_keys(NEW.input))<>3 THEN RAISE EXCEPTION 'CASH_CLOSE_VERSION' USING ERRCODE='40001';END IF;
 SELECT * INTO cap FROM shipit.cash_close_commands WHERE organization_id=s.organization_id AND franchise_id=s.franchise_id AND id=s.count_id;
 IF cap.actor_id<>NEW.actor_id THEN RAISE EXCEPTION 'CASH_CLOSE_COUNTER' USING ERRCODE='42501';END IF;
 IF cap.opening_submission_id IS DISTINCT FROM (opening->>'submission_id')::uuid OR cap.initial_opening_id IS DISTINCT FROM s.initial_opening_id THEN RAISE EXCEPTION 'CASH_CLOSE_OPENING_CHANGED' USING ERRCODE='P0146';END IF;
 fresh:=shipit.cash_close_source_frame(s.organization_id,s.franchise_id,s.location_id,(opening->>'opening_at')::timestamptz,(cap.input->>'counted_at')::timestamptz);
 IF shipit.cash_close_source_identity(fresh) IS DISTINCT FROM shipit.cash_close_source_identity(cap.source_frame) THEN RAISE EXCEPTION 'CASH_CLOSE_SOURCE_CHANGED' USING ERRCODE='P0145';END IF;
 NEW.count_id:=cap.id;NEW.opening_submission_id:=cap.opening_submission_id;NEW.previous_submission_id:=s.submission_id;s.submission_id:=NEW.id;newstate:='submitted';
 NEW.result:=jsonb_build_object('submission',jsonb_build_object('id',NEW.id,'count_id',cap.id,'previous_submission_id',NEW.previous_submission_id,'actor_id',NEW.actor_id,'reason',reason,'recorded_at',shipit.cash_close_instant(NEW.recorded_at)));
 ELSIF NEW.operation='decide' THEN
 IF s.state<>'submitted' OR s.submission_id IS DISTINCT FROM (NEW.input->>'submission_id')::uuid OR (SELECT count(*) FROM jsonb_object_keys(NEW.input))<>5 OR NEW.input->>'kind' NOT IN ('approve','reject') OR jsonb_typeof(NEW.input->'sole_admin_acknowledged') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'CASH_CLOSE_VERSION' USING ERRCODE='40001';END IF;
 SELECT * INTO submitted FROM shipit.cash_close_commands WHERE organization_id=s.organization_id AND franchise_id=s.franchise_id AND id=s.submission_id;
 SELECT * INTO cap FROM shipit.cash_close_commands WHERE organization_id=s.organization_id AND franchise_id=s.franchise_id AND id=submitted.count_id;
 mode:='independent';
 IF NEW.actor_id=submitted.actor_id OR NEW.actor_id=cap.actor_id OR NEW.input->>'kind'='approve' AND s.initial_opening_id IS NOT NULL AND s.initial_opening_review_id IS NULL AND NEW.actor_id=(opening->>'actor_id')::uuid
 THEN
 IF admins<>1 OR NOT (NEW.input->>'sole_admin_acknowledged')::boolean THEN RAISE EXCEPTION 'CASH_CLOSE_REVIEW_REQUIRED' USING ERRCODE='P0147';END IF;mode:='sole_admin_self';END IF;
 IF NEW.input->>'kind'='approve' THEN
 IF submitted.opening_submission_id IS DISTINCT FROM (opening->>'submission_id')::uuid OR submitted.initial_opening_id IS DISTINCT FROM s.initial_opening_id THEN RAISE EXCEPTION 'CASH_CLOSE_OPENING_CHANGED' USING ERRCODE='P0146';END IF;
 fresh:=shipit.cash_close_source_frame(s.organization_id,s.franchise_id,s.location_id,(opening->>'opening_at')::timestamptz,(cap.input->>'counted_at')::timestamptz);
 IF shipit.cash_close_source_identity(fresh) IS DISTINCT FROM shipit.cash_close_source_identity(cap.source_frame) THEN RAISE EXCEPTION 'CASH_CLOSE_SOURCE_CHANGED' USING ERRCODE='P0145';END IF;
 IF s.accepted_submission_id IS NOT NULL THEN
 SELECT * INTO accepted FROM shipit.cash_close_commands WHERE organization_id=s.organization_id AND franchise_id=s.franchise_id AND id=s.accepted_submission_id;
 SELECT * INTO oldcap FROM shipit.cash_close_commands WHERE organization_id=s.organization_id AND franchise_id=s.franchise_id AND id=accepted.count_id;
 INSERT INTO shipit.cash_close_dependencies VALUES(NEW.id,s.organization_id,s.franchise_id,s.id,s.location_id,s.sequence,s.accepted_submission_id,s.submission_id,
 ROW(oldcap.result->'count'->>'counted_at',oldcap.result->'count'->>'counted_paise') IS DISTINCT FROM ROW(cap.result->'count'->>'counted_at',cap.result->'count'->>'counted_paise'),NEW.recorded_at);
 END IF;
 IF s.initial_opening_id IS NOT NULL AND s.initial_opening_review_id IS NULL THEN s.initial_opening_review_id:=NEW.id;NEW.result:=jsonb_build_object('opening_review',jsonb_build_object('id',NEW.id,'opening_id',s.initial_opening_id,'mode',CASE WHEN NEW.actor_id=(opening->>'actor_id')::uuid THEN 'sole_admin_self' ELSE 'independent' END,'actor_id',NEW.actor_id,'reason',reason,'recorded_at',shipit.cash_close_instant(NEW.recorded_at)));END IF;
 s.accepted_submission_id:=s.submission_id;newstate:='approved';ELSE newstate:='rejected';END IF;
 NEW.count_id:=cap.id;NEW.submission_id:=s.submission_id;NEW.opening_submission_id:=cap.opening_submission_id;
 NEW.opening_review_id:=s.initial_opening_review_id;
 NEW.result:=COALESCE(NEW.result,'{}'::jsonb)||jsonb_build_object('decision',jsonb_build_object('id',NEW.id,'submission_id',s.submission_id,'opening_revision_id',cap.initial_opening_id,'opening_review_id',CASE WHEN NEW.input->>'kind'='approve' THEN NEW.opening_review_id ELSE NULL END,'kind',NEW.input->>'kind','mode',mode,'actor_id',NEW.actor_id,'reason',reason,'recorded_at',shipit.cash_close_instant(NEW.recorded_at)));
 ELSIF NEW.operation='reopen' THEN
 IF s.state NOT IN ('approved','submitted') OR (SELECT count(*) FROM jsonb_object_keys(NEW.input))<>2 THEN RAISE EXCEPTION 'CASH_CLOSE_VERSION' USING ERRCODE='40001';END IF;
 NEW.previous_submission_id:=s.submission_id;s.count_id:=NULL;newstate:='open';
 END IF;
 NEW.initial_opening_id:=s.initial_opening_id;
 NEW.result:=COALESCE(NEW.result,'{}'::jsonb)||jsonb_build_object('command_id',NEW.id,'session_id',s.id,'operation',NEW.operation,'version',NEW.version,'state',newstate,'recorded_at',shipit.cash_close_instant(NEW.recorded_at));
 UPDATE shipit.cash_close_sessions SET version=NEW.version,state=newstate,count_id=s.count_id,submission_id=s.submission_id,accepted_submission_id=s.accepted_submission_id,initial_opening_id=s.initial_opening_id,initial_opening_review_id=s.initial_opening_review_id WHERE organization_id=s.organization_id AND franchise_id=s.franchise_id AND id=s.id;
 RETURN NEW;
END $fn$;
CREATE TRIGGER cash_close_command_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.cash_close_commands FOR EACH ROW EXECUTE FUNCTION shipit.guard_cash_close_command();
REVOKE ALL ON shipit.cash_close_sessions,shipit.cash_close_commands,shipit.cash_close_dependencies FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.cash_close_instant(timestamptz),shipit.cash_close_denominations(jsonb,numeric),shipit.cash_close_source_frame(uuid,uuid,uuid,timestamptz,timestamptz),shipit.cash_close_source_identity(jsonb),shipit.guard_cash_close_owned(),shipit.guard_cash_close_command() FROM PUBLIC;
DO $audit$
DECLARE source text;
BEGIN
 SELECT pg_get_viewdef('shipit.audit_history'::regclass,true) INTO source;
 EXECUTE 'CREATE OR REPLACE VIEW shipit.audit_history AS '||rtrim(source,E';\n ')||$view$
 UNION ALL SELECT 'cash-close:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,'cashbook.close.'||operation,'cash_close',session_id,'success','cash_close_'||operation,correlation_id,recorded_at,NULL,NULL,NULL,NULL FROM shipit.cash_close_commands$view$;
END $audit$;
`);
exports.down=()=>{throw new Error('CASH_CLOSE_FORWARD_ONLY');};
