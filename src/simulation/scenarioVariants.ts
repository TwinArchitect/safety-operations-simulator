import { lubricationScenario } from './scenario'
import type { ScenarioActionRule, ScenarioDefinition } from './types'
import { assertValidScenario } from './validateScenario'

const noLeakEntities = lubricationScenario.entities.filter((entity) => entity.id !== 'oil-leak')

const filterOverrides: ScenarioActionRule[] = [
  { actionId: 'read-remote-pressure', successMessage: '远传压力显示 0.13 MPa，需要就地复核。', addFlags: ['remote-pressure-read'], addClueIds: ['filter-remote-low'], riskDelta: 1, scoreImpacts: { riskIdentification: 1, diagnosis: 1 } },
  { actionId: 'inspect-local-pressure', successMessage: '就地压力为 0.14 MPa，确认系统真实低压。', addFlags: ['pressure-confirmed'], addClueIds: ['filter-local-low'], riskDelta: 1, scoreImpacts: { riskIdentification: 6, diagnosis: 4 } },
  { actionId: 'inspect-filter-dp', successMessage: '过滤器差压达到报警值，确认发生严重堵塞。', addFlags: ['filter-blockage-identified'], addClueIds: ['filter-dp-high'], riskDelta: 2, scoreImpacts: { riskIdentification: 10, diagnosis: 10 } },
  { actionId: 'inspect-leaking-valve', successMessage: 'B 支路外观干燥，未发现泄漏。', addFlags: ['branch-b-checked'], addClueIds: ['branch-b-dry'], riskDelta: 1, scoreImpacts: { diagnosis: 3 } },
  {
    actionId: 'report-abnormality',
    requiredFlags: ['pressure-confirmed', 'filter-blockage-identified'],
    successMessage: '过滤器堵塞、压力状态和当前处置已上报值班负责人。',
    addFlags: ['response-reported'],
    riskDelta: 0,
    scoreImpacts: { compliance: 13 },
    invalidConsequence: { severity: 'minor', message: '尚未确认过滤器堵塞，上报缺少诊断依据。', riskDelta: 2, scoreImpacts: { compliance: -3 } },
  },
  {
    actionId: 'controlled-shutdown',
    requiredFlags: ['pressure-confirmed', 'filter-blockage-identified'],
    successMessage: '已执行受控停机，系统进入保护状态，可安全切换过滤器。',
    addFlags: ['system-protected', 'supply-protected', 'response-reported'],
    riskDelta: -22,
    scoreImpacts: { compliance: 6, effectiveness: 10 },
    invalidConsequence: { severity: 'minor', message: '堵塞故障尚未确认，停机申请被驳回。', riskDelta: 4, scoreImpacts: { compliance: -4 } },
  },
  {
    actionId: 'switch-standby-filter',
    requiredFlags: ['pressure-confirmed', 'filter-blockage-identified', 'supply-protected', 'valve-tool-carried'],
    successMessage: '备用过滤器切换完成，差压和母管压力恢复正常。',
    addFlags: ['filter-restored'],
    addClueIds: ['filter-restored'],
    riskDelta: -26,
    scoreImpacts: { compliance: 4, effectiveness: 10 },
    invalidConsequence: { severity: 'critical', message: '保护、诊断或隔离工具条件不足，强行切换导致供油中断。', riskDelta: 48, scoreImpacts: { compliance: -20, effectiveness: -25 } },
  },
  { actionId: 'close-leaking-branch', successMessage: '', riskDelta: 0, scoreImpacts: {}, invalidConsequence: { severity: 'critical', message: '误将正常 B 支路当作故障来源并关闭，导致系统失稳。', riskDelta: 48, scoreImpacts: { diagnosis: -20, effectiveness: -25 } } },
  { actionId: 'confirm-signal-fault', successMessage: '', riskDelta: 0, scoreImpacts: {}, invalidConsequence: { severity: 'minor', message: '远传与就地压力均偏低，不能判定为信号故障。', riskDelta: 3, scoreImpacts: { diagnosis: -5 } } },
  { actionId: 'equip-anti-slip-ppe', successMessage: '已穿戴防滑鞋套，本题现场未发现油污风险。', addFlags: ['anti-slip-ppe-equipped'], addItemIds: ['anti-slip-ppe'], riskDelta: 0, scoreImpacts: {} },
]

