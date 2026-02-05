/**
 * 国家名称到国家代码的映射表
 * 用于将 Google Ads 返回的完整国家名称转换为 ISO 3166-1 alpha-2 代码
 *
 * 包含所有常用国家和地区（200+ 个）
 */
export const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  // 北美
  'United States': 'US',
  'Canada': 'CA',
  'Mexico': 'MX',
  'Greenland': 'GL',
  'Bermuda': 'BM',

  // 中美洲和加勒比
  'Guatemala': 'GT',
  'Belize': 'BZ',
  'El Salvador': 'SV',
  'Honduras': 'HN',
  'Nicaragua': 'NI',
  'Costa Rica': 'CR',
  'Panama': 'PA',
  'Cuba': 'CU',
  'Jamaica': 'JM',
  'Haiti': 'HT',
  'Dominican Republic': 'DO',
  'Puerto Rico': 'PR',
  'Trinidad and Tobago': 'TT',
  'Bahamas': 'BS',
  'Barbados': 'BB',

  // 南美
  'Brazil': 'BR',
  'Argentina': 'AR',
  'Chile': 'CL',
  'Colombia': 'CO',
  'Peru': 'PE',
  'Venezuela': 'VE',
  'Ecuador': 'EC',
  'Bolivia': 'BO',
  'Paraguay': 'PY',
  'Uruguay': 'UY',
  'Guyana': 'GY',
  'Suriname': 'SR',

  // 西欧
  'United Kingdom': 'GB',
  'France': 'FR',
  'Germany': 'DE',
  'Italy': 'IT',
  'Spain': 'ES',
  'Netherlands': 'NL',
  'Belgium': 'BE',
  'Switzerland': 'CH',
  'Austria': 'AT',
  'Portugal': 'PT',
  'Ireland': 'IE',
  'Luxembourg': 'LU',
  'Monaco': 'MC',
  'Liechtenstein': 'LI',
  'Andorra': 'AD',
  'San Marino': 'SM',
  'Vatican City': 'VA',
  'Malta': 'MT',
  'Iceland': 'IS',

  // 北欧
  'Sweden': 'SE',
  'Norway': 'NO',
  'Denmark': 'DK',
  'Finland': 'FI',

  // 东欧
  'Poland': 'PL',
  'Czech Republic': 'CZ',
  'Slovakia': 'SK',
  'Hungary': 'HU',
  'Romania': 'RO',
  'Bulgaria': 'BG',
  'Slovenia': 'SI',
  'Croatia': 'HR',
  'Serbia': 'RS',
  'Bosnia and Herzegovina': 'BA',
  'Montenegro': 'ME',
  'North Macedonia': 'MK',
  'Albania': 'AL',
  'Kosovo': 'XK',
  'Estonia': 'EE',
  'Latvia': 'LV',
  'Lithuania': 'LT',
  'Belarus': 'BY',
  'Ukraine': 'UA',
  'Moldova': 'MD',

  // 南欧
  'Greece': 'GR',
  'Cyprus': 'CY',

  // 俄罗斯和中亚
  'Russia': 'RU',
  'Kazakhstan': 'KZ',
  'Uzbekistan': 'UZ',
  'Turkmenistan': 'TM',
  'Kyrgyzstan': 'KG',
  'Tajikistan': 'TJ',
  'Armenia': 'AM',
  'Azerbaijan': 'AZ',
  'Georgia': 'GE',

  // 东亚
  'China': 'CN',
  'Japan': 'JP',
  'South Korea': 'KR',
  'North Korea': 'KP',
  'Mongolia': 'MN',
  'Hong Kong': 'HK',
  'Macau': 'MO',
  'Taiwan': 'TW',

  // 东南亚
  'Thailand': 'TH',
  'Vietnam': 'VN',
  'Malaysia': 'MY',
  'Singapore': 'SG',
  'Indonesia': 'ID',
  'Philippines': 'PH',
  'Myanmar': 'MM',
  'Cambodia': 'KH',
  'Laos': 'LA',
  'Brunei': 'BN',
  'Timor-Leste': 'TL',

  // 南亚
  'India': 'IN',
  'Pakistan': 'PK',
  'Bangladesh': 'BD',
  'Sri Lanka': 'LK',
  'Nepal': 'NP',
  'Bhutan': 'BT',
  'Maldives': 'MV',
  'Afghanistan': 'AF',

  // 中东
  'Turkey': 'TR',
  'Iran': 'IR',
  'Iraq': 'IQ',
  'Syria': 'SY',
  'Lebanon': 'LB',
  'Jordan': 'JO',
  'Israel': 'IL',
  'Palestine': 'PS',
  'Saudi Arabia': 'SA',
  'Yemen': 'YE',
  'Oman': 'OM',
  'United Arab Emirates': 'AE',
  'Qatar': 'QA',
  'Bahrain': 'BH',
  'Kuwait': 'KW',

  // 非洲北部
  'Egypt': 'EG',
  'Libya': 'LY',
  'Tunisia': 'TN',
  'Algeria': 'DZ',
  'Morocco': 'MA',
  'Sudan': 'SD',
  'South Sudan': 'SS',

  // 非洲西部
  'Nigeria': 'NG',
  'Ghana': 'GH',
  'Ivory Coast': 'CI',
  'Senegal': 'SN',
  'Mali': 'ML',
  'Burkina Faso': 'BF',
  'Niger': 'NE',
  'Guinea': 'GN',
  'Sierra Leone': 'SL',
  'Liberia': 'LR',
  'Mauritania': 'MR',
  'Gambia': 'GM',
  'Guinea-Bissau': 'GW',
  'Cape Verde': 'CV',
  'Benin': 'BJ',
  'Togo': 'TG',

  // 非洲中部
  'Cameroon': 'CM',
  'Chad': 'TD',
  'Central African Republic': 'CF',
  'Congo': 'CG',
  'Democratic Republic of the Congo': 'CD',
  'Gabon': 'GA',
  'Equatorial Guinea': 'GQ',
  'Sao Tome and Principe': 'ST',

  // 非洲东部
  'Kenya': 'KE',
  'Tanzania': 'TZ',
  'Uganda': 'UG',
  'Rwanda': 'RW',
  'Burundi': 'BI',
  'Ethiopia': 'ET',
  'Somalia': 'SO',
  'Djibouti': 'DJ',
  'Eritrea': 'ER',
  'Seychelles': 'SC',
  'Mauritius': 'MU',
  'Comoros': 'KM',
  'Madagascar': 'MG',

  // 非洲南部
  'South Africa': 'ZA',
  'Namibia': 'NA',
  'Botswana': 'BW',
  'Zimbabwe': 'ZW',
  'Zambia': 'ZM',
  'Malawi': 'MW',
  'Mozambique': 'MZ',
  'Angola': 'AO',
  'Lesotho': 'LS',
  'Eswatini': 'SZ',
  'Swaziland': 'SZ', // 旧名

  // 大洋洲
  'Australia': 'AU',
  'New Zealand': 'NZ',
  'Papua New Guinea': 'PG',
  'Fiji': 'FJ',
  'Solomon Islands': 'SB',
  'Vanuatu': 'VU',
  'Samoa': 'WS',
  'Tonga': 'TO',
  'Kiribati': 'KI',
  'Micronesia': 'FM',
  'Marshall Islands': 'MH',
  'Palau': 'PW',
  'Nauru': 'NR',
  'Tuvalu': 'TV',

  // 其他常见别名
  'USA': 'US',
  'UK': 'GB',
  'Britain': 'GB',
  'Great Britain': 'GB',
  'England': 'GB',
  'Scotland': 'GB',
  'Wales': 'GB',
  'Northern Ireland': 'GB',
  'UAE': 'AE',
  'Korea': 'KR',
  'South Korea (Republic of Korea)': 'KR',
  'North Korea (Democratic People\'s Republic of Korea)': 'KP',
  'Czech': 'CZ',
  'Czechia': 'CZ',
  'Holland': 'NL',
  'Burma': 'MM',
  'Persia': 'IR',
}

