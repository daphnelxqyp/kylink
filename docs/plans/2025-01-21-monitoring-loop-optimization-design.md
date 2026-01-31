# Google Ads Script 监控循环优化设计

## 概述

优化 `campaign_sync_to_sheet.js` 脚本的监控循环机制，移除固定的 `MAX_LOOPS` 配置，改为纯时间驱动，并增加详细的运行统计报告。

## 背景问题

当前配置存在问题：
- `MAX_LOOPS: 50` 是固定值
- 如果前面阶段（扫描+联盟链接+写表格）耗时较长，留给监控的时间不足
- 可能永远达不到配置的循环次数，配置失去意义

## 设计目标

1. 移除 `MAX_LOOPS` 配置，循环完全由时间控制
2. 采用激进策略，尽可能多跑循环
3. 提供详细的运行统计报告

---

## 第 1 部分：配置变更

### 移除的配置项

```javascript
// 删除
MAX_LOOPS: 50,  // 不再需要
```

### 保留的配置项

```javascript
LOOP_INTERVAL_SECONDS: 30,    // 每次循环间隔（保留，用户可调）
MAX_RUNTIME_SECONDS: 28 * 60, // 最长运行时间（保留，核心安全机制）
```

### 新增的统计状态

在 `STATE` 对象中增加运行时统计：

```javascript
var STATE = {
  // ... 现有字段 ...

  // 新增：循环统计
  stats: {
    loopCount: 0,           // 实际完成循环次数
    totalLoopTime: 0,       // 循环阶段总耗时（秒）
    clickGrowthCount: 0,    // 检测到点击增长的次数
    suffixApplySuccess: 0,  // 后缀写入成功次数
    suffixApplyFailed: 0,   // 后缀写入失败次数
    monitoringStartTime: null  // 监控阶段开始时间
  }
};
```

---

## 第 2 部分：循环逻辑变更

### 修改前（当前逻辑）

```javascript
function runMonitoringLoop(campaigns, mccId) {
  var loop = 0;
  while (loop < CONFIG.MAX_LOOPS) {  // 固定次数限制
    if (shouldStop(...)) break;
    loop++;
    // ...
  }
}
```

### 修改后（时间驱动）

```javascript
function runMonitoringLoop(campaigns, mccId) {
  STATE.stats.monitoringStartTime = new Date();

  while (true) {  // 无限循环，完全由时间控制
    // 循环开始前检查时间
    if (shouldStop('监控循环 #' + (STATE.stats.loopCount + 1))) {
      break;
    }

    STATE.stats.loopCount++;

    // ... 现有的循环体逻辑（等待、刷新点击、检测增长、申请后缀）...

    // 每次循环结束时更新统计
    // clickGrowthCount, suffixApplySuccess, suffixApplyFailed 在对应位置累加
  }

  // 计算监控阶段总耗时
  STATE.stats.totalLoopTime = (new Date() - STATE.stats.monitoringStartTime) / 1000;
}
```

### 关键点

- `while (true)` 替代 `while (loop < MAX_LOOPS)`
- 循环次数改用 `STATE.stats.loopCount` 追踪
- 时间检查点保持不变（循环开始、sleep 后、申请后缀前等）

---

## 第 3 部分：详细报告输出

### 修改 `logFinalReport` 函数

```javascript
function logFinalReport(timeZone, campaigns) {
  var endTime = new Date();
  var totalDuration = (endTime - STATE.startTime) / 1000;
  var stats = STATE.stats;

  Logger.log('');
  Logger.log('===== 运行报告 =====');
  Logger.log('结束时间: ' + formatDateTime(endTime, timeZone));
  Logger.log('总运行时长: ' + formatDuration(totalDuration));
  Logger.log('广告系列数: ' + (campaigns ? campaigns.length : 0));

  // 新增：监控循环详情
  if (stats.monitoringStartTime) {
    var monitoringDuration = stats.totalLoopTime || 0;
    var avgLoopTime = stats.loopCount > 0
      ? (monitoringDuration / stats.loopCount)
      : 0;
    var monitoringRatio = totalDuration > 0
      ? (monitoringDuration / totalDuration * 100)
      : 0;

    Logger.log('');
    Logger.log('----- 监控统计 -----');
    Logger.log('完成循环: ' + stats.loopCount + ' 次');
    Logger.log('平均耗时: ' + avgLoopTime.toFixed(1) + ' 秒/次');
    Logger.log('点击增长: ' + stats.clickGrowthCount + ' 次');
    Logger.log('后缀写入: ' + stats.suffixApplySuccess + ' 成功, '
               + stats.suffixApplyFailed + ' 失败');
    Logger.log('监控占比: ' + monitoringRatio.toFixed(1) + '%');
  }

  // 状态
  Logger.log('');
  if (STATE.forceStopped) {
    Logger.log('状态: ⛔ 因时间限制停止');
  } else {
    Logger.log('状态: ✅ 正常结束');
  }
}
```

