import { NextRequest, NextResponse } from "next/server";

type League = "nba" | "nfl";
type QueryType = "games" | "boxscore" | "playerlog" | "bundle" | "bestbets";

type GameCard = {
  id: string;
  league: League;
  date: string;
  status: string;
  period?: number;
  clock?: string;
  home: { team: string; abbr: string; score: number };
  away: { team: string; abbr: string; score: number };
  leaders: string[];
};

type WinPrediction = {
  favoredTeam: string;
  favoredAbbr: string;
  winProbability: number;
  confidence: "low" | "medium" | "high";
  fairAmericanOdds: number;
  explanation: string;
  drivers: string[];
};

type PlayerPrediction = {
  player: string;
  league: League;
  confidence: "low" | "medium" | "high";
  explanation: string;
  stats: Record<string, number>;
  ranges: Record<string, [number, number]>;
  features: Record<string, number | string>;
  drivers: string[];
};

type EdgeBet = {
  type: "game" | "prop";
  league: League;
  eventId: string;
  eventLabel: string;
  market: string;
  selection: string;
  line?: number | null;
  sportsbook: string;
  oddsAmerican: number;
  marketImpliedProb: number;
  modelProb: number;
  edgePct: number;
  confidence: "low" | "medium" | "high";
  fairAmericanOdds: number;
  explanation: string;
  drivers: string[];
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

const NBA_SCOREBOARD_URL =
  "https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json";
const NBA_BOXSCORE_URL = (gameId: string) =>
  `https://cdn.nba.com/static/json/liveData/boxscore/boxscore_${gameId}.json`;
const NBA_ALL_PLAYERS_URL =
  "https://stats.nba.com/stats/commonallplayers?IsOnlyCurrentSeason=1&LeagueID=00&Season=2025-26";
const NBA_PLAYER_GAMELOG_URL = (playerId: string, season: string) =>
  `https://stats.nba.com/stats/playergamelog?DateFrom=&DateTo=&LeagueID=00&PlayerID=${encodeURIComponent(
    playerId
  )}&Season=${encodeURIComponent(season)}&SeasonType=Regular%20Season`;

const ESPN_SCOREBOARD_URL = (league: League, date: string) =>
  `https://site.api.espn.com/apis/site/v2/sports/${league === "nba" ? "basketball/nba" : "football/nfl"}/scoreboard?dates=${date}`;
const ESPN_SUMMARY_URL = (league: League, eventId: string) =>
  `https://site.web.api.espn.com/apis/site/v2/sports/${league === "nba" ? "basketball/nba" : "football/nfl"}/summary?event=${eventId}&region=us&lang=en&contentorigin=espn`;
const ESPN_SEARCH_URL = (query: string) =>
  `https://site.web.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(query)}`;
const ESPN_ATHLETE_GAMELOG_URL = (league: League, athleteId: string) =>
  `https://site.web.api.espn.com/apis/common/v3/sports/${league === "nba" ? "basketball/nba" : "football/nfl"}/athletes/${athleteId}/gamelog`;

const ODDS_BASE = process.env.ODDS_API_BASE || process.env.THE_ODDS_API_BASE || "https://api.the-odds-api.com/v4";
const ODDS_KEY = process.env.ODDS_API_KEY || process.env.THE_ODDS_API_KEY || "";

const SPORT_KEY: Record<League, string> = {
  nba: "basketball_nba",
  nfl: "americanfootball_nfl",
};

const fallbackPlayerLogs = {
  nba: {
    "LeBron James": [
      { date: "Mar 24", opponent: "GSW", result: "W", pts: 31, reb: 8, ast: 9, min: 36, player: "LeBron James", team: "LAL" },
      { date: "Mar 22", opponent: "PHX", result: "L", pts: 26, reb: 6, ast: 7, min: 35, player: "LeBron James", team: "LAL" },
      { date: "Mar 20", opponent: "SAC", result: "W", pts: 28, reb: 7, ast: 8, min: 37, player: "LeBron James", team: "LAL" },
      { date: "Mar 18", opponent: "DEN", result: "L", pts: 24, reb: 9, ast: 6, min: 34, player: "LeBron James", team: "LAL" },
      { date: "Mar 16", opponent: "DAL", result: "W", pts: 30, reb: 7, ast: 10, min: 38, player: "LeBron James", team: "LAL" },
    ],
    "Stephen Curry": [
      { date: "Mar 24", opponent: "LAL", result: "L", pts: 28, reb: 4, ast: 7, min: 37, player: "Stephen Curry", team: "GSW" },
      { date: "Mar 22", opponent: "DEN", result: "W", pts: 30, reb: 5, ast: 6, min: 35, player: "Stephen Curry", team: "GSW" },
      { date: "Mar 20", opponent: "DAL", result: "W", pts: 33, reb: 4, ast: 8, min: 36, player: "Stephen Curry", team: "GSW" },
      { date: "Mar 18", opponent: "SAC", result: "L", pts: 25, reb: 3, ast: 5, min: 34, player: "Stephen Curry", team: "GSW" },
      { date: "Mar 16", opponent: "PHX", result: "W", pts: 31, reb: 6, ast: 7, min: 36, player: "Stephen Curry", team: "GSW" },
    ],
    "Jayson Tatum": [
      { date: "Mar 25", opponent: "MIL", result: "W", pts: 34, reb: 9, ast: 5, min: 38, player: "Jayson Tatum", team: "BOS" },
      { date: "Mar 23", opponent: "MIA", result: "W", pts: 27, reb: 7, ast: 6, min: 35, player: "Jayson Tatum", team: "BOS" },
      { date: "Mar 21", opponent: "NYK", result: "L", pts: 29, reb: 8, ast: 4, min: 37, player: "Jayson Tatum", team: "BOS" },
      { date: "Mar 19", opponent: "CHI", result: "W", pts: 32, reb: 6, ast: 5, min: 36, player: "Jayson Tatum", team: "BOS" },
      { date: "Mar 17", opponent: "CLE", result: "W", pts: 26, reb: 10, ast: 4, min: 35, player: "Jayson Tatum", team: "BOS" },
    ],
    "Giannis Antetokounmpo": [
      { date: "Mar 25", opponent: "BOS", result: "L", pts: 29, reb: 12, ast: 6, min: 37, player: "Giannis Antetokounmpo", team: "MIL" },
      { date: "Mar 23", opponent: "IND", result: "W", pts: 33, reb: 11, ast: 7, min: 36, player: "Giannis Antetokounmpo", team: "MIL" },
      { date: "Mar 21", opponent: "ORL", result: "W", pts: 30, reb: 13, ast: 5, min: 35, player: "Giannis Antetokounmpo", team: "MIL" },
      { date: "Mar 19", opponent: "NYK", result: "L", pts: 27, reb: 10, ast: 8, min: 36, player: "Giannis Antetokounmpo", team: "MIL" },
      { date: "Mar 17", opponent: "BKN", result: "W", pts: 35, reb: 9, ast: 6, min: 34, player: "Giannis Antetokounmpo", team: "MIL" },
    ],
  },
  nfl: {
    "Patrick Mahomes": [
      { date: "Dec 15", opponent: "BUF", result: "W", passYds: 311, rushYds: 24, recYds: 0, td: 3, int: 1, player: "Patrick Mahomes", team: "KC" },
      { date: "Dec 08", opponent: "LV", result: "W", passYds: 285, rushYds: 18, recYds: 0, td: 2, int: 0, player: "Patrick Mahomes", team: "KC" },
      { date: "Dec 01", opponent: "DEN", result: "L", passYds: 244, rushYds: 33, recYds: 0, td: 1, int: 2, player: "Patrick Mahomes", team: "KC" },
      { date: "Nov 24", opponent: "LAC", result: "W", passYds: 298, rushYds: 21, recYds: 0, td: 2, int: 1, player: "Patrick Mahomes", team: "KC" },
      { date: "Nov 17", opponent: "MIA", result: "W", passYds: 274, rushYds: 15, recYds: 0, td: 3, int: 0, player: "Patrick Mahomes", team: "KC" },
    ],
    "Josh Allen": [
      { date: "Dec 15", opponent: "KC", result: "L", passYds: 278, rushYds: 42, recYds: 0, td: 2, int: 1, player: "Josh Allen", team: "BUF" },
      { date: "Dec 08", opponent: "MIA", result: "W", passYds: 301, rushYds: 35, recYds: 0, td: 3, int: 0, player: "Josh Allen", team: "BUF" },
      { date: "Dec 01", opponent: "NYJ", result: "W", passYds: 256, rushYds: 27, recYds: 0, td: 2, int: 1, player: "Josh Allen", team: "BUF" },
      { date: "Nov 24", opponent: "NE", result: "W", passYds: 289, rushYds: 31, recYds: 0, td: 3, int: 0, player: "Josh Allen", team: "BUF" },
      { date: "Nov 17", opponent: "CIN", result: "L", passYds: 247, rushYds: 40, recYds: 0, td: 2, int: 1, player: "Josh Allen", team: "BUF" },
    ],
    "Jalen Hurts": [
      { date: "Dec 18", opponent: "DAL", result: "W", passYds: 246, rushYds: 51, recYds: 0, td: 3, int: 0, player: "Jalen Hurts", team: "PHI" },
      { date: "Dec 11", opponent: "NYG", result: "W", passYds: 218, rushYds: 44, recYds: 0, td: 2, int: 1, player: "Jalen Hurts", team: "PHI" },
      { date: "Dec 04", opponent: "WAS", result: "W", passYds: 231, rushYds: 39, recYds: 0, td: 2, int: 0, player: "Jalen Hurts", team: "PHI" },
      { date: "Nov 27", opponent: "SEA", result: "L", passYds: 205, rushYds: 47, recYds: 0, td: 1, int: 1, player: "Jalen Hurts", team: "PHI" },
      { date: "Nov 20", opponent: "DAL", result: "W", passYds: 263, rushYds: 36, recYds: 0, td: 3, int: 0, player: "Jalen Hurts", team: "PHI" },
    ],
  },
} as const;

const teamContext = {
  nba: {
    LAL: { pace: 1.02, defenseRank: 18, ptsAllowedToPG: 24.2, ptsAllowedToSG: 23.9, ptsAllowedToSF: 22.8, ptsAllowedToPF: 21.4, ptsAllowedToC: 24.6 },
    GSW: { pace: 1.04, defenseRank: 16, ptsAllowedToPG: 25.5, ptsAllowedToSG: 24.1, ptsAllowedToSF: 22.2, ptsAllowedToPF: 21.1, ptsAllowedToC: 23.8 },
    BOS: { pace: 1.01, defenseRank: 4, ptsAllowedToPG: 21.0, ptsAllowedToSG: 20.4, ptsAllowedToSF: 19.8, ptsAllowedToPF: 19.6, ptsAllowedToC: 21.7 },
    MIL: { pace: 1.03, defenseRank: 12, ptsAllowedToPG: 23.6, ptsAllowedToSG: 22.8, ptsAllowedToSF: 22.0, ptsAllowedToPF: 21.2, ptsAllowedToC: 23.4 },
    PHX: { pace: 1.00, defenseRank: 15, ptsAllowedToPG: 24.3, ptsAllowedToSG: 23.1, ptsAllowedToSF: 22.5, ptsAllowedToPF: 21.9, ptsAllowedToC: 23.1 },
    SAC: { pace: 1.03, defenseRank: 20, ptsAllowedToPG: 25.2, ptsAllowedToSG: 24.5, ptsAllowedToSF: 23.0, ptsAllowedToPF: 22.2, ptsAllowedToC: 24.2 },
    DEN: { pace: 0.99, defenseRank: 8, ptsAllowedToPG: 22.5, ptsAllowedToSG: 21.8, ptsAllowedToSF: 21.1, ptsAllowedToPF: 20.7, ptsAllowedToC: 22.1 },
    NYK: { pace: 0.97, defenseRank: 7, ptsAllowedToPG: 22.0, ptsAllowedToSG: 21.7, ptsAllowedToSF: 21.2, ptsAllowedToPF: 20.8, ptsAllowedToC: 22.7 },
    MIA: { pace: 0.96, defenseRank: 10, ptsAllowedToPG: 22.4, ptsAllowedToSG: 22.1, ptsAllowedToSF: 21.9, ptsAllowedToPF: 21.0, ptsAllowedToC: 22.5 },
    ORL: { pace: 0.98, defenseRank: 6, ptsAllowedToPG: 21.7, ptsAllowedToSG: 21.5, ptsAllowedToSF: 20.8, ptsAllowedToPF: 20.5, ptsAllowedToC: 21.6 },
    IND: { pace: 1.06, defenseRank: 22, ptsAllowedToPG: 25.9, ptsAllowedToSG: 24.7, ptsAllowedToSF: 23.5, ptsAllowedToPF: 22.8, ptsAllowedToC: 24.8 },
    DAL: { pace: 1.00, defenseRank: 14, ptsAllowedToPG: 23.8, ptsAllowedToSG: 23.4, ptsAllowedToSF: 22.1, ptsAllowedToPF: 21.7, ptsAllowedToC: 22.9 },
    CHI: { pace: 1.01, defenseRank: 17, ptsAllowedToPG: 24.0, ptsAllowedToSG: 23.6, ptsAllowedToSF: 22.7, ptsAllowedToPF: 21.8, ptsAllowedToC: 23.0 },
    CLE: { pace: 0.98, defenseRank: 5, ptsAllowedToPG: 21.3, ptsAllowedToSG: 20.9, ptsAllowedToSF: 20.5, ptsAllowedToPF: 20.2, ptsAllowedToC: 21.1 },
    BKN: { pace: 0.99, defenseRank: 19, ptsAllowedToPG: 24.8, ptsAllowedToSG: 23.9, ptsAllowedToSF: 22.9, ptsAllowedToPF: 22.0, ptsAllowedToC: 23.6 },
  },
  nfl: {
    KC: { pace: 1.01, defenseRankPass: 11, defenseRankRush: 9, passYdsAllowed: 221, rushYdsAllowed: 102 },
    BUF: { pace: 1.02, defenseRankPass: 8, defenseRankRush: 15, passYdsAllowed: 214, rushYdsAllowed: 112 },
    PHI: { pace: 1.00, defenseRankPass: 19, defenseRankRush: 10, passYdsAllowed: 234, rushYdsAllowed: 104 },
    DAL: { pace: 1.01, defenseRankPass: 6, defenseRankRush: 12, passYdsAllowed: 208, rushYdsAllowed: 108 },
    LV: { pace: 0.99, defenseRankPass: 24, defenseRankRush: 22, passYdsAllowed: 247, rushYdsAllowed: 124 },
    DEN: { pace: 0.98, defenseRankPass: 7, defenseRankRush: 13, passYdsAllowed: 210, rushYdsAllowed: 109 },
    NYG: { pace: 0.97, defenseRankPass: 26, defenseRankRush: 25, passYdsAllowed: 252, rushYdsAllowed: 128 },
    WAS: { pace: 1.03, defenseRankPass: 28, defenseRankRush: 23, passYdsAllowed: 257, rushYdsAllowed: 126 },
    MIA: { pace: 1.04, defenseRankPass: 17, defenseRankRush: 19, passYdsAllowed: 229, rushYdsAllowed: 118 },
    NYJ: { pace: 0.98, defenseRankPass: 9, defenseRankRush: 14, passYdsAllowed: 216, rushYdsAllowed: 110 },
    NE: { pace: 0.95, defenseRankPass: 18, defenseRankRush: 18, passYdsAllowed: 230, rushYdsAllowed: 117 },
    CIN: { pace: 1.00, defenseRankPass: 20, defenseRankRush: 17, passYdsAllowed: 236, rushYdsAllowed: 115 },
    LAC: { pace: 1.03, defenseRankPass: 21, defenseRankRush: 20, passYdsAllowed: 239, rushYdsAllowed: 120 },
    SEA: { pace: 1.01, defenseRankPass: 22, defenseRankRush: 21, passYdsAllowed: 242, rushYdsAllowed: 121 },
  },
} as const;

const playerMeta = {
  nba: {
    "LeBron James": { team: "LAL", pos: "SF", usage: 0.31, starterOutBoost: 0.03 },
    "Stephen Curry": { team: "GSW", pos: "PG", usage: 0.33, starterOutBoost: 0.04 },
    "Jayson Tatum": { team: "BOS", pos: "SF", usage: 0.32, starterOutBoost: 0.02 },
    "Giannis Antetokounmpo": { team: "MIL", pos: "PF", usage: 0.36, starterOutBoost: 0.03 },
  },
  nfl: {
    "Patrick Mahomes": { team: "KC", pos: "QB", usage: 0.35, starterOutBoost: 0.02 },
    "Josh Allen": { team: "BUF", pos: "QB", usage: 0.37, starterOutBoost: 0.02 },
    "Jalen Hurts": { team: "PHI", pos: "QB", usage: 0.34, starterOutBoost: 0.02 },
  },
} as const;

function getFallbackLogs(league: League, player: string) {
  const leagueLogs = fallbackPlayerLogs[league] as Record<string, any[]>;
  return leagueLogs[player] || [];
}

function avg(nums: number[]) {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function stddev(nums: number[]) {
  if (nums.length < 2) return 0;
  const m = avg(nums);
  return Math.sqrt(avg(nums.map((n) => (n - m) ** 2)));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function safeNumber(value: any, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function safeString(value: any, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function toDisplayDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function todayYYYYMMDD() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function currentNBASeason() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const startYear = month >= 7 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

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

function normalizeAmericanOddsToProb(odds: number) {
  if (!Number.isFinite(odds)) return 0;
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

function probToAmericanOdds(prob: number) {
  const p = clamp(prob, 0.01, 0.99);
  if (p >= 0.5) return Math.round(-(p / (1 - p)) * 100);
  return Math.round(((1 - p) / p) * 100);
}

function normalCdf(x: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  let prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (x > 0) prob = 1 - prob;
  return prob;
}

function nbaLeaderStrings(game: any): string[] {
  const out: string[] = [];
  const home = game?.gameLeaders?.homeLeaders;
  const away = game?.gameLeaders?.awayLeaders;
  if (home?.name && typeof home?.points === "number") out.push(`${home.name}: ${home.points} PTS`);
  if (away?.name && typeof away?.points === "number") out.push(`${away.name}: ${away.points} PTS`);
  return out.slice(0, 3);
}

async function getNBAGames(): Promise<GameCard[]> {
  const raw = await fetchJson(NBA_SCOREBOARD_URL);
  const games = raw?.scoreboard?.games || [];
  return games.map((g: any) => ({
    id: String(g.gameId),
    league: "nba",
    date: toDisplayDate(g.gameTimeUTC || raw?.scoreboard?.gameDate || ""),
    status: safeString(g.gameStatusText, "Scheduled"),
    period: safeNumber(g.period),
    clock: safeString(g.gameClock, ""),
    home: {
      team: safeString(g.homeTeam?.teamName, "Home"),
      abbr: safeString(g.homeTeam?.teamTricode, "HOME"),
      score: safeNumber(g.homeTeam?.score),
    },
    away: {
      team: safeString(g.awayTeam?.teamName, "Away"),
      abbr: safeString(g.awayTeam?.teamTricode, "AWAY"),
      score: safeNumber(g.awayTeam?.score),
    },
    leaders: nbaLeaderStrings(g),
  }));
}

async function getNBABOX(gameId: string) {
  const raw = await fetchJson(NBA_BOXSCORE_URL(gameId));
  const game = raw?.game || {};
  const teams = [game?.homeTeam, game?.awayTeam].filter(Boolean);
  const rows: any[] = [];
  for (const team of teams) {
    for (const p of team?.players || []) {
      rows.push({
        player: safeString(p?.name, "Unknown Player"),
        team: safeString(team?.teamTricode, "—"),
        mins: safeNumber(p?.statistics?.minutes),
        pts: safeNumber(p?.statistics?.points),
        reb: safeNumber(p?.statistics?.reboundsTotal),
        ast: safeNumber(p?.statistics?.assists),
        fg: `${safeNumber(p?.statistics?.fieldGoalsMade)}-${safeNumber(p?.statistics?.fieldGoalsAttempted)}`,
        plusMinus: String(p?.statistics?.plusMinusPoints ?? "0"),
      });
    }
  }
  return rows.sort((a, b) => b.pts - a.pts);
}

async function findNBAPlayerId(playerName: string): Promise<string | null> {
  const raw = await fetchJson(NBA_ALL_PLAYERS_URL, { headers: NBA_STATS_HEADERS });
  const rs = raw?.resultSets?.[0];
  const headers: string[] = rs?.headers || [];
  const rows: any[][] = rs?.rowSet || [];
  const idIdx = headers.indexOf("PERSON_ID");
  const nameIdx = headers.indexOf("DISPLAY_FIRST_LAST");
  if (idIdx === -1 || nameIdx === -1) return null;
  const exact = rows.find((row) => String(row[nameIdx]).toLowerCase() === playerName.toLowerCase());
  if (exact) return String(exact[idIdx]);
  const partial = rows.find((row) => String(row[nameIdx]).toLowerCase().includes(playerName.toLowerCase()));
  return partial ? String(partial[idIdx]) : null;
}

async function getNBAPlayerLogById(playerId: string, playerName: string) {
  const raw = await fetchJson(NBA_PLAYER_GAMELOG_URL(playerId, currentNBASeason()), { headers: NBA_STATS_HEADERS });
  const rs = raw?.resultSets?.[0];
  const headers: string[] = rs?.headers || [];
  const rows: any[][] = rs?.rowSet || [];
  const idx = (name: string) => headers.indexOf(name);
  return rows.slice(0, 10).map((row) => {
    const matchup = String(row[idx("MATCHUP")] || "");
    const opponent = matchup.split(" ").pop() || "—";
    return {
      date: toDisplayDate(String(row[idx("GAME_DATE")] || "")),
      opponent,
      result: `${row[idx("WL")] || "—"}`,
      pts: safeNumber(row[idx("PTS")]),
      reb: safeNumber(row[idx("REB")]),
      ast: safeNumber(row[idx("AST")]),
      min: safeNumber(row[idx("MIN")]),
      player: playerName,
      team: matchup.slice(0, 3) || "—",
    };
  });
}

async function getNBAPlayerLog(playerName: string) {
  const playerId = await findNBAPlayerId(playerName);
  if (!playerId) return [];
  return getNBAPlayerLogById(playerId, playerName);
}

async function getESPNGames(league: League): Promise<GameCard[]> {
  const raw = await fetchJson(ESPN_SCOREBOARD_URL(league, todayYYYYMMDD()));
  const events = raw?.events || [];
  return events.map((event: any) => {
    const comp = event?.competitions?.[0] || {};
    const comps = comp?.competitors || [];
    const home = comps.find((c: any) => c.homeAway === "home") || {};
    const away = comps.find((c: any) => c.homeAway === "away") || {};
    return {
      id: String(event?.id),
      league,
      date: toDisplayDate(event?.date || ""),
      status: safeString(comp?.status?.type?.detail || comp?.status?.type?.description, "Scheduled"),
      period: safeNumber(comp?.status?.period),
      clock: safeString(comp?.status?.displayClock, ""),
      home: { team: safeString(home?.team?.name, "Home"), abbr: safeString(home?.team?.abbreviation, "HOME"), score: Number(home?.score || 0) },
      away: { team: safeString(away?.team?.name, "Away"), abbr: safeString(away?.team?.abbreviation, "AWAY"), score: Number(away?.score || 0) },
      leaders: [],
    };
  });
}

function extractESPNNFLBox(summary: any) {
  const players = summary?.boxscore?.players || [];
  const rows: any[] = [];
  for (const teamBlock of players) {
    const teamAbbr = safeString(teamBlock?.team?.abbreviation, "—");
    for (const statSet of teamBlock?.statistics || []) {
      const keys: string[] = statSet?.keys || [];
      const athleteRows = statSet?.athletes || [];
      for (const athleteRow of athleteRows) {
        const stats: string[] = athleteRow?.stats || [];
        const map: Record<string, string> = {};
        keys.forEach((k, i) => {
          map[k] = stats[i] ?? "0";
        });
        rows.push({
          player: safeString(athleteRow?.athlete?.displayName, "Unknown Player"),
          team: teamAbbr,
          role: safeString(athleteRow?.athlete?.position?.abbreviation, "—"),
          passYds: Number(map.passingYards || map.PASS || 0),
          rushYds: Number(map.rushingYards || map.RUSH || 0),
          recYds: Number(map.receivingYards || map.REC || 0),
          td: Number(map.touchdowns || map.TD || map.totalTouchdowns || 0),
          int: Number(map.interceptions || map.INT || 0),
          rating: Number.isFinite(Number(map.passerRating)) ? Number(map.passerRating) : "—",
        });
      }
    }
  }
  return rows.sort((a, b) => b.passYds + b.rushYds + b.recYds - (a.passYds + a.rushYds + a.recYds));
}

function extractESPNNBABox(summary: any) {
  const players = summary?.boxscore?.players || [];
  const rows: any[] = [];
  for (const teamBlock of players) {
    const teamAbbr = safeString(teamBlock?.team?.abbreviation, "—");
    for (const statSet of teamBlock?.statistics || []) {
      const keys: string[] = statSet?.keys || [];
      const athleteRows = statSet?.athletes || [];
      for (const athleteRow of athleteRows) {
        const stats: string[] = athleteRow?.stats || [];
        const map: Record<string, string> = {};
        keys.forEach((k, i) => {
          map[k] = stats[i] ?? "0";
        });
        rows.push({
          player: safeString(athleteRow?.athlete?.displayName, "Unknown Player"),
          team: teamAbbr,
          mins: Number(map.minutes || 0),
          pts: Number(map.points || 0),
          reb: Number(map.rebounds || 0),
          ast: Number(map.assists || 0),
          fg: safeString(map["fieldGoalsMade-fieldGoalsAttempted"], "0-0"),
          plusMinus: safeString(map.plusMinus, "0"),
        });
      }
    }
  }
  return rows.sort((a, b) => b.pts - a.pts);
}

async function getESPNBoxScore(league: League, gameId: string) {
  const summary = await fetchJson(ESPN_SUMMARY_URL(league, gameId));
  return league === "nba" ? extractESPNNBABox(summary) : extractESPNNFLBox(summary);
}

async function findESPNAthleteId(playerName: string): Promise<string | null> {
  const raw = await fetchJson(ESPN_SEARCH_URL(playerName));
  const items = raw?.items || [];
  const athlete = items.find((item: any) => {
    const display = String(item?.displayName || item?.name || "").toLowerCase();
    const type = String(item?.type || item?.typeName || "").toLowerCase();
    return display.includes(playerName.toLowerCase()) && (type.includes("athlete") || type.includes("player") || !type);
  });
  return athlete ? String(athlete.id) : null;
}

async function getESPNPlayerLogById(league: League, athleteId: string, playerName: string) {
  const raw = await fetchJson(ESPN_ATHLETE_GAMELOG_URL(league, athleteId));
  const events = raw?.events || raw?.items || [];
  const categories = raw?.categories || [];
  const isNBA = league === "nba";
  const statMapByEvent: Record<string, Record<string, string>> = {};

  for (const category of categories) {
    const names: string[] = category?.labels || category?.displayNames || category?.names || [];
    for (const eventStat of category?.events || []) {
      const eventId = String(eventStat?.eventId || eventStat?.id || "");
      if (!eventId) continue;
      statMapByEvent[eventId] ||= {};
      const stats = eventStat?.stats || [];
      names.forEach((name, i) => {
        statMapByEvent[eventId][name] = String(stats[i] ?? statMapByEvent[eventId][name] ?? "0");
      });
    }
  }

  return events.slice(0, 10).map((event: any) => {
    const eventId = String(event?.id || event?.eventId || "");
    const stats = statMapByEvent[eventId] || {};
    const opponent = safeString(event?.opponent?.abbreviation || event?.opponent?.displayName || event?.opponent || "—");
    const result = safeString(event?.result || event?.gameResult || "—");

    if (isNBA) {
      return {
        date: toDisplayDate(String(event?.date || "")),
        opponent,
        result,
        pts: Number(stats.points || stats.PTS || 0),
        reb: Number(stats.rebounds || stats.REB || 0),
        ast: Number(stats.assists || stats.AST || 0),
        min: Number(stats.minutes || stats.MIN || 0),
        player: playerName,
        team: safeString(event?.team?.abbreviation || "—"),
      };
    }

    return {
      date: toDisplayDate(String(event?.date || "")),
      opponent,
      result,
      passYds: Number(stats.passingYards || stats.PASS || 0),
      rushYds: Number(stats.rushingYards || stats.RUSH || 0),
      recYds: Number(stats.receivingYards || stats.REC || 0),
      td: Number(stats.touchdowns || stats.TD || 0),
      int: Number(stats.interceptions || stats.INT || 0),
      player: playerName,
      team: safeString(event?.team?.abbreviation || "—"),
    };
  });
}

async function getESPNPlayerLog(league: League, playerName: string) {
  const athleteId = await findESPNAthleteId(playerName);
  if (!athleteId) return [];
  return getESPNPlayerLogById(league, athleteId, playerName);
}

async function getGames(league: League): Promise<GameCard[]> {
  if (league === "nba") {
    try {
      const nbaGames = await getNBAGames();
      if (nbaGames.length) return nbaGames;
    } catch {
      // fallback below
    }
  }
  try {
    return await getESPNGames(league);
  } catch {
    return [];
  }
}

async function getBoxScore(league: League, gameId: string) {
  if (league === "nba") {
    try {
      const live = await getNBABOX(gameId);
      if (live.length) return live;
    } catch {
      // fallback below
    }
  }
  return getESPNBoxScore(league, gameId).catch(() => []);
}

async function getPlayerLog(league: League, playerName: string, playerId?: string) {
  if (league === "nba") {
    try {
      if (playerId) {
        const logs = await getNBAPlayerLogById(playerId, playerName);
        if (logs.length) return logs;
      }
      const logs = await getNBAPlayerLog(playerName);
      if (logs.length) return logs;
    } catch {
      // fallback below
    }
  }

  if (playerId) {
    try {
      const logs = await getESPNPlayerLogById(league, playerId, playerName);
      if (logs.length) return logs;
    } catch {
      // fallback below
    }
  }

  return getESPNPlayerLog(league, playerName).catch(() => []);
}

function getRecentWeightedAverage(values: number[]) {
  if (!values.length) return 0;
  const weights = values.map((_, i) => i + 1);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  return values.reduce((sum, v, i) => sum + v * weights[i], 0) / totalWeight;
}

function inferNbaPositionDefense(opponent: string, pos: string) {
  const ctx = (teamContext.nba as Record<string, any>)[opponent];
  if (!ctx) return { allowed: 23, rank: 15 };
  const map: Record<string, number> = {
    PG: ctx.ptsAllowedToPG,
    SG: ctx.ptsAllowedToSG,
    SF: ctx.ptsAllowedToSF,
    PF: ctx.ptsAllowedToPF,
    C: ctx.ptsAllowedToC,
  };
  return { allowed: map[pos] ?? 23, rank: ctx.defenseRank };
}

function buildPlayerPrediction(league: League, playerName: string, logs: any[]): PlayerPrediction | null {
  if (!logs.length) return null;

  const recent = logs.slice(0, 5);
  const team = logs[0]?.team || ((playerMeta[league] as Record<string, any>)[playerName]?.team ?? "");
  const opp = logs[0]?.opponent || "";
  const meta = (playerMeta[league] as Record<string, any>)[playerName] || {
    usage: 0.3,
    starterOutBoost: 0.02,
    pos: league === "nba" ? "SF" : "QB",
  };

  if (league === "nba") {
    const ptsArr = recent.map((x) => Number(x.pts || 0));
    const rebArr = recent.map((x) => Number(x.reb || 0));
    const astArr = recent.map((x) => Number(x.ast || 0));
    const minArr = recent.map((x) => Number(x.min || 0));
    const meanPts = avg(ptsArr);
    const weightedPts = getRecentWeightedAverage(ptsArr);
    const meanReb = avg(rebArr);
    const meanAst = avg(astArr);
    const meanMin = avg(minArr);
    const volPts = stddev(ptsArr);
    const posDefense = inferNbaPositionDefense(opp, meta.pos || "SF");
    const pace = (teamContext.nba as Record<string, any>)[opp]?.pace ?? 1;
    const usageAdj = (meta.usage - 0.28) * 18;
    const defenseAdj = (23 - posDefense.allowed) * -0.55;
    const paceAdj = (pace - 1) * 12;
    const minuteAdj = (meanMin - 34) * 0.35;
    const outBoostAdj = meta.starterOutBoost * 10;
    const projectedPts = clamp(weightedPts * 0.55 + meanPts * 0.25 + usageAdj + defenseAdj + paceAdj + minuteAdj + outBoostAdj, 8, 45);
    const projectedReb = clamp(meanReb + (pace - 1) * 2, 2, 18);
    const projectedAst = clamp(meanAst + (meta.usage - 0.28) * 8, 1, 14);
    const sigma = Math.max(3.5, volPts * 0.95 + 2.0);
    const confidence: "low" | "medium" | "high" = sigma < 4.8 ? "high" : sigma < 6.8 ? "medium" : "low";

    return {
      player: playerName,
      league,
      confidence,
      explanation: "Projection blends weighted recent form, usage, pace, estimated opponent defense vs position, and minute expectation.",
      stats: {
        points: Number(projectedPts.toFixed(1)),
        rebounds: Number(projectedReb.toFixed(1)),
        assists: Number(projectedAst.toFixed(1)),
      },
      ranges: {
        points: [Number((projectedPts - sigma).toFixed(1)), Number((projectedPts + sigma).toFixed(1))],
        rebounds: [Number((projectedReb - 2.1).toFixed(1)), Number((projectedReb + 2.1).toFixed(1))],
        assists: [Number((projectedAst - 2.0).toFixed(1)), Number((projectedAst + 2.0).toFixed(1))],
      },
      features: {
        team,
        opponent: opp,
        position: meta.pos,
        recentAveragePoints: Number(meanPts.toFixed(2)),
        weightedRecentPoints: Number(weightedPts.toFixed(2)),
        volatilityPoints: Number(volPts.toFixed(2)),
        averageMinutes: Number(meanMin.toFixed(2)),
        opponentDefenseRank: posDefense.rank,
        opponentPointsAllowedVsPosition: Number(posDefense.allowed.toFixed(2)),
        estimatedUsage: Number(meta.usage.toFixed(2)),
        estimatedStarterOutBoost: Number(meta.starterOutBoost.toFixed(2)),
      },
      drivers: [
        `Recent weighted average: ${weightedPts.toFixed(1)} PTS`,
        `Opponent defense vs ${meta.pos}: ${posDefense.allowed.toFixed(1)} allowed`,
        `Usage estimate: ${(meta.usage * 100).toFixed(0)}%`,
        `Projected minutes base: ${meanMin.toFixed(1)}`,
      ],
    };
  }

  const passArr = recent.map((x) => Number(x.passYds || 0));
  const rushArr = recent.map((x) => Number(x.rushYds || 0));
  const recArr = recent.map((x) => Number(x.recYds || 0));
  const tdArr = recent.map((x) => Number(x.td || 0));
  const intArr = recent.map((x) => Number(x.int || 0));
  const weightedPass = getRecentWeightedAverage(passArr);
  const meanPass = avg(passArr);
  const meanRush = avg(rushArr);
  const meanRec = avg(recArr);
  const meanTd = avg(tdArr);
  const meanInt = avg(intArr);
  const volPass = stddev(passArr);
  const oppCtx = (teamContext.nfl as Record<string, any>)[opp] || {
    passYdsAllowed: 228,
    rushYdsAllowed: 114,
    defenseRankPass: 16,
    defenseRankRush: 16,
    pace: 1,
  };
  const usageAdj = (meta.usage - 0.33) * 60;
  const passDefenseAdj = (228 - oppCtx.passYdsAllowed) * 0.45;
  const rushDefenseAdj = (114 - oppCtx.rushYdsAllowed) * 0.18;
  const paceAdj = (oppCtx.pace - 1) * 20;
  const outBoostAdj = meta.starterOutBoost * 18;
  const projectedPass = clamp(weightedPass * 0.56 + meanPass * 0.22 + usageAdj + passDefenseAdj + paceAdj + outBoostAdj, 120, 390);
  const projectedRush = clamp(meanRush + rushDefenseAdj, 0, 90);
  const projectedRec = clamp(meanRec, 0, 80);
  const projectedTd = clamp(meanTd + usageAdj / 120, 0, 5);
  const sigma = Math.max(18, volPass * 0.9 + 10);
  const confidence: "low" | "medium" | "high" = sigma < 24 ? "high" : sigma < 38 ? "medium" : "low";

  return {
    player: playerName,
    league,
    confidence,
    explanation: "Projection blends weighted passing trend, opponent pass/rush defense, usage proxy, turnover tendency, and pace.",
    stats: {
      passYards: Number(projectedPass.toFixed(1)),
      rushYards: Number(projectedRush.toFixed(1)),
      receivingYards: Number(projectedRec.toFixed(1)),
      touchdowns: Number(projectedTd.toFixed(1)),
      interceptions: Number(meanInt.toFixed(1)),
    },
    ranges: {
      passYards: [Number((projectedPass - sigma).toFixed(1)), Number((projectedPass + sigma).toFixed(1))],
      rushYards: [Number((projectedRush - 10).toFixed(1)), Number((projectedRush + 10).toFixed(1))],
      touchdowns: [Number(Math.max(0, projectedTd - 0.8).toFixed(1)), Number((projectedTd + 0.8).toFixed(1))],
    },
    features: {
      team,
      opponent: opp,
      position: meta.pos,
      weightedRecentPass: Number(weightedPass.toFixed(2)),
      recentAveragePass: Number(meanPass.toFixed(2)),
      passVolatility: Number(volPass.toFixed(2)),
      opponentPassDefenseRank: oppCtx.defenseRankPass,
      opponentRushDefenseRank: oppCtx.defenseRankRush,
      opponentPassYardsAllowed: oppCtx.passYdsAllowed,
      opponentRushYardsAllowed: oppCtx.rushYdsAllowed,
      estimatedUsage: Number(meta.usage.toFixed(2)),
      estimatedStarterOutBoost: Number(meta.starterOutBoost.toFixed(2)),
    },
    drivers: [
      `Weighted recent pass: ${weightedPass.toFixed(1)} yards`,
      `Opponent pass yards allowed: ${oppCtx.passYdsAllowed}`,
      `Usage estimate: ${(meta.usage * 100).toFixed(0)}%`,
      `Turnover trend: ${meanInt.toFixed(1)} INT`,
    ],
  };
}

function buildWinPrediction(game: GameCard): WinPrediction {
  const homeScore = game.home.score;
  const awayScore = game.away.score;
  const total = Math.max(homeScore + awayScore, 1);
  const margin = Math.abs(homeScore - awayScore);
  const homeShare = homeScore / total;
  const homeAdv = game.league === "nba" ? 0.035 : 0.045;
  const marginWeight = game.league === "nba" ? 0.014 : 0.02;
  const rawHome = 0.5 + (homeShare - 0.5) * 0.72 + homeAdv + margin * marginWeight;
  const homeWin = clamp(homeScore >= awayScore ? rawHome : 1 - rawHome, 0.32, 0.9);
  const favoredHome = homeWin >= 0.5;
  const favoredProb = favoredHome ? homeWin : 1 - homeWin;
  const confidence: "low" | "medium" | "high" = favoredProb >= 0.7 ? "high" : favoredProb >= 0.58 ? "medium" : "low";
  const favoredTeam = favoredHome ? game.home.team : game.away.team;
  const favoredAbbr = favoredHome ? game.home.abbr : game.away.abbr;

  return {
    favoredTeam,
    favoredAbbr,
    winProbability: Number((favoredProb * 100).toFixed(1)),
    confidence,
    fairAmericanOdds: probToAmericanOdds(favoredProb),
    explanation: "Win probability blends score share, margin, and a light home court/home-field prior.",
    drivers: [
      `Current margin: ${margin}`,
      `Scoring share: ${(Math.max(homeShare, 1 - homeShare) * 100).toFixed(1)}%`,
      "Home advantage prior applied",
    ],
  };
}

async function getOddsFeatured(league: League) {
  if (!ODDS_KEY) return [];
  const url = `${ODDS_BASE}/sports/${SPORT_KEY[league]}/odds/?apiKey=${ODDS_KEY}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`;
  const data = await fetchJson(url);
  return Array.isArray(data) ? data : [];
}

async function getEventPropOdds(league: League, eventId: string, markets: string[]) {
  if (!ODDS_KEY || !eventId || !markets.length) return null;
  const url = `${ODDS_BASE}/sports/${SPORT_KEY[league]}/events/${eventId}/odds/?apiKey=${ODDS_KEY}&regions=us&markets=${markets.join(",")}&oddsFormat=american`;
  try {
    return await fetchJson(url);
  } catch {
    return null;
  }
}

function findMatchingOddsEvent(game: GameCard, oddsEvents: any[]) {
  const home = game.home.team.toLowerCase();
  const away = game.away.team.toLowerCase();
  return (
    oddsEvents.find((e: any) => {
      const teams = [
        String(e.home_team || "").toLowerCase(),
        String(e.away_team || "").toLowerCase(),
        ...((e.bookmakers?.[0]?.markets?.[0]?.outcomes || []) as any[]).map((o: any) => String(o.name || "").toLowerCase()),
      ];
      return teams.some((t: string) => t.includes(home) || home.includes(t)) && teams.some((t: string) => t.includes(away) || away.includes(t));
    }) || null
  );
}

function buildGameEdges(game: GameCard, oddsEvent: any, winPrediction: WinPrediction | null): EdgeBet[] {
  if (!oddsEvent || !winPrediction) return [];
  const out: EdgeBet[] = [];
  const favoredName = winPrediction.favoredTeam;
  const modelProb = winPrediction.winProbability / 100;

  for (const bookmaker of oddsEvent.bookmakers || []) {
    for (const market of bookmaker.markets || []) {
      if (market.key !== "h2h") continue;
      const favoredOutcome = (market.outcomes || []).find((o: any) => String(o.name || "") === favoredName);
      if (!favoredOutcome) continue;
      const american = Number(favoredOutcome.price);
      const marketProb = normalizeAmericanOddsToProb(american);
      const edge = modelProb - marketProb;
      if (edge < 0.04) continue;
      out.push({
        type: "game",
        league: game.league,
        eventId: String(oddsEvent.id),
        eventLabel: `${game.away.team} @ ${game.home.team}`,
        market: "moneyline",
        selection: favoredName,
        sportsbook: bookmaker.title,
        oddsAmerican: american,
        marketImpliedProb: Number((marketProb * 100).toFixed(1)),
        modelProb: Number((modelProb * 100).toFixed(1)),
        edgePct: Number((edge * 100).toFixed(1)),
        confidence: winPrediction.confidence,
        fairAmericanOdds: winPrediction.fairAmericanOdds,
        explanation: `Model likes ${favoredName} more than the market price suggests.`,
        drivers: winPrediction.drivers,
      });
    }
  }

  return out;
}

function getSupportedPropMarkets(league: League) {
  return league === "nba" ? ["player_points", "player_rebounds", "player_assists"] : ["player_pass_yds", "player_rush_yds", "player_pass_tds"];
}

function pickPlayerPropTarget(league: League, playerPrediction: PlayerPrediction) {
  if (league === "nba") {
    return [
      { market: "player_points", statKey: "points", label: `${playerPrediction.player} points` },
      { market: "player_rebounds", statKey: "rebounds", label: `${playerPrediction.player} rebounds` },
      { market: "player_assists", statKey: "assists", label: `${playerPrediction.player} assists` },
    ];
  }
  return [
    { market: "player_pass_yds", statKey: "passYards", label: `${playerPrediction.player} passing yards` },
    { market: "player_rush_yds", statKey: "rushYards", label: `${playerPrediction.player} rushing yards` },
    { market: "player_pass_tds", statKey: "touchdowns", label: `${playerPrediction.player} passing TDs` },
  ];
}

function buildPropEdges(game: GameCard, oddsEventDetail: any, playerPrediction: PlayerPrediction | null): EdgeBet[] {
  if (!oddsEventDetail || !playerPrediction) return [];
  const out: EdgeBet[] = [];
  const targets = pickPlayerPropTarget(game.league, playerPrediction);

  for (const bookmaker of oddsEventDetail.bookmakers || []) {
    for (const market of bookmaker.markets || []) {
      const target = targets.find((t) => t.market === market.key);
      if (!target) continue;
      const outcomes = market.outcomes || [];
      const playerOutcomes = outcomes.filter((o: any) => String(o.description || o.name || "").toLowerCase().includes(playerPrediction.player.toLowerCase()));
      if (!playerOutcomes.length) continue;
      const line = Number(playerOutcomes[0]?.point ?? 0);
      const proj = Number(playerPrediction.stats[target.statKey] || 0);
      const range = playerPrediction.ranges[target.statKey] || [proj - 4, proj + 4];
      const sigma = Math.max(1.5, (range[1] - range[0]) / 4);
      const overProb = 1 - normalCdf((line - proj) / sigma);
      const underProb = 1 - overProb;
      const overOutcome = playerOutcomes.find((o: any) => String(o.name).toLowerCase() === "over");
      const underOutcome = playerOutcomes.find((o: any) => String(o.name).toLowerCase() === "under");

      if (overOutcome) {
        const marketProb = normalizeAmericanOddsToProb(Number(overOutcome.price));
        const edge = overProb - marketProb;
        if (edge >= 0.05) {
          out.push({
            type: "prop",
            league: game.league,
            eventId: String(oddsEventDetail.id),
            eventLabel: `${game.away.team} @ ${game.home.team}`,
            market: target.market,
            selection: `${playerPrediction.player} over ${line}`,
            line,
            sportsbook: bookmaker.title,
            oddsAmerican: Number(overOutcome.price),
            marketImpliedProb: Number((marketProb * 100).toFixed(1)),
            modelProb: Number((overProb * 100).toFixed(1)),
            edgePct: Number((edge * 100).toFixed(1)),
            confidence: playerPrediction.confidence,
            fairAmericanOdds: probToAmericanOdds(overProb),
            explanation: `Model projection ${proj.toFixed(1)} is above line ${line}.`,
            drivers: playerPrediction.drivers,
          });
        }
      }

      if (underOutcome) {
        const marketProb = normalizeAmericanOddsToProb(Number(underOutcome.price));
        const edge = underProb - marketProb;
        if (edge >= 0.05) {
          out.push({
            type: "prop",
            league: game.league,
            eventId: String(oddsEventDetail.id),
            eventLabel: `${game.away.team} @ ${game.home.team}`,
            market: target.market,
            selection: `${playerPrediction.player} under ${line}`,
            line,
            sportsbook: bookmaker.title,
            oddsAmerican: Number(underOutcome.price),
            marketImpliedProb: Number((marketProb * 100).toFixed(1)),
            modelProb: Number((underProb * 100).toFixed(1)),
            edgePct: Number((edge * 100).toFixed(1)),
            confidence: playerPrediction.confidence,
            fairAmericanOdds: probToAmericanOdds(underProb),
            explanation: `Model projection ${proj.toFixed(1)} is below or near line ${line} with enough variance-adjusted edge.`,
            drivers: playerPrediction.drivers,
          });
        }
      }
    }
  }

  return out;
}

async function buildBestBets(league: League, games: GameCard[], requestedPlayer?: string, requestedPlayerId?: string) {
  const oddsEvents = await getOddsFeatured(league);
  const allEdges: EdgeBet[] = [];

  for (const game of games.slice(0, 8)) {
    const gameOdds = findMatchingOddsEvent(game, oddsEvents);
    const winPrediction = buildWinPrediction(game);
    allEdges.push(...buildGameEdges(game, gameOdds, winPrediction));

    const inferredPlayer = requestedPlayer || (
      league === "nba"
        ? game.home.abbr === "LAL" || game.away.abbr === "LAL"
          ? "LeBron James"
          : game.home.abbr === "GSW" || game.away.abbr === "GSW"
            ? "Stephen Curry"
            : game.home.abbr === "BOS" || game.away.abbr === "BOS"
              ? "Jayson Tatum"
              : game.home.abbr === "MIL" || game.away.abbr === "MIL"
                ? "Giannis Antetokounmpo"
                : "LeBron James"
        : game.home.abbr === "KC" || game.away.abbr === "KC"
          ? "Patrick Mahomes"
          : game.home.abbr === "BUF" || game.away.abbr === "BUF"
            ? "Josh Allen"
            : game.home.abbr === "PHI" || game.away.abbr === "PHI"
              ? "Jalen Hurts"
              : "Patrick Mahomes"
    );

    const logs = (await getPlayerLog(league, inferredPlayer, requestedPlayerId)) || getFallbackLogs(league, inferredPlayer);
    const safeLogs = logs.length ? logs : getFallbackLogs(league, inferredPlayer);
    const playerPrediction = buildPlayerPrediction(league, inferredPlayer, safeLogs);

    if (gameOdds && playerPrediction && ODDS_KEY) {
      const propMarkets = getSupportedPropMarkets(league);
      const oddsEventDetail = await getEventPropOdds(league, String(gameOdds.id), propMarkets);
      if (oddsEventDetail) {
        allEdges.push(...buildPropEdges(game, oddsEventDetail, playerPrediction));
      }
    }
  }

  return allEdges.sort((a, b) => b.edgePct - a.edgePct).slice(0, 20);
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const league = (searchParams.get("league") || "nba") as League;
    const type = (searchParams.get("type") || "games") as QueryType;
    const gameId = searchParams.get("gameId") || "";
    const player = searchParams.get("player") || "";
    const playerId = searchParams.get("playerId") || "";

    if (type === "games") {
      const games = await getGames(league);
      return NextResponse.json({ league, type, games, generatedAt: new Date().toISOString() });
    }

    if (type === "boxscore") {
      if (!gameId) return NextResponse.json({ error: "gameId required" }, { status: 400 });
      const boxScore = await getBoxScore(league, gameId);
      return NextResponse.json({ league, type, gameId, boxScore, generatedAt: new Date().toISOString() });
    }

    if (type === "playerlog") {
      if (!player) return NextResponse.json({ error: "player required" }, { status: 400 });
      const liveLogs = await getPlayerLog(league, player, playerId);
      const logs = liveLogs.length ? liveLogs : getFallbackLogs(league, player);
      const playerPrediction = buildPlayerPrediction(league, player, logs);
      return NextResponse.json({ league, type, player, playerId, logs, playerPrediction, generatedAt: new Date().toISOString() });
    }

    if (type === "bundle") {
      if (!gameId) return NextResponse.json({ error: "gameId required" }, { status: 400 });
      const games = await getGames(league);
      const game = games.find((g) => g.id === gameId) || null;
      const boxScore = game ? await getBoxScore(league, game.id).catch(() => []) : [];
      const liveLogs = player ? await getPlayerLog(league, player, playerId).catch(() => []) : [];
      const logs = player ? (liveLogs.length ? liveLogs : getFallbackLogs(league, player)) : [];
      const winPrediction = game ? buildWinPrediction(game) : null;
      const playerPrediction = player ? buildPlayerPrediction(league, player, logs) : null;
      let edges: EdgeBet[] = [];
      if (game) {
        edges = await buildBestBets(league, [game], player || undefined, playerId || undefined);
      }
      return NextResponse.json({ league, type, game, boxScore, logs, winPrediction, playerPrediction, edges, generatedAt: new Date().toISOString() });
    }

    if (type === "bestbets") {
      const games = await getGames(league);
      const bestBets = await buildBestBets(league, games, player || undefined, playerId || undefined);
      return NextResponse.json({ league, type, bestBets, generatedAt: new Date().toISOString() });
    }

    return NextResponse.json({ error: "unsupported type" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Unknown error" }, { status: 500 });
  }
}
