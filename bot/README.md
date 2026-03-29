# Bot Runtime

## 目标

当前 `bot/` 的目标是把套利 MVP 推进为一条可运行的单策略闭环：

- 离线任务定期生成默认参数配置
- 在线模块统一读取已批准配置
- 支持 simulation、real-data validation、paper 三种运行方式
- 指标、风控、回放和上线 Gate 使用同一口径

## 运行方式

### 1. Synthetic simulation

```bash
pnpm bot:simulate
```

### 2. Simulation smoke checks

```bash
pnpm bot:test
```

### 3. Real-data validation (Gamma 映射验证)

```bash
pnpm bot:example:real
```

说明：该入口只用于验证市场列表、token 映射和标准化事件生成，不等同于真实 CLOB 交易。

### 4. Paper trading runtime

```bash
pnpm bot:example:paper
```

### 5. Full test suite

```bash
pnpm bot:test:all
```

## 默认配置

在线模块通过 `bot/config/runtime.ts` 读取 `bot/config/generated/runtime-defaults.json`。

配置中包含：

- `version` / `generatedAt` / `approval`
- `strategies.staticArb`
- `risk`
- `execution`
- `markets`
- `models.bayesian`
- `models.stoikov`
- `models.kelly`
- `models.monteCarlo`

## 离线参数刷新

```bash
pnpm bot:config:update
```

该任务会：

- 更新配置版本号与时间戳
- 将审批状态重置为 `draft`
- 保留现有默认阈值与白名单结构

在 `paper` / `live-safe` 模式中，只应加载审批状态为 `approved` 的配置。

## 风控与回滚

- 连续失败超阈值：进入 only-reduce / kill switch
- 日内亏损或回撤超限：停止新开仓
- 订单状态无法对齐：回退到上一版已批准配置
- `real-data validation` 仅作数据验证，不直接承担实盘输入职责

## P0 Gate

- 双腿完成率 `>= 95%`
- 扣费和执行成本后净 EV 为正
- 风控穿透事故 `= 0`
- 最大回撤不超过预算阈值
- 回放与在线记录一致
