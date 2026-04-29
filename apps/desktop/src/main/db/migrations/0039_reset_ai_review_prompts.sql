-- Reset any custom review/solve prompts so users see the new richer defaults.
-- The previous defaults were ~30 words; the new defaults are full structured prompts
-- with persona, confidence rubric, false-positive denylist, and worked examples.
-- A user whose stored value was the old default would otherwise be stuck with it,
-- and a user with a focus-only override would be missing the new framework rules.
UPDATE `ai_review_settings` SET `custom_prompt` = NULL, `solve_prompt` = NULL;
