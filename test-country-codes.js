/**
 * 测试国家代码转换功能
 */

const { normalizeCountryCode } = require('./src/lib/country-codes.ts');

console.log('=== 测试国家代码转换 ===\n');

const testCases = [
  // 完整国家名
  { input: 'United States', expected: 'US' },
  { input: 'United Kingdom', expected: 'GB' },
  { input: 'France', expected: 'FR' },
  { input: 'Kuwait', expected: 'KW' },

  // 已经是代码
  { input: 'US', expected: 'US' },
  { input: 'GB', expected: 'GB' },
  { input: 'us', expected: 'US' },

  // 逗号分隔
  { input: 'United States, Canada', expected: 'US' },
  { input: 'Kuwait, United States', expected: 'KW' },

  // 边界情况
  { input: null, expected: 'US' },
  { input: undefined, expected: 'US' },
  { input: '', expected: 'US' },
  { input: '  ', expected: 'US' },

  // 未知国家
  { input: 'Unknown Country', expected: 'US' },
];

let passed = 0;
let failed = 0;

testCases.forEach(({ input, expected }) => {
  const result = normalizeCountryCode(input);
  const status = result === expected ? '✅' : '❌';

  if (result === expected) {
    passed++;
  } else {
    failed++;
  }

  console.log(`${status} Input: "${input}" → Output: "${result}" (Expected: "${expected}")`);
});

console.log(`\n=== 测试结果 ===`);
console.log(`通过: ${passed}/${testCases.length}`);
console.log(`失败: ${failed}/${testCases.length}`);

if (failed === 0) {
  console.log('\n✅ 所有测试通过！');
  process.exit(0);
} else {
  console.log('\n❌ 部分测试失败！');
  process.exit(1);
}
