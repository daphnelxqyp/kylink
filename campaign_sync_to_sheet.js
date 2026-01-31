// =====================================================================
// Google Ads Script: Campaign 扫描 + 联盟链接 + 点击监控换链
// =====================================================================
// 使用场景：
// 1) 扫描 MCC 下所有有效 CID 的有效 Campaign
// 2) 获取联盟链接并写入 Google 表格
// 3) 按指定次数循环，间隔固定秒数刷新“今日点击数”
// 4) 如果点击数有增长，则请求后缀并写入 Google Ads
// 5) 接近 30 分钟自动停止，避免脚本超时
// =====================================================================

// ===== 配置区域 =====
var CONFIG = {
  // Google 表格配置
  SPREADSHEET_URL: 'https://docs.google.com/spreadsheets/d/YOUR_SPREADSHEET_ID/edit',
  SHEET_NAME: 'Campaigns',
  CLEAR_BEFORE_WRITE: true,

  // API 配置
  API_BASE_URL: 'https://your-domain.com',
  API_KEY: 'ky_live_your_api_key_here',

  // 循环监控配置
  LOOP_INTERVAL_SECONDS: 30,
  CYCLE_MINUTES: 30,

  // ⚠️ 时间限制配置（Google Ads Script 最长运行 30 分钟）
  // 28 分钟 = 1680 秒，预留 2 分钟安全缓冲
  MAX_RUNTIME_SECONDS: 28 * 60,

  // 批量大小
  BATCH_SIZE: 100,

  // 功能开关
  ENABLE_AFFILIATE_LOOKUP: true,
  ENABLE_SHEET_WRITE: true,
  ENABLE_SUFFIX_APPLY: true,
  ONLY_APPLY_WHEN_AFFILIATE_FOUND: true, // 仅有联盟链接时才允许写后缀
  DRY_RUN: false
};

// ===== 表头定义 =====
var COLUMN_HEADERS = [
  'campaignId',
  'campaignName',
  'country',
  'finalUrl',
  'todayClicks',
  'cid',
  'mccId',
  'networkShortName',
  'mid',
  'trackingUrl',
  'hasAffiliate',
  'lastClicks',
  'currentClicks',
  'lastSuffix',
  'lastApplyTime',
  'status',
  'updatedAt'
];

// ===== 运行态 =====
var STATE = {
  startTime: null,
  scriptInstanceId: '',
  campaignMap: {},
  accountsByCid: {},
  forceStopped: false,  // 强制停止标志

  // 循环统计
  stats: {
    loopCount: 0,              // 实际完成循环次数
    totalLoopTime: 0,          // 循环阶段总耗时（秒）
    clickGrowthLoops: 0,       // 有点击增长的循环次数
    clickGrowthCampaigns: 0,   // 点击增长的 campaign 次数总和
    suffixApplySuccess: 0,     // 后缀写入成功次数
    suffixApplyFailed: 0,      // 后缀写入失败次数
    monitoringStartTime: null  // 监控阶段开始时间
  }
};

// =====================================================================
// 时间控制（核心安全机制）
// =====================================================================

/**
 * 检查是否应该停止脚本
 * @param {string} phase - 当前阶段名称（用于日志）
 * @returns {boolean} - true 表示应该立即停止
 */
function shouldStop(phase) {
  if (STATE.forceStopped) {
    return true;
  }

  var elapsed = (new Date() - STATE.startTime) / 1000;
  if (elapsed >= CONFIG.MAX_RUNTIME_SECONDS) {
    STATE.forceStopped = true;
    Logger.log('');
    Logger.log('⛔ 强制停止: 已运行 ' + Math.floor(elapsed) + ' 秒，接近 30 分钟限制');
    Logger.log('   停止位置: ' + (phase || 'unknown'));
    return true;
  }
  return false;
}

/**
 * 获取剩余可用时间（秒）
 */
function getRemainingSeconds() {
  var elapsed = (new Date() - STATE.startTime) / 1000;
  return Math.max(0, CONFIG.MAX_RUNTIME_SECONDS - elapsed);
}

