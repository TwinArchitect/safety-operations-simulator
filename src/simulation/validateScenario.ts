import type { ScenarioDefinition } from './types'

export function assertValidScenario(scenario: ScenarioDefinition) {
  const entityIds = scenario.entities.map((entity) => entity.id)
  assertUnique(entityIds, `${scenario.id}: entity id`)

  const activeActions = scenario.entities.flatMap((entity) => entity.actions)
  const actionIds = activeActions.map((action) => action.id)
  assertUnique(actionIds, `${scenario.id}: action id`)

  const ruleByAction = new Map(scenario.rules.map((rule) => [rule.actionId, rule]))
  actionIds.forEach((actionId) => {
    if (!ruleByAction.has(actionId)) {
      throw new Error(`${scenario.id}: action "${actionId}" has no rule`)
    }
  })

  const clueIds = new Set(scenario.clues.map((clue) => clue.id))
  scenario.rules
    .filter((rule) => actionIds.includes(rule.actionId))
    .flatMap((rule) => rule.addClueIds ?? [])
    .forEach((clueId) => {
      if (!clueIds.has(clueId)) {
        throw new Error(`${scenario.id}: rule references missing clue "${clueId}"`)
      }
    })

  const producibleFlags = new Set(
    scenario.rules
      .filter((rule) => actionIds.includes(rule.actionId))
      .flatMap((rule) => rule.addFlags ?? []),
  )
  scenario.completionFlags.forEach((flag) => {
    if (!producibleFlags.has(flag)) {
      throw new Error(`${scenario.id}: completion flag "${flag}" cannot be produced`)
    }
  })

  const maxScore = scenario.assessmentDimensions.reduce(
    (total, dimension) => total + dimension.maxScore,
    0,
  )
  if (maxScore !== 100) {
    throw new Error(`${scenario.id}: assessment max score must equal 100, received ${maxScore}`)
  }
}

function assertUnique(values: string[], label: string) {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must be unique`)
  }
}
