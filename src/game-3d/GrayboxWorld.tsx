import { Html, useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import type { Group, Object3D } from 'three'
import { Mesh, MeshStandardMaterial } from 'three'

import type { ScenarioDefinition, SimulationPhase } from '../simulation/types'
import { toWorldPosition } from './worldCoordinates'

interface GrayboxWorldProps {
  activeEntityId?: string
  flags: string[]
  nearbyEntityId?: string
  phase: SimulationPhase
  risk: number
  scenario: ScenarioDefinition
}

interface AnimatedModel {
  branchHandwheel?: Object3D
  leakMaterial?: MeshStandardMaterial
  leakSurface?: Object3D
  mainRotor?: Object3D
  model: Object3D
  backupRotor?: Object3D
}

export const MODEL_URL = '/models/safeops-lube-room.glb'
const WALL_NAMES = new Set(['north-wall', 'south-wall-left', 'south-wall-right', 'west-wall', 'east-wall'])

function FlowParticles({ protectedSupply, running }: { protectedSupply: boolean; running: boolean }) {
  const groupRef = useRef<Group>(null)

  useFrame(({ clock }) => {
    const group = groupRef.current
    if (!group) return
    const speed = running ? (protectedSupply ? 1.25 : 0.72) : 0.16
    group.children.forEach((particle, index) => {
      particle.position.x = -2.35 + ((clock.elapsedTime * speed + index * 1.22) % 8.25)
    })
  })

  return (
    <group ref={groupRef}>
      {Array.from({ length: 7 }, (_, index) => (
        <mesh key={index} position={[-2.35 + index * 1.22, 1.06, -2.56]}>
          <sphereGeometry args={[0.055, 10, 8]} />
          <meshBasicMaterial
            color={protectedSupply ? '#69edbd' : '#de8739'}
            transparent
            opacity={running ? 0.9 : 0.28}
          />
        </mesh>
      ))}
    </group>
  )
}

function HazardFeedback({ isolated, risk }: { isolated: boolean; risk: number }) {
  const ringRef = useRef<Mesh>(null)

  useFrame(({ clock }) => {
    const ring = ringRef.current
    if (!ring) return
    const pulse = isolated ? 1 : 0.92 + Math.sin(clock.elapsedTime * (2.4 + risk / 35)) * 0.13
    ring.scale.setScalar(pulse)
    ring.rotation.z += isolated ? 0 : 0.003
  })

  return (
    <group position={[5.625, 0.055, 1]}>
      <mesh ref={ringRef} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.78, 1.04, 36]} />
        <meshBasicMaterial
          color={isolated ? '#62d4ad' : '#ff5c52'}
          transparent
          opacity={isolated ? 0.24 : Math.min(0.82, 0.35 + risk / 180)}
          depthWrite={false}
        />
      </mesh>
      {!isolated && <pointLight color="#ff4b3d" distance={4.5} intensity={0.35 + risk / 85} position={[0, 0.75, 0]} />}
    </group>
  )
}

