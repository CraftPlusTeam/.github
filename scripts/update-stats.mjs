import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ORG = 'CraftPlusTeam';
function api(path, paginated = false) {
  try {
    const args = ['api', path];
    if (paginated) args.push('--paginate', '--jq', '.[] | @json');
    const raw = execFileSync('gh', args, {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
    }).trim();
    return paginated ? (raw ? raw.split('\n').map(line => JSON.parse(line)) : []) : JSON.parse(raw);
  } catch {
    // Never print API errors, repository paths, emails, or commit messages.
    throw new Error('GitHub集計に失敗しました。権限と通信状態を確認してください。既存画像は保持されます。');
  }
}

export function collectStats(request = api, now = new Date()) {
  const organization = request(`orgs/${ORG}`);
  const repos = request(`orgs/${ORG}/repos?type=all&per_page=100`, true);
  const members = request(`orgs/${ORG}/members?per_page=100`, true);
  if (!Array.isArray(repos) || !repos.length || !Array.isArray(members) || !members.length) {
    throw new Error('集計対象またはメンバー情報が不完全です。');
  }
  // Refuse partial access when GitHub supplies the authoritative repository count.
  if (!Number.isInteger(organization.total_private_repos) ||
      repos.length !== organization.public_repos + organization.total_private_repos) {
    throw new Error('組織全体の読み取り権限を確認できません。既存画像は保持されます。');
  }
  const counts = new Map(members.map(m => [m.login.toLowerCase(), {login: m.login, commits: 0}]));
  let commits = 0, merged = 0, other = 0;
  const languages = new Map();
  for (const repo of repos) {
    const base = `repos/${ORG}/${encodeURIComponent(repo.name)}`;
    for (const [name, bytes] of Object.entries(request(`${base}/languages`))) {
      if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('言語データが不正です。');
      if (bytes) languages.set(name, (languages.get(name) ?? 0) + bytes);
    }
    // Pin traversal to a branch SHA so pagination cannot drift during collection.
    const branches = request(`${base}/branches?per_page=100`, true);
    const branch = branches.find(b => b.name === repo.default_branch);
    if (branches.length && !branch?.commit?.sha) throw new Error('デフォルトブランチを確認できません。');
    const history = branch ? request(`${base}/commits?sha=${encodeURIComponent(branch.commit.sha)}&per_page=100`, true) : [];
    const seen = new Set();
    for (const commit of history) {
      if (!commit.sha || seen.has(commit.sha)) continue;
      seen.add(commit.sha);
      commits++;
      const member = counts.get(commit.author?.login?.toLowerCase());
      if (member) member.commits++;
      else other++;
    }
    merged += request(`${base}/pulls?state=closed&per_page=100`, true).filter(pr => pr.merged_at).length;
  }
  return { commits, repositories: repos.length, merged, other,
    languages: [...languages].map(([name,bytes])=>({name,bytes})).sort((a,b)=>b.bytes-a.bytes || a.name.localeCompare(b.name)),
    members: [...counts.values()].sort((a,b) => b.commits-a.commits || a.login.localeCompare(b.login)),
    updated: now.toISOString().slice(0,16).replace('T',' ') + ' UTC' };
}

