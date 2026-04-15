"use client";

import React, { useEffect, useMemo, useState } from "react";

type League = "nba" | "nfl";
type ThemeMode = "light" | "dark";

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

type PlayerSearchResult = {
  id: string;
  name: string;
  team?: string;
  league: League;
};

type WinPrediction = {
  favoredTeam: string;
  favoredAbbr: string;
  winProbability: number;
  confidence: "low" | "medium" | "high" | string;
  fairAmericanOdds: number;
  explanation: string;
  drivers: string[];
};

type PlayerPrediction = {
  player: string;
  league: League;
  confidence: "low" | "medium" | "high" | string;
  explanation: string;
  stats: Record<string, number>;
  ranges: Record<string, [number, number]>;
  features: Record<string, string | number>;
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
  confidence: string;
  fairAmericanOdds: number;
  explanation: string;
  drivers: string[];
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

function toNumber(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
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

function getDefaultPlayer(league: League) {
  return league === "nba" ? "LeBron James" : "Patrick Mahomes";
}

function getTeamLogoUrl(league: League, abbr?: string) {
  if (!abbr) return "";
  const clean = abbr.toLowerCase();
  if (league === "nba") return `https://a.espncdn.com/i/teamlogos/nba/500/${clean}.png`;
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${clean}.png`;
}

function Sparkline({
  values,
  color = "#2563eb",
  dark = false,
}: {
  values: number[];
  color?: string;
  dark?: boolean;
}) {
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
      <polyline
        fill="none"
        stroke={dark ? "rgba(255,255,255,0.15)" : "rgba(15,23,42,0.08)"}
        strokeWidth="1"
        points={`4,${height - 6} ${width - 4},${height - 6}`}
      />
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
      />
      {values.map((v, i) => {
        const x = (i / Math.max(values.length - 1, 1)) * (width - 8) + 4;
        const y = height - ((v - min) / span) * (height - 12) - 6;
        return <circle key={`${v}-${i}`} cx={x} cy={y} r="3" fill={color} />;
      })}
    </svg>
  );
}

function TeamBadge({
  league,
  abbr,
  team,
  size = 34,
}: {
  league: League;
  abbr?: string;
  team?: string;
  size?: number;
}) {
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

function formatMoneyline(odds: number) {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

export default function Page() {
  const [league, setLeague] = useState<League>("nba");
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [games, setGames] = useState<Game[]>([]);
  const [selectedGameId, setSelectedGameId] = useState("");
  const [boxScore, setBoxScore] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [winPrediction, setWinPrediction] = useState<WinPrediction | null>(null);
  const [playerPrediction, setPlayerPrediction] = useState<PlayerPrediction | null>(null);
  const [bestBets, setBestBets] = useState<EdgeBet[]>([]);
  const [playerQuery, setPlayerQuery] = useState(getDefaultPlayer(league));
  const [selectedPlayer, setSelectedPlayer] = useState(getDefaultPlayer(league));
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [playerResults, setPlayerResults] = useState<PlayerSearchResult[]>([]);
  const [showPlayerResults, setShowPlayerResults] = useState(false);
  const [loadingGames, setLoadingGames] = useState(false);
  const [loadingBundle, setLoadingBundle] = useState(false);
  const [searchingPlayers, setSearchingPlayers] = useState(false);
  const [error, setError] = useState("");

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

  const localPlayers = useMemo<PlayerSearchResult[]>(() => {
    return league === "nba"
      ? [
          { id: "2544", name: "LeBron James", team: "LAL", league: "nba" },
          { id: "201939", name: "Stephen Curry", team: "GSW", league: "nba" },
          { id: "1628369", name: "Jayson Tatum", team: "BOS", league: "nba" },
          { id: "203507", name: "Giannis Antetokounmpo", team: "MIL", league: "nba" },
          { id: "1629029", name: "Luka Doncic", team: "DAL", league: "nba" },
          { id: "202681", name: "Kyrie Irving", team: "DAL", league: "nba" },
          { id: "203954", name: "Joel Embiid", team: "PHI", league: "nba" },
          { id: "1628983", name: "Shai Gilgeous-Alexander", team: "OKC", league: "nba" },
          { id: "1627759", name: "Nikola Jokic", team: "DEN", league: "nba" },
          { id: "203999", name: "Nikola Vucevic", team: "CHI", league: "nba" },
        ]
      : [
          { id: "15860", name: "Patrick Mahomes", team: "KC", league: "nfl" },
          { id: "3918298", name: "Josh Allen", team: "BUF", league: "nfl" },
          { id: "4047156", name: "Jalen Hurts", team: "PHI", league: "nfl" },
          { id: "3929630", name: "Lamar Jackson", team: "BAL", league: "nfl" },
          { id: "4036134", name: "Joe Burrow", team: "CIN", league: "nfl" },
          { id: "4240564", name: "Dak Prescott", team: "DAL", league: "nfl" },
          { id: "4230540", name: "Justin Herbert", team: "LAC", league: "nfl" },
          { id: "4259547", name: "Tua Tagovailoa", team: "MIA", league: "nfl" },
          { id: "16722", name: "Tyreek Hill", team: "MIA", league: "nfl" },
          { id: "4047646", name: "Christian McCaffrey", team: "SF", league: "nfl" },
        ];
  }, [league]);

  const selectedGame = useMemo(
    () => games.find((g) => g.id === selectedGameId) || null,
    [games, selectedGameId]
  );

  useEffect(() => {
    const next = getDefaultPlayer(league);
    setPlayerQuery(next);
    setSelectedPlayer(next);
    setSelectedPlayerId("");
    setPlayerResults([]);
    setShowPlayerResults(false);
    setBestBets([]);
  }, [league]);

  useEffect(() => {
    async function loadGames() {
      try {
        setLoadingGames(true);
        setError("");
        const data = await fetchJson(`/api/sports?league=${league}&type=games`);
        const nextGames = Array.isArray(data.games) ? data.games : [];
        setGames(nextGames);
        setSelectedGameId((current) => {
          if (current && nextGames.some((g: Game) => g.id === current)) return current;
          return nextGames[0]?.id || "";
        });
      } catch (err: any) {
        setError(err.message || "Failed to load games");
      } finally {
        setLoadingGames(false);
      }
    }
    loadGames();
  }, [league]);

  useEffect(() => {
    const q = playerQuery.trim().toLowerCase();

    if (!showPlayerResults) return;

    if (q.length < 1) {
      setPlayerResults(localPlayers.slice(0, 8));
      return;
    }

    const t = setTimeout(async () => {
      setSearchingPlayers(true);
      try {
        const localMatches = localPlayers.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            (p.team || "").toLowerCase().includes(q) ||
            p.id.includes(q)
        );

        const data = await fetchJson(
          `/api/players?league=${league}&q=${encodeURIComponent(playerQuery)}`
        );

        const apiMatches = Array.isArray(data.results) ? data.results : [];
        const merged = [...localMatches, ...apiMatches];
        const unique = Array.from(new Map(merged.map((p) => [p.id, p])).values());

        setPlayerResults(unique.slice(0, 12));
      } catch {
        const localMatches = localPlayers.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            (p.team || "").toLowerCase().includes(q) ||
            p.id.includes(q)
        );
        setPlayerResults(localMatches.slice(0, 12));
      } finally {
        setSearchingPlayers(false);
      }
    }, 150);

    return () => clearTimeout(t);
  }, [playerQuery, league, showPlayerResults, localPlayers]);

  useEffect(() => {
    if (!selectedGameId || !selectedPlayer) return;

    async function loadBundle() {
      try {
        setLoadingBundle(true);
        setError("");
        const data = await fetchJson(
          `/api/sports?league=${league}&type=bundle&gameId=${encodeURIComponent(
            selectedGameId
          )}&player=${encodeURIComponent(selectedPlayer)}&playerId=${encodeURIComponent(
            selectedPlayerId
          )}`
        );

        setBoxScore(Array.isArray(data.boxScore) ? data.boxScore : []);
        setLogs(Array.isArray(data.logs) ? data.logs : []);
        setWinPrediction(data.winPrediction || null);
        setPlayerPrediction(data.playerPrediction || null);
        setBestBets(Array.isArray(data.edges) ? data.edges : []);
      } catch (err: any) {
        setError(err.message || "Failed to load bundle");
      } finally {
        setLoadingBundle(false);
      }
    }

    loadBundle();
  }, [league, selectedGameId, selectedPlayer, selectedPlayerId]);

  useEffect(() => {
    async function loadBestBets() {
      try {
        const data = await fetchJson(
          `/api/sports?league=${league}&type=bestbets&player=${encodeURIComponent(
            selectedPlayer
          )}&playerId=${encodeURIComponent(selectedPlayerId)}`
        );
        if (Array.isArray(data.bestBets)) {
          setBestBets(data.bestBets);
        }
      } catch {
        // keep current edges from bundle if this fails
      }
    }

    loadBestBets();
  }, [league, selectedPlayer, selectedPlayerId]);

  const trendValues = useMemo(() => {
    if (!logs.length) return [] as number[];
    if (league === "nba") return logs.map((l) => toNumber(l.pts)).reverse();
    return logs.map((l) => toNumber(l.passYds)).reverse();
  }, [logs, league]);

  const summaryStats = useMemo(() => {
    if (!logs.length) return [] as { label: string; value: string }[];

    if (league === "nba") {
      return [
        { label: "Avg PTS", value: avg(logs.map((l) => toNumber(l.pts))).toFixed(1) },
        { label: "Avg REB", value: avg(logs.map((l) => toNumber(l.reb))).toFixed(1) },
        { label: "Avg AST", value: avg(logs.map((l) => toNumber(l.ast))).toFixed(1) },
        { label: "Games", value: String(logs.length) },
      ];
    }

    return [
      { label: "Avg Pass", value: avg(logs.map((l) => toNumber(l.passYds))).toFixed(1) },
      { label: "Avg Rush", value: avg(logs.map((l) => toNumber(l.rushYds))).toFixed(1) },
      { label: "Avg TD", value: avg(logs.map((l) => toNumber(l.td))).toFixed(1) },
      { label: "Games", value: String(logs.length) },
    ];
  }, [logs, league]);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: `radial-gradient(circle at top left, ${
          dark ? "rgba(37,99,235,0.18)" : "rgba(37,99,235,0.08)"
        }, transparent 28%), ${palette.bg}`,
        color: palette.text,
        padding: 20,
      }}
    >
      <div style={{ maxWidth: 1500, margin: "0 auto" }}>
        <section
          style={{
            background: `linear-gradient(135deg, ${dark ? "#0f172a" : "#ffffff"}, ${
              dark ? "#111827" : "#eff6ff"
            })`,
            border: `1px solid ${palette.border}`,
            boxShadow: palette.shadow,
            borderRadius: 24,
            padding: 24,
            marginBottom: 18,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div
                style={{
                  color: palette.muted,
                  fontSize: 13,
                  fontWeight: 700,
                  letterSpacing: 0.8,
                  textTransform: "uppercase",
                  marginBottom: 8,
                }}
              >
                AI-integrated betting research
              </div>
              <h1 style={{ margin: 0, fontSize: "clamp(30px, 5vw, 52px)", lineHeight: 1.04 }}>
                SmartSports AI Edge Dashboard
              </h1>
              <p style={{ margin: "10px 0 0", color: palette.muted, maxWidth: 900, fontSize: 16 }}>
                Search players by ID, project performance with a stronger model, compare fair odds to the market,
                and surface the biggest discrepancies as best bets.
              </p>
            </div>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button
                onClick={() => setTheme(dark ? "light" : "dark")}
                style={{
                  padding: "12px 16px",
                  borderRadius: 14,
                  border: `1px solid ${palette.border}`,
                  background: palette.panel,
                  color: palette.text,
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                {dark ? "Light mode" : "Dark mode"}
              </button>
            </div>
          </div>
        </section>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
            marginBottom: 18,
          }}
        >
          <label style={{ display: "grid", gap: 8 }}>
            <span style={{ color: palette.muted, fontSize: 13 }}>League</span>
            <select
              value={league}
              onChange={(e) => setLeague(e.target.value as League)}
              style={{
                padding: 14,
                borderRadius: 14,
                border: `1px solid ${palette.border}`,
                background: palette.panel,
                color: palette.text,
              }}
            >
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
                setShowPlayerResults(true);
              }}
              onFocus={() => {
                setShowPlayerResults(true);
                setPlayerResults(localPlayers.slice(0, 8));
              }}
              placeholder={getDefaultPlayer(league)}
              autoComplete="off"
              spellCheck={false}
              style={{
                padding: 14,
                borderRadius: 14,
                border: `1px solid ${palette.border}`,
                background: palette.panel,
                color: palette.text,
                outline: "none",
              }}
            />

            {showPlayerResults && (
              <div
                style={{
                  position: "absolute",
                  top: 72,
                  left: 0,
                  right: 0,
                  zIndex: 50,
                  background: palette.panel,
                  border: `1px solid ${palette.border}`,
                  borderRadius: 14,
                  overflow: "hidden",
                  boxShadow: palette.shadow,
                  maxHeight: 320,
                  overflowY: "auto",
                }}
              >
                {searchingPlayers && (
                  <div style={{ padding: 12, color: palette.muted }}>Searching...</div>
                )}

                {!searchingPlayers && playerResults.length === 0 && (
                  <div style={{ padding: 12, color: palette.muted }}>No results found</div>
                )}

                {!searchingPlayers &&
                  playerResults.map((result) => (
                    <button
                      key={`${result.id}-${result.name}`}
                      onClick={() => {
                        setSelectedPlayer(result.name);
                        setPlayerQuery(result.name);
                        setSelectedPlayerId(result.id);
                        setShowPlayerResults(false);
                      }}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: 12,
                        background: "transparent",
                        color: palette.text,
                        border: "none",
                        borderBottom: `1px solid ${palette.border}`,
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ fontWeight: 700 }}>{result.name}</div>
                      <div style={{ color: palette.muted, fontSize: 13 }}>
                        {result.team || result.id}
                      </div>
                    </button>
                  ))}
              </div>
            )}
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <span style={{ color: palette.muted, fontSize: 13 }}>Selected player</span>
            <div
              style={{
                padding: 14,
                borderRadius: 14,
                border: `1px solid ${palette.border}`,
                background: palette.panel,
                color: palette.text,
                fontWeight: 600,
              }}
            >
              {selectedPlayer}
              {selectedPlayerId ? ` · ID ${selectedPlayerId}` : ""}
            </div>
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <span style={{ color: palette.muted, fontSize: 13 }}>Status</span>
            <div
              style={{
                padding: 14,
                borderRadius: 14,
                border: `1px solid ${palette.border}`,
                background: error ? palette.warnSoft : palette.successSoft,
                color: dark ? palette.text : "#0f172a",
                fontWeight: 600,
              }}
            >
              {loadingGames || loadingBundle ? "Refreshing live data..." : error ? "Partial data available" : "Live and healthy"}
            </div>
          </div>
        </section>

        {error && (
          <div
            style={{
              background: palette.warnSoft,
              border: `1px solid ${palette.border}`,
              color: dark ? "#fde68a" : "#92400e",
              padding: 14,
              borderRadius: 16,
              marginBottom: 18,
              fontWeight: 600,
            }}
          >
            Some free endpoints may be missing data. The dashboard will still show predictions and best-bet candidates.
          </div>
        )}

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(300px, 420px) minmax(0, 1fr)",
            gap: 18,
          }}
        >
          <div style={{ display: "grid", gap: 18 }}>
            <div
              style={{
                background: palette.panel,
                border: `1px solid ${palette.border}`,
                borderRadius: 24,
                boxShadow: palette.shadow,
                overflow: "hidden",
              }}
            >
              <div style={{ padding: 18, borderBottom: `1px solid ${palette.border}` }}>
                <div style={{ fontSize: 22, fontWeight: 800 }}>Today’s Games</div>
                <div style={{ color: palette.muted, marginTop: 6 }}>
                  Select a matchup to drive predictions and odds matching.
                </div>
              </div>

              <div style={{ padding: 12, display: "grid", gap: 12, maxHeight: 720, overflow: "auto" }}>
                {games.map((game) => {
                  const active = game.id === selectedGameId;
                  return (
                    <button
                      key={game.id}
                      onClick={() => setSelectedGameId(game.id)}
                      style={{
                        textAlign: "left",
                        background: active ? palette.accentSoft : palette.panel2,
                        border: active ? `2px solid ${palette.accent}` : `1px solid ${palette.border}`,
                        borderRadius: 18,
                        padding: 16,
                        cursor: "pointer",
                        color: palette.text,
                      }}
                    >
                      <div style={{ display: "grid", gap: 12 }}>
                        {[game.away, game.home].map((team) => (
                          <div
                            key={team.abbr}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 10,
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                              <TeamBadge league={league} abbr={team.abbr} team={team.team} />
                              <div style={{ minWidth: 0 }}>
                                <div
                                  style={{
                                    fontWeight: 700,
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                  }}
                                >
                                  {team.team}
                                </div>
                                <div style={{ color: palette.muted, fontSize: 12 }}>{team.abbr}</div>
                              </div>
                            </div>
                            <div style={{ fontWeight: 800, fontSize: 28 }}>{team.score}</div>
                          </div>
                        ))}
                      </div>
                      <div
                        style={{
                          marginTop: 14,
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 12,
                          color: palette.muted,
                          fontSize: 13,
                          flexWrap: "wrap",
                        }}
                      >
                        <span>{game.date}</span>
                        <span>{game.status}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gap: 18 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                gap: 18,
              }}
            >
              <div
                style={{
                  background: palette.panel,
                  border: `1px solid ${palette.border}`,
                  borderRadius: 24,
                  boxShadow: palette.shadow,
                  padding: 20,
                }}
              >
                <div
                  style={{
                    color: palette.muted,
                    fontSize: 13,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: 0.8,
                  }}
                >
                  Win predictor
                </div>
                <div style={{ marginTop: 10, fontSize: 28, fontWeight: 800 }}>
                  {winPrediction ? `${winPrediction.favoredTeam} ${winPrediction.winProbability}%` : "Waiting for game"}
                </div>
                <div style={{ marginTop: 10, color: palette.muted, lineHeight: 1.5 }}>
                  {winPrediction?.explanation || "Select a game to view model output."}
                </div>
                {winPrediction && (
                  <div style={{ marginTop: 12, color: palette.muted }}>
                    Fair line: {formatMoneyline(winPrediction.fairAmericanOdds)}
                  </div>
                )}
              </div>

              <div
                style={{
                  background: palette.panel,
                  border: `1px solid ${palette.border}`,
                  borderRadius: 24,
                  boxShadow: palette.shadow,
                  padding: 20,
                }}
              >
                <div
                  style={{
                    color: palette.muted,
                    fontSize: 13,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: 0.8,
                  }}
                >
                  Player predictor
                </div>
                <div style={{ marginTop: 10, fontSize: 28, fontWeight: 800 }}>
                  {playerPrediction?.player || selectedPlayer || "No player selected"}
                </div>
                <div style={{ marginTop: 10, color: palette.muted, lineHeight: 1.5 }}>
                  {playerPrediction?.explanation || "Player forecast appears here when logs are available."}
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
                    gap: 10,
                    marginTop: 16,
                  }}
                >
                  {playerPrediction &&
                    Object.entries(playerPrediction.stats).map(([key, value]) => (
                      <div
                        key={key}
                        style={{
                          background: palette.panel2,
                          border: `1px solid ${palette.border}`,
                          borderRadius: 16,
                          padding: 12,
                        }}
                      >
                        <div style={{ color: palette.muted, fontSize: 12 }}>{formatStatLabel(key)}</div>
                        <div style={{ marginTop: 6, fontSize: 20, fontWeight: 800 }}>{String(value)}</div>
                      </div>
                    ))}
                </div>
              </div>
            </div>

            <div
              style={{
                background: palette.panel,
                border: `1px solid ${palette.border}`,
                borderRadius: 24,
                boxShadow: palette.shadow,
                padding: 20,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                  alignItems: "center",
                  marginBottom: 12,
                }}
              >
                <div>
                  <div
                    style={{
                      color: palette.muted,
                      fontSize: 13,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: 0.8,
                    }}
                  >
                    Best bets
                  </div>
                  <div style={{ marginTop: 6, fontSize: 24, fontWeight: 800 }}>
                    Model vs market edge detection
                  </div>
                </div>
                <div style={{ color: palette.muted }}>{bestBets.length} edges found</div>
              </div>

              <div style={{ display: "grid", gap: 12 }}>
                {bestBets.map((bet, i) => (
                  <div
                    key={`${bet.market}-${bet.selection}-${bet.sportsbook}-${i}`}
                    style={{
                      background: palette.panel2,
                      border: `1px solid ${palette.border}`,
                      borderRadius: 18,
                      padding: 16,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <div>
                        <div style={{ fontSize: 18, fontWeight: 800 }}>
                          {bet.market}: {bet.selection}
                        </div>
                        <div style={{ color: palette.muted, marginTop: 4 }}>
                          {bet.sportsbook} · {formatMoneyline(bet.oddsAmerican)}
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 24, fontWeight: 900, color: confidenceColor(bet.confidence) }}>
                          +{bet.edgePct}%
                        </div>
                        <div style={{ color: palette.muted }}>{String(bet.confidence).toUpperCase()} confidence</div>
                      </div>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                        gap: 10,
                        marginTop: 14,
                      }}
                    >
                      <div
                        style={{
                          background: palette.panel,
                          border: `1px solid ${palette.border}`,
                          borderRadius: 12,
                          padding: 10,
                        }}
                      >
                        <div style={{ color: palette.muted, fontSize: 12 }}>Model prob</div>
                        <div style={{ fontWeight: 800, marginTop: 4 }}>{bet.modelProb}%</div>
                      </div>
                      <div
                        style={{
                          background: palette.panel,
                          border: `1px solid ${palette.border}`,
                          borderRadius: 12,
                          padding: 10,
                        }}
                      >
                        <div style={{ color: palette.muted, fontSize: 12 }}>Implied prob</div>
                        <div style={{ fontWeight: 800, marginTop: 4 }}>{bet.marketImpliedProb}%</div>
                      </div>
                      <div
                        style={{
                          background: palette.panel,
                          border: `1px solid ${palette.border}`,
                          borderRadius: 12,
                          padding: 10,
                        }}
                      >
                        <div style={{ color: palette.muted, fontSize: 12 }}>Fair odds</div>
                        <div style={{ fontWeight: 800, marginTop: 4 }}>{formatMoneyline(bet.fairAmericanOdds)}</div>
                      </div>
                    </div>

                    <div style={{ marginTop: 12, color: palette.muted, lineHeight: 1.5 }}>
                      {bet.explanation}
                    </div>
                  </div>
                ))}

                {!bestBets.length && (
                  <div style={{ color: palette.muted }}>
                    No strong edges surfaced yet. Try another player or a game with props.
                  </div>
                )}
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                gap: 18,
              }}
            >
              <div
                style={{
                  background: palette.panel,
                  border: `1px solid ${palette.border}`,
                  borderRadius: 24,
                  boxShadow: palette.shadow,
                  padding: 20,
                }}
              >
                <div
                  style={{
                    color: palette.muted,
                    fontSize: 13,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: 0.8,
                  }}
                >
                  Trend chart
                </div>
                <div style={{ marginTop: 10, fontSize: 22, fontWeight: 800 }}>
                  {league === "nba" ? "Points trend" : "Passing yards trend"}
                </div>
                <div style={{ marginTop: 14 }}>
                  <Sparkline values={trendValues} dark={dark} color={palette.accent} />
                </div>
                <div style={{ marginTop: 14, color: palette.muted }}>
                  Last {logs.length || 0} games for {playerPrediction?.player || selectedPlayer}
                </div>
              </div>

              <div
                style={{
                  background: palette.panel,
                  border: `1px solid ${palette.border}`,
                  borderRadius: 24,
                  boxShadow: palette.shadow,
                  padding: 20,
                }}
              >
                <div
                  style={{
                    color: palette.muted,
                    fontSize: 13,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: 0.8,
                  }}
                >
                  Research snapshot
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: 12,
                    marginTop: 12,
                  }}
                >
                  {summaryStats.map((item) => (
                    <div
                      key={item.label}
                      style={{
                        background: palette.panel2,
                        border: `1px solid ${palette.border}`,
                        borderRadius: 16,
                        padding: 14,
                      }}
                    >
                      <div style={{ color: palette.muted, fontSize: 12 }}>{item.label}</div>
                      <div style={{ marginTop: 6, fontSize: 26, fontWeight: 900 }}>{item.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div
              style={{
                background: palette.panel,
                border: `1px solid ${palette.border}`,
                borderRadius: 24,
                boxShadow: palette.shadow,
                padding: 20,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                  alignItems: "center",
                  marginBottom: 12,
                }}
              >
                <div>
                  <div
                    style={{
                      color: palette.muted,
                      fontSize: 13,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: 0.8,
                    }}
                  >
                    Box score
                  </div>
                  <div style={{ marginTop: 6, fontSize: 24, fontWeight: 800 }}>Live player stats</div>
                </div>
                <div style={{ color: palette.muted }}>{loadingBundle ? "Loading live stats..." : `${boxScore.length} rows`}</div>
              </div>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: palette.muted, borderBottom: `1px solid ${palette.border}` }}>
                      {boxScore[0] &&
                        Object.keys(boxScore[0]).map((key) => (
                          <th
                            key={key}
                            style={{
                              padding: "12px 10px",
                              fontSize: 12,
                              textTransform: "uppercase",
                              letterSpacing: 0.5,
                            }}
                          >
                            {formatStatLabel(key)}
                          </th>
                        ))}
                    </tr>
                  </thead>
                  <tbody>
                    {boxScore.map((row, i) => (
                      <tr key={`${row.player}-${row.team}-${i}`} style={{ borderBottom: `1px solid ${palette.border}` }}>
                        {Object.keys(boxScore[0] || {}).map((key) => (
                          <td key={key} style={{ padding: "12px 10px", whiteSpace: "nowrap" }}>
                            {String(row[key] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div
              style={{
                background: palette.panel,
                border: `1px solid ${palette.border}`,
                borderRadius: 24,
                boxShadow: palette.shadow,
                padding: 20,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                  alignItems: "center",
                  marginBottom: 12,
                }}
              >
                <div>
                  <div
                    style={{
                      color: palette.muted,
                      fontSize: 13,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: 0.8,
                    }}
                  >
                    Player logs
                  </div>
                  <div style={{ marginTop: 6, fontSize: 24, fontWeight: 800 }}>Recent game-by-game trend</div>
                </div>
                <div style={{ color: palette.muted }}>{logs.length} games</div>
              </div>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: palette.muted, borderBottom: `1px solid ${palette.border}` }}>
                      {logs[0] &&
                        Object.keys(logs[0]).map((key) => (
                          <th
                            key={key}
                            style={{
                              padding: "12px 10px",
                              fontSize: 12,
                              textTransform: "uppercase",
                              letterSpacing: 0.5,
                            }}
                          >
                            {formatStatLabel(key)}
                          </th>
                        ))}
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((row, i) => (
                      <tr key={`${row.player}-${row.date}-${i}`} style={{ borderBottom: `1px solid ${palette.border}` }}>
                        {Object.keys(logs[0] || {}).map((key) => (
                          <td key={key} style={{ padding: "12px 10px", whiteSpace: "nowrap" }}>
                            {String(row[key] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}