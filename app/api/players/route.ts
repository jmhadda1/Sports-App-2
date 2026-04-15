import { NextRequest, NextResponse } from "next/server";

type League = "nba" | "nfl";

const DEFAULT_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "User-Agent": "Mozilla/5.0",
};

const NBA_STATS_HEADERS = {
  ...DEFAULT_HEADERS,
  Referer: "https://www.nba.com/",
  Origin: "https://www.nba.com",
};

const NBA_ALL_PLAYERS_URL =
  "https://stats.nba.com/stats/commonallplayers?IsOnlyCurrentSeason=1&LeagueID=00&Season=2025-26";

const ESPN_SEARCH_URL = (query: string) =>
  `https://site.web.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(query)}`;

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      ...DEFAULT_HEADERS,
      ...(init?.headers || {}),
    },
  });

  if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${url}`);
  return res.json();
}

async function searchNBAPlayers(query: string) {
  const raw = await fetchJson(NBA_ALL_PLAYERS_URL, { headers: NBA_STATS_HEADERS });
  const rs = raw?.resultSets?.[0];
  const headers: string[] = rs?.headers || [];
  const rows: any[][] = rs?.rowSet || [];

  const idx = (name: string) => headers.indexOf(name);
  const idIdx = idx("PERSON_ID");
  const nameIdx = idx("DISPLAY_FIRST_LAST");
  const teamIdx = idx("TEAM_ABBREVIATION");
  const activeIdx = idx("ROSTERSTATUS");

  const q = query.toLowerCase();

  return rows
    .filter((row) => String(row[nameIdx] || "").toLowerCase().includes(q))
    .sort((a, b) => {
      const aName = String(a[nameIdx] || "").toLowerCase();
      const bName = String(b[nameIdx] || "").toLowerCase();
      const aScore = (aName === q ? 100 : aName.startsWith(q) ? 50 : 0) + (Number(a[activeIdx] || 0) ? 10 : 0);
      const bScore = (bName === q ? 100 : bName.startsWith(q) ? 50 : 0) + (Number(b[activeIdx] || 0) ? 10 : 0);
      return bScore - aScore;
    })
    .slice(0, 12)
    .map((row) => ({
      id: String(row[idIdx]),
      name: String(row[nameIdx] || ""),
      team: String(row[teamIdx] || ""),
      league: "nba",
    }));
}

async function searchNFLPlayers(query: string) {
  const raw = await fetchJson(ESPN_SEARCH_URL(query));
  const items = raw?.items || [];

  return items
    .filter((item: any) => {
      const name = String(item?.displayName || item?.name || "").toLowerCase();
      const type = String(item?.type || item?.typeName || "").toLowerCase();
      return name.includes(query.toLowerCase()) && (type.includes("athlete") || type.includes("player") || !type);
    })
    .slice(0, 12)
    .map((item: any) => ({
      id: String(item?.id || ""),
      name: String(item?.displayName || item?.name || ""),
      team: String(item?.subtitle || item?.description || ""),
      league: "nfl",
    }))
    .filter((x: any) => x.id && x.name);
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const league = (searchParams.get("league") || "nba") as League;
    const q = (searchParams.get("q") || "").trim();

    if (!q || q.length < 2) {
      return NextResponse.json({ league, results: [] });
    }

    const results = league === "nba" ? await searchNBAPlayers(q) : await searchNFLPlayers(q);

    return NextResponse.json({
      league,
      query: q,
      results,
      generatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to search players" }, { status: 500 });
  }
}