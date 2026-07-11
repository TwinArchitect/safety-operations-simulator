export type SimulationPhase = 'ready' | 'running' | 'success' | 'failed'
export type SimulationMode = 'training' | 'exam'
export type ScenarioFaultType = 'branchLeak' | 'filterBlockage' | 'signalFault'

export type EntityKind = 'instrument' | 'pump' | 'filter' | 'valve' | 'terminal' | 'cabinet' | 'hazard'
export type ActionKind = 'inspect' | 'operate' | 'enter'
export type ViolationSeverity = 'minor' | 'critical'
export type AssessmentDimensionId =
  | 'riskIdentification'
  | 'diagnosis'
  | 'compliance'
  | 'effectiveness'
  | 'efficiency'

export type AssessmentScores = Record<AssessmentDimensionId, number>

export interface EntityAction {
  id: string
  label: string
  kind: ActionKind
}

export interface ScenarioEntity {
  id: string
  kind: EntityKind
  name: string
  x: number
  y: number
  interactionRadius: number
  detail: string
  actions: EntityAction[]
}

export interface ScenarioClue {
  id: string
  title: string
  detail: string
}

export interface ScenarioInventoryItem {
  id: string
  label: string
}

export interface ScenarioZone {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
  requiredFlags: string[]
  safeMessage: string
  safeRiskDelta: number
  missingRequirementConsequence: RuleConsequence
}

export interface ScenarioObjective {
  id: string
  title: string
  description: string
  completionFlags: string[]
  trainingHint: string
}

export interface RuleConsequence {
  severity: ViolationSeverity
  message: string
  riskDelta: number
  scoreImpacts: Partial<AssessmentScores>
}

export interface ScenarioActionRule {
  actionId: string
  requiredFlags?: string[]
  successMessage: string
  addFlags?: string[]
  addClueIds?: string[]
  addItemIds?: string[]
  riskDelta: number
  scoreImpacts: Partial<AssessmentScores>
  invalidConsequence?: RuleConsequence
}

export interface ScenarioDefinition {
  id: string
  faultType: ScenarioFaultType
  title: string
  role: string
  briefing: string
  timeLimit: number
  initialRisk: number
  riskGrowthPerSecond: number
  entities: ScenarioEntity[]
  inventoryItems: ScenarioInventoryItem[]
  zones: ScenarioZone[]
  clues: ScenarioClue[]
  objectives: ScenarioObjective[]
  assessmentDimensions: Array<{
    id: AssessmentDimensionId
    label: string
    maxScore: number
  }>
  rules: ScenarioActionRule[]
  completionFlags: string[]
}

export interface SimulationEvent {
  id: number
  tone: 'info' | 'success' | 'warning' | 'danger'
  message: string
}

export interface SimulationViolation {
  id: number
  severity: ViolationSeverity
  actionId: string
  message: string
}

export interface SimulationActionRecord {
  id: number
  elapsedSeconds: number
  entityId: string
  entityName: string
  actionId: string
  actionLabel: string
  outcome: 'success' | 'minor' | 'critical'
  message: string
}

export interface SimulationState {
  phase: SimulationPhase
  mode: SimulationMode
  activeEntityId?: string
  completedActionIds: string[]
  discoveredClueIds: string[]
  inventoryItemIds: string[]
  enteredZoneIds: string[]
  flags: string[]
  violations: SimulationViolation[]
  actionHistory: SimulationActionRecord[]
  secondsRemaining: number
  risk: number
  score: number
  assessmentScores: AssessmentScores
  events: SimulationEvent[]
  failureReason?: string
}
