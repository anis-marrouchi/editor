import { AGENT_OPERATIONS } from '@pascal-app/core/agent-operations'
import {
  captureRegistryVersions,
  effectIds,
  openDetachedScene,
  type SceneSnapshot,
  sceneDocumentOf,
} from '@pascal-app/core/runtime'
import { type AnyNode, BuildingNode, LevelNode, SiteNode } from '@pascal-app/core/schema'
import { MCP_CATALOG_ITEMS } from '@pascal-app/mcp/tools/asset-catalog'
import type { RoomReading } from './video-room'

// Runs in the browser: core's scene store is 'use client', so a route handler can't build the room.

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
    ids: effectIds(crypto.randomUUID()),
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

const round = (value: number) => Math.round(value * 100) / 100
