# 场景配置规范

新增题目优先复用现有地图和设备，只替换故障配置。完整示例位于 `src/simulation/scenarioVariants.ts`。

## 必填结构

每个 `ScenarioDefinition` 需要配置：

- `id`：全局唯一题目编号
- `faultType`：控制场景动态表现的故障类型
- `title`、`briefing`、`role`：考试文案
- `timeLimit`、`initialRisk`、`riskGrowthPerSecond`：时间与风险演化
- `entities`：本题启用的设备及其可执行动作
- `zones`：影响移动路线的空间危险区
- `clues`：检查动作可以发现的信息
- `objectives`：对考生可见的高层目标及训练提示
- `rules`：动作的前置条件、状态影响、线索、风险和评分
- `completionFlags`：判定题目完成所需的状态集合

## 动作规则原则

1. 每个启用设备的每个动作必须存在对应规则。
2. 正确动作通过 `requiredFlags` 表达前置条件，通过 `addFlags` 改变世界状态。
3. 一般错误使用 `minor`，允许考生修正后继续。
4. 会导致人身伤害或系统失稳的错误使用 `critical`。
5. 线索必须先定义在 `clues` 中，才能由规则的 `addClueIds` 引用。
6. 完成条件中的每个 flag 都必须能由某条启用动作规则产生。

## 评分

五个维度总分固定为 100：风险识别 20、故障诊断 25、操作规范 20、处置效果 25、响应效率 10。动作通过 `scoreImpacts` 影响前四项，响应效率由引擎根据用时和违规次数结算。

## 新题验收

- 指导训练能够给出正确阶段提示
- 正式考试不泄露标准操作链
- 至少存在一条成功路径和两类错误路径
- 所有设备动作都有可解释结果
- 重置后不保留上一题状态
- 场景配置校验无异常
- `pnpm run build` 通过
