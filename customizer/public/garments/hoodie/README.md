# Hooded Sweat Jacket

This project uses **Hooded Sweat Jacket / ladieshoodiedown1** by **Elvaerwyn**, shared under **Creative Commons Attribution (CC BY 4.0)** through MakeHuman Community.

- Creator/source entry: https://www.makehumancommunity.org/node/1450
- Official collection and license listing: https://static.makehumancommunity.org/assets/assetpacks/shirts02.html
- Downloaded archive: https://files2.makehumancommunity.org/asset_packs/shirts02/shirts02_ccby.zip
- License: https://creativecommons.org/licenses/by/4.0/
- MakeHuman's explanation of the repository's CC-BY license: https://static.makehumancommunity.org/oldsite/faq/what_do_i_need_to_do_when_i_use_a_ccby_asset.html

The source OBJ and MakeClothes metadata identify `author Elvaerwyn` and `license CC_by`. The official asset-pack listing labels this specific asset CC-BY; MakeHuman's accompanying license guidance links that designation to Attribution 4.0.

Suggested attribution: “Hooded Sweat Jacket by Elvaerwyn, CC BY 4.0, via MakeHuman Community. Converted to glTF and adapted for this preview.” Retain this attribution and license link when sharing this asset or the application.

## Files and conversion

`model.glb` is the version used by the app. It contains two meshes: `fabric` (19,362 triangles) and `zipper` (212 triangles). Both have mesh-role metadata. The original geometry has 9,935 positions and 9,787 quad faces; triangulation and UV splits produce 16,615 glTF vertices and 19,574 triangles.

The conversion preserves the authored surface and UV islands, computes smooth normals across UV seams, centers and scales the model, and rotates the sleeves gradually into a relaxed presentation pose. Texture rows are reflected during conversion while native UV coordinates are retained, preserving tangent-space normal orientation. The front is +Z, Y is up, and the final bounds are approximately 0.570 × 0.625 × 0.343 units. No avatar is included.

Both native 1024 × 1024 PNGs are embedded in the GLB and retained separately:

- `hoodietex1.png`: navy diffuse texture, including seam/cord shading. The app can neutralize its color for recoloring.
- `normalshoodie.png`: garment-specific normal map. The source material requests strength 2; the portable GLB starts at strength 1.

There is no separate ambient-occlusion map. `preview.png` is the creator/collection preview. `ladieshoodiedown1.obj` and `ladieshoodiedown1.mhmat` retain the original authored inputs and embedded credit.

Rebuild with Python and Pillow:

```sh
python3 public/garments/hoodie/convert.py
```

Use `--output /private/tmp/hoodie-assets --include-original` to also inspect the unchanged wider pose without shipping a duplicate GLB.
