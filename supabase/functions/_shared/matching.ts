// Matching helpers: when two spellings mean the same thing.

export const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9àèéìòù]+/g, ' ').trim()

/**
 * The same place written two ways ("Via Castel Cellesi, 6, 51100 Pistoia PT"
 * and "Via Castel Cellesi 6/8 — 51100 Pistoia (PT)") must be one location:
 * street name, first house number and postcode identify it.
 */
export function addressKey(address: string) {
  const plain = key(address)
  const street = plain.split(/\s\d/)[0]
  const number = plain.match(/\s(\d+)/)?.[1] ?? ''
  const postcode = plain.match(/\b(\d{5})\b/)?.[1] ?? ''
  return `${street}|${number}|${postcode}`
}
