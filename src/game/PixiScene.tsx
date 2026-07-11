import { useEffect, useRef } from 'react'
import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js'
import type { SimulationEngine } from '../simulation/SimulationEngine'
import type { ScenarioEntity, ScenarioFaultType, ScenarioZone, SimulationState } from '../simulation/types'
import { getDeviceAssetSpec, loadDeviceTextures, loadEnvironmentTextures, loadPlayerTexture, loadSceneBackground, type EnvironmentAssetId } from './sceneAssets'

interface PixiSceneProps {
  engine: SimulationEngine
}

const WIDTH = 900
const HEIGHT = 580
const WORLD_WIDTH = 1586
const WORLD_HEIGHT = 992
const PLAYER_RADIUS = 15
const PLAYER_SPEED = 3.6
const PLAYER_START = { x: 790, y: 835 }

const obstacles = [
  { x: 170, y: 175, width: 390, height: 390 },
  { x: 770, y: 330, width: 190, height: 225 },
  { x: 1090, y: 260, width: 400, height: 380 },
  { x: 40, y: 610, width: 255, height: 190 },
  { x: 1280, y: 655, width: 205, height: 225 },
]

const colors = {
  wall: 0x27323a,
  floor: 0x111c22,
  grid: 0x1c2a31,
  teal: 0x38d6b5,
  amber: 0xffb24a,
  red: 0xff5c5c,
  blue: 0x56a8ff,
  muted: 0x6f7f87,
}

interface DeviceView {
  container: Container
  body: Graphics
  motion: Graphics
  valueLabel?: Text
  sprite?: Sprite
  embedded?: boolean
}

interface EnvironmentEffects {
  flowDots: Graphics[]
  leak: Graphics
  alarm: Graphics
  alarmRing: Graphics
}

