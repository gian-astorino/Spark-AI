import type { SupabaseClient } from '@supabase/supabase-js'
import adCreation from './ad-creation.ts'
import adEditing from './ad-editing.ts'
import brandIdentity from './brand-identity.ts'
import businessResearch from './business-research.ts'
import callTranscripts from './call-transcripts.ts'
import campaignStrategy from './campaign-strategy.ts'
import onboarding from './onboarding.ts'
import strategyAdvice from './strategy-advice.ts'

// Everything Spark knows how to do lives in skills: what to aim for, how to
// judge, which tools to reach for. The agent sees each skill's name and
// description and loads the whole skill when a request calls for it. A new
// capability is a new skill file here, or a row in `agent_skills` (no deploy:
// it adds a skill or replaces the shipped one with the same name).

export interface Skill {
  /** kebab-case, how the agent asks for it. */
  name: string
  /** When to use it: the agent decides from this line alone. */
  description: string
  /** The instructions, in Markdown, read when the skill is loaded. */
  body: string
}

const SHIPPED: Skill[] = [
  onboarding,
  businessResearch,
  brandIdentity,
  callTranscripts,
  campaignStrategy,
  adCreation,
  adEditing,
  strategyAdvice,
]

/** The skills in force: the shipped ones, with the database's additions and overrides. */
export async function loadSkills(db: SupabaseClient): Promise<Skill[]> {
  const { data, error } = await db.from('agent_skills').select('name, description, body, enabled')
  if (error) console.error('Live skills could not be read', error)
  const skills = new Map(SHIPPED.map((skill) => [skill.name, skill]))
  for (const row of data ?? []) {
    if (row.enabled) skills.set(row.name, { name: row.name, description: row.description, body: row.body })
    else skills.delete(row.name)
  }
  return [...skills.values()].sort((a, b) => a.name.localeCompare(b.name))
}
