import { describe, expect, test } from 'bun:test'
import { AnyNode } from '@pascal-app/core/schema'
import { buildRoomScene, parseRoomReading } from './video-room'

const answer = `\`\`\`json
{
  "name": "Bedroom",
  "roomType": "bedroom",
  "widthM": 4,
  "lengthM": 3.5,
  "heightM": 2.7,
  "walls": [
    { "doors": [{ "t": 0.2, "width": 0.9, "height": 2.1 }], "windows": [] },
    { "doors": [], "windows": [{ "t": 0.5, "width": 1.2, "height": 1.2, "sillHeight": 0.9 }] },
    { "doors": [], "windows": [] },
    { "doors": [], "windows": [] }
  ],
  "notes": "Ceiling height guessed from the door."
}
\`\`\``

describe('video room', () => {
  test('a fenced model answer parses', () => {
    const reading = parseRoomReading(answer)
    expect(reading.widthM).toBe(4)
    expect(reading.walls[1]!.windows[0]!.sillHeight).toBe(0.9)
  })

  test('the reading builds a valid, furnished scene with walls, the room, a door and a window', () => {
    const { graph, result, furnished } = buildRoomScene(parseRoomReading(answer))
    const nodes = Object.values(graph.nodes) as { type: string; parentId?: string | null }[]
    const count = (type: string) => nodes.filter((node) => node.type === type).length

    expect(result.ok).toBe(true)
    expect(count('site')).toBe(1)
    expect(count('wall')).toBe(4)
    expect(count('zone')).toBe(1)
    expect(count('door')).toBe(1)
    expect(count('window')).toBe(1)
    expect(furnished?.ok).toBe(true)
    expect(count('item')).toBeGreaterThan(0)
    for (const node of nodes) expect(AnyNode.safeParse(node).success).toBe(true)
  })
})
