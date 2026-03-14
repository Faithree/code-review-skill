#!/usr/bin/env node

/**
 * 从 GitHub 拉取指定仓库在日期范围内的 PR Code Review 评论，写入 Markdown 文件。
 *
 * 前置条件：设置 GITHUB_TOKEN 或 GH_TOKEN 环境变量（需 repo read 权限）。
 *
 * 用法：
 *   GITHUB_TOKEN=<token> node fetch-pr-comments.mjs --owner <org> --repo <repo> [options]
 *
 * 选项：
 *   --owner    GitHub 组织或用户名（必填）
 *   --repo     仓库名（必填）
 *   --since    起始日期，格式 YYYY-MM-DD（默认 6 个月前）
 *   --until    截止日期，格式 YYYY-MM-DD（默认今天）
 *   --output   输出文件路径（默认当前目录下的 review-log.md）
 *   --delay    请求间隔毫秒数，避免触发 rate limit（默认 250）
 *   --help     显示帮助信息
 */

import { appendFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── CLI 参数解析 ───────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--help' || key === '-h') {
      args.help = true;
      continue;
    }
    if (key.startsWith('--') && i + 1 < argv.length) {
      args[key.slice(2)] = argv[++i];
    }
  }
  return args;
}

function printHelp() {
  console.log(`
用法：GITHUB_TOKEN=<token> node fetch-pr-comments.mjs --owner <org> --repo <repo> [options]

必填参数：
  --owner    GitHub 组织或用户名
  --repo     仓库名

可选参数：
  --since    起始日期，格式 YYYY-MM-DD（默认 6 个月前）
  --until    截止日期，格式 YYYY-MM-DD（默认今天）
  --output   输出文件路径（默认 ./review-log.md）
  --delay    请求间隔毫秒数（默认 250）
  --help     显示此帮助信息

环境变量：
  GITHUB_TOKEN 或 GH_TOKEN — GitHub Personal Access Token（需 repo read 权限）

示例：
  GITHUB_TOKEN=ghp_xxx node fetch-pr-comments.mjs --owner my-org --repo my-repo --since 2025-01-01 --until 2025-06-30
`);
}

function getDefaultSince() {
  const d = new Date();
  d.setMonth(d.getMonth() - 6);
  return d.toISOString().slice(0, 10);
}

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

// ─── GitHub API ─────────────────────────────────────────────

function createGitHubClient(token, delayMs) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function request(url) {
    const res = await fetch(url, { headers });
    await sleep(delayMs);

    if (!res.ok) {
      const body = await res.text();
      if (res.status === 401) {
        console.error(
          '❌ GitHub 返回 401。请检查：\n' +
            '  1. Token 是否有效且未过期\n' +
            '  2. Classic PAT 需要 repo 权限；Fine-grained PAT 需要 Contents read 权限'
        );
      }
      if (res.status === 403) {
        console.error('❌ GitHub 返回 403，可能触发了 Rate Limit。请稍后重试或增大 --delay。');
      }
      throw new Error(`HTTP ${res.status}: ${body}`);
    }
    return res.json();
  }

  return { request };
}

async function fetchAllPrNumbers(client, owner, repo, dateRange) {
  const numbers = [];
  let page = 1;

  for (;;) {
    const q = `repo:${owner}/${repo} is:pr created:${dateRange}`;
    const url = `https://api.github.com/search/issues?${new URLSearchParams({
      q,
      per_page: '100',
      page: String(page),
    })}`;

    const data = await client.request(url);
    const items = data.items || [];

    for (const item of items) {
      numbers.push({ number: item.number, title: item.title || '' });
    }

    if (items.length < 100 || numbers.length >= data.total_count) break;
    page++;
  }

  return numbers;
}

async function fetchPrComments(client, owner, repo, prNumber) {
  const comments = [];
  let page = 1;
  const perPage = 100;

  for (;;) {
    const url =
      `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/comments` +
      `?per_page=${perPage}&page=${page}`;

    const data = await client.request(url);
    comments.push(...data);

    if (data.length < perPage) break;
    page++;
  }

  return comments;
}

