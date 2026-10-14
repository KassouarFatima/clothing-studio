// The tailor's sheet for a MODE look: for every piece, the fabric to buy (and how much), the pattern pieces to cut,
// how to cut them, the order to sew them, the notions (zips, buttons, rib), and the measurements to take. Built from
// tailoring rules, not AI: it is instant and always available. Quantities are for size M on 150 cm wide fabric.
import PDFDocument from 'pdfkit';

const FABRICS = {
  jersey: { name: 'Cotton single jersey', spec: '160–180 g/m², 95% cotton / 5% elastane', seams: 'Overlock the seams; twin-needle or coverstitch the hems', needle: 'Ballpoint 75/11', care: 'Prewash before cutting (cotton shrinks 3–5%)' },
  fleece: { name: 'Brushed-back sweatshirt fleece', spec: '280–340 g/m², 80% cotton / 20% polyester', seams: 'Overlock; topstitch seam allowances flat', needle: 'Ballpoint 80/12', care: 'Prewash; cut cuffs and waistband from matching 2×2 rib' },
  sport: { name: 'Performance stretch knit', spec: '140–180 g/m², polyester / elastane, 4-way stretch', seams: 'Flatlock or 4-thread overlock', needle: 'Stretch 75/11', care: 'Do not iron hot; use a press cloth' },
  denim: { name: 'Cotton denim (twill)', spec: '12–14 oz (400–470 g/m²); 1–2% elastane for skinny fits', seams: 'Flat-felled seams, double topstitching in jeans thread', needle: 'Jeans 100/16', care: 'Wash once before cutting if not sanforised' },
  wool: { name: 'Wool suiting / wool coating', spec: 'Suiting 260–320 g/m² for trousers and blazers; melton 450–600 g/m² for coats', seams: 'Pressed open with steam and a clapper; line with viscose (Bemberg)', needle: 'Universal 90/14', care: 'Steam-shrink before cutting; cut with the nap all in one direction' },
  leather: { name: 'Leather (lambskin or cowhide) or quality PU', spec: '0.8–1.0 mm thick', seams: 'Clips instead of pins; seams glued open and topstitched; fully lined', needle: 'Leather 90/14, Teflon or walking foot', care: 'Cut single layer, face down; pin only inside seam allowances' },
  linen: { name: 'Washed linen', spec: '150–200 g/m² for shirts and dresses, 200–260 g/m² for trousers', seams: 'French seams (or flat-felled)', needle: 'Universal 80/12', care: 'Prewash and tumble-dry before cutting (linen shrinks up to 8%)' },
  knit: { name: 'Sweater knit', spec: 'Wool or cotton knit, 300–400 g/m², or fully fashioned 7–12 gauge', seams: 'Overlock or linker; rib trims at neck, cuffs and hem', needle: 'Ballpoint 90/14', care: 'Lay flat to cut; do not stretch while sewing' },
  poplin: { name: 'Cotton poplin shirting', spec: '110–130 g/m², 100% cotton (or 97/3 stretch)', seams: 'Flat-felled or French seams; narrow double-fold hems', needle: 'Microtex 70/10', care: 'Prewash; press with steam' },
  twill: { name: 'Cotton twill / gabardine', spec: '220–280 g/m², 100% cotton (trench: water-repellent gabardine)', seams: 'Overlock and topstitch, or flat-felled', needle: 'Universal 90/14', care: 'Prewash before cutting' },
  satin: { name: 'Crepe-back satin', spec: '90–120 g/m², silk or polyester', seams: 'French seams; narrow rolled hems', needle: 'Microtex 60/8', care: 'Cut single layer between tissue paper; skirts and slip dresses are cut on the bias' },
};
const PATTERN_NOTE = {
  stripes: 'Stripes must line up at the side seams and sleeves: buy 10% more fabric and cut single layer.',
  pinstripe: 'Keep pinstripes vertical and centred on the front: buy 10% more.',
  plaid: 'Match the checks at every seam (centre front, side seams, sleeves): buy 15–20% more and cut single layer.',
  camo: 'No matching needed.', dots: 'Centre a dot on the centre front for a neat look.',
};
const COLOURS = [['white', '#f2f1ee'], ['cream', '#ece4d4'], ['black', '#141414'], ['charcoal', '#3a3a3a'], ['grey', '#7d8085'], ['navy', '#1b2340'],
  ['denim blue', '#3b5a85'], ['light blue', '#a9c1dc'], ['red', '#9b1c1f'], ['burgundy', '#5a1a24'], ['forest green', '#2e4a36'], ['olive', '#4a5236'],
  ['sand', '#d8c6a5'], ['beige', '#c8b48a'], ['camel', '#b88a5a'], ['brown', '#6b4226'], ['yellow', '#e2b632'], ['orange', '#e07a2a'], ['pink', '#e8a6b8'], ['lime', '#b5d33a']];
