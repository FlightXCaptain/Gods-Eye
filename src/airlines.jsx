/* Airlines client — loads the /api/airlines dataset once per session and
   exposes resolvers that turn an aircraft callsign into a proper
   airline name + flight-number readout for the dossier.

   A callsign from the ADS-B feed looks like "UAL1234" or "DLH0200":
     - First 3 letters = ICAO airline designator (UAL → United,
       DLH → Lufthansa). The airlines dataset maps this to a
       human name + country + their radio callsign + IATA code.
     - Remaining characters = the airline's internal flight number.
       Carriers typically re-use the same number for the same
       origin-destination pairing, so surfacing it gives a power
       user enough to look up dep/arr on any flight tracker even
       when our own route endpoint has nothing.

   Callsigns outside this format (tail numbers for private aircraft,
   MEDEVAC/LIFEGUARD/etc. free-form) pass through untouched — we just
   report "—" for the airline and leave the callsign as-is. */

(function () {
  let AIRLINES = null;
  let loading = null;

  async function load() {
    if (AIRLINES) return AIRLINES;
    if (loading)  return loading;
    loading = (async () => {
      try {
        const r = await fetch('/api/airlines', { cache: 'force-cache' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        AIRLINES = j?.airlines || null;
        console.log(`[airlines] ${j?.count ?? 0} airlines loaded`);
        return AIRLINES;
      } catch (e) {
        console.warn('[airlines] load failed', e);
        AIRLINES = {};
        return AIRLINES;
      }
    })();
    return loading;
  }

  // Kick off the fetch right away — the data is small and useful for
  // every flight dossier, so we shouldn't wait for the first click.
  load();

  // Parse "UAL1234" / "DLH 200 " → { icao: "UAL", flightNumber: "1234" }.
  // Returns null for anything that doesn't look like an airline callsign
  // (no leading 3-letter prefix or no digits after it). Tail numbers
  // ("N123AB", "V-117", "D-AIBL") intentionally fail this check.
  function parseCallsign(raw) {
    if (!raw) return null;
    const cs = String(raw).trim().toUpperCase();
    const m = cs.match(/^([A-Z]{3})(\d+[A-Z0-9]*)$/);
    if (!m) return null;
    return { icao: m[1], flightNumber: m[2] };
  }

  // Resolve callsign → { airline, flightNumber, displayNumber }.
  //   airline      → { name, iata, callsign, country, icao }  or null
  //   flightNumber → raw numeric part (e.g. "1234")            or null
  //   displayNumber → "UA1234" (IATA preferred) or "UAL1234"  or null
  //
  // Returns null (not a partial object) for callsigns that don't parse
  // as airline+number — caller should skip the airline row entirely.
  window.resolveAirline = (callsign) => {
    const parsed = parseCallsign(callsign);
    if (!parsed || !AIRLINES) return null;
    const airline = AIRLINES[parsed.icao];
    if (!airline) return null;
    const display = airline.iata
      ? `${airline.iata}${parsed.flightNumber}`
      : `${parsed.icao}${parsed.flightNumber}`;
    return {
      airline: { ...airline, icao: parsed.icao },
      flightNumber: parsed.flightNumber,
      displayNumber: display,
    };
  };

  // For consumers that just want the name quickly (e.g. tooltips) —
  // returns a short string, or null if we can't resolve.
  window.resolveAirlineName = (callsign) => {
    const r = window.resolveAirline(callsign);
    return r?.airline?.name || null;
  };
})();
