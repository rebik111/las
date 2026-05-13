/**
 * my pl — Lampa / Media Station X
 *
 * Клієнт не парсить HTML сторонніх сайтів. Потрібен ваш HTTPS-міст (bridge),
 * який повертає JSON. Три логічні джерела: uafix, anwap, fanfilm4k — передаються
 * параметром source; міст сам звертається до потрібних доменів.
 *
 * База URL без завершального «/». Приклад: https://example.com/api
 *
 * GET {base}/mypl/v1/search?source=uafix|anwap|fanfilm4k&title=&original_title=&year=&imdb_id=&kinopoisk_id=&tmdb_id=&serial=0|1
 *   → { "results": [ { "id","title","subtitle","poster","ref":{}, "serial": true/false } ] }
 *
 * GET {base}/mypl/v1/stream?source=&ref={encodeURIComponent(JSON)}
 *   → { "url","title","quality":{},"subtitles":[] }
 *
 * GET {base}/mypl/v1/seasons?source=&ref=...
 *   → { "seasons": [ { "number":1,"title":"..." } ] }  (опційно)
 *
 * GET {base}/mypl/v1/episodes?source=&ref=...&season=1
 *   → { "episodes": [ { "number":1,"title":"...","ref":{} } ] }  (опційно)
 *
 * Lampa.Storage: my_pl_bridge_base — базовий URL мосту.
 */
