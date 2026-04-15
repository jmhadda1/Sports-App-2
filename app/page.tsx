"use client";

import React, { useEffect, useMemo, useState } from "react";

type League = "nba" | "nfl";

type Game = {
  id: string;
  league: League;
  date: string;
  status: string;
  period?: number;
  clock?: string;
  home: { team: string; abbr: string; score: number };
  away: { team: string; abbr: string; score: number };
  leaders?: string[];
};

type PlayerResult = {
  id: string;
  name: string;
  team: string;
  league: League;
};

type WinPrediction = {
  favoredTeam: string;
  favoredAbbr: string;
  winProbability: number;
  confidence: "low" | "medium" | "high" | string;
  explanation: string;
  fairAmericanOdds: number;
};

type PlayerPrediction = {
  player: string;
  league: League;
  confidence: "low" | "medium" | "high" | string;
  explanation: string;
  stats: Record<string, number>;
  ranges: Record<string, { low: number; high: number }>;
  diagnostics?: Record<string, number>;
};

type BestBet = {
  market: string;
  selection: string;
  bookmaker: string;
  bookOdds: number;
  impliedProb: number;
  modelProb: number;
  edgePct: number;
  fairOdds: number;
  confidence: string;
  explanation: string;
};

type ThemeMode = "light" | "dark";

type OddsEvent = {
  id: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  bookmakers?: any[];
};

async function fetchJson(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return res.json();
}

function avg(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function sum(values: number[]) {
  return values.reduce((a, b) => a + b, 0);
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function stdDev(values: number[]) {
  if (values.length <= 1) return 0;
  const m = avg(values);
  return Math.sqrt(avg(values.map((v) => (v - m) ** 2)));
}

function erf(x: number) {
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x));
  return sign * y;
}

function normalCdf(x: number, mean: number, sd: number) {
  const z = (x - mean) / Math.max(sd, 1e-6);
  return 0.5 * (1 + erf(z / Math.sqrt(2)));
}

