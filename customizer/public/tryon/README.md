# Wear it: local tracking assets

These versioned assets power the free **Live 3D preview**. The application detects
one person's shoulders and hips in a browser worker and fits the selected 3D
garment to those points. It does not generate a photorealistic replacement video,
simulate cloth, or measure clothing size. No API key or generation backend is
required for this preview.

## Asset provenance

| Files | Source/version | License |
| --- | --- | --- |
| `vision_bundle.mjs` and the four files in `wasm/` | Unmodified copies from the pinned npm package `@mediapipe/tasks-vision@1.0.1` | Apache-2.0 |
| `pose_landmarker_lite.task` | Google's MediaPipe Pose Landmarker Lite, float16, model revision `1` | Apache-2.0, as stated in the model card linked by Google's Pose Landmarker guide |

Runtime project: [google-ai-edge/mediapipe](https://github.com/google-ai-edge/mediapipe).
Runtime license: [upstream LICENSE](https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE).
The installed package's `package.json` also declares `Apache-2.0`.

Model download (fixed revision, not `latest`):
<https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task>

Model documentation: [Google Pose Landmarker guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker).
Model card: [BlazePose GHUM 3D](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf),
page 2, license and authors: Valentin Bazarevsky, Ivan Grishchenko, and Eduard
Gabriel Bazavan, Google. Model card date: April 16, 2021.

## Third-party notice

MediaPipe runtime — The MediaPipe Authors.
Pose Landmarker / BlazePose GHUM models — Google and the authors named above.

These third-party files are distributed under the Apache License, Version 2.0.
They are copied without modification. The license is reproduced below; upstream
copyright and attribution notices remain applicable. This notice does not change
the licenses of this application's source code or its separate garment assets.

## Data handling

Camera frames are processed on the device by `src/tryon/pose.worker.js`; the
application does not upload or store them. Model and WASM files are served by this
website. The modal requests video only, releases the camera on close, and pauses
when the document becomes hidden.

MediaPipe's upstream privacy notice separately describes performance and usage
metrics. Runtime version 1.0.1 includes a logger targeting Google's
`https://odml.pa.googleapis.com/v1/log`. This application intentionally blocks
external `fetch` requests inside the pose worker before importing MediaPipe. The
pinned runtime's logger uses `fetch`, so its metrics requests are rejected locally;
same-origin WASM and model requests remain allowed, with redirects disabled.
This guard affects only the pose worker and does not change the application's
image-generation requests. The upstream JavaScript and WASM assets are unmodified.

See the [MediaPipe privacy notice](https://developers.google.com/edge/mediapipe/solutions/about#privacy-notice)
and the pinned package's README. On a runtime upgrade, inspect its network
transports and verify outgoing requests again; this worker guard is not a general
browser sandbox for arbitrary replacement code.

## Maintaining the pinned assets

After `npm ci`, the package version must remain `1.0.1`. Copy these files together
when intentionally upgrading the runtime; mixing JavaScript and WASM versions can
prevent initialization:

```sh
cp node_modules/@mediapipe/tasks-vision/vision_bundle.mjs public/tryon/vision_bundle.mjs
cp node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.js public/tryon/wasm/vision_wasm_internal.js
cp node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm public/tryon/wasm/vision_wasm_internal.wasm
cp node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_nosimd_internal.js public/tryon/wasm/vision_wasm_nosimd_internal.js
cp node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_nosimd_internal.wasm public/tryon/wasm/vision_wasm_nosimd_internal.wasm
```

The `.task` bundle is independent of the npm package. To restore it, download the
fixed model URL above and verify the checksum below. Do not download assets during
ordinary page loads from a third-party CDN, or silently replace this model with
an unversioned `latest` URL.

After upgrades, update this notice and hashes; run the pose-fit tests, production
build, and a real browser check for camera denial, close during loading, retry,
tracking, garment switching, and mobile layout.

SHA-256 checksums of the distributed files:

```text
d885630c297c0b20b1fe86096cb06291c4c8080876f27852e724f24ac603713f  vision_bundle.mjs
e170ee67dd4e16c1a6fcd8840a206687e5a59b22c20e4a902bc445b095454d73  wasm/vision_wasm_internal.js
8da277a733926eacd0474b8704b36742d6ec3231c57a860c5b889dff8f1df886  wasm/vision_wasm_internal.wasm
e81d715a3d42cc3373602eb2f7aff795d164934db680e32496b65dab537f9658  wasm/vision_wasm_nosimd_internal.js
a28483cd42e74e855bf5ebdb6b40d9b66a5b49e35e95020bc97669e6822a3192  wasm/vision_wasm_nosimd_internal.wasm
59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a  pose_landmarker_lite.task
```

## Apache License, Version 2.0

```text
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "{}"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright {yyyy} {name of copyright owner}

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```