export function PixiScene({ engine }: PixiSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let disposed = false
    const app = new Application()
    const keys = new Set<string>()

    const init = async () => {
      await app.init({
        width: WIDTH,
        height: HEIGHT,
        backgroundColor: colors.floor,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio, 2),
      })

      if (disposed) {
        app.destroy(true)
        return
      }

      host.appendChild(app.canvas)
      app.canvas.setAttribute('aria-label', '二维安全操作训练场景')
      app.canvas.setAttribute('role', 'application')

      const world = new Container()
      app.stage.addChild(world)
      const [playerTexture, sceneBackground] = await Promise.all([
        loadPlayerTexture(),
        loadSceneBackground(),
      ])
      let deviceTextures = new Map<string, Texture>()
      if (sceneBackground) {
        const background = new Sprite(sceneBackground)
        background.width = WORLD_WIDTH
        background.height = WORLD_HEIGHT
        world.addChild(background)
      } else {
        const [fallbackDevices, environmentTextures] = await Promise.all([
          loadDeviceTextures(),
          loadEnvironmentTextures(),
        ])
        deviceTextures = fallbackDevices
        drawRoom(world, engine.scenario.zones, environmentTextures)
      }
      const effects = createEnvironmentEffects(world, Boolean(sceneBackground))

      const deviceViews = new Map<string, DeviceView>()
      engine.scenario.entities.forEach((entity) => {
        const view = createDevice(entity, deviceTextures.get(entity.id), Boolean(sceneBackground))
        view.container.x = entity.x
        view.container.y = entity.y
        deviceViews.set(entity.id, view)
        world.addChild(view.container)
      })

      const player = createPlayer(playerTexture)
      const playerSprite = player.getChildByLabel('player-sprite') as Sprite | undefined
      player.x = PLAYER_START.x
      player.y = PLAYER_START.y
      world.addChild(player)

      const prompt = createPrompt()
      prompt.visible = false
      world.addChild(prompt)

      let nearbyEntity: ScenarioEntity | undefined
      let currentZoneIds = new Set<string>()
      let previousPhase = engine.getSnapshot().phase
      let elapsedAnimation = 0
      let interactionHold = 0
      let heldEntityId: string | undefined

      const renderState = () => {
        const state = engine.getSnapshot()
        if (state.phase === 'ready' && previousPhase !== 'ready') {
          player.x = PLAYER_START.x
          player.y = PLAYER_START.y
          currentZoneIds = new Set()
        }
        previousPhase = state.phase
        engine.scenario.entities.forEach((entity) => {
          const view = deviceViews.get(entity.id)
          if (!view) return
          if (view.embedded) return
          const completed = entity.actions.some((action) =>
            state.completedActionIds.includes(action.id),
          )
          redrawDevice(view.body, entity, completed)
        })
      }

      const unsubscribe = engine.subscribe(renderState)
      renderState()

      const onKeyDown = (event: KeyboardEvent) => {
        const key = event.key.toLowerCase()
        if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd', 'e'].includes(key)) {
          event.preventDefault()
        }
        keys.add(key)
        if (key === 'r') engine.reset()
      }

      const onKeyUp = (event: KeyboardEvent) => keys.delete(event.key.toLowerCase())
      window.addEventListener('keydown', onKeyDown)
      window.addEventListener('keyup', onKeyUp)

      app.ticker.add((ticker) => {
        const state = engine.getSnapshot()
        elapsedAnimation += ticker.deltaMS / 1000
        updateEnvironmentEffects(effects, state, engine.scenario.faultType, elapsedAnimation)
        engine.scenario.entities.forEach((entity) => {
          const view = deviceViews.get(entity.id)
          if (view) updateDeviceMotion(
            view,
            entity,
            state,
            engine.scenario.faultType,
            ticker.deltaTime,
            elapsedAnimation,
          )
        })
        if (state.phase === 'running') {
          let dx = 0
          let dy = 0
          if (!state.activeEntityId) {
            if (keys.has('a') || keys.has('arrowleft')) dx -= 1
            if (keys.has('d') || keys.has('arrowright')) dx += 1
            if (keys.has('w') || keys.has('arrowup')) dy -= 1
            if (keys.has('s') || keys.has('arrowdown')) dy += 1
          }

          if (dx !== 0 || dy !== 0) {
            const length = Math.hypot(dx, dy)
            const nextX = player.x + (dx / length) * PLAYER_SPEED * ticker.deltaTime
            const nextY = player.y + (dy / length) * PLAYER_SPEED * ticker.deltaTime
            const boundedX = Math.max(30, Math.min(WORLD_WIDTH - 30, nextX))
            const boundedY = Math.max(40, Math.min(WORLD_HEIGHT - 30, nextY))
            if (!isBlocked(boundedX, player.y)) player.x = boundedX
            if (!isBlocked(player.x, boundedY)) player.y = boundedY
            if (!playerTexture) player.rotation = Math.atan2(dy, dx) + Math.PI / 2
            if (playerSprite) {
              playerSprite.y = Math.sin(elapsedAnimation * 12) * 1.5
              if (dx !== 0) playerSprite.scale.x = Math.abs(playerSprite.scale.x) * (dx < 0 ? -1 : 1)
            }
          } else if (playerSprite) {
            playerSprite.y *= 0.72
          }

          engine.tick(ticker.deltaMS / 1000)

          const nextZoneIds = new Set<string>()
          engine.scenario.zones.forEach((zone) => {
            if (isInsideZone(player.x, player.y, zone)) {
              nextZoneIds.add(zone.id)
              if (!currentZoneIds.has(zone.id)) engine.enterZone(zone.id)
            }
          })
          currentZoneIds = nextZoneIds
        }

        nearbyEntity = findNearbyEntity(player.x, player.y, engine.scenario.entities)
        deviceViews.forEach((view, entityId) => {
          if (view.embedded) view.body.visible = nearbyEntity?.id === entityId && state.phase === 'running' && !state.activeEntityId
        })
        prompt.visible = Boolean(nearbyEntity && state.phase === 'running' && !state.activeEntityId)
        if (nearbyEntity) {
          prompt.x = nearbyEntity.x
          prompt.y = nearbyEntity.y - 76
          const label = prompt.getChildByLabel('prompt-label') as Text
          const holdingCurrent = keys.has('e') && heldEntityId === nearbyEntity.id
          label.text = holdingCurrent
            ? `检查中 ${Math.min(100, Math.round((interactionHold / 700) * 100))}%`
            : `按住 E · ${nearbyEntity.name}`
        }

        if (nearbyEntity && state.phase === 'running' && !state.activeEntityId && keys.has('e')) {
          if (heldEntityId !== nearbyEntity.id) {
            heldEntityId = nearbyEntity.id
            interactionHold = 0
          }
          interactionHold += ticker.deltaMS
          if (interactionHold >= 700) {
            const [singleAction] = nearbyEntity.actions
            engine.interact(nearbyEntity.id)
            if (nearbyEntity.actions.length === 1 && singleAction.kind === 'inspect') {
              engine.performAction(singleAction.id)
            }
            keys.delete('e')
            interactionHold = 0
            heldEntityId = undefined
          }
        } else {
          interactionHold = 0
          heldEntityId = undefined
        }

        const cameraX = Math.max(WIDTH - WORLD_WIDTH, Math.min(0, WIDTH / 2 - player.x))
        const cameraY = Math.max(HEIGHT - WORLD_HEIGHT, Math.min(0, HEIGHT / 2 - player.y))
        world.x += (cameraX - world.x) * Math.min(1, 0.14 * ticker.deltaTime)
        world.y += (cameraY - world.y) * Math.min(1, 0.14 * ticker.deltaTime)
      })

      return () => {
        unsubscribe()
        window.removeEventListener('keydown', onKeyDown)
        window.removeEventListener('keyup', onKeyUp)
      }
    }

    let cleanupRuntime: (() => void) | undefined
    void init().then((cleanup) => {
      cleanupRuntime = cleanup
    })

    return () => {
      disposed = true
      cleanupRuntime?.()
      if (app.renderer) app.destroy(true, { children: true })
    }
  }, [engine])

  return <div className="pixi-host" ref={hostRef} />
}

