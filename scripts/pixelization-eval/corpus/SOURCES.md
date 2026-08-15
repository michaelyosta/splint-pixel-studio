# Independent representative corpus sources

This corpus is used only by the pixelization evaluation harness. The files under `assets/` are local 1920-pixel Wikimedia Commons derivatives; they are not application/catalog assets and do not ship through `public/`.

Source metadata was retrieved from the Wikimedia Commons `imageinfo` API on 2026-08-15. The manifest pins both the upstream original SHA-1 reported by Commons and the SHA-256 of the exact downloaded derivative. The runner recomputes the local SHA-256 before evaluating any image and fails on mismatch.

| Corpus id | Coverage role | Creator/source | License | Source page | Local SHA-256 |
| --- | --- | --- | --- | --- | --- |
| `portrait-jessica-meir` | Real photographic portrait; face, grayscale and high detail | Josh Valcarcel / NASA | Public domain | [Commons](https://commons.wikimedia.org/wiki/File:Jessica_Meir_official_portrait_in_an_EMU_(B%26W).jpg) | `53f00ccbe889a745c4a085dde02732065fbec59f2bca1f9dfaae211b0251effe` |
| `animal-iguana-venezuela` | Animal, organic texture and strong silhouette | Wilfredor | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [Commons](https://commons.wikimedia.org/wiki/File:Iguana_de_Venezuela.jpg) | `f68277b68f18d89806ba0a9ead1e9408c9e0fb64db6b220ba34f6ee8a30b9016` |
| `landscape-utah-dunes` | Landscape, gradients, fine texture and depth | BLM Utah / Bob Wick | Public domain | [Commons](https://commons.wikimedia.org/wiki/File:Utah_Dunes_Landscape_-_West_Desert_District.jpg) | `cefccb9b95f999a2444bb72cde06d5384b0144c6b67afe8bdff80b60146ba6bc` |
| `object-palm-wine-cup` | Isolated object, neutral background and material texture | Nick Ash, Berlin / Brücke Museum | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [Commons](https://commons.wikimedia.org/wiki/File:Palm_Wine_Cup,_Br%C3%BCcke-Museum_Berlin,_65048,_view_a.jpg) | `589da43e6f7f86e2ae3b41d33e4cb06f8c2560b54e358818203accefb02f40f6` |
| `gradient-golden-gate-fog` | Smooth fog/sky gradients, low contrast and a strong linear edge | Romain Guy | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [Commons](https://commons.wikimedia.org/wiki/File:Golden_Gate_Fog_-_Flickr_-_romainguy.jpg) | `ec1465fe61156a5859b2b43764ed9173ff7a6debee4840b7dcd59bab211f71e3` |
| `illustration-paint-brush` | Simple, flat, non-pixel illustration | Leanne Walker | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [Commons](https://commons.wikimedia.org/wiki/File:Leanne_Walker-_Paint_Brush_Illustration_-_FREE_(50225393663).jpg) | `3870deb1637fa9d05fabe6332cbc4ec3c49d5128ab1c2f9b9ebb30f68b34c4c0` |
| `silhouette-rat` | Real strong silhouette on a textured photographic background | freestocks.org | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [Commons](https://commons.wikimedia.org/wiki/File:Rat_silhouette_(27072964899).jpg) | `6d453ff9a55de6503f08ad80315f8e8a09afffc28d209c806b5870aa8c4dba43` |

Public-domain/CC0 status above reflects the source records at retrieval time. Attribution is retained for auditability even where the license does not require it. A future corpus refresh must use a new manifest/hash snapshot rather than silently replacing these files.
