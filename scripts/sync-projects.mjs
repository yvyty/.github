#!/usr/bin/env node
/**
 * Regenerates the project showcase inside profile/README.md from the yvyty
 * organization's public repositories.
 *
 * Run by .github/workflows/sync-profile.yml on a schedule, on manual dispatch,
 * and whenever profile/README.md or this script changes. It can also be run
 * locally: `node scripts/sync-projects.mjs`.
 *
 * The script only ever rewrites the text between the PROJECTS markers, so the
 * rest of the profile README is safe to edit by hand. If the GitHub API is
 * unreachable it warns and leaves the existing block untouched (exit 0), the
 * same fail-open behavior as the landing page sync.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ORG = "yvyty";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const README = path.join(ROOT, "profile", "README.md");

const START_MARKER = "<!-- PROJECTS:START -->";
const END_MARKER = "<!-- PROJECTS:END -->";

/** Org meta-repos that are not products and must never be shown. */
const EXCLUDED = new Set([".github", `${ORG}.github.io`]);

/**
 * Repos the public API cannot see, usually because they are private. A manual
 * entry is skipped automatically once the repo becomes public, so the API copy
 * (with a working link) takes over. Set `url` to null to render the card as
 * unlinked with a "Private" note.
 *
 * Shape: { name, title, emoji, description, language, license, url, isPrivate }.
 * Empty while every product repo is public.
 */
const MANUAL_PROJECTS = [];

/** Display order for repos we want first; everything else is appended. */
const PINNED_ORDER = ["anthill", "guara"];

/** Emoji fallback per repo when neither the title nor the description has one. */
const EMOJI = { anthill: "🐜", guara: "🐺" };

/** Display titles that a title-cased repo name cannot produce (e.g. accents). */
const TITLES = { guara: "Guará" };
const DEFAULT_EMOJI = "🧩";

const EMOJI_PATTERN =
  /^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|\p{Emoji_Modifier})*)\s*/u;

function splitLeadingEmoji(text) {
  const match = text.match(EMOJI_PATTERN);
  if (!match) return { emoji: null, text };
  return { emoji: match[1], text: text.slice(match[0].length) };
}

function titleCase(name) {
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function sanitize(text) {
  return String(text).replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
}

function truncate(text, max = 180) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function toProject(repo) {
  const { emoji, text } = splitLeadingEmoji(repo.description ?? "");
  return {
    name: repo.name,
    title: TITLES[repo.name] ?? titleCase(repo.name),
    emoji: emoji ?? EMOJI[repo.name] ?? DEFAULT_EMOJI,
    description: text || "No description yet.",
    language: repo.language ?? null,
    license: repo.license?.spdx_id ?? null,
    url: repo.html_url ?? null,
    stars: repo.stargazers_count ?? 0,
    pushedAt: repo.pushed_at ?? null,
    isPrivate: false,
  };
}

function starsBadge(project) {
  if (project.isPrivate || !project.url) return "n/a";
  const owner = project.url.replace("https://github.com/", "");
  const badge = `https://img.shields.io/github/stars/${owner}?style=flat-square&color=6f42c1&label=%E2%AD%90`;
  return `[![stars](<${badge}>)](<${project.url}/stargazers>)`;
}

function stackLabel(project) {
  const parts = [];
  if (project.language) parts.push(`\`${project.language}\``);
  if (project.license) parts.push(project.license);
  return parts.length > 0 ? parts.join(" · ") : "n/a";
}

/** Renders the complete block that lives between the PROJECTS markers. */
export function renderProjects(projects) {
  const lines = [
    START_MARKER,
    `_Synced automatically from our public repositories. Showing **${projects.length}** project${
      projects.length === 1 ? "" : "s"
    }._`,
    "",
    "| Project | About | Stack | Stars |",
    "| :--- | :--- | :--- | :--- |",
  ];

  for (const project of projects) {
    const name = [project.emoji, project.title].filter(Boolean).join(" ");
    const label = project.url
      ? `[**${name}**](<${project.url}>)`
      : `**${name}**${project.isPrivate ? " · 🔒" : ""}`;
    lines.push(
      `| ${label} | ${truncate(sanitize(project.description))} | ${stackLabel(
        project
      )} | ${starsBadge(project)} |`
    );
  }

  lines.push(END_MARKER);
  return lines.join("\n");
}

function orderProjects(projects) {
  const rank = (name) => {
    const index = PINNED_ORDER.indexOf(name);
    return index === -1 ? PINNED_ORDER.length : index;
  };

  return [...projects].sort((a, b) => {
    const byPin = rank(a.name) - rank(b.name);
    if (byPin !== 0) return byPin;
    if (b.stars !== a.stars) return b.stars - a.stars;
    return a.name.localeCompare(b.name);
  });
}

export function injectProjects(readme, block) {
  const start = readme.indexOf(START_MARKER);
  const end = readme.indexOf(END_MARKER);

  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `profile/README.md must contain ${START_MARKER} and ${END_MARKER}`
    );
  }

  const before = readme.slice(0, start);
  const after = readme.slice(end + END_MARKER.length);
  return `${before}${block}${after}`;
}

async function fetchRepos(token) {
  const repos = [];

  // Paginate: the org could exceed 100 public repos.
  for (let page = 1; page <= 10; page += 1) {
    const url = `https://api.github.com/orgs/${ORG}/repos?type=public&per_page=100&page=${page}&sort=pushed`;
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": `${ORG}-profile-project-sync`,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText} for ${url}`);
    }

    const batch = await response.json();
    if (!Array.isArray(batch) || batch.length === 0) break;

    repos.push(...batch);
    if (batch.length < 100) break;
  }

  return repos.filter(
    (repo) =>
      !repo.fork &&
      !repo.archived &&
      !repo.disabled &&
      repo.visibility !== "private" &&
      !EXCLUDED.has(repo.name)
  );
}

async function main() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const readme = await readFile(README, "utf8");

  let publicProjects;
  try {
    publicProjects = await fetchRepos(token);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[profile] GitHub API request failed: ${message}`);
    console.warn("[profile] Keeping the committed project showcase.");
    return;
  }

  const publicNames = new Set(publicProjects.map((repo) => repo.name));
  const projects = publicProjects.map(toProject);

  for (const manual of MANUAL_PROJECTS) {
    if (publicNames.has(manual.name)) {
      console.log(
        `[profile] ${manual.name} is public now; dropping its manual entry.`
      );
      continue;
    }
    projects.push(manual);
  }

  const ordered = orderProjects(projects);
  const updated = injectProjects(readme, renderProjects(ordered));

  if (updated === readme) {
    console.log("[profile] README is already up to date.");
    return;
  }

  await writeFile(README, updated, "utf8");
  console.log(
    `[profile] Synced ${ordered.length} project(s): ${ordered
      .map((project) => project.name)
      .join(", ")}`
  );
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  await main();
}