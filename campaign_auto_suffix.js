// =====================================================================
// Campaign 自动换链脚本（完整版）
// =====================================================================
// 功能：
//   1. 扫描 MCC 下所有有效广告系列，获取联盟链接，写入 Google 表格
//   2. 循环监控点击数，有新增点击时获取链接后缀并写入广告系列
//   3. 自动在接近 30 分钟时停止（Google Ads Script 时间限制）
//
// 使用方法：
//   1. 配置 CONFIG 区域的参数
//   2. 在 Google Ads 脚本编辑器中运行 main()
//   3. 可设置定时任务每小时运行一次
// =====================================================================

// ===== 配置区域 =====
var CONFIG = {
  // ----- Google 表格配置 -----
  SPREADSHEET_URL: 'https://docs.google.com/spreadsheets/d/YOUR_SPREADSHEET_ID/edit',
  SHEET_NAME: 'Campaigns',

  // ----- API 配置 -----
  API_BASE_URL: 'https://your-domain.com',  // 服务器地址
  API_KEY: 'ky_live_your_api_key_here',     // API Key

  // ----- 循环配置 -----
  MAX_LOOPS: 50,              // 最大循环次数
  LOOP_INTERVAL_SECONDS: 30,  // 每次循环间隔（秒）
  CYCLE_MINUTES: 30,          // 换链周期（分钟）

  // ----- 安全配置 -----
  MAX_RUNTIME_SECONDS: 1680,  // 最长运行时间（28分钟，预留2分钟缓冲）

  // ----- 功能开关 -----
  ENABLE_AFFILIATE_LOOKUP: true,   // 是否获取联盟链接
  ENABLE_SUFFIX_APPLY: true,       // 是否写入后缀到广告系列
  ENABLE_SHEET_WRITE: true,        // 是否写入表格
  DRY_RUN: false,                  // 试运行模式（不实际写入）
};

// ===== 表头定义 =====
var COLUMN_HEADERS = [
  'campaignId',       // 广告系列 ID
  'campaignName',     // 广告系列名称
  'country',          // 投放国家
  'finalUrl',         // 最终网址
  'cid',              // 子账号 ID
  'mccId',            // MCC ID
  'networkShortName', // 联盟简称
  'mid',              // 商家 ID
  'trackingUrl',      // 联盟链接
  'hasAffiliate',     // 是否有联盟链接
  'lastClicks',       // 上次点击数
  'currentClicks',    // 当前点击数
  'lastSuffix',       // 上次写入的后缀
  'lastApplyTime',    // 上次写入时间
  'status',           // 状态
  'updatedAt',        // 更新时间
];

// ===== 全局状态 =====
var STATE = {
  startTime: null,
  scriptInstanceId: '',
  campaignDataMap: {},  // campaignId -> campaign data
  loopCount: 0,
};

// =====================================================================
// 主函数
// =====================================================================

