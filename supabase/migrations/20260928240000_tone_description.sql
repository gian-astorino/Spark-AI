-- Tone of voice as a description that can actually guide writing (how the
-- business addresses clients, register, vocabulary, emoji, style), next to
-- the few keywords in tone_of_voice.
alter table brand_profiles add column tone_description text;
