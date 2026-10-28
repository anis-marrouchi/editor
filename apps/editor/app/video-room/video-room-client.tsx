'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

const FRAME_COUNT = 8
const FRAME_WIDTH = 768

type Phase =
  | { kind: 'idle' }
  | { kind: 'working'; step: string }
  | { kind: 'error'; message: string }

/** Grabs evenly spaced JPEG frames from a local video file with <video> + canvas. */
async function grabFrames(file: File): Promise<string[]> {
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  const url = URL.createObjectURL(file)
  try {
    video.src = url
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new Error('This browser cannot read that video file.'))
    })
    const scale = Math.min(1, FRAME_WIDTH / video.videoWidth)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas is unavailable in this browser.')

    const frames: string[] = []
    for (let i = 0; i < FRAME_COUNT; i++) {
      video.currentTime = (video.duration * (i + 0.5)) / FRAME_COUNT
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve()
      })
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      frames.push(canvas.toDataURL('image/jpeg', 0.75))
    }
    return frames
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function VideoRoomClient() {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [preview, setPreview] = useState<string[]>([])

  async function handleFile(file: File) {
    try {
      setPhase({ kind: 'working', step: 'Reading frames from the video…' })
      const frames = await grabFrames(file)
      setPreview(frames)
      setPhase({ kind: 'working', step: 'Measuring the room (about 20 seconds)…' })
      const response = await fetch('/api/video-room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frames }),
      })
      const body = (await response.json().catch(() => ({}))) as { url?: string; message?: string }
      if (!response.ok || !body.url) {
        setPhase({
          kind: 'error',
          message: body.message ?? `The room could not be built (${response.status}).`,
        })
        return
      }
      setPhase({ kind: 'working', step: 'Opening the room…' })
      router.push(body.url)
    } catch (error) {
      setPhase({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border/60 bg-background p-6">
        <label className="mb-2 block font-medium text-muted-foreground text-xs uppercase">
          Room video
        </label>
        <input
          accept="video/*"
          className="block w-full text-sm"
          disabled={phase.kind === 'working'}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void handleFile(file)
          }}
          type="file"
        />
        {phase.kind === 'working' && <p className="mt-4 text-sm">{phase.step}</p>}
        {phase.kind === 'error' && <p className="mt-4 text-destructive text-sm">{phase.message}</p>}
      </div>
      {preview.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {preview.map((src, index) => (
            <img alt={`Frame ${index + 1}`} className="rounded-md" key={src} src={src} />
          ))}
        </div>
      )}
    </div>
  )
}
