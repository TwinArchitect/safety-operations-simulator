import type { ScenarioEntity } from '../simulation/types'

const WORLD_SCALE = 80

export function toWorldPosition(entity: Pick<ScenarioEntity, 'x' | 'y'>) {
  return {
    x: (entity.x - 700) / WORLD_SCALE,
    z: (entity.y - 450) / WORLD_SCALE,
  }
}
