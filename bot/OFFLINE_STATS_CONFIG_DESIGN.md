# 离线数据统计与配置系统设计文档

## 1. 概述

本文档描述 bot 系统的离线配置管理和数据统计持久化架构。目标是将所有硬编码参数
外部化为可修改的配置文件，并通过 JSON session 文件实现跨运行的状态持久化。

## 2. 配置系统 (`bot/config/`)

### 2.1 文件结构

```
bot/config/
├── default.json   # 默认配置（随代码提交）
└── index.ts       # 配置加载器 + TypeScript 类型
```

### 2.2 配置项

| 分组 | 参数 | 默认值 | 说明 |
|------|------|--------|------|
| **portfolio** | initialEquity | 10000 | 初始权益（USD） |
| | maxOpenNotional | 2000 | 最大持仓敞口 |
| **execution** | kellyCap | 0.02 | 单笔最大仓位比例 |
| | stoikovRiskAversion | 0.002 | 库存风险厌恶系数 |
| | slippageBps | 50 | 滑点（基点），实盘建议 30-80 |
| | partialFillBaseRate | 0.5 | 基础成交率 |
| | partialFillSizeDecay | 0.001 | 大单成交率衰减 |
| **signal** | costBps | 20 | 交易成本（基点） |
| | minEvBps | 5 | 最小期望值阈值 |
| | confidenceThreshold | 0.1 | 最低置信度 |
| **risk** | intradayStopPct | -2 | 日内止损触发线（%） |
| | maxDrawdownPct | -4 | 最大回撤熔断线（%） |
| | maxPositionPct | 25 | 单一持仓集中度上限（%） |
| **data** | tickLimit | 50 | 每轮数据获取量 |
| | spreadOverride | 0.01 | 合成价差 |

### 2.3 加载机制

```
优先级: BOT_CONFIG_PATH 环境变量 > default.json
```

```typescript
import { loadConfig } from '../config'
const config = loadConfig()                       // 加载默认
const config = loadConfig('/path/to/custom.json')  // 指定路径
```

配置在首次加载后缓存在内存中，避免重复读取。

### 2.4 自定义配置

用户可以复制 `default.json` 为 `custom.json`，修改参数后通过环境变量指定：

```bash
BOT_CONFIG_PATH=bot/config/custom.json pnpm bot:paper
```

## 3. Session 持久化 (`bot/data/session.json`)

### 3.1 数据结构

```json
{
  "wallet": {
    "address": "0x...",
    "safeAddress": "0x...",
    "privateKey": "0x..."
  },
  "updatedAt": "2026-03-28T07:00:00Z",
  "portfolio": {
    "initialEquity": 10000,
    "cash": 9800.17,
    "equity": 10002.02,
    "peakEquity": 10002.02
  },
  "positions": [
    {
      "marketId": "mkt-btc-70k",
      "side": "YES",
      "size": 4.80,
      "avgEntry": 0.4020,
      "currentPrice": 0.4100,
      "unrealizedPnl": 0.0384
    }
  ],
  "orders": [ ... ],
  "stats": {
    "totalTrades": 30,
    "fillRate": 0.85,
    "totalArbProfit": 2.02,
    "totalSlippageCost": 0.99,
    "sessionsRun": 1
  }
}
```

### 3.2 读写接口

```typescript
import { saveSession, loadSession } from './persistence'

// 写入（paper trading 结束时自动调用）
saveSession(data)

// 读取（scanner 启动时加载）
const session = loadSession()  // 返回 SessionData | null
```

### 3.3 文件位置

- 路径: `bot/data/session.json`
- 目录自动创建（`mkdirSync recursive`）
- `.gitignore` 应排除 `bot/data/` 目录（含隐私密钥）

### 3.4 数据安全

**重要**: `session.json` 包含钱包私钥，仅用于 paper trading。
- 不应提交到版本控制
- 生产环境应使用加密存储或硬件签名器
- 当前实现足够用于本地测试和开发

## 4. 定时扫描 (`bot/paper/scanner.ts`)

### 4.1 工作流程

```
加载 session.json
    → 恢复 PaperPortfolio 状态
    → fetchRealTicks() 获取最新价格
    → markToMarket() 更新估值
    → 运行告警检查
    → 输出格式化报告
```

### 4.2 告警规则

| 级别 | 条件 | 消息 |
|------|------|------|
| CRIT | drawdown >= maxDrawdownPct | 回撤超过熔断线 |
| WARN | drawdown >= intradayStopPct | 回撤接近止损线 |
| WARN | 单持仓 > maxPositionPct | 集中度过高 |
| WARN | session > 24h 未更新 | 数据过期 |

### 4.3 定时配置

推荐使用 Claude Code `/schedule` 配置 cron：

```
Cron: 0 * * * *  (每小时整点)
命令: pnpm bot:scan
```

## 5. 数据流总览

```
                     ┌─────────────┐
                     │ default.json│  ← 配置参数
                     └──────┬──────┘
                            │
                ┌───────────▼──────────┐
                │   pnpm bot:paper     │  ← Paper Trading 引擎
                │                      │
                │  Gamma API / Fixture  │
                │       ↓              │
                │  信号 → 风控 → 执行  │
                │  (滑点 + 部分成交)   │
                └───────────┬──────────┘
                            │
                     ┌──────▼──────┐
                     │session.json │  ← 持久化状态
                     └──────┬──────┘
                            │
                ┌───────────▼──────────┐
                │   pnpm bot:scan      │  ← 每小时扫描
                │                      │
                │  加载 → 盯市 → 告警  │
                └──────────────────────┘
```

## 6. 滑点模型

### 6.1 执行价格

```
execPrice = 报价 × (1 + slippageBps / 10000)
```

默认 50bps，即 $0.50 的报价实际执行为 $0.5025。
对比实盘 Polymarket 平均滑点约 20-40bps，我们故意设高以留安全边际。

### 6.2 部分成交

```
fillRate = max(0.1, baseRate - size × sizeDecay)
filledSize = requestedSize × fillRate
```

- 小单（<10 shares）约 50% 成交率
- 大单（100+ shares）约 40% 成交率
- 防止 paper trading 高估实盘执行能力

### 6.3 关键指标

- **Locked Arb Profit**: 对冲 YES+NO 在结算时的保证利润
- **Slippage Cost**: 因滑点支付的额外成本
- **Net After Slippage**: 扣除滑点后的真实收益

## 7. 未来扩展

1. **多 session 支持** — 按日期归档历史 session
2. **SQLite 存储** — 替代 JSON 用于大量订单记录
3. **配置热更新** — 运行中动态重载配置文件
4. **Webhook 告警** — scanner 发现问题时推送到 Slack/Telegram
5. **指标仪表盘** — 将 stats 数据接入 Grafana/Web UI
