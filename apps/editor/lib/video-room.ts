import { randomUUID } from 'node:crypto'
import { AGENT_OPERATIONS } from '@pascal-app/core/agent-operations'
import { FURNISHED_ROOM_TYPES } from '@pascal-app/core/agent-tools'
import {
  captureRegistryVersions,
  effectIds,
  openDetachedScene,
  type SceneSnapshot,
  sceneDocumentOf,
} from '@pascal-app/core/runtime'
import { type AnyNode, BuildingNode, LevelNode, SiteNode } from '@pascal-app/core/schema'
import { MCP_CATALOG_ITEMS } from '@pascal-app/mcp/tools/asset-catalog'
import { z } from 'zod'

const Opening = z.object({
  // Centre of the opening along the wall, 0 = left end, 1 = right end, seen from inside the room.
  t: z.number().min(0).max(1),
  width: z.number().positive().max(6),
  height: z.number().positive().max(4),
  sillHeight: z.number().min(0).max(3).optional(),
})

const Wall = z.object({
  doors: z.array(Opening).max(4).default([]),
  windows: z.array(Opening).max(6).default([]),
})

/** What the vision model reads off the video: a rectangular room and its four walls in order. */
export const RoomReading = z.object({
  name: z.string().min(1).max(80),
  // What the room is for; furnish_room puts the catalog's set for it in, no image-to-3D.
  roomType: z.enum(FURNISHED_ROOM_TYPES).optional(),
  widthM: z.number().min(1).max(30),
  lengthM: z.number().min(1).max(30),
  heightM: z.number().min(2).max(6),
  walls: z.array(Wall).length(4),
  notes: z.string().optional(),
})
export type RoomReading = z.infer<typeof RoomReading>

export const VIDEO_ROOM_PROMPT = `These are frames, in order, from a phone video that walks around one room.
Estimate the room as a rectangle and return ONLY this JSON, no prose, no markdown:

{
  "name": string,            // e.g. "Bedroom"
  "roomType": string,        // one of: ${FURNISHED_ROOM_TYPES.join(', ')}
  "widthM": number,          // length of wall 1 and wall 3, metres
  "lengthM": number,         // length of wall 2 and wall 4, metres
  "heightM": number,         // floor to ceiling, metres
  "walls": [                 // exactly 4: wall 1 is the wall the video first faces, then turning RIGHT each time
    { "doors":   [{ "t": number, "width": number, "height": number }],
      "windows": [{ "t": number, "width": number, "height": number, "sillHeight": number }] }
  ],
  "notes": string            // one short sentence on what was uncertain
}

"t" is the centre of the opening along the wall, from 0 at its left end to 1 at its right end, as seen standing inside the room facing that wall.
Use the usual sizes of doors (about 0.9 x 2.1 m), beds, tiles and ceilings to judge scale. Rough sizes are fine; never omit a field.`

/** The rectangle's corners in the order create_room walks them: edge i is wall i + 1, left to right from inside. */
export function roomPolygon(reading: RoomReading): [number, number][] {
  const w = round(reading.widthM)
  const l = round(reading.lengthM)
  return [
    [0, 0],
    [w, 0],
    [w, l],
    [0, l],
  ]
}

/** Builds a new site → building → level scene holding the room, through core's create_room. */
export function buildRoomScene(reading: RoomReading) {
  const level = LevelNode.parse({ level: 0, height: reading.heightM })
  const building = BuildingNode.parse({ children: [level.id] })
  const site = SiteNode.parse({ children: [building.id] })
  const nodes = Object.fromEntries(
    [site, { ...building, parentId: site.id }, { ...level, parentId: building.id }].map((node) => [
      node.id,
      node,
    ]),
  ) as Record<AnyNode['id'], AnyNode>
  const snapshot = {
    nodes,
    rootNodeIds: [site.id],
    collections: {},
    materials: {},
    installedPlugins: [],
  } as SceneSnapshot

  const scene = openDetachedScene(snapshot, {
    base: { kind: 'authority', seq: 1 },
    context: {
      activeLevelId: level.id,
      selection: [],
      units: 'metric',
      catalogVersion: 'video-room',
      registryVersions: captureRegistryVersions(),
    },
    ids: effectIds(randomUUID()),
  })
  try {
    const openings = (kind: 'doors' | 'windows') =>
      reading.walls.flatMap((wall, wallIndex) =>
        wall[kind].map((opening) => ({ wallIndex, ...opening })),
      )
    const result = scene.execute(
      AGENT_OPERATIONS.create_room as never,
      {
        name: reading.name,
        polygon: roomPolygon(reading),
        wallHeight: reading.heightM,
        doors: openings('doors'),
        windows: openings('windows'),
      } as never,
      { activeLevelId: level.id },
    )
    const furnished = reading.roomType
      ? scene.execute(
          AGENT_OPERATIONS.furnish_room as never,
          { zoneId: result.zoneId as string, roomType: reading.roomType } as never,
          { activeLevelId: level.id, catalog: MCP_CATALOG_ITEMS },
        )
      : null
    const { nodes, rootNodeIds, collections } = sceneDocumentOf(scene.store)
    return { graph: structuredClone({ nodes, rootNodeIds, collections }), result, furnished }
  } finally {
    scene.dispose()
  }
}

/** Asks an OpenAI-compatible vision model (OpenRouter by default) to read the room off the frames. */
export async function readRoomFromFrames(frames: string[]): Promise<RoomReading> {
  const apiKey = process.env.VIDEO_ROOM_API_KEY
  if (!apiKey) throw new Error('VIDEO_ROOM_API_KEY is not set')
  const baseUrl = process.env.VIDEO_ROOM_BASE_URL ?? 'https://openrouter.ai/api/v1'
  const model = process.env.VIDEO_ROOM_MODEL ?? 'anthropic/claude-sonnet-5.5'

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0,
      // Reasoning models think first: 1500 tokens went on thinking and left no JSON.
      max_tokens: 6000,
      messages: [
        {
          role: 'user',
          content: [
            ...frames.map((url) => ({ type: 'image_url', image_url: { url } })),
            { type: 'text', text: VIDEO_ROOM_PROMPT },
          ],
        },
      ],
    }),
  })
  if (!response.ok) {
    throw new Error(
      `vision model answered ${response.status}: ${(await response.text()).slice(0, 300)}`,
    )
  }
  const body = (await response.json()) as { choices?: { message?: { content?: string } }[] }
  return parseRoomReading(body.choices?.[0]?.message?.content ?? '')
}

/** Parses the model's answer, tolerating a markdown fence around the JSON. */
export function parseRoomReading(text: string): RoomReading {
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  return RoomReading.parse(JSON.parse(json))
}

const round = (value: number) => Math.round(value * 100) / 100
