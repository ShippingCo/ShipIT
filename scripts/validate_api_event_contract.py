"""Issue #4 contract/fictional state model. No HTTP, DB, workers or provider I/O.

Run directly or through validate_planning.py. Models only the declared examples;
real concurrency, durable recovery and authorization require downstream integration tests.
"""
from copy import deepcopy
from datetime import datetime, timedelta
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / 'docs/architecture'
DENIED = {'otp', 'otp_used', 'verifier', 'token', 'access_token', 'provider_token',
          'password', 'secret', 'address', 'phone', 'raw_provider_payload',
          'proof', 'idempotency_key', 'session_token', 'carrier_credential'}
LIMIT = 9007199254740991


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def canonical(value):
    """Bounded canonical JSON domain: exact strings, objects, arrays, safe integers."""
    if isinstance(value, dict):
        return {k: canonical(v) for k, v in sorted(value.items())}
    if isinstance(value, list):
        return [canonical(v) for v in value]
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, (float, int)):
        check(abs(value) <= LIMIT and int(value) == value, 'Unsafe/noninteger number')
        return int(value)
    check(isinstance(value, str), 'Unsupported canonical type')
    value.encode('utf-8')  # Reject lone surrogates.
    return value


def intent(command):
    body = deepcopy(command['body'])
    # Only this synthetic booking seam declares this optional default. No product field.
    if command['operation_id'] == 'api.v1.bookings.create':
        body.setdefault('synthetic_option', False)
    media = command['content_type'].lower().replace(' ', '')
    check(media in {'application/json', 'application/json;charset=utf-8'}, 'Media type')
    normalized = dict(operation_id=command['operation_id'], resource_ids=command['resource_ids'],
                      content_type='application/json', query=command['query'], body=body)
    encoded = json.dumps(canonical(normalized), ensure_ascii=False, separators=(',', ':'),
                         allow_nan=False).encode('utf-8')
    return hashlib.sha256(encoded).hexdigest()


def scope(c):
    return tuple(c[k] for k in ('principal_type', 'principal_id', 'organization_id',
                                'franchise_id', 'operation_id', 'idempotency_key'))


def private_keys(value):
    if isinstance(value, dict):
        check(not DENIED.intersection(value), 'Private event/example field')
        for v in value.values():
            private_keys(v)
    elif isinstance(value, list):
        for v in value:
            private_keys(v)


