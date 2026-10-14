# Camisole Dress with Full Skirt

Authored by **Margaret Toigo**, released under **CC0** through MakeHuman Community. The source dress was created with Blender cloth simulation and includes natural folds in the bodice and skirt. It contains no body or avatar.

- [Original asset](http://www.makehumancommunity.org/node/1730)
- [Official collection and license listing](https://static.makehumancommunity.org/assets/assetpacks/dress01.html)
- [Source archive](https://files.makehumancommunity.org/asset_packs/dress01/dress01_cc0.zip)
- [CC0 license](https://creativecommons.org/publicdomain/zero/1.0/)

`model.glb` contains one editable `fabric_dress_0` mesh. The conversion applies the creator's recommended two levels of subdivision, computes smooth normals across UV seams, and preserves the authored UVs. The dress faces +Z with +Y up. The original decorative flower print is omitted so recoloring and AI designs use a neutral surface; the existing project's shirt weave normal map provides fine cloth detail. The dress does not reuse the shirt's AO atlas.

To reproduce, download and extract the official archive, then run with Python, NumPy, and Pillow:

```sh
python3 public/garments/dress/convert_dress.py --source-dir /path/to/clothes/toigo_camisole_dress_with_full_skirt
```

`source.json` preserves the official archive's creator and license metadata.
