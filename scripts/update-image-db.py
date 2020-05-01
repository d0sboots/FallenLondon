#!/usr/bin/python3
"""Compare currently served and wiki images, storing the results in a SQLite database.

This script exists to help curate Fallen London wiki's extensive mirror of
game images, helping keep them up-to-date with the current artwork deployed
released on fallenlondon.com. To do this, it scrapes the category list of
all "Game Files" (assuming that this is basically complete), downloads any
wiki images that aren't in the local DB yet (or have newer revisions), maps
wiki file names to server image names, and checks for updates on all the
server images. Commandline flags can be used to only do certain of these
steps.

Requires the non-standard libraries aiohttp and Pillow for fast parallel
downloads and image processing, respectively.
"""

from PIL import Image, ImageChops
from datetime import datetime, timedelta, timezone
import aiohttp
import asyncio
import argparse
import html
import io
import itertools
import re
import sqlite3
import sys

# Mutually-exclusive groups that each image can fall into. These aren't the
# same as wiki Categories, although there is some overlap.

# We don't bother downloading or looking at Non-PNG files.
GROUP_NON_PNG = 'Non-PNG'
# Files that end in "sml" seem to be from some very early orginizational
# scheme. They're all hopelessly out of date, and unused. We don't download
# them.
GROUP_SML = '"sml"'
# These large images are the headers seen at the top, showing what location
# you're in. The server serves these from /headers/.
GROUP_HEADER = 'Header'
# The cameo (i.e. portraits) possible for your character. The server serves
# these from /cameos/.
GROUP_CAMEO = 'Cameo'
# Small versions of the icons. The server serves these from /icons_small/, at
# a resolution of 40x40. The wiki standard is to name these the same as the
# regular icon, with "small" directly appended.
GROUP_SMALL = 'Small'
# The regular (full-size) icons. The server serves these from /icons/, at a
# resolution of 130x100. Because they can be named anything, this group is
# determined by not being in any of the others.
GROUP_REGULAR = 'Regular'
GROUPS = [GROUP_NON_PNG, GROUP_SML, GROUP_HEADER, GROUP_CAMEO,
    GROUP_SMALL, GROUP_REGULAR]

# States that an image can be in. These are in order; earlier states take
# precedence over later states.

# We haven't fetched the images yet, or aren't going to.
STATE_UNFETCHED = 'UNFETCHED'
# We tried to fetch the images from the server, but there was an error. Most
# likely the URL is invalid.
STATE_CANT_FETCH = "CAN'T FETCH (ERROR)"
# The wiki image and server image have different sizes (resolutions). This is
# sadly common for small images, which were historically formed by resizing
# the large image instead of fetching from the server.
STATE_SIZE_MISMATCH = 'SIZE MISMATCH'
# The wiki and server versions are too different to be considered similar -
# proably the wiki version should be replaced.
STATE_TOO_DIFFERENT = 'TOO DIFFERENT'
# The images are different, but they're quite similar. This is commonly the
# result when the wiki has an older full-color copy, and the server is serving
# an optimized 256-color quantized version.
STATE_SIMILAR = 'SIMILAR'
# The wiki and server *images* are the same (have the same pixel values), but
# the file content is still slightly different.
STATE_SAME_PIXELS = 'SAME_PIXELS'
# The two files are exactly the same.
STATE_SAME_FILE = 'SAME_FILE'
STATES = [STATE_UNFETCHED, STATE_CANT_FETCH, STATE_SIZE_MISMATCH,
    STATE_TOO_DIFFERENT, STATE_SIMILAR, STATE_SAME_PIXELS, STATE_SAME_FILE]

TIMEOUT = aiohttp.ClientTimeout(total=15)

# Map from current names on the wiki to what the it ought to be, if named
# properly. Used to correct for one-off mistakes.
RENAMES = {
    'File:Down among the Lorn-Flukes - Header.png': 'File:Flukes-header.png',
    'File:Whispered Secret.png':                    'File:Whispered secret.png',
    'File:Whispered Secretsmall.png':               'File:Whispered secretsmall.png',
    'File:Parabolan panther.png':                   'File:Parabolanpanther.png',
    'File:Parabolan panthersmall.png':              'File:Parabolanpanthersmall.png',
}