function main() {
  STATE.startTime = new Date();
  STATE.scriptInstanceId = generateInstanceId();

  var timeZone = AdsApp.currentAccount().getTimeZone();
  var mccId = AdsApp.currentAccount().getCustomerId();

  Logger.log('🚀 Campaign 自动换链脚本启动');
  Logger.log('⏰ 启动时间: ' + formatDateTime(STATE.startTime, timeZone));
  Logger.log('🆔 实例 ID: ' + STATE.scriptInstanceId);
  Logger.log('📋 MCC ID: ' + mccId);
  Logger.log('');

  // ===== 阶段 1: 初始扫描 =====
  Logger.log('===== 阶段 1: 扫描广告系列 =====');
  var campaigns = scanAllCampaigns(mccId);
  Logger.log('📝 共发现 ' + campaigns.length + ' 个有效广告系列');

  if (campaigns.length === 0) {
    Logger.log('⚠️ 没有找到有效广告系列，脚本结束');
    return;
  }

  // ===== 阶段 2: 获取联盟链接 =====
  if (CONFIG.ENABLE_AFFILIATE_LOOKUP) {
    Logger.log('');
    Logger.log('===== 阶段 2: 获取联盟链接 =====');
    campaigns = fetchAffiliateLinks(campaigns);

    var withAffiliate = campaigns.filter(function(c) { return c.hasAffiliate; }).length;
    Logger.log('📊 有联盟链接: ' + withAffiliate + '/' + campaigns.length);
  }

  // ===== 阶段 3: 写入表格 =====
  if (CONFIG.ENABLE_SHEET_WRITE) {
    Logger.log('');
    Logger.log('===== 阶段 3: 写入表格 =====');
    writeToSheet(campaigns);
  }

  // ===== 阶段 4: 循环监控点击数 =====
  if (CONFIG.ENABLE_SUFFIX_APPLY) {
    Logger.log('');
    Logger.log('===== 阶段 4: 开始循环监控 =====');
    Logger.log('⚙️ 配置: 最大循环 ' + CONFIG.MAX_LOOPS + ' 次，间隔 ' + CONFIG.LOOP_INTERVAL_SECONDS + ' 秒');

    // 初始化点击数
    for (var i = 0; i < campaigns.length; i++) {
      var c = campaigns[i];
      STATE.campaignDataMap[c.campaignId] = c;
      c.lastClicks = c.todayClicks || 0;
      c.currentClicks = c.todayClicks || 0;
    }

    // 开始循环
    runMonitoringLoop(campaigns, mccId);
  }

  // ===== 结束报告 =====
  var endTime = new Date();
  var totalSeconds = (endTime - STATE.startTime) / 1000;

  Logger.log('');
  Logger.log('===== 📈 运行报告 =====');
  Logger.log('⏰ 结束时间: ' + formatDateTime(endTime, timeZone));
  Logger.log('⏱️ 总运行时长: ' + formatDuration(totalSeconds));
  Logger.log('🔄 完成循环: ' + STATE.loopCount + ' 次');
  Logger.log('✅ 脚本正常结束');
}

// =====================================================================
// 阶段 1: 扫描广告系列
// =====================================================================

function scanAllCampaigns(mccId) {
  var allCampaigns = [];
  var accounts = [];

  // 收集所有子账户
  var accountIterator = AdsManagerApp.accounts().get();
  while (accountIterator.hasNext()) {
    accounts.push(accountIterator.next());
  }

  Logger.log('📊 发现 ' + accounts.length + ' 个子账户');

  // 遍历每个账户
  for (var i = 0; i < accounts.length; i++) {
    var account = accounts[i];
    AdsManagerApp.select(account);

    var cid = AdsApp.currentAccount().getCustomerId();
    var accountName = AdsApp.currentAccount().getName();

    try {
      var campaigns = getCampaignData(cid, mccId);
      if (campaigns.length > 0) {
        Logger.log('  ✅ ' + accountName + ' (' + cid + '): ' + campaigns.length + ' 个广告系列');
        allCampaigns = allCampaigns.concat(campaigns);
      }
    } catch (e) {
      Logger.log('  ❌ ' + accountName + ' (' + cid + '): ' + e.message);
    }
  }

  return allCampaigns;
}

