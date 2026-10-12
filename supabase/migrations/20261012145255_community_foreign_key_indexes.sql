-- Cover account deletion and device lookup foreign keys found by the database advisor.
create index if not exists device_push_tokens_user on public.device_push_tokens(user_id);
create index if not exists moderation_actions_moderator on private.moderation_actions(moderator_id);
create index if not exists moderation_actions_report on private.moderation_actions(report_id);
