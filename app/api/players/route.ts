import { NextRequest, NextResponse } from "next/server";

type League = "nba" | "nfl";

type PlayerSearchResult = {
  id: string;
  name: string;
  team?: string;
  league: League;
};

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

const nbaFallbackPlayers: PlayerSearchResult[] = [
  { id: "2544", name: "LeBron James", team: "LAL", league: "nba" },
  { id: "201939", name: "Stephen Curry", team: "GSW", league: "nba" },
  { id: "1628369", name: "Jayson Tatum", team: "BOS", league: "nba" },
  { id: "203507", name: "Giannis Antetokounmpo", team: "MIL", league: "nba" },
  { id: "1629029", name: "Luka Doncic", team: "DAL", league: "nba" },
  { id: "202681", name: "Kyrie Irving", team: "DAL", league: "nba" },
  { id: "203954", name: "Joel Embiid", team: "PHI", league: "nba" },
  { id: "1628983", name: "Shai Gilgeous-Alexander", team: "OKC", league: "nba" },
];

const nflFallbackPlayers: PlayerSearchResult[] = [
  { id: "15860", name: "Patrick Mahomes", team: "KC", league: "nfl" },
  { id: "3918298", name: "Josh Allen", team: "BUF", league: "nfl" },
  { id: "4047156", name: "Jalen Hurts", team: "PHI", league: "nfl" },
  { id: "3929630", name: "Lamar Jackson", team: "BAL", league: "nfl" },
  { id: "4036134", name: "Joe Burrow", team: "CIN", league: "nfl" },
  { id: "4240564", name: "Dak Prescott", team: "DAL", league: "nfl" },
  { id: "4230540", name: "Justin Herbert", team: "LAC", league: "nfl" },
  { id: "4259547", name: "Tua Tagovailoa", team: "MIA", league: "nfl" },
];

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      ...DEFAULT_HEADERS,
      ...(init?.headers || {}),
    },
  });

  if (!res.ok) {
    throw new Error(`Fetch failed (${res.status}) for ${url}`);
  }

  return res.json();
}

function filterFallbackPlayers(league: League, q: string) {
  const source = league === "nba" ? nbaFallbackPlayers : nflFallbackPlayers;
  const query = q.toLowerCase();

  return source.filter(
    (p) =>
      p.name.toLowerCase().includes(query) ||
      p.team?.toLowerCase().includes(query) ||
      String(p.id).includes(query)
  );
}

async function searchNBAPlayers(q: string): Promise<PlayerSearchResult[]> {
  try {
    const raw = await fetchJson(NBA_ALL_PLAYERS_URL, { headers: NBA_STATS_HEADERS });
    const rs = raw?.resultSets?.[0];
    const headers: string[] = rs?.headers || [];
    const rows: any[][] = rs?.rowSet || [];

    const idIdx = headers.indexOf("PERSON_ID");
    const nameIdx = headers.indexOf("DISPLAY_FIRST_LAST");
    const teamIdx = headers.indexOf("TEAM_ABBREVIATION");

    if (idIdx === -1 || nameIdx === -1) return [];

    const query = q.toLowerCase();

    return rows
      .map((row) => ({
        id: String(row[idIdx] || ""),
        name: String(row[nameIdx] || ""),
        team: String(row[teamIdx] || ""),
        league: "nba" as League,
      }))
      .filter((p) => p.name.toLowerCase().includes(query) || p.id.includes(query) || p.team?.toLowerCase().includes(query))
      .slice(0, 15);
  } catch {
    return [];
  }
}

async function searchNFLPlayers(q: string): Promise<PlayerSearchResult[]> {
  try {
    const raw = await fetchJson(ESPN_SEARCH_URL(q));
    const items = raw?.items || [];

    return items
      .map((item: any) => ({
        id: String(item?.id || ""),
        name: String(item?.displayName || item?.name || ""),
        team: String(item?.subtitle || item?.description || ""),
        league: "nfl" as League,
      }))
      .filter(
        (p: PlayerSearchResult) =>
          p.name &&
          (p.name.toLowerCase().includes(q.toLowerCase()) ||
            p.team?.toLowerCase().includes(q.toLowerCase()) ||
            p.id.includes(q))
      )
      .slice(0, 15);
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const league = (searchParams.get("league") || "nba") as League;
    const q = (searchParams.get("q") || "").trim();

    if (!["nba", "nfl"].includes(league)) {
      return NextResponse.json({ error: "league must be nba or nfl" }, { status: 400 });
    }

    if (q.length < 2) {
      return NextResponse.json({ league, query: q, results: [], generatedAt: new Date().toISOString() });
    }

    const liveResults =
      league === "nba" ? await searchNBAPlayers(q) : await searchNFLPlayers(q);

    const fallbackResults = filterFallbackPlayers(league, q);

// merge both
const combined = [...liveResults, ...fallbackResults];

// remove duplicates by id
const unique = Array.from(
  new Map(combined.map((p) => [p.id, p])).values()
);

// limit results
const results = unique.slice(0, 15);

    return NextResponse.json({
      league,
      query: q,
      results,
      generatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to search players" },
      { status: 500 }
    );
  }
}