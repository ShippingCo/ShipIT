# Security reporting

Do not put exploit details, credentials, OTPs or customer data in public issues.
Use [GitHub private vulnerability reporting](https://github.com/ShippingCo/ShipIT/security/advisories/new) for this repository. If GitHub reports the channel unavailable, contact a repository administrator privately to establish a secure channel; do not post the details publicly.

ShipIT is currently a fictional-data browser prototype. The roadmap defines production security requirements; the existence of security issues is not a claim those controls already run. M0–M7 product issues must enforce their own tenant/privacy/security controls before real data, and M7 verifies release readiness. No response SLA or certification is claimed here.

Never commit secrets. A discovered exposed credential must be revoked/rotated and investigated, not merely removed from the latest file. Use only authorized owned environments and synthetic data for testing.