export const filterBlockageScenario: ScenarioDefinition = {
  ...lubricationScenario,
  id: 'lubrication-filter-blockage',
  faultType: 'filterBlockage',
  title: '润滑油过滤器堵塞处置',
  briefing: '润滑油母管压力持续下降。请检查供油设备和过滤单元，确认故障并恢复系统安全状态。',
  initialRisk: 28,
  riskGrowthPerSecond: 0.28,
  entities: noLeakEntities,
  zones: [],
  clues: [
    { id: 'filter-remote-low', title: '远传低压', detail: '远传压力显示 0.13 MPa。' },
    { id: 'filter-local-low', title: '现场压力异常', detail: '就地压力为 0.14 MPa，确认系统真实低压。' },
    { id: 'main-pump-running', title: '主油泵运行', detail: '主泵运行正常，但出口压力偏低。' },
    { id: 'backup-pump-ready', title: '备用泵可用', detail: '备用泵具备启动条件。' },
    { id: 'filter-dp-high', title: '过滤器差压过高', detail: '过滤器前后差压达到报警值，确认滤芯严重堵塞。' },
    { id: 'healthy-branch-dry', title: 'A 支路正常', detail: 'A 支路未发现泄漏。' },
    { id: 'branch-b-dry', title: 'B 支路正常', detail: 'B 支路同样未发现泄漏。' },
    { id: 'pressure-recovering', title: '备用供油有效', detail: '备用泵启动后压力开始回升。' },
    { id: 'filter-restored', title: '过滤能力恢复', detail: '切换备用过滤器后差压和压力恢复正常。' },
  ],
  objectives: [
    { id: 'verify-alarm', title: '确认真实低压', description: '对比远传与就地压力。', completionFlags: ['pressure-confirmed'], trainingHint: '先核对远传和就地压力，确认不是信号故障。' },
    { id: 'identify-filter', title: '定位堵塞设备', description: '检查泵组、过滤器和供油支路。', completionFlags: ['filter-blockage-identified'], trainingHint: '重点比较过滤器前后差压，同时排除泵组和支路泄漏。' },
    { id: 'protect-system', title: '保护供油系统', description: '在切换过滤器前建立安全条件。', completionFlags: ['supply-protected'], trainingHint: '可启动备用泵，也可执行受控停机。' },
    { id: 'restore-filter', title: '恢复过滤能力', description: '安全切换备用过滤器。', completionFlags: ['filter-restored'], trainingHint: '领取隔离工具，并确认系统已经受到保护。' },
    { id: 'complete-report', title: '完成规范上报', description: '记录异常和处置结果。', completionFlags: ['response-reported'], trainingHint: '通过值班控制终端完成上报。' },
  ],
  rules: replaceRules(lubricationScenario.rules, filterOverrides),
  completionFlags: ['pressure-confirmed', 'filter-blockage-identified', 'supply-protected', 'filter-restored', 'response-reported'],
}

const signalOverrides: ScenarioActionRule[] = [
  { actionId: 'read-remote-pressure', successMessage: '远传压力异常显示 0.10 MPa，需要就地复核。', addFlags: ['remote-pressure-read'], addClueIds: ['signal-remote-low'], riskDelta: 0, scoreImpacts: { riskIdentification: 4 } },
  { actionId: 'inspect-local-pressure', successMessage: '就地压力稳定在 0.43 MPa，与远传数据明显不一致。', addFlags: ['local-pressure-normal'], addClueIds: ['signal-local-normal'], riskDelta: 0, scoreImpacts: { riskIdentification: 8, diagnosis: 8 } },
  { actionId: 'inspect-main-pump', successMessage: '主油泵运行和出口压力均正常。', addFlags: ['main-pump-checked'], addClueIds: ['signal-main-normal'], riskDelta: 0, scoreImpacts: { diagnosis: 3 } },
  { actionId: 'inspect-filter-dp', successMessage: '过滤器差压正常。', addFlags: ['filter-checked'], addClueIds: ['signal-filter-normal'], riskDelta: 0, scoreImpacts: { diagnosis: 3 } },
  { actionId: 'inspect-leaking-valve', successMessage: 'B 支路无泄漏，现场供油正常。', addFlags: ['branch-b-checked'], addClueIds: ['signal-branch-normal'], riskDelta: 0, scoreImpacts: { diagnosis: 3 } },
  {
    actionId: 'confirm-signal-fault',
    requiredFlags: ['remote-pressure-read', 'local-pressure-normal'],
    successMessage: '已确认远传压力信号故障，设备实际运行状态正常。',
    addFlags: ['signal-fault-confirmed'],
    addClueIds: ['signal-fault-confirmed'],
    riskDelta: -8,
    scoreImpacts: { diagnosis: 11, effectiveness: 15 },
    invalidConsequence: { severity: 'minor', message: '尚未完成远传与就地数据对照，不能确认信号故障。', riskDelta: 2, scoreImpacts: { diagnosis: -5 } },
  },
  {
    actionId: 'report-abnormality',
    requiredFlags: ['signal-fault-confirmed'],
    successMessage: '远传信号故障和现场核对结果已上报，转入仪表检修流程。',
    addFlags: ['response-reported'],
    riskDelta: -4,
    scoreImpacts: { compliance: 15, effectiveness: 10 },
    invalidConsequence: { severity: 'minor', message: '尚未确认信号故障，上报内容缺少证据。', riskDelta: 1, scoreImpacts: { compliance: -3 } },
  },
  { actionId: 'start-backup-pump', successMessage: '', riskDelta: 0, scoreImpacts: {}, invalidConsequence: { severity: 'minor', message: '就地压力正常，启动备用泵属于无依据操作。', riskDelta: 5, scoreImpacts: { compliance: -6 } } },
  { actionId: 'controlled-shutdown', successMessage: '', riskDelta: 0, scoreImpacts: {}, invalidConsequence: { severity: 'minor', message: '设备实际运行正常，无需执行受控停机。', riskDelta: 5, scoreImpacts: { compliance: -8 } } },
  { actionId: 'switch-standby-filter', successMessage: '', riskDelta: 0, scoreImpacts: {}, invalidConsequence: { severity: 'minor', message: '过滤器差压正常，无需切换备用过滤器。', riskDelta: 3, scoreImpacts: { compliance: -4 } } },
  { actionId: 'close-leaking-branch', successMessage: '', riskDelta: 0, scoreImpacts: {}, invalidConsequence: { severity: 'critical', message: '误关正常 B 支路，导致实际供油中断。', riskDelta: 55, scoreImpacts: { compliance: -20, effectiveness: -25 } } },
  { actionId: 'equip-anti-slip-ppe', successMessage: '已穿戴防滑鞋套，本题现场未发现油污风险。', addFlags: ['anti-slip-ppe-equipped'], addItemIds: ['anti-slip-ppe'], riskDelta: 0, scoreImpacts: {} },
  { actionId: 'take-valve-tool', successMessage: '已领取隔离工具，但当前没有需要隔离的设备。', addFlags: ['valve-tool-carried'], addItemIds: ['valve-tool'], riskDelta: 0, scoreImpacts: {} },
]