function drawRoom(world: Container, zones: ScenarioZone[], environmentTextures: Map<EnvironmentAssetId, Texture>) {
  const shell = new Graphics()
    .rect(0, 0, WIDTH, HEIGHT)
    .fill(0x071015)
    .roundRect(26, 28, WIDTH - 52, HEIGHT - 50, 8)
    .fill(0x17252b)
    .roundRect(38, 40, WIDTH - 76, HEIGHT - 76, 4)
    .fill(0x111c21)
  world.addChild(shell)

  const floor = new Graphics()
  const tileSize = 52
  for (let row = 0; row < 10; row += 1) {
    for (let column = 0; column < 16; column += 1) {
      const x = 40 + column * tileSize
      const y = 42 + row * tileSize
      const alternate = (row + column) % 2 === 0
      floor
        .rect(x, y, tileSize - 2, tileSize - 2)
        .fill(alternate ? 0x122129 : 0x101d24)
        .stroke({ color: 0x203039, width: 1, alpha: 0.72 })
    }
  }
  world.addChild(floor)

  const safetyLane = new Graphics()
    .roundRect(58, 462, 750, 54, 4)
    .fill({ color: 0xb8892e, alpha: 0.14 })
    .stroke({ color: 0xe3b64d, width: 2, alpha: 0.58 })
    .roundRect(785, 112, 54, 404, 4)
    .fill({ color: 0xb8892e, alpha: 0.12 })
    .stroke({ color: 0xe3b64d, width: 2, alpha: 0.52 })
  for (let x = 76; x < 790; x += 34) {
    safetyLane.moveTo(x, 506).lineTo(x + 16, 472)
  }
  safetyLane.stroke({ color: 0xe3b64d, width: 3, alpha: 0.18 })
  world.addChild(safetyLane)

  const wallDetails = new Graphics()
    .rect(38, 40, WIDTH - 76, 13)
    .fill(0x2f4149)
    .rect(38, 53, WIDTH - 76, 5)
    .fill({ color: 0x000000, alpha: 0.26 })
    .rect(38, 40, 12, HEIGHT - 76)
    .fill(0x293b43)
    .rect(WIDTH - 50, 40, 12, HEIGHT - 76)
    .fill(0x0b151a)
  world.addChild(wallDetails)

  const machineBases = new Graphics()
  obstacles.forEach((obstacle, index) => {
    machineBases
      .roundRect(obstacle.x + 6, obstacle.y + 8, obstacle.width, obstacle.height, 7)
      .fill({ color: 0x000000, alpha: 0.35 })
      .roundRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height, 7)
      .fill(index === 0 ? 0x26373e : 0x223239)
      .stroke({ color: 0x48606a, width: 2 })
      .rect(obstacle.x + 10, obstacle.y + 9, obstacle.width - 20, 3)
      .fill({ color: 0x718991, alpha: 0.28 })
  })
  machineBases.visible = environmentTextures.size === 0
  world.addChild(machineBases)

  const environmentLayer = new Container()
  addEnvironmentSprite(environmentLayer, environmentTextures, 'baseLarge', 462, 260, 238, 112)
  addEnvironmentSprite(environmentLayer, environmentTextures, 'baseSmall', 130, 331, 158, 78)
  addEnvironmentSprite(environmentLayer, environmentTextures, 'baseSmall', 820, 334, 138, 70)
  addEnvironmentSprite(environmentLayer, environmentTextures, 'platform', 580, 454, 190, 104)

  addEnvironmentSprite(environmentLayer, environmentTextures, 'pipeHorizontal', 230, 133, 208, 54)
  addEnvironmentSprite(environmentLayer, environmentTextures, 'pipeHorizontal', 430, 133, 208, 54)
  addEnvironmentSprite(environmentLayer, environmentTextures, 'pipeHorizontal', 630, 143, 190, 50)
  addEnvironmentSprite(environmentLayer, environmentTextures, 'pipeTee', 535, 170, 104, 78)
  addEnvironmentSprite(environmentLayer, environmentTextures, 'pipeDepth', 516, 245, 86, 136)
  addEnvironmentSprite(environmentLayer, environmentTextures, 'pipeElbow', 470, 346, 92, 82)
  addEnvironmentSprite(environmentLayer, environmentTextures, 'pipeHorizontal', 335, 390, 230, 58)
  addEnvironmentSprite(environmentLayer, environmentTextures, 'pipeHorizontal', 610, 390, 230, 58)
  addEnvironmentSprite(environmentLayer, environmentTextures, 'railing', 738, 474, 178, 104)
  world.addChild(environmentLayer)

  const pipeShadow = new Graphics()
    .moveTo(135, 132)
    .lineTo(325, 132)
    .lineTo(535, 132)
    .lineTo(700, 132)
    .lineTo(700, 172)
    .lineTo(755, 172)
    .moveTo(535, 176)
    .lineTo(535, 305)
    .lineTo(470, 305)
    .moveTo(470, 349)
    .lineTo(470, 385)
    .lineTo(205, 385)
    .lineTo(205, 390)
    .moveTo(470, 385)
    .lineTo(745, 385)
    .lineTo(745, 390)
    .stroke({ color: 0x050a0d, width: 22, alpha: 0.48 })
  pipeShadow.x = 5
  pipeShadow.y = 7
  pipeShadow.visible = environmentTextures.size === 0
  world.addChild(pipeShadow)

  const piping = new Graphics()
    .moveTo(135, 132)
    .lineTo(325, 132)
    .lineTo(535, 132)
    .lineTo(700, 132)
    .lineTo(700, 172)
    .lineTo(755, 172)
    .moveTo(535, 176)
    .lineTo(535, 305)
    .lineTo(470, 305)
    .moveTo(470, 349)
    .lineTo(470, 385)
    .lineTo(205, 385)
    .lineTo(205, 390)
    .moveTo(470, 385)
    .lineTo(745, 385)
    .lineTo(745, 390)
    .stroke({ color: 0x58717c, width: 16 })
  const pipeHighlight = new Graphics()
    .moveTo(135, 127)
    .lineTo(535, 127)
    .lineTo(700, 127)
    .stroke({ color: 0x91a7ae, width: 3, alpha: 0.3 })
  piping.visible = environmentTextures.size === 0
  pipeHighlight.visible = environmentTextures.size === 0
  world.addChild(piping, pipeHighlight)

  zones.forEach((zone) => {
    const hazard = new Graphics()
      .rect(zone.x, zone.y, zone.width, zone.height)
      .fill({ color: 0x5a2d1d, alpha: 0.18 })
      .stroke({ color: 0xff7657, width: 2, alpha: 0.7 })
    for (let x = zone.x - zone.height; x < zone.x + zone.width; x += 22) {
      hazard.moveTo(x, zone.y).lineTo(x + zone.height, zone.y + zone.height)
    }
    hazard.stroke({ color: 0x713d25, width: 7, alpha: 0.55 })
    world.addChild(hazard)
  })

  const title = new Text({
    text: 'TURBINE LUBE OIL BAY  /  LEVEL 02',
    style: { fill: 0x8aa0a8, fontSize: 11, fontFamily: 'monospace', letterSpacing: 2 },
  })
  title.x = 62
  title.y = 66
  world.addChild(title)

  const laneLabel = new Text({
    text: 'SAFE ACCESS  →',
    style: { fill: 0xd9b75f, fontSize: 9, fontFamily: 'monospace', letterSpacing: 1.4 },
  })
  laneLabel.x = 83
  laneLabel.y = 480
  laneLabel.alpha = 0.72
  world.addChild(laneLabel)
}

