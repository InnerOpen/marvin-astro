"""Regenerate tests/fixtures/core-embeds.json from Marvin's own publishing code.

Run from a Marvin checkout (it imports ``marvin``):

    PYTHONPATH=src .venv/bin/python /path/to/marvin-astro/tests/fixtures/core-embeds.gen.py \
        > /path/to/marvin-astro/tests/fixtures/core-embeds.json

No network and no database: cache rows are faked from the provider registry's own targets.
"""

import json
import sys
from types import SimpleNamespace

from marvin.schemas.publishing import SiteEmbeds
from marvin.services.media_embeds.matcher import match_url
from marvin.services.media_embeds.publish import build_embed, site_embeds


def row(url, **over):
    target = match_url(url).target
    base = dict(
        provider=match_url(url).provider.key,
        status="ok",
        kind=target.kind,
        embed_src=target.src,
        canonical_url=target.canonical_url,
        title=None,
        author_name=None,
        thumbnail_url=None,
        height=target.height,
        aspect_ratio=target.aspect_ratio,
    )
    base.update(over)
    return SimpleNamespace(**base)


CASES = [
    # (name, url, row overrides or None for "no cache row")
    ("youtube", "https://youtu.be/dQw4w9WgXcQ", {"title": 'Never Gonna "Give" <You> Up', "author_name": "Rick Astley"}),
    ("youtube_shorts", "https://www.youtube.com/shorts/abcDEF12345", None),
    ("vimeo", "https://vimeo.com/76979871", None),
    ("spotify_track", "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT", {"title": "A Track"}),
    ("spotify_playlist", "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M", None),
    ("spotify_episode", "https://open.spotify.com/episode/7makk4oTQel546B0PZlDM5", None),
    ("youtube_unavailable", "https://www.youtube.com/watch?v=xxxxxxxxxxx", {"status": "unavailable", "embed_src": None, "title": "Removed video"}),
    ("bandcamp_link", "https://artist.bandcamp.com/album/some-album", None),
]


def main() -> None:
    out = {"site": {}, "embeds": {}}
    for mode in ("click_to_load", "direct"):
        settings = site_embeds({"embeds": {"mode": mode}})
        out["site"][mode] = settings.model_dump(by_alias=True, mode="json")
        out["embeds"][mode] = {}
        for name, url, over in CASES:
            embed = build_embed(url, row(url, **over) if over is not None else None, settings)
            if embed is None:
                print(f"no match: {url}", file=sys.stderr)
                continue
            out["embeds"][mode][name] = embed.model_dump(by_alias=True, mode="json")
    json.dump(out, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
