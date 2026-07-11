import { Assets, Texture } from 'pixi.js'

export interface DeviceAssetSpec {
  source?: string
  width: number
  height: number
  anchorX: number
  anchorY: number
  labelOffsetY: number
  baseWidth: number
  baseDepth: number
}

const defaultSpec: DeviceAssetSpec = {
  width: 78,
  height: 68,
  anchorX: 0.5,
  anchorY: 0.62,
  labelOffsetY: 48,
  baseWidth: 94,
  baseDepth: 34,
}

export const deviceAssetManifest: Record<string, DeviceAssetSpec> = {
  'remote-pressure': { ...defaultSpec, source: '/assets/devices/pressure-gauge-remote.png', width: 58, height: 98, anchorY: 0.82, labelOffsetY: 47, baseWidth: 0, baseDepth: 0 },
  'pressure-gauge': { ...defaultSpec, source: '/assets/devices/pressure-gauge-local.png', width: 82, height: 82, anchorY: 0.76, labelOffsetY: 45, baseWidth: 0, baseDepth: 0 },
  'main-pump': { ...defaultSpec, source: '/assets/devices/centrifugal-oil-pump.png', width: 128, height: 108, anchorY: 0.74, labelOffsetY: 48, baseWidth: 0, baseDepth: 0 },
  'backup-pump': { ...defaultSpec, source: '/assets/devices/centrifugal-oil-pump.png', width: 116, height: 98, anchorY: 0.74, labelOffsetY: 46, baseWidth: 0, baseDepth: 0 },
  'oil-filter': { ...defaultSpec, source: '/assets/devices/oil-filter.png', width: 88, height: 124, anchorY: 0.76, labelOffsetY: 48, baseWidth: 0, baseDepth: 0 },
  'control-terminal': { ...defaultSpec, source: '/assets/devices/control-terminal.png', width: 104, height: 130, anchorY: 0.78, labelOffsetY: 50, baseWidth: 0, baseDepth: 0 },
  'safety-cabinet': { ...defaultSpec, source: '/assets/devices/safety-cabinet-closed.png', width: 58, height: 116, anchorY: 0.78, labelOffsetY: 45, baseWidth: 0, baseDepth: 0 },
  'healthy-valve': { ...defaultSpec, source: '/assets/devices/branch-valve-open.png', width: 70, height: 150, anchorY: 0.78, labelOffsetY: 49, baseWidth: 0, baseDepth: 0 },
  'branch-valve': { ...defaultSpec, source: '/assets/devices/branch-valve-open.png', width: 70, height: 150, anchorY: 0.78, labelOffsetY: 49, baseWidth: 0, baseDepth: 0 },
  'oil-leak': { ...defaultSpec, width: 92, height: 72, baseWidth: 0, baseDepth: 0 },
}

export async function loadPlayerTexture() {
  try {
    return await Assets.load<Texture>('/assets/characters/inspector-down.png')
  } catch {
    return undefined
  }
}

export async function loadSceneBackground() {
  try {
    return await Assets.load<Texture>('/assets/scenes/lube-oil-room-large.png')
  } catch {
    return undefined
  }
}

const environmentSources = {
  pipeHorizontal: '/assets/environment/pipe-horizontal.png',
  pipeDepth: '/assets/environment/pipe-depth.png',
  pipeElbow: '/assets/environment/pipe-elbow.png',
  pipeTee: '/assets/environment/pipe-tee.png',
  baseSmall: '/assets/environment/equipment-base-small.png',
  baseLarge: '/assets/environment/equipment-base-large.png',
  platform: '/assets/environment/platform-grating.png',
  railing: '/assets/environment/safety-railing.png',
} as const

export type EnvironmentAssetId = keyof typeof environmentSources

export async function loadEnvironmentTextures() {
  const textures = new Map<EnvironmentAssetId, Texture>()
  await Promise.all(Object.entries(environmentSources).map(async ([id, source]) => {
    textures.set(id as EnvironmentAssetId, await Assets.load<Texture>(source))
  }))
  return textures
}

export function getDeviceAssetSpec(entityId: string) {
  return deviceAssetManifest[entityId] ?? defaultSpec
}

export async function loadDeviceTextures() {
  const textures = new Map<string, Texture>()
  const entries = Object.entries(deviceAssetManifest).filter(([, spec]) => spec.source)

  await Promise.all(entries.map(async ([entityId, spec]) => {
    if (!spec.source) return
    textures.set(entityId, await Assets.load<Texture>(spec.source))
  }))

  return textures
}