function getCampaignData(cid, mccId) {
  var campaigns = [];
  var now = new Date().toISOString();

  // 查询有效广告系列
  var campaignMap = {};
  var query =
    "SELECT campaign.id, campaign.name " +
    "FROM campaign " +
    "WHERE campaign.status = 'ENABLED'";

  var report = AdsApp.report(query);
  var rows = report.rows();

  while (rows.hasNext()) {
    var row = rows.next();
    var campaignId = row['campaign.id'];
    var campaignName = row['campaign.name'];

    // 解析广告系列名称
    var parsed = parseCampaignName(campaignName);

    campaignMap[campaignId] = {
      campaignId: campaignId,
      campaignName: campaignName,
      country: '',
      finalUrl: '',
      cid: cid,
      mccId: mccId,
      networkShortName: parsed.networkShortName,
      mid: parsed.mid,
      trackingUrl: '',
      hasAffiliate: false,
      todayClicks: 0,
      lastClicks: 0,
      currentClicks: 0,
      lastSuffix: '',
      lastApplyTime: '',
      status: parsed.parsed ? 'ready' : 'no_affiliate_info',
      updatedAt: now,
    };
  }

  // 获取今日点击数
  try {
    var clicksQuery =
      "SELECT campaign.id, metrics.clicks " +
      "FROM campaign " +
      "WHERE campaign.status = 'ENABLED' " +
        "AND segments.date DURING TODAY";

    var clicksReport = AdsApp.report(clicksQuery);
    var clicksRows = clicksReport.rows();

    while (clicksRows.hasNext()) {
      var clicksRow = clicksRows.next();
      var id = clicksRow['campaign.id'];
      var clicks = parseInt(clicksRow['metrics.clicks']) || 0;

      if (campaignMap[id]) {
        campaignMap[id].todayClicks = clicks;
      }
    }
  } catch (e) {
    Logger.log('    ⚠️ 获取点击数失败: ' + e.message);
  }

  // 获取地理位置定向
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
      var geoRow = geoRows.next();
      var geoId = geoRow['campaign.id'];
      var geoConstant = geoRow['campaign_criterion.location.geo_target_constant'];

      if (!geoMap[geoId]) geoMap[geoId] = [];
      if (geoConstant && geoMap[geoId].indexOf(geoConstant) === -1) {
        geoMap[geoId].push(geoConstant);
      }
    }

    for (var id in geoMap) {
      if (campaignMap[id]) {
        campaignMap[id].country = geoMap[id].join('; ');
      }
    }
  } catch (e) {
    // 忽略
  }

  // 获取最终网址
  try {
    var adQuery =
      "SELECT campaign.id, ad_group_ad.ad.final_urls " +
      "FROM ad_group_ad";

    var adReport = AdsApp.report(adQuery);
    var adRows = adReport.rows();
    var urlMap = {};

    while (adRows.hasNext()) {
      var adRow = adRows.next();
      var adId = adRow['campaign.id'];
      var finalUrls = adRow['ad_group_ad.ad.final_urls'];

      if (!urlMap[adId] && finalUrls && finalUrls.length > 0) {
        urlMap[adId] = finalUrls[0];
      }
    }

    for (var id in urlMap) {
      if (campaignMap[id]) {
        campaignMap[id].finalUrl = urlMap[id];
      }
    }
  } catch (e) {
    // 忽略
  }

  // 转换为数组
  for (var id in campaignMap) {
    campaigns.push(campaignMap[id]);
  }

  return campaigns;
}

// =====================================================================
// 阶段 2: 获取联盟链接
// =====================================================================

function fetchAffiliateLinks(campaigns) {
  if (!CONFIG.API_BASE_URL || !CONFIG.API_KEY) {
    Logger.log('  ⚠️ API 配置不完整，跳过联盟链接获取');
    return campaigns;
  }

  // 筛选出有联盟信息的广告系列
  var campaignsToQuery = [];
  for (var i = 0; i < campaigns.length; i++) {
    var c = campaigns[i];
    if (c.networkShortName && c.mid) {
      campaignsToQuery.push({
        campaignId: c.campaignId,
        networkShortName: c.networkShortName,
        mid: c.mid,
        finalUrl: c.finalUrl,
      });
    }
  }

  if (campaignsToQuery.length === 0) {
    Logger.log('  ⚠️ 没有可查询的广告系列');
    return campaigns;
  }

  Logger.log('  📊 查询联盟链接: ' + campaignsToQuery.length + ' 个');

  // 分批查询
  var batchSize = CONFIG.BATCH_SIZE || 100;
  var campaignMap = {};
  for (var j = 0; j < campaigns.length; j++) {
    campaignMap[campaigns[j].campaignId] = campaigns[j];
  }

  var totalBatches = Math.ceil(campaignsToQuery.length / batchSize);

  for (var batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    var start = batchIndex * batchSize;
    var end = Math.min(start + batchSize, campaignsToQuery.length);
    var batch = campaignsToQuery.slice(start, end);

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
      Logger.log('  ❌ 批次查询失败: ' + e.message);
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
      'X-Api-Key': CONFIG.API_KEY,
    },
    payload: JSON.stringify({ campaigns: campaignsBatch }),
    muteHttpExceptions: true,
  };

  var response = UrlFetchApp.fetch(url, options);
  var responseCode = response.getResponseCode();

  if (responseCode === 200) {
    return JSON.parse(response.getContentText());
  } else {
    throw new Error('HTTP ' + responseCode);
  }
}

