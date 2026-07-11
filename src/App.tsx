import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { PixiScene } from './game/PixiScene'
import { SimulationEngine } from './simulation/SimulationEngine'
import { scenarioCatalog } from './simulation/scenarioVariants'

interface ExamResult {
  scenarioId: string
  title: string
  score: number
  passed: boolean
  violationCount: number
  elapsedSeconds: number
}

function App() {
  const [selectedScenarioId, setSelectedScenarioId] = useState(scenarioCatalog[0].id)
  const [examOrderIds, setExamOrderIds] = useState<string[]>([])
  const [examIndex, setExamIndex] = useState(0)
  const [examResults, setExamResults] = useState<ExamResult[]>([])
  const [autoStartExam, setAutoStartExam] = useState(false)
  const [examComplete, setExamComplete] = useState(false)
  const selectedScenario = scenarioCatalog.find(
    (scenario) => scenario.id === selectedScenarioId,
  ) ?? scenarioCatalog[0]
  const engine = useMemo(
    () => new SimulationEngine(selectedScenario),
    [selectedScenario],
  )

  useEffect(() => {
    if (!autoStartExam) return
    engine.start('exam')
    setAutoStartExam(false)
  }, [autoStartExam, engine])
  const state = useSyncExternalStore(engine.subscribe, engine.getSnapshot)
  const scenario = engine.scenario
  const activeEntity = scenario.entities.find((entity) => entity.id === state.activeEntityId)
  const activeObjective = scenario.objectives.find(
    (objective) => !objective.completionFlags.every((flag) => state.flags.includes(flag)),
  )
  const elapsedSeconds = scenario.timeLimit - state.secondsRemaining
  const minutes = Math.floor(state.secondsRemaining / 60)
  const seconds = state.secondsRemaining % 60
  const examTotalScore = examResults.length > 0
    ? Math.round(examResults.reduce((total, result) => total + result.score, 0) / examResults.length)
    : 0

  useEffect(() => {
    if (!activeEntity || state.phase !== 'running') return
    const handleActionKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        engine.closeInteraction()
        return
      }
      if (event.repeat || !/^[1-9]$/.test(event.key)) return
      const action = activeEntity.actions[Number(event.key) - 1]
      if (!action || state.completedActionIds.includes(action.id)) return
      event.preventDefault()
      engine.performAction(action.id)
    }
    window.addEventListener('keydown', handleActionKey)
    return () => window.removeEventListener('keydown', handleActionKey)
  }, [activeEntity, engine, state.completedActionIds, state.phase])

  const startTraining = () => {
    setExamOrderIds([])
    setExamResults([])
    setExamComplete(false)
    engine.start('training')
  }

  const startExam = () => {
    const order = [
      scenario.id,
      ...scenarioCatalog.filter((item) => item.id !== scenario.id).map((item) => item.id),
    ]
    setExamOrderIds(order)
    setExamIndex(0)
    setExamResults([])
    setExamComplete(false)
    engine.start('exam')
  }

  const finishExamScenario = () => {
    const result: ExamResult = {
      scenarioId: scenario.id,
      title: scenario.title,
      score: state.score,
      passed: state.phase === 'success',
      violationCount: state.violations.length,
      elapsedSeconds,
    }
    const results = [...examResults, result]
    setExamResults(results)

    if (examIndex < examOrderIds.length - 1) {
      const nextIndex = examIndex + 1
      setExamIndex(nextIndex)
      setSelectedScenarioId(examOrderIds[nextIndex])
      setAutoStartExam(true)
      return
    }

    setExamComplete(true)
  }

  const resetExamSession = () => {
    setExamOrderIds([])
    setExamResults([])
    setExamIndex(0)
    setExamComplete(false)
    setSelectedScenarioId(scenarioCatalog[0].id)
    engine.reset()
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">SO</span>
          <div>
            <strong>SafeOps Simulator</strong>
            <span>工业安全操作训练引擎 · MVP 01</span>
          </div>
        </div>
        <div className="session-meta">
          <span className={`status-dot status-${state.phase}`} />
          {state.phase === 'ready' ? '任务待命' : state.phase === 'running' ? state.mode === 'training' ? '指导训练进行中' : '正式考试进行中' : state.phase === 'success' ? '任务通过' : '任务失败'}
        </div>
      </header>

      <section className="mission-strip">
        <div className="mission-copy">
          <span className="eyebrow">
            {examOrderIds.length > 0 ? `考试题 ${Math.min(examIndex + 1, examOrderIds.length)}/${examOrderIds.length}` : '场景训练'} · 汽机专业
          </span>
          <h1>{scenario.title}</h1>
          <p>{scenario.briefing}</p>
        </div>
        <div className="mission-metrics">
          <Metric kind="time" label="剩余时间" value={`${minutes}:${seconds.toString().padStart(2, '0')}`} alert={state.secondsRemaining < 30} />
          <Metric kind="risk" label="实时风险" value={`${Math.round(state.risk)}%`} alert={state.risk >= 70} />
          <Metric kind="score" label="当前得分" value={String(state.score)} />
        </div>
      </section>

      <section className="workspace">
        <div className="scene-card">
          <div className="scene-toolbar">
            <div>
              <span className="live-pill"><i /> LIVE SIMULATION</span>
              <span className="role-label">角色：{scenario.role}</span>
            </div>
            <div className="control-hints">
              <kbd>WASD</kbd> 移动 <kbd>E</kbd> 交互 <kbd>R</kbd> 重置
            </div>
          </div>
          <div className="scene-viewport">
            <PixiScene engine={engine} />

            {activeEntity && state.phase === 'running' && (
              <section className="interaction-drawer" role="dialog" aria-label={`${activeEntity.name}操作面板`}>
                <button className="drawer-close" type="button" aria-label="关闭设备操作面板" onClick={engine.closeInteraction}>×</button>
                <div className="device-card-header">
                  <span className="device-symbol" aria-hidden="true">{getDeviceSymbol(activeEntity.kind)}</span>
                  <div>
                    <span className="eyebrow">现场设备 · {activeEntity.kind}</span>
                    <h2>{activeEntity.name}</h2>
                  </div>
                </div>
                <p>{activeEntity.detail}</p>
                <div className="action-list">
                  {activeEntity.actions.map((action, index) => (
                    <button
                      className={`device-action action-${action.kind}`}
                      disabled={state.completedActionIds.includes(action.id)}
                      key={action.id}
                      onClick={() => engine.performAction(action.id)}
                      type="button"
                    >
                      <span className="action-copy"><kbd className="action-key">{index + 1}</kbd>{action.label}</span>
                      <small>{state.completedActionIds.includes(action.id) ? '已执行' : action.kind === 'inspect' ? '检查' : action.kind === 'enter' ? '高风险' : '操作'} <i aria-hidden="true">→</i></small>
                    </button>
                  ))}
                </div>
                <span className="keyboard-tip">按数字键选择 · Esc 关闭</span>
              </section>
            )}

            {state.phase === 'ready' && (
              <div className="scene-overlay">
                <span className="overlay-index">SCENARIO / 001</span>
                <h2>现场响应任务已下发</h2>
                <p>指导训练会提供阶段提示并拦截严重违规；正式考试不公布过程判定，只在结束后统一生成能力报告。</p>
                <div className="variant-selector" aria-label="选择故障场景">
                  {scenarioCatalog.map((item, index) => (
                    <button
                      className={item.id === scenario.id ? 'selected' : ''}
                      key={item.id}
                      onClick={() => setSelectedScenarioId(item.id)}
                      type="button"
                    >
                      <small>题型 {index + 1}</small>
                      <span>{item.title}</span>
                    </button>
                  ))}
                </div>
                <div className="mode-actions">
                  <button className="primary-button" onClick={startTraining}>指导训练</button>
                  <button className="secondary-button" onClick={startExam}>正式考试 · 3 题</button>
                </div>
              </div>
            )}

            {(state.phase === 'success' || state.phase === 'failed') && !examComplete && (
              <div className={`scene-overlay result-overlay result-${state.phase}`}>
                <span className="result-icon">{state.phase === 'success' ? '✓' : '×'}</span>
                <span className="overlay-index">{state.mode === 'training' ? 'TRAINING REPORT' : 'EXAM REPORT'} · {state.phase === 'success' ? 'COMPLETE' : 'FAILED'}</span>
                <h2>{state.phase === 'success' ? '安全处置完成' : '本次任务失败'}</h2>
                <p>{state.phase === 'success' ? `通过“${getCompletionRoute(scenario.faultType, state.flags)}”完成处置，能力评级 ${getGrade(state.score)}。` : state.failureReason}</p>
                <div className="report-metrics">
                  <span>总分 <strong>{state.score}</strong></span>
                  <span>用时 <strong>{formatElapsed(elapsedSeconds)}</strong></span>
                  <span>违规 <strong>{state.violations.length}</strong></span>
                  <span>线索 <strong>{state.discoveredClueIds.length}</strong></span>
                </div>
                <div className="score-breakdown">
                  {scenario.assessmentDimensions.map((dimension) => (
                    <div key={dimension.id}>
                      <span>{dimension.label}</span>
                      <strong>{state.assessmentScores[dimension.id]}<small>/{dimension.maxScore}</small></strong>
                    </div>
                  ))}
                </div>
                <div className="report-grid">
                  <section>
                    <span className="eyebrow">违规与改进建议</span>
                    <div className="report-list">
                      {state.violations.length === 0 ? (
                        <p>本次操作未记录违规行为。</p>
                      ) : state.violations.map((violation) => (
                        <p className={`report-${violation.severity}`} key={violation.id}>{violation.message}</p>
                      ))}
                    </div>
                  </section>
                  <section>
                    <span className="eyebrow">完整操作复盘</span>
                    <div className="report-list report-timeline">
                      {state.actionHistory.map((record) => (
                        <p key={record.id}><time>{formatElapsed(record.elapsedSeconds)}</time><span>{record.entityName} · {record.actionLabel}</span><small>{record.message}</small></p>
                      ))}
                    </div>
                  </section>
                </div>
                {state.mode === 'exam' ? (
                  <button className="primary-button" onClick={finishExamScenario}>
                    {examIndex < examOrderIds.length - 1 ? '进入下一题' : '查看考试总报告'}
                  </button>
                ) : (
                  <button className="primary-button" onClick={engine.reset}>重新训练</button>
                )}
              </div>
            )}

            {examComplete && (
              <div className="scene-overlay result-overlay session-report">
                <span className="result-icon">{examResults.every((result) => result.passed) ? '✓' : '!'}</span>
                <span className="overlay-index">EXAM SESSION COMPLETE</span>
                <h2>考试总报告</h2>
                <p>三道情景题已完成。总成绩按各题得分平均计算，任一场景发生严重事故会在结果中单独标记。</p>
                <div className="report-metrics">
                  <span>综合成绩 <strong>{examTotalScore}</strong></span>
                  <span>能力评级 <strong>{getGrade(examTotalScore)}</strong></span>
                  <span>通过题数 <strong>{examResults.filter((result) => result.passed).length}/{examResults.length}</strong></span>
                  <span>累计违规 <strong>{examResults.reduce((total, result) => total + result.violationCount, 0)}</strong></span>
                </div>
                <div className="session-result-table">
                  {examResults.map((result, index) => (
                    <div key={result.scenarioId}>
                      <span>{index + 1}</span>
                      <strong>{result.title}</strong>
                      <small>{formatElapsed(result.elapsedSeconds)}</small>
                      <small>{result.violationCount} 次违规</small>
                      <b className={result.passed ? 'passed' : 'failed'}>{result.passed ? '通过' : '事故失败'}</b>
                      <em>{result.score}</em>
                    </div>
                  ))}
                </div>
                <button className="primary-button" onClick={resetExamSession}>返回场景选择</button>
              </div>
            )}
          </div>
        </div>

        <aside className="side-panel">
          <section className="panel-section">
            <div className="section-heading">
              <span className="eyebrow">任务目标</span>
              <span>{scenario.objectives.filter((objective) => objective.completionFlags.every((flag) => state.flags.includes(flag))).length}/{scenario.objectives.length}</span>
            </div>
            <ol className="task-list">
              {scenario.objectives.map((objective, index) => {
                const complete = objective.completionFlags.every((flag) => state.flags.includes(flag))
                const active = !complete && activeObjective?.id === objective.id
                return (
                  <li className={complete ? 'complete' : active ? 'active' : ''} key={objective.id} aria-current={active ? 'step' : undefined}>
                    <span className="step-index">{complete ? '✓' : index + 1}</span>
                    <div>
                      <strong>{objective.title}</strong>
                      <span>{complete ? '目标达成' : objective.description}</span>
                    </div>
                  </li>
                )
              })}
            </ol>
          </section>

          <section className="panel-section context-panel">
            <span className="eyebrow">已发现线索</span>
            <h3>{state.discoveredClueIds.length > 0 ? `${state.discoveredClueIds.length} 条现场信息` : '尚未获得有效线索'}</h3>
            <p>{state.discoveredClueIds.length > 0
              ? scenario.clues.filter((clue) => state.discoveredClueIds.includes(clue.id)).map((clue) => `${clue.title}：${clue.detail}`).join(' ')
              : '请靠近设备进行检查。考试不会告诉你下一步应该操作哪台设备。'}</p>
            <div className="inventory-block">
              <span className="eyebrow">随身装备</span>
              <div className="inventory-list">
                {state.inventoryItemIds.length === 0 ? (
                  <span className="inventory-empty">暂无装备</span>
                ) : (
                  scenario.inventoryItems
                    .filter((item) => state.inventoryItemIds.includes(item.id))
                    .map((item) => <span className="inventory-item" key={item.id}>{item.label}</span>)
                )}
              </div>
            </div>
            {state.mode === 'training' && state.phase === 'running' && activeObjective && (
              <div className="training-hint">
                <span className="eyebrow">训练提示</span>
                <p>{activeObjective.trainingHint}</p>
              </div>
            )}
          </section>

          <section className="panel-section log-panel">
            <div className="section-heading">
              <span className="eyebrow">操作时间线</span>
              <span>{state.actionHistory.length} 条</span>
            </div>
            <div className="event-list">
              {state.actionHistory.length === 0 ? (
                <p className="empty-log">进入现场后，系统将记录你的每一步操作。</p>
              ) : (
                [...state.actionHistory].reverse().slice(0, 6).map((record) => (
                  <div className={`event ${state.mode === 'training' ? `event-${record.outcome === 'success' ? 'success' : record.outcome === 'minor' ? 'warning' : 'danger'}` : ''}`} key={record.id}>
                    <i />
                    <span><time>{formatElapsed(record.elapsedSeconds)}</time>{record.entityName} · {record.actionLabel}</span>
                  </div>
                ))
              )}
            </div>
          </section>
        </aside>
      </section>
    </main>
  )
}

