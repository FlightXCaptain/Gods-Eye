/* God's Eye — app shell v2. Glass, minimal, time slider. */
/* globals React, ReactDOM, Globe, fetchQuakes, fetchISS, fetchFlights, fetchEONET,
           fetchKp, fetchAurora, fetchTsunamis, fetchSatellites, propagateSats,
           loadSatcat */
const { useState, useEffect, useRef, useMemo, useCallback } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "defaultTheme": "dark",
  "animationIntensity": 0.7,
  "showTicker": true
}/*EDITMODE-END*/;

function classNames(...a) { return a.filter(Boolean).join(' '); }

function useWindowSize() {
  const [s, set] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const on = () => set({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return s;
}

function fmtTime(ts) {
  const d = new Date(ts);
  return d.toISOString().replace('T',' ').slice(0,19) + ' UTC';
}
function fmtTimeShort(ts) {
  const d = new Date(ts);
  return d.toUTCString().slice(5,22);
}
function fmtAgo(ts) {
  const s = (Date.now()-ts)/1000;
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s/60)}m`;
  if (s < 86400) return `${Math.floor(s/3600)}h`;
  return `${Math.floor(s/86400)}d`;
}

function Icon({ name, className='w-4 h-4' }) {
  const paths = {
    sun: 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707M16 12a4 4 0 11-8 0 4 4 0 018 0z',
    moon: 'M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z',
    search: 'M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z',
    layers: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 18l9 5 9-5',
    play: 'M6 4l14 8-14 8V4z',
    pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
    x: 'M6 6l12 12M6 18L18 6',
    reset: 'M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5',
    settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zm7.4-3a7.4 7.4 0 00-.1-1.2l2-1.6-2-3.4-2.4.9a7.3 7.3 0 00-2-1.2L14.5 3h-5l-.4 2.5a7.3 7.3 0 00-2 1.2l-2.4-.9-2 3.4 2 1.6a7.4 7.4 0 000 2.4l-2 1.6 2 3.4 2.4-.9a7.3 7.3 0 002 1.2l.4 2.5h5l.4-2.5a7.3 7.3 0 002-1.2l2.4.9 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
    chevL: 'M15 18l-6-6 6-6',
    chevR: 'M9 18l6-6-6-6',
    location: 'M12 2a7 7 0 00-7 7c0 5.3 7 13 7 13s7-7.7 7-13a7 7 0 00-7-7zm0 9.5a2.5 2.5 0 110-5 2.5 2.5 0 010 5z',
    globe: 'M12 2a10 10 0 100 20 10 10 0 000-20zm0 0c2.5 3 4 6 4 10s-1.5 7-4 10m0-20c-2.5 3-4 6-4 10s1.5 7 4 10M2 12h20',
    zap: 'M13 3L4 14h7l-1 7 9-11h-7l1-7z',
    filter: 'M3 5h18M6 12h12M10 19h4',
  };
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
         strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d={paths[name]} />
    </svg>
  );
}

function ThemeToggle({ theme, onChange }) {
  return (
    <button onClick={() => onChange(theme === 'dark' ? 'light' : 'dark')}
            className="glass rounded-full p-2 transition hover:scale-105"
            title="Toggle theme">
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} className="w-4 h-4" />
    </button>
  );
}

function IconBtn({ children, onClick, active, title }) {
  return (
    <button onClick={onClick} title={title}
      className={classNames(
        'glass rounded-full p-2 transition hover:scale-105',
        active && 'ring-2 ring-accent-500/50'
      )}>
      {children}
    </button>
  );
}

function SearchBar({ onLocate, targets, theme }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const inpRef = useRef(null);
  useEffect(() => {
    const on = (e) => {
      if (e.key === '/' && !open && e.target.tagName !== 'INPUT') {
        e.preventDefault(); setOpen(true);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', on); return () => window.removeEventListener('keydown', on);
  }, [open]);
  useEffect(() => { if (open) setTimeout(()=>inpRef.current?.focus(), 50); }, [open]);

  const matches = useMemo(() => {
    if (!q.trim()) return [];
    const s = q.trim().toLowerCase();
    const coord = s.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    const out = [];
    if (coord) {
      const lat = parseFloat(coord[1]), lon = parseFloat(coord[2]);
      out.push({ type:'coord', label:`Coordinate ${lat.toFixed(3)}, ${lon.toFixed(3)}`, coords:[lon,lat] });
    }
    for (const t of targets) {
      if (t.label.toLowerCase().includes(s)) out.push(t);
      if (out.length >= 10) break;
    }
    return out;
  }, [q, targets]);

  return (
    <>
      <button onClick={()=>setOpen(true)} title="Locate (/)" className="glass rounded-full p-2 sm:pl-3 sm:pr-4 sm:py-2 flex items-center gap-2 text-sm hover:scale-[1.02] transition">
        <Icon name="search" className="w-4 h-4 opacity-70" />
        <span className="opacity-70 hidden sm:inline">Locate</span>
        <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-black/10 dark:bg-white/10 opacity-60 hidden sm:inline">/</kbd>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-28" onClick={()=>setOpen(false)}>
          <div className="absolute inset-0 bg-black/30 dark:bg-black/60 backdrop-blur-sm" />
          <div className="relative w-[min(560px,92vw)] glass-strong rounded-2xl overflow-hidden" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center gap-3 px-4 py-3 border-b border-black/5 dark:border-white/5">
              <Icon name="search" className="w-4 h-4 opacity-60" />
              <input ref={inpRef} value={q} onChange={e=>setQ(e.target.value)}
                     placeholder="name, callsign, ISS, coords like 51.5,-0.12"
                     className="bg-transparent outline-none flex-1 text-sm placeholder-black/40 dark:placeholder-white/40"/>
              <kbd className="font-mono text-[10px] opacity-50">ESC</kbd>
            </div>
            <div className="max-h-80 overflow-y-auto scroll">
              {matches.length === 0 && q && (
                <div className="px-4 py-6 text-center text-sm opacity-50">No results</div>
              )}
              {matches.map((m,i)=>(
                <button key={i} onClick={()=>{onLocate(m); setOpen(false); setQ('');}}
                        className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-black/5 dark:hover:bg-white/5 transition">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center bg-accent-500/15 text-accent-500">
                    <Icon name={m.type==='iss'?'zap':m.type==='flight'?'globe':'location'} className="w-3.5 h-3.5"/>
                  </div>
                  <div className="flex-1">
                    <div className="text-sm">{m.label}</div>
                    {m.sub && <div className="text-[11px] opacity-60 font-mono">{m.sub}</div>}
                  </div>
                  <div className="font-mono text-[10px] opacity-40 uppercase">{m.type}</div>
                </button>
              ))}
              {!q && (
                <div className="px-4 py-3 text-[11px] opacity-50 font-mono space-y-1">
                  <div>Try: ISS · UAL1 · 51.5,-0.12 · Tokyo · 7.0</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Tiny inline SVG icons that match what globe2.jsx draws, for use in the
// layers popover and legend. Each returns a 14×14 svg with stroke/fill set.
const GlyphSVG = ({ kind, color = 'currentColor', size = 14 }) => {
  const s = size;
  const props = { width: s, height: s, viewBox: '0 0 14 14', fill: 'none' };
  switch (kind) {
    case 'flight':
      return (
        <svg {...props}>
          <path d="M7 1.5 L7.6 5.2 L12.5 7 L7.6 7.4 L7.5 11 L8.8 11.8 L7 11.4 L5.2 11.8 L6.5 11 L6.4 7.4 L1.5 7 L6.4 5.2 Z"
            fill={color} stroke={color} strokeWidth="0.4"/>
        </svg>
      );
    case 'sat':
      return (
        <svg {...props}>
          {/* body */}
          <rect x="5.8" y="5.5" width="2.4" height="3" fill={color}/>
          {/* panels */}
          <rect x="1"   y="6"   width="3.5" height="2" fill={color}/>
          <rect x="9.5" y="6"   width="3.5" height="2" fill={color}/>
        </svg>
      );
    case 'ship':
      return (
        <svg {...props}>
          {/* Hull: bow up, squared stern */}
          <path d="M7 1.5 L9 5 L9 11 L5 11 L5 5 Z" fill={color}/>
          {/* Waterline */}
          <path d="M3 11.5 L11 11.5" stroke={color} strokeWidth="0.5" opacity="0.5"/>
        </svg>
      );
    case 'iss':
      return (
        <svg {...props}>
          <rect x="6" y="5" width="2" height="4" fill={color}/>
          <rect x="0.5" y="6" width="4.5" height="2" fill={color}/>
          <rect x="9" y="6" width="4.5" height="2" fill={color}/>
          <circle cx="7" cy="7" r="0.8" fill={color}/>
        </svg>
      );
    case 'quake':
      return (
        <svg {...props}>
          <circle cx="7" cy="7" r="4" stroke={color} strokeWidth="1" strokeDasharray="2 2"/>
          <circle cx="7" cy="7" r="1.4" fill={color}/>
        </svg>
      );
    case 'fire':
      return (
        <svg {...props}>
          <path d="M7 2 C9.2 5 9 7.5 7 11 C5 7.5 4.8 5 7 2 Z" fill={color}/>
        </svg>
      );
    case 'volcano':
      return (
        <svg {...props}>
          <path d="M2 10 L5.5 5 L8.5 5 L12 10 Z" fill={color}/>
          <circle cx="7" cy="3.5" r="0.6" fill={color}/>
          <circle cx="5.5" cy="4.5" r="0.4" fill={color}/>
          <circle cx="8.5" cy="4.5" r="0.4" fill={color}/>
        </svg>
      );
    case 'storm':
      return (
        <svg {...props}>
          <path d="M7 2 Q11 3 11 7 Q11 11 7 11 Q4 11 4 8 Q4 6 6 6 Q7.5 6 7.5 7.5"
            stroke={color} strokeWidth="1.1" fill="none" strokeLinecap="round"/>
        </svg>
      );
    case 'ice':
      return (
        <svg {...props}>
          <line x1="7"   y1="2"   x2="7"   y2="12" stroke={color} strokeWidth="1"/>
          <line x1="2.7" y1="4.4" x2="11.3" y2="9.6" stroke={color} strokeWidth="1"/>
          <line x1="2.7" y1="9.6" x2="11.3" y2="4.4" stroke={color} strokeWidth="1"/>
        </svg>
      );
    case 'tsunami':
      return (
        <svg {...props}>
          <path d="M1 5 Q3 3.5 5 5 T9 5 T13 5" stroke={color} strokeWidth="1" fill="none"/>
          <path d="M1 7 Q3 5.5 5 7 T9 7 T13 7" stroke={color} strokeWidth="1" fill="none"/>
          <path d="M1 9 Q3 7.5 5 9 T9 9 T13 9" stroke={color} strokeWidth="1" fill="none"/>
        </svg>
      );
    case 'aurora':
      return (
        <svg {...props}>
          <path d="M1 10 Q4 3 7 7 T13 5" stroke={color} strokeWidth="1" fill="none"/>
          <path d="M1 11 Q4 6 7 9 T13 8" stroke={color} strokeWidth="0.7" fill="none" opacity="0.6"/>
        </svg>
      );
    case 'wiki':
      return (
        <svg {...props}>
          <circle cx="7" cy="7" r="1.5" fill={color}/>
          <circle cx="7" cy="7" r="4" stroke={color} strokeWidth="0.8" opacity="0.4"/>
        </svg>
      );
    default: return <svg {...props}><circle cx="7" cy="7" r="2" fill={color}/></svg>;
  }
};

function LayersPopover({ layers, setLayers, theme }) {
  const [open, setOpen] = useState(false);
  const items = [
    ['flights','Flights', 'flight',  '#7dd3fc'],
    ['ships','Ships',     'ship',    '#22d3ee'],
    ['sats','Satellites', 'sat',     '#d946ef'],
    ['iss','ISS',         'iss',     '#f43f5e'],
    ['quakes','Seismic',  'quake',   '#fb923c'],
    ['events','Natural events', 'fire', '#ef4444'],
    ['aurora','Aurora',   'aurora',  '#84cca3'],
    ['tsunamis','Tsunami archive', 'tsunami', '#22d3ee'],
  ];
  return (
    <div className="relative">
      <IconBtn onClick={()=>setOpen(o=>!o)} active={open} title="Layers">
        <Icon name="layers" />
      </IconBtn>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={()=>setOpen(false)} />
          <div className="absolute z-50 top-12 right-0 w-60 glass-strong rounded-2xl p-3">
            <div className="text-[10px] uppercase font-mono opacity-50 mb-2 tracking-wider">Layers</div>
            <div className="space-y-0.5">
              {items.map(([k,label,glyph,col])=>(
                <label key={k} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer">
                  <input type="checkbox" checked={!!layers[k]}
                         onChange={e=>setLayers(x=>({...x,[k]:e.target.checked}))}
                         className="accent-accent-500"/>
                  <span className="shrink-0 w-4 h-4 flex items-center justify-center" style={{ color: col }}>
                    <GlyphSVG kind={glyph} color={col} size={14}/>
                  </span>
                  <span className="text-sm flex-1">{label}</span>
                </label>
              ))}
            </div>

            {/* Natural events sub-legend — only if events layer is on */}
            {layers.events && (
              <div className="mt-2 pt-2 border-t border-black/5 dark:border-white/5 px-2">
                <div className="text-[9px] uppercase font-mono opacity-40 tracking-wider mb-1.5">Event types</div>
                <div className="grid grid-cols-2 gap-y-1 gap-x-3 text-[11px]">
                  {[
                    ['fire','Wildfire','#ef4444'],
                    ['volcano','Volcano','#f97316'],
                    ['storm','Storm','#38bdf8'],
                    ['ice','Ice','#a5f3fc'],
                  ].map(([g,l,c]) => (
                    <div key={g} className="flex items-center gap-1.5 opacity-80">
                      <GlyphSVG kind={g} color={c} size={12}/>
                      <span>{l}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, accent, title }) {
  return (
    <div className="group flex items-center gap-1.5 cursor-help" title={title}>
      <div className={classNames("w-1.5 h-1.5 rounded-full bpulse", accent || "bg-accent-500")}/>
      <span className="text-[10px] uppercase font-mono opacity-60 tracking-wider">{label}</span>
      <span className="text-xs font-mono tabular-nums">{value}</span>
    </div>
  );
}

function StatBar({ data, kp }) {
  const flightCount = data.flights?.length || 0;
  const shipCount = data.ships?.length || 0;
  const quakeCount = data.quakes?.length || 0;
  const eventCount = data.events?.length || 0;
  const satCount = data.sats?.length || 0;
  // `tier` controls mobile truncation:
  //   0 = always visible (phones through desktop)
  //   1 = shown at sm: breakpoint and up (≥640px)
  //   2 = shown at md: breakpoint and up (≥768px)
  const items = [
    { label: 'Flights',      short: 'Flights', shortMobile: 'FLT', tier: 0, val: flightCount.toLocaleString(), glyph: 'flight', color: '#7dd3fc', title: 'Aircraft currently airborne (ADS-B via airplanes.live)' },
    { label: 'Ships',        short: 'Ships',   shortMobile: 'SHP', tier: 0, val: shipCount.toLocaleString(),   glyph: 'ship',   color: '#22d3ee', title: 'Vessels at sea (AIS via AISStream)' },
    { label: 'Satellites',   short: 'Sats',    shortMobile: 'SAT', tier: 0, val: satCount.toLocaleString(),    glyph: 'sat',    color: '#d946ef', title: 'Orbital objects propagated from CelesTrak TLEs' },
    { label: 'Earthquakes',  short: 'Quakes',  shortMobile: 'SEI', tier: 1, val: quakeCount,                   glyph: 'quake',  color: '#fb923c', title: 'Seismic events in the last 24h (USGS)' },
    { label: 'Natural events', short: 'Nature',shortMobile: 'NAT', tier: 2, val: eventCount,                   glyph: 'fire',   color: '#ef4444', title: 'Active storms, wildfires, volcanoes, ice (NASA EONET)' },
    { label: 'Geomagnetic',  short: 'Kp',      shortMobile: 'Kp',  tier: 1, val: kp?.kp?.toFixed(1) ?? '—',    glyph: 'aurora', color: kp?.kp >= 5 ? '#ef4444' : '#84cca3', title: 'Planetary K-index — geomagnetic activity (NOAA SWPC). 5+ = storm' },
  ];
  const visClass = t => t === 0 ? 'flex' : t === 1 ? 'hidden sm:flex' : 'hidden md:flex';
  return (
    <div className="glass rounded-full pl-2 pr-2.5 sm:pr-3 py-1.5 flex items-center gap-2 sm:gap-3 text-xs relative overflow-x-auto scrollbar-none max-w-full">
      {items.map((it, i) => (
        <React.Fragment key={it.label}>
          {i > 0 && <div className={classNames('w-px h-3 bg-current opacity-10 shrink-0', visClass(it.tier))}/>}
          <div title={it.title} className={classNames('items-center gap-1.5 cursor-help shrink-0', visClass(it.tier))}>
            <span className="inline-flex items-center justify-center" style={{ color: it.color }}>
              <GlyphSVG kind={it.glyph} color={it.color} size={12}/>
            </span>
            {/* Short label always visible — mobile shows a 3-char abbreviation
                so the number has a recognisable prefix; desktop gets the full
                label back. */}
            <span className="text-[10px] uppercase font-mono opacity-60 tracking-wider hidden sm:inline">{it.short}</span>
            <span className="text-[10px] uppercase font-mono opacity-60 tracking-wider sm:hidden">{it.shortMobile}</span>
            <span className="font-mono tabular-nums">{it.val}</span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

function Dossier({ item, onClose }) {
  if (!item) return null;
  const layer = item._layer || item.kind;
  return (
    <div className="glass-strong rounded-2xl w-[320px] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-black/5 dark:border-white/5">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-accent-500 bpulse"/>
          <span className="text-[10px] uppercase font-mono opacity-60 tracking-widest">
            {layer === 'iss' ? 'Orbital'
              : layer === 'flight' ? 'Aircraft'
              : layer === 'ship' ? 'Vessel'
              : layer === 'quake' ? 'Seismic'
              : layer === 'event' ? 'Natural'
              : layer === 'sat' ? 'Satellite'
              : layer === 'city' ? 'City'
              : layer === 'country' ? 'Country'
              : layer === 'lake' ? 'Hydrography'
              : 'Object'}
          </span>
        </div>
        <button onClick={onClose} className="opacity-50 hover:opacity-100"><Icon name="x" className="w-3.5 h-3.5"/></button>
      </div>
      <div className="p-4 space-y-3">
        {layer === 'iss' && <>
          <div className="text-lg">ISS · ZARYA</div>
          <KV k="Altitude" v={`${item.alt?.toFixed(1)} km`}/>
          <KV k="Velocity" v={`${item.vel?.toFixed(0)} km/h`}/>
          <KV k="Position" v={`${item.lat.toFixed(2)}°, ${item.lon.toFixed(2)}°`}/>
        </>}
        {layer === 'sat' && <>
          <div className="text-lg">{item.name}</div>
          <KV k="Group" v={item.group || '—'}/>
          {item.owner && <KV k="Operator" v={item.owner}/>}
          {item.norad && <KV k="NORAD" v={item.norad}/>}
          <KV k="Altitude" v={`${item.alt?.toFixed(0)} km`}/>
          <KV k="Position" v={`${item.lat.toFixed(2)}°, ${item.lon.toFixed(2)}°`}/>
        </>}
        {layer === 'flight' && <>
          <div className="text-lg">{item.callsign || item.reg}</div>
          <KV k="Aircraft" v={item.desc || item.type || '—'}/>
          <KV k="Reg" v={item.reg || '—'}/>
          <KV k="Altitude" v={item.alt ? `${item.alt.toLocaleString()} ft` : '—'}/>
          <KV k="Speed" v={item.vel ? `${Math.round(item.vel)} kt` : '—'}/>
          <KV k="Heading" v={item.hdg ? `${Math.round(item.hdg)}°` : '—'}/>
        </>}
        {layer === 'ship' && <>
          <div className="text-lg">{item.name || `MMSI ${item.mmsi}`}</div>
          <KV k="Type" v={item.category ? item.category[0].toUpperCase()+item.category.slice(1) : '—'}/>
          <KV k="MMSI" v={item.mmsi || '—'}/>
          {item.callsign && <KV k="Call sign" v={item.callsign}/>}
          <KV k="Speed" v={item.sog != null ? `${item.sog.toFixed(1)} kn` : '—'}/>
          <KV k="Course" v={item.cog != null ? `${Math.round(item.cog)}°` : '—'}/>
          {item.dest && <KV k="Destination" v={item.dest}/>}
          <KV k="Position" v={`${item.lat.toFixed(2)}°, ${item.lon.toFixed(2)}°`}/>
        </>}
        {layer === 'quake' && <>
          <div className="text-lg">M{item.mag?.toFixed(1)} Earthquake</div>
          <div className="text-sm opacity-70">{item.place}</div>
          <KV k="Depth" v={`${item.depth?.toFixed(1)} km`}/>
          <KV k="Time" v={fmtTime(item.time)}/>
          {item.url && <a href={item.url} target="_blank" className="text-xs text-accent-500 underline">USGS report →</a>}
        </>}
        {layer === 'event' && <>
          <div className="text-lg">{item.title}</div>
          <KV k="Type" v={item.category}/>
          <KV k="Updated" v={fmtTime(item.time)}/>
          {item.link && <a href={item.link} target="_blank" className="text-xs text-accent-500 underline">NASA EONET →</a>}
        </>}
        {layer === 'city' && <>
          <div className="text-lg">{item.name}</div>
          {item.country && <div className="text-sm opacity-70">{item.country}{item.admin1 ? ` · ${item.admin1}` : ''}</div>}
          {item.pop != null && <KV k="Pop" v={Number(item.pop).toLocaleString()}/>}
          {item.featurecla && <KV k="Class" v={item.featurecla}/>}
          {(item.megacity || item.worldcity) && (
            <div className="flex gap-1.5 flex-wrap">
              {item.worldcity && <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent-500/15 text-accent-500">World city</span>}
              {item.megacity && <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent-500/15 text-accent-500">Megacity</span>}
            </div>
          )}
          <KV k="Position" v={`${item.lat.toFixed(2)}°, ${item.lon.toFixed(2)}°`}/>
          <a href={`https://en.wikipedia.org/wiki/${encodeURIComponent(item.name)}`} target="_blank" rel="noopener" className="text-xs text-accent-500 underline">Wikipedia →</a>
        </>}
        {layer === 'country' && <>
          <div className="text-lg">{item.name}</div>
          {item.region && <div className="text-sm opacity-70">{item.continent}{item.region ? ` · ${item.region}` : ''}</div>}
          {item.iso && <KV k="ISO" v={item.iso}/>}
          {item.pop != null && item.pop > 0 && <KV k="Pop" v={Number(item.pop).toLocaleString()}/>}
          {item.gdp != null && item.gdp > 0 && <KV k="GDP" v={`$${(item.gdp/1000).toFixed(1)} B`}/>}
          <KV k="Clicked" v={`${item.lat.toFixed(2)}°, ${item.lon.toFixed(2)}°`}/>
          <a href={`https://en.wikipedia.org/wiki/${encodeURIComponent(item.name)}`} target="_blank" rel="noopener" className="text-xs text-accent-500 underline">Wikipedia →</a>
        </>}
        {layer === 'lake' && <>
          <div className="text-lg">{item.name}</div>
          <div className="text-sm opacity-70">Inland water body</div>
          <KV k="Clicked" v={`${item.lat.toFixed(2)}°, ${item.lon.toFixed(2)}°`}/>
          {item.name !== 'Unnamed lake' && (
            <a href={`https://en.wikipedia.org/wiki/${encodeURIComponent(item.name)}`} target="_blank" rel="noopener" className="text-xs text-accent-500 underline">Wikipedia →</a>
          )}
        </>}
      </div>
    </div>
  );
}
function KV({ k, v }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-[10px] uppercase font-mono opacity-50 tracking-wider w-16 shrink-0">{k}</span>
      <span className="text-sm font-mono">{v}</span>
    </div>
  );
}