// =====================================================================
// 主入口
// =====================================================================
function main() {
  STATE.startTime = new Date();
  STATE.scriptInstanceId = generateInstanceId();
  STATE.forceStopped = false;

  var timeZone = AdsApp.currentAccount().getTimeZone();
  var mccId = AdsApp.currentAccount().getCustomerId();

  Logger.log('Start: ' + formatDateTime(STATE.startTime, timeZone));
  Logger.log('MCC ID: ' + mccId);
  Logger.log('Instance: ' + STATE.scriptInstanceId);
  Logger.log('Max runtime: ' + CONFIG.MAX_RUNTIME_SECONDS + 's (' + (CONFIG.MAX_RUNTIME_SECONDS / 60) + ' min)');

  // ===== 阶段 1: 扫描广告系列 =====
  Logger.log('');
  Logger.log('===== 阶段 1: 扫描广告系列 =====');
  var campaigns = scanAllCampaigns(mccId);
  Logger.log('Total campaigns: ' + campaigns.length);

  if (shouldStop('阶段1结束')) {
    logFinalReport(timeZone, campaigns);
    return;
  }

  if (campaigns.length === 0) {
    Logger.log('No campaigns. Exit.');
    return;
  }

  // ===== 阶段 2: 获取联盟链接 =====
  Logger.log('');
  Logger.log('===== 阶段 2: 获取联盟链接 =====');
  if (CONFIG.ENABLE_AFFILIATE_LOOKUP && !shouldStop('阶段2开始')) {
    campaigns = fetchAffiliateLinks(campaigns);
  } else if (!CONFIG.ENABLE_AFFILIATE_LOOKUP) {
    Logger.log('Affiliate lookup disabled.');
  }

  if (shouldStop('阶段2结束')) {
    logFinalReport(timeZone, campaigns);
    return;
  }

  // ===== 阶段 3: 写入表格 =====
  Logger.log('');
  Logger.log('===== 阶段 3: 写入表格 =====');
  if (CONFIG.ENABLE_SHEET_WRITE && !shouldStop('阶段3开始')) {
    writeToSheet(campaigns);
  } else if (!CONFIG.ENABLE_SHEET_WRITE) {
    Logger.log('Sheet write disabled.');
  }

  if (shouldStop('阶段3结束')) {
    logFinalReport(timeZone, campaigns);
    return;
  }

  // ===== 阶段 4: 初始化点击数 =====
  Logger.log('');
  Logger.log('===== 阶段 4: 初始化点击数 =====');
  initClicksState(campaigns);

  // ===== 阶段 5: 循环监控并换链 =====
  Logger.log('');
  Logger.log('===== 阶段 5: 循环监控并换链 =====');
  if (CONFIG.ENABLE_SUFFIX_APPLY && !shouldStop('阶段5开始')) {
    runMonitoringLoop(campaigns, mccId);
  } else if (!CONFIG.ENABLE_SUFFIX_APPLY) {
    Logger.log('Suffix apply disabled.');
  }

  logFinalReport(timeZone, campaigns);
}

/**
 * 输出最终报告
 */
