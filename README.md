# SafeOps Simulator

一个用于验证“业务规则如何映射到二维互动场景”的工业安全训练 MVP。

> [!WARNING]
> **V1 路线已暂时废弃。** 当前版本验证了任务、规则、评分和考试闭环，但“完整背景图 + 透明交互热点 + 弹窗选择”的方案仍接近可移动的交互页面，缺少严肃游戏应有的连续操作、工具使用、环境反馈和玩法深度。代码保留作为业务闭环与失败路线记录，后续开发转向 `gameplay-graybox-v2`：先用灰盒完成角色控制、碰撞、危险扩散、工具操作和即时反馈，再接入正式业务与素材。

## 当前闭环

- WASD / 方向键控制巡检员在设备间移动
- 靠近设备后按 `E` 执行现场动作
- 支持指导训练与三题连续正式考试
- 同一设备地图包含支路泄漏、过滤器堵塞、远传信号故障三种配置题
- 支持诊断线索、分支处置、空间危险区、装备工具和动态设备状态
- 一般违规可恢复，严重违规触发事故失败
- 完成后输出五维评分、操作复盘和考试总报告

场景数据位于 `src/simulation/scenario.ts` 和 `src/simulation/scenarioVariants.ts`，规则执行位于 `src/simulation/SimulationEngine.ts`，PixiJS 只负责世界呈现与输入。新增题目参见 `SCENARIO_AUTHORING.md`。

## 本地运行

```bash
pnpm install
pnpm run dev
```

生产构建：

```bash
pnpm run build
```
