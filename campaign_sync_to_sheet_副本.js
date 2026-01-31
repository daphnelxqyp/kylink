// ===== Campaign 元数据同步脚本（串行优化版 + 联盟链接集成）=====
// 功能：扫描 MCC 下所有有效 CID 的有效广告系列，提取元数据，获取联盟链接，写入 Google 表格
// 优化：跳过无 Campaign 账户的后续查询，减少不必要的 API 调用
// 字段：campaignId, campaignName, country, finalUrl, todayClicks, cid, mccId, trackingUrl, networkShortName, updatedAt
//
// 注意：经测试，对于 <50 个账户的场景，串行比 executeInParallel 更快
// 因为 executeInParallel 有约 60-100 秒的调度开销

// ===== 配置区域 =====
var CONFIG = {
  // Google 表格 URL（请替换为你的表格地址）
  SPREADSHEET_URL: 'https://docs.google.com/spreadsheets/d/1e5YqWRjs8SRXaUacMzNROe4ClOg31VxIgivBpemzJ0o/edit?gid=0#gid=0',
  // 工作表名称
  SHEET_NAME: '工作表1',
  // 是否清空表格后再写入（true=全量刷新，false=追加）
  CLEAR_BEFORE_WRITE: true,

  // ===== 联盟链接 API 配置 =====
  // 服务端 API 地址（请替换为你的服务器地址）
  API_BASE_URL: 'https://your-domain.com',
  // API Key（用于鉴权，格式：ky_live_xxxxx）
  API_KEY: 'ky_live_your_api_key_here',
  // 是否启用联盟链接查询（设为 false 可跳过 API 调用）
  ENABLE_AFFILIATE_LOOKUP: true,
  // API 请求超时时间（毫秒）
  API_TIMEOUT_MS: 30000,
  // 批量查询大小（每次 API 请求的最大 campaign 数量）
  BATCH_SIZE: 100
};

// ===== 广告系列名称格式说明 =====
// 格式：序号-联盟简称+编号-商家名-国家-日期-mid
// 例如：688-LH1-viagogo-US-1216-38171
//   - 第2个部分（索引1）= 联盟简称+编号 (LH1 -> 提取 LH)
//   - 最后一个部分 = mid (38171)
// 支持的联盟简称：RW, LH, PM, LB, CG, CF, BSH

// ===== 表头定义（新增联盟链接列）=====
var COLUMN_HEADERS = [
  'campaignId',
  'campaignName',
  'country',
  'finalUrl',
  'todayClicks',      // 今日点击数
  'cid',
  'mccId',
  'trackingUrl',      // 联盟追踪链接
  'networkShortName', // 联盟简称
  'updatedAt'
];

/**
 * 主函数入口
 */