// Time range slider — compact
function TimeSlider({ nowCursor, setNowCursor, playing, setPlaying, playSpeed, setPlaySpeed }) {
  const WINDOW = 24*3600*1000;
  const NOW = Date.now();
  const MIN = NOW - WINDOW;
  const t = nowCursor;
  const pct = ((t - MIN)/WINDOW) * 100;

  useEffect(() => {
    if (!playing) return;
    let raf, last = performance.now();
    const tick = (now) => {
      const dt = now - last; last = now;
      setNowCursor(prev => {
        const next = prev + dt * playSpeed;
        if (next >= Date.now()) { setPlaying(false); return Date.now(); }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, playSpeed, setNowCursor, setPlaying]);

  const isLive = NOW - t < 60000;

  return (
    <div className="glass-strong rounded-full pl-2 pr-3 py-1.5 flex items-center gap-3 w-full max-w-[640px] mx-auto">
      <button onClick={()=>setPlaying(p=>!p)}
              className="w-7 h-7 rounded-full bg-accent-500 text-white flex items-center justify-center hover:scale-105 transition shrink-0">
        <Icon name={playing?'pause':'play'} className="w-3 h-3"/>
      </button>

      <div className="flex items-center gap-1.5 shrink-0">
        <div className={classNames("w-1 h-1 rounded-full", isLive ? "bg-emerald-500 bpulse" : "bg-amber-500")}/>
        <span className="font-mono text-[10px] tabular-nums opacity-75 tracking-tight">
          {isLive ? 'LIVE' : fmtTimeShort(t)}
        </span>
      </div>

      <div className="relative flex-1 h-5 group">
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[2px] bg-current opacity-10 rounded-full"/>
        <div className="absolute top-1/2 -translate-y-1/2 left-0 h-[2px] bg-accent-500/50 rounded-full"
             style={{ width: `${pct}%` }}/>
        {/* subtle tick marks every 6h */}
        {[0.25, 0.5, 0.75].map((p,i)=>(
          <div key={i} className="absolute top-1/2 -translate-y-1/2 w-px h-1.5 bg-current opacity-20" style={{ left: `${p*100}%` }}/>
        ))}
        <input type="range" min={MIN} max={NOW} value={t} step="60000"
               onChange={e=>{setPlaying(false); setNowCursor(parseInt(e.target.value));}}
               className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"/>
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-accent-500 shadow pointer-events-none ring-2 ring-white/60 dark:ring-black/40 group-hover:scale-125 transition"
             style={{ left: `${pct}%` }}/>
      </div>

      <div className="flex items-center gap-0.5 shrink-0">
        {[60, 300, 1800, 3600].map(sp => (
          <button key={sp} onClick={()=>setPlaySpeed(sp)}
            className={classNames(
              "text-[9px] font-mono px-1 py-0.5 rounded tabular-nums transition",
              playSpeed===sp ? "bg-accent-500/20 text-accent-500" : "opacity-40 hover:opacity-80"
            )}>
            {sp===60?'1×':sp===300?'5×':sp===1800?'30×':'60×'}
          </button>
        ))}
        {!isLive && (
          <button onClick={()=>{setNowCursor(Date.now()); setPlaying(false);}}
                  className="text-[9px] font-mono ml-1 px-1.5 py-0.5 rounded bg-accent-500/15 text-accent-500 hover:bg-accent-500/25">
            NOW
          </button>
        )}
      </div>
    </div>
  );
}

function Ticker({ items }) {
  if (!items || !items.length) return null;
  const rows = [...items, ...items];
  return (
    <div className="glass rounded-full overflow-hidden tk-mask">
      <div className="flex items-center py-2 tk-row whitespace-nowrap gap-8 px-4">
        {rows.map((it,i)=>(
          <span key={i} className="inline-flex items-center gap-2 text-[11px] font-mono">
            <span className="text-accent-500">●</span>
            <span className="opacity-50">{it.tag}</span>
            <span className="opacity-90">{it.text}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// Live Feed — streaming list of all incoming updates
const FEED_STYLES = {
  quake:   { c:'bg-amber-500',  l:'SEIS' },
  event:   { c:'bg-violet-500', l:'EVT' },
  flight:  { c:'bg-sky-400',    l:'FLT' },
  ship:    { c:'bg-cyan-400',   l:'SHP' },
  iss:     { c:'bg-accent-500', l:'ISS' },
  sat:     { c:'bg-fuchsia-500',l:'SAT' },
  wiki:    { c:'bg-blue-400',   l:'SIG' },
  kp:      { c:'bg-emerald-500',l:'GEO' },
};
function LiveFeed({ feed, onPick, paused, onTogglePause }) {
  const [collapsed, setCollapsed] = useState(true);
  return (
    <div className={classNames(
      "glass-strong rounded-full sm:rounded-2xl overflow-hidden transition-all",
      collapsed
        ? "w-[92px] sm:w-[160px]"                   // tiny pill on phones
        : "w-[min(92vw,300px)] rounded-2xl"         // never wider than viewport
    )}>
      <button onClick={()=>setCollapsed(c=>!c)}
              title="Live feed"
              className={classNames(
                "w-full flex items-center justify-between py-2",
                collapsed ? "px-2.5 sm:px-3 border-0 sm:border-b sm:border-black/5 sm:dark:border-white/5"
                          : "px-3 border-b border-black/5 dark:border-white/5"
              )}>
        <div className="flex items-center gap-2 min-w-0">
          <div className={classNames("w-1.5 h-1.5 rounded-full shrink-0", paused ? "bg-amber-500" : "bg-emerald-500 bpulse")}/>
          {/* Always show a label — chevron alone is too ambiguous on phones.
              "FEED" fits under our narrow 92px chip; the full "Live feed"
              takes over on sm+. */}
          <span className="text-[10px] uppercase font-mono tracking-[0.2em] opacity-70 truncate sm:hidden">Feed</span>
          <span className="text-[10px] uppercase font-mono tracking-[0.2em] opacity-70 truncate hidden sm:inline">Live feed</span>
        </div>
        <div className="flex items-center gap-1.5">
          {!collapsed && (
            <span onClick={e=>{e.stopPropagation(); onTogglePause();}}
                  className="text-[9px] font-mono opacity-50 hover:opacity-100 px-1.5 py-0.5 rounded hover:bg-black/5 dark:hover:bg-white/5">
              {paused ? 'RESUME' : 'PAUSE'}
            </span>
          )}
          <Icon name={collapsed?'chevR':'chevL'} className="w-3 h-3 opacity-50"/>
        </div>
      </button>
      {!collapsed && (
        <div className="h-[320px] overflow-y-auto scroll">
          {feed.length === 0 && (
            <div className="px-3 py-8 text-center text-[11px] opacity-40 font-mono">
              awaiting transmission…
            </div>
          )}
          {feed.map((it, i) => {
            const st = FEED_STYLES[it.layer] || { c:'bg-gray-400', l:'—' };
            return (
              <button key={it.key} onClick={()=>onPick?.(it)}
                      className={classNames(
                        "group w-full text-left flex items-start gap-2.5 px-3 py-2 border-b border-black/5 dark:border-white/5 hover:bg-black/5 dark:hover:bg-white/5 transition",
                        i === 0 && "feed-new"
                      )}>
                <div className="flex flex-col items-center pt-1 shrink-0">
                  <div className={classNames("w-1.5 h-1.5 rounded-full", st.c)}/>
                  <div className="text-[8px] font-mono opacity-50 mt-1 tracking-wider">{st.l}</div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] leading-tight truncate">{it.title}</div>
                  {it.sub && <div className="text-[10px] opacity-55 font-mono truncate mt-0.5">{it.sub}</div>}
                </div>
                <div className="text-[9px] font-mono opacity-40 shrink-0 pt-1 tabular-nums">
                  {fmtAgo(it.time)}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function App() {
  const { w, h } = useWindowSize();

  // Theme
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('ge-theme') || TWEAK_DEFAULTS.defaultTheme;
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.body.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('ge-theme', theme);
  }, [theme]);

  // Layers
  const [layers, setLayers] = useState(() => {
    try { return JSON.parse(localStorage.getItem('ge-layers')) || {}; } catch { return {}; }
  });
  useEffect(()=>{
    const def = { flights:true, ships:true, sats:true, iss:true, quakes:true, events:true, aurora:true, wiki:true, tsunamis:false };
    const merged = { ...def, ...layers };
    if (JSON.stringify(merged) !== JSON.stringify(layers)) setLayers(merged);
    localStorage.setItem('ge-layers', JSON.stringify(merged));
  }, [layers]);

  const [animIntensity, setAnimIntensity] = useState(TWEAK_DEFAULTS.animationIntensity);

  // Data
  const [data, setData] = useState({ flights:[], quakes:[], events:[], aurora:[], tsunamis:[], iss:null, sats:[], satTLEs:[], ships:[] });
  const [kp, setKp] = useState(null);
  const [ticker, setTicker] = useState([]);

  // Live feed (unified stream of all inbound updates)
  const [feed, setFeed] = useState([]);
  const [feedPaused, setFeedPaused] = useState(false);
  const seenFeedRef = useRef(new Set());
  const pushFeed = useCallback((entries) => {
    if (feedPaused) return;
    setFeed(prev => {
      const seen = seenFeedRef.current;
      const fresh = entries.filter(e => !seen.has(e.key));
      if (!fresh.length) return prev;
      for (const f of fresh) seen.add(f.key);
      return [...fresh, ...prev].slice(0, 80);
    });
  }, [feedPaused]);

  // Pick / focus
  const [picked, setPicked] = useState(null);
  const [focusTarget, setFocusTarget] = useState(null);

  // Time cursor
  const [nowCursor, setNowCursor] = useState(Date.now());
  const [playing, setPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(300); // multiplier
  // When live, keep cursor at Date.now()
  useEffect(() => {
    if (playing) return;
    const id = setInterval(() => {
      // Only update if user is within 1 min of now (i.e. they're "live")
      setNowCursor(prev => (Date.now() - prev < 60*1000 ? Date.now() : prev));
    }, 1000);
    return () => clearInterval(id);
  }, [playing]);

  // Load data
  useEffect(() => {
    let alive = true;
    const loadAll = async () => {
      const [q,e,k,a,t] = await Promise.all([
        fetchQuakes(), fetchEONET(), fetchKp(), fetchAurora(), fetchTsunamis(),
      ]);
      if (!alive) return;
      setData(d => ({...d, quakes:q, events:e, aurora:a, tsunamis:t }));
      setKp(k);
      // Push to live feed
      pushFeed((q||[]).slice(0,15).map(qk => ({
        key: 'q:'+qk.id, layer:'quake', time: qk.time,
        title: `M${qk.mag?.toFixed(1)} · ${qk.place}`,
        sub: `depth ${qk.depth?.toFixed(0)} km`,
        _item: { ...qk, _layer:'quake' },
        coords: [qk.lon, qk.lat],
      })));
      pushFeed((e||[]).slice(0,10).map(ev => ({
        key: 'e:'+ev.id, layer:'event', time: new Date(ev.time).getTime() || Date.now(),
        title: ev.title, sub: ev.category,
        _item: { ...ev, _layer:'event' },
        coords: [ev.lon, ev.lat],
      })));
      if (k) pushFeed([{
        key: 'kp:'+k.time, layer:'kp', time: new Date(k.time).getTime() || Date.now(),
        title: `Planetary K-index ${k.kp?.toFixed(1)}`,
        sub: k.kp >= 5 ? 'storm conditions' : k.kp >= 4 ? 'unsettled' : 'quiet',
      }]);
      // Build ticker from top items
      const tk = [];
      q.slice(0,6).forEach(qk => tk.push({ tag:`M${qk.mag?.toFixed(1)}`, text: qk.place }));
      e.slice(0,6).forEach(ev => tk.push({ tag: ev.category.toUpperCase().slice(0,4), text: ev.title }));
      if (k) tk.push({ tag:'Kp', text:`planetary K-index ${k.kp?.toFixed(1)}` });
      setTicker(tk);
    };
    loadAll();
    const id = setInterval(loadAll, 90000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Flights (airplanes.live)
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      const f = await fetchFlights();
      if (!alive) return;
      setData(d => ({...d, flights: f}));
      // Sample a few notable flights into feed (once each)
      pushFeed((f||[]).filter(fl => fl.alt > 35000).slice(0,3).map(fl => ({
        key: 'f:'+fl.id+':'+Math.floor(Date.now()/600000),
        layer:'flight', time: Date.now(),
        title: `${fl.callsign||fl.reg} · FL${Math.round((fl.alt||0)/100)}`,
        sub: fl.desc || fl.type || `${Math.round(fl.vel||0)} kt`,
        _item: { ...fl, _layer:'flight' },
        coords: [fl.lon, fl.lat],
      })));
    };
    pull();
    const id = setInterval(pull, 25000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // ISS
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      const i = await fetchISS();
      if (!alive || !i) return;
      setData(d => ({...d, iss: i}));
      // Every ~30s feed update
      pushFeed([{
        key: 'iss:'+Math.floor(Date.now()/30000),
        layer:'iss', time: Date.now(),
        title: `ISS · ${i.lat.toFixed(1)}°, ${i.lon.toFixed(1)}°`,
        sub: `alt ${i.alt.toFixed(0)} km · ${i.vel.toFixed(0)} km/h`,
        _item: { ...i, _layer:'iss' },
        coords: [i.lon, i.lat],
      }]);
    };
    pull();
    const id = setInterval(pull, 6000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Satellites — fetch TLEs (rarely), propagate every 2s
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      const tles = await fetchSatellites();
      if (!alive || !tles?.length) return;
      setData(d => ({...d, satTLEs: tles }));
      loadSatcat().catch(()=>{}); // kick off owner lookup
    };
    pull();
    const id = setInterval(pull, 6*3600*1000); // every 6h
    return () => { alive = false; clearInterval(id); };
  }, []);
  useEffect(() => {
    const tick = () => {
      setData(d => {
        if (!d.satTLEs?.length) return d;
        const sats = propagateSats(d.satTLEs, new Date());
        return { ...d, sats };
      });
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, []);

  // Ships — AISStream websocket (managed in src/ships.jsx). Just subscribe.
  useEffect(() => {
    if (!window.subscribeShips) return;
    const unsub = window.subscribeShips(list => {
      setData(d => ({...d, ships: list }));
    });
    return unsub;
  }, []);

  // Build locate targets
  const targets = useMemo(() => {
    const out = [];
    if (data.iss) out.push({ type:'iss', label:'ISS · ZARYA', coords:[data.iss.lon, data.iss.lat], sub: `${data.iss.alt?.toFixed(0)} km`, zoom: 1.8 });
    for (const f of (data.flights||[]).slice(0, 200)) {
      out.push({ type:'flight', label: f.callsign || f.reg, coords:[f.lon,f.lat], sub:`${f.desc||f.type||''}`, zoom: 2.2 });
    }
    for (const q of (data.quakes||[]).slice(0, 40)) {
      out.push({ type:'quake', label:`M${q.mag?.toFixed(1)} · ${q.place}`, coords:[q.lon,q.lat], sub:fmtAgo(q.time)+' ago', zoom: 2.4 });
    }
    for (const e of (data.events||[]).slice(0, 40)) {
      out.push({ type:'event', label: e.title, coords:[e.lon,e.lat], sub: e.category, zoom: 2.0 });
    }
    // Well-known cities
    const cities = [
      ['London',-0.12,51.5],['New York',-74,40.7],['Tokyo',139.7,35.68],['Singapore',103.8,1.35],
      ['Sydney',151.2,-33.86],['Dubai',55.27,25.2],['São Paulo',-46.63,-23.55],['Los Angeles',-118.2,34.05],
      ['Mumbai',72.87,19.07],['Paris',2.35,48.86],['Moscow',37.6,55.75],['Beijing',116.4,39.9],
      ['Lagos',3.38,6.52],['Cairo',31.24,30.04],['Mexico City',-99.13,19.43],
    ];
    for (const [n,lo,la] of cities) out.push({ type:'city', label:n, coords:[lo,la], zoom: 2.0 });
    return out;
  }, [data]);

  // Keyboard
  useEffect(() => {
    const on = (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === 'r' || e.key === 'R') { setFocusTarget(null); }
      if (e.key === 'Escape') setPicked(null);
      if (e.key === ' ') { e.preventDefault(); setPlaying(p=>!p); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  // Tweaks protocol
  useEffect(() => {
    const on = (e) => {
      if (e.data?.type === '__activate_edit_mode') setTweaks(true);
      if (e.data?.type === '__deactivate_edit_mode') setTweaks(false);
    };
    window.addEventListener('message', on);
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    return () => window.removeEventListener('message', on);
  }, []);
  const [tweaks, setTweaks] = useState(false);

  // Filter data by time cursor (quakes, events)
  const filteredData = useMemo(() => {
    const cutoff = nowCursor;
    const start = cutoff - 24*3600*1000;
    return {
      ...data,
      quakes: (data.quakes||[]).filter(q => q.time <= cutoff && q.time >= start),
      events: (data.events||[]).filter(e => {
        const t = e.time ? new Date(e.time).getTime() : 0;
        return t <= cutoff;
      }),
    };
  }, [data, nowCursor]);

  return (
    <div className="relative w-screen h-screen overflow-hidden">
      <div className="mesh" />
      <div className="absolute inset-0 flex items-center justify-center">
        <Globe
          width={w} height={h}
          data={filteredData}
          nowCursor={nowCursor}
          onPickMarker={setPicked}
          focusTarget={focusTarget}
          theme={theme}
          animationIntensity={animIntensity}
          layers={layers}
        />
      </div>

      {/* Top bar — mobile-first. On phones it stacks:
            row 1: brand + actions (search / layers / theme)
            row 2: compact stat pill (only top 3 stats shown at this breakpoint)
          On sm+ everything lives on one line. */}
      <div className="absolute top-3 sm:top-4 left-3 sm:left-4 right-3 sm:right-4 z-10 flex flex-col sm:flex-row items-stretch sm:items-start justify-between gap-2 sm:gap-3 pointer-events-none">
        <div className="flex items-center justify-between gap-2 pointer-events-auto min-w-0 sm:flex-wrap order-1">
          <div className="glass rounded-full pl-3 pr-3 sm:pr-4 py-2 flex items-center gap-2 shrink-0">
            <div className="w-2 h-2 rounded-full bg-accent-500 bpulse"/>
            <span className="font-mono text-[11px] tracking-[0.2em] uppercase">God's Eye</span>
          </div>
          {/* Actions sit next to the brand on phones so they don't get pushed
              off-screen; on sm+ they detach to the right via the outer flex. */}
          <div className="flex items-center gap-1.5 sm:hidden">
            <SearchBar onLocate={t=>setFocusTarget(t)} targets={targets} theme={theme}/>
            <LayersPopover layers={layers} setLayers={setLayers} theme={theme}/>
            <ThemeToggle theme={theme} onChange={setTheme}/>
          </div>
          <div className="min-w-0 max-w-full overflow-hidden hidden sm:block">
            <StatBar data={data} kp={kp}/>
          </div>
        </div>
        {/* Phone-only stat pill on its own row */}
        <div className="sm:hidden pointer-events-auto order-2 min-w-0 max-w-full overflow-hidden">
          <StatBar data={data} kp={kp}/>
        </div>
        {/* Desktop action cluster (hidden on mobile — duplicated above) */}
        <div className="hidden sm:flex items-center gap-2 pointer-events-auto order-3">
          <SearchBar onLocate={t=>setFocusTarget(t)} targets={targets} theme={theme}/>
          <LayersPopover layers={layers} setLayers={setLayers} theme={theme}/>
          <ThemeToggle theme={theme} onChange={setTheme}/>
        </div>
      </div>

      {/* Dossier */}
      {picked && (
        <div className="absolute top-20 right-4 z-20 pointer-events-auto animate-fade-in">
          <Dossier item={picked} onClose={()=>setPicked(null)}/>
        </div>
      )}

      {/* Live Feed — tucked below the mobile stat row, standard top-20 on sm+ */}
      <div className="absolute top-28 sm:top-20 left-3 sm:left-4 z-10 pointer-events-auto">
        <LiveFeed
          feed={feed}
          paused={feedPaused}
          onTogglePause={()=>setFeedPaused(p=>!p)}
          onPick={(entry) => {
            if (entry.coords) setFocusTarget({ type: entry.layer, label: entry.title, coords: entry.coords, zoom: 2.2 });
            if (entry._item) setPicked(entry._item);
          }}
        />
      </div>

      {/* Bottom controls */}
      <div className="absolute bottom-4 inset-x-0 z-10 flex flex-col items-center gap-3 pointer-events-none px-2">
        {TWEAK_DEFAULTS.showTicker && <div className="pointer-events-auto w-[min(780px,94vw)]"><Ticker items={ticker}/></div>}
        <div className="pointer-events-auto w-[min(620px,94vw)]">
          <TimeSlider nowCursor={nowCursor} setNowCursor={setNowCursor}
                      playing={playing} setPlaying={setPlaying}
                      playSpeed={playSpeed} setPlaySpeed={setPlaySpeed}/>
        </div>
      </div>

      {/* Help hint — desktop only; gets in the way on tablets/phones */}
      <div className="hidden lg:block absolute bottom-4 right-4 z-10 pointer-events-none">
        <div className="glass rounded-full px-3 py-1.5 text-[10px] font-mono opacity-60 tracking-wider whitespace-nowrap">
          <kbd>/</kbd> locate · <kbd>drag</kbd> rotate · <kbd>scroll</kbd> zoom · <kbd>space</kbd> play
        </div>
      </div>

      {tweaks && (
        <div className="fixed bottom-24 left-4 z-50 glass-strong rounded-2xl p-3 w-60">
          <div className="text-[10px] uppercase font-mono opacity-50 mb-2 tracking-wider">Tweaks</div>
          <label className="flex items-center justify-between py-1">
            <span className="text-sm">Default theme</span>
            <select value={TWEAK_DEFAULTS.defaultTheme}
                    onChange={e=>{
                      TWEAK_DEFAULTS.defaultTheme = e.target.value;
                      window.parent.postMessage({ type:'__edit_mode_set_keys', edits:{ defaultTheme: e.target.value }}, '*');
                    }}
                    className="bg-transparent text-sm outline-none">
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>
        </div>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
