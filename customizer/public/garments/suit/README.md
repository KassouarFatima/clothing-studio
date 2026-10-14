# Men's Suit 3

Authored suit by **Margaret Toigo**, released as **CC0** through the MakeHuman Community. The original model includes a fitted blazer with lapels and pocket details, trousers, a shirt, tie, cuffs, and nine buttons. It contains no body, mannequin, head or shoes.

- Official license and creator listing: <https://static.makehumancommunity.org/assets/assetpacks/suits01.html>
- Original creator page: <http://www.makehumancommunity.org/node/1733>
- Public source archive: <https://files.makehumancommunity.org/asset_packs/suits01/suits01_cc0.zip>
- License: <https://creativecommons.org/publicdomain/zero/1.0/>

## Runtime asset

`model.glb` is a self-contained glTF 2.0 file with 15 named meshes, 134,279 render vertices and 260,000 triangles. It uses the creator's two-level subdivision guidance, with smooth normals and original UVs. It faces +Z with +Y up, in meters. The sleeves are relaxed inward by 16 degrees using a continuous shoulder weighting. Fit the complete scene's bounds when framing the garment.

Two native 2048×2048 textures are embedded: `NewSuit3.png` (base color) and `NewSuit3-norm.png` (normal detail). The image rows are reflected during conversion so the original OBJ UVs and tangent orientation remain consistent with glTF. The source provides a specular map, but no ambient-occlusion map. The conversion uses dielectric PBR roughness instead of treating the old specular image as metalness or AO.

| Mesh names | Material | Editing |
| --- | --- | --- |
| `fabric_jacket`, `fabric_trousers` | `fabric` | Replace color map with the selected pattern, or remove the color map and tint. Retain native normal detail. |
| `shirt`, `cuff_right`, `cuff_left` | `shirt` | Preserve native light fabric. |
| `tie` | `tie` | Preserve native red patterned tie. |
| `button_1` through `button_9` | `buttons` | Preserve native dark buttons. |

Mesh and material `extras.role` values also identify editable fabric and accent parts. Main fabric components share one material; clone that material before editing the cached loader result. Texture scale and placement should affect the replacement design map only; the native normal map stays on the garment's original UVs.

## Rebuild

Download the official archive and extract `clothes/toigo_male_suit_3`. The conversion script uses Python with NumPy and Pillow; it does not need Blender or a network connection.

```sh
python3 convert_suit.py --source-dir /path/to/clothes/toigo_male_suit_3 --output-dir .
```

`source.json` preserves the pack's creator description and records the conversion changes. `LICENSE.txt` records the original license declaration and source links.