function main() {
  var startTime = new Date();
  var timeZone = AdsApp.currentAccount().getTimeZone();
  
  Logger.log('🚀 开始扫描 Campaign 元数据（串行优化版）...');
  Logger.log('⏰ 启动时间: ' + Utilities.formatDate(startTime, timeZone, 'yyyy-MM-dd HH:mm:ss'));
  
  // 获取 MCC ID
  var mccId = AdsApp.currentAccount().getCustomerId();
  Logger.log('📋 当前 MCC ID: ' + mccId);
  
  // 收集所有 Campaign 数据
  var allCampaigns = [];
  var errorAccounts = [];
  
  // 收集所有账户到数组
  var accounts = [];
  var accountIterator = AdsManagerApp.accounts().get();
  while (accountIterator.hasNext()) {
    accounts.push(accountIterator.next());
  }
  var totalAccounts = accounts.length;
  
  Logger.log('📊 发现 ' + totalAccounts + ' 个子账户');
  
  // ===== 阶段1：扫描账户数据 =====
  var scanStartTime = new Date();
  var skippedAccounts = 0;  // 跳过的空账户数
  
  for (var i = 0; i < accounts.length; i++) {
    var account = accounts[i];
    AdsManagerApp.select(account);
    
    var cid = AdsApp.currentAccount().getCustomerId();
    var accountName = AdsApp.currentAccount().getName();
    var accountStartTime = new Date();
    
    try {
      // 获取该账户下的所有有效 Campaign 数据
      var result = getCampaignDataOptimized(cid, mccId);
      var accountDuration = (new Date() - accountStartTime) / 1000;
      
      if (result.skipped) {
        // 无有效 Campaign，跳过后续查询
        skippedAccounts++;
        Logger.log('[' + (i + 1) + '/' + totalAccounts + '] ⏭️ ' + accountName + ' (' + cid + '): 无有效广告系列，跳过 (' + accountDuration.toFixed(2) + '秒)');
      } else {
        // 有有效 Campaign
        Logger.log('[' + (i + 1) + '/' + totalAccounts + '] ✅ ' + accountName + ' (' + cid + '): ' + 
                  result.campaigns.length + ' 个广告系列 (' + accountDuration.toFixed(2) + '秒)');
        allCampaigns = allCampaigns.concat(result.campaigns);
      }
    } catch (e) {
      errorAccounts.push({ cid: cid, name: accountName, error: e.message });
      Logger.log('[' + (i + 1) + '/' + totalAccounts + '] ❌ ' + accountName + ' (' + cid + '): ' + e.message);
    }
  }
  
  var scanEndTime = new Date();
  var scanDuration = (scanEndTime - scanStartTime) / 1000;
  
  Logger.log('');
  Logger.log('📝 总计收集 ' + allCampaigns.length + ' 个广告系列');

  // ===== 阶段2：获取联盟链接 =====
  var affiliateStartTime = new Date();
  if (CONFIG.ENABLE_AFFILIATE_LOOKUP && allCampaigns.length > 0) {
    Logger.log('');
    Logger.log('🔗 开始获取联盟链接...');
    allCampaigns = fetchAffiliateLinks(allCampaigns);
    var affiliateEndTime = new Date();
    var affiliateDuration = (affiliateEndTime - affiliateStartTime) / 1000;
    Logger.log('✅ 联盟链接获取完成，耗时: ' + affiliateDuration.toFixed(2) + ' 秒');
  } else {
    Logger.log('⏭️ 跳过联盟链接获取（未启用或无数据）');
  }

  // ===== 阶段3：写入表格 =====
  var writeStartTime = new Date();
  writeToSheet(allCampaigns);
  var writeEndTime = new Date();
  var writeDuration = (writeEndTime - writeStartTime) / 1000;
  
  // ===== 性能统计报告 =====
  var endTime = new Date();
  var totalDuration = (endTime - startTime) / 1000;
  
  Logger.log('');
  Logger.log('===== 📈 性能统计报告 =====');
  Logger.log('⏰ 启动时间: ' + Utilities.formatDate(startTime, timeZone, 'yyyy-MM-dd HH:mm:ss'));
  Logger.log('⏰ 结束时间: ' + Utilities.formatDate(endTime, timeZone, 'yyyy-MM-dd HH:mm:ss'));
  Logger.log('─────────────────────────────');
  Logger.log('📊 扫描阶段耗时: ' + scanDuration.toFixed(2) + ' 秒');
  if (CONFIG.ENABLE_AFFILIATE_LOOKUP) {
    Logger.log('🔗 联盟链接获取耗时: ' + ((affiliateEndTime - affiliateStartTime) / 1000).toFixed(2) + ' 秒');
  }
  Logger.log('📤 写入表格耗时: ' + writeDuration.toFixed(2) + ' 秒');
  Logger.log('─────────────────────────────');
  Logger.log('⏱️ 总运行时长: ' + formatDuration(totalDuration));
  Logger.log('📋 处理账户数: ' + totalAccounts + ' 个');
  Logger.log('⏭️ 跳过空账户: ' + skippedAccounts + ' 个');
  Logger.log('📝 处理广告系列: ' + allCampaigns.length + ' 个');
  
  if (totalDuration > 0 && allCampaigns.length > 0) {
    Logger.log('⚡ 平均处理速度: ' + (allCampaigns.length / totalDuration).toFixed(1) + ' 个/秒');
  }
  
  if (errorAccounts.length > 0) {
    Logger.log('─────────────────────────────');
    Logger.log('⚠️ 失败账户数: ' + errorAccounts.length + ' 个');
    for (var j = 0; j < errorAccounts.length; j++) {
      var err = errorAccounts[j];
      Logger.log('  - ' + err.name + ' (' + err.cid + '): ' + err.error);
    }
  }
  
  Logger.log('=============================');
  Logger.log('✅ 同步完成！');
}