function createDevice(entity: ScenarioEntity, texture?: Texture, embedded = false) {
  const container = new Container()
  const assetSpec = getDeviceAssetSpec(entity.id)

  if (embedded) {
    const body = new Graphics()
      .circle(0, 0, Math.min(entity.interactionRadius * 0.55, 42))
      .fill({ color: colors.teal, alpha: 0.08 })
      .stroke({ color: colors.teal, width: 2, alpha: 0.72 })
    body.visible = false
    container.addChild(body)
    return { container, body, motion: new Graphics(), embedded: true }
  }

  if (assetSpec.baseWidth > 0) {
    const base = new Graphics()
      .ellipse(5, 24, assetSpec.baseWidth / 2, assetSpec.baseDepth / 2)
      .fill({ color: 0x000000, alpha: 0.35 })
      .ellipse(0, 18, assetSpec.baseWidth / 2, assetSpec.baseDepth / 2)
      .fill(0x26373d)
      .stroke({ color: 0x50666d, width: 2, alpha: 0.8 })
    container.addChild(base)
  }

  const body = new Graphics()
  redrawDevice(body, entity, false)
  container.addChild(body)

  let sprite: Sprite | undefined
  if (texture) {
    sprite = new Sprite(texture)
    sprite.anchor.set(assetSpec.anchorX, assetSpec.anchorY)
    sprite.width = assetSpec.width
    sprite.height = assetSpec.height
    body.visible = false
    container.addChild(sprite)
  }

  const motion = createDeviceMotion(entity)
  if (texture) motion.visible = false
  container.addChild(motion)

  let valueLabel: Text | undefined
  if (entity.kind === 'instrument') {
    valueLabel = new Text({
      text: '--',
      style: { fill: 0x88a1ac, fontSize: 9, fontFamily: 'monospace', fontWeight: '600' },
    })
    valueLabel.anchor.set(0.5)
    valueLabel.y = -(assetSpec.height * assetSpec.anchorY) - 10
    container.addChild(valueLabel)
  }

  const label = new Text({
    text: entity.name,
    style: { fill: 0xd7e1e4, fontSize: 11, fontFamily: 'sans-serif', fontWeight: '600' },
  })
  label.anchor.set(0.5, 0)
  label.y = texture
    ? assetSpec.height * (1 - assetSpec.anchorY) + 8
    : assetSpec.labelOffsetY
  const labelPlate = new Graphics()
    .roundRect(-label.width / 2 - 8, label.y - 3, label.width + 16, 20, 4)
    .fill({ color: 0x081116, alpha: 0.82 })
    .stroke({ color: 0x31464e, width: 1, alpha: 0.8 })
  container.addChild(labelPlate, label)

  return { container, body, motion, valueLabel, sprite }
}

