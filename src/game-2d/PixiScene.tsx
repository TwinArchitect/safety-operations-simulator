import { useEffect, useRef } from 'react'
import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js'
import type { SimulationEngine } from '../simulation/SimulationEngine'
import type { ScenarioEntity, ScenarioFaultType, ScenarioZone, SimulationState } from '../simulation/types'
import { getDeviceAssetSpec, type EnvironmentAssetId } from './sceneAssets'

interface PixiSceneProps {
  engine: SimulationEngine
}

const WIDTH = 1400
const HEIGHT = 580
const WORLD_WIDTH = 1400
const WORLD_HEIGHT = 900
const PLAYER_RADIUS = 15
const PLAYER_SPEED = 4.4
const PLAYER_START = { x: 490, y: 750 }

const obstacles = [
  { x: 530, y: 235, width: 120, height: 100 },
  { x: 530, y: 425, width: 120, height: 100 },
  { x: 695, y: 390, width: 100, height: 115 },
  { x: 245, y: 225, width: 110, height: 90 },
  { x: 95, y: 705, width: 110, height: 100 },
  { x: 995, y: 260, width: 90, height: 80 },
  { x: 995, y: 435, width: 90, height: 80 },
]

const structuralWalls = [
  // 监测区：右侧保留一个出口
  { x: 60, y: 70, width: 340, height: 16 },
  { x: 60, y: 354, width: 340, height: 16 },
  { x: 60, y: 70, width: 16, height: 300 },
  { x: 384, y: 70, width: 16, height: 120 },
  { x: 384, y: 250, width: 16, height: 120 },
  // 泵组区：左、右、下方各保留一个通道口
  { x: 460, y: 70, width: 400, height: 16 },
  { x: 460, y: 70, width: 16, height: 120 },
  { x: 460, y: 250, width: 16, height: 320 },
  { x: 844, y: 70, width: 16, height: 230 },
  { x: 844, y: 370, width: 16, height: 200 },
  { x: 460, y: 554, width: 145, height: 16 },
  { x: 685, y: 554, width: 175, height: 16 },
  // 支路区：左侧入口、下方出口
  { x: 920, y: 70, width: 410, height: 16 },
  { x: 920, y: 70, width: 16, height: 230 },
  { x: 920, y: 370, width: 16, height: 240 },
  { x: 1314, y: 70, width: 16, height: 540 },
  { x: 920, y: 594, width: 160, height: 16 },
  { x: 1160, y: 594, width: 170, height: 16 },
  // 准备区：右侧与主通道连接
  { x: 60, y: 650, width: 16, height: 180 },
  { x: 60, y: 650, width: 440, height: 16 },
  { x: 60, y: 814, width: 520, height: 16 },
  { x: 564, y: 650, width: 16, height: 65 },
  { x: 564, y: 775, width: 16, height: 55 },
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
  flowArrows: Array<{ view: Graphics; baseX: number; baseY: number; angle: number }>
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
      const dangerVignette = createDangerVignette()
      app.stage.addChild(dangerVignette)
      const riskIndicator = createRiskIndicator()
      app.stage.addChild(riskIndicator)
      const timeWarning = createTimeWarning()
      app.stage.addChild(timeWarning)
      const inventoryHud = createInventoryHud()
      app.stage.addChild(inventoryHud)
      const feedback = createFeedbackBanner()
      app.stage.addChild(feedback)
      const playerTexture = undefined
      const deviceTextures = new Map<string, Texture>()
      drawGrayboxWorld(world, engine.scenario.zones)
      const effects = createEnvironmentEffects(world)
      const guidance = createGuidanceBeacon()
      world.addChild(guidance)

      const deviceViews = new Map<string, DeviceView>()
      engine.scenario.entities.forEach((entity) => {
        const view = createDevice(entity, deviceTextures.get(entity.id), false)
        view.container.x = entity.x
        view.container.y = entity.y
        deviceViews.set(entity.id, view)
        world.addChild(view.container)
      })

      const player = createPlayer(playerTexture)
      const playerSprite = player.getChildByLabel('player-sprite') as Sprite | undefined
      const carriedTool = player.getChildByLabel('carried-tool') as Graphics | undefined
      const ppeIndicator = player.getChildByLabel('ppe-indicator') as Graphics | undefined
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
      let velocityX = 0
      let velocityY = 0
      let feedbackTimer = 0
      let lastEventId: number | undefined
      let inventoryTimer = 0
      let inventoryPinned = false
      let lastInventoryKey = ''

      const renderState = () => {
        const state = engine.getSnapshot()
        const latestEvent = state.events[0]
        const inventoryLabel = inventoryHud.getChildByLabel('inventory-label') as Text
        const inventoryKey = state.inventoryItemIds.join('|')
        if (inventoryKey !== lastInventoryKey) {
          lastInventoryKey = inventoryKey
          inventoryTimer = state.inventoryItemIds.length > 0 ? 3200 : 0
        }
        inventoryLabel.text = state.inventoryItemIds.length > 0
          ? state.inventoryItemIds
            .map((itemId) => engine.scenario.inventoryItems.find((item) => item.id === itemId)?.label)
            .filter(Boolean)
            .join('  ·  ')
          : '暂无装备'
        if (carriedTool) carriedTool.visible = state.inventoryItemIds.includes('valve-tool')
        if (ppeIndicator) ppeIndicator.visible = state.inventoryItemIds.includes('anti-slip-ppe')
        if (latestEvent && latestEvent.id !== lastEventId) {
          lastEventId = latestEvent.id
          feedbackTimer = 2600
          feedback.visible = true
          feedback.alpha = 1
          const label = feedback.getChildByLabel('feedback-label') as Text
          label.text = latestEvent.message
          const plate = feedback.getChildByLabel('feedback-plate') as Graphics
          plate.tint = latestEvent.tone === 'danger'
            ? colors.red
            : latestEvent.tone === 'warning'
              ? colors.amber
              : colors.teal
        }
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
          const completed = isEntityResolved(entity, state)
          redrawDevice(view.body, entity, completed)
        })
      }

      const unsubscribe = engine.subscribe(renderState)
      renderState()

      const onKeyDown = (event: KeyboardEvent) => {
        const key = event.key.toLowerCase()
        if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd', 'e', 'i', 'shift'].includes(key)) {
          event.preventDefault()
        }
        keys.add(key)
        if (key === 'i' && !event.repeat) {
          inventoryPinned = !inventoryPinned
          inventoryTimer = 0
        }
        if (key === 'r') engine.reset()
      }

      const onKeyUp = (event: KeyboardEvent) => keys.delete(event.key.toLowerCase())
      window.addEventListener('keydown', onKeyDown)
      window.addEventListener('keyup', onKeyUp)

      app.ticker.add((ticker) => {
        const state = engine.getSnapshot()
        inventoryTimer = Math.max(0, inventoryTimer - ticker.deltaMS)
        inventoryHud.visible = state.inventoryItemIds.length > 0 && (inventoryPinned || inventoryTimer > 0)
        inventoryHud.alpha = inventoryPinned ? 1 : Math.min(1, inventoryTimer / 450)
        const dangerIntensity = Math.max(0, (state.risk - 45) / 55)
        dangerVignette.alpha = state.phase === 'running'
          ? dangerIntensity * (0.58 + Math.sin(elapsedAnimation * 5.5) * 0.22)
          : 0
        riskIndicator.visible = state.phase === 'running' && state.risk >= 45
        if (riskIndicator.visible) {
          const riskLabel = riskIndicator.getChildByLabel('risk-label') as Text
          riskLabel.text = `${state.risk >= 78 ? '危险升级' : state.risk >= 60 ? '高风险' : '风险上升'}  ${Math.round(state.risk)} / 100`
          const riskBar = riskIndicator.getChildByLabel('risk-bar') as Graphics
          riskBar.clear()
            .roundRect(-82, 13, 164, 4, 2)
            .fill({ color: 0x2d1518, alpha: 0.95 })
            .roundRect(-82, 13, 164 * (state.risk / 100), 4, 2)
            .fill(state.risk >= 78 ? 0xff3d46 : 0xff835c)
          riskIndicator.alpha = 0.78 + Math.sin(elapsedAnimation * 5.5) * 0.22
        }
        timeWarning.visible = state.phase === 'running' && state.secondsRemaining <= 30
        if (timeWarning.visible) {
          const timeLabel = timeWarning.getChildByLabel('time-label') as Text
          timeLabel.text = `处置倒计时  ${state.secondsRemaining}s`
          timeWarning.alpha = 0.72 + Math.sin(elapsedAnimation * 7) * 0.28
        }
        if (feedbackTimer > 0) {
          feedbackTimer -= ticker.deltaMS
          feedback.alpha = Math.min(1, feedbackTimer / 350)
          if (feedbackTimer <= 0) feedback.visible = false
        }
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
        const guidanceEntityId = state.mode === 'training' && state.phase === 'running'
          ? getGuidanceEntityId(state)
          : undefined
        const guidanceEntity = engine.scenario.entities.find((entity) => entity.id === guidanceEntityId)
        guidance.visible = Boolean(guidanceEntity && !state.activeEntityId)
        if (guidanceEntity) {
          guidance.position.set(guidanceEntity.x, guidanceEntity.y)
          const pulse = 1 + Math.sin(elapsedAnimation * 4) * 0.08
          guidance.scale.set(pulse)
          guidance.alpha = 0.72 + Math.sin(elapsedAnimation * 4) * 0.2
        }
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
            const sprint = keys.has('shift') ? 1.45 : 1
            const targetX = (dx / length) * PLAYER_SPEED * sprint
            const targetY = (dy / length) * PLAYER_SPEED * sprint
            const acceleration = Math.min(1, 0.28 * ticker.deltaTime)
            velocityX += (targetX - velocityX) * acceleration
            velocityY += (targetY - velocityY) * acceleration
            const nextX = player.x + velocityX * ticker.deltaTime
            const nextY = player.y + velocityY * ticker.deltaTime
            const boundedX = Math.max(30, Math.min(WORLD_WIDTH - 30, nextX))
            const boundedY = Math.max(40, Math.min(WORLD_HEIGHT - 30, nextY))
            if (!isBlocked(boundedX, player.y)) player.x = boundedX
            else velocityX *= -0.12
            if (!isBlocked(player.x, boundedY)) player.y = boundedY
            else velocityY *= -0.12
            if (!playerTexture) player.rotation = Math.atan2(dy, dx) + Math.PI / 2
            if (playerSprite) {
              playerSprite.y = Math.sin(elapsedAnimation * 12) * 1.5
              if (dx !== 0) playerSprite.scale.x = Math.abs(playerSprite.scale.x) * (dx < 0 ? -1 : 1)
            }
          } else {
            const friction = Math.pow(0.74, ticker.deltaTime)
            velocityX *= friction
            velocityY *= friction
            if (Math.abs(velocityX) > 0.04 || Math.abs(velocityY) > 0.04) {
              const nextX = Math.max(30, Math.min(WORLD_WIDTH - 30, player.x + velocityX * ticker.deltaTime))
              const nextY = Math.max(40, Math.min(WORLD_HEIGHT - 30, player.y + velocityY * ticker.deltaTime))
              if (!isBlocked(nextX, player.y)) player.x = nextX
              if (!isBlocked(player.x, nextY)) player.y = nextY
            }
            if (playerSprite) playerSprite.y *= 0.72
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
          const selected = state.activeEntityId === entityId
          const focused = (nearbyEntity?.id === entityId || selected) && state.phase === 'running'
          const targetScale = selected ? 1.12 : focused ? 1.04 + Math.sin(elapsedAnimation * 5) * 0.025 : 1
          view.container.scale.x += (targetScale - view.container.scale.x) * 0.18 * ticker.deltaTime
          view.container.scale.y += (targetScale - view.container.scale.y) * 0.18 * ticker.deltaTime
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
            engine.interact(nearbyEntity.id)
            keys.delete('e')
            interactionHold = 0
            heldEntityId = undefined
          }
        } else {
          interactionHold = 0
          heldEntityId = undefined
        }

        const shake = state.phase === 'running' && state.risk >= 78
          ? ((state.risk - 78) / 22) * 4
          : 0
        const shakeX = shake ? Math.sin(elapsedAnimation * 31) * shake : 0
        const shakeY = shake ? Math.cos(elapsedAnimation * 27) * shake : 0
        const focusedEntity = state.activeEntityId
          ? engine.scenario.entities.find((entity) => entity.id === state.activeEntityId)
          : undefined
        const cameraTargetX = focusedEntity ? focusedEntity.x : player.x + velocityX * 14
        const cameraTargetY = focusedEntity ? focusedEntity.y + 90 : player.y + velocityY * 14
        const cameraX = Math.max(WIDTH - WORLD_WIDTH, Math.min(0, WIDTH / 2 - cameraTargetX + shakeX))
        const cameraY = Math.max(HEIGHT - WORLD_HEIGHT, Math.min(0, HEIGHT / 2 - cameraTargetY + shakeY))
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

