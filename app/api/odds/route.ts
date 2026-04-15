import { NextRequest, NextResponse } from "next/server";

type League = "nba" | "nfl";

const ODDS_API_KEY =
  process.env.ODDS_API_KEY || process.env.THE_ODDS_API_KEY || "";
const ODDS_BASE =
  process.env.ODDS_API_BASE || process.env.THE_ODDS_API_BASE || "https://api.the-odds-api.com/v4";

function getSportKey(league: League) {
  return league === "nba" ? "basketball_nba" : "americanfootball_nfl";
}

async function fetchJson(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Odds fetch failed (${res.status}): ${text || url}`);
  }
  return res.json();
}

export async function GET(req: NextRequest) {
  try {
    if (!ODDS_API_KEY) {
      return NextResponse.json(
        { error: "Missing ODDS_API_KEY in .env.local" },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(req.url);
    const league = (searchParams.get("league") || "nba") as League;
    const mode = searchParams.get("mode") || "featured";
    const eventId = searchParams.get("eventId") || "";

    if (!["nba", "nfl"].includes(league)) {
      return NextResponse.json(
        { error: "league must be nba or nfl" },
        { status: 400 }
      );
    }

    const sport = getSportKey(league);

    if (mode === "featured") {
      const url =
        `${ODDS_BASE}/sports/${sport}/odds` +
        `?apiKey=${encodeURIComponent(ODDS_API_KEY)}` +
        `&regions=us` +
        `&markets=h2h,spreads,totals` +
        `&oddsFormat=american`;

      const odds = await fetchJson(url);

      return NextResponse.json({
        league,
        mode: "featured",
        odds,
        generatedAt: new Date().toISOString(),
      });
    }

    if (mode === "props") {
      if (!eventId) {
        return NextResponse.json(
          { error: "eventId is required for mode=props" },
          { status: 400 }
        );
      }

      const propMarkets =
        league === "nba"
          ? [
              "player_points",
              "player_rebounds",
              "player_assists",
              "player_threes",
              "player_points_rebounds_assists",
            ]
          : [
              "player_pass_yds",
              "player_pass_tds",
              "player_rush_yds",
              "player_reception_yds",
              "player_anytime_td",
            ];

      const url =
        `${ODDS_BASE}/sports/${sport}/events/${encodeURIComponent(eventId)}/odds` +
        `?apiKey=${encodeURIComponent(ODDS_API_KEY)}` +
        `&regions=us` +
        `&markets=${encodeURIComponent(propMarkets.join(","))}` +
        `&oddsFormat=american`;

      const odds = await fetchJson(url);

      return NextResponse.json({
        league,
        mode: "props",
        eventId,
        odds,
        generatedAt: new Date().toISOString(),
      });
    }

    return NextResponse.json(
      { error: "mode must be featured or props" },
      { status: 400 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to fetch odds" },
      { status: 500 }
    );
  }
}