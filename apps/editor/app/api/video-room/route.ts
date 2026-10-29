import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { guardSceneApiRequest, sceneApiJson, sceneApiPreflight } from '@/lib/scene-api-security'
import { readRoomFromFrames } from '@/lib/video-room'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const requestSchema = z.object({
  // JPEG data URLs the browser grabbed from the video, in order.
  frames: z
    .array(
      z
        .string()
        .regex(/^data:image\/jpeg;base64,/)
        .max(2_000_000),
    )
    .min(1)
    .max(12),
})

export function OPTIONS(request: NextRequest) {
  return sceneApiPreflight(request)
}

/** Video frames in, the vision model's reading of the room out; the browser builds and saves the scene. */
export async function POST(request: NextRequest) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard

  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return sceneApiJson(
      request,
      { error: 'invalid_request', details: parsed.error.issues },
      { status: 400 },
    )
  }

  let reading: Awaited<ReturnType<typeof readRoomFromFrames>>
  try {
    reading = await readRoomFromFrames(parsed.data.frames)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return sceneApiJson(request, { error: 'vision_failed', message }, { status: 502 })
  }

  return sceneApiJson(request, { reading })
}
