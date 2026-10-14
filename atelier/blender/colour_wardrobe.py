# Adds bright colourways to data/wardrobe.json and sets the ready-made looks (colourful; at most one black piece each).
import json, os
W = os.path.join(os.path.dirname(__file__), '..', 'data', 'wardrobe.json')
d = json.load(open(W)); d['pieces'] = [p for p in d['pieces'] if p['asset'] != 'suit']; P = d['pieces']; have = {p['id'] for p in P}
def add(asset, id, name, tags, color):
    if id in have: return
    P.append(dict(id=id, asset=asset, name=name, tags=tags, color=color)); have.add(id)
C = {'cobalt': '#2e5fa8', 'mustard': '#d9a330', 'coral': '#e8705a', 'lilac': '#b7a3d9', 'mint': '#9fd8c0', 'fuchsia': '#c43d7e', 'emerald': '#1f7a5a',
     'orange': '#e07a2a', 'sky': '#8fc1e8', 'lemon': '#f0d64a', 'terracotta': '#c0623e', 'pink': '#e8a6b8', 'forest': '#2e4a36', 'burgundy': '#7a2335',
     'cream': '#ece4d4', 'sand': '#d8c6a5', 'red': '#c0281f', 'olive': '#6b7340', 'teal': '#1f7a80'}
def many(asset, prefix, label, names, tags):
    for n in names: add(asset, f'{prefix}-{n}', f'{n.capitalize()} {label}', tags, C[n])
