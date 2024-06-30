/* eslint-disable no-console */
import crypto from 'node:crypto';
import express, { Request, Response } from 'express';

/**
 * A stand-in for api.github.com, used by the Docker demo profile.
 *
 * It exists so the sync pipeline can be watched doing real work — `Link`
 * pagination, `If-None-Match` conditional requests, rate-limit headers — with
 * no GitHub account, no OAuth app and no network access. It is a development
 * tool: it is never imported by the application and never shipped as the
 * default upstream.
 */

const PORT = Number(process.env.MOCK_GITHUB_PORT ?? 4100);
const PUBLIC_URL = (process.env.MOCK_GITHUB_PUBLIC_URL ?? `http://localhost:${PORT}`).replace(
  /\/+$/,
  '',
);

const OWNER = 'fernhollow-demo';
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number, hour = 10): string => {
  const date = new Date(Date.now() - days * DAY_MS);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
};

const REPOS = [
  {
    name: 'ledger-core',
    language: 'TypeScript',
    stars: 412,
    commits: 140,
    description: 'Double-entry ledger service with an event-sourced write path.',
    topics: ['ledger', 'event-sourcing', 'fintech'],
  },
  {
    name: 'atlas-gateway',
    language: 'Go',
    stars: 287,
    commits: 110,
    description: 'Edge gateway handling auth, rate limiting and request shaping.',
    topics: ['gateway', 'grpc', 'observability'],
  },
  {
    name: 'pulse-dashboard',
    language: 'TypeScript',
    stars: 156,
    commits: 90,
    description: 'Operational dashboard for the platform team.',
    topics: ['dashboard', 'charts'],
  },
  {
    name: 'sift-indexer',
    language: 'Python',
    stars: 203,
    commits: 70,
    description: 'Batch indexer that fans documents out to the search cluster.',
    topics: ['search', 'etl'],
  },
  {
    name: 'harbor-ci',
    language: 'Rust',
    stars: 98,
    commits: 45,
    description: 'Self-hosted CI runner with a content-addressed build cache.',
    topics: ['ci', 'caching'],
  },
  {
    name: 'copperplate',
    language: 'CSS',
    stars: 64,
    commits: 30,
    description: 'Design tokens and the shared component stylesheet.',
    topics: ['design-system'],
  },
];

const SUBJECTS = [
  'Honour Retry-After on secondary rate limits',
  'Persist the ETag per listing rather than per page',
  'Walk Link headers instead of computing page numbers',
  'Batch the page write into a single bulkWrite',
  'Advance the watermark only on a successful walk',
  'Skip archived repositories on the nightly run',
];

const AUTHORS = ['rosa-demo', 'kwabena-demo', 'yue-demo', 'daichi-demo'];

const etagFor = (value: unknown): string =>
  `"${crypto.createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 16)}"`;

/** Applies `Link` pagination and a conditional-request check to any array. */
const sendPage = (req: Request, res: Response, path: string, items: unknown[]): void => {
  const perPage = Math.min(Number(req.query.per_page) || 30, 100);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const start = (page - 1) * perPage;
  const slice = items.slice(start, start + perPage);
  const etag = etagFor([path, items.length, page, perPage]);

  res.set('x-ratelimit-limit', '5000');
  res.set('x-ratelimit-remaining', String(4900 - page));
  res.set('x-ratelimit-reset', String(Math.floor(Date.now() / 1000) + 3600));
  res.set('ETag', etag);

  if (req.headers['if-none-match'] === etag) {
    // The whole point of the demo: an unchanged listing costs no quota.
    res.status(304).end();
    return;
  }

  if (start + slice.length < items.length) {
    const query = new URLSearchParams({ ...(req.query as Record<string, string>) });
    query.set('page', String(page + 1));
    query.set('per_page', String(perPage));
    res.set('Link', `<${PUBLIC_URL}${path}?${query.toString()}>; rel="next"`);
  }

  res.json(slice);
};

const app = express();
app.use(express.json());

app.get('/user', (_req, res) => {
  res.json({
    id: 900001,
    login: 'fernhollow-maintainer',
    name: 'Fernhollow Labs (demo)',
    avatar_url: `${PUBLIC_URL}/avatar.png`,
    html_url: `https://github.com/${OWNER}`,
  });
});

