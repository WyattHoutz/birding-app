# Data sources, attribution and terms

Bird Chaser reads live data from public APIs and ships one derived dataset. This
file records where that data comes from and the terms it arrives under, because
the largest of those terms requires exactly that.

## eBird

Bird observations, hotspots, checklists, taxonomy and regional lists come from
the **[eBird API](https://ebird.org)**, © **Cornell Lab of Ornithology**, used
under the [eBird API Terms of Use](https://www.birds.cornell.edu/home/ebird-api-terms-of-use/)
and the [eBird Data Access Terms of Use](https://www.birds.cornell.edu/home/ebird-data-access-terms-of-use/).

**You bring your own API key.** The app has none built in — it reads a key you
store on your own device (Settings → eBird API key), and every call goes from
your phone straight to eBird. Nothing is proxied, and no key is distributed with
this repository. Get one at <https://ebird.org/api/keygen>.

### The bundled sample list

`www/seed-birdlist.json` is a **derived** dataset: species codes and seen/unseen
flags computed from the repository owner's own eBird year lists, so that a fresh
install has something to render before you import your own data. It is not raw
eBird API output and contains no observation records, coordinates, checklists or
other users' data.

The eBird Data Access Terms permit passing on derived datasets **"if these
derived data are supplied with the same Terms of Use"** — so, explicitly: that
file is redistributed under the eBird Data Access Terms of Use linked above, and
anyone reusing it is bound by them in turn. Replace it by importing your own
`MyEBirdData.csv`.

### Non-commercial only

Both eBird documents restrict use to non-commercial purposes, defined broadly
enough to include any use that "informs or assists" a for-profit activity, and
revenue generation even by a non-profit. **This app is a free, personal,
non-commercial tool.** Any commercial use of eBird data — or of products derived
from it — requires prior written permission from the Cornell Lab of Ornithology
(<ebird@cornell.edu>).

### Not endorsed

Use of eBird data does not constitute endorsement by the Cornell Lab of
Ornithology. This project is not affiliated with, endorsed by, or supported by
the Cornell Lab of Ornithology or eBird, and deliberately uses no eBird or
Cornell logos or branding.

## Everything else

| Source | Used for | Terms |
| --- | --- | --- |
| [NOAA](https://www.weather.gov/) — `api.weather.gov`, `api.tidesandcurrents.noaa.gov` | forecasts, tides | US Government work; public domain |
| [GBIF](https://www.gbif.org/) | species arrival windows (eBird Observation Dataset) | cite GBIF; shown in-app |
| [Wikipedia](https://en.wikipedia.org/) | species photos and summaries | CC BY-SA |
| [BirdCast](https://birdcast.info/) | nightly migration forecast | Cornell Lab / Colorado State; non-commercial |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) Nominatim | geocoding the address box | ODbL; used on explicit user action only, with an identifying User-Agent |
| OpenStreetMap / CARTO tiles | maps | © OpenStreetMap contributors, © CARTO — rendered on every map |

## Your data

Your seen list, API key and settings are stored **only in `localStorage` on your
device**. This app has no server, no backend, no analytics and no telemetry;
nothing is uploaded anywhere, and the only outbound requests are the ones to the
public APIs listed above.