// =====================================================================
// 阶段 3: 写入表格
// =====================================================================

function writeToSheet(campaigns) {
  if (CONFIG.DRY_RUN) {
    Logger.log('  [DRY_RUN] 跳过表格写入');
    return;
  }

  try {
    var spreadsheet = SpreadsheetApp.openByUrl(CONFIG.SPREADSHEET_URL);
    var sheet = spreadsheet.getSheetByName(CONFIG.SHEET_NAME);

    if (!sheet) {
      sheet = spreadsheet.insertSheet(CONFIG.SHEET_NAME);
    }

    // 清空并写入表头
    sheet.clear();
    sheet.getRange(1, 1, 1, COLUMN_HEADERS.length).setValues([COLUMN_HEADERS]);

    // 设置表头样式
    var headerRange = sheet.getRange(1, 1, 1, COLUMN_HEADERS.length);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#4285f4');
    headerRange.setFontColor('#ffffff');

    // 写入数据
    if (campaigns.length > 0) {
      var dataRows = campaigns.map(function(c) {
        return [
          c.campaignId,
          c.campaignName,
          c.country,
          c.finalUrl,
          c.cid,
          c.mccId,
          c.networkShortName || '',
          c.mid || '',
          c.trackingUrl || '',
          c.hasAffiliate ? 'YES' : 'NO',
          c.lastClicks || 0,
          c.currentClicks || 0,
          c.lastSuffix || '',
          c.lastApplyTime || '',
          c.status || '',
          c.updatedAt || '',
        ];
      });

      sheet.getRange(2, 1, dataRows.length, COLUMN_HEADERS.length).setValues(dataRows);
      Logger.log('  ✅ 写入 ' + dataRows.length + ' 条记录');
    }

    sheet.setFrozenRows(1);

  } catch (e) {
    Logger.log('  ❌ 写入表格失败: ' + e.message);
  }
}

// =====================================================================
// 阶段 4: 循环监控
// =====================================================================

function runMonitoringLoop(campaigns, mccId) {
  var loopCount = 0;

  while (loopCount < CONFIG.MAX_LOOPS) {
    // 检查是否接近时间限制
    var elapsed = (new Date() - STATE.startTime) / 1000;
    if (elapsed >= CONFIG.MAX_RUNTIME_SECONDS) {
      Logger.log('');
      Logger.log('⏰ 接近运行时间限制 (' + Math.floor(elapsed) + 's)，停止循环');
      break;
    }

    loopCount++;
    STATE.loopCount = loopCount;

    Logger.log('');
    Logger.log('🔄 循环 #' + loopCount + ' (已运行 ' + Math.floor(elapsed) + 's)');

    // 等待指定间隔
    if (loopCount > 1) {
      Logger.log('  ⏳ 等待 ' + CONFIG.LOOP_INTERVAL_SECONDS + ' 秒...');
      Utilities.sleep(CONFIG.LOOP_INTERVAL_SECONDS * 1000);
    }

    // 获取最新点击数
    var clickUpdates = refreshClickCounts(campaigns, mccId);

    // 处理点击增长的广告系列
    var campaignsWithGrowth = [];
    for (var i = 0; i < campaigns.length; i++) {
      var c = campaigns[i];
      if (c.currentClicks > c.lastClicks && c.hasAffiliate) {
        campaignsWithGrowth.push(c);
      }
    }

    if (campaignsWithGrowth.length > 0) {
      Logger.log('  📈 发现 ' + campaignsWithGrowth.length + ' 个广告系列点击增长');

      // 获取后缀并应用
      for (var j = 0; j < campaignsWithGrowth.length; j++) {
        var campaign = campaignsWithGrowth[j];
        processCampaignSuffix(campaign, mccId);
      }
    } else {
      Logger.log('  ➖ 没有点击增长');
    }

    // 更新 lastClicks
    for (var k = 0; k < campaigns.length; k++) {
      campaigns[k].lastClicks = campaigns[k].currentClicks;
    }
  }

  Logger.log('');
  Logger.log('🏁 循环结束，共完成 ' + loopCount + ' 次');
}