(function () {
  'use strict';

  if (window.__my_pl_plugin_loaded) return;
  window.__my_pl_plugin_loaded = true;

  var PLUGIN_VERSION = '0.1.0';
  var COMPONENT = 'my_pl';
  var STORAGE_BRIDGE = 'my_pl_bridge_base';
  var STORAGE_SOURCE = 'my_pl_last_source';
  var STORAGE_CHOICE = 'my_pl_choice_';

  var SOURCES = [
    { id: 'uafix', label: 'UAFlix', site: 'https://uafix.net' },
    { id: 'anwap', label: 'Anwap', site: 'https://my.anwap.love' },
    { id: 'fanfilm4k', label: 'FanFilm4K', site: 'https://v12.fanfilm4k.media' }
  ];

  function siteSearchUrl(sourceId, query) {
    var q = encodeURIComponent(query || '');
    if (sourceId === 'uafix') return 'https://uafix.net/?s=' + q;
    if (sourceId === 'anwap') return 'https://my.anwap.love/?do=search&subaction=search&story=' + q;
    if (sourceId === 'fanfilm4k')
      return 'https://v12.fanfilm4k.media/index.php?do=search&subaction=search&story=' + q;
    return '';
  }

  function trimBase(url) {
    if (!url) return '';
    url = ('' + url).trim();
    while (url.length && url.charAt(url.length - 1) === '/') url = url.slice(0, -1);
    return url;
  }

  function getBridgeBase() {
    return trimBase(Lampa.Storage.get(STORAGE_BRIDGE, ''));
  }

  function movieHash(movie) {
    if (!movie) return '0';
    return String(movie.id || Lampa.Utils.hash((movie.original_title || '') + (movie.title || '')));
  }

  function loadChoice(movie) {
    var key = STORAGE_CHOICE + movieHash(movie);
    return Lampa.Storage.get(key, {}) || {};
  }

  function saveChoice(movie, data) {
    var key = STORAGE_CHOICE + movieHash(movie);
    var prev = Lampa.Storage.get(key, {}) || {};
    Lampa.Arrays.extend(prev, data, true);
    Lampa.Storage.set(key, prev);
  }

  function buildSearchQuery(movie, search, sourceId) {
    var parts = [];
    parts.push('source=' + encodeURIComponent(sourceId));
    var title = (search || (movie && movie.title) || '') + '';
    var orig = (movie && movie.original_title) || '';
    parts.push('title=' + encodeURIComponent(title));
    parts.push('original_title=' + encodeURIComponent(orig));
    var y = '';
    if (movie) {
      var d = movie.release_date || movie.first_air_date || movie.year || '';
      y = (d + '').slice(0, 4);
    }
    parts.push('year=' + encodeURIComponent(y));
    parts.push('imdb_id=' + encodeURIComponent((movie && movie.imdb_id) || ''));
    parts.push('kinopoisk_id=' + encodeURIComponent((movie && movie.kinopoisk_id) || ''));
    parts.push('tmdb_id=' + encodeURIComponent(movie && movie.id != null ? String(movie.id) : ''));
    parts.push('serial=' + (movie && movie.name ? '1' : '0'));
    return parts.join('&');
  }

  function encodeRef(ref) {
    try {
      return encodeURIComponent(JSON.stringify(ref == null ? {} : ref));
    } catch (e) {
      return encodeURIComponent('{}');
    }
  }

  function loader(act, on) {
    try {
      if (act && act.activity && typeof act.activity.loader === 'function') act.activity.loader(on);
    } catch (e) {}
  }

  function MyPlComponent(params) {
    var network = new Lampa.Reguest();
    var scroll = new Lampa.Scroll({ mask: true, over: true });
    var object = params || {};
    var dom;
    var built;
    var currentSourceId;
    var currentResults = [];
    var seasonsData = [];
    var episodesData = [];

    function activity() {
      return Lampa.Activity.active();
    }

    function currentSource() {
      for (var i = 0; i < SOURCES.length; i++) {
        if (SOURCES[i].id === currentSourceId) return SOURCES[i];
      }
      return SOURCES[0];
    }

    function setSource(id) {
      currentSourceId = id;
      Lampa.Storage.set(STORAGE_SOURCE, id);
      dom.find('.my-pl__source-name').text(currentSource().label);
    }

    function showStatus(text) {
      dom.find('.my-pl__status').text(text || '');
    }

    function showError(msg) {
      showStatus(msg);
      if (Lampa.Noty && Lampa.Noty.show) Lampa.Noty.show(msg);
    }

    function bridgeUrl(path) {
      var b = getBridgeBase();
      if (!b) return '';
      return b + path;
    }

    function requestJson(url, onOk, onErr) {
      network.timeout(25000);
      network.silent(
        url,
        function (json) {
          onOk(json);
        },
        function () {
          onErr();
        },
        false,
        { dataType: 'json' }
      );
    }

    function clearList() {
      scroll.clear();
      scroll.body().empty();
    }

    function drawItem(row) {
      var line = $('<div class="my-pl__row selector"></div>');
      if (row.poster) {
        var wrap = $('<div class="my-pl__poster"><img alt=""></div>');
        wrap.find('img').attr('src', row.poster);
        var img = wrap.find('img')[0];
        if (img)
          img.onerror = function () {
            wrap.addClass('my-pl__poster--empty').empty();
          };
        line.append(wrap);
      } else {
        line.append('<div class="my-pl__poster my-pl__poster--empty"></div>');
      }
      var meta = $(
        '<div class="my-pl__meta"><div class="my-pl__row-title"></div><div class="my-pl__row-sub"></div></div>'
      );
      meta.find('.my-pl__row-title').text(row.title || '');
      meta.find('.my-pl__row-sub').text(row.subtitle || '');
      line.append(meta);
      line.on('hover:enter', function () {
        onPickResult(row);
      });
      scroll.body().append(line);
    }

    function drawSeasons() {
      clearList();
      seasonsData.forEach(function (s, idx) {
        var line = $('<div class="my-pl__row selector"></div>');
        line.append(
          '<div class="my-pl__meta"><div class="my-pl__row-title"></div></div>'
        );
        line
          .find('.my-pl__row-title')
          .text(s.title || 'Сезон ' + (s.number != null ? s.number : idx + 1));
        line.on('hover:enter', function () {
          loadEpisodes(s.number != null ? s.number : idx + 1);
        });
        scroll.body().append(line);
      });
      showStatus(Lampa.Lang.translate('my_pl_pick_season'));
    }

    function drawEpisodes() {
      clearList();
      episodesData.forEach(function (ep) {
        var line = $('<div class="my-pl__row selector"></div>');
        line.append('<div class="my-pl__meta"><div class="my-pl__row-title"></div></div>');
        line.find('.my-pl__row-title').text(ep.title || 'Серія ' + (ep.number || ''));
        line.on('hover:enter', function () {
          playStream(ep.ref != null ? ep.ref : ep);
        });
        scroll.body().append(line);
      });
      showStatus(Lampa.Lang.translate('my_pl_pick_episode'));
    }

    function playStream(refPayload) {
      var url =
        bridgeUrl('/mypl/v1/stream?source=' +
        encodeURIComponent(currentSourceId) +
        '&ref=' +
        encodeRef(refPayload));
      if (!url || !getBridgeBase()) {
        showError(Lampa.Lang.translate('my_pl_no_bridge'));
        return;
      }
      showStatus(Lampa.Lang.translate('my_pl_loading_stream'));
      loader(activity(), true);
      requestJson(
        url,
        function (json) {
          loader(activity(), false);
          var playUrl = json.url || (json.stream && json.stream.url) || '';
          var quality = json.quality || (json.stream && json.stream.quality) || {};
          var title = json.title || (object.movie && object.movie.title) || 'my pl';
          var subs = json.subtitles || [];
          if (!playUrl) {
            showError(Lampa.Lang.translate('my_pl_no_link'));
            return;
          }
          Lampa.Player.play({
            url: playUrl,
            title: title,
            quality: quality,
            subtitles: subs
          });
          Lampa.Player.playlist([]);
        },
        function () {
          loader(activity(), false);
          showError(Lampa.Lang.translate('my_pl_no_link'));
        }
      );
    }

    function onPickResult(row) {
      var ref = row.ref != null ? row.ref : { id: row.id };
      var isSerial = !!(row.serial || (object.movie && object.movie.name));
      if (isSerial) {
        loadSeasons(ref);
        return;
      }
      playStream(ref);
    }

    function loadSeasons(ref) {
      var url =
        bridgeUrl('/mypl/v1/seasons?source=' +
        encodeURIComponent(currentSourceId) +
        '&ref=' +
        encodeRef(ref));
      if (!url || !getBridgeBase()) {
        playStream(ref);
        return;
      }
      loader(activity(), true);
      requestJson(
        url,
        function (json) {
          loader(activity(), false);
          seasonsData = json.seasons || [];
          if (!seasonsData.length) {
            playStream(ref);
            return;
          }
          saveChoice(object.movie, { last_ref: ref });
          drawSeasons();
        },
        function () {
          loader(activity(), false);
          playStream(ref);
        }
      );
    }

    function loadEpisodes(seasonNum) {
      var choice = loadChoice(object.movie);
      var ref = choice.last_ref;
      var url =
        bridgeUrl('/mypl/v1/episodes?source=' +
        encodeURIComponent(currentSourceId) +
        '&ref=' +
        encodeRef(ref) +
        '&season=' +
        encodeURIComponent(String(seasonNum)));
      if (!url || !getBridgeBase()) {
        showError(Lampa.Lang.translate('my_pl_no_bridge'));
        return;
      }
      loader(activity(), true);
      requestJson(
        url,
        function (json) {
          loader(activity(), false);
          episodesData = json.episodes || [];
          if (!episodesData.length) {
            showError(Lampa.Lang.translate('my_pl_no_episodes'));
            return;
          }
          saveChoice(object.movie, { season: seasonNum });
          drawEpisodes();
        },
        function () {
          loader(activity(), false);
          showError(Lampa.Lang.translate('my_pl_no_episodes'));
        }
      );
    }

    function runSearch() {
      if (!getBridgeBase()) {
        showError(Lampa.Lang.translate('my_pl_no_bridge'));
        return;
      }
      var q = bridgeUrl('/mypl/v1/search?' + buildSearchQuery(object.movie, object.search, currentSourceId));
      loader(activity(), true);
      showStatus(Lampa.Lang.translate('my_pl_searching'));
      requestJson(
        q,
        function (json) {
          loader(activity(), false);
          currentResults = json.results || json.data || [];
          clearList();
          if (!currentResults.length) {
            showStatus(Lampa.Lang.translate('my_pl_empty'));
            return;
          }
          currentResults.forEach(function (row) {
            drawItem(row);
          });
          showStatus(Lampa.Lang.translate('my_pl_pick'));
        },
        function () {
          loader(activity(), false);
          showError(Lampa.Lang.translate('my_pl_search_fail'));
        }
      );
    }

    function openSourcePicker() {
      var items = SOURCES.map(function (s) {
        return { title: s.label, source: s, selected: s.id === currentSourceId };
      });
      Lampa.Select.show({
        title: Lampa.Lang.translate('my_pl_sources'),
        items: items,
        onSelect: function (a) {
          setSource(a.source.id);
          runSearch();
        }
      });
    }

    function openSiteSearch() {
      var u = siteSearchUrl(currentSourceId, object.search || (object.movie && object.movie.title) || '');
      if (!u) return;
      if (Lampa.Iframe && Lampa.Iframe.show) Lampa.Iframe.show(u);
      else window.open(u, '_blank');
    }

    function openBridgeInput() {
      var cur = Lampa.Storage.get(STORAGE_BRIDGE, '');
      if (Lampa.Input && Lampa.Input.edit) {
        Lampa.Input.edit({
          title: Lampa.Lang.translate('my_pl_bridge_title'),
          value: cur,
          free: true,
          nosave: true,
          ok: function (val) {
            Lampa.Storage.set(STORAGE_BRIDGE, trimBase(val));
            showStatus(Lampa.Lang.translate('my_pl_bridge_saved'));
            runSearch();
          }
        });
      } else {
        var v = typeof window !== 'undefined' && window.prompt ? window.prompt('Bridge URL', cur) : null;
        if (v != null && v !== '') {
          Lampa.Storage.set(STORAGE_BRIDGE, trimBase(v));
          runSearch();
        }
      }
    }

    function buildLayout() {
      if (built) return;
      built = true;
      dom = $(
        '<div class="my-pl">' +
          '<div class="my-pl__head">' +
          '<div class="my-pl__head-row">' +
          '<div class="my-pl__title">my pl</div>' +
          '<div class="my-pl__head-actions">' +
          '<div class="my-pl__btn selector"><span class="my-pl__src-lbl"></span>: <span class="my-pl__source-name"></span></div>' +
          '<div class="my-pl__btn selector my-pl__btn-bridge"></div>' +
          '<div class="my-pl__btn selector my-pl__btn-site"></div>' +
          '</div></div>' +
          '<div class="my-pl__status"></div>' +
          '</div>'
      );
      dom.find('.my-pl__src-lbl').text(Lampa.Lang.translate('my_pl_sources'));
      dom.find('.my-pl__btn-bridge').text(Lampa.Lang.translate('my_pl_bridge_btn'));
      dom.find('.my-pl__btn-site').text(Lampa.Lang.translate('my_pl_open_site'));
      scroll.render().addClass('my-pl__scroll');
      dom.append(scroll.render());
      dom.find('.my-pl__head .my-pl__btn').eq(0).on('hover:enter', openSourcePicker);
      dom.find('.my-pl__btn-bridge').on('hover:enter', openBridgeInput);
      dom.find('.my-pl__btn-site').on('hover:enter', openSiteSearch);
    }

    this.start = function () {
      var act = activity();
      if (act) {
        if (act.movie) object.movie = act.movie;
        if (act.search !== undefined && act.search !== null) object.search = act.search;
      }
      buildLayout();
      currentSourceId = Lampa.Storage.get(STORAGE_SOURCE, SOURCES[0].id);
      setSource(currentSourceId);
      if (object.movie) Lampa.Background.immediately(Lampa.Utils.cardImgBackgroundBlur(object.movie));
      Lampa.Controller.add('content', {
        toggle: function () {
          Lampa.Controller.collectionSet(scroll.render(), scroll.render());
          Lampa.Controller.collectionFocus(scroll.body().find('.selector').first(), scroll.render());
        },
        gone: function () {},
        up: function () {
          if (Navigator.canmove('up')) Navigator.move('up');
          else Lampa.Controller.toggle('head');
        },
        down: function () {
          Navigator.move('down');
        },
        right: function () {
          if (Navigator.canmove('right')) Navigator.move('right');
        },
        left: function () {
          if (Navigator.canmove('left')) Navigator.move('left');
          else Lampa.Controller.toggle('menu');
        },
        back: function () {
          Lampa.Activity.backward();
        }
      });
      Lampa.Controller.toggle('content');
      runSearch();
    };

    this.render = function (js) {
      buildLayout();
      js.append(dom);
      return dom;
    };

    this.pause = function () {};
    this.stop = function () {};

    this.destroy = function () {
      network.clear();
      try {
        scroll.destroy();
      } catch (e) {}
    };
  }

  function injectCss() {
    var css =
      '.my-pl{padding:1em;box-sizing:border-box}' +
      '.my-pl__head{margin-bottom:1em}' +
      '.my-pl__title{font-size:1.8em;font-weight:600;margin-bottom:.5em}' +
      '.my-pl__head-row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.6em}' +
      '.my-pl__head-actions{display:flex;flex-wrap:wrap;gap:.5em}' +
      '.my-pl__btn{background:rgba(255,255,255,.12);padding:.45em .8em;border-radius:.25em;font-size:.95em}' +
      '.my-pl__btn.focus{background:#fff;color:#000}' +
      '.my-pl__status{opacity:.85;margin:.5em 0;font-size:.95em}' +
      '.my-pl__scroll{max-height:calc(100vh - 9em)}' +
      '.my-pl__row{display:flex;align-items:center;padding:.65em;margin-bottom:.5em;border-radius:.3em;background:rgba(0,0,0,.25)}' +
      '.my-pl__row.focus{outline:.2em solid #fff}' +
      '.my-pl__poster{width:4.5em;height:6.5em;border-radius:.25em;overflow:hidden;flex-shrink:0;margin-right:1em;background:rgba(255,255,255,.08)}' +
      '.my-pl__poster img{width:100%;height:100%;object-fit:cover}' +
      '.my-pl__row-title{font-size:1.15em}' +
      '.my-pl__row-sub{opacity:.75;font-size:.9em;margin-top:.2em}' +
      '.my-pl__meta{min-width:0;flex:1}';
    if (!$('#my-pl-style').length) $('head').append('<style id="my-pl-style">' + css + '</style>');
  }

  function pushMyPl(movie) {
    Lampa.Activity.push({
      url: '',
      title: 'my pl',
      component: COMPONENT,
      movie: movie,
      search: movie.title,
      page: 1
    });
  }

  function startPlugin() {
    injectCss();

    Lampa.Lang.add({
      my_pl_watch: { uk: 'my pl', ru: 'my pl', en: 'my pl' },
      my_pl_sources: { uk: 'Джерело', ru: 'Источник', en: 'Source' },
      my_pl_bridge_btn: { uk: 'URL мосту', ru: 'URL моста', en: 'Bridge URL' },
      my_pl_bridge_title: {
        uk: 'my pl — базовий URL мосту (HTTPS)',
        ru: 'my pl — базовый URL моста (HTTPS)',
        en: 'my pl — bridge base URL (HTTPS)'
      },
      my_pl_bridge_saved: {
        uk: 'Збережено. Повторний пошук…',
        ru: 'Сохранено. Повторный поиск…',
        en: 'Saved. Searching again…'
      },
      my_pl_no_bridge: {
        uk: 'Задайте URL мосту (кнопка «URL мосту»). Клієнт не звертається до сайтів напряму.',
        ru: 'Укажите URL моста. Клиент не обращается к сайтам напрямую.',
        en: 'Set the bridge URL. The client does not call sites directly.'
      },
      my_pl_searching: { uk: 'Пошук…', ru: 'Поиск…', en: 'Searching…' },
      my_pl_search_fail: {
        uk: 'Помилка пошуку (міст або мережа).',
        ru: 'Ошибка поиска (мост или сеть).',
        en: 'Search failed (bridge or network).'
      },
      my_pl_empty: { uk: 'Нічого не знайдено.', ru: 'Ничего не найдено.', en: 'Nothing found.' },
      my_pl_pick: { uk: 'Оберіть позицію', ru: 'Выберите позицию', en: 'Select an item' },
      my_pl_pick_season: { uk: 'Оберіть сезон', ru: 'Выберите сезон', en: 'Pick a season' },
      my_pl_pick_episode: { uk: 'Оберіть серію', ru: 'Выберите серию', en: 'Pick an episode' },
      my_pl_loading_stream: {
        uk: 'Отримання посилання…',
        ru: 'Получение ссылки…',
        en: 'Fetching stream…'
      },
      my_pl_no_link: {
        uk: 'Немає посилання для відтворення.',
        ru: 'Нет ссылки для воспроизведения.',
        en: 'No playable link.'
      },
      my_pl_no_episodes: {
        uk: 'Серії не отримано.',
        ru: 'Серии не получены.',
        en: 'No episodes returned.'
      },
      my_pl_open_site: {
        uk: 'Пошук на сайті',
        ru: 'Поиск на сайте',
        en: 'Search on site'
      }
    });

    Lampa.Component.add(COMPONENT, MyPlComponent);

    var manifest = {
      type: 'video',
      version: PLUGIN_VERSION,
      name: 'my pl',
      description: 'UAFlix / Anwap / FanFilm4K через JSON-міст',
      component: COMPONENT,
      onContextMenu: function () {
        return {
          name: Lampa.Lang.translate('my_pl_watch'),
          description: 'my pl v' + PLUGIN_VERSION
        };
      },
      onContextLauch: function (card) {
        pushMyPl(card);
      }
    };

    Lampa.Manifest.plugins = manifest;

    var btn =
      '<div class="full-start__button selector my-pl-launch-btn" data-subtitle="my pl v' +
      PLUGIN_VERSION +
      '">' +
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>' +
      '<span>my pl</span></div>';

    function placeButton(render, movie) {
      if (!render || !render.length) return;
      if (render.parent().find('.my-pl-launch-btn').length) return;
      var el = $(btn);
      el.on('hover:enter', function () {
        pushMyPl(movie);
      });
      render.after(el);
    }

    Lampa.Listener.follow('full', function (e) {
      if (e.type === 'complite') {
        placeButton(e.object.activity.render().find('.view--torrent'), e.data.movie);
      }
    });

    try {
      if (Lampa.Activity.active().component === 'full') {
        placeButton(
          Lampa.Activity.active().activity.render().find('.view--torrent'),
          Lampa.Activity.active().card
        );
      }
    } catch (err) {}
  }

  if (typeof Lampa !== 'undefined' && Lampa.Manifest && Lampa.Manifest.app_digital >= 155) {
    startPlugin();
  }
})();
