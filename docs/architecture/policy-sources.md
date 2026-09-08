# Issue 8 authoritative policy evidence

[Owning contract](money-tax-proof-privacy-contract.md) · [ADR 0009](../adr/0009-money-tax-proof-and-privacy-policy.md)

Access/review date for every row: **2026-09-08**. Sources were opened/searched at this
implementation time; dates printed by instruments and commencement are distinct from
access date. This is bounded architecture research, not a legal opinion or tax certification.
No GST rate is approved here. No blog is used as legal authority.

| ID | Source title and URL | Proposition supported | Uncertainty / required validation |
| --- | --- | --- | --- |
| S01 | [CBIC: Central Goods and Services Tax Act, sections 35, 36, 170](https://cbic-gst.gov.in/hindi/CGST-bill-e.html); [India Code current Act index](https://www.indiacode.nic.in/handle/123456789/15689) | Section 170 specifies nearest-rupee rounding, with 50 paise upward, for sums under that Act. Section 36 requires covered records for 72 months from the relevant annual-return due date, extended for specified proceedings/investigation to the later statutory endpoint (including one year after final disposal). Section 35 also covers transporter records. | CBIC HTML includes historical provisions elsewhere; use current consolidated law/notifications for the actual taxable entity, supply date and filing obligation. Section 170 does not by itself establish our internal invoice/component allocation algorithm. Tax adviser must validate invoice versus return/remittance rounding and exact retention trigger. |
| S02 | [India Code: Integrated GST Act](https://www.indiacode.nic.in/indiacode/handle/123456789/2251?col=123456789%2F1362&view_type=search); [CBIC Circular 184/16/2022-GST](https://cbic-gst.gov.in/pdf/circular-184.pdf) | Domestic transportation including mail/courier is specifically addressed by section 12(8): recipient registration and relevant location/hand-over facts matter. Destination city alone is insufficient. | The circular includes a then-applicable overseas proviso; it is not a current universal rule. Validate amended sections 7/8/12/13, special supplies, supplier/recipient location and current notifications under #21. Unsupported or unresolved classifications fail closed. |
| S03 | [NIC: E-Way Bill System FAQ](https://docs.ewaybillgst.gov.in/html/faq_new.html) | Validity depends on transport category/distance, commencement and official extension rules; subsequent Part-B edits do not simply restart it. Consolidated bills do not have an independent validity. | FAQ is guidance, not a complete consolidated Rule 138/notification implementation. #32/#67 must verify current official record, applicable state/exemption/category rules and amendments; no universal distance/threshold/expiry formula is adopted here. |
| S04 | [MeitY: Digital Personal Data Protection Act, 2023](https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf), sections 8 and 12 | Erasure/purpose limitation and correction/erasure rights coexist with retention necessary for legal compliance; processor handling is part of the obligation. | Read with commencement notification S06; do not claim every substantive duty is already in force. Validate legal basis for each retained field, not merely its parent record. |
| S05 | [MeitY: DPDP Rules, 2025, G.S.R. 846(E)](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf), rules 1, 6, 8 and schedules | Rule 6(1)(e) contains a one-year security retention provision. Rule 8(3) separately addresses minimum one-year retention of personal data, associated traffic data and processing logs for Seventh Schedule purposes. Rule 8(1)/Third Schedule is class-specific; it is not a universal inactive-account deadline. | Apply only at the relevant commencement and after validating scope. #72 must determine field-level applicability, processor copies and the treatment of ephemeral authentication material; safe metadata is not automatically a legally sufficient substitute for every required record. |
| S06 | [MeitY: DPDP Act enforcement timeline, G.S.R. 843(E)](https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf); [MeitY rules and corrigendum index](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa?pageTitle=Digit) | Commencement is staged: immediate provisions, a one-year group, and an eighteen-month substantive group. Rules likewise have staggered commencement. | As accessed September 2026, the eighteen-month group is not yet effective under these instruments. Record operative publication basis and any later notification at release; do not hard-code an inferred calendar deadline. [Gazette corrigenda G.S.R. 892(E)](https://egazette.gov.in/WriteReadData/2025/268455.pdf) was retrieved directly and text-extracted after browser retrieval failed: it corrects wording including the publication reference in rule 1, without replacing the one-year/eighteen-month periods. Recheck later notifications before production. |
| S07 | [CERT-In: Directions under section 70B, 28 April 2022](https://www.cert-in.org.in/PDF/CERT-In_Directions_70B_28.04.2022.pdf), direction (iv) | Covered entities must securely maintain ICT system logs for a rolling 180 days within India. | Validate entity coverage, current directions and interaction with longer effective obligations. Logging duty does not authorize secrets/raw payload logging. #68/#72/#73 own compliant location, retention and incident evidence. |
| S08 | [WhatsApp Business Messaging Policy](https://business.whatsapp.com/policy) (official redirect to WhatsApp for Business) | Businesses need required notices/permissions/consents and a privacy policy, respect opt-out, and use approved templates outside the 24-hour customer-service window. | No universal application message-retention period is established by this policy. #36/#38/#39 must recheck current installed product, authentication templates, consent and processor terms. Challenge resend permission is not provider-send permission or evidence of delivery. |

## Interpretation and release sign-off

ShippingCo's final customer rounding is already business authority in ADR 0006. S01
supports the statutory rounding convention; it does not certify how each invoice component
or return must be rounded. No reviewed source specifies the exact largest-remainder/tie
allocation required by our internal paise contract. That choice is **ShippingCo engineering
policy**, to be validated by the designated compliance owner with a qualified Indian tax
adviser before #21 handles real charges. If a statutory output needs different representation,
#21/#30/#62 must reconcile it explicitly without changing the booked customer snapshot.

The compliance owner/project owner must maintain an approved applicability register with
source version/access date, legal entity and processing purpose, effective date, class/field
scope, retention trigger/minimum/maximum, adviser reference, implementation owner and next
review date. Unknown durations are release blockers for the affected processing, not zero-day
deletion or permission for indefinite storage. Recheck before release, at least every six
months while active (next routine review no later than **2027-03-08**), and immediately on
material legal, government notification or provider policy change. Archive safe approval
references, not privileged advice or personal evidence in public GitHub.

Unresolved release validation: exact applicable tax rates/classifications and statutory
component reporting; DPDP commencement/corrigendum and field-level scope; ephemeral
challenge-material treatment; operational dispute windows; processor/backups deletion and
holds. These are named downstream production gates, not missing #8 runtime work. If legal
advice conflicts with an accepted invariant, disable that path pending a reviewed ADR amendment.
