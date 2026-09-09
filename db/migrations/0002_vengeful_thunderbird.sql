CREATE TABLE `mcp_audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text,
	`tool_name` text NOT NULL,
	`scope` text,
	`params_summary` text,
	`status` text NOT NULL,
	`error_message` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mcp_audit_logs_client_idx` ON `mcp_audit_logs` (`client_id`);--> statement-breakpoint
CREATE INDEX `mcp_audit_logs_created_idx` ON `mcp_audit_logs` (`created_at`);--> statement-breakpoint
CREATE TABLE `mcp_authorization_codes` (
	`code` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`code_challenge` text NOT NULL,
	`code_challenge_method` text DEFAULT 'S256' NOT NULL,
	`scope` text DEFAULT 'schedule:read' NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `mcp_clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mcp_auth_codes_client_idx` ON `mcp_authorization_codes` (`client_id`);--> statement-breakpoint
CREATE INDEX `mcp_auth_codes_expires_idx` ON `mcp_authorization_codes` (`expires_at`);--> statement-breakpoint
CREATE TABLE `mcp_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`client_secret` text,
	`client_name` text,
	`redirect_uris` text NOT NULL,
	`grant_types` text,
	`response_types` text,
	`token_endpoint_auth_method` text DEFAULT 'none',
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mcp_clients_created_idx` ON `mcp_clients` (`created_at`);--> statement-breakpoint
CREATE TABLE `mcp_refresh_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`client_id` text NOT NULL,
	`family_id` text NOT NULL,
	`scope` text DEFAULT 'schedule:read' NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`last_used_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `mcp_clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_refresh_tokens_hash_idx` ON `mcp_refresh_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `mcp_refresh_tokens_family_idx` ON `mcp_refresh_tokens` (`family_id`);--> statement-breakpoint
CREATE INDEX `mcp_refresh_tokens_client_idx` ON `mcp_refresh_tokens` (`client_id`);