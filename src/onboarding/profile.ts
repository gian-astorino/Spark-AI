import { displayUrl, type ImportRequest } from './types.ts'

// Mock only: the real scraping returns this shape.

export const SECTIONS = ['company', 'branding', 'locations', 'catalog'] as const
export type Section = (typeof SECTIONS)[number]

export const SECTION_TITLES: Record<Section, string> = {
  company: 'Company info',
  branding: 'Branding',
  locations: 'Locations & hours',
  catalog: 'Catalog',
}

export interface Profile {
  company: { name: string; description: string; founded: string; source: string; phone: string; email: string }
  branding: { colors: { name: string; hex: string }[]; fonts: string[]; tone: string[] }
  locations: { name: string; address: string; hours: { days: string; time: string }[] }[]
  catalog: { name: string; category: string; price: string }[]
}

export function mockProfile(request: ImportRequest): Profile {
  return {
    company: {
      name: 'Studio Bellezza',
      description: 'Independent skincare studio focused on facial treatments and personalised routines.',
      founded: '2016',
      source: request.source === 'instagram' ? `@${request.target}` : displayUrl(request.target),
      phone: '+39 02 1234 5678',
      email: 'ciao@studiobellezza.it',
    },
    branding: {
      colors: [
        { name: 'Blush', hex: '#E8B4B8' },
        { name: 'Sand', hex: '#EED6C4' },
        { name: 'Ink', hex: '#2B2D42' },
      ],
      fonts: ['Playfair Display', 'Inter'],
      tone: ['Warm', 'Expert', 'Reassuring'],
    },
    locations: [
      {
        name: 'Milano Tortona',
        address: 'Via Tortona 12, 20144 Milano',
        hours: [
          { days: 'Mon – Fri', time: '09:00 – 19:00' },
          { days: 'Sat', time: '09:00 – 14:00' },
          { days: 'Sun', time: 'Closed' },
        ],
      },
      {
        name: 'Monza Centro',
        address: 'Via Italia 40, 20900 Monza',
        hours: [
          { days: 'Tue – Sat', time: '10:00 – 18:30' },
          { days: 'Sun – Mon', time: 'Closed' },
        ],
      },
    ],
    catalog: [
      { name: 'Hydrating facial', category: 'Facials', price: '€70' },
      { name: 'Chemical peel', category: 'Facials', price: '€90' },
      { name: 'LED therapy', category: 'Treatments', price: '€50' },
      { name: 'Autumn reset package', category: 'Packages', price: '€240' },
    ],
  }
}