/**
 * 格式化时长为可读字符串
 */
function formatDuration(seconds) {
  if (seconds < 60) {
    return seconds.toFixed(2) + ' 秒';
  } else if (seconds < 3600) {
    var minutes = Math.floor(seconds / 60);
    var remainingSeconds = seconds % 60;
    return minutes + ' 分 ' + remainingSeconds.toFixed(0) + ' 秒';
  } else {
    var hours = Math.floor(seconds / 3600);
    var mins = Math.floor((seconds % 3600) / 60);
    var secs = seconds % 60;
    return hours + ' 小时 ' + mins + ' 分 ' + secs.toFixed(0) + ' 秒';
  }
}

/**
 * 获取单个账户下的 Campaign 数据（优化版：跳过空账户的后续查询）
 * @param {string} cid - 子账户 ID
 * @param {string} mccId - MCC ID
 * @returns {Object} { skipped: boolean, campaigns: Array }
 */
function getCampaignDataOptimized(cid, mccId) {
  var campaigns = [];
  var now = new Date().toISOString();
  
  // 1. 获取所有有效 Campaign 的基本信息（不带日期过滤，确保不遗漏）
  var campaignMap = {};
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
    
    campaignMap[campaignId] = {
      campaignId: campaignId,
      campaignName: campaignName,
      country: '',
      finalUrl: '',
      todayClicks: 0,  // 默认为 0，后续查询更新
      cid: cid,
      mccId: mccId,
      updatedAt: now
    };
  }
  
  // 1.1 单独获取今日点击数（避免因无数据而遗漏 Campaign）
  var clicksQuery = 
    "SELECT campaign.id, metrics.clicks " +
    "FROM campaign " +
    "WHERE campaign.status = 'ENABLED' " +
      "AND segments.date DURING TODAY";
  
  try {
    var clicksReport = AdsApp.report(clicksQuery);
    var clicksRows = clicksReport.rows();
    
    while (clicksRows.hasNext()) {
      var clicksRow = clicksRows.next();
      var clicksCampaignId = clicksRow['campaign.id'];
      var todayClicks = clicksRow['metrics.clicks'] || 0;
      
      if (campaignMap[clicksCampaignId]) {
        campaignMap[clicksCampaignId].todayClicks = todayClicks;
      }
    }
  } catch (clicksError) {
    Logger.log('  ⚠️ [' + cid + '] 获取今日点击数失败: ' + clicksError.message);
  }
  
  var campaignCount = Object.keys(campaignMap).length;
  
  // 🚀 关键优化：如果没有有效 Campaign，直接返回（跳过 geo 和 ad 查询）
  if (campaignCount === 0) {
    return { skipped: true, campaigns: [] };
  }
  
  // 2. 获取目标投放国家（地理位置定向）
  var geoQuery = 
    "SELECT campaign.id, campaign_criterion.location.geo_target_constant " +
    "FROM campaign_criterion " +
    "WHERE campaign.status = 'ENABLED' " +
      "AND campaign_criterion.type = LOCATION " +
      "AND campaign_criterion.negative = false";
  
  try {
    var geoReport = AdsApp.report(geoQuery);
    var geoRows = geoReport.rows();
    var campaignGeoMap = {};
    
    while (geoRows.hasNext()) {
      var geoRow = geoRows.next();
      var geoCampaignId = geoRow['campaign.id'];
      var geoConstant = geoRow['campaign_criterion.location.geo_target_constant'];
      
      if (!campaignGeoMap[geoCampaignId]) {
        campaignGeoMap[geoCampaignId] = [];
      }
      
      if (geoConstant && campaignGeoMap[geoCampaignId].indexOf(geoConstant) === -1) {
        campaignGeoMap[geoCampaignId].push(geoConstant);
      }
    }
    
    // 合并地理位置信息
    for (var geoId in campaignGeoMap) {
      if (campaignMap[geoId]) {
        campaignMap[geoId].country = campaignGeoMap[geoId].join('; ');
      }
    }
  } catch (geoError) {
    Logger.log('  ⚠️ [' + cid + '] 获取地理位置失败: ' + geoError.message);
  }
  
  // 3. 获取最终到达网址
  var adQuery = 
    "SELECT campaign.id, ad_group_ad.ad.final_urls " +
    "FROM ad_group_ad";
  
  try {
    var adReport = AdsApp.report(adQuery);
    var adRows = adReport.rows();
    var campaignUrlMap = {};
    
    while (adRows.hasNext()) {
      var adRow = adRows.next();
      var adCampaignId = adRow['campaign.id'];
      var finalUrls = adRow['ad_group_ad.ad.final_urls'];
      
      if (!campaignUrlMap[adCampaignId] && finalUrls && finalUrls.length > 0) {
        campaignUrlMap[adCampaignId] = finalUrls[0];
      }
    }
    
    // 合并 finalUrl
    for (var urlId in campaignUrlMap) {
      if (campaignMap[urlId]) {
        campaignMap[urlId].finalUrl = campaignUrlMap[urlId];
      }
    }
  } catch (urlError) {
    Logger.log('  ⚠️ [' + cid + '] 获取 finalUrl 失败: ' + urlError.message);
  }
  
  // 4. 转换为数组
  for (var id in campaignMap) {
    campaigns.push(campaignMap[id]);
  }
  
  return { skipped: false, campaigns: campaigns };
}