function logFinalReport(timeZone, campaigns) {
  var endTime = new Date();
  var totalDuration = (endTime - STATE.startTime) / 1000;
  var stats = STATE.stats;

  Logger.log('');
  Logger.log('===== 运行报告 =====');
  Logger.log('结束时间: ' + formatDateTime(endTime, timeZone));
  Logger.log('总运行时长: ' + formatDuration(totalDuration));
  Logger.log('广告系列数: ' + (campaigns ? campaigns.length : 0));

  // 监控循环详情
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
    Logger.log('点击增长: ' + stats.clickGrowthLoops + ' 次（循环）');
    Logger.log('点击增长: ' + stats.clickGrowthCampaigns + ' 次（campaign 合计）');
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

// =====================================================================
// 扫描 Campaign
// =====================================================================
function scanAllCampaigns(mccId) {
  var allCampaigns = [];
  var accounts = [];
  var accountIterator = AdsManagerApp.accounts().get();

  while (accountIterator.hasNext()) {
    var account = accountIterator.next();
    accounts.push(account);
    STATE.accountsByCid[account.getCustomerId()] = account;
  }

  Logger.log('Accounts found: ' + accounts.length);

  for (var i = 0; i < accounts.length; i++) {
    // 每处理 5 个账户检查一次时间
    if (i > 0 && i % 5 === 0 && shouldStop('扫描账户 #' + i)) {
      Logger.log('  扫描中断，已处理 ' + i + '/' + accounts.length + ' 个账户');
      break;
    }

    var account = accounts[i];
    AdsManagerApp.select(account);

    var cid = AdsApp.currentAccount().getCustomerId();
    var accountName = AdsApp.currentAccount().getName();

    try {
      var campaigns = getCampaignData(cid, mccId);
      if (campaigns.length > 0) {
        Logger.log('  OK: ' + accountName + ' (' + cid + ') -> ' + campaigns.length);
        allCampaigns = allCampaigns.concat(campaigns);
      }
    } catch (e) {
      Logger.log('  ERROR: ' + accountName + ' (' + cid + ') -> ' + e.message);
    }
  }

  return allCampaigns;
}

function getCampaignData(cid, mccId) {
  var campaigns = [];
  var now = new Date().toISOString();
  var campaignMap = {};

  // 1) 基础信息
  var campaignQuery =
    "SELECT campaign.id, campaign.name " +
    "FROM campaign " +
    "WHERE campaign.status = 'ENABLED'";

  var campaignReport = AdsApp.report(campaignQuery);
  var campaignRows = campaignReport.rows();

  while (campaignRows.hasNext()) {
    var row = campaignRows.next();
    var campaignId = row['campaign.id'];
    var campaignName = row['campaign.name'];
    var parsed = parseCampaignName(campaignName);

    campaignMap[campaignId] = {
      campaignId: campaignId,
      campaignName: campaignName,
      country: '',
      finalUrl: '',
      todayClicks: 0,
      cid: cid,
      mccId: mccId,
      networkShortName: parsed.networkShortName,
      mid: parsed.mid,
      trackingUrl: '',
      hasAffiliate: false,
      lastClicks: 0,
      currentClicks: 0,
      lastSuffix: '',
      lastApplyTime: '',
      status: parsed.parsed ? 'ready' : 'no_affiliate_info',
      updatedAt: now
    };
  }

  // 2) 今日点击数
  try {
    var clicksQuery =
      "SELECT campaign.id, metrics.clicks " +
      "FROM campaign " +
      "WHERE campaign.status = 'ENABLED' " +
        "AND segments.date DURING TODAY";

    var clicksReport = AdsApp.report(clicksQuery);
    var clicksRows = clicksReport.rows();

    while (clicksRows.hasNext()) {
      var cRow = clicksRows.next();
      var cId = cRow['campaign.id'];
      var clicks = parseInt(cRow['metrics.clicks'], 10) || 0;
      if (campaignMap[cId]) {
        campaignMap[cId].todayClicks = clicks;
      }
    }
  } catch (e) {
    Logger.log('  WARN: clicks failed for ' + cid + ' -> ' + e.message);
  }

  // 3) 地理定向
  try {
    var geoQuery =
      "SELECT campaign.id, campaign_criterion.location.geo_target_constant " +
      "FROM campaign_criterion " +
      "WHERE campaign.status = 'ENABLED' " +
        "AND campaign_criterion.type = LOCATION " +
        "AND campaign_criterion.negative = false";

    var geoReport = AdsApp.report(geoQuery);
    var geoRows = geoReport.rows();
    var geoMap = {};

    while (geoRows.hasNext()) {
      var gRow = geoRows.next();
      var gId = gRow['campaign.id'];
      var geoConstant = gRow['campaign_criterion.location.geo_target_constant'];
      if (!geoMap[gId]) geoMap[gId] = [];
      if (geoConstant && geoMap[gId].indexOf(geoConstant) === -1) {
        geoMap[gId].push(geoConstant);
      }
    }

    for (var id in geoMap) {
      if (campaignMap[id]) {
        campaignMap[id].country = geoMap[id].join('; ');
      }
    }
  } catch (e) {
    Logger.log('  WARN: geo failed for ' + cid + ' -> ' + e.message);
  }

  // 4) 最终网址
  try {
    var adQuery =
      "SELECT campaign.id, ad_group_ad.ad.final_urls " +
      "FROM ad_group_ad";

    var adReport = AdsApp.report(adQuery);
    var adRows = adReport.rows();
    var urlMap = {};

    while (adRows.hasNext()) {
      var aRow = adRows.next();
      var aId = aRow['campaign.id'];
      var finalUrls = aRow['ad_group_ad.ad.final_urls'];
      if (!urlMap[aId] && finalUrls && finalUrls.length > 0) {
        urlMap[aId] = finalUrls[0];
      }
    }

    for (var uId in urlMap) {
      if (campaignMap[uId]) {
        campaignMap[uId].finalUrl = urlMap[uId];
      }
    }
  } catch (e) {
    Logger.log('  WARN: finalUrl failed for ' + cid + ' -> ' + e.message);
  }

  for (var key in campaignMap) {
    campaigns.push(campaignMap[key]);
  }

  return campaigns;
}

// =====================================================================
// 联盟链接
// =====================================================================
function fetchAffiliateLinks(campaigns) {
  if (!CONFIG.API_BASE_URL || !CONFIG.API_KEY) {
    Logger.log('Affiliate lookup skipped: API config missing.');
    return campaigns;
  }

  var toQuery = [];
  var campaignMap = {};

  for (var i = 0; i < campaigns.length; i++) {
    var c = campaigns[i];
    campaignMap[c.campaignId] = c;
    if (c.networkShortName && c.mid) {
      toQuery.push({
        campaignId: c.campaignId,
        networkShortName: c.networkShortName,
        mid: c.mid,
        finalUrl: c.finalUrl || ''
      });
    }
  }

  if (toQuery.length === 0) {
    Logger.log('Affiliate lookup skipped: no valid campaign names.');
    return campaigns;
  }

  var batchSize = CONFIG.BATCH_SIZE || 100;
  var totalBatches = Math.ceil(toQuery.length / batchSize);
  Logger.log('Querying ' + toQuery.length + ' campaigns in ' + totalBatches + ' batches...');

  for (var b = 0; b < totalBatches; b++) {
    // 每批次前检查时间
    if (shouldStop('联盟链接批次 #' + (b + 1))) {
      Logger.log('  查询中断，已完成 ' + b + '/' + totalBatches + ' 批次');
      break;
    }

    var start = b * batchSize;
    var end = Math.min(start + batchSize, toQuery.length);
    var batch = toQuery.slice(start, end);

    try {
      var result = callAffiliateLookupApi(batch);
      if (result && result.success && result.campaignResults) {
        for (var campaignId in result.campaignResults) {
          var info = result.campaignResults[campaignId];
          if (campaignMap[campaignId] && info.found) {
            campaignMap[campaignId].trackingUrl = info.trackingUrl || '';
            campaignMap[campaignId].hasAffiliate = true;
            campaignMap[campaignId].status = 'ready';
          }
        }
      }
    } catch (e) {
      Logger.log('Affiliate batch error: ' + e.message);
    }
  }

  return campaigns;
}

function callAffiliateLookupApi(campaignsBatch) {
  var url = CONFIG.API_BASE_URL.replace(/\/$/, '') + '/api/v1/affiliate-links/lookup';

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + CONFIG.API_KEY,
      'X-Api-Key': CONFIG.API_KEY
    },
    payload: JSON.stringify({ campaigns: campaignsBatch }),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(url, options);
  var code = response.getResponseCode();
  if (code === 200) {
    return JSON.parse(response.getContentText());
  }
  throw new Error('Affiliate API HTTP ' + code + ': ' + response.getContentText());
}