async def gen_category_files(category, session):
  # Matches strings like:
  # <a href="/wiki/File:Clouds.png" title="File:Clouds.png">
  #  <img src="data:image/gif;base64,R0lGODlhAQABAIABAAAAAP///yH5BAEAAAEALAAAAAABAAEAQAICTAEAOw%3D%3D"
  #    data-src="https://vignette.wikia.nocookie.net/fallenlondon/images/3/38/Clouds.png/revision/latest/window-crop/width/40/x-offset/0/y-offset/4/window-width/100/window-height/75?cb=20200320225532"
  #    alt="File:Clouds.png"
  #    class="category-page__member-thumbnail lzy lzyPlcHld"
  #    onload="if(typeof ImgLzy===&#039;object&#039;){ImgLzy.load(this)}"
  #  >
  link_re = re.compile(r'<a href="[^"]*" title="([^"]*)">[\s]*' +
    '<img [^>]*data-src="([^"]*)"[^>]*class="category-page__member-thumbnail')
  # Matches strings like:
  # <a href="https://fallenlondon.fandom.com/wiki/Category:Game_Files?from=Coast1small.png"
  #          class="category-page__pagination-next wds-button wds-is-secondary">
  next_page_re = re.compile(
    r'<a href="[^?"]+[?]from=([^"]+)"[\s]*class="category-page__pagination-next')
  thumbnail_re = re.compile(
    '(https://vignette.wikia.nocookie.net/fallenlondon/images/./../[^/]*)/.*[?]cb=([0-9]*)')

  params = {}
  category = category.replace(' ', '_')
  while True:
    async with session.get(
        'https://fallenlondon.fandom.com/wiki/Category:' + category,
        params=params,
        timeout=TIMEOUT) as response:
      response.raise_for_status()
      text = await response.text()
    for result in link_re.findall(text):
      if not result[0].startswith('File'):
        continue
      match = thumbnail_re.match(result[1])
      if not match:
        raise ValueError('Bad link: ' + result[1])
      yield (html.unescape(result[0]), match[1] + '/revision/latest?cb=' + match[2])
    next_result = next_page_re.search(text)
    if not next_result:
      break
    params['from'] = next_result.group(1)


async def update_one_category(conn, session, category, sql):
  '''Helper for update_categories()'''
  print('Updating %s' % category, end='', flush=True)
  results = []
  async for x in gen_category_files(category, session):
    results.append(x)
    if len(results) % 10 == 0:
      print('.', end='', flush=True)
  cur = conn.executemany(sql, results)
  print('Done!')


async def update_categories(conn, session):
  '''Update the available files and their categories by scraping the wiki.'''
  # Use "UPSERT" processing to only update the affected column when the row
  # already exists, instead of replacing the whole row (and losing the data in
  # the other columns).
  await update_one_category(conn, session, 'Game Files', '''INSERT INTO images
      (wiki_name, wiki_url) VALUES (?, ?)
      ON CONFLICT (wiki_name) DO UPDATE SET wiki_url=excluded.wiki_url''')
  await update_one_category(conn, session, 'Cameo',
      'UPDATE images SET wiki_categories = "Cameo" WHERE wiki_name = ? AND ? NOT NULL')
  await update_one_category(conn, session, 'Headers',
      'UPDATE images SET wiki_categories = "Headers" WHERE wiki_name = ? AND ? NOT NULL')
  conn.execute('COMMIT')


def get_group(wiki_name, categories):
  '''Turn a filename and its categories into a "group".'''
  if not wiki_name.endswith('.png'):
    return GROUP_NON_PNG
  categories = categories.split(',')
  for cat in categories:
    if cat == 'Cameo':
      return GROUP_CAMEO
    if cat == 'Headers':
      return GROUP_HEADER
  if wiki_name.endswith('sml.png'):
    return GROUP_SML
  if wiki_name.endswith('small.png'):
    return GROUP_SMALL
  return GROUP_REGULAR