function americanToImpliedProb(odds: number) {
  if (!Number.isFinite(odds) || odds === 0) return null;
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

function probToAmerican(probPct: number) {
  const p = clamp(probPct / 100, 0.01, 0.99);
  if (p >= 0.5) return Math.round((-100 * p) / (1 - p));
  return Math.round((100 * (1 - p)) / p);
}

function normalizeTeamName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function teamMatchScore(gameTeam: string, oddsTeam: string) {
  const g = normalizeTeamName(gameTeam);
  const o = normalizeTeamName(oddsTeam);
  if (!g || !o) return 0;
  if (g === o) return 100;
  if (g.includes(o) || o.includes(g)) return 80;

  const glast = g.split(" ").slice(-1)[0];
  const olast = o.split(" ").slice(-1)[0];
  if (glast === olast) return 75;
  if (g.includes(olast) || o.includes(glast)) return 60;
  return 0;
}

function formatMoneyline(odds: number) {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function formatMarketLabel(key: string) {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function getDefaultPlayer(league: League) {
  return league === "nba" ? "LeBron James" : "Patrick Mahomes";
}

function inferPlayerFromGame(game: Game | null, league: League) {
  if (!game) return getDefaultPlayer(league);
  const abbrs = [game.home.abbr, game.away.abbr];
  if (league === "nba") {
    if (abbrs.includes("LAL")) return "LeBron James";
    if (abbrs.includes("GSW")) return "Stephen Curry";
    if (abbrs.includes("BOS")) return "Jayson Tatum";
    if (abbrs.includes("MIL")) return "Giannis Antetokounmpo";
    return "LeBron James";
  }
  if (abbrs.includes("KC")) return "Patrick Mahomes";
  if (abbrs.includes("BUF")) return "Josh Allen";
  if (abbrs.includes("PHI")) return "Jalen Hurts";
  return "Patrick Mahomes";
}

function getTeamLogoUrl(league: League, abbr?: string) {
  if (!abbr) return "";
  const clean = abbr.toLowerCase();
  return league === "nba"
    ? `https://a.espncdn.com/i/teamlogos/nba/500/${clean}.png`
    : `https://a.espncdn.com/i/teamlogos/nfl/500/${clean}.png`;
}

function confidenceColor(confidence?: string) {
  const c = String(confidence || "").toLowerCase();
  if (c.includes("high")) return "#16a34a";
  if (c.includes("medium")) return "#f59e0b";
  return "#ef4444";
}

function formatStatLabel(key: string) {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (m) => m.toUpperCase()).trim();
}

function Sparkline({ values, color = "#2563eb", dark = false }: { values: number[]; color?: string; dark?: boolean }) {
  if (!values.length) return <div style={{ fontSize: 12, opacity: 0.7 }}>No trend data</div>;
  const width = 220;
  const height = 64;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);
  const points = values
    .map((v, i) => {
      const x = (i / Math.max(values.length - 1, 1)) * (width - 8) + 4;
      const y = height - ((v - min) / span) * (height - 12) - 6;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
      <polyline fill="none" stroke={dark ? "rgba(255,255,255,0.15)" : "rgba(15,23,42,0.08)"} strokeWidth="1" points={`4,${height - 6} ${width - 4},${height - 6}`} />
      <polyline fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" points={points} />
      {values.map((v, i) => {
        const x = (i / Math.max(values.length - 1, 1)) * (width - 8) + 4;
        const y = height - ((v - min) / span) * (height - 12) - 6;
        return <circle key={`${v}-${i}`} cx={x} cy={y} r="3" fill={color} />;
      })}
    </svg>
  );
}

function TeamBadge({ league, abbr, team, size = 34 }: { league: League; abbr?: string; team?: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  const url = getTeamLogoUrl(league, abbr);
  if (!url || broken) {
    return (
      <div
        title={team || abbr || "Team"}
        style={{
          width: size,
          height: size,
          borderRadius: 999,
          background: "linear-gradient(135deg, #2563eb, #0f172a)",
          color: "white",
          display: "grid",
          placeItems: "center",
          fontWeight: 700,
          fontSize: size * 0.34,
          flexShrink: 0,
        }}
      >
        {abbr || "?"}
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={team || abbr || "Team logo"}
      width={size}
      height={size}
      style={{ width: size, height: size, objectFit: "contain", flexShrink: 0 }}
      onError={() => setBroken(true)}
    />
  );
}

function getPropStatKey(marketKey: string) {
  if (marketKey.includes("points")) return "points";
  if (marketKey.includes("rebounds")) return "rebounds";
  if (marketKey.includes("assists")) return "assists";
  if (marketKey.includes("threes")) return "points";
  if (marketKey.includes("pass_yds")) return "passYards";
  if (marketKey.includes("rush_yds")) return "rushYards";
  if (marketKey.includes("reception_yds")) return "receivingYards";
  if (marketKey.includes("pass_tds")) return "touchdowns";
  if (marketKey.includes("anytime_td")) return "touchdowns";
  return "points";
}

function deriveBestBets({
  league,
  selectedGame,
  winPrediction,
  playerPrediction,
  featuredOddsEvent,
  featuredOddsData,
  propOddsData,
  selectedPlayer,
}: {
  league: League;
  selectedGame: Game | null;
  winPrediction: WinPrediction | null;
  playerPrediction: PlayerPrediction | null;
  featuredOddsEvent: OddsEvent | null;
  featuredOddsData: any;
  propOddsData: any;
  selectedPlayer: string;
}): BestBet[] {
  const bets: BestBet[] = [];
  if (!selectedGame || !winPrediction) return bets;

  const featured = featuredOddsData?.odds?.bookmakers || [];
  for (const book of featured) {
    const h2h = (book.markets || []).find((m: any) => m.key === "h2h");
    if (!h2h) continue;

    for (const outcome of h2h.outcomes || []) {
      const bookOdds = Number(outcome.price);
      const implied = americanToImpliedProb(bookOdds);
      if (!implied) continue;

      const sideTeam = String(outcome.name || "");
      const selectedSideIsFavored = normalizeTeamName(sideTeam) === normalizeTeamName(winPrediction.favoredTeam);
      const modelProb = selectedSideIsFavored ? winPrediction.winProbability / 100 : 1 - winPrediction.winProbability / 100;
      const edge = (modelProb - implied) * 100;

      if (edge >= 4) {
        bets.push({
          market: "Moneyline",
          selection: sideTeam,
          bookmaker: book.title,
          bookOdds,
          impliedProb: Number((implied * 100).toFixed(1)),
          modelProb: Number((modelProb * 100).toFixed(1)),
          edgePct: Number(edge.toFixed(1)),
          fairOdds: probToAmerican(modelProb * 100),
          confidence: winPrediction.confidence,
          explanation: `Model price = ${selectedSideIsFavored ? winPrediction.favoredTeam : "opponent"} fair line translated into implied probability.`,
        });
      }
    }
  }

  // Player props edges
  if (playerPrediction && propOddsData?.odds?.bookmakers) {
    const books = propOddsData.odds.bookmakers || [];
    const stats = playerPrediction.stats || {};
    const ranges = playerPrediction.ranges || {};

    for (const book of books) {
      for (const market of book.markets || []) {
        const marketKey = String(market.key || "");
        const propStatKey = getPropStatKey(marketKey);
        const center = Number(stats[propStatKey] ?? 0);
        const range = ranges[propStatKey];
        const sd = Math.max(1, range ? (range.high - range.low) / 2 : Math.max(2, center * 0.12));

        for (const outcome of market.outcomes || []) {
          const name = String(outcome.name || "").toLowerCase();
          const desc = String(outcome.description || "");
          const price = Number(outcome.price);
          const line = outcome.point == null ? null : Number(outcome.point);
          const implied = americanToImpliedProb(price);
          if (!implied) continue;

          if (!desc.toLowerCase().includes(selectedPlayer.toLowerCase())) continue;

          let modelProb = 0;
          let selection = "";
          if (line != null && (name === "over" || name === "under")) {
            selection = `${name} ${line}`;
            modelProb = name === "over" ? 1 - normalCdf(line, center, sd) : normalCdf(line, center, sd);
          } else if (marketKey.includes("anytime_td")) {
            selection = desc || selectedPlayer;
            modelProb = clamp(1 - Math.exp(-(center / 6)), 0.08, 0.92);
          } else {
            continue;
          }

          const edge = (modelProb - implied) * 100;
          if (edge < 4) continue;

          bets.push({
            market: formatMarketLabel(marketKey),
            selection: selection || selectedPlayer,
            bookmaker: book.title,
            bookOdds: price,
            impliedProb: Number((implied * 100).toFixed(1)),
            modelProb: Number((modelProb * 100).toFixed(1)),
            edgePct: Number(edge.toFixed(1)),
            fairOdds: probToAmerican(modelProb * 100),
            confidence: playerPrediction.confidence,
            explanation: `Player projection centered at ${center.toFixed(1)} vs market line ${line ?? "—"}.`,
          });
        }
      }
    }
  }

  return bets.sort((a, b) => b.edgePct - a.edgePct).slice(0, 10);
}

export default function Page() {
  const [league, setLeague] = useState<League>("nba");
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [games, setGames] = useState<Game[]>([]);
  const [selectedGameId, setSelectedGameId] = useState("");
  const [boxScore, setBoxScore] = useState<any[]>([]);
  const [playerQuery, setPlayerQuery] = useState(getDefaultPlayer(league));
  const [playerResults, setPlayerResults] = useState<PlayerResult[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState(getDefaultPlayer(league));
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [logs, setLogs] = useState<any[]>([]);
  const [winPrediction, setWinPrediction] = useState<WinPrediction | null>(null);
  const [playerPrediction, setPlayerPrediction] = useState<PlayerPrediction | null>(null);
  const [featuredOddsData, setFeaturedOddsData] = useState<any>(null);
  const [featuredOddsEvent, setFeaturedOddsEvent] = useState<OddsEvent | null>(null);
  const [propOddsData, setPropOddsData] = useState<any>(null);
  const [bestBets, setBestBets] = useState<BestBet[]>([]);
  const [searchingPlayers, setSearchingPlayers] = useState(false);
  const [loadingGames, setLoadingGames] = useState(false);
  const [loadingBundle, setLoadingBundle] = useState(false);
  const [error, setError] = useState("");
  const [showDebug, setShowDebug] = useState(false);

  const dark = theme === "dark";
  const palette = useMemo(
    () => ({
      bg: dark ? "#0b1220" : "#f8fafc",
      panel: dark ? "#111827" : "#ffffff",
      panel2: dark ? "#0f172a" : "#f8fafc",
      border: dark ? "rgba(255,255,255,0.10)" : "rgba(15,23,42,0.10)",
      text: dark ? "#e5e7eb" : "#0f172a",
      muted: dark ? "#94a3b8" : "#64748b",
      accent: "#2563eb",
      accentSoft: dark ? "rgba(37,99,235,0.18)" : "#dbeafe",
      successSoft: dark ? "rgba(22,163,74,0.16)" : "#dcfce7",
      warnSoft: dark ? "rgba(245,158,11,0.16)" : "#fef3c7",
      shadow: dark ? "0 18px 50px rgba(0,0,0,0.35)" : "0 18px 50px rgba(15,23,42,0.08)",
    }),
    [dark]
  );

  useEffect(() => {
    const next = getDefaultPlayer(league);
    setPlayerQuery(next);
    setSelectedPlayer(next);
    setSelectedPlayerId("");
    setPlayerResults([]);
    setShowDebug(false);
  }, [league]);

  const selectedGame = useMemo(() => games.find((g) => g.id === selectedGameId) || null, [games, selectedGameId]);

  const matchedOddsEvent = useMemo(() => {
    const oddsGames: OddsEvent[] = featuredOddsData?.odds || featuredOddsData?.odds?.odds || featuredOddsData?.odds || [];
    const list: OddsEvent[] = Array.isArray(oddsGames) ? oddsGames : [];
    if (!selectedGame) return null;

    let best: OddsEvent | null = null;
    let bestScore = 0;
    for (const item of list) {
      const score =
        teamMatchScore(selectedGame.home.team, item.home_team) +
        teamMatchScore(selectedGame.away.team, item.away_team);
      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    }
    return bestScore >= 120 ? best : best; // keep best candidate even if names are slightly fuzzy
  }, [featuredOddsData, selectedGame]);

  // Load games + featured odds
  useEffect(() => {
    async function loadAll() {
      try {
        setLoadingGames(true);
        setError("");
        const [gamesData, oddsData] = await Promise.all([
          fetchJson(`/api/sports?league=${league}&type=games`),
          fetchJson(`/api/odds?league=${league}&mode=featured`),
        ]);
        const nextGames = Array.isArray(gamesData.games) ? gamesData.games : [];
        setGames(nextGames);
        setFeaturedOddsData(oddsData);
        setSelectedGameId((current) => {
          if (current && nextGames.some((g: Game) => g.id === current)) return current;
          return nextGames[0]?.id || "";
        });
      } catch (err: any) {
        setError(err?.message || "Could not load games or odds");
      } finally {
        setLoadingGames(false);
      }
    }
    loadAll();
  }, [league]);

  // Search players
  useEffect(() => {
    const q = playerQuery.trim();
    if (q.length < 1) {
      setPlayerResults([]);
      return;
    }

    const t = setTimeout(async () => {
      try {
        setSearchingPlayers(true);
        const data = await fetchJson(`/api/players?league=${league}&q=${encodeURIComponent(q)}`);
        setPlayerResults(Array.isArray(data.results) ? data.results : []);
      } catch {
        setPlayerResults([]);
      } finally {
        setSearchingPlayers(false);
      }
    }, 250);

    return () => clearTimeout(t);
  }, [playerQuery, league]);

  // Load bundle + prop odds for selected event
  useEffect(() => {
    if (!selectedGameId) return;

    async function loadBundle() {
      try {
        setLoadingBundle(true);
        setError("");
        const effectivePlayer = selectedPlayer || inferPlayerFromGame(selectedGame, league);
        const bundlePromise = fetchJson(
          `/api/sports?league=${league}&type=bundle&gameId=${encodeURIComponent(selectedGameId)}&player=${encodeURIComponent(effectivePlayer)}&playerId=${encodeURIComponent(selectedPlayerId)}`
        );

        const propsPromise = matchedOddsEvent
          ? fetchJson(`/api/odds?league=${league}&mode=props&eventId=${encodeURIComponent(matchedOddsEvent.id)}`)
          : Promise.resolve(null);

        const [bundleData, propsData] = await Promise.all([bundlePromise, propsPromise]);
        setBoxScore(Array.isArray(bundleData.boxScore) ? bundleData.boxScore : []);
        setLogs(Array.isArray(bundleData.logs) ? bundleData.logs : []);
        setWinPrediction(bundleData.winPrediction || null);
        setPlayerPrediction(bundleData.playerPrediction || null);
        setPropOddsData(propsData || null);
        setFeaturedOddsEvent(matchedOddsEvent || null);
      } catch (err: any) {
        setError(err?.message || "Could not load prediction bundle");
        setBoxScore([]);
        setLogs([]);
        setWinPrediction(null);
        setPlayerPrediction(null);
        setPropOddsData(null);
        setFeaturedOddsEvent(null);
      } finally {
        setLoadingBundle(false);
      }
    }

    loadBundle();
  }, [league, selectedGameId, selectedPlayer, selectedPlayerId, matchedOddsEvent]);

  const bestBetsDerived = useMemo(
    () => deriveBestBets({
      league,
      selectedGame,
      winPrediction,
      playerPrediction,
      featuredOddsEvent,
      featuredOddsData,
      propOddsData,
      selectedPlayer,
    }),
    [league, selectedGame, winPrediction, playerPrediction, featuredOddsEvent, featuredOddsData, propOddsData, selectedPlayer]
  );

  useEffect(() => {
    setBestBets(bestBetsDerived);
  }, [bestBetsDerived]);

  const trendValues = useMemo(() => {
    if (!logs.length) return [] as number[];
    if (league === "nba") return logs.map((l) => Number(l.pts || 0)).reverse();
    return logs.map((l) => Number(l.passYds || 0)).reverse();
  }, [logs, league]);

  const summaryStats = useMemo(() => {
    if (!logs.length) return null;
    if (league === "nba") {
      return [
        { label: "Avg PTS", value: avg(logs.map((l) => Number(l.pts || 0))).toFixed(1) },
        { label: "Avg REB", value: avg(logs.map((l) => Number(l.reb || 0))).toFixed(1) },
        { label: "Avg AST", value: avg(logs.map((l) => Number(l.ast || 0))).toFixed(1) },
        { label: "Volatility", value: stdDev(logs.map((l) => Number(l.pts || 0))).toFixed(1) },
      ];
    }
    return [
      { label: "Avg Pass", value: avg(logs.map((l) => Number(l.passYds || 0))).toFixed(1) },
      { label: "Avg Rush", value: avg(logs.map((l) => Number(l.rushYds || 0))).toFixed(1) },
      { label: "Avg TD", value: avg(logs.map((l) => Number(l.td || 0))).toFixed(1) },
      { label: "Volatility", value: stdDev(logs.map((l) => Number(l.passYds || 0))).toFixed(1) },
    ];
  }, [logs, league]);

  const selectedGameLeaders = useMemo(() => selectedGame?.leaders || [], [selectedGame]);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: `radial-gradient(circle at top left, ${dark ? "rgba(37,99,235,0.18)" : "rgba(37,99,235,0.08)"}, transparent 28%), ${palette.bg}`,
        color: palette.text,
        padding: 20,
      }}
    >
      <div style={{ maxWidth: 1500, margin: "0 auto" }}>
        <section
          style={{
            background: `linear-gradient(135deg, ${dark ? "#0f172a" : "#ffffff"}, ${dark ? "#111827" : "#eff6ff"})`,
            border: `1px solid ${palette.border}`,
            boxShadow: palette.shadow,
            borderRadius: 24,
            padding: 24,
            marginBottom: 18,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <div>
              <div style={{ color: palette.muted, fontSize: 13, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 8 }}>
                AI-integrated betting research
              </div>
              <h1 style={{ margin: 0, fontSize: "clamp(30px, 5vw, 52px)", lineHeight: 1.04 }}>SmartSports AI Edge Dashboard</h1>
              <p style={{ margin: "10px 0 0", color: palette.muted, maxWidth: 900, fontSize: 16 }}>
                Search players by ID, project performance with a stronger model, compare fair odds to the sportsbook market, and surface the biggest discrepancies as best bets.
              </p>
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button onClick={() => setTheme(dark ? "light" : "dark")} style={{ padding: "12px 16px", borderRadius: 14, border: `1px solid ${palette.border}`, background: palette.panel, color: palette.text, cursor: "pointer", fontWeight: 600 }}>
                {dark ? "Light mode" : "Dark mode"}
              </button>
              <button onClick={() => setShowDebug((v) => !v)} style={{ padding: "12px 16px", borderRadius: 14, border: `1px solid ${palette.border}`, background: palette.panel, color: palette.text, cursor: "pointer", fontWeight: 600 }}>
                {showDebug ? "Hide debug" : "Show debug"}
              </button>
            </div>
          </div>
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 18 }}>
          <label style={{ display: "grid", gap: 8 }}>
            <span style={{ color: palette.muted, fontSize: 13 }}>League</span>
            <select value={league} onChange={(e) => setLeague(e.target.value as League)} style={{ padding: 14, borderRadius: 14, border: `1px solid ${palette.border}`, background: palette.panel, color: palette.text }}>
              <option value="nba">NBA</option>
              <option value="nfl">NFL</option>
            </select>
          </label>

          <div style={{ display: "grid", gap: 8, position: "relative" }}>
            <span style={{ color: palette.muted, fontSize: 13 }}>Search players</span>
            <input
              value={playerQuery}
              onChange={(e) => {
                setPlayerQuery(e.target.value);
              }}
              onFocus={() => setPlayerQuery((v) => v || getDefaultPlayer(league))}
              placeholder={getDefaultPlayer(league)}
              style={{ padding: 14, borderRadius: 14, border: `1px solid ${palette.border}`, background: palette.panel, color: palette.text }}
            />
            {(playerResults.length > 0 || searchingPlayers) && playerQuery.trim().length >= 2 && (
              <div style={{ position: "absolute", top: 72, left: 0, right: 0, zIndex: 10, background: palette.panel, border: `1px solid ${palette.border}`, borderRadius: 14, overflow: "hidden", boxShadow: palette.shadow }}>
                {searchingPlayers && <div style={{ padding: 12, color: palette.muted }}>Searching...</div>}
                {!searchingPlayers && playerResults.map((result) => (
                  <button
                    key={`${result.id}-${result.name}`}
                    onClick={() => {
                      setSelectedPlayer(result.name);
                      setPlayerQuery(result.name);
                      setSelectedPlayerId(result.id);
                      setPlayerResults([]);
                    }}
                    style={{ width: "100%", textAlign: "left", padding: 12, background: "transparent", color: palette.text, border: "none", borderBottom: `1px solid ${palette.border}`, cursor: "pointer" }}
                  >
                    <div style={{ fontWeight: 700 }}>{result.name}</div>
                    <div style={{ color: palette.muted, fontSize: 13 }}>{result.team || result.id}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <span style={{ color: palette.muted, fontSize: 13 }}>Selected player</span>
            <div style={{ padding: 14, borderRadius: 14, border: `1px solid ${palette.border}`, background: palette.panel, color: palette.text, fontWeight: 600 }}>
              {selectedPlayer}
              {selectedPlayerId ? ` · ID ${selectedPlayerId}` : ""}
            </div>
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <span style={{ color: palette.muted, fontSize: 13 }}>Odds status</span>
            <div style={{ padding: 14, borderRadius: 14, border: `1px solid ${palette.border}`, background: palette.successSoft, color: dark ? palette.text : "#0f172a", fontWeight: 600 }}>
              {featuredOddsData ? "Live sportsbook odds connected" : "Waiting on odds"}
            </div>
          </div>
        </section>

        {error && (
          <div style={{ background: palette.warnSoft, border: `1px solid ${palette.border}`, color: dark ? "#fde68a" : "#92400e", padding: 14, borderRadius: 16, marginBottom: 18, fontWeight: 600 }}>
            Some free endpoints may be missing data. The dashboard will still show predictions and best-bet candidates where possible.
          </div>
        )}

        <section style={{ display: "grid", gridTemplateColumns: "minmax(300px, 420px) minmax(0, 1fr)", gap: 18 }}>
          <div style={{ display: "grid", gap: 18 }}>
            <div style={{ background: palette.panel, border: `1px solid ${palette.border}`, borderRadius: 24, boxShadow: palette.shadow, overflow: "hidden" }}>
              <div style={{ padding: 18, borderBottom: `1px solid ${palette.border}` }}>
                <div style={{ fontSize: 22, fontWeight: 800 }}>Today’s Games</div>
                <div style={{ color: palette.muted, marginTop: 6 }}>Select a matchup to power predictions and odds matching.</div>
              </div>
              <div style={{ padding: 12, display: "grid", gap: 12, maxHeight: 720, overflow: "auto" }}>
                {games.map((game) => {
                  const active = game.id === selectedGameId;
                  return (
                    <button
                      key={game.id}
                      onClick={() => {
                        setSelectedGameId(game.id);
                        if (!selectedPlayerId) {
                          const inferred = inferPlayerFromGame(game, league);
                          setSelectedPlayer(inferred);
                          setPlayerQuery(inferred);
                        }
                      }}
                      style={{ textAlign: "left", background: active ? palette.accentSoft : palette.panel2, border: active ? `2px solid ${palette.accent}` : `1px solid ${palette.border}`, borderRadius: 18, padding: 16, cursor: "pointer", color: palette.text }}
                    >
                      <div style={{ display: "grid", gap: 12 }}>
                        {[game.away, game.home].map((team) => (
                          <div key={team.abbr} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                              <TeamBadge league={league} abbr={team.abbr} team={team.team} />
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{team.team}</div>
                                <div style={{ color: palette.muted, fontSize: 12 }}>{team.abbr}</div>
                              </div>
                            </div>
                            <div style={{ fontWeight: 800, fontSize: 28 }}>{team.score}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between", gap: 12, color: palette.muted, fontSize: 13, flexWrap: "wrap" }}>
                        <span>{game.date}</span>
                        <span>{game.status}</span>
                      </div>
                    </button>
                  );
                })}
                {!games.length && !loadingGames && <div style={{ color: palette.muted, padding: 12 }}>No games available.</div>}
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gap: 18 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 18 }}>
              <div style={{ background: palette.panel, border: `1px solid ${palette.border}`, borderRadius: 24, boxShadow: palette.shadow, padding: 20 }}>
                <div style={{ color: palette.muted, fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8 }}>Win predictor</div>
                <div style={{ marginTop: 10, fontSize: 28, fontWeight: 800 }}>{winPrediction ? `${winPrediction.favoredTeam} ${winPrediction.winProbability}%` : "Waiting for game"}</div>
                <div style={{ marginTop: 10, color: palette.muted, lineHeight: 1.5 }}>{winPrediction?.explanation || "Select a game to view model output."}</div>
                {winPrediction && <div style={{ marginTop: 12, color: palette.muted }}>Fair line: {formatMoneyline(winPrediction.fairAmericanOdds)}</div>}
              </div>

              <div style={{ background: palette.panel, border: `1px solid ${palette.border}`, borderRadius: 24, boxShadow: palette.shadow, padding: 20 }}>
                <div style={{ color: palette.muted, fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8 }}>Player predictor</div>
                <div style={{ marginTop: 10, fontSize: 28, fontWeight: 800 }}>{playerPrediction?.player || selectedPlayer || "No player selected"}</div>
                <div style={{ marginTop: 10, color: palette.muted, lineHeight: 1.5 }}>{playerPrediction?.explanation || "Player forecast appears here when logs are available."}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 10, marginTop: 16 }}>
                  {playerPrediction && Object.entries(playerPrediction.stats).map(([key, value]) => (
                    <div key={key} style={{ background: palette.panel2, border: `1px solid ${palette.border}`, borderRadius: 16, padding: 12 }}>
                      <div style={{ color: palette.muted, fontSize: 12 }}>{formatStatLabel(key)}</div>
                      <div style={{ marginTop: 6, fontSize: 20, fontWeight: 800 }}>{String(value)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ background: palette.panel, border: `1px solid ${palette.border}`, borderRadius: 24, boxShadow: palette.shadow, padding: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
                <div>
                  <div style={{ color: palette.muted, fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8 }}>Best bets</div>
                  <div style={{ marginTop: 6, fontSize: 24, fontWeight: 800 }}>Model vs market edge detection</div>
                </div>
                <div style={{ color: palette.muted }}>{bestBets.length} edges found</div>
              </div>

              <div style={{ display: "grid", gap: 12 }}>
                {bestBets.map((bet, i) => (
                  <div key={`${bet.market}-${bet.selection}-${bet.bookmaker}-${i}`} style={{ background: palette.panel2, border: `1px solid ${palette.border}`, borderRadius: 18, padding: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <div>
                        <div style={{ fontSize: 18, fontWeight: 800 }}>{bet.market}: {bet.selection}</div>
                        <div style={{ color: palette.muted, marginTop: 4 }}>{bet.bookmaker} · {formatMoneyline(bet.bookOdds)}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 24, fontWeight: 900, color: confidenceColor(bet.confidence) }}>+{bet.edgePct}%</div>
                        <div style={{ color: palette.muted }}>{bet.confidence.toUpperCase()} confidence</div>
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginTop: 14 }}>
                      <div style={{ background: palette.panel, border: `1px solid ${palette.border}`, borderRadius: 12, padding: 10 }}>
                        <div style={{ color: palette.muted, fontSize: 12 }}>Model prob</div>
                        <div style={{ fontWeight: 800, marginTop: 4 }}>{bet.modelProb}%</div>
                      </div>
                      <div style={{ background: palette.panel, border: `1px solid ${palette.border}`, borderRadius: 12, padding: 10 }}>
                        <div style={{ color: palette.muted, fontSize: 12 }}>Implied prob</div>
                        <div style={{ fontWeight: 800, marginTop: 4 }}>{bet.impliedProb}%</div>
                      </div>
                      <div style={{ background: palette.panel, border: `1px solid ${palette.border}`, borderRadius: 12, padding: 10 }}>
                        <div style={{ color: palette.muted, fontSize: 12 }}>Fair odds</div>
                        <div style={{ fontWeight: 800, marginTop: 4 }}>{formatMoneyline(bet.fairOdds)}</div>
                      </div>
                    </div>
                    <div style={{ marginTop: 12, color: palette.muted, lineHeight: 1.5 }}>{bet.explanation}</div>
                  </div>
                ))}
                {!bestBets.length && <div style={{ color: palette.muted }}>No strong edges surfaced yet. Try another player or a game with props.</div>}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18 }}>
              <div style={{ background: palette.panel, border: `1px solid ${palette.border}`, borderRadius: 24, boxShadow: palette.shadow, padding: 20 }}>
                <div style={{ color: palette.muted, fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8 }}>Sportsbook snapshot</div>
                <div style={{ marginTop: 10, fontSize: 24, fontWeight: 800 }}>{featuredOddsEvent ? `${featuredOddsEvent.away_team} @ ${featuredOddsEvent.home_team}` : "Matching odds..."}</div>
                {featuredOddsEvent && (
                  <>
                    <div style={{ color: palette.muted, marginTop: 6 }}>{new Date(featuredOddsEvent.commence_time).toLocaleString()}</div>
                    <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
                      {(featuredOddsData?.odds?.bookmakers || []).slice(0, 3).map((book: any) => {
                        const h2h = (book.markets || []).find((m: any) => m.key === "h2h");
                        const spread = (book.markets || []).find((m: any) => m.key === "spreads");
                        const total = (book.markets || []).find((m: any) => m.key === "totals");
                        return (
                          <div key={book.key} style={{ background: palette.panel2, border: `1px solid ${palette.border}`, borderRadius: 16, padding: 14 }}>
                            <div style={{ fontWeight: 800, marginBottom: 8 }}>{book.title}</div>
                            <div style={{ color: palette.muted, fontSize: 13 }}>
                              H2H: {h2h?.outcomes?.map((o: any) => `${o.name} ${formatMoneyline(Number(o.price))}`).join(" | ")}
                            </div>
                            <div style={{ color: palette.muted, fontSize: 13, marginTop: 4 }}>
                              Spread: {spread?.outcomes?.map((o: any) => `${o.name} ${formatMoneyline(Number(o.price))} (${o.point})`).join(" | ")}
                            </div>
                            <div style={{ color: palette.muted, fontSize: 13, marginTop: 4 }}>
                              Total: {total?.outcomes?.map((o: any) => `${o.name} ${formatMoneyline(Number(o.price))} (${o.point})`).join(" | ")}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>

              <div style={{ background: palette.panel, border: `1px solid ${palette.border}`, borderRadius: 24, boxShadow: palette.shadow, padding: 20 }}>
                <div style={{ color: palette.muted, fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8 }}>Trend chart</div>
                <div style={{ marginTop: 10, fontSize: 22, fontWeight: 800 }}>{league === "nba" ? "Points trend" : "Passing yards trend"}</div>
                <div style={{ marginTop: 14 }}><Sparkline values={trendValues} dark={dark} color={palette.accent} /></div>
                <div style={{ marginTop: 14, color: palette.muted }}>Last {logs.length || 0} games for {playerPrediction?.player || selectedPlayer}</div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18 }}>
              <div style={{ background: palette.panel, border: `1px solid ${palette.border}`, borderRadius: 24, boxShadow: palette.shadow, padding: 20 }}>
                <div style={{ color: palette.muted, fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8 }}>Research features</div>
                <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
                  <div style={{ background: palette.successSoft, borderRadius: 16, padding: 14 }}>
                    <div style={{ fontWeight: 800, marginBottom: 6 }}>What this dashboard emphasizes</div>
                    <div style={{ lineHeight: 1.5, color: dark ? palette.text : "#14532d" }}>
                      Player search by ID, recent form, volatility, home/away lean, fair odds, sportsbook implied probability, and edge percentage are all visible in one place.
                    </div>
                  </div>
                  <div style={{ background: palette.warnSoft, borderRadius: 16, padding: 14 }}>
                    <div style={{ fontWeight: 800, marginBottom: 6 }}>Next-level add-ons</div>
                    <div style={{ lineHeight: 1.5, color: dark ? palette.text : "#92400e" }}>
                      To add true defense-vs-position, with-player-out splits, and injury-adjusted modeling, you would plug in richer historical and lineup data.
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ background: palette.panel, border: `1px solid ${palette.border}`, borderRadius: 24, boxShadow: palette.shadow, padding: 20 }}>
                <div style={{ color: palette.muted, fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8 }}>Diagnostics</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, marginTop: 12 }}>
                  {(summaryStats || []).map((item) => (
                    <div key={item.label} style={{ background: palette.panel2, border: `1px solid ${palette.border}`, borderRadius: 16, padding: 14 }}>
                      <div style={{ color: palette.muted, fontSize: 12 }}>{item.label}</div>
                      <div style={{ marginTop: 6, fontSize: 26, fontWeight: 900 }}>{item.value}</div>
                    </div>
                  ))}
                  {selectedGameLeaders.map((leader, i) => (
                    <div key={`${leader}-${i}`} style={{ gridColumn: "1 / -1", background: palette.panel2, border: `1px solid ${palette.border}`, borderRadius: 16, padding: 14 }}>
                      <div style={{ color: palette.muted, fontSize: 12 }}>Game leader note</div>
                      <div style={{ marginTop: 6, fontSize: 16, fontWeight: 700 }}>{leader}</div>
                    </div>
                  ))}
                  {playerPrediction?.diagnostics && Object.entries(playerPrediction.diagnostics).map(([key, value]) => (
                    <div key={key} style={{ background: palette.panel2, border: `1px solid ${palette.border}`, borderRadius: 16, padding: 14 }}>
                      <div style={{ color: palette.muted, fontSize: 12 }}>{formatStatLabel(key)}</div>
                      <div style={{ marginTop: 6, fontSize: 22, fontWeight: 800 }}>{String(value)}</div>
                    </div>
                  ))}
                  {selectedGame && (
                    <div style={{ gridColumn: "1 / -1", background: palette.panel2, border: `1px solid ${palette.border}`, borderRadius: 16, padding: 14 }}>
                      <div style={{ color: palette.muted, fontSize: 12 }}>Selected game</div>
                      <div style={{ marginTop: 6, fontSize: 18, fontWeight: 800 }}>{selectedGame.away.team} @ {selectedGame.home.team}</div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div style={{ background: palette.panel, border: `1px solid ${palette.border}`, borderRadius: 24, boxShadow: palette.shadow, padding: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
                <div>
                  <div style={{ color: palette.muted, fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8 }}>Box score</div>
                  <div style={{ marginTop: 6, fontSize: 24, fontWeight: 800 }}>Live player stats</div>
                </div>
                <div style={{ color: palette.muted }}>{loadingBundle ? "Loading live stats..." : `${boxScore.length} rows`}</div>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: palette.muted, borderBottom: `1px solid ${palette.border}` }}>
                      {boxScore[0] && Object.keys(boxScore[0]).map((key) => <th key={key} style={{ padding: "12px 10px", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>{formatStatLabel(key)}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {boxScore.map((row, i) => <tr key={`${row.player}-${row.team}-${i}`} style={{ borderBottom: `1px solid ${palette.border}` }}>{Object.keys(boxScore[0] || {}).map((key) => <td key={key} style={{ padding: "12px 10px", whiteSpace: "nowrap" }}>{String(row[key] ?? "")}</td>)}</tr>)}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={{ background: palette.panel, border: `1px solid ${palette.border}`, borderRadius: 24, boxShadow: palette.shadow, padding: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
                <div>
                  <div style={{ color: palette.muted, fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8 }}>Player logs</div>
                  <div style={{ marginTop: 6, fontSize: 24, fontWeight: 800 }}>Recent game-by-game trend</div>
                </div>
                <div style={{ color: palette.muted }}>{logs.length} games</div>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: palette.muted, borderBottom: `1px solid ${palette.border}` }}>
                      {logs[0] && Object.keys(logs[0]).map((key) => <th key={key} style={{ padding: "12px 10px", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>{formatStatLabel(key)}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((row, i) => <tr key={`${row.player}-${row.date}-${i}`} style={{ borderBottom: `1px solid ${palette.border}` }}>{Object.keys(logs[0] || {}).map((key) => <td key={key} style={{ padding: "12px 10px", whiteSpace: "nowrap" }}>{String(row[key] ?? "")}</td>)}</tr>)}
                  </tbody>
                </table>
              </div>
            </div>

            {showDebug && (
              <div style={{ background: palette.panel, border: `1px solid ${palette.border}`, borderRadius: 24, boxShadow: palette.shadow, padding: 20 }}>
                <div style={{ color: palette.muted, fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 }}>Debug output</div>
                <pre style={{ margin: 0, overflowX: "auto", background: palette.panel2, border: `1px solid ${palette.border}`, borderRadius: 16, padding: 16, color: palette.text }}>
                  {JSON.stringify({ selectedGame, selectedPlayerId, winPrediction, playerPrediction, bestBets, featuredOddsEvent }, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