// =====================================================================
// 写入表格
// =====================================================================
function writeToSheet(campaigns) {
  if (CONFIG.DRY_RUN) {
    Logger.log('[DRY_RUN] Sheet write skipped.');
    return;
  }

  try {
    // 写入前排序：按广告系列名称前 3 位数字降序
    campaigns.sort(function(a, b) {
      var numA = parseInt((a.campaignName || '').substring(0, 3), 10) || 0;
      var numB = parseInt((b.campaignName || '').substring(0, 3), 10) || 0;
      return numB - numA;
    });

    var spreadsheet = SpreadsheetApp.openByUrl(CONFIG.SPREADSHEET_URL);
    var sheet = spreadsheet.getSheetByName(CONFIG.SHEET_NAME);

    if (!sheet) {
      sheet = spreadsheet.insertSheet(CONFIG.SHEET_NAME);
    }

    if (CONFIG.CLEAR_BEFORE_WRITE) {
      sheet.clear();
    }

    sheet.getRange(1, 1, 1, COLUMN_HEADERS.length).setValues([COLUMN_HEADERS]);

    var headerRange = sheet.getRange(1, 1, 1, COLUMN_HEADERS.length);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#4285f4');
    headerRange.setFontColor('#ffffff');

    if (campaigns.length > 0) {
      var rows = [];
      for (var i = 0; i < campaigns.length; i++) {
        var c = campaigns[i];
        rows.push([
          c.campaignId,
          c.campaignName,
          c.country,
          c.finalUrl,
          c.todayClicks,
          c.cid,
          c.mccId,
          c.networkShortName,
          c.mid,
          c.trackingUrl,
          c.hasAffiliate ? 'YES' : 'NO',
          c.lastClicks,
          c.currentClicks,
          c.lastSuffix,
          c.lastApplyTime,
          c.status,
          c.updatedAt
        ]);
      }

      sheet.getRange(2, 1, rows.length, COLUMN_HEADERS.length).setValues(rows);
    }

    sheet.setFrozenRows(1);
  } catch (e) {
    Logger.log('Sheet write failed: ' + e.message);
    throw e;
  }
}

