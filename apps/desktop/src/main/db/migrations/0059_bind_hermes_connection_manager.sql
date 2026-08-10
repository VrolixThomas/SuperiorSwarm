ALTER TABLE `hermes_connections` ADD `manager_id` text REFERENCES cross_repo_orchestrators(id) ON DELETE SET NULL;
