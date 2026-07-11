import type {
  AssessmentScores,
  RuleConsequence,
  ScenarioDefinition,
  SimulationActionRecord,
  SimulationEvent,
  SimulationMode,
  SimulationState,
  SimulationViolation,
} from './types'

type Listener = () => void

export class SimulationEngine {
  private state: SimulationState
  private listeners = new Set<Listener>()
  private eventSequence = 0
  private violationSequence = 0
  private actionSequence = 0
  private elapsedAccumulator = 0

  constructor(readonly scenario: ScenarioDefinition) {
    this.state = this.createInitialState()
  }

  getSnapshot = () => this.state

  subscribe = (listener: Listener) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  start = (mode: SimulationMode) => {
    if (this.state.phase !== 'ready') return
    this.update({
      ...this.state,
      mode,
      phase: 'running',
      events: [this.makeEvent('info', mode === 'training' ? '指导训练开始：严重危险操作将被系统拦截。' : '正式考试开始：过程判定将在结算后统一公布。')],
    })
  }

  reset = () => {
    this.elapsedAccumulator = 0
    this.update(this.createInitialState())
  }

  tick(deltaSeconds: number) {
    if (this.state.phase !== 'running') return

    this.elapsedAccumulator += deltaSeconds
    if (this.elapsedAccumulator < 1) return

    const wholeSeconds = Math.floor(this.elapsedAccumulator)
    this.elapsedAccumulator -= wholeSeconds
    const secondsRemaining = Math.max(0, this.state.secondsRemaining - wholeSeconds)
    const risk = Math.min(
      100,
      this.state.risk + wholeSeconds * this.scenario.riskGrowthPerSecond,
    )

    if (secondsRemaining === 0 || risk >= 100) {
      this.fail(
        secondsRemaining === 0
          ? '处置超时，润滑油压力失稳导致机组保护动作。'
          : '风险值达到临界点，设备事故扩大。',
      )
      return
    }

    this.update({ ...this.state, secondsRemaining, risk })
  }

  interact(entityId: string) {
    if (this.state.phase !== 'running') return
    const entityExists = this.scenario.entities.some((item) => item.id === entityId)
    if (entityExists) this.update({ ...this.state, activeEntityId: entityId })
  }

  closeInteraction = () => {
    if (this.state.activeEntityId) this.update({ ...this.state, activeEntityId: undefined })
  }

  enterZone(zoneId: string) {
    if (this.state.phase !== 'running' || this.state.enteredZoneIds.includes(zoneId)) return
    const zone = this.scenario.zones.find((item) => item.id === zoneId)
    if (!zone) return

    const missingRequirement = zone.requiredFlags.some(
      (flag) => !this.state.flags.includes(flag),
    )
    if (missingRequirement) {
      this.applyViolation(
        `zone:${zone.id}`,
        zone.missingRequirementConsequence,
        { entityId: zone.id, entityName: zone.name, actionLabel: '进入区域' },
      )
      return
    }

    this.update({
      ...this.state,
      enteredZoneIds: [...this.state.enteredZoneIds, zone.id],
      risk: clamp(this.state.risk + zone.safeRiskDelta, 0, 100),
      events: [
        this.makeEvent('info', zone.safeMessage),
        ...this.state.events,
      ].slice(0, 6),
    })
  }

  performAction(actionId: string) {
    if (this.state.phase !== 'running') return

    const rule = this.scenario.rules.find((item) => item.actionId === actionId)
    if (!rule) return

    if (this.state.completedActionIds.includes(actionId)) {
      this.update({ ...this.state, activeEntityId: undefined })
      return
    }

    const missingRequiredFlag = rule.requiredFlags?.some(
      (flag) => !this.state.flags.includes(flag),
    )

    if (missingRequiredFlag && rule.invalidConsequence) {
      this.applyViolation(actionId, rule.invalidConsequence)
      return
    }

    if (rule.invalidConsequence && !rule.requiredFlags?.length) {
      this.applyViolation(actionId, rule.invalidConsequence)
      return
    }

    const flags = unique([...this.state.flags, ...(rule.addFlags ?? [])])
    const discoveredClueIds = unique([
      ...this.state.discoveredClueIds,
      ...(rule.addClueIds ?? []),
    ])
    const inventoryItemIds = unique([
      ...this.state.inventoryItemIds,
      ...(rule.addItemIds ?? []),
    ])
    const completedActionIds = [...this.state.completedActionIds, actionId]
    const isComplete = this.scenario.completionFlags.every((flag) => flags.includes(flag))
    let assessmentScores = this.applyScoreImpacts(
      this.state.assessmentScores,
      rule.scoreImpacts,
    )
    if (isComplete) assessmentScores = this.finalizeEfficiency(assessmentScores)

    this.update({
      ...this.state,
      phase: isComplete ? 'success' : 'running',
      activeEntityId: undefined,
      completedActionIds,
      discoveredClueIds,
      inventoryItemIds,
      flags,
      risk: clamp(this.state.risk + rule.riskDelta, 0, 100),
      score: totalScore(assessmentScores),
      assessmentScores,
      actionHistory: [
        ...this.state.actionHistory,
        this.makeActionRecord(actionId, 'success', rule.successMessage),
      ],
      events: [
        this.makeEvent('success', rule.successMessage),
        ...this.state.events,
      ].slice(0, 6),
    })
  }