app.get('/user/repos', (req, res) => {
  sendPage(
    req,
    res,
    '/user/repos',
    REPOS.map((repo, index) => ({
      id: 100000 + index,
      name: repo.name,
      full_name: `${OWNER}/${repo.name}`,
      owner: { login: OWNER },
      description: repo.description,
      html_url: `https://github.com/${OWNER}/${repo.name}`,
      default_branch: 'main',
      private: false,
      fork: false,
      archived: false,
      language: repo.language,
      topics: repo.topics,
      stargazers_count: repo.stars,
      forks_count: Math.floor(repo.stars / 12),
      open_issues_count: 2,
      size: 1000 + index * 250,
      pushed_at: daysAgo(index),
      created_at: daysAgo(500 + index * 30),
      updated_at: daysAgo(index),
    })),
  );
});

const findRepo = (name: string) => {
  const index = REPOS.findIndex((repo) => repo.name === name);
  return index === -1 ? null : { ...REPOS[index], index };
};

app.get('/repos/:owner/:repo/commits', (req, res) => {
  const repo = findRepo(req.params.repo);
  if (!repo) {
    res.status(404).json({ message: 'Not Found' });
    return;
  }

  const since = req.query.since ? new Date(String(req.query.since)).getTime() : 0;

  const commits = Array.from({ length: repo.commits }, (_unused, i) => ({
    sha: `${repo.index}${i.toString().padStart(6, '0')}`,
    html_url: `https://github.com/${OWNER}/${repo.name}/commit/${i}`,
    commit: {
      message: SUBJECTS[i % SUBJECTS.length],
      author: {
        name: AUTHORS[i % AUTHORS.length],
        email: `${AUTHORS[i % AUTHORS.length]}@example.invalid`,
        date: daysAgo(i % 90, i % 24),
      },
    },
    author: { login: AUTHORS[i % AUTHORS.length] },
  })).filter((commit) => new Date(commit.commit.author.date).getTime() >= since);

  sendPage(req, res, `/repos/${req.params.owner}/${req.params.repo}/commits`, commits);
});

app.get('/repos/:owner/:repo/issues', (req, res) => {
  const repo = findRepo(req.params.repo);
  if (!repo) {
    res.status(404).json({ message: 'Not Found' });
    return;
  }

  const issues = Array.from({ length: 8 }, (_unused, i) => ({
    id: Number(`${repo.index}9${i}`),
    number: 100 + i,
    title: `${repo.name}: ${SUBJECTS[i % SUBJECTS.length]}`,
    state: i % 3 === 0 ? 'closed' : 'open',
    user: { login: AUTHORS[i % AUTHORS.length] },
    labels: [{ name: i % 2 ? 'bug' : 'enhancement' }],
    comments: i,
    html_url: `https://github.com/${OWNER}/${repo.name}/issues/${100 + i}`,
    created_at: daysAgo(30 + i),
    updated_at: daysAgo(i * 2),
    closed_at: i % 3 === 0 ? daysAgo(i) : null,
  }));

  sendPage(req, res, `/repos/${req.params.owner}/${req.params.repo}/issues`, issues);
});

app.get('/repos/:owner/:repo/pulls', (req, res) => {
  const repo = findRepo(req.params.repo);
  if (!repo) {
    res.status(404).json({ message: 'Not Found' });
    return;
  }

  const pulls = Array.from({ length: 5 }, (_unused, i) => {
    const merged = i % 3 === 1;
    // Index 4 is deliberately ancient so the stale-PR detector has something
    // to find in the demo data.
    const updatedDaysAgo = i === 4 ? 70 : i * 4;

    return {
      id: Number(`${repo.index}8${i}`),
      number: 200 + i,
      title: `${SUBJECTS[(i + 2) % SUBJECTS.length]}`,
      state: merged ? 'closed' : i === 2 ? 'closed' : 'open',
      draft: i === 3,
      merged_at: merged ? daysAgo(updatedDaysAgo) : null,
      user: { login: AUTHORS[i % AUTHORS.length] },
      labels: [{ name: 'review-needed' }],
      head: { ref: `feature/${i}` },
      base: { ref: 'main' },
      html_url: `https://github.com/${OWNER}/${repo.name}/pull/${200 + i}`,
      created_at: daysAgo(updatedDaysAgo + 10),
      updated_at: daysAgo(updatedDaysAgo),
      closed_at: merged || i === 2 ? daysAgo(updatedDaysAgo) : null,
    };
  });

  sendPage(req, res, `/repos/${req.params.owner}/${req.params.repo}/pulls`, pulls);
});

app.delete('/applications/:clientId/token', (_req, res) => res.status(204).end());

app.use((_req, res) => res.status(404).json({ message: 'Not Found' }));

app.listen(PORT, () => {
  console.log(`mock GitHub API listening on ${PUBLIC_URL}`);
});