function addEnvironmentSprite(
  layer: Container,
  textures: Map<EnvironmentAssetId, Texture>,
  id: EnvironmentAssetId,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const texture = textures.get(id)
  if (!texture) return
  const sprite = new Sprite(texture)
  sprite.anchor.set(0.5)
  sprite.position.set(x, y)
  sprite.width = width
  sprite.height = height
  layer.addChild(sprite)
}

function redrawDevice(body: Graphics, entity: ScenarioEntity, completed: boolean) {
  body.clear()
  const color = completed
    ? colors.teal
    : entity.kind === 'hazard'
      ? colors.red
      : entity.kind === 'instrument'
        ? colors.blue
        : colors.amber

  if (entity.kind === 'instrument') {
    body
      .roundRect(-9, 18, 18, 21, 3).fill(0x263a43)
      .rect(-13, 35, 26, 5).fill(0x17252b)
      .circle(3, 4, 31).fill(0x0c171c)
      .circle(0, 0, 31).fill(0x31464f).stroke({ color: 0x637a83, width: 3 })
      .circle(0, 0, 24).fill(0x0d1a20).stroke({ color, width: 3 })
      .arc(0, 0, 19, -2.5, 0.75).stroke({ color: 0x78909a, width: 2, alpha: 0.7 })
  } else if (entity.kind === 'pump') {
    body
      .roundRect(-43, -24, 55, 52, 12).fill(0x1a2a31)
      .roundRect(-43, -29, 55, 52, 12).fill(0x3d535c).stroke({ color: 0x758a91, width: 2 })
      .rect(-34, -22, 36, 4).fill({ color: 0x91a5aa, alpha: 0.35 })
      .circle(25, 4, 27).fill(0x192930)
      .circle(23, 0, 27).fill(0x405861).stroke({ color, width: 3 })
      .circle(23, 0, 17).fill(0x101d22).stroke({ color: 0x72878d, width: 2 })
      .rect(-34, 24, 72, 7).fill(0x17242a)
      .circle(-32, 27, 3).fill(0x9aabb0)
      .circle(34, 27, 3).fill(0x9aabb0)
  } else if (entity.kind === 'filter') {
    body
      .ellipse(3, 31, 31, 12).fill({ color: 0x000000, alpha: 0.3 })
      .roundRect(-31, -30, 62, 62, 8).fill(0x273b43).stroke({ color: 0x6c8188, width: 2 })
      .ellipse(0, -30, 31, 11).fill(0x526871).stroke({ color, width: 3 })
      .ellipse(0, 31, 31, 10).fill(0x17252b)
      .rect(-21, -16, 42, 4).fill(color)
      .rect(-21, -4, 42, 4).fill(color)
      .rect(-21, 8, 42, 4).fill(color)
      .rect(-21, 20, 42, 4).fill(color)
  } else if (entity.kind === 'terminal') {
    body
      .poly([-41, -27, 34, -27, 42, 25, -34, 25]).fill(0x3b5058).stroke({ color: 0x72858c, width: 2 })
      .poly([-32, -20, 27, -20, 30, 10, -28, 10]).fill(0x081319).stroke({ color: colors.blue, width: 2 })
      .rect(-20, 17, 41, 3).fill(color)
      .circle(31, -15, 4).fill(colors.red)
  } else if (entity.kind === 'cabinet') {
    body
      .poly([-35, -39, 35, -39, 43, -31, -27, -31]).fill(0x5b7078)
      .poly([35, -39, 43, -31, 43, 38, 35, 31]).fill(0x17252b)
      .roundRect(-35, -39, 70, 70, 4).fill(0x344952).stroke({ color: 0x7a8e94, width: 2 })
      .moveTo(0, -35).lineTo(0, 28).stroke({ color: 0x19282f, width: 2 })
      .rect(-28, -25, 56, 9).fill(0x26383f)
      .rect(-28, -25, 56, 3).fill(color)
      .circle(-7, 0, 3).fill(0xc6d1d4)
      .circle(7, 0, 3).fill(0xc6d1d4)
  } else if (entity.kind === 'valve') {
    body
      .rect(-42, -8, 84, 16).fill(0x2d424a).stroke({ color: 0x667d85, width: 2 })
      .poly([-31, -25, 0, 0, -31, 25]).fill(0x40565e).stroke({ color, width: 3 })
      .poly([31, -25, 0, 0, 31, 25]).fill(0x30454d).stroke({ color, width: 3 })
      .circle(0, 0, 7).fill(0x17252b).stroke({ color: 0x83969c, width: 2 })
  } else {
    body
      .circle(4, 7, 38).fill({ color: 0x000000, alpha: 0.3 })
      .circle(0, 0, 36).fill({ color, alpha: 0.18 }).stroke({ color, width: 3 })
      .moveTo(-15, 17).lineTo(0, -17).lineTo(15, 17).closePath().stroke({ color, width: 5 })
  }
}

