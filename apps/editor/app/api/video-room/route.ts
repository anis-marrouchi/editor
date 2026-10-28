import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { guardSceneApiRequest, sceneApiJson, sceneApiPreflight } from '@/lib/scene-api-security'
import { getSceneOperations } from '@/lib/scene-store-server'
import { sessionPrincipal } from '@/lib/self-host-auth'
import { buildRoomScene, readRoomFromFrames } from '@/lib/video-room'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const requestSchema = z.object({
  name: z.string().min(1).max(200).optional(),
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

/** Video frames in, a saved scene of the room out: the vision model reads it, create_room builds it. */
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

  const { graph, result, furnished } = buildRoomScene(reading)
  const operations = await getSceneOperations()
  const meta = await operations.saveScene({
    name: parsed.data.name ?? `${reading.name} (from video)`,
    projectId: null,
    ownerId: sessionPrincipal(request),
    graph: graph as never,
    thumbnailUrl: null,
  })
  return sceneApiJson(
    request,
    { id: meta.id, url: `/project/${meta.id}`, reading, result, furnished },
    { status: 201 },
  )
}
