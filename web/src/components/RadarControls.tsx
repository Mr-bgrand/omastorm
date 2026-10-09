"use client";
import { useEffect, useState } from "react";
import type { Station } from "../radar/model.ts";
import type { Place } from "../radar/client.ts";
import Icon from "./Icon.tsx";
export default function RadarControls({
  search,
  choosePlace,
  chooseStation,
  locate,
  share,
}: {
  search: (q: string) => Promise<(Place | Station)[]>;
  choosePlace: (p: Place) => void;
  chooseStation: (s: Station) => void;
  locate: () => void;
  share: () => void;
}) {
  const [query, setQuery] = useState(""),
    [results, setResults] = useState<(Place | Station)[]>([]),
    [searching, setSearching] = useState(false),
    [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      if (!query.trim()) {
        setResults([]);
        return;
      }
      setSearching(true);
      search(query).then((r) => {
        if (alive) {
          setResults(r);
          setSearching(false);
        }
      });
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, search]);
  return (
    <div className="utility-row">
      <div className="search-wrap">
        <Icon name="search" />
        <input
          aria-label="City or radar station"
          placeholder="City or radar station"
          value={query}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
        />
        {query && (
          <button
            className="clear-search"
            aria-label="Clear search"
            onClick={() => {
              setQuery("");
              setOpen(false);
            }}
          >
            ×
          </button>
        )}
        {query && open && (
          <div className="search-results" aria-label="Search results">
            {results.map((r, i) => (
              <button
                key={("id" in r ? r.id : r.name) + i}
                onClick={() => {
                  if ("id" in r) chooseStation(r);
                  else choosePlace(r);
                  setOpen(false);
                  setQuery("");
                }}
              >
                <span>{r.name}</span>
                <small>
                  {"id" in r
                    ? r.id + " / " + r.state
                    : "CITY / " + (r.region ?? "")}
                </small>
              </button>
            ))}
            {!results.length && (
              <p>
                {searching
                  ? "Searching…"
                  : "No match. Try a station code or US city."}
              </p>
            )}
          </div>
        )}
      </div>
      <button
        className="utility-button"
        onClick={locate}
        aria-label="My location"
      >
        <Icon name="locate" />
        <span>My location</span>
      </button>
      <button
        className="utility-button"
        onClick={share}
        aria-label="Share radar"
      >
        <Icon name="share" />
        <span>Share</span>
      </button>
    </div>
  );
}