function createDeviceMotion(entity: ScenarioEntity) {
  const motion = new Graphics()
  if (entity.kind === 'instrument') {
    motion.moveTo(0, 0).lineTo(0, -18).stroke({ color: colors.blue, width: 3 })
    motion.circle(0, 0, 4).fill(colors.blue)
  } else if (entity.kind === 'pump') {
    motion
      .moveTo(0, -14).lineTo(0, 14)
      .moveTo(-14, 0).lineTo(14, 0)
      .moveTo(-10, -10).lineTo(10, 10)
      .stroke({ color: colors.amber, width: 3 })
    motion.x = 23
  } else if (entity.kind === 'filter') {
    motion.roundRect(-22, -22, 44, 44, 5).stroke({ color: colors.red, width: 3 })
  } else if (entity.kind === 'valve') {
    motion.moveTo(0, 0).lineTo(0, -32).stroke({ color: colors.amber, width: 4 })
    motion.circle(0, -37, 7).fill(colors.amber)
  } else if (entity.kind === 'terminal') {
    motion.circle(20, -14, 4).fill(colors.red)
  } else if (entity.kind === 'hazard') {
    motion.circle(0, 0, 42).stroke({ color: colors.red, width: 2, alpha: 0.45 })
  }
  return motion
}

function updateDeviceMotion(
  view: DeviceView,
  entity: ScenarioEntity,
  state: SimulationState,
  faultType: ScenarioFaultType,
  deltaTime: number,
  elapsed: number,
) {
  const pressureRecovered = state.flags.includes('backup-running')
  const systemStable = state.flags.includes('leak-isolated') || state.flags.includes('system-protected')

  if (entity.kind === 'instrument') {
    const pressure = getPressureValue(
      faultType,
      entity.id,
      state,
      pressureRecovered,
      systemStable,
    )
    view.motion.rotation = -2.25 + (pressure / 0.5) * 4.5
    if (view.valueLabel) view.valueLabel.text = `${pressure.toFixed(2)} MPa`
  } else if (entity.kind === 'pump') {
    const running = entity.id === 'main-pump' || (entity.id === 'backup-pump' && pressureRecovered)
    if (running) view.motion.rotation += 0.12 * deltaTime
    view.motion.alpha = running ? 1 : 0.28
    view.motion.tint = running ? colors.teal : colors.amber
  } else if (entity.kind === 'filter') {
    const blocked = faultType === 'filterBlockage' && !state.flags.includes('filter-restored')
    view.motion.alpha = blocked ? 0.45 + Math.sin(elapsed * 5) * 0.4 : 0.22
    view.motion.tint = blocked ? colors.red : colors.teal
  } else if (entity.kind === 'valve') {
    const closed = entity.id === 'branch-valve' && state.flags.includes('leak-isolated')
    view.motion.rotation = closed ? Math.PI / 2 : 0
    view.motion.tint = closed ? colors.teal : colors.amber
  } else if (entity.kind === 'terminal') {
    view.motion.alpha = state.flags.includes('response-reported') ? 1 : 0.35 + Math.sin(elapsed * 4) * 0.25
    view.motion.tint = state.flags.includes('response-reported') ? colors.teal : colors.red
  } else if (entity.kind === 'hazard') {
    view.motion.scale.set(0.94 + Math.sin(elapsed * 3.5) * 0.08)
    view.motion.alpha = state.flags.includes('leak-isolated') ? 0.12 : 0.85
  } else if (entity.kind === 'cabinet') {
    view.motion.alpha = state.inventoryItemIds.length > 0 ? 1 : 0.45
  }
}

