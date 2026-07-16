import { useAnimations, useGLTF } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Group, Object3D } from 'three'
import { Box3, Raycaster, Vector3 } from 'three'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'

import type { SimulationEngine } from '../simulation/SimulationEngine'
import { MODEL_URL } from './GrayboxWorld'
import type { CameraMode } from './ThreeScene'
import { toWorldPosition } from './worldCoordinates'

interface PlayerControllerProps {
  cameraMode: CameraMode
  engine: SimulationEngine
  onHoldProgressChange: (progress: number) => void
  onNearbyEntityChange: (entityId?: string) => void
  onPointerLockChange: (locked: boolean) => void
}

const WALK_SPEED = 3.15
const RUN_SPEED = 5.25
const PLAYER_RADIUS = 0.32
const WORLD_LIMIT_X = 8.55
const WORLD_LIMIT_Z = 5.05
const INTERACTION_HOLD_SECONDS = 0.7
const PLAYER_MODEL_URL = '/models/construction_worker.glb'

interface CollisionBox {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

function ignoresCameraCollision(object: Object3D) {
  let current: Object3D | null = object
  while (current) {
    if (current.userData.ignoreCameraCollision) return true
    current = current.parent
  }
  return object.name.endsWith('__COLLIDER')
    || object.name === 'room-floor'
    || object.name.endsWith('__floor-marker')
    || object.name.endsWith('__surface')
}

function WorkerAvatar({ moving, visible }: { moving: boolean; visible: boolean }) {
  const groupRef = useRef<Group>(null)
  const { animations, scene } = useGLTF(PLAYER_MODEL_URL)
  const model = useMemo(() => clone(scene), [scene])
  const inPlaceAnimations = useMemo(() => animations.map((clip) => {
    const nextClip = clip.clone()
    if (nextClip.name !== 'Armature|Walk') return nextClip

    const hipsPosition = nextClip.tracks.find((track) => (
      track.name.includes('mixamorig:Hips_01') && track.name.endsWith('.position')
    ))
    if (!hipsPosition) return nextClip

    const values = hipsPosition.values
    const initialX = values[0]
    const initialZ = values[2]
    for (let index = 0; index < values.length; index += 3) {
      values[index] = initialX
      values[index + 2] = initialZ
    }
    return nextClip
  }), [animations])
  const { actions } = useAnimations(inPlaceAnimations, groupRef)

  useEffect(() => {
    model.traverse((object) => {
      object.castShadow = true
      object.receiveShadow = true
    })
  }, [model])

  useEffect(() => {
    const nextName = moving ? 'Armature|Walk' : 'Armature|Victory_Idle'
    const next = actions[nextName]
    if (!next) return
    next.reset().setEffectiveWeight(1).play()
    if (moving) {
      next.paused = false
      next.fadeIn(0.18)
    } else {
      // Freeze the upright opening pose instead of playing a swaying idle clip.
      next.time = 0
      next.paused = true
      next.getMixer().update(0)
    }
    return () => {
      next.paused = false
      next.fadeOut(0.18)
    }
  }, [actions, moving])

  return (
    <group ref={groupRef} visible={visible} scale={0.01}>
      <primitive object={model} />
    </group>
  )
}

export function PlayerController({ cameraMode, engine, onHoldProgressChange, onNearbyEntityChange, onPointerLockChange }: PlayerControllerProps) {
  const state = useSyncExternalStore(engine.subscribe, engine.getSnapshot)
  const playerRef = useRef<Group>(null)
  const keys = useRef(new Set<string>())
  const holdSeconds = useRef(0)
  const cameraYaw = useRef(0)
  const cameraPitch = useRef(0)
  const targetCameraYaw = useRef(0)
  const targetCameraPitch = useRef(0)
  const nearbyEntityIdRef = useRef<string | undefined>(undefined)
  const enteredZoneIds = useRef(new Set<string>())
  const [nearbyEntityId, setNearbyEntityId] = useState<string>()
  const [holdProgress, setHoldProgress] = useState(0)
  const [moving, setMoving] = useState(false)
  const movingRef = useRef(false)
  const { scene: collisionScene } = useGLTF(MODEL_URL)
  const { camera, gl, scene: runtimeScene } = useThree()
  const movement = useMemo(() => new Vector3(), [])
  const desiredCamera = useMemo(() => new Vector3(), [])
  const lookTarget = useMemo(() => new Vector3(), [])
  const viewDirection = useMemo(() => new Vector3(), [])
  const cameraRight = useMemo(() => new Vector3(), [])
  const cameraAnchor = useMemo(() => new Vector3(), [])
  const cameraRay = useMemo(() => new Vector3(), [])
  const raycaster = useMemo(() => new Raycaster(), [])
  const fallbackObstacles = useMemo(
    () => engine.scenario.entities
      .filter((entity) => entity.kind !== 'hazard')
      .map((entity) => ({ ...toWorldPosition(entity), radius: entity.kind === 'pump' ? 0.78 : 0.62 })),
    [engine],
  )
  const collisionBoxes = useMemo<CollisionBox[]>(() => {
    collisionScene.updateMatrixWorld(true)
    const boxes: CollisionBox[] = []
    collisionScene.traverse((object) => {
      if (!object.name.endsWith('__COLLIDER')) return
      const bounds = new Box3().setFromObject(object)
      boxes.push({
        minX: bounds.min.x,
        maxX: bounds.max.x,
        minZ: -bounds.max.z,
        maxZ: -bounds.min.z,
      })
    })
    return boxes
  }, [collisionScene])

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => keys.current.add(event.key.toLowerCase())
    const keyUp = (event: KeyboardEvent) => keys.current.delete(event.key.toLowerCase())
    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    return () => {
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
    }
  }, [])

  useEffect(() => {
    const canvas = gl.domElement
    const requestControl = () => {
      if (!state.activeEntityId) void canvas.requestPointerLock()
    }
    const rotate = (event: MouseEvent) => {
      if (state.activeEntityId || document.pointerLockElement !== canvas) return
      targetCameraYaw.current -= event.movementX * 0.0022
      targetCameraPitch.current = Math.max(-0.92, Math.min(0.92, targetCameraPitch.current - event.movementY * 0.002))
    }
    const updateLockState = () => onPointerLockChange(document.pointerLockElement === canvas)
    canvas.addEventListener('click', requestControl)
    document.addEventListener('mousemove', rotate)
    document.addEventListener('pointerlockchange', updateLockState)
    return () => {
      canvas.removeEventListener('click', requestControl)
      document.removeEventListener('mousemove', rotate)
      document.removeEventListener('pointerlockchange', updateLockState)
    }
  }, [gl, onPointerLockChange, state.activeEntityId])

  useEffect(() => {
    onNearbyEntityChange(nearbyEntityId)
  }, [nearbyEntityId, onNearbyEntityChange])

  useEffect(() => {
    onHoldProgressChange(holdProgress)
  }, [holdProgress, onHoldProgressChange])

  useFrame((_, delta) => {
    const player = playerRef.current
    if (!player) return

    engine.tick(delta)
    const rotationDamping = 1 - Math.exp(-13 * delta)
    cameraYaw.current += (targetCameraYaw.current - cameraYaw.current) * rotationDamping
    cameraPitch.current += (targetCameraPitch.current - cameraPitch.current) * rotationDamping
    movement.set(0, 0, 0)
    if (state.phase === 'running' && !state.activeEntityId) {
      const horizontal = Number(keys.current.has('d')) - Number(keys.current.has('a'))
      const forward = Number(keys.current.has('w')) - Number(keys.current.has('s'))
      const yaw = cameraYaw.current
      movement.set(
        Math.cos(yaw) * horizontal - Math.sin(yaw) * forward,
        0,
        -Math.sin(yaw) * horizontal - Math.cos(yaw) * forward,
      )
    }

    if (movement.lengthSq() > 0) {
      movement.normalize()
      const speed = keys.current.has('shift') ? RUN_SPEED : WALK_SPEED
      const nextX = Math.max(-WORLD_LIMIT_X, Math.min(WORLD_LIMIT_X, player.position.x + movement.x * speed * delta))
      const nextZ = Math.max(-WORLD_LIMIT_Z, Math.min(WORLD_LIMIT_Z, player.position.z + movement.z * speed * delta))
      const collidesAt = (x: number, z: number) => collisionBoxes.length > 0
        ? collisionBoxes.some((box) => (
          x + PLAYER_RADIUS > box.minX
          && x - PLAYER_RADIUS < box.maxX
          && z + PLAYER_RADIUS > box.minZ
          && z - PLAYER_RADIUS < box.maxZ
        ))
        : fallbackObstacles.some((obstacle) => {
          const dx = x - obstacle.x
          const dz = z - obstacle.z
          return dx * dx + dz * dz < (PLAYER_RADIUS + obstacle.radius) ** 2
        })

      if (!collidesAt(nextX, player.position.z)) player.position.x = nextX
      if (!collidesAt(player.position.x, nextZ)) player.position.z = nextZ
      player.rotation.y = cameraYaw.current + Math.PI
    }

    const isMoving = movement.lengthSq() > 0
    if (movingRef.current !== isMoving) {
      movingRef.current = isMoving
      setMoving(isMoving)
    }

    const nearbyEntity = state.phase === 'running' && !state.activeEntityId
      ? engine.scenario.entities
        .map((entity) => {
          const position = toWorldPosition(entity)
          return { entity, distance: Math.hypot(player.position.x - position.x, player.position.z - position.z) }
        })
        .filter(({ entity, distance }) => distance <= entity.interactionRadius / 80)
        .sort((a, b) => a.distance - b.distance)[0]?.entity
      : undefined

    if (nearbyEntityIdRef.current !== nearbyEntity?.id) {
      nearbyEntityIdRef.current = nearbyEntity?.id
      setNearbyEntityId(nearbyEntity?.id)
      holdSeconds.current = 0
      setHoldProgress(0)
    }

    if (nearbyEntity && keys.current.has('e')) {
      holdSeconds.current += delta
      const progress = Math.min(100, Math.round((holdSeconds.current / INTERACTION_HOLD_SECONDS) * 100))
      if (Math.abs(progress - holdProgress) >= 5) setHoldProgress(progress)
      if (holdSeconds.current >= INTERACTION_HOLD_SECONDS) {
        engine.interact(nearbyEntity.id)
        keys.current.delete('e')
        holdSeconds.current = 0
        setHoldProgress(0)
      }
    } else if (holdSeconds.current > 0) {
      holdSeconds.current = 0
      setHoldProgress(0)
    }

    engine.scenario.zones.forEach((zone) => {
      const min = toWorldPosition({ x: zone.x, y: zone.y })
      const max = toWorldPosition({ x: zone.x + zone.width, y: zone.y + zone.height })
      const inside = player.position.x >= min.x && player.position.x <= max.x
        && player.position.z >= min.z && player.position.z <= max.z
      if (inside && !enteredZoneIds.current.has(zone.id)) engine.enterZone(zone.id)
      if (inside) enteredZoneIds.current.add(zone.id)
      else enteredZoneIds.current.delete(zone.id)
    })

    const yaw = cameraYaw.current
    const pitch = cameraPitch.current
    viewDirection.set(
      -Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch),
    )
    cameraRight.set(Math.cos(yaw), 0, -Math.sin(yaw))
    if (cameraMode === 'first-person') {
      desiredCamera.set(player.position.x, 1.55, player.position.z)
      lookTarget.copy(desiredCamera).addScaledVector(viewDirection, 6)
    } else {
      cameraAnchor.set(player.position.x, 1.25, player.position.z)
      desiredCamera.set(
        player.position.x + Math.sin(yaw) * 2.15 + cameraRight.x * 0.38,
        player.position.y + 1.95,
        player.position.z + Math.cos(yaw) * 2.15 + cameraRight.z * 0.38,
      )
      lookTarget.set(player.position.x, 1.25, player.position.z).addScaledVector(viewDirection, 6)

      cameraRay.copy(desiredCamera).sub(cameraAnchor)
      const desiredDistance = cameraRay.length()
      raycaster.set(cameraAnchor, cameraRay.normalize())
      raycaster.near = 0.2
      raycaster.far = desiredDistance
      runtimeScene.updateMatrixWorld()
      const obstruction = raycaster
        .intersectObjects(runtimeScene.children, true)
        .find((intersection) => !ignoresCameraCollision(intersection.object))
      if (obstruction) {
        desiredCamera.copy(cameraAnchor).addScaledVector(cameraRay, Math.max(0.72, obstruction.distance - 0.22))
      }
    }
    camera.position.lerp(desiredCamera, 1 - Math.exp(-11 * delta))
    camera.lookAt(lookTarget)
  })

  return (
    <group
      ref={playerRef}
      position={[-2.6, 0, 3.75]}
      rotation={[0, Math.PI, 0]}
      userData={{ ignoreCameraCollision: true }}
    >
      <WorkerAvatar moving={moving} visible={cameraMode === 'third-person'} />
    </group>
  )
}

useGLTF.preload(PLAYER_MODEL_URL)
