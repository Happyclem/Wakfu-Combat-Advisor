/**
 * extract-build-zenith.js  —  v1.1
 * Script à coller dans la console DevTools de zenithwakfu.com/builder/XXXXX
 * F12 → Console → colle → Entrée
 */

(async function extractZenithBuild() {

  const result = {
    source: 'zenith', version: '1.1',
    extracted: new Date().toISOString(),
    character: {}, equipment: {}, spells: [], passives: [], aptitudes: {}, stats: {},
  };

  const CLASSES = ['sram','iop','cra','sacrier','ecaflip','feca','eniripsa','xelor',
                   'pandawa','sadida','osamodas','rogue','masqueraider','foggernaut',
                   'eliotrope','huppermage','ouginak','forgelance'];

  // ── 1. Classe et niveau depuis le titre ───────────────────────
  // Format : "Zenith | Wakfu Builder - sram / 50" ou "sram / 50"
  // Le titre réel est dans og:title ou twitter:title
  const metaTitle =
    document.querySelector('meta[property="og:title"]')?.content ||
    document.querySelector('meta[name="twitter:title"]')?.content ||
    document.title;

  console.log('[Zenith] Titre détecté:', metaTitle);

  // Cherche "classe / niveau" dans le titre
  for (const cls of CLASSES) {
    const re = new RegExp(cls + '\\s*/\\s*(\\d+)', 'i');
    const m = metaTitle.match(re);
    if (m) {
      result.character.class = cls;
      result.character.level = parseInt(m[1]);
      break;
    }
  }

  // Fallback : cherche dans le texte de la page
  const fullText = document.body.innerText;
  if (!result.character.class) {
    for (const cls of CLASSES) {
      if (fullText.toLowerCase().includes(cls)) {
        result.character.class = cls;
        break;
      }
    }
  }

  // ── 2. Nom du build ────────────────────────────────────────────
  // Parfois affiché dans un champ "Nom" ou dans le titre après le tiret
  const titleParts = metaTitle.split(/\s*-\s*/);
  if (titleParts.length >= 2) {
    const lastPart = titleParts[titleParts.length - 1].trim();
    // Si c'est pas "classe / niveau" → c'est le nom du build
    if (!/\//.test(lastPart) && !CLASSES.includes(lastPart.toLowerCase())) {
      result.character.name = lastPart;
    }
  }

  // ── 3. Stats via le texte brut ─────────────────────────────────
  // Zenith affiche les stats finales dans la page
  function extractNum(patterns) {
    for (const pat of patterns) {
      const m = fullText.match(pat);
      if (m) {
        const raw = (m[1] || '').replace(/\s/g, '');
        const n = parseInt(raw);
        if (!isNaN(n) && n > 0) return n;
      }
    }
    return 0;
  }

  // Zenith utilise les noms en français
  result.stats = {
    ap:              extractNum([/\bPA\s+:?\s*(\d+)/, /\bPA\b.*?(\d+)/]),
    mp:              extractNum([/\bPM\s+:?\s*(\d+)/, /\bPM\b.*?(\d+)/]),
    wp:              extractNum([/\bPW\s+:?\s*(\d+)/, /\bPW\b.*?(\d+)/]),
    'maîtriseFeu':   extractNum([/(?:maîtrise|maitrise)\s+feu\s*:?\s*([\d\s]+)/i, /feu\s*:?\s*([\d\s]+)(?:\s*mastery)?/i]),
    'maitriseEau':   extractNum([/(?:maîtrise|maitrise)\s+eau\s*:?\s*([\d\s]+)/i]),
    'maitriseTerre': extractNum([/(?:maîtrise|maitrise)\s+terre\s*:?\s*([\d\s]+)/i]),
    'maitriseAir':   extractNum([/(?:maîtrise|maitrise)\s+air\s*:?\s*([\d\s]+)/i]),
    'maitriseMelee': extractNum([/(?:maîtrise|maitrise)\s+m[eê]l[ée]e\s*:?\s*([\d\s]+)/i, /m[eê]l[ée]e\s*:?\s*([\d\s]+)/i]),
    'maitriseDistance': extractNum([/(?:maîtrise|maitrise)\s+distance\s*:?\s*([\d\s]+)/i, /distance\s*:?\s*([\d\s]+)/i]),
    'maitriseZone':  extractNum([/(?:maîtrise|maitrise)\s+zone\s*:?\s*([\d\s]+)/i]),
    'maitriseMono':  extractNum([/(?:maîtrise|maitrise)\s+mono\s*:?\s*([\d\s]+)/i, /monocible\s*:?\s*([\d\s]+)/i]),
    'maitriseCrit':  extractNum([/(?:maîtrise|maitrise)\s+critique\s*:?\s*([\d\s]+)/i, /critique\s*:?\s*([\d\s]+)/i]),
    'degatsInfliges':extractNum([/d[ée]g[âa]ts?\s+inflig[eé]s?\s*:?\s*(\d+)/i, /damage\s+inflicted?\s*:?\s*(\d+)/i]),
    'tauxCC':        extractNum([/(?:coup|taux)\s*critique\s*:?\s*(\d+)/i, /critical\s+(?:hit|chance)\s*:?\s*(\d+)/i]),
    'esquive':       extractNum([/esquive\s*:?\s*([\d\s]+)/i, /dodge\s*:?\s*([\d\s]+)/i]),
    'tacle':         extractNum([/tacle\s*:?\s*([\d\s]+)/i, /lock\s*:?\s*([\d\s]+)/i]),
    'pv':            extractNum([/(?:pv|hp|points?\s*de\s*vie)\s*:?\s*([\d\s]+)/i]),
  };

  // Supprimer les valeurs nulles
  result.stats = Object.fromEntries(Object.entries(result.stats).filter(([,v]) => v > 0));

  // ── 4. API interne ─────────────────────────────────────────────
  const codeM = window.location.pathname.match(/\/builder\/([a-z0-9]+)$/i);
  if (codeM) {
    const code = codeM[1];
    // Zenith stocke les builds avec un code court — essaie l'API
    for (const endpoint of [`/api/builds/${code}`, `/builds/${code}`, `/api/builder/${code}`]) {
      try {
        const r = await fetch(endpoint, { headers: { Accept: 'application/json' } });
        if (r.ok) {
          const data = await r.json();
          console.log('[Zenith] API répondue:', endpoint, Object.keys(data));
          if (data.class || data.job)
            result.character.class = (data.class || data.job).toLowerCase();
          if (data.level) result.character.level = parseInt(data.level);
          if (data.name)  result.character.name  = data.name;
          if (data.items || data.equipment) {
            const eq = data.items || data.equipment;
            Object.entries(eq).forEach(([slot, item]) => {
              if (item) result.equipment[slot] = {
                id: item.id, name: item.name || '', level: item.level || 0,
                stats: item.stats || {}, enchants: item.sublimations || [],
              };
            });
          }
          if (data.spells) result.spells = data.spells.map(s =>
            ({ id: s.id, name: s.name || '', element: s.element || '', apCost: s.apCost || 0 }));
          if (data.passives) result.passives = data.passives.map(p =>
            ({ id: p.id, name: p.name || '' }));
          break;
        }
      } catch {}
    }
  }

  // ── 5. Next.js / store React ───────────────────────────────────
  const nextData = window.__NEXT_DATA__?.props?.pageProps;
  if (nextData) {
    const build = nextData.build || nextData.buildData || nextData.data;
    if (build) {
      console.log('[Zenith] __NEXT_DATA__ build keys:', Object.keys(build));
      if (build.spells?.length)
        result.spells = build.spells.map(s =>
          ({ id:s.id, name:s.name||'', element:s.element||'', apCost:s.apCost||0 }));
      if (build.passives?.length)
        result.passives = build.passives.map(p => ({ id:p.id, name:p.name||'' }));
    }
  }

  // ── Output ─────────────────────────────────────────────────────
  const statCount  = Object.keys(result.stats).length;
  const equipCount = Object.keys(result.equipment).length;

  console.log('═══════════════════════════════════════════════');
  console.log('ZENITH BUILD EXTRACT v1.1');
  console.log('═══════════════════════════════════════════════');
  console.log(`Classe  : ${result.character.class || '⚠ non détectée'}`);
  console.log(`Niveau  : ${result.character.level || '?'}`);
  console.log(`Stats   : ${statCount} valeurs`);
  console.log(`Équip.  : ${equipCount} pièces`);

  const json = JSON.stringify(result, null, 2);
  console.log(json);

  try {
    await navigator.clipboard.writeText(json);
    console.log('✅ JSON copié dans le presse-papier !');
  } catch {
    console.log('⚠ Copie manuelle nécessaire.');
  }

  return result;
})();