def get_state(wiki_name, wiki_image_bytes, server_image_bytes, server_status):
  '''Get the current state of a given row.'''
  if wiki_image_bytes == None or server_status == 0:
    return STATE_UNFETCHED
  if server_image_bytes == None:
    return STATE_CANT_FETCH
  # We do the rest of these checks from cheapest to more expensive
  if wiki_image_bytes == server_image_bytes:
    return STATE_SAME_FILE
  with Image.open(io.BytesIO(wiki_image_bytes)) as wiki_image:
    with Image.open(io.BytesIO(server_image_bytes)) as server_image:
      if wiki_image.size != server_image.size:
        return STATE_SIZE_MISMATCH
      # Extra step to eliminate warnings, but we try to avoid this most of the
      # time because it's an expensive extra convesion.
      if wiki_image.info.get('transparency'):
        wiki_image = wiki_image.convert('RGBA')
      if server_image.info.get('transparency'):
        server_image = server_image.convert('RGBA')

      diff = ImageChops.difference(
          wiki_image.convert('RGB'), server_image.convert('RGB'))
      sum_sq = sum(r*r + g*g + b*b for r,g,b in diff.getdata())
      if sum_sq == 0:
        return STATE_SAME_PIXELS
      # This is a very simple sum-of-squares threshold test, no accounting for
      # perceptual modeling. The threshold was chosen by examining various
      # images - PNG quantisization artifacts result in an error that's almost
      # always <100. "Real" differences where the images a similar, but
      # obivously different (tinted differently, shifted, etc.) have an error
      # >500. Errors >50 are usually visible, even with an algorithm
      # attempting to distribute the noise.
      error = float(sum_sq) / (wiki_image.width * wiki_image.height)
      if error < 50.0:
        #print(wiki_name, ratio)
        return STATE_SIMILAR
      return STATE_TOO_DIFFERENT


def map_helper(subdir, trim_list, wiki_name):
  '''Helper used by update_map() to construct URLs.'''
  # Patch in from the special rename list, if there's one available.
  wiki_name = RENAMES.get(wiki_name, wiki_name)
  # Trim "File:" and ".png"
  wiki_name = wiki_name[5:-4]
  for item in trim_list:
    if wiki_name.endswith(item):
      wiki_name = wiki_name[:-(len(item))]
      break
  wiki_name = wiki_name.replace(' ', '_')
  # Only lowercase *first* letter
  wiki_name = wiki_name[:1].lower() + wiki_name[1:]
  return 'https://images.fallenlondon.com/images/%s/%s.png' % (
      subdir, wiki_name)


def update_map(conn, overwrite):
  '''Map all wiki filenames to server URLs.'''
  print('Updating server URL mappings... ', end='', flush=True)
  cur = conn.execute(
      'SELECT wiki_name, wiki_categories, server_url, server_status FROM images')
  unchanged = 0
  changed = 0
  while result := cur.fetchmany(50):
    for wiki_name, categories, url, status in result:
      mapped_url = {
        GROUP_NON_PNG: lambda x: '',
        GROUP_SML: lambda x: '',
        GROUP_HEADER: lambda x: map_helper(
            'headers', ['-header', ' header', 'header'], x),
        GROUP_CAMEO: lambda x: map_helper('cameos', ['cameo'], x),
        GROUP_SMALL: lambda x: map_helper('icons_small', ['small'], x),
        GROUP_REGULAR: lambda x: map_helper('icons', [], x),
      }[get_group(wiki_name, categories)](wiki_name)
      # Don't update if we can't generate a sensible URL, don't update if it's
      # the same URL, otherwise we'll only update if either overwrite or
      # the previous fetch was in error. The last behavior is to allow for
      # sticky one-off direct changes to the DB.
      if mapped_url == '' or mapped_url == url or (
          status != 0 and status < 400 and not overwrite):
        unchanged += 1
        continue
      changed += 1
      # Update metadata to force a subsequent fetch as well
      conn.execute('''UPDATE images SET server_url = ?, server_image = NULL,
          server_etag = '', server_last_modified = '', server_fetched_at = ''
          WHERE wiki_name = ?''',
          [mapped_url, wiki_name])
  if changed:
    conn.execute('COMMIT')
  print('%d changed URLs and %d unchanged' % (changed, unchanged))