// =====================================================================
// 循环监控
// =====================================================================
function initClicksState(campaigns) {
  for (var i = 0; i < campaigns.length; i++) {
    var c = campaigns[i];
    c.lastClicks = c.todayClicks || 0;
    c.currentClicks = c.todayClicks || 0;
    STATE.campaignMap[c.campaignId] = c;
  }
}

function runMonitoringLoop(campaigns, mccId) {
  STATE.stats.monitoringStartTime = new Date();
  var remainingSec = getRemainingSeconds();
  Logger.log('Remaining time: ' + Math.floor(remainingSec) + 's');

  while (true) {  // 无限循环，完全由时间控制
    // 循环开始前检查时间
    if (shouldStop('监控循环 #' + (STATE.stats.loopCount + 1))) {
      break;
    }

    STATE.stats.loopCount++;
    var elapsed = (new Date() - STATE.startTime) / 1000;
    Logger.log('Loop #' + STATE.stats.loopCount + ' (elapsed ' + Math.floor(elapsed) + 's, remaining ' + Math.floor(getRemainingSeconds()) + 's)');

    // 等待间隔（第一次循环不等待）
    if (STATE.stats.loopCount > 1) {
      Logger.log('  Waiting ' + CONFIG.LOOP_INTERVAL_SECONDS + 's...');
      Utilities.sleep(CONFIG.LOOP_INTERVAL_SECONDS * 1000);

      // sleep 后立即检查时间！
      if (shouldStop('监控循环 #' + STATE.stats.loopCount + ' sleep后')) {
        break;
      }
    }

    // 刷新点击数
    refreshClickCounts(campaigns);

    // 检查是否有点击增长（统计与申请后缀分开）
    var increasedCount = 0;
    var eligible = [];
    for (var i = 0; i < campaigns.length; i++) {
      var c = campaigns[i];
      var increased = c.currentClicks > c.lastClicks;
      if (increased) {
        increasedCount++;
      }
      var allow = true;
      if (CONFIG.ONLY_APPLY_WHEN_AFFILIATE_FOUND) {
        allow = !!c.hasAffiliate;
      }
      if (increased && allow) {
        eligible.push(c);
      }
    }

    if (increasedCount === 0) {
      Logger.log('  No click growth.');
      updateLastClicks(campaigns, true);
      continue;
    }

    // 记录点击增长（循环次数 + campaign 次数）
    STATE.stats.clickGrowthLoops++;
    STATE.stats.clickGrowthCampaigns += increasedCount;
    Logger.log('  Growth campaigns: ' + increasedCount + ' (eligible ' + eligible.length + ')');
    if (eligible.length === 0) {
      Logger.log('  All increased campaigns skipped (affiliate not found).');
      updateLastClicks(campaigns, true);
      continue;
    }

    // 申请后缀前检查时间
    if (shouldStop('申请后缀前')) {
      updateLastClicks(campaigns, true);
      break;
    }

    var leaseResults = callLeaseBatchApi(eligible, mccId);
    var ackItems = [];

    for (var j = 0; j < leaseResults.length; j++) {
      // 每处理 10 个结果检查一次时间
      if (j > 0 && j % 10 === 0 && shouldStop('处理后缀结果 #' + j)) {
        break;
      }

      var result = leaseResults[j];
      var campaign = STATE.campaignMap[result.campaignId];
      if (!campaign) continue;

      if (result.action === 'APPLY' && result.finalUrlSuffix) {
        var applyOk = false;
        var applyError = '';

        try {
          if (!CONFIG.DRY_RUN) {
            applySuffixToCampaign(campaign, result.finalUrlSuffix);
          }
          applyOk = true;
          campaign.lastSuffix = result.finalUrlSuffix;
          campaign.lastApplyTime = new Date().toISOString();
          campaign.status = 'applied';
          STATE.stats.suffixApplySuccess++;  // 成功 +1
        } catch (e) {
          applyOk = false;
          applyError = e.message;
          campaign.status = 'apply_failed';
          STATE.stats.suffixApplyFailed++;   // 失败 +1
        }

        ackItems.push({
          leaseId: result.leaseId,
          campaignId: campaign.campaignId,
          applied: applyOk,
          appliedAt: new Date().toISOString(),
          errorMessage: applyOk ? '' : applyError
        });
      }
    }

    // ACK 前检查时间（ACK 不是关键操作，可以跳过）
    if (ackItems.length > 0 && !CONFIG.DRY_RUN && !shouldStop('发送ACK前')) {
      callAckBatchApi(ackItems);
    }

    updateLastClicks(campaigns, true);
  }

  // 计算监控阶段总耗时
  STATE.stats.totalLoopTime = (new Date() - STATE.stats.monitoringStartTime) / 1000;
  Logger.log('Loop finished. Total loops: ' + STATE.stats.loopCount);
}

