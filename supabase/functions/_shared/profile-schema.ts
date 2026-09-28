import { z } from 'zod'

// What the model extracts from the website. Mirrors the profile tables; anything
// the site does not say is null or an empty list, never invented.

const Hours = z.object({
  weekday: z.number().int().describe('ISO weekday: 1 = Monday … 7 = Sunday'),
  opens_at: z.string().describe('24h time, HH:MM'),
  closes_at: z.string().describe('24h time, HH:MM'),
})

export const ExtractedProfile = z.object({
  business: z.object({
    name: z.string().nullable(),
    description: z.string().nullable().describe('One or two sentences, in the language of the site'),
    sector: z.string().nullable().describe('Short label, e.g. "Beauty & skincare", "Hair salon"'),
  }),
  locations: z.array(
    z.object({
      name: z.string().nullable(),
      address: z.string(),
      hours: z.array(Hours).describe('One entry per open interval; closed days have none'),
    }),
  ),
  tone_of_voice: z.array(z.string()).describe('Three to five adjectives describing how the site talks'),
  catalog: z.array(
    z.object({
      name: z.string(),
      description: z.string().nullable(),
      category: z.string().nullable(),
      price_cents: z.number().int().nullable().describe('Price in cents; null if not stated'),
      duration_minutes: z.number().int().nullable().describe('Null if not stated'),
    }),
  ),
})
export type ExtractedProfile = z.infer<typeof ExtractedProfile>

export const PagePicks = z.object({
  urls: z.array(z.string()).describe('At most 6 URLs, most useful first'),
})