function Metric({ kind, label, value, alert = false }: { kind: 'time' | 'risk' | 'score'; label: string; value: string; alert?: boolean }) {
  const icons = { time: 'T−', risk: '△', score: 'PTS' }
  return (
    <div className={`metric metric-${kind} ${alert ? 'metric-alert' : ''}`}>
      <span className="metric-icon" aria-hidden="true">{icons[kind]}</span>
      <div className="metric-content">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  )
}

function getDeviceSymbol(kind: string) {
  if (kind.includes('泵')) return 'P'
  if (kind.includes('阀')) return 'V'
  if (kind.includes('表') || kind.includes('仪')) return 'G'
  if (kind.includes('柜') || kind.includes('终端')) return 'C'
  return 'EQ'
}

function formatElapsed(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

function getGrade(score: number) {
  if (score >= 90) return 'A'
  if (score >= 80) return 'B'
  if (score >= 70) return 'C'
  if (score >= 60) return 'D'
  return '不合格'
}

function getCompletionRoute(
  faultType: (typeof scenarioCatalog)[number]['faultType'],
  flags: string[],
) {
  if (faultType === 'signalFault') return '现场信号复核'
  const protection = flags.includes('backup-running') ? '备用供油' : '受控停机'
  return faultType === 'filterBlockage'
    ? `${protection} + 备用过滤器切换`
    : `${protection} + 泄漏支路隔离`
}

export default App
