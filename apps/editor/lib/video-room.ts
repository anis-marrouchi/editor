import { FURNISHED_ROOM_TYPES } from '@pascal-app/core/agent-tools'
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