function drawGrayboxWorld(world: Container, zones: ScenarioZone[]) {
  const floor = new Graphics().rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT).fill(0x0b1419)
  for (let x = 0; x <= WORLD_WIDTH; x += 50) {
    floor.moveTo(x, 0).lineTo(x, WORLD_HEIGHT)
  }
  for (let y = 0; y <= WORLD_HEIGHT; y += 50) {
    floor.moveTo(0, y).lineTo(WORLD_WIDTH, y)
  }
  floor.stroke({ color: 0x1a2a31, width: 1, alpha: 0.7 })
  world.addChild(floor)

  const walls = new Graphics()
    .rect(0, 0, WORLD_WIDTH, 28).fill(0x34434a)
    .rect(0, WORLD_HEIGHT - 28, WORLD_WIDTH, 28).fill(0x34434a)
    .rect(0, 0, 28, WORLD_HEIGHT).fill(0x34434a)
    .rect(WORLD_WIDTH - 28, 0, 28, WORLD_HEIGHT).fill(0x34434a)
  world.addChild(walls)

  const areas = [
    { x: 76, y: 86, width: 308, height: 268, label: '监测与告警确认区', color: 0x27424a },
    { x: 476, y: 86, width: 368, height: 468, label: '泵组设备区', color: 0x3c3827 },
    { x: 936, y: 86, width: 378, height: 508, label: '支路隔离区', color: 0x472d2d },
    { x: 76, y: 666, width: 488, height: 148, label: '安全准备区', color: 0x263c37 },
  ]
  areas.forEach((area) => {
    const zone = new Graphics()
      .roundRect(area.x, area.y, area.width, area.height, 10)
      .fill({ color: area.color, alpha: 0.24 })
      .stroke({ color: area.color, width: 2, alpha: 0.95 })
    const label = new Text({
      text: area.label,
      style: { fill: 0x789097, fontSize: 14, fontFamily: 'sans-serif', fontWeight: '600' },
    })
    label.position.set(area.x + 18, area.y + 14)
    world.addChild(zone, label)
  })

  const route = new Graphics()
    .roundRect(580, 716, 734, 64, 8)
    .fill({ color: 0x294048, alpha: 0.32 })
    .stroke({ color: 0x8a7440, width: 2, alpha: 0.42 })
    .roundRect(400, 194, 60, 52, 5)
    .fill({ color: 0x294048, alpha: 0.32 })
    .roundRect(860, 304, 60, 62, 5)
    .fill({ color: 0x294048, alpha: 0.32 })
    .roundRect(610, 570, 64, 146, 5)
    .fill({ color: 0x294048, alpha: 0.32 })
    .roundRect(1080, 610, 80, 106, 5)
    .fill({ color: 0x294048, alpha: 0.32 })
  world.addChild(route)

  const corridorLabels = [
    { text: '现场复核 →', x: 405, y: 205 },
    { text: '故障隔离 →', x: 862, y: 316 },
    { text: '↓ 安全准备', x: 612, y: 590 },
    { text: '↓ 紧急撤离', x: 1082, y: 628 },
  ]
  corridorLabels.forEach((item) => {
    const label = new Text({
      text: item.text,
      style: { fill: 0xd6b45c, fontSize: 10, fontFamily: 'monospace', fontWeight: '700' },
    })
    label.position.set(item.x, item.y)
    label.alpha = 0.72
    world.addChild(label)
  })

  const partitions = new Graphics()
  structuralWalls.forEach((wall) => {
    partitions
      .roundRect(wall.x, wall.y, wall.width, wall.height, 3)
      .fill(0x3a4a51)
      .stroke({ color: 0x62757d, width: 1, alpha: 0.7 })
  })
  world.addChild(partitions)

  const pipes = new Graphics()
    .moveTo(500, 245).lineTo(1190, 245)
    .moveTo(590, 245).lineTo(590, 475).lineTo(1040, 475)
    .moveTo(520, 165).lineTo(520, 245)
    .moveTo(1040, 245).lineTo(1040, 535)
    .stroke({ color: 0x526871, width: 14, alpha: 0.8 })
    .circle(852, 245, 13).stroke({ color: 0x8ba0a8, width: 4, alpha: 0.8 })
    .circle(928, 245, 13).stroke({ color: 0x8ba0a8, width: 4, alpha: 0.8 })
    .circle(852, 475, 13).stroke({ color: 0x8ba0a8, width: 4, alpha: 0.8 })
    .circle(928, 475, 13).stroke({ color: 0x8ba0a8, width: 4, alpha: 0.8 })
  world.addChild(pipes)

  const signalLink = new Graphics()
    .moveTo(165, 175)
    .lineTo(220, 175)
    .lineTo(220, 270)
    .lineTo(300, 270)
    .stroke({ color: colors.blue, width: 3, alpha: 0.6 })
  for (let offset = 0; offset < 5; offset += 1) {
    signalLink.circle(220 + offset * 17, 270, 3).fill({ color: colors.blue, alpha: 0.72 })
  }
  world.addChild(signalLink)

  obstacles.forEach((obstacle) => {
    const block = new Graphics()
      .roundRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height, 8)
      .fill({ color: 0x27383f, alpha: 0.48 })
      .stroke({ color: 0x536a73, width: 2, alpha: 0.7 })
    world.addChild(block)
  })

  zones.forEach((zone) => {
    const hazard = new Graphics()
      .rect(zone.x, zone.y, zone.width, zone.height)
      .fill({ color: colors.red, alpha: 0.12 })
      .stroke({ color: colors.red, width: 2, alpha: 0.65 })
    world.addChild(hazard)
  })

  const title = new Text({
    text: 'GRAYBOX PLAYTEST  /  LUBE OIL RESPONSE',
    style: { fill: 0x6d838b, fontSize: 12, fontFamily: 'monospace', letterSpacing: 2 },
  })
  title.position.set(52, 48)
  world.addChild(title)
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