function refreshClickCounts(campaigns, mccId) {
  var updates = {};
  var accounts = [];

  // 收集账户
  var accountIterator = AdsManagerApp.accounts().get();
  while (accountIterator.hasNext()) {
    accounts.push(accountIterator.next());
  }

  // 按账户分组的 campaignId
  var campaignsByCid = {};
  for (var i = 0; i < campaigns.length; i++) {
    var c = campaigns[i];
    if (!campaignsByCid[c.cid]) {
      campaignsByCid[c.cid] = [];
    }
    campaignsByCid[c.cid].push(c.campaignId);
  }

  // 查询每个账户
  for (var j = 0; j < accounts.length; j++) {
    var account = accounts[j];
    AdsManagerApp.select(account);
    var cid = AdsApp.currentAccount().getCustomerId();

    if (!campaignsByCid[cid]) continue;

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
        var clicks = parseInt(row['metrics.clicks']) || 0;

        // 更新全局状态
        if (STATE.campaignDataMap[campaignId]) {
          var oldClicks = STATE.campaignDataMap[campaignId].currentClicks;
          STATE.campaignDataMap[campaignId].currentClicks = clicks;

          if (clicks > oldClicks) {
            updates[campaignId] = { from: oldClicks, to: clicks };
          }
        }
      }
    } catch (e) {
      // 忽略错误
    }
  }

  return updates;
}

function processCampaignSuffix(campaign, mccId) {
  var now = new Date();
  var windowStart = Math.floor(now.getTime() / 1000 / 60 / CONFIG.CYCLE_MINUTES) * CONFIG.CYCLE_MINUTES * 60;
  var idempotencyKey = campaign.campaignId + ':' + windowStart;

  Logger.log('    📝 ' + campaign.campaignName.substring(0, 30) + '...');
  Logger.log('       点击: ' + campaign.lastClicks + ' → ' + campaign.currentClicks + ' (+' + (campaign.currentClicks - campaign.lastClicks) + ')');

  try {
    // 调用 lease API
    var leaseResult = callLeaseApi({
      campaignId: campaign.campaignId,
      nowClicks: campaign.currentClicks,
      observedAt: now.toISOString(),
      scriptInstanceId: STATE.scriptInstanceId,
      cycleMinutes: CONFIG.CYCLE_MINUTES,
      windowStartEpochSeconds: windowStart,
      idempotencyKey: idempotencyKey,
      meta: {
        campaignName: campaign.campaignName,
        country: campaign.country,
        finalUrl: campaign.finalUrl,
        cid: campaign.cid,
        mccId: mccId,
      },
    });

    if (leaseResult && leaseResult.action === 'APPLY') {
      var suffix = leaseResult.finalUrlSuffix;
      Logger.log('       ✅ 获取后缀: ' + suffix.substring(0, 50) + '...');

      // 应用后缀
      if (!CONFIG.DRY_RUN) {
        applySuffixToCampaign(campaign, suffix);
        campaign.lastSuffix = suffix;
        campaign.lastApplyTime = now.toISOString();
        campaign.status = 'applied';

        // 发送 ACK
        sendAck(leaseResult.leaseId, campaign.campaignId, true, now.toISOString());
      } else {
        Logger.log('       [DRY_RUN] 跳过后缀应用');
      }
    } else if (leaseResult && leaseResult.action === 'NOOP') {
      Logger.log('       ➖ NOOP: ' + (leaseResult.reason || '无需换链'));
    } else {
      Logger.log('       ⚠️ ' + (leaseResult.code || 'UNKNOWN') + ': ' + (leaseResult.message || ''));
    }

  } catch (e) {
    Logger.log('       ❌ 错误: ' + e.message);
    campaign.status = 'error';
  }
}