/**
 * 将国家名称或代码标准化为 ISO 3166-1 alpha-2 代码
 *
 * 处理逻辑：
 * 1. 如果已经是 2 位大写代码（如 "US"），直接返回
 * 2. 如果是完整国家名称（如 "United States"），转换为代码
 * 3. 如果包含逗号（如 "United States, Canada"），只取第一个
 * 4. 如果无法识别，返回默认值 "US"
 *
 * @param countryInput 国家名称或代码
 * @returns ISO 3166-1 alpha-2 国家代码（大写）
 */
export function normalizeCountryCode(countryInput: string | null | undefined): string {
  if (!countryInput) {
    return 'US' // 默认美国
  }

  // 去除首尾空格
  let country = countryInput.trim()

  // 如果包含逗号，只取第一个
  if (country.includes(',')) {
    country = country.split(',')[0].trim()
  }

  // 如果已经是 2 位大写代码，直接返回
  if (/^[A-Z]{2}$/.test(country)) {
    return country
  }

  // 如果是 2 位小写代码，转大写返回
  if (/^[a-z]{2}$/.test(country)) {
    return country.toUpperCase()
  }

  // 尝试从映射表查找
  const code = COUNTRY_NAME_TO_CODE[country]
  if (code) {
    return code
  }

  // 尝试不区分大小写查找
  const lowerCountry = country.toLowerCase()
  for (const [name, code] of Object.entries(COUNTRY_NAME_TO_CODE)) {
    if (name.toLowerCase() === lowerCountry) {
      return code
    }
  }

  // 无法识别，记录警告并返回默认值
  console.warn(`[normalizeCountryCode] Unknown country: "${country}", using default "US"`)
  return 'US'
}