export const signalFaultScenario: ScenarioDefinition = {
  ...lubricationScenario,
  id: 'lubrication-signal-fault',
  faultType: 'signalFault',
  title: '润滑油压力信号异常核查',
  briefing: '控制系统出现润滑油低压告警，但机组运行暂未出现明显异常。请核实信号并完成规范处置。',
  initialRisk: 10,
  riskGrowthPerSecond: 0.08,
  entities: noLeakEntities,
  zones: [],
  clues: [
    { id: 'signal-remote-low', title: '远传压力异常', detail: '控制系统显示压力仅 0.10 MPa。' },
    { id: 'signal-local-normal', title: '就地压力正常', detail: '就地压力稳定在 0.43 MPa，与远传数据不一致。' },
    { id: 'signal-main-normal', title: '主油泵正常', detail: '主油泵运行和出口状态均正常。' },
    { id: 'backup-pump-ready', title: '备用泵可用', detail: '备用泵具备启动条件，但当前没有启动依据。' },
    { id: 'signal-filter-normal', title: '过滤器正常', detail: '过滤器差压正常。' },
    { id: 'healthy-branch-dry', title: 'A 支路正常', detail: 'A 支路无泄漏。' },
    { id: 'signal-branch-normal', title: 'B 支路正常', detail: 'B 支路无泄漏。' },
    { id: 'signal-fault-confirmed', title: '确认信号故障', detail: '远传压力与现场实际状态不一致，需要转入仪表检修流程。' },
  ],
  objectives: [
    { id: 'compare-signals', title: '核对压力信号', description: '对比远传与就地数据。', completionFlags: ['remote-pressure-read', 'local-pressure-normal'], trainingHint: '先分别读取远传显示和就地压力表。' },
    { id: 'confirm-fault', title: '确认异常性质', description: '排除真实设备故障并确认信号问题。', completionFlags: ['signal-fault-confirmed'], trainingHint: '数据不一致时，可检查泵组和过滤器作为佐证。' },
    { id: 'complete-report', title: '完成规范上报', description: '提交仪表异常和现场核查结果。', completionFlags: ['response-reported'], trainingHint: '在控制终端确认信号故障并完成上报。' },
  ],
  rules: replaceRules(lubricationScenario.rules, signalOverrides),
  completionFlags: ['remote-pressure-read', 'local-pressure-normal', 'signal-fault-confirmed', 'response-reported'],
}

export const scenarioCatalog = [lubricationScenario, filterBlockageScenario, signalFaultScenario]

scenarioCatalog.forEach(assertValidScenario)

function replaceRules(base: ScenarioActionRule[], overrides: ScenarioActionRule[]) {
  const map = new Map(overrides.map((rule) => [rule.actionId, rule]))
  return base.map((rule) => map.get(rule.actionId) ?? rule)
}
