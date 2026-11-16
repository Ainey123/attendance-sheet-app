-- ============================================================================
-- FES Attendance App — Phase 2 Additive Integration Schema Migration
-- Target Database: Attendance App Supabase PostgreSQL (hsdamnsrkrxesrohwtxs)
--
-- IMPORTANT SAFETY RULES:
-- 1. Strictly additive (ALTER TABLE ... ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS).
-- 2. Does NOT drop, rename, or alter any existing columns, constraints, or data.
-- 3. DO NOT execute on production until Phase 8 deployment approval.
-- ============================================================================

ALTER TABLE bills ADD COLUMN IF NOT EXISTS "externalTicketId"       INTEGER DEFAULT NULL;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS "externalTicketSerialNo" TEXT DEFAULT NULL;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS "externalJobMetadataId"  INTEGER DEFAULT NULL;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS "clientName"             TEXT DEFAULT NULL;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS "workNature"             TEXT DEFAULT NULL;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS "ticketSubject"          TEXT DEFAULT NULL;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS "ticketSelectionMode"    TEXT DEFAULT 'NONE';
ALTER TABLE bills ADD COLUMN IF NOT EXISTS "externalExpenseId"      INTEGER DEFAULT NULL;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS "integrationSyncStatus"  TEXT DEFAULT 'NOT_APPLICABLE';
ALTER TABLE bills ADD COLUMN IF NOT EXISTS "integrationSyncedAt"    TIMESTAMP WITH TIME ZONE DEFAULT NULL;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS "integrationSyncError"   TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_bills_external_ticket_serial  ON bills("externalTicketSerialNo");
CREATE INDEX IF NOT EXISTS idx_bills_integration_sync_status ON bills("integrationSyncStatus");
