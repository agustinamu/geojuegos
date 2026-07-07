# Geojuegos

Juegos de geografía en ekain.amutxastegi.com/geojuegos/.

## Juegos

- **Siluetas** (`/siluetas/`): adivina el país por su forma en 6 intentos.
  Cada fallo indica distancia, dirección (flecha) y proximidad al país
  objetivo. Al acertar, ronda extra: elegir su bandera entre 8.
- Próximos: Banderas (bandera tapada por rejilla 2×3 que se destapa con cada
  fallo), Fronteras.

## Datos

- `public/flags/` — banderas SVG copiadas del repo hermano
  [flagmaps](../flagmaps): `npm run sync:data`.
- `public/shapes/<iso>.json` + `public/data/countries.json` — siluetas por
  país desde Natural Earth 10m con simplificación adaptativa (~1200 vértices
  por país) e índice con nombre/continente/centroide: `npm run build:shapes`.
  Ojo: los GeoJSON se emiten con winding `gj2008` porque d3-geo no sigue
  RFC 7946; sin eso cada país se pinta como la esfera entera.

Los datos generados se versionan; el deploy (GitHub Actions → Pages) solo
ejecuta `npm run build`.

## Desarrollo

```
npm install
npm run dev
```