function createEnvironmentEffects(world: Container, embeddedScene = false): EnvironmentEffects {
  const flowDots: Graphics[] = []
  const flowPositions = [
    [175, 132], [235, 132], [295, 132], [375, 132], [435, 132], [495, 132],
    [585, 132], [645, 132], [700, 150], [535, 210], [535, 265], [500, 305],
    [470, 365], [540, 385], [615, 385], [690, 385],
  ]
  flowPositions.forEach(([x, y]) => {
    const dot = new Graphics().circle(0, 0, 4).fill(colors.teal)
    dot.x = x
    dot.y = y
    dot.alpha = 0.18
    flowDots.push(dot)
    world.addChild(dot)
  })
  if (embeddedScene) flowDots.forEach((dot) => { dot.visible = false })

  const leak = new Graphics().ellipse(0, 0, 48, 28).fill({ color: 0xb94a2e, alpha: 0.6 })
  leak.x = embeddedScene ? 1170 : 575
  leak.y = embeddedScene ? 615 : 455
  world.addChild(leak)

  const alarmRing = new Graphics().circle(0, 0, 15).stroke({ color: colors.red, width: 2 })
  alarmRing.x = embeddedScene ? 1515 : 842
  alarmRing.y = embeddedScene ? 70 : 60
  const alarm = new Graphics().circle(0, 0, 7).fill(colors.red)
  alarm.x = embeddedScene ? 1515 : 842
  alarm.y = embeddedScene ? 70 : 60
  world.addChild(alarmRing, alarm)

  return { flowDots, leak, alarm, alarmRing }
}

