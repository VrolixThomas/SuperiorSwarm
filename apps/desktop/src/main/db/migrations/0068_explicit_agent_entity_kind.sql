ALTER TABLE `agent_sessions` ADD `entity_kind` text DEFAULT 'workspace' NOT NULL;--> statement-breakpoint
-- Existing workspace FK before 0067 proves workspace ownership even for historical ID collisions.
-- Only unambiguous coordinator rows introduced after 0067 can be backfilled as coordinators.
UPDATE agent_sessions SET entity_kind = 'coordinator'
 WHERE NOT EXISTS (SELECT 1 FROM workspaces WHERE id = agent_sessions.workspace_id)
 AND EXISTS (SELECT 1 FROM cross_repo_orchestrators WHERE id = agent_sessions.workspace_id AND kind = 'workspace');
--> statement-breakpoint
DROP TRIGGER agent_sessions_entity_insert;
--> statement-breakpoint
DROP TRIGGER agent_sessions_entity_update;
--> statement-breakpoint
DROP TRIGGER agent_sessions_workspace_delete;
--> statement-breakpoint
DROP TRIGGER agent_sessions_coordinator_delete;
--> statement-breakpoint
CREATE TRIGGER agent_sessions_entity_insert BEFORE INSERT ON agent_sessions
WHEN NEW.entity_kind NOT IN ('workspace', 'coordinator')
 OR (NEW.entity_kind = 'workspace' AND NOT EXISTS (SELECT 1 FROM workspaces WHERE id = NEW.workspace_id))
 OR (NEW.entity_kind = 'coordinator' AND NOT EXISTS (SELECT 1 FROM cross_repo_orchestrators WHERE id = NEW.workspace_id AND kind = 'workspace'))
BEGIN SELECT RAISE(ABORT, 'unknown agent entity'); END;
--> statement-breakpoint
CREATE TRIGGER agent_sessions_entity_update BEFORE UPDATE OF workspace_id, entity_kind ON agent_sessions
WHEN NEW.entity_kind NOT IN ('workspace', 'coordinator')
 OR (NEW.entity_kind = 'workspace' AND NOT EXISTS (SELECT 1 FROM workspaces WHERE id = NEW.workspace_id))
 OR (NEW.entity_kind = 'coordinator' AND NOT EXISTS (SELECT 1 FROM cross_repo_orchestrators WHERE id = NEW.workspace_id AND kind = 'workspace'))
BEGIN SELECT RAISE(ABORT, 'unknown agent entity'); END;
--> statement-breakpoint
CREATE TRIGGER agent_sessions_workspace_delete AFTER DELETE ON workspaces
BEGIN DELETE FROM agent_sessions WHERE workspace_id = OLD.id AND entity_kind = 'workspace'; END;
--> statement-breakpoint
CREATE TRIGGER agent_sessions_coordinator_delete AFTER DELETE ON cross_repo_orchestrators
BEGIN DELETE FROM agent_sessions WHERE workspace_id = OLD.id AND entity_kind = 'coordinator'; END;
