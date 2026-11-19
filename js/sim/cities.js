/* IRON DIALECTIC — cities: the units of politics. Every city, and each country's countryside, has a size (its voice), a
   lean (the ideology it wants, if not yours), the strength of that lean (0–100) and its own unrest. Provinces belong to
   their nearest city, or to the countryside. Big cities decide which way the country tilts. Runs monthly. No DOM. */
(function () {
  'use strict';
  const ID = (globalThis.ID = globalThis.ID || {});
  const B = ID.B, clamp = ID.clamp, c100 = (v) => clamp(v, 0, 100);
  const Ct = (ID.Cities = {});
  Ct.REACH = 28;          // a province belongs to the nearest city within this many tiles, else to the countryside
  Ct.CITY_VOICE = 800;    // political weight of a city at full condition (the capital counts triple)
  Ct.RURAL_VOICE = 0.35;  // the countryside weighs its land's people × this: villages are many but scattered
  Ct.RISE = 40;           // lean strength at which a unit starts to join a rising; fully in by RISE + Ct.SPAN
  Ct.SPAN = 35;

  /* ---------------------------------------------------------------- records */
  const blank = (nm) => ({ nm, lean: null, str: 0, un: 10, sp: 0, cd: {}, court: 0, calm: 0, rally: 0, o: 0, br: [], ub: [], hl: '' });
  Ct.rec = function (G, i) {
    const C = G.cty || (G.cty = {});
    if (!C[i]) {
      const rng = new ID.RNG(((G.seed || 1) ^ Math.imul(i + 1, 2654435761)) >>> 0), used = Ct.usedNames(G);
      const nm = ID.genName(rng, used); C[i] = blank(nm ? nm.base : 'City ' + i); C[i].o = G.owner[i];
    }
    return C[i];
  };
  Ct.usedNames = (G) => { if (!G._cityNames) { G._cityNames = new Set(G.nations.filter(Boolean).map((n) => n.base)); for (const k in G.cty || {}) G._cityNames.add(G.cty[k].nm); } return G._cityNames; };
  Ct.rural = (n) => n.rural || (n.rural = blank('The countryside'));
  /* The units of a state: [{key, i (tile, or -1), r (record), w (weight), share}] — fresh each month in n.a.units. */
  Ct.units = (G, n) => n.a.units || Ct.build(G, n);
  Ct.build = function (G, n) {
    const out = [];
    for (const i of G.blist) if (G.bld[i] === B.CITY && G.owner[i] === n.id) out.push({ key: i, i, r: Ct.rec(G, i), w: Ct.CITY_VOICE * (G.hp[i] / 100) * (i === n.capital ? 3 : 1) });
    out.push({ key: 'r', i: -1, r: Ct.rural(n), w: Math.max(1, n.popLand * Ct.RURAL_VOICE) });
    let tot = 0; for (const u of out) tot += u.w;
    for (const u of out) u.share = u.w / tot;
    out.sort((a, b) => b.w - a.w);
    n.a.units = out; return out;
  };
  /* The unit a province answers to. */
  Ct.ofProv = function (G, Pr) {
    const n = G.nations[Pr.owner]; if (!n || !n.alive) return null;
    if (Pr.cu && G.bld[Pr.cu] === B.CITY && G.owner[Pr.cu] === n.id) return Ct.rec(G, Pr.cu);
    return Ct.rural(n);
  };
  Ct.ofTile = (G, i) => Ct.ofProv(G, G.provinces[G.prov[i]]);
  Ct.name = (G, r) => r.nm;
  Ct.leanOf = (G, n, r) => (r.lean && r.lean !== n.ideo && r.str >= 20 ? r.lean : null); // null = loyal enough

  /* Agitation for ideology `ideo` in some of t's units (foreign money, doctrines, programmes, events). */
  Ct.agitate = function (G, t, ideo, amt, sponsor, o) {
    o = o || {};
    let us = Ct.units(G, t).slice();
    if (o.near) { const W = G.W; us = us.filter((u) => u.i < 0 ? true : ((u.i % W) - o.near.x) ** 2 + (((u.i / W) | 0) - o.near.y) ** 2 <= o.near.r * o.near.r); }
    if (o.count) { const pick = []; for (let c = 0; c < o.count && us.length; c++) pick.push(G.rng.pick(us)); us = pick; }
    let k = 0;
    for (const u of us) {
      if (o.chance && !G.rng.chance(o.chance)) continue;
      const r = u.r;
      if (r.lean !== ideo && (r.str < (o.take || 30) || G.rng.chance(0.25))) { r.lean = ideo; r.str = Math.max(r.str * 0.5, o.floor || 8); }
      if (r.lean === ideo) { r.str = c100(r.str + amt * (u.i < 0 ? 0.6 : 1)); r.un = c100(r.un + amt * (o.unrest || 0)); if (sponsor) r.sp = sponsor; k++; }
      if (o.fx && u.i >= 0) ID.fx(G, 'subvert', u.i, { col: ID.IDEOLOGIES[ideo].color });
    }
    return k;
  };
  Ct.each = (G, n, fn) => { for (const u of Ct.units(G, n)) fn(u.r, u); };
  Ct.forLean = (G, n, ideo, fn) => { let k = 0; for (const u of Ct.units(G, n)) if (u.r.lean === ideo) { fn(u.r, u); k++; } return k; };

  /* ---------------------------------------------------------------- the tilt */
  /* How much of the country stands behind each opposing lean: Σ share × participation, participation rising from 0 at
     strength RISE to 1 at RISE + SPAN. */
  Ct.tilt = function (G, n) {
    const t = {};
    for (const u of Ct.units(G, n)) { const r = u.r; if (!r.lean || r.lean === n.ideo) continue; const p = clamp((r.str - Ct.RISE) / Ct.SPAN, 0, 1); if (p > 0) t[r.lean] = (t[r.lean] || 0) + u.share * p; }
    return t;
  };
  Ct.movement = function (G, n) {
    const t = Ct.tilt(G, n); let best = null, bs = 0;
    for (const k in t) if (t[k] > bs) { bs = t[k]; best = k; }
    return { ideo: best, share: bs };
  };
  /* The units that rise for `ideo`, and the provinces that go with them. */
  Ct.rising = function (G, n, ideo) {
    const us = Ct.units(G, n).filter((u) => u.r.lean === ideo && u.r.str >= Ct.RISE), provs = [], names = [];
    let rural = 0; const cityT = new Set();
    for (const u of us) { if (u.i >= 0) { cityT.add(u.i); names.push(u.r.nm); } else { rural = clamp((u.r.str - Ct.RISE) / Ct.SPAN, 0, 1); names.push('the countryside'); } }
    const ruralProvs = [];
    for (let p = 1; p < G.provinces.length; p++) {
      const Pr = G.provinces[p]; if (Pr.owner !== n.id) continue;
      if (Pr.cu && cityT.has(Pr.cu)) provs.push(p);
      else if (!Pr.cu && rural > 0 && p !== G.prov[n.capital]) ruralProvs.push(p);
    }
    if (rural > 0) { // the villages farthest from the capital rise first
      const W = G.W, cx = n.capital % W, cy = (n.capital / W) | 0;
      ruralProvs.sort((a, b) => Math.hypot(G.provinces[b].cx - cx, G.provinces[b].cy - cy) - Math.hypot(G.provinces[a].cx - cx, G.provinces[a].cy - cy));
      for (let k = 0; k < Math.round(ruralProvs.length * rural); k++) provs.push(ruralProvs[k]);
    }
    let sponsor = 0; for (const u of us) if (u.r.sp) sponsor = u.r.sp;
    return { units: us, provs, names, sponsor };
  };
  Ct.list = (names) => (names.length <= 1 ? names[0] || '' : names.slice(0, -1).slice(0, 3).join(', ') + (names.length > 4 ? ' and others' : ' and ' + names[names.length - 1]));

  /* ---------------------------------------------------------------- monthly */
  const add = (arr, label, v) => { if (Math.abs(v) >= 0.05) arr.push([label, v]); };
  /* Provinces to their nearest city, and each state's units. */
  Ct.assign = function (G) {
    for (const k in G.cty || {}) { const i = +k; if (G.bld[i] !== B.CITY) { delete G.cty[k]; continue; } const r = G.cty[k]; if (r.o !== G.owner[i]) { r.o = G.owner[i]; r.str *= 0.5; r.sp = 0; r.court = 0; r.calm = 0; } }
    const cities = {};
    for (const i of G.blist) if (G.bld[i] === B.CITY && G.owner[i]) (cities[G.owner[i]] || (cities[G.owner[i]] = [])).push(i);
    const W = G.W;
    for (let p = 1; p < G.provinces.length; p++) {
      const Pr = G.provinces[p], L = cities[Pr.owner]; Pr.cu = 0; if (!L) continue;
      let bd = Ct.REACH * Ct.REACH;
      for (const i of L) { const d = ((i % W) - Pr.cx) ** 2 + (((i / W) | 0) - Pr.cy) ** 2; if (d < bd) { bd = d; Pr.cu = i; } }
    }
    for (const n of G.nations) if (n && n.alive) Ct.build(G, n);
  };
  Ct.month = function (G) {
    const diffP = ID.DIFFICULTY[G.difficulty], waves = G.world.waves || [], W = G.W, Dp = ID.Diplomacy;
    Ct.assign(G);
    for (const n of G.nations) {
      if (!n || !n.alive) continue;
      n.a.losingWar = !!(n.nwars && Dp.enemies(G, n).some((e) => Dp.warScore(G, n, e) < -0.3));
      const I = ID.ideo(n), sec = ID.LAWS.security.opts[n.laws.security], press = ID.LAWS.press.opts[n.laws.press];
      const secEff = clamp(n.budget.security / 0.08, 0.3, 1.3), losing = n.nwars && n.a.losingWar;
      const us = n.a.units; let out = 0, opp = 0;
      us.forEach((u, idx) => {
        const r = u.r, city = u.i >= 0, Pr = city ? G.provinces[G.prov[u.i]] : G.provinces[G.prov[n.capital >= 0 ? n.capital : 0]] || { rough: 0, region: '' };
        if (r.lean === n.ideo) { r.lean = null; r.str *= 0.3; }
        // unrest
        const ub = [];
        add(ub, 'Living standards (' + Math.round(n.ls) + ')', (50 - n.ls) * 0.22);
        add(ub, 'Stability (' + Math.round(n.stab) + ')', (50 - n.stab) * 0.45);
        if (n.famine) add(ub, 'Famine', city ? 15 : 20);
        add(ub, 'War weariness', n.we * 0.18);
        add(ub, ID.LAWS.security.opts[n.laws.security].name, sec.unrest * secEff);
        add(ub, 'Events and programmes', ID.mod(n, 'unrest'));
        if (city) {
          add(ub, 'A city crowds people together', 6);
          add(ub, 'Size: ' + Math.round(u.share * 100) + '% of the country’s voice', u.share * 25);
          if (n.strike > 0) add(ub, 'Strikes', 10);
          if (G.hp[u.i] < 100) add(ub, 'War damage (' + G.hp[u.i] + '%)', (100 - G.hp[u.i]) * 0.15);
          if (Pr.core !== n.id) add(ub, 'Occupied, not yet integrated', 15);
        } else if (I.econ.model === 'manor' && n.rent > 35) add(ub, 'Rent on the harvest (' + Math.round(n.rent) + '%)', (n.rent - 35) * 0.5);
        if (r.lean && r.str > 40) add(ub, ID.IDEOLOGIES[r.lean].name + ' agitation', (r.str - 40) * 0.15);
        if (r.court > 0) add(ub, 'Courted by the government', -8);
        if (r.calm > 0) add(ub, 'Concessions granted', -6);
        if (r.rally > 0) add(ub, losing ? 'Bombed while the war is lost' : 'Rallying round the flag', losing ? 8 : -6);
        let ut = 13; for (const x of ub) ut += x[1];
        r.un = c100(r.un + (c100(ut) - r.un) * 0.15); r.ub = ub; r.ut = c100(ut);
        // lean
        if (!r.lean || r.str < 6) {
          if ((idx + G.tick / 30) % 4 < 1 || !r.lean) { const pick = ID.Politics.pickOpp(G, n, { urban: city ? 0.85 : 0.1, rough: Pr.rough || 0, region: Pr.region }); r.lean = pick ? pick.id : null; r.sp = 0; }
        }
        const br = [];
        if (r.lean) {
          const cs = ID.Politics.classSupport(n, r.lean, city ? 0.85 : 0.1), F = ID.IDEOLOGIES[r.lean].family;
          add(br, 'Unrest here (' + Math.round(r.un) + ')', (r.un - 22) * 0.07);
          add(br, 'Its supporters are ' + (cs < 50 ? 'unhappy' : 'content') + ' (' + Math.round(cs) + ')', (50 - cs) * 0.045);
          add(br, ID.LAWS.press.opts[n.laws.press].name, press.spread * 1.2);
          add(br, ID.LAWS.security.opts[n.laws.security].name, -sec.repress * secEff * 1.6);
          if (n.trans > 0) add(br, 'The regime is in transition', 0.5);
          add(br, 'Events and programmes', ID.mod(n, 'opp'));
          let wv = 0, wsrc = null;
          for (const w of waves) {
            if (w.fam !== F || w.src === n.id) continue;
            const px = city ? u.i % W : Pr.cx, py = city ? (u.i / W) | 0 : Pr.cy, d = Math.hypot(px - w.x, py - w.y), rad = 50 + w.m * 9;
            if (d < rad) { wv += 1.15 * w.str * (1 - w.m / 24) * (press.infl > 0 ? 1 + press.infl : 1 + press.infl * 0.8); wsrc = w.src; }
          }
          if (wv) add(br, 'A revolutionary wave' + (wsrc && G.nations[wsrc] ? ' from ' + G.nations[wsrc].base : ''), wv);
          if (r.court > 0) add(br, 'Courted by the government', -1.5);
          if (r.calm > 0) add(br, 'Concessions granted', -2);
          if (r.rally > 0) add(br, losing ? 'Bombed while the war is lost' : 'Rallying round the flag', losing ? 1 : -1);
          let g = 0; for (const x of br) g += x[1];
          if (!city) g *= 0.6; // villages move slowly
          if (g > 0 && !n.ai) g *= diffP.crisis;
          r.str = c100(r.str + g); r.g = g;
        } else r.g = 0;
        r.br = br;
        for (const k of ['court', 'calm', 'rally']) if (r[k] > 0) r[k]--;
        if (city) out += 6 * (G.hp[u.i] / 100) * (1 - r.un / 200);
        if (r.lean && r.lean !== n.ideo) opp += u.share * r.str;
        // a big city turning: a headline for the player, a line for the great powers
        if (city && idx < 3 && r.lean && r.str >= 60 && r.hl !== r.lean) {
          r.hl = r.lean;
          const IN = ID.IDEOLOGIES[r.lean].name;
          if (n.id === G.player) ID.headline(G, { kicker: 'The city turns', title: r.nm + ' goes ' + IN, sub: r.nm + ', ' + Math.round(u.share * 100) + '% of the country’s voice, now stands behind the ' + IN + ' movement (strength ' + Math.round(r.str) + '). Court it, crack down, or concede.', a: n.id, tone: 'bad' });
          else if (ID.isMajor(G, n)) ID.news(G, r.nm + ', one of the great cities of ' + n.name + ', turns ' + IN + '.', 'pol', n.id);
        } else if (r.hl && (!r.lean || r.str < 45)) r.hl = '';
      });
      n.a.cityOut = out; n.a.opp = opp;
    }
  };

  /* ---------------------------------------------------------------- actions */
  /* Court: money and attention; slow, costly in big cities, does nothing about the cause.
     Crack down: fast, needs a police; hidden grievance, and under a free press the rest of the country notices.
     Concede: calm for good, but the country drifts toward what they wanted. */
  Ct.ACT = {
    court: { name: 'Court the city', cd: 12 },
    crack: { name: 'Crack down', cd: 12 },
    concede: { name: 'Concede', cd: 24 },
  };
  Ct.cost = function (G, n, u, act) {
    const big = u.share;
    if (act === 'court') return { gold: Math.round(20 + big * 500), auth: 5 };
    if (act === 'crack') return { auth: Math.round(8 + big * 40) };
    return { auth: Math.round(10 + big * 50) };
  };
  Ct.preview = function (G, n, u, act) {
    const r = u.r, IN = r.lean ? ID.IDEOLOGIES[r.lean].name : 'opposition';
    if (act === 'court') return 'Its ' + IN + ' lean −8 now and −1.5 a month for a year; unrest −8 while courted.';
    if (act === 'crack') return 'Lean ×0.6 and unrest −15 now. Hidden grievance +' + Math.round(5 + u.share * 30) + (n.laws.press === 'free' || n.laws.press === 'regulated' ? '; the press reports it: unrest +3 in every other city, intelligentsia −4' : '') + '.';
    const can = r.lean && n.drift[r.lean] != null;
    return 'Lean ×0.3 now, −2 a month and unrest −6 for two years. ' + (can ? 'The country drifts toward ' + IN + ': +' + Math.round(8 + u.share * 40) + '.' : 'Your system cannot become ' + IN + ': legitimacy −2 for two years instead.');
  };
  Ct.block = function (G, n, key, act) {
    const u = Ct.units(G, n).find((x) => String(x.key) === String(key)); if (!u) return 'Not one of your cities.';
    const r = u.r, A = Ct.ACT[act]; if (!A) return 'Unknown action.';
    if (!r.lean || r.str < 10) return 'There is no movement here to deal with.';
    if ((r.cd[act] || 0) > G.tick) return 'Possible again ' + ID.dateOf(r.cd[act]).short + '.';
    if (act === 'crack' && ID.LAWS.security.opts[n.laws.security].repress < 0.3) return 'Needs at least public order police (Laws).';
    const c = Ct.cost(G, n, u, act);
    if (c.gold && n.gold < c.gold) return 'Needs ' + c.gold + ' gold.';
    if (c.auth && n.auth < c.auth) return 'Needs ' + c.auth + ' authority.';
    return '';
  };
  Ct.act = function (G, n, key, act) {
    const why = Ct.block(G, n, key, act); if (why) return why;
    const u = Ct.units(G, n).find((x) => String(x.key) === String(key)), r = u.r, c = Ct.cost(G, n, u, act);
    n.gold -= c.gold || 0; n.auth -= c.auth || 0; r.cd[act] = G.tick + Ct.ACT[act].cd * 30;
    if (act === 'court') { r.str = c100(r.str - 8); r.court = 12; }
    else if (act === 'crack') {
      r.str *= 0.6; r.un = c100(r.un - 15); n.grievance = c100(n.grievance + 5 + u.share * 30);
      if (n.laws.press === 'free' || n.laws.press === 'regulated') { for (const v of Ct.units(G, n)) if (v !== u && v.i >= 0) v.r.un = c100(v.r.un + 3); n.sm.intelligentsia -= 4; }
    } else {
      r.str *= 0.3; r.calm = 24;
      if (r.lean && n.drift[r.lean] != null) n.drift[r.lean] = c100(n.drift[r.lean] + 8 + u.share * 40);
      else ID.addMod(n, 'legit', -2, 24, 'Concessions to ' + r.nm);
    }
    if (n.id === G.player) ID.news(G, Ct.ACT[act].name + ': ' + r.nm + '.', 'pol', n.id);
    return '';
  };
  /* AI: deal with its biggest restless city now and then. */
  Ct.aiMonth = function (G, n) {
    if (!G.rng.chance(0.15)) return;
    const u = Ct.units(G, n).find((x) => x.r.lean && x.r.lean !== n.ideo && x.r.str > 62 && x.share > 0.06); if (!u) return;
    const order = n.stab < 40 && ID.LAWS.security.opts[n.laws.security].repress >= 0.3 ? ['crack', 'court', 'concede'] : ['court', 'crack', 'concede'];
    for (const a of order) if (!Ct.block(G, n, u.key, a)) { Ct.act(G, n, u.key, a); return; }
  };

  /* ---------------------------------------------------------------- war on cities */
  /* A city bombed, shelled or besieged: it rallies round the flag, unless its government is losing the war. */
  Ct.hit = function (G, i) {
    if (G.bld[i] !== B.CITY) return;
    const n = G.nations[G.owner[i]]; if (!n) return;
    const r = Ct.rec(G, i); r.rally = 6;
    if (n.a.losingWar) { r.un = c100(r.un + 10); r.str = c100(r.str + 5); } else r.str = Math.max(0, r.str - 8);
  };

  /* Old saves: each city takes its province's old opposition, the countryside the strongest rural one. */
  Ct.migrate = function (G, provOpp) {
    G.cty = G.cty || {};
    for (const i of G.blist) if (G.bld[i] === B.CITY && G.owner[i]) { const s = provOpp[G.prov[i]]; const r = Ct.rec(G, i); if (s && s[0]) { r.lean = s[0]; r.str = s[1] || 0; } }
    for (const n of G.nations) {
      if (!n || !n.alive || n.rural) continue;
      const tally = {}; for (let p = 1; p < G.provinces.length; p++) { const s = provOpp[p]; if (G.provinces[p].owner === n.id && s && s[0]) { tally[s[0]] = tally[s[0]] || [0, 0]; tally[s[0]][0]++; tally[s[0]][1] += s[1] || 0; } }
      let best = null; for (const k in tally) if (!best || tally[k][0] > tally[best][0]) best = k;
      const r = Ct.rural(n); if (best) { r.lean = best; r.str = tally[best][1] / tally[best][0]; }
    }
  };
})();