/**
 * 写入 Google 表格
 * @param {Array} campaigns - Campaign 数据数组
 */
function writeToSheet(campaigns) {
  Logger.log('📤 正在写入 Google 表格...');
  
  try {
    var spreadsheet = SpreadsheetApp.openByUrl(CONFIG.SPREADSHEET_URL);
    var sheet = spreadsheet.getSheetByName(CONFIG.SHEET_NAME);
    
    // 如果工作表不存在，创建它
    if (!sheet) {
      sheet = spreadsheet.insertSheet(CONFIG.SHEET_NAME);
      Logger.log('  📄 创建新工作表: ' + CONFIG.SHEET_NAME);
    }
    
    // 是否清空表格
    if (CONFIG.CLEAR_BEFORE_WRITE) {
      sheet.clear();
      Logger.log('  🧹 已清空表格');
    }
    
    // 写入表头
    sheet.getRange(1, 1, 1, COLUMN_HEADERS.length).setValues([COLUMN_HEADERS]);
    
    // 设置表头样式
    var headerRange = sheet.getRange(1, 1, 1, COLUMN_HEADERS.length);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#4285f4');
    headerRange.setFontColor('#ffffff');
    
    // 按广告系列名称前3位数字从大到小排序
    campaigns.sort(function(a, b) {
      var numA = parseInt((a.campaignName || '').substring(0, 3), 10) || 0;
      var numB = parseInt((b.campaignName || '').substring(0, 3), 10) || 0;
      return numB - numA;  // 降序排列
    });
    Logger.log('  📊 已按广告系列名称前3位数字降序排序');
    
    // 转换数据为二维数组并写入（带空值安全处理）
    if (campaigns.length > 0) {
      var dataRows = [];
      for (var i = 0; i < campaigns.length; i++) {
        var c = campaigns[i];
        dataRows.push([
          c.campaignId || '',
          c.campaignName || '',
          c.country || '',
          c.finalUrl || '',
          c.todayClicks || 0,           // 今日点击数
          c.cid || '',
          c.mccId || '',
          c.trackingUrl || '',          // 联盟追踪链接
          c.networkShortName || '',     // 联盟简称
          c.updatedAt || ''
        ]);
      }
      
      // 批量写入数据
      sheet.getRange(2, 1, dataRows.length, COLUMN_HEADERS.length).setValues(dataRows);
      Logger.log('  ✅ 成功写入 ' + dataRows.length + ' 条记录');
    } else {
      Logger.log('  ⚠️ 没有数据需要写入');
    }
    
    // 设置列宽（新增联盟链接列）
    var columnWidths = [120, 250, 200, 350, 100, 120, 120, 400, 80, 180];
    for (var j = 0; j < columnWidths.length; j++) {
      sheet.setColumnWidth(j + 1, columnWidths[j]);
    }
    
    // 冻结表头行（方便滚动查看）
    sheet.setFrozenRows(1);
    
  } catch (e) {
    Logger.log('❌ 写入表格失败: ' + e.message);
    throw e;
  }
}

