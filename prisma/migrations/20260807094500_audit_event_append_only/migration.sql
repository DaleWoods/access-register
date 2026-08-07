-- The audit trail is the audit backbone: it must not be editable or deletable,
-- and that guarantee must not depend on application code behaving itself.
-- This trigger rejects any UPDATE or DELETE on "AuditEvent" at the database
-- level, for every connection, including a psql session.

CREATE OR REPLACE FUNCTION audit_event_is_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'AuditEvent is append-only: % is not permitted on this table', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_event_no_update ON "AuditEvent";
CREATE TRIGGER audit_event_no_update
  BEFORE UPDATE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION audit_event_is_append_only();

DROP TRIGGER IF EXISTS audit_event_no_delete ON "AuditEvent";
CREATE TRIGGER audit_event_no_delete
  BEFORE DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION audit_event_is_append_only();
