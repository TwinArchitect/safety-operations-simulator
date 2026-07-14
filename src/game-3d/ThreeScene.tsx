import { Canvas } from '@react-three/fiber'
import { useState, useSyncExternalStore } from 'react'

import type { SimulationEngine } from '../simulation/SimulationEngine'
import { GrayboxWorld } from './GrayboxWorld'
import { PlayerController } from './PlayerController'

interface ThreeSceneProps {
  cameraMode: CameraMode
  engine: SimulationEngine
}

export type CameraMode = 'first-person' | 'third-person'

export function ThreeScene({ cameraMode, engine }: ThreeSceneProps) {
  const state = useSyncExternalStore(engine.subscribe, engine.getSnapshot)
  const [nearbyEntityId, setNearbyEntityId] = useState<string>()
  const [holdProgress, setHoldProgress] = useState(0)
  const [pointerLocked, setPointerLocked] = useState(false)
  const nearbyEntity = engine.scenario.entities.find((entity) => entity.id === nearbyEntityId)

  return (
    <>
      <Canvas camera={{ position: [-1.9, 3.35, 8.9], fov: 56 }} dpr={[1, 1.5]} gl={{ antialias: true }} shadows>
        <color attach="background" args={['#071116']} />
        <fog attach="fog" args={['#071116', 14, 25]} />
        <ambientLight intensity={0.42} />
        <hemisphereLight args={['#9cc9da', '#11191d', 0.72]} />
        <directionalLight
          castShadow
          color="#d5edf6"
          intensity={1.45}
          position={[-6, 10, 4]}
          shadow-bias={-0.00015}
          shadow-mapSize-height={2048}
          shadow-mapSize-width={2048}
          shadow-normalBias={0.035}
        />
        <directionalLight color="#ef914b" intensity={0.28} position={[7, 4, -5]} />
        <GrayboxWorld
          activeEntityId={state.activeEntityId}
          flags={state.flags}
          nearbyEntityId={nearbyEntityId}
          phase={state.phase}
          risk={state.risk}
          scenario={engine.scenario}
        />
        <PlayerController
          engine={engine}
          cameraMode={cameraMode}
          onHoldProgressChange={setHoldProgress}
          onNearbyEntityChange={setNearbyEntityId}
          onPointerLockChange={setPointerLocked}
        />
      </Canvas>
      {cameraMode === 'first-person' && !state.activeEntityId && <span className="three-crosshair" aria-hidden="true" />}
      {!pointerLocked && !state.activeEntityId && (
        <div className="three-pointer-hint">点击场景进入{cameraMode === 'first-person' ? '第一' : '第三'}人称控制</div>
      )}
      {nearbyEntity && !state.activeEntityId && (
        <div className="three-use-prompt">
          <strong>{holdProgress > 0 ? `检查中 ${holdProgress}%` : `按住 E · ${nearbyEntity.name}`}</strong>
          <i style={{ transform: `scaleX(${holdProgress / 100})` }} />
        </div>
      )}
    </>
  )
}
