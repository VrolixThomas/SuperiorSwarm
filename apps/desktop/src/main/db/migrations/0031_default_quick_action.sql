INSERT OR IGNORE INTO `quick_actions` (`id`, `project_id`, `label`, `command`, `cwd`, `shortcut`, `sort_order`, `created_at`, `updated_at`)
VALUES ('default-claude-skip-perms', NULL, 'claude', 'claude --dangerously-skip-permissions', NULL, NULL, 0, unixepoch(), unixepoch());
