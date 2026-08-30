import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const username = process.env.GITHUB_USER ?? process.env.GITHUB_REPOSITORY_OWNER ?? "chiimagnus";
const outputPath = process.env.ACTIVITY_GRAPH_OUTPUT ?? "assets/activity-graph.svg";

function authToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
}

async function loadDays(login) {
  const to = new Date();
  to.setUTCHours(23, 59, 59, 999);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 29);
  from.setUTCHours(0, 0, 0, 0);

  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      authorization: `Bearer ${authToken()}`,
      "content-type": "application/json",
      "user-agent": "activity-graph-script",
    },
    body: JSON.stringify({
      query: `query($login: String!, $from: DateTime!, $to: DateTime!) {
        user(login: $login) {
          contributionsCollection(from: $from, to: $to) {
            contributionCalendar {
              weeks {
                contributionDays {
                  date
                  contributionCount
                }
              }
            }
          }
        }
      }`,
      variables: {
        login,
        from: from.toISOString(),
        to: to.toISOString(),
      },
    }),
  });

  if (!response.ok) throw new Error(`GitHub GraphQL failed: ${response.status}`);
  const body = await response.json();
  if (body.errors?.length) throw new Error(body.errors.map((error) => error.message).join("; "));

  const contributionDays = body.data.user.contributionsCollection.contributionCalendar.weeks
    .flatMap((week) => week.contributionDays);
  const byDate = new Map(contributionDays.map((day) => [day.date, day.contributionCount]));

  return Array.from({ length: 30 }, (_, index) => {
    const date = new Date(from);
    date.setUTCDate(from.getUTCDate() + index);
    const key = date.toISOString().slice(0, 10);
    return { date: key, count: byDate.get(key) ?? 0 };
  });
}

function smoothPath(points) {
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const p1 = points[index];
    const p2 = points[index + 1];
    const control = (p2.x - p1.x) * 0.38;
    d += ` C ${(p1.x + control).toFixed(1)} ${p1.y.toFixed(1)}, ${(p2.x - control).toFixed(1)} ${p2.y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

function renderSvg(days, login) {
  const width = 1000;
  const height = 280;
  const margin = { top: 74, right: 34, bottom: 40, left: 50 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const maxCount = Math.max(...days.map((day) => day.count), 1);
  const scaleMax = Math.max(4, Math.ceil(maxCount / 4) * 4);
  const total = days.reduce((sum, day) => sum + day.count, 0);
  const activeDays = days.filter((day) => day.count > 0).length;

  const x = (index) => margin.left + (chartWidth * index) / (days.length - 1);
  const y = (count) => margin.top + chartHeight - (count / scaleMax) * chartHeight;
  const points = days.map((day, index) => ({ x: x(index), y: y(day.count) }));
  const linePath = smoothPath(points);
  const baseline = margin.top + chartHeight;
  const areaPath = `${linePath} L ${points.at(-1).x.toFixed(1)} ${baseline} L ${points[0].x.toFixed(1)} ${baseline} Z`;

  const grid = Array.from({ length: 4 }, (_, index) => {
    const value = (scaleMax / 3) * index;
    const lineY = y(value);
    return `
      <line x1="${margin.left}" y1="${lineY}" x2="${width - margin.right}" y2="${lineY}" stroke="#21262d" stroke-width="1" />
      <text x="${margin.left - 12}" y="${lineY + 4}" text-anchor="end" fill="#6e7681" font-size="10.5">${Math.round(value)}</text>`;
  }).join("");

  const labels = days.map((day, index) => {
    if (index % 5 !== 0 && index !== days.length - 1) return "";
    const label = day.date.slice(5).replace("-", "/");
    return `<text x="${x(index).toFixed(1)}" y="${height - 16}" text-anchor="middle" fill="#8b949e" font-size="11">${label}</text>`;
  }).join("");

  const lastPoint = points.at(-1);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 ${width} ${height}" role="img" aria-label="${login}'s GitHub activity over the last 30 days">
    <defs>
      <linearGradient id="activity-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#58a6ff" stop-opacity="0.22" />
        <stop offset="72%" stop-color="#58a6ff" stop-opacity="0.04" />
        <stop offset="100%" stop-color="#58a6ff" stop-opacity="0" />
      </linearGradient>
    </defs>
    <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="14" fill="#0d1117" stroke="#21262d" />
    <text x="${margin.left}" y="31" fill="#f0f6fc" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif" font-size="19" font-weight="600">GitHub Activity · Last 30 Days</text>
    <text x="${margin.left}" y="52" fill="#7d8590" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif" font-size="11.5">${total} contributions · ${activeDays} active days · peak ${maxCount}</text>
    <g font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif">
      ${grid}
      <path d="${areaPath}" fill="url(#activity-fill)" />
      <path d="${linePath}" fill="none" stroke="#58a6ff" stroke-opacity="0.14" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" />
      <path id="activity-line" d="${linePath}" fill="none" stroke="#58a6ff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
      <circle cx="${lastPoint.x.toFixed(1)}" cy="${lastPoint.y.toFixed(1)}" r="5" fill="#0d1117" stroke="#58a6ff" stroke-width="2.5" />
      <circle cx="${lastPoint.x.toFixed(1)}" cy="${lastPoint.y.toFixed(1)}" r="1.8" fill="#f0f6fc" />
      ${labels}
    </g>
  </svg>`;
}

const days = await loadDays(username);
const svg = renderSvg(days, username);
if (!svg.includes('id="activity-line"') || days.length !== 30 || /<rect[^>]+fill="#39d353"/.test(svg)) {
  throw new Error("Activity graph self-check failed");
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, svg);
console.log(`Wrote ${outputPath}`);