many('tshirt', 'tee', 'tee', ['cobalt', 'mustard', 'orange', 'lilac', 'mint', 'sky', 'coral', 'lemon'], ['colourful', 'casual', 'summer'])
many('hoodie', 'hoodie', 'zip hoodie', ['cobalt', 'mustard', 'pink', 'orange', 'mint'], ['colourful', 'streetwear', 'cozy'])
many('cargo_jeans', 'cargo', 'wide cargo pants', ['sand', 'olive', 'sky'], ['colourful', 'streetwear'])
many('evening_dress', 'maxi', 'draped maxi dress', ['coral', 'cobalt', 'emerald', 'lilac'], ['colourful', 'summer', 'evening'])
many('red_dress', 'cocktail', 'cocktail dress', ['fuchsia', 'cobalt', 'mustard', 'sky'], ['colourful', 'party'])
many('overcoat', 'coat', 'double-breasted coat', ['forest', 'cobalt', 'burgundy', 'terracotta'], ['colourful', 'winter', 'classic'])
many('parka', 'parka', 'padded parka', ['red', 'cobalt', 'mustard', 'teal'], ['colourful', 'winter', 'outdoor'])
many('converse', 'hightops', 'high-top sneakers', ['lemon', 'emerald', 'pink', 'sky', 'orange'], ['colourful', 'casual'])
many('pumps', 'pumps', 'pointed pumps', ['cobalt', 'emerald', 'fuchsia'], ['colourful', 'party', 'elegant'])
many('cap', 'cap', 'baseball cap', ['red', 'lemon', 'sky'], ['colourful', 'sporty'])
many('bucket_hat', 'bucket', 'bucket hat', ['pink', 'orange', 'mint'], ['colourful', 'summer', 'festival'])
many('mens_shirt', 'shirt', 'dress shirt', ['sky', 'mint', 'lilac'], ['colourful', 'smart', 'spring'])
L = [('l-streetwear', 'Streetwear', ['streetwear', 'colourful'], ['hoodie-mustard', 'tee-white', 'cargo-sand', 'hightops-white', 'cap-red']),
 ('l-grunge', '90s grunge', ['grunge', '90s'], ['flannel-blue', 'cargo-olive', 'hightops-red']),
 ('l-office', 'Office smart', ['office', 'business'], ['shirt-light-blue', 'cargo-sand', 'chelsea-brown']),
 ('l-evening', 'Evening blue', ['evening', 'formal'], ['coat-cobalt', 'cargo-khaki', 'chelsea-brown']),
 ('l-summer-wedding', 'Summer wedding', ['wedding', 'summer', 'smart'], ['shirt-pale-pink', 'cargo-sand', 'pumps-nude']),
 ('l-winter-street', 'Winter streetwear', ['winter', 'streetwear'], ['parka-cobalt', 'cargo-sand', 'hightops-lemon']),
 ('l-outdoor', 'Outdoor weekend', ['outdoor', 'winter'], ['parka-mustard', 'cargo-olive', 'hightops-cream']),
 ('l-y2k', 'Y2K', ['y2k', 'party'], ['tee-pink', 'baggy-jeans', 'leopard-runners', 'bucket-pink']),
 ('l-school', 'Preppy plaid', ['preppy', 'school'], ['shirt-white', 'plaid-skirt', 'hightops-navy']),
 ('l-festival', 'Festival', ['festival', 'summer'], ['tee-orange', 'denim-shorts', 'hightops-emerald', 'bucket-orange']),
 ('l-beach', 'Beach day', ['summer', 'beach'], ['tee-sky', 'denim-shorts', 'hightops-white', 'cap-lemon']),
 ('l-minimal', 'Soft minimal', ['minimal'], ['tee-sand', 'cargo-khaki', 'hightops-cream']),
 ('l-cozy', 'Weekend cozy', ['cozy', 'casual'], ['hoodie-mint', 'tee-white', 'baggy-jeans', 'hightops-white']),
 ('l-rock', 'Rock & red', ['rock', 'night'], ['tee-red', 'cargo-black', 'chelsea-brown']),
 ('l-casual-red', 'Colour pop', ['casual', 'bold'], ['tee-cobalt', 'cargo-sky', 'hightops-orange']),
 ('l-outdoor-red', 'Winter red', ['winter', 'outdoor'], ['parka-red', 'cargo-sand', 'hightops-white']),
 ('l-gala', 'Gala night', ['evening', 'elegant'], ['maxi-emerald', 'heels-strappy', 'handbag-brown']),
 ('l-cocktail', 'Cocktail party', ['party', 'evening'], ['cocktail-fuchsia', 'pumps-cobalt']),
 ('l-wedding-guest', 'Wedding guest', ['wedding', 'romantic'], ['maxi-blush', 'pumps-nude', 'handbag-brown']),
 ('l-boho', 'Boho summer', ['summer', 'boho'], ['maxi-saffron', 'bucket-sand', 'hightops-cream']),
 ('l-gothic', 'Dark romance', ['gothic', 'evening'], ['dress-bolero', 'pumps-fuchsia']),
 ('l-old-money', 'Old money', ['old money', 'classic'], ['coat-camel', 'cargo-khaki', 'riding-chocolate', 'handbag-brown']),
 ('l-city-winter', 'City winter', ['winter', 'classic'], ['coat-forest', 'cargo-sand', 'chelsea-brown', 'cap-navy']),
 ('l-snow', 'Snow day', ['winter', 'outdoor', 'cozy'], ['parka-cream', 'baggy-jeans', 'riding-chocolate', 'bucket-orange']),
 ('l-sporty-cap', 'Sporty weekend', ['sporty', 'casual'], ['tee-lemon', 'cargo-grey', 'hightops-sky', 'cap-sky']),
 ('l-sunset', 'Sunset dinner', ['summer', 'evening'], ['maxi-coral', 'pumps-nude', 'handbag-brown']),
 ('l-lilac', 'Lilac spring', ['spring', 'soft'], ['shirt-lilac', 'cargo-sand', 'hightops-white']),
 ('l-terracotta', 'Autumn terracotta', ['autumn', 'classic'], ['coat-terracotta', 'cargo-khaki', 'riding-chocolate']),
 ('l-pop-party', 'Pop party', ['party', 'colourful'], ['cocktail-mustard', 'pumps-emerald'])]
dark = {'#141414', '#1d1d20'}
cols = {p['id']: p.get('color') for p in P}
for _, n, _, ps in L:
    for x in ps: assert x in have, (n, x)
    assert sum(cols.get(x) in dark for x in ps) <= 1, n
d['looks'] = [dict(id=i, name=n, tags=t, pieces=p) for i, n, t, p in L]
json.dump(d, open(W, 'w'), indent=1)
print(len(P), 'pieces', len(L), 'looks, at most one black piece each')
