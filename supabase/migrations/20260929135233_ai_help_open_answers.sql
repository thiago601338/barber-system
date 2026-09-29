-- Consultative replies share the same per-user quota and private history as plans.
-- Full replies live in result->>'answer'; summary remains a 500-character preview.
alter table public.ai_help_plans
  drop constraint ai_help_plans_status_check,
  drop constraint ai_help_plans_check,
  drop constraint ai_help_plans_prompt_check;

alter table public.ai_help_plans
  add constraint ai_help_plans_status_check
    check (status in ('processing','pending','completed','answered','unsupported','failed')),
  add constraint ai_help_plans_check
    check ((status in ('processing','answered','unsupported','failed')
      and action_type is null and action_values is null)
      or (status in ('pending','completed')
      and action_type is not null and action_values is not null)),
  add constraint ai_help_plans_answer_check
    check (status <> 'answered' or
      (result is not null and jsonb_typeof(result) = 'object'
       and jsonb_typeof(result->'answer') = 'string'
       and length(btrim(result->>'answer')) between 1 and 4000)),
  add constraint ai_help_plans_prompt_check
    check (length(btrim(prompt)) between 3 and 2000);