function updateEnvironmentEffects(
  effects: EnvironmentEffects,
  state: SimulationState,
  faultType: ScenarioFaultType,
  elapsed: number,
) {
  const flowActive = state.flags.includes('backup-running')
  const isolated = state.flags.includes('leak-isolated')
  effects.flowDots.forEach((dot, index) => {
    const wave = (Math.sin(elapsed * (flowActive ? 7 : 2) - index * 0.8) + 1) / 2
    dot.alpha = flowActive || isolated ? 0.28 + wave * 0.72 : 0.08 + wave * 0.2
    dot.tint = isolated ? colors.teal : flowActive ? colors.blue : colors.amber
  })

  const leakScale = isolated ? 0.35 : 0.85 + state.risk / 180
  effects.leak.scale.set(leakScale)
  effects.leak.alpha = faultType === 'branchLeak'
    ? isolated ? 0.12 : 0.45 + Math.sin(elapsed * 2.4) * 0.12
    : 0

  const alarmColor = state.phase === 'success' ? colors.teal : state.phase === 'failed' || state.risk >= 70 ? colors.red : colors.amber
  effects.alarm.tint = alarmColor
  effects.alarmRing.tint = alarmColor
  effects.alarm.alpha = state.phase === 'ready' ? 0.25 : 0.55 + Math.sin(elapsed * 6) * 0.4
  effects.alarmRing.scale.set(0.9 + ((elapsed * 0.9) % 1) * 0.75)
  effects.alarmRing.alpha = state.phase === 'running' ? 0.85 - ((elapsed * 0.9) % 1) * 0.7 : 0.2
}

function getPressureValue(
  faultType: ScenarioFaultType,
  entityId: string,
  state: SimulationState,
  pressureRecovered: boolean,
  systemStable: boolean,
) {
  if (faultType === 'signalFault') {
    if (entityId === 'remote-pressure') {
      return state.flags.includes('signal-fault-confirmed') ? 0.43 : 0.1
    }
    return 0.43
  }

  if (faultType === 'filterBlockage') {
    if (state.flags.includes('filter-restored') || systemStable) return 0.42
    if (pressureRecovered) return 0.3
    return entityId === 'remote-pressure' ? 0.13 : 0.14
  }

  if (systemStable) return 0.42
  if (pressureRecovered) return 0.31
  return entityId === 'remote-pressure' ? 0.11 : 0.12
}

function createPlayer(texture?: Texture) {
  const player = new Container()
  const shadow = new Graphics().ellipse(4, 14, 18, 9).fill({ color: 0x000000, alpha: 0.42 })
  if (texture) {
    const sprite = new Sprite(texture)
    sprite.label = 'player-sprite'
    sprite.anchor.set(0.5, 0.88)
    sprite.width = 28
    sprite.height = 80
    player.addChild(shadow, sprite)
    return player
  }
  const body = new Graphics()
    .roundRect(-11, 1, 9, 18, 4).fill(0x1c3339)
    .roundRect(2, 1, 9, 18, 4).fill(0x1c3339)
    .roundRect(-15, -17, 30, 27, 9).fill(0x2a9f8a).stroke({ color: 0x9fe8d8, width: 2 })
    .rect(-13, -2, 26, 5).fill(0xe3ca62)
    .circle(0, -21, 10).fill(0xe2aa7a).stroke({ color: 0x101a1e, width: 2 })
    .arc(0, -23, 12, Math.PI, Math.PI * 2).fill(0xf0c447).stroke({ color: 0xffe78a, width: 2 })
    .rect(-12, -24, 24, 4).fill(0xd19a26)
    .moveTo(0, -36).lineTo(-5, -29).lineTo(5, -29).closePath().fill(0xeafffa)
  player.addChild(shadow, body)
  return player
}

function createPrompt() {
  const prompt = new Container()
  const background = new Graphics().roundRect(-94, -16, 188, 34, 10).fill({ color: 0x071014, alpha: 0.94 }).stroke({ color: colors.teal, width: 1 })
  const label = new Text({
    label: 'prompt-label',
    text: '',
    style: { fill: 0xe9fffa, fontSize: 13, fontFamily: 'sans-serif', fontWeight: '700' },
  })
  label.anchor.set(0.5)
  label.y = 1
  prompt.addChild(background, label)
  return prompt
}

function findNearbyEntity(x: number, y: number, entities: ScenarioEntity[]) {
  return entities.find((entity) => Math.hypot(entity.x - x, entity.y - y) <= entity.interactionRadius)
}

function isBlocked(x: number, y: number) {
  return obstacles.some((obstacle) =>
    x + PLAYER_RADIUS > obstacle.x &&
    x - PLAYER_RADIUS < obstacle.x + obstacle.width &&
    y + PLAYER_RADIUS > obstacle.y &&
    y - PLAYER_RADIUS < obstacle.y + obstacle.height,
  )
}

function isInsideZone(x: number, y: number, zone: ScenarioZone) {
  return x > zone.x && x < zone.x + zone.width && y > zone.y && y < zone.y + zone.height
}