async def do_download_wiki(conn, session):
  # Use count() for thread-safety; the Global Interpreter Lock means two
  # threads can't interleave increments.
  counter = itertools.count(start=1)

  async def fetch(wiki_name, wiki_url):
    async with session.get(wiki_url, timeout=TIMEOUT) as response:
      response.raise_for_status();
      image = await response.read()
      new_revision = response.request_info.url.query['cb']
    conn.execute('''UPDATE images SET wiki_revision = ?, wiki_image = ?
        WHERE wiki_name = ?''', [new_revision, image, wiki_name])
    count = next(counter)
    if count % 10 == 0:
      print('.', end='', flush=True)

  coros = []
  cur = conn.execute(
      'SELECT wiki_name, wiki_url, wiki_revision FROM images')
  print('Downloading', end='', flush=True)

  rowcount = 0
  while result := cur.fetchmany(50):
    for wiki_name, wiki_url, wiki_revision in result:
      rowcount += 1
      if not wiki_url[-18:-14] == '?cb=':
        raise RuntimeError('URL lacks revision: ' + wiki_url)
      if wiki_url[-14:] == wiki_revision:
        continue
      coros.append(fetch(wiki_name, wiki_url))
  print(' %d wiki images, %d up-to-date' % (len(coros), rowcount - len(coros)),
      end='', flush=True)
  await asyncio.gather(*coros)
  if len(coros):
    conn.execute('COMMIT')
  print()


async def do_download_server(conn, session, force_reload):
  # Use count() for thread-safety; the Global Interpreter Lock means two
  # threads can't interleave increments.
  counter = itertools.count(start=1)
  fetched = itertools.count()
  errors = itertools.count()
  max_age_re = re.compile('max-age=([0-9]*)')

  async def fetch(wiki_name, server_url, server_etag, server_last_modified):
    headers = {}
    if server_etag:
      headers['If-None-Match'] = server_etag
    if server_last_modified:
      headers['If-Modified-Since'] = server_last_modified
    async with session.get(
        server_url, headers=headers, timeout=TIMEOUT) as response:
      etag = response.headers.get('ETag', '')
      status = response.status
      last_modified = response.headers.get('Last-Modified', '')
      age = response.headers.get('Age', '')
      match = max_age_re.search(response.headers.get('Cache-Control', ''))
      if match:
        max_age = match.group(1)
      else:
        max_age = ''
      fetched_at = datetime.now(timezone.utc).isoformat()
      image = await response.read()
    if status == 304:
      # Don't overwrite the existing image, but update the other header
      # information.
      conn.execute('''UPDATE images SET server_status = ?, server_etag = ?,
          server_last_modified = ?, server_age = ?, server_max_age = ?,
          server_fetched_at = ? WHERE wiki_name = ?''',
          [status, etag, last_modified, age, max_age, fetched_at, wiki_name])
    else:
      # Update image, even if it's an error. If it's an error, clear out the
      # image first. (The body is probably an error page.)
      if status >= 400:
        next(errors)
        image = None
      else:
        next(fetched)
      conn.execute('''UPDATE images SET server_status = ?, server_etag = ?,
          server_last_modified = ?, server_age = ?, server_max_age = ?,
          server_fetched_at = ?, server_image = ? WHERE wiki_name = ?''',
          [status, etag, last_modified, age, max_age, fetched_at,
            image, wiki_name])
    count = next(counter)
    if count % 10 == 0:
      print('.', end='', flush=True)

  coros = []
  cur = conn.execute(
      '''SELECT wiki_name, server_url, server_status, server_etag,
      server_last_modified, server_age, server_max_age,
      server_fetched_at FROM images''')
  print('Fetching', end='', flush=True)

  cached = 0
  invalid = 0
  while result := cur.fetchmany(50):
    for (wiki_name, server_url, server_status, server_etag,
        server_last_modified, server_age, server_max_age,
        server_fetched_at) in result:
      if not server_url:
        invalid += 1
        continue
      if server_fetched_at and server_max_age:
        ttl = (datetime.fromisoformat(server_fetched_at) -
            datetime.now(tz=timezone.utc)) + timedelta(seconds=(
                int(server_max_age) - int(server_age or '0')))
      else:
        ttl = timedelta()
      if ttl > timedelta() and not force_reload:
        cached += 1
        continue
      coros.append(fetch(wiki_name, server_url, server_etag, server_last_modified))
  print(' %d server images, %d cached, %d invalid' % (len(coros), cached, invalid),
      end='', flush=True)
  await asyncio.gather(*coros)
  if len(coros):
    conn.execute('COMMIT')
  fetched_count = next(fetched)
  errors_count = next(errors)
  print('\nDownloaded %d, %d errors, %d unmodified\n' % (
    fetched_count, errors_count, len(coros) - fetched_count - errors_count))


