/** Development-phase RBAC switch (RBAC_ENABLED=false, accepted only in NODE_ENV=development).
 * buildServer sets it from configuration and it defaults to on. While off, activeMemberships in
 * authority.ts treats a user with at least one real active membership in an organization as
 * holding every role across that organization's own franchises. Sign-in, organization isolation,
 * tenant-scoped queries, business rules, audit records and database grants and triggers are
 * unchanged. Kept apart from authority.ts so the server can set it without importing authority. */
let roleChecks = true;
export function configureRoleChecks(enabled: boolean) { roleChecks = enabled; }
export function roleChecksEnabled() { return roleChecks; }