def parse_unique(text):
    def pairs(items):
        out = {}
        for k, v in items:
            check(k not in out, 'Duplicate JSON key')
            out[k] = v
        return out
    return json.loads(text, object_pairs_hook=pairs,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Nonfinite JSON')))


def rejected(fn):
    try:
        fn()
    except (AssertionError, ValueError, UnicodeError, TypeError):
        return
    raise AssertionError('Negative control was unexpectedly accepted')


def validate_catalog(f):
    text = (DOCS / 'event-contract.md').read_text()
    lifecycle = (DOCS / 'parcel-lifecycle.md').read_text()
    catalog = {e['event_type']: e for e in f['events']}
    check(len(catalog) == len(f['events']) == 17, '17 distinct initial facts')
    expected = ['parcel.booked', 'parcel.checked_in', 'parcel.dispatched', 'parcel.in_transit',
                'delivery.attempt_started', 'delivery.completed', 'delivery.attempt_failed',
                'delivery.retry_started', 'parcel.held_at_office', 'delivery.collected',
                'parcel.rto_approved', 'parcel.rto_approved', 'delivery.reversed']
    for i, name in enumerate(expected, 1):
        transition = f'T{i:02}'
        row = next(line for line in lifecycle.splitlines() if line.startswith(f'| {transition} |'))
        check(name in row and transition in catalog[name]['transitions'], transition)
    for e in catalog.values():
        check(re.fullmatch(r'[a-z]+\.[a-z]+(?:_[a-z]+)*', e['event_type']), 'Fact name')
        check(e['schema_version'] == 1 and type(e['schema_version']) is int, 'Schema version')
        check(e['producer'] and e['consumers'] and e['committed_state'] and e['payload'], 'Catalog ownership')
        check(e['consumer_effect'] and e['forbidden_authority'] and e['privacy'], 'Consumer limits')
        check(set(e['ordering'].split('/')) <= set('MPHR'), 'Ordering policy')
        row = next(line for line in text.splitlines() if line.startswith('| '+e['event_type']+' |'))
        cells = [v.strip() for v in row.strip('|').split('|')]
        check(cells == [e['event_type'], e['producer'], e['aggregate']+' / '+','.join(e['transitions']),
                        e['committed_state'], str(e['schema_version']), ', '.join(e['payload']),
                        ', '.join(e['consumers']), e['consumer_effect'], e['forbidden_authority'],
                        e['ordering'], 'Reference-only; current scoped resolution'], 'Catalog/doc drift')
    check('messaging' not in catalog['parcel.booked']['consumers'], 'No duplicate booking confirmation')
    return catalog


def envelope_valid(event, catalog):
    required = {'event_id','event_type','schema_version','organization_id','aggregate_type',
                'aggregate_id','aggregate_version','occurred_at','actor','correlation_id',
                'causation_id','command_id','payload'}
    check(required <= event.keys(), 'Missing envelope field')
    check(event['event_type'] in catalog, 'Unknown fact')
    e = catalog[event['event_type']]
    check(type(event['schema_version']) is int and event['schema_version'] == 1, 'Unsupported schema')
    check(event['aggregate_type'] == e['aggregate'], 'Aggregate owner')
    check(type(event['aggregate_version']) is int and 1 <= event['aggregate_version'] <= LIMIT, 'Revision')
    check(isinstance(event.get('franchise_id'), str) and event['franchise_id'], 'Initial facts require franchise')
    check(set(event['actor']) == {'type','id'} and event['actor']['type'] in {'user','integration','service'}, 'Actor')
    for key in required - {'schema_version','aggregate_version','actor','payload'}:
        check(isinstance(event[key], str) and bool(event[key]), 'Reference type')
    check(isinstance(event['actor']['id'], str) and event['actor']['id'], 'Actor ID')
    check(re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{0,5}[1-9])?Z', event['occurred_at']), 'UTC format')
    datetime.fromisoformat(event['occurred_at'].replace('Z', '+00:00'))
    check(e['payload'].keys() <= event['payload'].keys(), 'Missing payload field')
    for k, kind in e['payload'].items():
        check(isinstance(event['payload'][k], str) and event['payload'][k], 'Payload type')
        if kind == 'instant':
            check(event['payload'][k].endswith('Z'), 'Payload UTC')
            datetime.fromisoformat(event['payload'][k].replace('Z', '+00:00'))
        if kind == 'failure_reason':
            check(event['payload'][k] in {'customer_unavailable','customer_requests_pickup',
                  'address_issue','recipient_refusal','payment_not_collected','operational_issue',
                  'other_controlled'}, 'Closed failure enum')
    private_keys(event)


class CommandModel:
    """Atomic assignment models commit; never claims database atomicity/locking."""
    def __init__(self, f):
        self.f = f
        self.records = {}
        self.business = []
        self.audit = []
        self.outbox = []
        self.clock = datetime.fromisoformat(f['fake_clock']['committed_at'].replace('Z', '+00:00'))

    def submit(self, command, authorized=True, rollback=False):
        if not authorized:
            return (404, None)
        key, fingerprint = scope(command), intent(command)
        if key in self.records:
            record = self.records[key]
            if self.clock >= record['retain_until']:
                # Client reconciliation disposition, NOT a promised server HTTP code.
                return ('reconcile_expired', None)
            if fingerprint != record['fingerprint']:
                return (409, 'IDEMPOTENCY_CONFLICT')
            return deepcopy(record['result'])
        if rollback:
            return ('rolled_back', None)
        record = {'fingerprint': fingerprint,
                  'retain_until': self.clock + timedelta(seconds=self.f['retention_seconds']),
                  'result': (201, deepcopy(self.f['result']['body']))}
        # One synthetic publication point for business, safe audit, result and outbox.
        self.business, self.audit, self.records, self.outbox = (
            self.business + ['booking_synthetic_01','par_synthetic_01','par_synthetic_02'],
            self.audit + ['audit_synthetic_command'], {**self.records, key: record},
            self.outbox + ['booking.created','parcel.booked','parcel.booked'])
        return deepcopy(record['result'])


def access(case, rules):
    # Interpret W01/R06 for a fictional A/A1 original Booking result only.
    if not case.get('authenticated', True):
        return 401
    if not case['membership'] or case['org'] != 'A':
        return 404
    cols = ['org_admin','franchise_admin','operator','dispatcher','delivery_agent','accountant','read_only']
    read_grant = rules['R06'][cols.index(case['role'])]
    own = case['franchise'] == 'A1'
    if read_grant != 'O' and not (read_grant == 'F' and own):
        return 404
    if case['action'] == 'read':
        return 200
    write_grant = rules['W01'][cols.index(case['role'])]
    if not (write_grant == 'F' and own):
        return 403
    if case['action'] == 'replay' and case['actor'] != 'actor_synthetic_operator':
        return 404
    return 201


class ConsumerModel:
    def __init__(self, policy, version):
        self.policy, self.version = policy, version
        self.seen, self.effects, self.dispositions = {}, set(), []

    def apply(self, event, snapshot_version=None):
        identity = event['event_id']
        if event['schema_version'] != 1:
            return 'quarantine_schema'
        if identity in self.seen:
            return 'duplicate' if self.seen[identity] == event else 'quarantine_identity'
        version = event['aggregate_version']
        if version < self.version:
            self.seen[identity] = deepcopy(event)
            return 'historical_only' if self.policy in 'HR' else 'skipped_stale'
        if version == self.version:
            return 'reconcile_revision'
        if version > self.version + 1:
            if self.policy in 'HR':
                self.dispositions.append(('gap', self.version + 1, version))
                return 'reconcile_gap'
            if snapshot_version is None or snapshot_version < version:
                return 'reconcile_snapshot'
        self.version = max(version, snapshot_version or version)
        self.seen[identity] = deepcopy(event)
        if self.policy == 'M':
            self.effects.add(('messaging',event['organization_id'],event['franchise_id'],
                              identity,'dispatch_update',event['aggregate_id'],'recipient_synthetic_01'))
        return 'applied'


def validate():
    f = parse_unique((DOCS / 'fixtures/api-event-contract.json').read_text())
    check(f['synthetic_only'] is True and f['retention_seconds'] == 86400, 'Fictional baseline')
    catalog = validate_catalog(f)
    envelope_valid(f['envelope'], catalog)
    for name, definition in catalog.items():
        example = deepcopy(f['envelope'])
        example.update(event_type=name, aggregate_type=definition['aggregate'])
        example['payload'] = {key: ('2026-09-09T18:30:00Z' if kind == 'instant' else
                              'customer_unavailable' if kind == 'failure_reason' else
                              'ref_synthetic_01') for key, kind in definition['payload'].items()}
        envelope_valid(example, catalog)
        for key in definition['payload']:
            broken = deepcopy(example); del broken['payload'][key]
            rejected(lambda: envelope_valid(broken, catalog))
    additive = deepcopy(f['envelope']); additive['payload']['optional_safe_ref'] = 'ref_synthetic_02'
    envelope_valid(additive, catalog)  # Supported v1 consumers may ignore safe optional additions.
    # Required fields/schema/authority/privacy negative controls.
    for key in f['envelope']:
        broken = deepcopy(f['envelope']); del broken[key]
        rejected(lambda: envelope_valid(broken, catalog))
    for key, value in [('schema_version',99),('aggregate_version',0),('aggregate_version',True),
                       ('aggregate_type','booking'),('event_type','send_whatsapp')]:
        broken = deepcopy(f['envelope']); broken[key] = value
        rejected(lambda: envelope_valid(broken, catalog))
    for key in DENIED:
        broken = deepcopy(f['envelope']); broken['payload'][key] = 'synthetic_redacted'
        rejected(lambda: envelope_valid(broken, catalog))
    for name in ['api-contract.md','event-contract.md','idempotency-contract.md']:
        for block in re.findall(r'```json\n(.*?)\n```', (DOCS / name).read_text(), re.S):
            private_keys(parse_unique(block))
    api = (DOCS / 'api-contract.md').read_text()
    for block in re.findall(r'```json\n(.*?)\n```', api, re.S):
        example = parse_unique(block)
        if 'error' in example:
            check(set(example) == {'error'}, 'Error envelope')
            err = example['error']
            check({'code','message','correlation_id'} <= err.keys() <= {'code','message','correlation_id','details'}, 'Error fields')
            check(re.fullmatch(r'[A-Z]+(?:_[A-Z]+)*', err['code']), 'Error code')
            for detail in err.get('details', []):
                check(set(detail) == {'field','code'}, 'Safe validation details')
        if 'page' in example:
            check(set(example) == {'items','page'}, 'List DTO')
            page = example['page']
            check(set(page) == {'next_cursor','has_more'}, 'Page fields')
            check(type(page['has_more']) is bool and page['has_more'] == (page['next_cursor'] is not None), 'Cursor/null consistency')
    private_keys(f['result'])
    rejected(lambda: parse_unique('{"x":1,"x":2}'))
    rejected(lambda: parse_unique('{"x":NaN}'))

    command = f['command']; fingerprint = intent(command)
    reordered = deepcopy(command)
    reordered['body'] = dict(reversed(list(command['body'].items())))
    reordered['body']['parcels'] = [dict(reversed(list(p.items()))) for p in command['body']['parcels']]
    reordered['body']['synthetic_option'] = False
    reordered['body']['parcels'][0]['weight_grams'] = 1e3
    reordered['content_type'] = 'Application/JSON; charset=UTF-8'
    reordered['correlation_id'] = 'cor_synthetic_retry'
    check(intent(reordered) == fingerprint, 'Equivalent normalized intent')
    for mutation in ['resource','version','array','null','value','query','operation','string']:
        changed = deepcopy(command)
        if mutation == 'resource': changed['resource_ids'] = {'parcel_id':'par_synthetic_other'}
        if mutation == 'version': changed['body']['expected_version'] = 7
        if mutation == 'array': changed['body']['parcels'].reverse()
        if mutation == 'null': changed['body']['synthetic_option'] = None
        if mutation == 'value': changed['body']['parcels'][0]['weight_grams'] = 1001
        if mutation == 'query': changed['query'] = {'synthetic_intent':True}
        if mutation == 'operation': changed['operation_id'] = 'api.v2.bookings.create'
        if mutation == 'string': changed['body']['customer_id'] += ' '
        check(intent(changed) != fingerprint, 'Intent difference: '+mutation)
    for key in ['principal_type','principal_id','organization_id','franchise_id','operation_id','idempotency_key']:
        changed = deepcopy(command); changed[key] = 'synthetic_different'
        check(scope(changed) != scope(command), 'Scope boundary: '+key)
    rejected(lambda: canonical(1.25))
    rejected(lambda: canonical(LIMIT+1))

    model = CommandModel(f)
    check(model.submit(command, rollback=True) == ('rolled_back',None), 'Rollback result')
    check(not any([model.records,model.business,model.audit,model.outbox]), 'Rollback publishes nothing')
    original = model.submit(command)  # Commit, deliberately lose response.
    counts = tuple(map(len,[model.business,model.audit,model.records,model.outbox]))
    check(counts == (3,1,1,3), 'Atomic parent + two children / audit / result / facts')
    check(model.submit(reordered) == original, 'Lost response: original authorized result')
    changed = deepcopy(command); changed['body']['parcels'][0]['weight_grams'] = 1001
    check(model.submit(changed) == (409,'IDEMPOTENCY_CONFLICT'), 'Mismatched replay')
    check(model.submit(command, authorized=False) == (404,None), 'Revoked replay')
    check(tuple(map(len,[model.business,model.audit,model.records,model.outbox])) == counts, 'No duplicate business effects')
    for clock_name, expect_replay in [('before_expiry',True),('at_expiry',False),('after_expiry',False)]:
        model.clock = datetime.fromisoformat(f['fake_clock'][clock_name].replace('Z','+00:00'))
        check(model.submit(command) == (original if expect_replay else ('reconcile_expired', None)), 'Fake-clock expiry '+clock_name)
    check(tuple(map(len,[model.business,model.audit,model.records,model.outbox])) == counts, 'Expiry never auto-resubmits')
    # Sensitive owners may retain longer; 24 hours is not a universal maximum.
    extended = deepcopy(f); extended['retention_seconds'] *= 2
    long_model = CommandModel(extended); long_result = long_model.submit(command)
    long_model.clock += timedelta(hours=25)
    check(long_model.submit(command) == long_result, 'Longer retention')

    matrix = (DOCS / 'authorization-contract.md').read_text(); rules = {}
    for name in ['R06','W01']:
        line = next(line for line in matrix.splitlines() if line.startswith('| '+name+' |'))
        rules[name] = [c.strip() for c in line.strip('|').split('|')][2:]
    for case in f['access_cases']:
        check(access(case,rules) == case['expected'], 'Current auth '+case['id'])

    pagination = f['pagination']
    check(pagination == dict(default_limit=50,max_limit=100,min_limit=1,sort=['created_at DESC','id DESC']), 'Cursor limits/order')
    def page_limit(value=None):
        if value is None: return pagination['default_limit']
        check(type(value) is int and 1 <= value <= pagination['max_limit'], '422 invalid limit')
        return value
    check(page_limit() == 50 and page_limit(100) == 100, 'Page defaults/boundary')
    for value in [0,101,1.5,True]: rejected(lambda: page_limit(value))
    context = dict(org='A',franchise='A1',projection='own_franchise',query='parcels',
                   filters={'status':'booked'},sort=pagination['sort'],limit=50)
    # Conceptual decoded server evidence, never a client-decodable cursor format.
    cursor_context = deepcopy(context)
    check(canonical(cursor_context) == canonical(context), 'Compatible cursor')
    for key, value in [('org','B'),('franchise','A2'),('projection','basic_shipment'),
                       ('query','bookings'),('filters',{}),('sort',['id ASC']),('limit',100)]:
        changed = deepcopy(context); changed[key] = value
        check(canonical(changed) != canonical(cursor_context), 'Cursor cannot cross '+key)

    for case in f['consumer_cases']:
        consumer = ConsumerModel(case['policy'],case['start']); outcomes=[]
        for revision, identity, schema in zip(case['versions'],case['event_ids'],case['schemas']):
            event = deepcopy(f['envelope']); event.update(aggregate_version=revision,event_id=identity,schema_version=schema)
            outcomes.append(consumer.apply(event,snapshot_version=revision if case['policy'] in 'MP' else None))
        check(outcomes == case['expected'], case['id']+' dispositions')
        check(len(consumer.effects) == case['effects'] and consumer.version == case['final_version'], case['id']+' effects/version')
        if 'reconcile_gap' in outcomes: check(consumer.dispositions, 'Gap evidence retained')
    consumer = ConsumerModel('M',3)
    check(consumer.apply(f['envelope']) == 'applied', 'Crash after logical intent commit')
    check(consumer.apply(f['envelope']) == 'duplicate' and len(consumer.effects) == 1, 'Crash/replay preserves intent')
    tampered=deepcopy(f['envelope']); tampered['payload']['manifest_id']='man_synthetic_other'
    check(consumer.apply(tampered) == 'quarantine_identity', 'Same ID altered content')
    gap=deepcopy(f['envelope']); gap['aggregate_version']=7; gap['event_id']='evt_synthetic_gap'
    check(consumer.apply(gap) == 'reconcile_snapshot', 'Gap needs authorized snapshot')
    # Two representations of one cause yield one effect for the same registered purpose.
    identities = {('messaging','A','A1','cmd_synthetic_booking','booking_confirmation',parcel,'recipient_synthetic_01')
                  for _source in ['booking.created','parcel.booked'] for parcel in ['par_synthetic_01','par_synthetic_02']}
    check(len(identities) == 2, 'One effect per affected parcel, not per source representation')
    # No pre-commit send path; provider ambiguity does not mutate committed business.
    def send(committed, acceptance):
        check(committed, 'Send before commit denied')
        return 'uncertain_reconcile' if acceptance == 'unknown' else 'accepted'
    rejected(lambda: send(False,'unknown'))
    check(send(True,'unknown') == 'uncertain_reconcile', 'Never blind resend on timeout')
    check(tuple(map(len,[model.business,model.audit,model.records,model.outbox])) == counts, 'Provider failure preserves facts')
    print('API/event contract synthetic validation PASS: 17 catalog facts, T01–T13 mapping, envelope/privacy negative controls, canonical intent/scope/replay, 10 authorization cases, cursor compatibility, 24-hour fake-clock boundary/longer retention, 8 consumer streams, rollback/commit/timeout/crash and provider ambiguity. No production behavior tested.')


if __name__ == '__main__':
    validate()
