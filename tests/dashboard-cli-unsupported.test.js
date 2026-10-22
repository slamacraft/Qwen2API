// 账号池的 CLI 可用性展示规则：CLI 是独立维度，绝不能污染「账号健康」徽章。
// P1 重做后（dashboard.vue 拆成 components/accounts/**），断言的落点从单文件搬到了
// shared.js 的映射表 + AccountCard/AccountTable 的渲染分支，意图保持不变。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (relative) => fs.readFileSync(require.resolve(relative), 'utf8');

const shared = read('../public/src/components/accounts/shared.js');
const accountCard = read('../public/src/components/accounts/AccountCard.vue');
const accountTable = read('../public/src/components/accounts/AccountTable.vue');
const dashboard = read('../public/src/views/dashboard.vue');

test('dashboard renders inactive CLI states as a muted hint with tooltip', () => {
  // 卡片与表格两条渲染路径都要用同一张 CLI_INACTIVE_LABELS 映射
  assert.match(shared, /export const CLI_INACTIVE_LABELS = Object\.freeze\(\{/);
  assert.match(accountCard, /const cliInactive = computed\(\(\) => Boolean\(CLI_INACTIVE_LABELS\[props\.row\.cliState\]\)\)/);
  assert.match(accountTable, /const cliInactive = \(row\) => Boolean\(CLI_INACTIVE_LABELS\[row\.cliState\]\)/);
  // tooltip 由 shared.js 统一生成，渲染层只负责挂上去
  assert.match(shared, /export const buildCliTooltip = \(cliState, t\) => \{/);
  assert.match(accountCard, /:title="row\.cliTooltip"/);
  assert.match(dashboard, /cliTooltip: buildCliTooltip\(status\.cli \|\| 'available', t\)/);
  // CLI 详情只在「可用」时展开，其余状态不展开成 0/配额
  assert.match(accountCard, /v-if="cliExpanded && row\.cliState === 'available'"/);
});

test('inactive CLI states cover both unsupported and disabled', () => {
  assert.match(shared, /unsupported: 'accounts\.cliUnsupported'/);
  assert.match(shared, /disabled: 'accounts\.cliDisabled'/);
  assert.match(dashboard, /cliState: status\.cli \|\| 'available'/);
});

test('dashboard renders pending CLI state as a neutral hint', () => {
  assert.match(accountCard, /v-else-if="row\.cliState === 'pending'"/);
  assert.match(accountTable, /v-else-if="row\.cliState === 'pending'"/);
  assert.match(accountCard, /t\('accounts\.cliPending'\)/);
  assert.match(accountTable, /t\('accounts\.cliPending'\)/);
});

// The badge answers "is this account alive"; CLI availability must not leak into it.
test('status badge carries only health states', () => {
  const map = shared.match(/export const STATUS_META = Object\.freeze\(\{[\s\S]*?\}\)/);
  assert.ok(map, 'STATUS_META map not found');
  assert.doesNotMatch(map[0], /cli_/);
  for (const kind of ['active', 'warn', 'cooldown', 'token_expiring']) {
    assert.match(map[0], new RegExp(`${kind}:`));
  }
});

test('every locale defines the new cli_disabled strings', () => {
  for (const lang of ['ru', 'zh', 'en']) {
    const messages = JSON.parse(fs.readFileSync(require.resolve(`../public/src/locales/${lang}.json`), 'utf8'));
    assert.ok(messages.dash.acct.cliDisabledShort, `${lang}: dash.acct.cliDisabledShort is missing`);
    assert.ok(messages.dash.acct.status.cliDisabled, `${lang}: dash.acct.status.cliDisabled is missing`);

    // P1 的新命名空间：CLI 不可用的两个短标签也必须三语齐全
    const accounts = JSON.parse(fs.readFileSync(require.resolve(`../public/src/locales/accounts.${lang}.json`), 'utf8'));
    assert.ok(accounts.accounts.cliDisabled, `${lang}: accounts.cliDisabled is missing`);
    assert.ok(accounts.accounts.cliUnsupported, `${lang}: accounts.cliUnsupported is missing`);
  }
});
