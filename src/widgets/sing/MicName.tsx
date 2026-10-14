import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { deviceDisplayName, isLoopbackLabel } from '@/audio/input/devices'
import { inputManager } from '@/audio/input/inputManager'

/** The microphone in use, with a link to change it (a loopback channel is flagged: it records nothing you sing). */
export function MicName() {
  const [current, setCurrent] = useState(inputManager.current)
  useEffect(() => inputManager.onChange(setCurrent), [])
  if (!current) return null
  const loop = isLoopbackLabel(current.label)
  return (
    <Link
      to="/settings#audio-devices"
      className={`max-w-[16rem] truncate text-xs underline-offset-2 hover:underline ${loop ? 'text-amber' : 'text-muted-foreground'}`}
      title="在「设置 → 音频设备」里换麦克风"
    >
      {deviceDisplayName(current.label)}
      {loop ? '（内录通道，录不到你的声音，点这里换）' : ''}
    </Link>
  )
}
