import { useEffect, useRef, useState } from 'react'
import { ensureSession, supabase } from '../lib/supabase.ts'
import type { Profile } from './profile.ts'
import type { ImportRequest } from './types.ts'

export type ImportStatus = 'idle' | 'running' | 'done' | 'failed' | 'skipped'

const POLL_MS = 1500

/**
 * Starts the website crawl and follows its job until it settles. Creates the
 * business on the way: the crawl is the first thing that needs one.
 */
export function useImport(request: ImportRequest) {
  const [status, setStatus] = useState<ImportStatus>(request.source === 'website' ? 'running' : 'idle')
  const [pagesRead, setPagesRead] = useState(0)
  const [branding, setBranding] = useState<Profile['branding']>()
  const started = useRef(false) // StrictMode runs effects twice: one crawl only
  const stopped = useRef(false)

  useEffect(() => {
    if (request.source !== 'website' || started.current) return
    started.current = true

    run(request.target).catch((error) => {
      console.error(error)
      if (!stopped.current) setStatus('failed')
    })

    async function run(url: string) {
      const user = await ensureSession()
      const { data: business, error } = await supabase
        .from('businesses')
        .insert({ owner_id: user.id, website_url: url })
        .select('id')
        .single()
      if (error) throw error

      const { data: started, error: startError } = await supabase.functions.invoke('import', {
        body: { business_id: business.id },
      })
      if (startError) throw startError

      while (!stopped.current) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS))
        const { data: job } = await supabase
          .from('import_jobs')
          .select('status, pages_read')
          .eq('id', started.job_id)
          .single()
        if (!job || job.status === 'running' || job.status === 'queued') continue
        if (stopped.current) return
        setPagesRead(job.pages_read)
        if (job.status === 'done') setBranding(await loadBranding(business.id))
        setStatus(job.status === 'done' ? 'done' : 'failed')
        return
      }
    }
  }, [request])

  return {
    status,
    pagesRead,
    branding,
    skip: () => {
      stopped.current = true
      setStatus('skipped')
    },
  }
}

async function loadBranding(businessId: string): Promise<Profile['branding']> {
  const [{ data: brand }, { data: colors }] = await Promise.all([
    supabase.from('brand_profiles').select('logo_path, logo_source_url, tone_of_voice').eq('business_id', businessId).maybeSingle(),
    supabase.from('brand_colors').select('name, hex').eq('business_id', businessId).order('position'),
  ])
  if (!brand && !colors?.length) return undefined

  let logoUrl = brand?.logo_source_url ?? undefined
  if (brand?.logo_path) {
    const { data } = await supabase.storage.from('logos').createSignedUrl(brand.logo_path, 60 * 60)
    logoUrl = data?.signedUrl ?? logoUrl
  }
  return {
    logoUrl,
    colors: (colors ?? []).map((color) => ({ name: color.name ?? '', hex: color.hex })),
    tone: brand?.tone_of_voice ?? [],
  }
}