function refreshClickCounts(campaigns) {
  var campaignsByCid = {};
  for (var i = 0; i < campaigns.length; i++) {
    var c = campaigns[i];
    if (!campaignsByCid[c.cid]) campaignsByCid[c.cid] = [];
    campaignsByCid[c.cid].push(c.campaignId);
  }

  var cidList = Object.keys(campaignsByCid);
  for (var idx = 0; idx < cidList.length; idx++) {
    var cid = cidList[idx];

    // 每处理 3 个账户检查一次时间
    if (idx > 0 && idx % 3 === 0 && shouldStop('刷新点击数 CID #' + idx)) {
      break;
    }

    var account = STATE.accountsByCid[cid];
    if (!account) continue;

    AdsManagerApp.select(account);

    try {
      var query =
        "SELECT campaign.id, metrics.clicks " +
        "FROM campaign " +
        "WHERE campaign.status = 'ENABLED' " +
          "AND segments.date DURING TODAY";

      var report = AdsApp.report(query);
      var rows = report.rows();

      while (rows.hasNext()) {
        var row = rows.next();
        var campaignId = row['campaign.id'];
        var clicks = parseInt(row['metrics.clicks'], 10) || 0;
        if (STATE.campaignMap[campaignId]) {
          STATE.campaignMap[campaignId].currentClicks = clicks;
        }
      }
    } catch (e) {
      Logger.log('Click refresh failed for ' + cid + ': ' + e.message);
    }
  }
}

function updateLastClicks(campaigns, onlyIncrease) {
  for (var i = 0; i < campaigns.length; i++) {
    var c = campaigns[i];
    if (onlyIncrease && c.currentClicks <= c.lastClicks) {
      continue;
    }
    c.lastClicks = c.currentClicks;
  }
}

// =====================================================================
// 后缀申请与写入
// =====================================================================
function callLeaseBatchApi(campaigns, mccId) {
  var url = CONFIG.API_BASE_URL.replace(/\/$/, '') + '/api/v1/suffix/lease/batch';
  var now = new Date();
  var windowStart = Math.floor(now.getTime() / 1000 / 60 / CONFIG.CYCLE_MINUTES) * CONFIG.CYCLE_MINUTES * 60;

  var payloadCampaigns = [];
  for (var i = 0; i < campaigns.length; i++) {
    var c = campaigns[i];
    payloadCampaigns.push({
      campaignId: c.campaignId,
      nowClicks: c.currentClicks,
      observedAt: now.toISOString(),
      windowStartEpochSeconds: windowStart,
      idempotencyKey: c.campaignId + ':' + windowStart,
      meta: {
        campaignName: c.campaignName,
        country: c.country,
        finalUrl: c.finalUrl,
        cid: c.cid,
        mccId: mccId
      }
    });
  }

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + CONFIG.API_KEY,
      'X-Api-Key': CONFIG.API_KEY
    },
    payload: JSON.stringify({
      campaigns: payloadCampaigns,
      scriptInstanceId: STATE.scriptInstanceId,
      cycleMinutes: CONFIG.CYCLE_MINUTES
    }),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(url, options);
  var code = response.getResponseCode();
  if (code !== 200) {
    Logger.log('Lease batch failed: HTTP ' + code + ' -> ' + response.getContentText());
    return [];
  }

  var data = JSON.parse(response.getContentText());
  return data && data.results ? data.results : [];
}