function colourName(hex) {
  const c = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r, g, b] = c(hex || '#808080');
  let best = COLOURS[0][0], d = Infinity;
  for (const [n, h] of COLOURS) { const [r2, g2, b2] = c(h), e = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2; if (e < d) { d = e; best = n; } }
  return best;
}

function topSheet(p, outer) {
  const long = p.sleeves === 'long', none = p.sleeves === 'none', dress = p.length === 'dress', coat = outer && p.length === 'long';
  let metres = none ? 0.8 : long ? 1.3 : 1.0;
  if (p.length === 'crop') metres -= 0.2; if (p.length === 'long') metres += 0.4; if (dress) metres += 0.9; if (p.hood) metres += 0.5; if (outer) metres += 0.3;
  const opening = p.zip ? 'zip' : p.buttons ? 'buttons' : null;
  const cut = [
    opening ? 'Front × 2 (left and right, with a 4 cm button stand / zip allowance)' : 'Front × 1, on the fold',
    'Back × 1, on the fold', ...(none ? [] : [`Sleeve × 2${long ? ' (full length, wrist-to-shoulder)' : p.sleeves === 'three-quarter' ? ' (¾ length)' : ' (short)'}`]),
    ...(p.collar ? ['Collar × 2 + collar stand × 2 (interfaced)'] : p.hood ? [] : [p.ribbed ? 'Neck rib × 1 (2×2 rib, 85% of the neckline length)' : 'Neckband × 1 (cut across the stretch)']),
    ...(p.hood ? ['Hood × 2 + hood lining × 2', 'Drawstring cord 1.4 m + 2 eyelets'] : []),
    ...(p.pocket === 'kangaroo' ? ['Kangaroo pocket × 1'] : p.pocket === 'chest' ? ['Chest pocket × 1'] : []),
    ...(p.ribbed ? ['Cuffs × 2 and waistband × 1 in 2×2 rib (cut at 85% of the opening)'] : []),
    ...(opening ? ['Front facings × 2 (interfaced)'] : []),
    ...(outer && (p.fabric === 'wool' || p.fabric === 'leather') ? ['Lining: fronts, back, sleeves (same pattern, 1 cm shorter)'] : []),
  ];
  const steps = [
    'Stay-stitch the neckline so it does not stretch.',
    ...(p.pocket !== 'none' ? ['Sew the pocket onto the front (topstitch the edges, bar-tack the corners).'] : []),
    'Join the shoulder seams.',
    p.hood ? 'Sew the hood pieces, line the hood, then attach it to the neckline (eyelets and cord first).' : p.collar ? 'Make the collar and stand, then attach to the neckline.' : 'Attach the neckband, stretching it slightly, and topstitch.',
    ...(none ? ['Finish the armholes with a band or a facing.'] : ['Set in the sleeves flat (before closing the sides).']),
    `Close the sides${none ? '' : ' and sleeve underarms in one seam'}.`,
    ...(opening === 'zip' ? ['Insert the separating zip between the fronts and facings.'] : opening === 'buttons' ? ['Interface the front facings, sew the buttonholes on the right front (women: left) and the buttons.'] : []),
    p.ribbed ? 'Attach the cuffs and waistband rib, stretching it to fit.' : 'Hem the sleeves and the body.',
    ...(outer && (p.fabric === 'wool' || p.fabric === 'leather') ? ['Bag the lining in (machine along the facings and hem, close by hand).'] : []),
    'Press the whole garment (use a press cloth on dark or shiny fabric).',
  ];
  const notions = [
    ...(opening === 'zip' ? [`Separating zip, ${coat || dress ? 70 : 55} cm`] : []),
    ...(opening === 'buttons' ? [`${coat ? 6 : dress ? 9 : 7} buttons, ${outer ? 20 : 11} mm`] : []),
    ...(p.collar || opening ? ['Fusible interfacing, 0.5 m'] : []),
    ...(p.ribbed ? ['2×2 rib knit, 0.3 m'] : []),
    'Matching thread (topstitch thread for denim and leather)',
  ];
  return { metres, cut, steps, notions, fit: dress ? 'Dress length: knee to mid-calf; check the hem with shoes on.' : p.length === 'crop' ? 'Cropped: hem 2–3 cm above the navel.' : coat ? 'Coat: allow 8–10 cm ease at the chest to wear over knitwear.' : outer ? 'Jacket: allow 6–8 cm ease at the chest to layer over a shirt.' : 'Allow 6–10 cm ease at the chest for a regular fit.' };
}
const FIT = {
  skinny: 'Skinny: close fit with negative ease — use stretch fabric (2% elastane). Leg opening about 28 cm.',
  straight: 'Straight leg: same width from knee to hem, leg opening about 38 cm.',
  tailored: 'Tailored: pressed front crease, slight break over the shoe, leg opening 36–38 cm.',
  wide: 'Wide leg: relaxed from the hip, leg opening 50–56 cm.',
  flared: 'Flared: fitted to the knee, widening to a 50 cm hem.',
  jogger: 'Jogger: elastic waist (3–4 cm elastic + drawcord) and rib cuffs at the ankle.',
  cargo: 'Cargo: relaxed fit, bellows pockets on the outer thigh.',
};
function bottomSheet(p) {
  if (p.kind === 'skirt') {
    const pleated = p.shape === 'pleated', pencil = p.shape === 'pencil';
    const metres = { mini: 0.8, knee: 1.0, midi: 1.4, maxi: 2.0 }[p.length] * (pleated ? 1.8 : 1) + (p.fabric === 'satin' && !pencil ? 0.6 : 0);
    return {
      metres: Math.round(metres * 10) / 10,
      cut: [pencil ? 'Front × 1 on the fold (with 2 darts)' : pleated ? `Skirt panel(s): total width = 3 × hip measurement for knife pleats 3 cm deep` : 'Front × 1 on the fold (A-line, flared from the hip)',
        'Back × 2 (centre-back seam for the zip)', 'Waistband × 1 (interfaced), 6 cm wide', ...(pencil ? ['Back vent or slit 15–18 cm'] : []), ...(p.fabric === 'satin' && !pencil ? ['Cut on the bias for a fluid drape'] : [])],
      steps: [pencil ? 'Sew the darts.' : pleated ? 'Mark and press the pleats, baste them along the waist.' : 'Stay-stitch the waist.',
        'Insert an invisible zip in the centre-back seam.', 'Sew the side seams.', 'Attach the interfaced waistband; close with a hook and eye.',
        `Hem: ${p.fabric === 'satin' ? 'narrow rolled hem (let a bias skirt hang 24 h before hemming)' : '3 cm blind hem'}.`, 'Press.'],
      notions: ['Invisible zip 20 cm', 'Hook and eye', 'Fusible interfacing for the waistband', ...(p.fabric === 'satin' || p.fabric === 'wool' ? ['Lining 1 m (optional)'] : [])],
      fit: { mini: 'Mini: hem at mid-thigh.', knee: 'Knee length.', midi: 'Midi: hem at mid-calf.', maxi: 'Maxi: hem at the ankle.' }[p.length] || '',
    };
  }
  const shorts = p.kind === 'shorts', jeans = p.fabric === 'denim';
  const metres = shorts ? 0.7 : p.fit === 'wide' || p.fit === 'flared' ? 1.6 : 1.3;
  return {
    metres,
    cut: ['Front × 2', 'Back × 2', ...(jeans ? ['Back yoke × 2', 'Patch back pockets × 2', 'Coin pocket × 1'] : ['Back welt pockets × 2 (optional)']),
      'Front pocket bags × 4 (pocketing cotton) + pocket facings × 2', ...(p.fit === 'jogger' ? ['Rib ankle cuffs × 2', 'Waistband casing × 1'] : ['Waistband × 2 (interfaced)', 'Fly facing × 1 + fly shield × 1', 'Belt loops: one strip 60 × 4 cm']),
      ...(p.fit === 'cargo' ? ['Bellows cargo pockets × 2 + flaps × 2'] : [])],
    steps: ['Make the front pockets (facings, then pocket bags).', ...(jeans ? ['Sew the back yokes, then topstitch the patch pockets in place.'] : []),
      ...(p.fit === 'cargo' ? ['Sew the cargo pockets and flaps to the outer thighs.'] : []),
      p.fit === 'jogger' ? 'Join the crotch seams.' : 'Insert the fly zip, then join the front and back crotch seams.',
      `Sew the inseams, then the outseams${jeans ? ' (flat-felled)' : ''}.`,
      p.fit === 'jogger' ? 'Sew the waistband casing; thread the elastic and drawcord; attach the rib cuffs.' : 'Attach the waistband and belt loops; buttonhole and button.',
      shorts ? 'Hem (2–3 cm), or turn up a 4 cm cuff.' : p.fit === 'tailored' ? 'Hem with a slight break over the shoe; press a sharp front crease.' : jeans ? 'Double-fold 2 cm hem with jeans thread (let the denim stack slightly over the shoe).' : 'Hem.',
      'Press.'],
    notions: p.fit === 'jogger' ? ['Elastic 3–4 cm, 80 cm', 'Drawcord 1.4 m', 'Rib knit 0.2 m'] : [jeans ? 'Metal jeans zip 18 cm, jeans button and 6 rivets' : 'Trouser zip 18 cm, 1 button and hook-and-bar', 'Pocketing cotton 0.4 m', 'Fusible interfacing 0.3 m'],
    fit: FIT[p.fit] || '',
  };
}
function smallSheet(p) { // shoes, hats, bags, accessories: buy or have them made
  const make = {
    hat: { cap: 'Buy, or sew: 6 crown panels + peak (with a plastic insert).', beanie: 'Knit it (rib, 50 g of yarn) or buy.', bucket: 'Sew: crown top × 1, side band × 1, brim × 2 + interfacing (0.4 m of fabric).', fedora: 'Buy from a hatter (felt).' },
    bag: { tote: 'Sew: body × 2 + base × 1 + handles × 2 (0.6 m of canvas or leather).', crossbody: 'Buy, or have a leather worker make it.', backpack: 'Buy (or a skilled sewist: 1.2 m of nylon canvas + 2 zips + webbing).' },
    accessory: { scarf: 'Knit, or cut 180 × 30 cm of wool and fringe the ends.', belt: 'Buy (leather, 3–3.5 cm wide).', sunglasses: 'Buy.', necklace: 'Buy.' },
    shoes: {},
  }[p.slot]?.[p.kind];
  return { buy: true, note: make || 'Buy this piece (a shoemaker can make it to order).' };
}
// What each MODE garment model is, for the tailor (a suit is a jacket and trousers).
const ASSET_RECIPES = {
  tshirt: [{ slot: 'top', sleeves: 'short', length: 'regular', neck: 'crew', fabric: 'jersey' }],
  mens_shirt: [{ slot: 'top', sleeves: 'long', length: 'regular', neck: 'crew', buttons: true, collar: true, fabric: 'poplin' }],
  flannel: [{ slot: 'top', sleeves: 'long', length: 'regular', neck: 'crew', buttons: true, collar: true, pocket: 'chest', fabric: 'twill', pattern: 'plaid' }],
  hoodie: [{ slot: 'outer', sleeves: 'long', length: 'regular', neck: 'crew', hood: true, zip: true, ribbed: true, fabric: 'fleece' }],
  puffer: [{ slot: 'outer', sleeves: 'long', length: 'regular', neck: 'crew', hood: true, zip: true, ribbed: true, fabric: 'sport', note: 'Quilted: two layers of nylon with 120–200 g/m² synthetic or down padding, channels stitched every 12–15 cm.' }],
  suit: [{ slot: 'outer', part: 'jacket', sleeves: 'long', length: 'regular', neck: 'v', buttons: true, collar: true, fabric: 'wool' },
    { slot: 'bottom', part: 'trousers', kind: 'trousers', fit: 'tailored', length: 'full', fabric: 'wool' }],
  cargo_jeans: [{ slot: 'bottom', kind: 'trousers', fit: 'cargo', length: 'full', fabric: 'twill' }],
  baggy_jeans: [{ slot: 'bottom', kind: 'trousers', fit: 'wide', length: 'full', fabric: 'denim' }],
  short_jeans: [{ slot: 'bottom', kind: 'shorts', fit: 'straight', length: 'short', fabric: 'denim' }],
  plaid_skirt: [{ slot: 'bottom', kind: 'skirt', length: 'mini', shape: 'pleated', fabric: 'wool', pattern: 'plaid' }],
  converse: [{ slot: 'shoes', kind: 'sneakers' }], adidas: [{ slot: 'shoes', kind: 'sneakers' }],
  evening_dress: [{ slot: 'top', sleeves: 'none', length: 'dress', neck: 'v', fabric: 'satin', note: 'Cut on the bias; spaghetti straps crossed at the back; asymmetric handkerchief hem.' }],
  red_dress: [{ slot: 'top', sleeves: 'none', length: 'dress', neck: 'crew', fabric: 'satin', note: 'Fitted bodice with a keyhole neckline; layered petal hem cut in several tiers.' }],
  black_dress: [{ slot: 'top', sleeves: 'none', length: 'dress', neck: 'crew', fabric: 'satin', note: 'Full circle skirt (cut as a circle with a waist hole) on a fitted bodice; tie belt.' },
    { slot: 'outer', part: 'bolero', sleeves: 'long', length: 'crop', neck: 'v', collar: true, fabric: 'wool' }],
  overcoat: [{ slot: 'outer', sleeves: 'long', length: 'long', neck: 'v', buttons: true, collar: true, fabric: 'wool', note: 'Double-breasted (2 × 4 buttons), notched lapels, belt with buckle, fully lined.' }],
  parka: [{ slot: 'outer', sleeves: 'long', length: 'long', neck: 'crew', hood: true, zip: true, ribbed: true, pocket: 'chest', fabric: 'sport', note: 'Quilted in horizontal channels with synthetic padding; drawcord waist; snap storm flap over the zip.' }],
  pumps: [{ slot: 'shoes', kind: 'heels' }], heels: [{ slot: 'shoes', kind: 'heels' }], chelsea: [{ slot: 'shoes', kind: 'boots' }], riding_boot: [{ slot: 'shoes', kind: 'boots' }],
  bucket_hat: [{ slot: 'hat', kind: 'bucket' }], cap: [{ slot: 'hat', kind: 'cap' }], handbag: [{ slot: 'bag', kind: 'crossbody' }],
};
function expand(p) {
  const recipes = ASSET_RECIPES[p.asset];
  if (!recipes) return [p];
  return recipes.map((r) => ({ ...r, name: r.part ? `${p.name} — ${r.part}` : p.name, color: p.color || '#7d8085' }));
}
export function tailorSheet(look) {
  const pieces = (look?.pieces || []).flatMap(expand).map((p) => {
    const f = FABRICS[p.fabric] || (p.slot === 'top' || p.slot === 'outer' || p.slot === 'bottom' ? FABRICS.jersey : null);
    const kind = p.slot === 'top' || p.slot === 'outer' ? topSheet(p, p.slot === 'outer') : p.slot === 'bottom' ? bottomSheet(p) : smallSheet(p);
    let metres = kind.metres;
    if (metres && ['stripes', 'pinstripe'].includes(p.pattern)) metres *= 1.1;
    if (metres && p.pattern === 'plaid') metres *= 1.2;
    if (p.note && kind.fit !== undefined) kind.fit = `${kind.fit} ${p.note}`.trim();
    return { name: p.name, slot: p.slot, colour: `${colourName(p.color)} (${p.color})`, ...kind,
      metres: metres ? Math.round(metres * 10) / 10 : undefined, fabric: kind.buy ? null : f,
      patternNote: p.pattern && p.pattern !== 'none' ? PATTERN_NOTE[p.pattern] : null };
  });
  const sewn = pieces.filter((p) => !p.buy);
  return {
    title: look?.name || 'My look', pieces,
    measurements: ['Chest / bust (fullest part)', 'Waist (natural waist)', 'Hips (fullest part)', 'Shoulder width', 'Arm length (shoulder to wrist)', 'Back length (neck to waist)',
      'Neck', ...(sewn.some((p) => p.slot === 'bottom') ? ['Inseam (crotch to ankle)', 'Outseam (waist to ankle)', 'Thigh', 'Rise (front and back)'] : []), 'Height'],
    general: ['Seam allowance 1.5 cm everywhere unless stated; hems 3 cm (2 cm on knits).', 'Prewash all fabrics the way the garment will be washed.',
      'Cut with the straight grain parallel to the selvedge (except bias-cut satin).', 'Make a quick toile (test garment) in cheap cotton for fitted pieces.'],
  };
}