// ─── Markdown 生成 ──────────────────────────────────────────

function escapeTableCell(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

function buildPrBlock(owner, repo, pr, comments) {
  if (comments.length === 0) return null;

  const lines = [
    '',
    `## PR #${pr.number} - ${escapeTableCell(pr.title)}`,
    '',
    `- 链接：https://github.com/${owner}/${repo}/pull/${pr.number}`,
    '',
    '| 文件 | 评论者 | 评论正文 |',
    '|------|--------|----------|',
  ];

  for (const c of comments) {
    const path = c.path ? `\`${c.path}\`` : '-';
    const user = c.user?.login ?? '-';
    const body = escapeTableCell(c.body ?? '');
    lines.push(`| ${path} | ${user} | ${body} |`);
  }

  lines.push('');
  return lines.join('\n');
}

function writeHeader(outputPath, owner, repo, since, until, prCount) {
  writeFileSync(
    outputPath,
    `# PR Code Review 评论日志

> 仓库：${owner}/${repo}
> 统计范围：${since} 至 ${until} | 共 ${prCount} 个 PR，仅写入存在 Code Review 评论的 PR

---
`,
    'utf8'
  );
}

function writeFooter(outputPath, writtenCount, failed) {
  if (failed.length > 0) {
    appendFileSync(
      outputPath,
      `\n---\n\n## 拉取失败的 PR\n\n${failed.map((n) => `- #${n}`).join('\n')}\n`,
      'utf8'
    );
  }
  appendFileSync(outputPath, `\n---\n\n以上共 ${writtenCount} 个 PR 存在 Code Review 评论。\n`, 'utf8');
}

// ─── 主流程 ─────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const owner = args.owner;
  const repo = args.repo;
  if (!owner || !repo) {
    console.error('❌ 缺少必填参数 --owner 和 --repo。使用 --help 查看用法。');
    process.exit(1);
  }

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    console.error('❌ 缺少环境变量 GITHUB_TOKEN 或 GH_TOKEN。');
    process.exit(1);
  }

  const since = args.since || getDefaultSince();
  const until = args.until || getToday();
  const delayMs = Number(args.delay) || 250;
  const outputPath = resolve(args.output || 'review-log.md');
  const dateRange = `${since}..${until}`;

  const client = createGitHubClient(token, delayMs);

  console.log(`📦 仓库：${owner}/${repo}`);
  console.log(`📅 日期范围：${since} ~ ${until}`);
  console.log(`📄 输出文件：${outputPath}`);
  console.log('');
  console.log('正在拉取 PR 列表...');

  const prs = await fetchAllPrNumbers(client, owner, repo, dateRange);
  console.log(`找到 ${prs.length} 个 PR，开始拉取评论...\n`);

  writeHeader(outputPath, owner, repo, since, until, prs.length);

  const failed = [];
  let writtenCount = 0;

  for (let i = 0; i < prs.length; i++) {
    const pr = prs[i];
    try {
      const comments = await fetchPrComments(client, owner, repo, pr.number);
      const block = buildPrBlock(owner, repo, pr, comments);
      if (block) {
        appendFileSync(outputPath, block, 'utf8');
        writtenCount++;
      }
      if ((i + 1) % 50 === 0) {
        console.log(`进度：${i + 1} / ${prs.length}（已写入 ${writtenCount} 个含评论的 PR）`);
      }
    } catch (err) {
      console.error(`PR #${pr.number} 拉取失败：${err.message}`);
      failed.push(pr.number);
    }
  }

  writeFooter(outputPath, writtenCount, failed);

  console.log('');
  if (failed.length > 0) console.log(`⚠️  失败的 PR：${failed.join(', ')}`);
  console.log(`✅ 完成。共 ${writtenCount} 个 PR 含 Review 评论，已写入 ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