function callAckBatchApi(acks) {
  var url = CONFIG.API_BASE_URL.replace(/\/$/, '') + '/api/v1/suffix/ack/batch';

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + CONFIG.API_KEY,
      'X-Api-Key': CONFIG.API_KEY
    },
    payload: JSON.stringify({ acks: acks }),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(url, options);
  var code = response.getResponseCode();
  if (code !== 200) {
    Logger.log('Ack batch failed: HTTP ' + code + ' -> ' + response.getContentText());
  }
}

function applySuffixToCampaign(campaign, suffix) {
  var account = STATE.accountsByCid[campaign.cid];
  if (!account) {
    throw new Error('Account not found for CID ' + campaign.cid);
  }

  AdsManagerApp.select(account);

  var campaignIterator = AdsApp.campaigns()
    .withCondition('campaign.id = ' + campaign.campaignId)
    .get();

  if (!campaignIterator.hasNext()) {
    throw new Error('Campaign not found: ' + campaign.campaignId);
  }

  var adsCampaign = campaignIterator.next();
  adsCampaign.urls().setFinalUrlSuffix(suffix);
}

// =====================================================================
// 工具函数
// =====================================================================
function parseCampaignName(campaignName) {
  if (!campaignName) {
    return { networkShortName: '', mid: '', parsed: false };
  }

  var parts = campaignName.split('-');
  if (parts.length < 3) {
    return { networkShortName: '', mid: '', parsed: false };
  }

  var networkPart = parts[1].trim().toUpperCase();
  var networkShortName = networkPart.replace(/[0-9]+$/, '');
  var mid = parts[parts.length - 1].trim();

  var validNetworks = ['RW', 'LH', 'PM', 'LB', 'CG', 'CF', 'BSH'];
  var isValid = validNetworks.indexOf(networkShortName) !== -1 && mid.length > 0;

  return {
    networkShortName: isValid ? networkShortName : '',
    mid: isValid ? mid : '',
    parsed: isValid
  };
}

function generateInstanceId() {
  return 'inst_' + new Date().getTime() + '_' + Math.random().toString(36).substring(2, 8);
}

function formatDateTime(date, timeZone) {
  return Utilities.formatDate(date, timeZone, 'yyyy-MM-dd HH:mm:ss');
}

function formatDuration(seconds) {
  if (seconds < 60) {
    return Math.floor(seconds) + 's';
  }
  if (seconds < 3600) {
    var mins = Math.floor(seconds / 60);
    var secs = Math.floor(seconds % 60);
    return mins + 'm ' + secs + 's';
  }
  var hours = Math.floor(seconds / 3600);
  var rem = Math.floor((seconds % 3600) / 60);
  return hours + 'h ' + rem + 'm';
}

// =====================================================================
// 测试函数（可单独运行）
// =====================================================================
function testParseCampaignName() {
  var testCases = [
    '688-LH1-viagogo-US-1216-38171',
    '346-PM1-blindsdirect-US-1216-87660',
    '082-RW1-katthelabel-AU-0115-122314',
    'invalid-name'
  ];

  Logger.log('Test: parseCampaignName');
  for (var i = 0; i < testCases.length; i++) {
    var result = parseCampaignName(testCases[i]);
    Logger.log('  ' + testCases[i] + ' -> ' + JSON.stringify(result));
  }
}

function testApiConnection() {
  Logger.log('Test: API connection');
  Logger.log('URL: ' + CONFIG.API_BASE_URL);

  try {
    var result = callAffiliateLookupApi([
      { campaignId: 'test', networkShortName: 'LH', mid: 'test123' }
    ]);
    Logger.log('OK: ' + JSON.stringify(result));
  } catch (e) {
    Logger.log('FAILED: ' + e.message);
  }
}
