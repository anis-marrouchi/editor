import Link from 'next/link'
import { VideoRoomClient } from './video-room-client'

export const dynamic = 'force-dynamic'

/** `/video-room` — upload a walkthrough video of one room and get it back as an editable scene. */
export default function VideoRoomPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-border border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto flex items-center justify-between gap-4 px-6 py-4">
          <nav className="flex items-center gap-4 text-sm">
            <Link
              className="text-muted-foreground transition-colors hover:text-foreground"
              href="/"
            >
              Home
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="font-medium text-foreground">Room from video</span>
          </nav>
        </div>
      </header>

      <main className="container mx-auto max-w-2xl px-6 py-12">
        <h1 className="mb-2 font-bold text-3xl">Room from video</h1>
        <p className="mb-8 text-muted-foreground text-sm">
          Film one room, turning slowly so every wall, door and window is seen. Only a few frames
          leave your browser, to the vision model; the walls, doors and windows come back as an
          editable scene with rough sizes.
        </p>
        <VideoRoomClient />
      </main>
    </div>
  )
}