  private applyViolation(
    actionId: string,
    consequence: RuleConsequence,
    context?: { entityId: string; entityName: string; actionLabel: string },
  ) {
    const effectiveConsequence: RuleConsequence =
      this.state.mode === 'training' && consequence.severity === 'critical'
        ? {
            ...consequence,
            severity: 'minor',
            message: `训练拦截：${consequence.message} 请检查前置条件后重新操作。`,
            riskDelta: 0,
            scoreImpacts: { compliance: -3 },
          }
        : consequence
    const violation = this.makeViolation(actionId, effectiveConsequence)
    const eventTone = effectiveConsequence.severity === 'critical' ? 'danger' : 'warning'
    const assessmentScores = this.applyScoreImpacts(
      this.state.assessmentScores,
      effectiveConsequence.scoreImpacts,
    )
    const nextState: SimulationState = {
      ...this.state,
      activeEntityId: undefined,
      violations: [violation, ...this.state.violations],
      risk: clamp(this.state.risk + effectiveConsequence.riskDelta, 0, 100),
      score: totalScore(assessmentScores),
      assessmentScores,
      actionHistory: [
        ...this.state.actionHistory,
        this.makeActionRecord(actionId, effectiveConsequence.severity, effectiveConsequence.message, context),
      ],
      events: [
        this.makeEvent(eventTone, effectiveConsequence.message),
        ...this.state.events,
      ].slice(0, 6),
    }

    if (effectiveConsequence.severity === 'critical') {
      this.update({
        ...nextState,
        phase: 'failed',
        failureReason: effectiveConsequence.message,
      })
      return
    }

    this.update(nextState)
  }

  private fail(reason: string) {
    this.update({
      ...this.state,
      phase: 'failed',
      failureReason: reason,
      events: [this.makeEvent('danger', reason), ...this.state.events].slice(0, 6),
    })
  }

  private createInitialState(): SimulationState {
    return {
      phase: 'ready',
      mode: 'training',
      activeEntityId: undefined,
      completedActionIds: [],
      discoveredClueIds: [],
      inventoryItemIds: [],
      enteredZoneIds: [],
      flags: [],
      violations: [],
      actionHistory: [],
      secondsRemaining: this.scenario.timeLimit,
      risk: this.scenario.initialRisk,
      score: 0,
      assessmentScores: createEmptyScores(),
      events: [],
    }
  }

  private makeEvent(tone: SimulationEvent['tone'], message: string): SimulationEvent {
    this.eventSequence += 1
    return { id: this.eventSequence, tone, message }
  }

  private makeViolation(
    actionId: string,
    consequence: RuleConsequence,
  ): SimulationViolation {
    this.violationSequence += 1
    return {
      id: this.violationSequence,
      severity: consequence.severity,
      actionId,
      message: consequence.message,
    }
  }

  private makeActionRecord(
    actionId: string,
    outcome: SimulationActionRecord['outcome'],
    message: string,
    context?: { entityId: string; entityName: string; actionLabel: string },
  ): SimulationActionRecord {
    const entity = this.scenario.entities.find((item) =>
      item.actions.some((action) => action.id === actionId),
    )
    const action = entity?.actions.find((item) => item.id === actionId)
    this.actionSequence += 1
    return {
      id: this.actionSequence,
      elapsedSeconds: this.scenario.timeLimit - this.state.secondsRemaining,
      entityId: context?.entityId ?? entity?.id ?? 'unknown',
      entityName: context?.entityName ?? entity?.name ?? '未知设备',
      actionId,
      actionLabel: context?.actionLabel ?? action?.label ?? '未知操作',
      outcome,
      message,
    }
  }

  private applyScoreImpacts(
    current: AssessmentScores,
    impacts: Partial<AssessmentScores>,
  ): AssessmentScores {
    const next = { ...current }
    this.scenario.assessmentDimensions.forEach((dimension) => {
      const delta = impacts[dimension.id] ?? 0
      next[dimension.id] = clamp(next[dimension.id] + delta, 0, dimension.maxScore)
    })
    return next
  }

  private finalizeEfficiency(current: AssessmentScores): AssessmentScores {
    const elapsed = this.scenario.timeLimit - this.state.secondsRemaining
    const minorViolations = this.state.violations.filter(
      (violation) => violation.severity === 'minor',
    ).length
    const timeScore = elapsed <= 75 ? 10 : elapsed <= 120 ? 7 : 4
    return {
      ...current,
      efficiency: Math.max(0, timeScore - minorViolations * 2),
    }
  }

  private update(nextState: SimulationState) {
    this.state = nextState
    this.listeners.forEach((listener) => listener())
  }
}

function unique(values: string[]) {
  return [...new Set(values)]
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
}

function createEmptyScores(): AssessmentScores {
  return {
    riskIdentification: 0,
    diagnosis: 0,
    compliance: 0,
    effectiveness: 0,
    efficiency: 0,
  }
}

function totalScore(scores: AssessmentScores) {
  return Object.values(scores).reduce((total, value) => total + value, 0)
}
