import type { Skill } from './index.ts'

export default {
  name: 'call-transcripts',
  description:
    'Transcripts of calls with the client, pasted in the chat or attached (PDF, TXT, DOCX): keep them in Conversazioni and use what they say. Use it whenever a message looks like a transcript (speakers and lines, sometimes timestamps).',
  body: `# Call transcripts

A call with the client is the richest source there is: what they said in it wins over older data, unless it is unclear.

1. Save it once with save_call_transcript: the attachment id if it is a file, null if it is pasted in the message. Write a short Italian title, the date only if stated, the participants, a summary of two to four sentences and the key points (services, prices, hours, team, goals, doubts).
2. Use what the call says to fill or correct the profile with the other tools (origin "owner").
3. Goals, budgets, audiences, objections and ideas for campaigns that came up are worth keeping for later: save them with save_note (kind "memory") when they do not fit the profile.
4. Answer with a short note of what you updated, then continue with the next gap or the next step.

Earlier calls can be read with read_context ("calls", then "call" with its id).`,
} satisfies Skill