async def do_download(conn, session, force_reload):
  await do_download_wiki(conn, session)
  await do_download_server(conn, session, force_reload)


COUNT = 'count'
def group_files(conn):
  '''Return a dictionary, providing summary counts and individual statuses.'''
  cur = conn.execute('''SELECT wiki_name, wiki_categories, wiki_image,
      server_image, server_status FROM images''')
  summary = {}
  pair_table = {}
  while result := cur.fetchmany(50):
    for wiki_name, categories, wiki_image, server_image, server_status in result:
      summary[COUNT] = summary.get(COUNT, 0) + 1
      group_name = get_group(wiki_name, categories)
      group = summary.setdefault(group_name, {})
      group[COUNT] = group.get(COUNT, 0) + 1
      state = get_state(wiki_name, wiki_image, server_image, server_status)
      if group_name in [GROUP_SMALL, GROUP_REGULAR]:
        pair_table[wiki_name[:-4]] = state
      else:
        state_list = group.setdefault(state, [0])
        state_list[0] += 1
        state_list.append(wiki_name)
  for name, state in pair_table.items():
    if name.endswith('small'):
      group_name = GROUP_SMALL
      other_name = name[:-5]
    else:
      group_name = GROUP_REGULAR
      other_name = name + 'small'
    pairing = 'Paired' if other_name in pair_table else 'Unpaired'
    subgroup = summary[group_name].setdefault(pairing, {})
    subgroup[COUNT] = subgroup.get(COUNT, 0) + 1
    state_list = subgroup.setdefault(state, [0])
    state_list[0] += 1
    state_list.append(name + '.png')
  return summary


def print_summary(conn):
  '''Print a summarized report of the DB.'''
  def print_leaf(indent, group, g):
    for s in STATES:
      if s not in group:
        continue
      print('%s%s%d %s' % ('*' * indent, ' ' * indent, group[s][0], s))

  summary = group_files(conn)
  print('* %d Game Files' % summary[COUNT])
  for g in GROUPS:
    if g not in summary:
      continue
    group = summary[g]
    print('**  %d %s' % (group[COUNT], g))
    for s in ['Paired', 'Unpaired']:
      if s not in group:
        continue
      print('***   %d %s' % (group[s][COUNT], s))
      print_leaf(4, group[s], s)
    print_leaf(3, group, g)
  cur = conn.execute('''SELECT left.wiki_name, right.wiki_name,
       left.wiki_categories, right.wiki_categories
     FROM images as left, images as right
     ON substr(left.wiki_name, 1, length(left.wiki_name) - 4) || "small.png" = right.wiki_name
     WHERE left.wiki_name like "%.png" AND
     (left.wiki_categories != "" OR right.wiki_categories != "")''')
  result = cur.fetchall()
  print('\n%d False pairings ' % len(result) +
      '(Named like pairings, but actually cross-category):')
  for item in result:
    which = 0 if item[2] != "" else 1
    print('%s/%s, where the %s file is in category %s' %
        (item[0], item[1], ['1st', '2nd'][which], item[2+which]))