function createEnvironmentEffects(world: Container): EnvironmentEffects {
  const flowDots: Graphics[] = []
  const flowPositions = [
    [550, 245], [610, 245], [670, 245], [730, 245], [790, 245], [850, 245],
    [910, 245], [970, 245], [1030, 245], [1090, 245], [1150, 245],
    [590, 305], [590, 365], [590, 425], [650, 475], [710, 475],
    [770, 475], [830, 475], [890, 475], [950, 475], [1010, 475],
    [1040, 420], [1040, 365], [1040, 310], [1040, 255],
  ]
  flowPositions.forEach(([x, y]) => {
    const dot = new Graphics().circle(0, 0, 4).fill(colors.teal)
    dot.x = x
    dot.y = y
    dot.alpha = 0.18
    flowDots.push(dot)
    world.addChild(dot)
  })
  const flowArrows = [
    [680, 245, 0],
    [820, 245, 0],
    [960, 245, 0],
    [1100, 245, 0],
    [590, 350, Math.PI / 2],
    [700, 475, 0],
    [835, 475, 0],
    [960, 475, 0],
    [1040, 400, -Math.PI / 2],
    [1040, 310, -Math.PI / 2],
  ].map(([x, y, angle]) => {
    const view = new Graphics()
      .poly([-10, -7, 3, -7, 3, -12, 14, 0, 3, 12, 3, 7, -10, 7])
      .fill(colors.amber)
    view.position.set(x, y)
    view.rotation = angle
    view.alpha = 0.28
    world.addChild(view)
    return { view, baseX: x, baseY: y, angle }
  })
  const leak = new Graphics().ellipse(0, 0, 48, 28).fill({ color: 0xb94a2e, alpha: 0.6 })
  leak.x = 1150
  leak.y = 530
  world.addChild(leak)

  const alarmRing = new Graphics().circle(0, 0, 15).stroke({ color: colors.red, width: 2 })
  alarmRing.x = 1340
  alarmRing.y = 62
  const alarm = new Graphics().circle(0, 0, 7).fill(colors.red)
  alarm.x = 1340
  alarm.y = 62
  world.addChild(alarmRing, alarm)

  return { flowDots, flowArrows, leak, alarm, alarmRing }
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
  effects.flowArrows.forEach((marker, index) => {
    const speed = flowActive || isolated ? 5.5 : 1.8
    const travel = ((elapsed * speed + index * 0.7) % 1) * 12
    marker.view.x = marker.baseX + Math.cos(marker.angle) * travel
    marker.view.y = marker.baseY + Math.sin(marker.angle) * travel
    marker.view.alpha = flowActive || isolated ? 0.72 + Math.sin(elapsed * 6 + index) * 0.2 : 0.18
    marker.view.tint = isolated ? colors.teal : flowActive ? colors.blue : colors.amber
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
  const tool = new Graphics()
    .moveTo(12, -15).lineTo(21, -27)
    .stroke({ color: colors.amber, width: 4 })
    .circle(23, -29, 5)
    .stroke({ color: colors.amber, width: 3 })
  tool.label = 'carried-tool'
  tool.visible = false
  const ppe = new Graphics()
    .circle(0, 6, 23)
    .stroke({ color: colors.teal, width: 2, alpha: 0.88 })
  ppe.label = 'ppe-indicator'
  ppe.visible = false
  if (texture) {
    const sprite = new Sprite(texture)
    sprite.label = 'player-sprite'
    sprite.anchor.set(0.5, 0.88)
    sprite.width = 28
    sprite.height = 80
    player.addChild(shadow, ppe, sprite, tool)
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
  player.addChild(shadow, ppe, body, tool)
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

function createFeedbackBanner() {
  const banner = new Container()
  banner.position.set(WIDTH / 2, 34)
  banner.visible = false
  const plate = new Graphics()
    .roundRect(-270, -18, 540, 42, 8)
    .fill({ color: 0x10231f, alpha: 0.96 })
    .stroke({ color: 0x63dec3, width: 1, alpha: 0.9 })
  plate.label = 'feedback-plate'
  const label = new Text({
    label: 'feedback-label',
    text: '',
    style: {
      fill: 0xf0faf7,
      fontSize: 13,
      fontFamily: 'sans-serif',
      fontWeight: '600',
    },
  })
  label.anchor.set(0.5)
  label.y = 3
  banner.addChild(plate, label)
  return banner
}

function createDangerVignette() {
  const vignette = new Graphics()
    .rect(0, 0, WIDTH, HEIGHT)
    .fill({ color: 0x7a0d16, alpha: 0.12 })
    .stroke({ color: colors.red, width: 34, alpha: 0.78 })
    .rect(18, 18, WIDTH - 36, HEIGHT - 36)
    .stroke({ color: 0xff3038, width: 12, alpha: 0.38 })
  vignette.alpha = 0
  return vignette
}

function createRiskIndicator() {
  const indicator = new Container()
  indicator.position.set(WIDTH - 126, 44)
  indicator.visible = false
  const plate = new Graphics()
    .roundRect(-94, -21, 188, 48, 7)
    .fill({ color: 0x3b0d12, alpha: 0.94 })
    .stroke({ color: colors.red, width: 2, alpha: 0.9 })
  const label = new Text({
    label: 'risk-label',
    text: '风险上升',
    style: { fill: 0xffd5d6, fontSize: 13, fontFamily: 'sans-serif', fontWeight: '700' },
  })
  label.anchor.set(0.5)
  label.y = -4
  const bar = new Graphics()
  bar.label = 'risk-bar'
  indicator.addChild(plate, label, bar)
  return indicator
}

function createTimeWarning() {
  const warning = new Container()
  warning.position.set(WIDTH / 2, HEIGHT - 38)
  warning.visible = false
  const plate = new Graphics()
    .roundRect(-104, -18, 208, 38, 7)
    .fill({ color: 0x4a2b0c, alpha: 0.94 })
    .stroke({ color: colors.amber, width: 2, alpha: 0.92 })
  const label = new Text({
    label: 'time-label',
    text: '',
    style: { fill: 0xffe1aa, fontSize: 14, fontFamily: 'monospace', fontWeight: '700' },
  })
  label.anchor.set(0.5)
  label.y = 1
  warning.addChild(plate, label)
  return warning
}

function createInventoryHud() {
  const hud = new Container()
  hud.position.set(18, HEIGHT - 58)
  const plate = new Graphics()
    .roundRect(0, 0, 270, 40, 7)
    .fill({ color: 0x071115, alpha: 0.92 })
    .stroke({ color: 0x34564f, width: 1, alpha: 0.9 })
  const title = new Text({
    text: '随身装备',
    style: { fill: 0x56d9bd, fontSize: 9, fontFamily: 'monospace', fontWeight: '700' },
  })
  title.position.set(12, 6)
  const label = new Text({
    label: 'inventory-label',
    text: '暂无装备',
    style: { fill: 0xd6e3df, fontSize: 11, fontFamily: 'sans-serif', fontWeight: '600' },
  })
  label.position.set(12, 21)
  hud.addChild(plate, title, label)
  return hud
}

function createGuidanceBeacon() {
  const beacon = new Container()
  const ring = new Graphics()
    .circle(0, 0, 58)
    .fill({ color: colors.teal, alpha: 0.05 })
    .stroke({ color: colors.teal, width: 3, alpha: 0.72 })
    .circle(0, 0, 48)
    .stroke({ color: colors.teal, width: 1, alpha: 0.32 })
  const marker = new Text({
    text: '目标',
    style: { fill: 0xa5f4e2, fontSize: 11, fontFamily: 'sans-serif', fontWeight: '700' },
  })
  marker.anchor.set(0.5)
  marker.y = 48
  beacon.addChild(ring, marker)
  return beacon
}

function getGuidanceEntityId(state: SimulationState) {
  if (!state.flags.includes('remote-pressure-read')) return 'remote-pressure'
  if (!state.flags.includes('pressure-confirmed')) return 'pressure-gauge'
  if (!state.flags.includes('main-pump-checked')) return 'main-pump'
  if (!state.flags.includes('backup-checked')) return 'backup-pump'
  if (!state.flags.includes('leak-identified')) return 'branch-valve'
  if (!state.flags.includes('supply-protected')) return 'backup-pump'
  if (!state.flags.includes('valve-tool-carried')) return 'safety-cabinet'
  if (!state.flags.includes('leak-isolated')) return 'branch-valve'
  if (!state.flags.includes('response-reported')) return 'control-terminal'
  return undefined
}

function isEntityResolved(entity: ScenarioEntity, state: SimulationState) {
  if (entity.id === 'backup-pump') return state.flags.includes('backup-running')
  if (entity.id === 'oil-filter') return state.flags.includes('filter-restored') || state.flags.includes('filter-checked')
  if (entity.id === 'branch-valve') return state.flags.includes('leak-isolated')
  if (entity.id === 'healthy-valve') return state.flags.includes('healthy-branch-checked')
  if (entity.id === 'control-terminal') return state.flags.includes('response-reported')
  if (entity.id === 'safety-cabinet') return state.inventoryItemIds.length >= 2
  if (entity.id === 'oil-leak') return state.flags.includes('leak-identified')
  return entity.actions.some((action) => state.completedActionIds.includes(action.id))
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
  ) || structuralWalls.some((wall) =>
    x + PLAYER_RADIUS > wall.x &&
    x - PLAYER_RADIUS < wall.x + wall.width &&
    y + PLAYER_RADIUS > wall.y &&
    y - PLAYER_RADIUS < wall.y + wall.height,
  )
}

function isInsideZone(x: number, y: number, zone: ScenarioZone) {
  return x > zone.x && x < zone.x + zone.width && y > zone.y && y < zone.y + zone.height
}
