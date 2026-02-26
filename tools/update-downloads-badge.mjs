import fs from 'node:fs/promises';

const owner = 'NocCorporation';
const repo = 'NocLauncher';

const headers = {
  'User-Agent': 'noclauncher-badge-updater',
  'Accept': 'application/vnd.github+json'
};
if (process.env.GITHUB_TOKEN) {
  headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
}

async function fetchJson(url) {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}

async function fetchAllReleases() {
  const all = [];
  let page = 1;
  while (true) {
    const url = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=100&page=${page}`;
    const items = await fetchJson(url);
    if (!Array.isArray(items) || items.length === 0) break;
    all.push(...items);
    if (items.length < 100) break;
    page += 1;
  }
  return all;
}

const releases = await fetchAllReleases();

const totalAllReleases = releases.reduce((sum, rel) => {
  const assets = Array.isArray(rel.assets) ? rel.assets : [];
  return sum + assets.reduce((s, a) => s + Number(a.download_count || 0), 0);
}, 0);

const latest = releases.find(r => !r.draft && !r.prerelease) || releases[0] || null;
const latestTotal = latest
  ? (Array.isArray(latest.assets) ? latest.assets.reduce((s, a) => s + Number(a.download_count || 0), 0) : 0)
  : 0;

const allBadge = {
  schemaVersion: 1,
  label: 'downloads',
  message: String(totalAllReleases),
  color: '0e9f6e',
  namedLogo: 'github'
};

const latestBadge = {
  schemaVersion: 1,
  label: 'downloads latest',
  message: String(latestTotal),
  color: '2563eb',
  namedLogo: 'github'
};

await fs.mkdir('docs/badges', { recursive: true });
await fs.writeFile('docs/badges/downloads-total.json', JSON.stringify(allBadge, null, 2) + '\n', 'utf8');
await fs.writeFile('docs/badges/downloads-latest.json', JSON.stringify(latestBadge, null, 2) + '\n', 'utf8');

console.log(`Updated badges: all=${totalAllReleases}, latest=${latestTotal}, releases=${releases.length}`);