export function GrayboxWorld({ activeEntityId, flags, nearbyEntityId, phase, risk, scenario }: GrayboxWorldProps) {
  const { scene } = useGLTF(MODEL_URL)
  const animatedModel = useMemo<AnimatedModel>(() => {
    const clone = scene.clone(true)
    let leakMaterial: MeshStandardMaterial | undefined
    clone.traverse((object) => {
      if (object.name.endsWith('__COLLIDER')) {
        object.visible = false
        return
      }
      if (!(object instanceof Mesh)) return
      object.castShadow = true
      object.receiveShadow = true

      if (WALL_NAMES.has(object.name)) {
        object.scale.y = 0.42
        object.position.y = 0.67
        object.castShadow = false
      }

      if (object.name.endsWith('__floor-marker')) {
        object.visible = false
      }

      if (object.name === 'oil-leak__surface' && object.material instanceof MeshStandardMaterial) {
        leakMaterial = object.material.clone()
        object.material = leakMaterial
      }
    })

    return {
      model: clone,
      mainRotor: clone.getObjectByName('main-pump__rotor'),
      backupRotor: clone.getObjectByName('backup-pump__rotor'),
      branchHandwheel: clone.getObjectByName('branch-valve__handwheel'),
      leakSurface: clone.getObjectByName('oil-leak__surface'),
      leakMaterial,
    }
  }, [scene])
  const hasLeakScenario = scenario.entities.some((entity) => entity.id === 'oil-leak')
  const backupRunning = flags.includes('backup-running')
  const systemStopped = flags.includes('system-protected')
  const leakIsolated = flags.includes('leak-isolated')
  const supplyProtected = flags.includes('supply-protected')

  useEffect(() => {
    const leakRoot = animatedModel.model.getObjectByName('oil-leak')
    if (leakRoot) leakRoot.visible = hasLeakScenario
  }, [animatedModel, hasLeakScenario])

  useFrame(({ clock }, delta) => {
    if (phase === 'running' && !systemStopped && animatedModel.mainRotor) {
      animatedModel.mainRotor.rotation.x += delta * 8.5
    }
    if (phase === 'running' && backupRunning && animatedModel.backupRotor) {
      animatedModel.backupRotor.rotation.x += delta * 10.5
    }
    if (animatedModel.branchHandwheel) {
      const target = leakIsolated ? Math.PI / 2 : 0
      animatedModel.branchHandwheel.rotation.y += (target - animatedModel.branchHandwheel.rotation.y) * (1 - Math.exp(-6 * delta))
    }
    if (animatedModel.leakSurface && animatedModel.leakMaterial) {
      const targetScale = leakIsolated ? 0.34 : 0.96 + Math.sin(clock.elapsedTime * 2.8) * 0.035
      const damping = 1 - Math.exp(-3.8 * delta)
      animatedModel.leakSurface.scale.x += (targetScale - animatedModel.leakSurface.scale.x) * damping
      animatedModel.leakSurface.scale.z += (targetScale - animatedModel.leakSurface.scale.z) * damping
      const targetOpacity = leakIsolated ? 0.12 : Math.min(0.72, 0.42 + risk / 260)
      animatedModel.leakMaterial.opacity += (targetOpacity - animatedModel.leakMaterial.opacity) * damping
    }
  })

  return (
    <group>
      {/* Blender Y depth exports to negative Three.js Z; mirror only the model shell to match the existing world coordinates. */}
      <primitive object={animatedModel.model} scale={[1, 1, -1]} />
      <FlowParticles protectedSupply={supplyProtected} running={phase === 'running' && !systemStopped} />

      {backupRunning && (
        <mesh position={[-1.375, 1.32, 0.3125]}>
          <sphereGeometry args={[0.09, 14, 10]} />
          <meshStandardMaterial color="#61e8b5" emissive="#1e8d69" emissiveIntensity={2.2} />
        </mesh>
      )}
      {hasLeakScenario && <HazardFeedback isolated={leakIsolated} risk={risk} />}

      {scenario.entities.map((entity) => {
        const position = toWorldPosition(entity)
        const isHazard = entity.kind === 'hazard'
        const focused = entity.id === activeEntityId || entity.id === nearbyEntityId
        const labelHeight = isHazard ? 0.28 : entity.kind === 'instrument' ? 1.75 : entity.kind === 'cabinet' ? 2.05 : 1.5

        return (
          <group key={entity.id} position={[position.x, 0, position.z]}>
            {focused && (
              <mesh position={[0, 0.035, 0]} rotation-x={-Math.PI / 2}>
                <ringGeometry args={[0.72, 0.9, 32]} />
                <meshBasicMaterial
                  color={entity.id === activeEntityId ? '#70f0d2' : '#ffcb62'}
                  transparent
                  opacity={0.95}
                  depthWrite={false}
                />
              </mesh>
            )}
            <Html center distanceFactor={9} position={[0, labelHeight, 0]}>
              <span className="three-label">{entity.name}</span>
            </Html>
          </group>
        )
      })}
    </group>
  )
}

useGLTF.preload(MODEL_URL)