const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const fmt = n => n.toLocaleString('en-US');
export function renderStats(data) {
  const height = 350 + data.members.length * 154;
  const total = Math.max(1, data.commits);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${height}" viewBox="0 0 1200 ${height}" role="img" aria-labelledby="title desc">
<title id="title">CraftPlusTeam — the people behind the commits</title>
<desc id="desc">${data.members.map(m=>`${escape(m.login)}: ${fmt(m.commits)} commits`).join('. ')}. Other or unlinked authors: ${fmt(data.other)}. Updated ${escape(data.updated)}.</desc>
<style>
.bar { animation: reveal 1.4s cubic-bezier(.2,.7,.2,1) both; transform-box:fill-box; transform-origin:left; }
@keyframes reveal { from { transform:scaleX(0) } to { transform:scaleX(1) } }
@media (prefers-reduced-motion:reduce) { .bar { animation:none } }
</style>
<rect width="1200" height="${height}" rx="28" fill="#0D1117"/>
<g font-family="Arial, Helvetica, sans-serif">
<text x="48" y="58" fill="#8B949E" font-size="19" letter-spacing="3">TEAM / CONTRIBUTIONS</text>
${[[data.commits,'COMMITS',48],[data.repositories,'REPOSITORIES',452],[data.merged,'MERGED PRS',855]].map(([n,label,x])=>`<text x="${x}" y="154" fill="#E6EDF3" font-size="72" font-weight="700" letter-spacing="-3">${fmt(n)}</text><text x="${x+3}" y="193" fill="#8B949E" font-size="20" letter-spacing="2">${label}</text>`).join('\n')}
<path d="M48 229H1152" stroke="#25313D"/>
${data.members.map((m,i)=>{
 const y=275+i*154;
 const pct=data.commits ? (m.commits/data.commits*100).toFixed(1) : '0.0';
 return `<text x="48" y="${y+20}" fill="#00D9FF" font-size="22">${String(i+1).padStart(2,'0')}</text>
<text x="110" y="${y+20}" fill="#E6EDF3" font-size="34" font-weight="700">${escape(m.login)}</text>
<text x="1152" y="${y+20}" text-anchor="end" fill="#E6EDF3" font-size="36" font-weight="700">${fmt(m.commits)} <tspan fill="#8B949E" font-size="20" font-weight="400">commits · ${pct}%</tspan></text>
<rect x="110" y="${y+49}" width="1042" height="14" rx="7" fill="#172B39"/>
${m.commits?`<rect class="bar" x="110" y="${y+49}" width="${(1042*m.commits/total).toFixed(2)}" height="14" rx="7" fill="${i%2?'#5896FF':'#00D9FF'}"/>`:''}`;
}).join('\n')}
<text x="48" y="${height-61}" fill="#8B949E" font-size="20">Other / unlinked authors <tspan fill="#E6EDF3" font-weight="700">${fmt(data.other)}</tspan></text>
<text x="48" y="${height-25}" fill="#8B949E" font-size="17">PUBLIC + PRIVATE · DEFAULT-BRANCH HISTORY</text>
<text x="1152" y="${height-25}" text-anchor="end" fill="#8B949E" font-size="17">${escape(data.updated)}</text>
</g>
</svg>\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const data = collectStats();
  const activity = renderStats(data);
  const staticSvg = svg => svg.replace(/<style>[\s\S]*?<\/style>/g, '');
  const hero = readFileSync(new URL('../profile/assets/hero.svg', import.meta.url), 'utf8');
  const languages = renderLanguages(data);
  writeFileSync(new URL('../profile/assets/activity.svg', import.meta.url), activity);
  writeFileSync(new URL('../profile/assets/languages.svg', import.meta.url), languages);
  writeFileSync(new URL('../profile/assets/activity-static.svg', import.meta.url), staticSvg(activity));
  writeFileSync(new URL('../profile/assets/hero-static.svg', import.meta.url), staticSvg(hero));
  console.log(JSON.stringify(data));
}

export function renderLanguages(data) {
  const colors = ['#00D9FF','#5896FF','#A78BFA','#34D399','#FBBF24','#FB7185','#F97316','#94A3B8'];
  const all = data.languages ?? [];
  const languages = all.length > 8 ? [...all.slice(0,7),{name:'Other',bytes:all.slice(7).reduce((s,l)=>s+l.bytes,0)}] : all;
  const total = languages.reduce((sum,l)=>sum+l.bytes,0);
  // Largest-remainder rounding: displayed percentages add up to exactly 100.0%.
  const shares = languages.map((l,i)=>({ ...l, i, units:total?Math.floor(l.bytes/total*1000):0, rest:total?l.bytes/total*1000%1:0 }));
  let remaining = total ? 1000-shares.reduce((s,l)=>s+l.units,0) : 0;
  for (const l of [...shares].sort((a,b)=>b.rest-a.rest || a.i-b.i)) { if (remaining-- > 0) l.units++; }
  let x = 48;
  const height = 250 + Math.ceil(shares.length/2)*70;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${height}" viewBox="0 0 1200 ${height}" role="img" aria-labelledby="title desc">
<title id="title">Languages across CraftPlusTeam</title>
<desc id="desc">${shares.map(l=>`${escape(l.name)} ${(l.units/10).toFixed(1)}%`).join(', ')}. Based on GitHub language bytes, not commit counts.</desc>
<rect width="1200" height="${height}" rx="28" fill="#0D1117"/>
<g font-family="Arial, Helvetica, sans-serif">
<text x="48" y="58" fill="#00D9FF" font-size="23" font-weight="700">Languages we build with</text>
<text x="48" y="99" fill="#8B949E" font-size="20">Across public + private repositories</text>
<defs><clipPath id="bar"><rect x="48" y="135" width="1104" height="25" rx="12.5"/></clipPath></defs>
<g clip-path="url(#bar)">${shares.map((l,i)=>{const width=total?1104*l.bytes/total:0;const piece=`<rect x="${x}" y="135" width="${width}" height="25" fill="${colors[i]}"/>`;x+=width;return piece;}).join('')}</g>
${shares.length?shares.map((l,i)=>{const x=i%2?655:48,y=220+Math.floor(i/2)*70;return `<circle cx="${x+7}" cy="${y-8}" r="7" fill="${colors[i]}"/><text x="${x+28}" y="${y}" fill="#C9D1D9" font-size="25">${escape(l.name)}</text><text x="${x+475}" y="${y}" fill="#E6EDF3" text-anchor="end" font-size="25" font-weight="700">${(l.units/10).toFixed(1)}%</text>`}).join('\n'):'<text x="48" y="195" fill="#8B949E" font-size="24">No language data available</text>'}
<text x="48" y="${height-25}" fill="#8B949E" font-size="17">CODE BYTES / GITHUB LINGUIST</text>
<text x="1152" y="${height-25}" fill="#8B949E" font-size="17" text-anchor="end">${escape(data.updated)}</text>
</g></svg>\n`;
}
