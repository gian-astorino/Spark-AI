import type { SupabaseClient } from '@supabase/supabase-js'
import { checkImageJob, startImageJob } from './image-jobs.ts'

// The images of the ads: each one an OpenAI background job, moved on by
// whoever looks next (the agent's steps, the app's poll). Done, it goes to the
// `creatives` bucket, one folder per business and ad. A row put back to
// 'running' without a job is started again from its prompt.

/** Moves every image still running for the business; returns how many are still running. */
export async function checkAdImages(db: SupabaseClient, businessId: string): Promise<number> {
  const { data: running } = await db
    .from('ad_images')
    .select('id, ad_id, job_id, prompt, size')
    .eq('business_id', businessId)
    .eq('status', 'running')
  let left = 0
  await Promise.all(
    (running ?? []).map(async (image) => {
      // Queued without a job (an image put back to be made again): started now, from its prompt.
      if (!image.job_id) {
        try {
          const jobId = await startImageJob({ prompt: image.prompt, action: 'generate', size: image.size ?? '2048x2048' })
          await db.from('ad_images').update({ job_id: jobId }).eq('id', image.id)
          left++
        } catch (failure) {
          await db.from('ad_images').update({ status: 'failed', error: `start: ${String(failure)}`.slice(0, 2000) }).eq('id', image.id)
        }
        return
      }
      // A check that fails to reach OpenAI is tried again next time.
      const state = await checkImageJob(image.job_id).catch((failure) => {
        console.error('Ad image check failed', failure)
        return { status: 'running' as const }
      })
      try {
        if (state.status === 'running') {
          left++
          return
        }
        if (state.status === 'failed') {
          await db.from('ad_images').update({ status: 'failed', error: state.error.slice(0, 2000) }).eq('id', image.id)
          return
        }
        const path = `${businessId}/${image.ad_id}/${image.id}.png`
        const { error } = await db.storage.from('creatives').upload(path, state.png, { contentType: 'image/png', upsert: true })
        if (error) throw error
        await db.from('ad_images').update({ status: 'done', path }).eq('id', image.id)
        await db.from('ads').update({ updated_at: new Date().toISOString() }).eq('id', image.ad_id)
      } catch (failure) {
        console.error('Ad image could not be stored', failure)
        await db.from('ad_images').update({ status: 'failed', error: String(failure).slice(0, 2000) }).eq('id', image.id)
      }
    }),
  )
  return left
}