// ============================================
// 联盟链接查询功能
// ============================================

/**
 * 从 URL 中提取域名
 * @param {string} url - 完整 URL
 * @returns {string} - 提取的域名（不含 www.）
 */
function extractDomain(url) {
  if (!url) return '';
  try {
    // 使用正则提取域名
    var match = url.match(/(?:https?:\/\/)?(?:www\.)?([^\/\?#]+)/i);
    return match ? match[1].toLowerCase() : '';
  } catch (e) {
    return '';
  }
}

/**
 * 从广告系列名称解析联盟信息
 * 格式：序号-联盟简称+编号-商家名-国家-日期-mid
 * 例如：688-LH1-viagogo-US-1216-38171
 *   - 第2个部分（索引1）= 联盟简称+编号 (LH1 -> 提取 LH)
 *   - 最后一个部分 = mid (38171)
 *
 * @param {string} campaignName - 广告系列名称
 * @returns {Object} - { networkShortName: string, mid: string, parsed: boolean }
 */
function parseCampaignName(campaignName) {
  if (!campaignName) {
    return { networkShortName: '', mid: '', parsed: false };
  }

  var parts = campaignName.split('-');

  // 至少需要3个部分才能提取联盟简称和 mid
  if (parts.length < 3) {
    return { networkShortName: '', mid: '', parsed: false };
  }

  // 从第2个部分提取联盟简称（去除数字后缀）
  // 例如：LH1 -> LH, PM1 -> PM, RW1 -> RW
  var networkPart = parts[1].trim().toUpperCase();
  var networkShortName = networkPart.replace(/[0-9]+$/, '');  // 移除末尾数字

  var mid = parts[parts.length - 1].trim();  // 最后一个部分

  // 验证联盟简称是否有效（已知的联盟简称列表）
  var validNetworks = ['RW', 'LH', 'PM', 'LB', 'CG', 'CF', 'BSH'];
  var isValidNetwork = validNetworks.indexOf(networkShortName) !== -1;

  // 验证 mid 不为空且是数字或字母数字组合
  var isValidMid = mid.length > 0 && /^[a-zA-Z0-9]+$/.test(mid);

  if (!isValidNetwork || !isValidMid) {
    return { networkShortName: '', mid: '', parsed: false };
  }

  return {
    networkShortName: networkShortName,
    mid: mid,
    parsed: true
  };
}

/**
 * 批量获取联盟链接
 * @param {Array} campaigns - Campaign 数据数组
 * @returns {Array} - 添加了 trackingUrl 和 networkShortName 的 campaigns
 */
function fetchAffiliateLinks(campaigns) {
  if (!CONFIG.API_BASE_URL || !CONFIG.API_KEY) {
    Logger.log('  ⚠️ API 配置不完整，跳过联盟链接获取');
    return campaigns;
  }

  // 构建查询数据：从 campaignName 解析联盟信息
  var campaignsToQuery = [];
  var parseSuccessCount = 0;
  var parseFailCount = 0;

  for (var i = 0; i < campaigns.length; i++) {
    var campaign = campaigns[i];
    var parsed = parseCampaignName(campaign.campaignName);

    if (parsed.parsed) {
      campaignsToQuery.push({
        campaignId: campaign.campaignId,
        networkShortName: parsed.networkShortName,
        mid: parsed.mid,
        finalUrl: campaign.finalUrl || ''  // 备用：用于域名匹配
      });
      parseSuccessCount++;
    } else {
      parseFailCount++;
    }
  }

  if (campaignsToQuery.length === 0) {
    Logger.log('  ⚠️ 没有可解析的广告系列名称（格式应为: xxx-联盟简称-...-mid）');
    return campaigns;
  }

  Logger.log('  📊 解析广告系列名称: 成功 ' + parseSuccessCount + ' 个，失败 ' + parseFailCount + ' 个');

  // 创建 campaignId -> campaign 的映射，用于后续合并结果
  var campaignMap = {};
  for (var j = 0; j < campaigns.length; j++) {
    campaignMap[campaigns[j].campaignId] = campaigns[j];
    // 初始化联盟链接字段
    campaigns[j].trackingUrl = '';
    campaigns[j].networkShortName = '';
  }

  // 分批查询
  var batchSize = CONFIG.BATCH_SIZE || 100;
  var totalBatches = Math.ceil(campaignsToQuery.length / batchSize);
  var successCount = 0;
  var errorCount = 0;

  for (var batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    var start = batchIndex * batchSize;
    var end = Math.min(start + batchSize, campaignsToQuery.length);
    var batch = campaignsToQuery.slice(start, end);

    Logger.log('  🔄 处理批次 ' + (batchIndex + 1) + '/' + totalBatches + ' (' + batch.length + ' 个)');

    try {
      var result = callAffiliateLookupApi(batch);

      if (result && result.success && result.campaignResults) {
        // 合并结果到 campaigns
        for (var campaignId in result.campaignResults) {
          var linkInfo = result.campaignResults[campaignId];
          if (campaignMap[campaignId] && linkInfo.found) {
            campaignMap[campaignId].trackingUrl = linkInfo.trackingUrl || '';
            campaignMap[campaignId].networkShortName = linkInfo.networkShortName || '';
            successCount++;
          }
        }
        Logger.log('    ✅ 批次成功，匹配: ' + result.stats.found + '/' + batch.length);
      } else {
        Logger.log('    ⚠️ 批次查询失败: ' + (result && result.error ? result.error : '未知错误'));
        errorCount += batch.length;
      }
    } catch (e) {
      Logger.log('    ❌ 批次请求异常: ' + e.message);
      errorCount += batch.length;
    }

    // 避免触发限流，添加短暂延迟
    if (batchIndex < totalBatches - 1) {
      Utilities.sleep(200);
    }
  }

  Logger.log('  📈 联盟链接匹配统计: 成功 ' + successCount + ' 个，失败 ' + errorCount + ' 个');

  return campaigns;
}

/**
 * 调用联盟链接查询 API
 * @param {Array} campaignsBatch - 批量 campaign 数据 [{campaignId, networkShortName, mid, finalUrl}]
 * @returns {Object} - API 响应结果
 */
function callAffiliateLookupApi(campaignsBatch) {
  var url = CONFIG.API_BASE_URL.replace(/\/$/, '') + '/api/v1/affiliate-links/lookup';

  var payload = {
    campaigns: campaignsBatch
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + CONFIG.API_KEY,
      'X-Api-Key': CONFIG.API_KEY
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
    timeout: CONFIG.API_TIMEOUT_MS || 30000
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    var responseCode = response.getResponseCode();
    var responseText = response.getContentText();

    if (responseCode === 200) {
      return JSON.parse(responseText);
    } else if (responseCode === 401) {
      Logger.log('    ❌ API 鉴权失败，请检查 API_KEY 配置');
      return { success: false, error: 'API 鉴权失败' };
    } else if (responseCode === 429) {
      Logger.log('    ⚠️ API 限流，等待后重试...');
      Utilities.sleep(5000);
      // 重试一次
      response = UrlFetchApp.fetch(url, options);
      if (response.getResponseCode() === 200) {
        return JSON.parse(response.getContentText());
      }
      return { success: false, error: 'API 限流' };
    } else {
      Logger.log('    ❌ API 错误 [' + responseCode + ']: ' + responseText.substring(0, 200));
      return { success: false, error: 'HTTP ' + responseCode };
    }
  } catch (e) {
    Logger.log('    ❌ API 请求异常: ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * 测试 API 连接（可在脚本编辑器中单独运行）
 */
function testApiConnection() {
  Logger.log('🧪 测试 API 连接...');
  Logger.log('API URL: ' + CONFIG.API_BASE_URL);
  Logger.log('API Key: ' + CONFIG.API_KEY.substring(0, 10) + '...');

  // 测试用例：模拟广告系列名称解析
  var testCampaignName = '001-RW-TestProduct-12345';
  var parsed = parseCampaignName(testCampaignName);
  Logger.log('解析测试: "' + testCampaignName + '" -> ' + JSON.stringify(parsed));

  // 测试 API 调用
  var testCampaigns = [
    {
      campaignId: 'test-001',
      networkShortName: 'RW',
      mid: '12345',
      finalUrl: 'https://www.example.com/product'
    }
  ];

  var result = callAffiliateLookupApi(testCampaigns);

  if (result && result.success) {
    Logger.log('✅ API 连接成功！');
    Logger.log('响应: ' + JSON.stringify(result));
  } else {
    Logger.log('❌ API 连接失败: ' + (result && result.error ? result.error : '未知错误'));
  }
}

/**
 * 测试广告系列名称解析（可在脚本编辑器中单独运行）
 */
function testParseCampaignName() {
  var testCases = [
    '688-LH1-viagogo-US-1216-38171',       // 正常：LH, mid=38171
    '346-PM1-blindsdirect-US-1216-87660',  // 正常：PM, mid=87660
    '343-PM1-eventbrite-US-1215-18645429', // 正常：PM, mid=18645429
    '260-PM1-twojemeble-PL-1104-53088',    // 正常：PM, mid=53088
    '154-LB1-colipays-FR-1229-91135',      // 正常：LB, mid=91135
    '082-RW1-katthelabel-AU-0115-122314',  // 正常：RW, mid=122314
    '001-INVALID-Test-999',                // 无效：联盟简称不存在
    'SimpleNameWithoutDash',               // 无效：没有分隔符
    '001-RW',                              // 无效：只有2个部分
  ];

  Logger.log('🧪 测试广告系列名称解析...');
  Logger.log('');

  for (var i = 0; i < testCases.length; i++) {
    var name = testCases[i];
    var result = parseCampaignName(name);
    var status = result.parsed ? '✅' : '❌';
    Logger.log(status + ' "' + name + '"');
    Logger.log('   -> networkShortName: ' + (result.networkShortName || '(空)'));
    Logger.log('   -> mid: ' + (result.mid || '(空)'));
    Logger.log('');
  }
}