### 示例输出

```
===== 运行报告 =====
结束时间: 2025-01-21 15:28:00
总运行时长: 28m 0s
广告系列数: 156

----- 监控统计 -----
完成循环: 42 次
平均耗时: 35.2 秒/次
点击增长: 8 次
后缀写入: 7 成功, 1 失败
监控占比: 88.6%

状态: ⛔ 因时间限制停止
```

---

## 第 4 部分：统计数据收集点

### 在循环体中埋点

```javascript
function runMonitoringLoop(campaigns, mccId) {
  STATE.stats.monitoringStartTime = new Date();

  while (true) {
    if (shouldStop('监控循环 #' + (STATE.stats.loopCount + 1))) {
      break;
    }

    STATE.stats.loopCount++;  // ← 每次循环 +1

    // ... 等待、刷新点击数 ...

    // 检测点击增长
    var growth = [];
    for (var i = 0; i < campaigns.length; i++) {
      // ...
      if (increased && allow) {
        growth.push(c);
      }
    }

    if (growth.length > 0) {
      STATE.stats.clickGrowthCount++;  // ← 有增长时 +1
    }

    // ... 调用 lease API ...

    for (var j = 0; j < leaseResults.length; j++) {
      // ...
      if (result.action === 'APPLY' && result.finalUrlSuffix) {
        try {
          applySuffixToCampaign(campaign, result.finalUrlSuffix);
          STATE.stats.suffixApplySuccess++;  // ← 成功 +1
        } catch (e) {
          STATE.stats.suffixApplyFailed++;   // ← 失败 +1
        }
      }
    }

    updateLastClicks(campaigns);
  }

  STATE.stats.totalLoopTime = (new Date() - STATE.stats.monitoringStartTime) / 1000;
}
```

### 统计收集位置汇总

| 统计项 | 收集位置 | 触发条件 |
|--------|----------|----------|
| `loopCount` | 循环开始 | 每次循环 |
| `clickGrowthCount` | 检测增长后 | `growth.length > 0` |
| `suffixApplySuccess` | 写入后缀成功 | `applySuffixToCampaign` 无异常 |
| `suffixApplyFailed` | 写入后缀失败 | `applySuffixToCampaign` 抛异常 |
| `totalLoopTime` | 循环结束 | 退出 while 后 |

---

## 第 5 部分：变更总结

### 文件变更清单

| 变更项 | 位置 | 操作 |
|--------|------|------|
| `CONFIG.MAX_LOOPS` | 第 24 行 | 删除 |
| `STATE.stats` | 第 65-75 行 | 新增统计对象 |
| `runMonitoringLoop()` | 第 545-654 行 | 改为 `while(true)` + 埋点 |
| `logFinalReport()` | 第 183-200 行 | 新增监控统计输出 |

### 影响范围

- **不影响**：阶段 1-4（扫描、联盟链接、写表格、初始化）
- **不影响**：现有的 `shouldStop()` 时间检查机制
- **不影响**：API 调用逻辑

### 风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| 死循环 | 低 | `shouldStop()` 机制完备，已有多个检查点 |
| 统计不准 | 低 | 仅用于日志，不影响核心逻辑 |

### 测试建议

1. 设置 `MAX_RUNTIME_SECONDS: 60`（1分钟），验证循环能正常退出
2. 设置 `DRY_RUN: true`，验证统计数据正确累加
3. 观察日志报告格式是否符合预期

---

## 审批状态

- 日期：2025-01-21
- 状态：✅ 已实现