function callLeaseApi(data) {
  var url = CONFIG.API_BASE_URL.replace(/\/$/, '') + '/api/v1/suffix/lease';

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + CONFIG.API_KEY,
      'X-Api-Key': CONFIG.API_KEY,
    },
    payload: JSON.stringify(data),
    muteHttpExceptions: true,
  };

  var response = UrlFetchApp.fetch(url, options);
  var responseCode = response.getResponseCode();

  if (responseCode === 200) {
    return JSON.parse(response.getContentText());
  } else {
    var errorBody = response.getContentText();
    throw new Error('HTTP ' + responseCode + ': ' + errorBody.substring(0, 100));
  }
}

function sendAck(leaseId, campaignId, applied, appliedAt) {
  try {
    var url = CONFIG.API_BASE_URL.replace(/\/$/, '') + '/api/v1/suffix/ack';

    var options = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'Authorization': 'Bearer ' + CONFIG.API_KEY,
        'X-Api-Key': CONFIG.API_KEY,
      },
      payload: JSON.stringify({
        leaseId: leaseId,
        campaignId: campaignId,
        applied: applied,
        appliedAt: appliedAt,
      }),
      muteHttpExceptions: true,
    };

    UrlFetchApp.fetch(url, options);
  } catch (e) {
    // 忽略 ACK 错误
  }
}

function applySuffixToCampaign(campaign, suffix) {
  // 切换到对应账户
  var accounts = [];
  var accountIterator = AdsManagerApp.accounts().get();
  while (accountIterator.hasNext()) {
    var account = accountIterator.next();
    if (account.getCustomerId() === campaign.cid) {
      AdsManagerApp.select(account);
      break;
    }
  }

  // 获取广告系列并设置后缀
  var campaignIterator = AdsApp.campaigns()
    .withCondition('campaign.id = ' + campaign.campaignId)
    .get();

  if (campaignIterator.hasNext()) {
    var adsCampaign = campaignIterator.next();
    adsCampaign.urls().setFinalUrlSuffix(suffix);
    Logger.log('       ✅ 后缀已写入广告系列');
  } else {
    Logger.log('       ⚠️ 未找到广告系列');
  }
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
    parsed: isValid,
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
    return seconds.toFixed(0) + ' 秒';
  } else if (seconds < 3600) {
    var mins = Math.floor(seconds / 60);
    var secs = Math.floor(seconds % 60);
    return mins + ' 分 ' + secs + ' 秒';
  } else {
    var hours = Math.floor(seconds / 3600);
    var mins = Math.floor((seconds % 3600) / 60);
    return hours + ' 小时 ' + mins + ' 分';
  }
}

// =====================================================================
// 测试函数（可单独运行）
// =====================================================================

function testParseCampaignName() {
  var testCases = [
    '688-LH1-viagogo-US-1216-38171',
    '346-PM1-blindsdirect-US-1216-87660',
    '082-RW1-katthelabel-AU-0115-122314',
    'invalid-name',
  ];

  Logger.log('测试广告系列名称解析:');
  for (var i = 0; i < testCases.length; i++) {
    var result = parseCampaignName(testCases[i]);
    Logger.log('  ' + testCases[i] + ' -> ' + JSON.stringify(result));
  }
}

function testApiConnection() {
  Logger.log('测试 API 连接...');
  Logger.log('URL: ' + CONFIG.API_BASE_URL);

  try {
    var result = callAffiliateLookupApi([
      { campaignId: 'test', networkShortName: 'LH', mid: 'test123' }
    ]);
    Logger.log('✅ 连接成功: ' + JSON.stringify(result));
  } catch (e) {
    Logger.log('❌ 连接失败: ' + e.message);
  }
}
