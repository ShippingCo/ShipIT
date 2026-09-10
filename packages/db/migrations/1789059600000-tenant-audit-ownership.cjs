// Forward-only: referenced membership/invitation and audit must share ownership.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE shipit.membership_audit_events
      ADD CONSTRAINT membership_audit_membership_owner_fk FOREIGN KEY (organization_id, membership_id)
        REFERENCES shipit.memberships (organization_id, id) ON DELETE RESTRICT,
      ADD CONSTRAINT membership_audit_invitation_owner_fk FOREIGN KEY (organization_id, invitation_id)
        REFERENCES shipit.membership_invitations (organization_id, id) ON DELETE RESTRICT;
    CREATE INDEX invitation_scopes_franchise_idx
      ON shipit.invitation_franchise_scopes (organization_id, franchise_id, invitation_id);
    CREATE INDEX membership_audit_membership_idx
      ON shipit.membership_audit_events (organization_id, membership_id) WHERE membership_id IS NOT NULL;
    CREATE INDEX membership_audit_invitation_idx
      ON shipit.membership_audit_events (organization_id, invitation_id) WHERE invitation_id IS NOT NULL;
  `);
};
