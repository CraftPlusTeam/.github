import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

// API responses stay in memory. Only approved aggregate numbers are published.
const query = `query($cursor: String) {
  organization(login: "CraftPlusTeam") {
    repositories(first: 100, after: $cursor, ownerAffiliations: OWNER) {
      pageInfo { hasNextPage endCursor }
      nodes {
        defaultBranchRef { target { ... on Commit { history { totalCount } } } }
        pullRequests(states: MERGED) { totalCount }
      }
    }
  }
}`;
let cursor;
let repositories = 0;
let commits = 0;
let merged = 0;
do {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  if (cursor) args.push('-f', `cursor=${cursor}`);
  let result;
  try {
    result = JSON.parse(execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch {
    throw new Error('GitHub集計に失敗しました。権限と通信状態を確認してください。既存画像は保持されます。');
  }
  if (result.errors || !result.data?.organization) throw new Error('GitHub集計が不完全です。既存画像は保持されます。');
  const page = result.data.organization.repositories;
  for (const repo of page.nodes) {
    repositories++;
    commits += repo.defaultBranchRef?.target?.history?.totalCount ?? 0;
    merged += repo.pullRequests.totalCount;
  }
  cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
} while (cursor);
if (!repositories) throw new Error('集計対象がありません。既存画像は保持されます。');
const updated = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const format = n => n.toLocaleString('en-US');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="290" viewBox="0 0 1200 290" role="img" aria-labelledby="title desc">
<title id="title">CraftPlusTeam development activity</title>
<desc id="desc">${format(commits)} commits, ${repositories} repositories, ${format(merged)} merged pull requests. Public and private repositories. Updated ${updated}.</desc>
<rect width="1200" height="290" rx="24" fill="#101B2D"/>
<g font-family="Arial, Helvetica, sans-serif">
<circle cx="42" cy="42" r="4" fill="#D3F989"/>
<text x="57" y="47" fill="#C2CECD" font-size="13" letter-spacing="3">THE WORK, IN NUMBERS</text>
${[[commits,'COMMITS',40],[repositories,'REPOSITORIES',440],[merged,'MERGED PRS',840]].map(([value,label,x])=>`<text x="${x}" y="160" fill="#D3F989" font-size="68" font-weight="700" letter-spacing="-2">${format(value)}</text><text x="${x+3}" y="198" fill="#EDF2EF" font-size="14" letter-spacing="2">${label}</text>`).join('\n')}
<path d="M400 94V200M800 94V200" stroke="#31424E"/>
<text x="43" y="257" fill="#A9BCBE" font-size="12" letter-spacing="1">PUBLIC + PRIVATE</text>
<text x="1157" y="257" fill="#A9BCBE" font-size="12" text-anchor="end">UPDATED ${updated}</text>
</g>
</svg>
`;
writeFileSync(new URL('../profile/assets/activity.svg', import.meta.url), svg);
console.log(`Aggregate saved: ${commits} commits / ${repositories} repositories / ${merged} merged PRs (${updated})`);