def print_report(conn, states):
  '''Print a summarized report of the DB.'''
  def print_leaf(indent, group, g):
    header = (indent * '*') + (indent * ' ')
    header2 = '*' + header + ' '
    for s in states:
      if s not in group:
        continue
      print('%s%s:' % (header, s))
      print('\n'.join(header2 + x for x in group[s][1:]))

  for state in states:
    if state not in STATES:
      raise ValueError('"%s" is not a valid state from %s' % (state, STATES))
  grouping = group_files(conn)
  for g in GROUPS:
    if g not in grouping:
      continue
    group = grouping[g]
    print('* %s' % g)
    for s in ['Paired', 'Unpaired']:
      if s not in group:
        continue
      print('**  %s' % s)
      print_leaf(3, group[s], s)
    print_leaf(2, group, g)


async def main():
  docs = __doc__.split('\n', 1)
  parser = argparse.ArgumentParser(description=docs[0], epilog='''
      If no arguments are given, the default is -cmds, i.e. to refresh
      everything and summarize.''')
  parser.add_argument('-c', '--categories', action='store_true',
      help='Refresh the list of game files by reading from the categories pages.')
  parser.add_argument('-m', '--map', action='store_true',
      help='Map wiki file names to server file names, without overwriting.')
  parser.add_argument('-o', '--overwrite', action='store_true',
      help='Overwrite when mapping file names.')
  parser.add_argument('-d', '--download', action='store_true',
      help='Download new images from the wiki and the server.')
  parser.add_argument('-f', '--force-reload', action='store_true', help='''
      Force a check for new server resources, even if they haven't
      expired yet. (Wiki images are always fully checked.)''')
  parser.add_argument('-s', '--summary', action='store_true',
      help='Output a summary of the current state of the DB, without modifying anything.')
  parser.add_argument('-r', '--report', nargs='?',
      const=','.join([STATE_CANT_FETCH, STATE_SIZE_MISMATCH, STATE_TOO_DIFFERENT]),
      help='''Output a detailed report, without modifying anything.
      The argument is a comma-separated list of states to report for,
      defaulting to those that were attempted but not matching.''')

  args = parser.parse_args()
  if not (args.categories or args.map or args.download or
      args.summary or args.report):
    args.categories = True
    args.map = True
    args.download = True
    args.summary = True

  if (not args.map) and args.overwrite:
    print("warning: --overwrite without --map does nothing!", file=sys.stderr)

  if (not args.download) and args.force_reload:
    print("warning: --force-reload without --download does nothing!",
          file=sys.stderr)

  conn = sqlite3.connect('images.db')
  conn.isolation_level = 'EXCLUSIVE'
  conn.execute('''CREATE TABLE IF NOT EXISTS images (
      wiki_name TEXT PRIMARY KEY,
      wiki_url TEXT NOT NULL,
      wiki_revision TEXT NOT NULL DEFAULT "",
      wiki_categories TEXT NOT NULL DEFAULT "",
      wiki_image BLOB,
      server_url TEXT NOT NULL DEFAULT "",
      server_status INTEGER NOT NULL DEFAULT 0,
      server_etag TEXT NOT NULL DEFAULT "",
      server_last_modified TEXT NOT NULL DEFAULT "",
      server_age INTEGER NOT NULL DEFAULT 0,
      server_max_age INTEGER NOT NULL DEFAULT 0,
      server_fetched_at INTEGER NOT NULL DEFAULT 0,
      server_image BLOB
      )''')

  async with aiohttp.ClientSession() as session:
    if args.categories:
      await update_categories(conn, session)

    if args.map:
      update_map(conn, args.overwrite)

    if args.download:
      await do_download(conn, session, args.force_reload)

    if args.summary:
      print_summary(conn)

    if args.report:
      print_report(conn, args.report.split(','))

if __name__ == '__main__':
  asyncio.run(main())
