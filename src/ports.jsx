/* Curated major ports for matching AIS destination strings.

   AIS ShipStaticData.Destination is free-text typed by the crew — typically
   contains a port name or a UN/LOCODE ("CNSHA" = Shanghai, "NLRTM" =
   Rotterdam), sometimes both, sometimes a multi-stop string like
   "SHANGHAI>SINGAPORE". Match rate from this list is ~60-70% of the
   destinations we see in practice.

   Each entry: [lat, lon, canonicalName, ...aliases]. Aliases include the
   5-char UN/LOCODE, common English name, and a few common abbreviations /
   variants. Uppercased at lookup time.

   Exposes:
     window.resolvePort(destStr) → {name, lat, lon, alias} | null
*/

(function () {
  const PORTS = [
    // East Asia — world's biggest container hubs
    [ 31.230, 121.474, 'Shanghai',            'CNSHA','SHANGHAI'],
    [ 29.874, 121.555, 'Ningbo-Zhoushan',     'CNNGB','NINGBO','ZHOUSHAN'],
    [ 22.543, 114.060, 'Shenzhen',            'CNSZX','SHENZHEN','YANTIAN','SHEKOU'],
    [ 23.100, 113.300, 'Guangzhou',           'CNCAN','GUANGZHOU','NANSHA'],
    [ 22.293, 114.179, 'Hong Kong',           'HKHKG','HONG KONG','HONGKONG','KWAI CHUNG'],
    [ 36.068, 120.380, 'Qingdao',             'CNTAO','QINGDAO'],
    [ 39.000, 117.800, 'Tianjin',             'CNTXG','TIANJIN','XINGANG'],
    [ 38.900, 121.600, 'Dalian',              'CNDLC','DALIAN'],
    [ 29.817, 122.109, 'Zhoushan',            'CNZOS','ZHOUSHAN'],
    [ 24.450, 118.080, 'Xiamen',              'CNXMN','XIAMEN'],
    [ 32.100, 121.570, 'Taicang',             'CNTCG','TAICANG','SUZHOU'],
    [ 35.100, 129.040, 'Busan',               'KRPUS','BUSAN','PUSAN'],
    [ 37.500, 126.600, 'Incheon',             'KRINC','INCHEON'],
    [ 34.800, 128.500, 'Gwangyang',           'KRKAN','GWANGYANG'],
    [ 35.050, 139.780, 'Yokohama',            'JPYOK','YOKOHAMA'],
    [ 34.670, 135.220, 'Kobe',                'JPUKB','KOBE'],
    [ 34.630, 135.430, 'Osaka',               'JPOSA','OSAKA'],
    [ 33.670, 130.400, 'Hakata',              'JPHKT','HAKATA','FUKUOKA'],
    [ 25.100, 121.720, 'Keelung',             'TWKEL','KEELUNG'],
    [ 24.800, 120.900, 'Taipei Port',         'TWTPE','TAIPEI'],
    [ 22.630, 120.260, 'Kaohsiung',           'TWKHH','KAOHSIUNG'],

    // Southeast Asia
    [  1.265, 103.820, 'Singapore',           'SGSIN','SINGAPORE','PSA','TUAS'],
    [  3.000, 101.400, 'Port Klang',          'MYPKG','PORT KLANG','KLANG'],
    [  2.270, 102.250, 'Port Dickson',        'MYPDI','PORT DICKSON'],
    [  1.460, 103.720, 'Tanjung Pelepas',     'MYTPP','TANJUNG PELEPAS','PTP'],
    [ 13.720, 100.580, 'Bangkok',             'THBKK','BANGKOK'],
    [ 13.100, 100.930, 'Laem Chabang',        'THLCH','LAEM CHABANG'],
    [ 10.820, 106.700, 'Ho Chi Minh City',    'VNSGN','HOCHIMINH','SAIGON','CAT LAI','CAI MEP'],
    [ 20.870, 106.680, 'Haiphong',            'VNHPH','HAIPHONG'],
    [ 14.600, 120.980, 'Manila',              'PHMNL','MANILA'],
    [ -6.116, 106.870, 'Tanjung Priok',       'IDTPK','TANJUNG PRIOK','JAKARTA'],
    [ -7.200, 112.730, 'Tanjung Perak',       'IDTPP','TANJUNG PERAK','SURABAYA'],
    [ 16.070, 108.220, 'Da Nang',             'VNDAD','DA NANG','DANANG'],

    // South Asia
    [ 13.100,  80.300, 'Chennai',             'INMAA','CHENNAI','MADRAS'],
    [ 18.960,  72.850, 'Mumbai',              'INBOM','MUMBAI','BOMBAY','NHAVA SHEVA','JNPT'],
    [ 24.860,  67.000, 'Karachi',             'PKKHI','KARACHI','BIN QASIM','QICT'],
    [ 22.760,  88.320, 'Kolkata',             'INCCU','KOLKATA','CALCUTTA','HALDIA'],
    [ 11.080,  76.970, 'Cochin',              'INCOK','COCHIN','KOCHI','VALLARPADAM'],
    [  6.930,  79.860, 'Colombo',             'LKCMB','COLOMBO'],
    [ 22.470,  70.050, 'Mundra',              'INMUN','MUNDRA'],

    // Middle East
    [ 25.280,  55.370, 'Jebel Ali',           'AEJEA','JEBEL ALI','JEBELALI'],
    [ 24.500,  54.370, 'Abu Dhabi',           'AEAUH','ABU DHABI','KHALIFA PORT'],
    [ 25.630,  54.950, 'Khor Fakkan',         'AEKLF','KHOR FAKKAN'],
    [ 22.500,  59.500, 'Salalah',             'OMSLL','SALALAH'],
    [ 26.230,  50.620, 'Bahrain',             'BHKBS','BAHRAIN','KHALIFA BIN SALMAN'],
    [ 25.220,  51.540, 'Doha',                'QADOH','DOHA','HAMAD PORT'],
    [ 29.370,  47.940, 'Kuwait',              'KWKWI','KUWAIT'],
    [ 26.920,  56.150, 'Bandar Abbas',        'IRBND','BANDAR ABBAS','SHAHID RAJAEE'],
    [ 32.060,  34.790, 'Tel Aviv',            'ILTLV','ASHDOD','HAIFA'],
    [ 36.790,  34.630, 'Mersin',              'TRMER','MERSIN'],

    // Red Sea / Africa
    [ 29.930,  32.570, 'Port Said',           'EGPSD','PORT SAID','SUEZ'],
    [ 30.800,  29.770, 'Alexandria',          'EGALY','ALEXANDRIA'],
    [ 21.500,  39.200, 'Jeddah',              'SAJED','JEDDAH'],
    [  7.250,  39.200, 'Djibouti',            'DJJIB','DJIBOUTI','DORALEH'],
    [ -4.050,  39.660, 'Mombasa',             'KEMBA','MOMBASA'],
    [ -6.820,  39.280, 'Dar es Salaam',       'TZDAR','DAR ES SALAAM'],
    [ -33.920, 18.420, 'Cape Town',           'ZACPT','CAPE TOWN'],
    [ -29.867, 31.033, 'Durban',              'ZADUR','DURBAN'],
    [  6.450,  3.400,  'Lagos',               'NGLOS','LAGOS','APAPA','TIN CAN'],
    [  5.320, -4.010,  'Abidjan',             'CIABJ','ABIDJAN'],
    [ 14.680, -17.430, 'Dakar',               'SNDKR','DAKAR'],
    [ 33.610, -7.620,  'Casablanca',          'MACAS','CASABLANCA'],
    [ 35.890, -5.490,  'Tanger Med',          'MAPTM','TANGER MED','TANGIER'],

    // Europe — Atlantic / North Sea
    [ 51.905,  4.480, 'Rotterdam',            'NLRTM','ROTTERDAM','MAASVLAKTE','EUROPOORT'],
    [ 51.260,  4.360, 'Antwerp',              'BEANR','ANTWERP','ANTWERPEN'],
    [ 53.540,  9.980, 'Hamburg',              'DEHAM','HAMBURG'],
    [ 53.540,  8.580, 'Bremerhaven',          'DEBRV','BREMERHAVEN','BREMEN'],
    [ 53.170,  8.580, 'Wilhelmshaven',        'DEWHV','WILHELMSHAVEN','JADE WESER'],
    [ 51.336,  3.200, 'Zeebrugge',            'BEZEE','ZEEBRUGGE'],
    [ 51.450,  0.150, 'London',               'GBLON','LONDON','TILBURY','LONDON GATEWAY'],
    [ 51.955,  1.260, 'Felixstowe',           'GBFXT','FELIXSTOWE'],
    [ 50.900, -1.400, 'Southampton',          'GBSOU','SOUTHAMPTON'],
    [ 53.450, -3.000, 'Liverpool',            'GBLIV','LIVERPOOL'],
    [ 53.340, -6.220, 'Dublin',               'IEDUB','DUBLIN'],
    [ 49.490,  0.100, 'Le Havre',             'FRLEH','LE HAVRE','HAVRE'],
    [ 48.400, -4.500, 'Brest',                'FRBES','BREST'],
    [ 43.320,  5.370, 'Marseille',            'FRMRS','MARSEILLE','FOS'],
    [ 36.130, -5.430, 'Algeciras',            'ESALG','ALGECIRAS'],
    [ 43.370, -8.400, 'Coruna',               'ESLCG','LA CORUNA','CORUNA'],
    [ 41.350,  2.170, 'Barcelona',            'ESBCN','BARCELONA'],
    [ 39.460, -0.330, 'Valencia',             'ESVLC','VALENCIA'],
    [ 38.720, -9.140, 'Lisbon',               'PTLIS','LISBON','LISBOA','SINES'],
    [ 37.140, -8.540, 'Sines',                'PTSIN','SINES'],
    [ 45.430, 12.340, 'Venice',               'ITVCE','VENICE','VENEZIA'],
    [ 44.410,  8.930, 'Genoa',                'ITGOA','GENOA','GENOVA'],
    [ 44.120,  9.830, 'La Spezia',            'ITSPE','LA SPEZIA','SPEZIA'],
    [ 38.200, 15.650, 'Gioia Tauro',          'ITGIT','GIOIA TAURO'],
    [ 40.840, 14.250, 'Naples',               'ITNAP','NAPLES','NAPOLI'],
    [ 37.490, 15.090, 'Catania',              'ITCTA','CATANIA'],
    [ 35.890, 14.510, 'Malta Freeport',       'MTMLA','MALTA','MARSAXLOKK'],
    [ 37.950, 23.640, 'Piraeus',              'GRPIR','PIRAEUS','ATHENS'],
    [ 40.640, 22.940, 'Thessaloniki',         'GRSKG','THESSALONIKI'],
    [ 41.010, 28.980, 'Istanbul',             'TRIST','ISTANBUL','AMBARLI'],
    [ 40.990, 28.700, 'Tekirdag',             'TRTEK','TEKIRDAG','ASYAPORT'],
    [ 45.430, 28.820, 'Constanta',            'ROCND','CONSTANTA'],
    [ 44.800, 37.770, 'Novorossiysk',         'RUNVS','NOVOROSSIYSK'],
    [ 59.930, 30.300, 'St Petersburg',        'RULED','ST PETERSBURG','BRONKA','UST-LUGA'],
    [ 60.170, 24.960, 'Helsinki',             'FIHEL','HELSINKI','HAMINA','KOTKA'],
    [ 59.420, 24.800, 'Tallinn',              'EETLL','TALLINN','MUUGA'],
    [ 56.950, 24.110, 'Riga',                 'LVRIX','RIGA'],
    [ 55.700, 21.140, 'Klaipeda',             'LTKLJ','KLAIPEDA'],
    [ 54.720, 18.680, 'Gdynia',               'PLGDY','GDYNIA','GDANSK'],
    [ 59.900, 10.750, 'Oslo',                 'NOOSL','OSLO'],
    [ 58.960,  5.730, 'Stavanger',            'NOSVG','STAVANGER'],
    [ 55.700, 12.600, 'Copenhagen',           'DKCPH','COPENHAGEN','KOBENHAVN'],
    [ 57.710, 11.970, 'Gothenburg',           'SEGOT','GOTHENBURG','GOTEBORG'],
    [ 64.130, -21.94, 'Reykjavik',            'ISREY','REYKJAVIK'],

    // North America — West
    [ 33.740, -118.265, 'Los Angeles',        'USLAX','LOS ANGELES','LA','POLA'],
    [ 33.750, -118.200, 'Long Beach',         'USLGB','LONG BEACH','LB','POLB'],
    [ 37.800, -122.320, 'Oakland',            'USOAK','OAKLAND','SAN FRANCISCO'],
    [ 47.610, -122.340, 'Seattle',            'USSEA','SEATTLE'],
    [ 47.270, -122.430, 'Tacoma',             'USTIW','TACOMA','NWSA'],
    [ 49.280, -123.120, 'Vancouver',          'CAVAN','VANCOUVER','DELTAPORT'],
    [ 48.430, -123.370, 'Victoria',           'CAVIC','VICTORIA'],
    [ 54.320, -130.320, 'Prince Rupert',      'CAPRR','PRINCE RUPERT'],
    [ 61.220, -149.900, 'Anchorage',          'USANC','ANCHORAGE'],
    [ 21.310, -157.860, 'Honolulu',           'USHNL','HONOLULU'],

    // North America — East / Gulf
    [ 40.680, -74.040, 'New York',            'USNYC','NEW YORK','NEWARK','BAYONNE','ELIZABETH','NY/NJ'],
    [ 39.290, -76.610, 'Baltimore',           'USBAL','BALTIMORE','SPARROWS POINT'],
    [ 36.850, -76.300, 'Norfolk',             'USORF','NORFOLK','VIRGINIA','PORTSMOUTH'],
    [ 34.250, -77.950, 'Wilmington NC',       'USILM','WILMINGTON'],
    [ 32.780, -79.900, 'Charleston',          'USCHS','CHARLESTON'],
    [ 32.080, -81.120, 'Savannah',            'USSAV','SAVANNAH','GARDEN CITY'],
    [ 30.380, -81.560, 'Jacksonville',        'USJAX','JACKSONVILLE','JAXPORT'],
    [ 25.770, -80.170, 'Miami',               'USMIA','MIAMI'],
    [ 26.110, -80.130, 'Port Everglades',     'USPEF','EVERGLADES','FORT LAUDERDALE'],
    [ 28.420, -80.610, 'Port Canaveral',      'USPCV','CANAVERAL'],
    [ 27.950, -82.440, 'Tampa',               'USTPA','TAMPA'],
    [ 30.050, -90.070, 'New Orleans',         'USMSY','NEW ORLEANS','NOLA'],
    [ 29.720, -95.280, 'Houston',             'USHOU','HOUSTON','BAYPORT','BARBOURS CUT'],
    [ 27.800, -97.390, 'Corpus Christi',      'USCRP','CORPUS CHRISTI'],
    [ 42.350, -71.030, 'Boston',              'USBOS','BOSTON'],
    [ 46.830, -71.200, 'Quebec',              'CAQUE','QUEBEC'],
    [ 45.500, -73.560, 'Montreal',            'CAMTR','MONTREAL'],
    [ 44.660, -63.600, 'Halifax',             'CAHAL','HALIFAX'],

    // Central / South America
    [ 19.190, -96.140, 'Veracruz',            'MXVER','VERACRUZ'],
    [ 17.960, -102.19, 'Lazaro Cardenas',     'MXLZC','LAZARO CARDENAS'],
    [ 20.970, -86.830, 'Cancun',              'MXCUN','CANCUN'],
    [  9.360, -79.910, 'Panama - Balboa',     'PABLB','BALBOA','PANAMA','PANAMA CANAL'],
    [  9.350, -79.900, 'Panama - Colon',      'PAONX','COLON','MANZANILLO INTERNATIONAL'],
    [ 10.600, -61.520, 'Port of Spain',       'TTPOS','PORT OF SPAIN','TRINIDAD'],
    [ 12.050, -68.870, 'Willemstad',          'CWWIL','WILLEMSTAD','CURACAO'],
    [ 18.470, -66.120, 'San Juan',            'USSJU','SAN JUAN','PUERTO RICO'],
    [ 10.660, -71.620, 'Maracaibo',           'VEMAR','MARACAIBO'],
    [ 10.410, -75.540, 'Cartagena',           'COCTG','CARTAGENA'],
    [ 11.000, -74.780, 'Barranquilla',        'COBAQ','BARRANQUILLA'],
    [  3.870, -77.080, 'Buenaventura',        'COBUN','BUENAVENTURA'],
    [  2.180, -80.020, 'Manta',               'ECMEC','MANTA'],
    [ -2.230, -79.900, 'Guayaquil',           'ECGYE','GUAYAQUIL'],
    [-12.070, -77.150, 'Callao',              'PECLL','CALLAO','LIMA'],
    [-23.960, -46.330, 'Santos',              'BRSSZ','SANTOS','SAO PAULO'],
    [-22.880, -43.210, 'Rio de Janeiro',      'BRRIO','RIO DE JANEIRO'],
    [-26.260, -48.850, 'Itajai',              'BRITJ','ITAJAI','NAVEGANTES'],
    [-30.010, -51.230, 'Rio Grande',          'BRRIG','RIO GRANDE'],
    [-34.900, -56.200, 'Montevideo',          'UYMVD','MONTEVIDEO'],
    [-34.610, -58.400, 'Buenos Aires',        'ARBUE','BUENOS AIRES'],
    [-32.940, -60.640, 'Rosario',             'ARROS','ROSARIO'],
    [-33.030, -71.620, 'Valparaiso',          'CLVAP','VALPARAISO'],
    [-33.600, -71.610, 'San Antonio',         'CLSAI','SAN ANTONIO','SANANTONIO'],

    // Oceania
    [-33.860, 151.220, 'Sydney',              'AUSYD','SYDNEY','PORT BOTANY'],
    [-37.830, 144.940, 'Melbourne',           'AUMEL','MELBOURNE'],
    [-27.360, 153.170, 'Brisbane',            'AUBNE','BRISBANE'],
    [-31.980, 115.750, 'Fremantle',           'AUFRE','FREMANTLE','PERTH'],
    [-34.830, 138.500, 'Adelaide',            'AUADL','ADELAIDE'],
    [-36.800, 174.780, 'Auckland',            'NZAKL','AUCKLAND'],
    [-41.280, 174.780, 'Wellington',          'NZWLG','WELLINGTON'],
    [-43.610, 172.720, 'Lyttelton',           'NZLYT','LYTTELTON','CHRISTCHURCH'],
    [-37.810, 174.870, 'Tauranga',            'NZTRG','TAURANGA'],
  ];

  // Build a lookup: each alias (uppercased, normalised) → port entry.
  // Aliases win at length-wins ties: longer aliases match first so
  // "NEW YORK" isn't shadowed by "NY" in substring checks.
  const byAlias = [];
  for (const row of PORTS) {
    const [lat, lon, name, ...aliases] = row;
    const entry = { name, lat, lon };
    for (const a of [name, ...aliases]) {
      byAlias.push({ alias: a.toUpperCase().trim(), entry });
    }
  }
  // Longest aliases first — substring match should bind to the most
  // specific candidate.
  byAlias.sort((a, b) => b.alias.length - a.alias.length);

  function resolvePort(destStr) {
    if (!destStr || typeof destStr !== 'string') return null;
    // Normalise: uppercase, collapse whitespace. For multi-stop strings
    // like "SHANGHAI>ROTTERDAM" or "LOADING SHANGHAI" we prefer the LAST
    // mentioned port (the destination). We split on common separators
    // and scan segments in reverse.
    const clean = destStr.toUpperCase().replace(/[^\w\s\->,.;/]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clean) return null;
    const segments = clean.split(/[>\/,;]| TO | VIA |\->|->/);
    for (let s = segments.length - 1; s >= 0; s--) {
      const seg = segments[s].trim();
      if (!seg) continue;
      for (const { alias, entry } of byAlias) {
        // Word-boundary match: alias as a whole token, not mid-word. This
        // prevents "NEW" matching "NEWARK" twice etc.
        const idx = seg.indexOf(alias);
        if (idx < 0) continue;
        const before = idx === 0 ? ' ' : seg[idx - 1];
        const after  = idx + alias.length >= seg.length ? ' ' : seg[idx + alias.length];
        if (/\W/.test(before) && /\W/.test(after)) {
          return { name: entry.name, lat: entry.lat, lon: entry.lon, alias, matched: seg };
        }
      }
    }
    return null;
  }

  window.resolvePort = resolvePort;
})();