export function tailorPdf(look, image) {
  const s = tailorSheet(look);
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 }), chunks = [];
    doc.on('data', (c) => chunks.push(c)).on('end', () => resolve(Buffer.concat(chunks)));
    doc.fontSize(22).font('Helvetica-Bold').text('MODE — Tailor sheet');
    doc.fontSize(14).font('Helvetica').fillColor('#444').text(s.title).moveDown(0.4).fillColor('#000');
    const top = doc.y;
    if (image) { try { doc.image(image, 40, top, { fit: [190, 260] }); } catch {} }
    doc.fontSize(11).font('Helvetica-Bold').text('Measurements to take', 250, top);
    doc.font('Helvetica').fontSize(10);
    for (const m of s.measurements) doc.text(`${m}:  ______ cm`, 250, doc.y + 3);
    doc.moveDown(0.6).font('Helvetica-Bold').fontSize(11).text('General', 250);
    doc.font('Helvetica').fontSize(9.5);
    for (const g of s.general) doc.text(`• ${g}`, 250, doc.y + 2, { width: 305 });
    doc.y = Math.max(doc.y, top + 270);
    for (const p of s.pieces) {
      if (doc.y > 700) doc.addPage();
      doc.moveDown(0.8).x = 40;
      doc.fontSize(13).font('Helvetica-Bold').text(`${p.name}`, 40).fontSize(9.5).font('Helvetica').fillColor('#555').text(`${p.slot} · colour: ${p.colour}`).fillColor('#000');
      if (p.buy) { doc.moveDown(0.2).text(p.note); continue; }
      doc.moveDown(0.3).font('Helvetica-Bold').text('Fabric: ', { continued: true }).font('Helvetica')
        .text(`${p.fabric.name}, ${p.fabric.spec}. Buy ${p.metres} m (150 cm wide, size M).`);
      if (p.patternNote) doc.text(p.patternNote);
      if (p.fit) doc.font('Helvetica-Bold').text('Fit: ', { continued: true }).font('Helvetica').text(p.fit);
      doc.font('Helvetica-Bold').text('Cut:');
      doc.font('Helvetica'); for (const c of p.cut) doc.text(`• ${c}`, 52);
      doc.font('Helvetica-Bold').text('Sew, in this order:', 40);
      doc.font('Helvetica'); p.steps.forEach((st, i) => doc.text(`${i + 1}. ${st}`, 52));
      doc.font('Helvetica-Bold').text('Notions: ', 40, doc.y, { continued: true }).font('Helvetica').text(p.notions.join(' · '));
      doc.font('Helvetica-Bold').text('Seams: ', { continued: true }).font('Helvetica').text(`${p.fabric.seams}. Needle: ${p.fabric.needle}. ${p.fabric.care}.`);
    }
    doc.end();
  });
}
