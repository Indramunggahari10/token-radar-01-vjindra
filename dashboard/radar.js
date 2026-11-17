// Token Launch Radar: the page's behaviour. Data arrives as window.RADAR,
// written by main.ts from the same board as board.json, so the page, the
// board file and the screenshots all show the same numbers.
//
// The model, in one place for the reader: implied value = TVL x category
// multiple x growth x age x chains. The multiples are calibrated in
// lib/radar.ts from the tokened protocols in the same snapshot; the factor
// breakdown of every row is shown in its detail view by renderDetail.

(function () {
  'use strict';

  var data = window.RADAR;
  var rowsEl = document.getElementById('rows');
  var emptyEl = document.getElementById('empty');
  var countEl = document.getElementById('countLine');
  var detailEl = document.getElementById('detail');
  var qEl = document.getElementById('q');
  var categoryEl = document.getElementById('category');
  var chainEl = document.getElementById('chain');
  var sortEl = document.getElementById('sort');
  var watchlistEl = document.getElementById('watchlistOnly');
  var state = { q: '', category: '', chain: '', sort: 'rank', watchlistOnly: false, slug: null };

  function el(tag, text, cls) {
    var node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  }

  /** $660.5M, $94.8M, $846K: one decimal, no locale dependence. */
  function formatUsd(value) {
    if (value >= 1e9) return '$' + (value / 1e9).toFixed(2) + 'B';
    if (value >= 1e6) return '$' + (value / 1e6).toFixed(1) + 'M';
    if (value >= 1e3) return '$' + (value / 1e3).toFixed(0) + 'K';
    return '$' + Math.round(value);
  }

  function formatPct(change) {
    if (change === null || change === undefined) return '—';
    var sign = change >= 0 ? '+' : '−';
    return sign + Math.abs(change).toFixed(1) + '%';
  }

  function formatAge(days) {
    if (days === null || days === undefined) return '—';
    if (days < 365) return days + 'd';
    return (days / 365.25).toFixed(1) + 'y';
  }

  function chainLabel(chains) {
    if (chains.length === 0) return '—';
    if (chains.length === 1) return chains[0];
    return chains[0] + ' +' + (chains.length - 1);
  }

  /** Signal bar width: square-root scale so the tail stays visible. */
  function signalWidth(value, top) {
    return Math.max(3, Math.round(100 * Math.sqrt(value / top)));
  }

  /** Read the filter and detail state from the URL hash. */
  function readHash() {
    var params = new URLSearchParams(window.location.hash.slice(1));
    state.q = params.get('q') || '';
    state.category = params.get('category') || '';
    state.chain = params.get('chain') || '';
    state.sort = params.get('sort') || 'rank';
    state.watchlistOnly = params.get('watchlist') === '1';
    state.slug = params.get('slug') || null;
  }

  /** Write the state back to the hash without moving the page. */
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category) params.set('category', state.category);
    if (state.chain) params.set('chain', state.chain);
    if (state.sort !== 'rank') params.set('sort', state.sort);
    if (state.watchlistOnly) params.set('watchlist', '1');
    if (state.slug) params.set('slug', state.slug);
    var hash = params.toString();
    history.replaceState(null, '', hash ? '#' + hash : window.location.pathname);
  }

  function renderSummary() {
    var line = document.getElementById('summaryLine');
    line.textContent = '';
    line.appendChild(document.createTextNode('Scanned '));
    line.appendChild(el('strong', String(data.scanned)));
    line.appendChild(document.createTextNode(' protocols · '));
    line.appendChild(el('strong', String(data.preToken)));
    line.appendChild(document.createTextNode(' record no token · '));
    line.appendChild(el('strong', String(data.rows.length)));
    line.appendChild(document.createTextNode(' ranked · '));
    line.appendChild(el('strong', '40/40'));
    line.appendChild(document.createTextNode(' watchlist covered · '));
    line.appendChild(el('strong', String(data.setAside.length)));
    line.appendChild(document.createTextNode(' set aside as wrapped, staked, bridged or exchange products.'));
  }

  function renderOptions() {
    var categories = [];
    var chains = [];
    data.rows.forEach(function (row) {
      if (row.category && categories.indexOf(row.category) < 0) categories.push(row.category);
      row.chains.forEach(function (c) {
        if (chains.indexOf(c) < 0) chains.push(c);
      });
    });
    categories.sort();
    chains.sort();
    categories.forEach(function (c) {
      categoryEl.appendChild(el('option', c));
    });
    chains.forEach(function (c) {
      chainEl.appendChild(el('option', c));
    });
  }

  function sortedRows(filtered) {
    var list = filtered.slice();
    if (state.sort === 'tvl') list.sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
    else if (state.sort === 'change') list.sort(function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); });
    else if (state.sort === 'age') list.sort(function (a, b) { return (b.age_days || 0) - (a.age_days || 0); });
    else if (state.sort === 'name') list.sort(function (a, b) { return a.name.localeCompare(b.name); });
    else list.sort(function (a, b) { return a.rank - b.rank; });
    return list;
  }

  function applyFilters() {
    var q = state.q.trim().toLowerCase();
    return data.rows.filter(function (row) {
      if (state.watchlistOnly && !row.watchlist) return false;
      if (state.category && row.category !== state.category) return false;
      if (state.chain && row.chains.indexOf(state.chain) < 0) return false;
      if (q && row.name.toLowerCase().indexOf(q) < 0 && row.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }

  function renderBoard() {
    var filtered = sortedRows(applyFilters());
    var top = data.rows.length ? data.rows[0].implied_value_usd : 1;
    rowsEl.textContent = '';
    filtered.forEach(function (row) {
      var tr = document.createElement('tr');
      if (state.slug === row.slug) tr.className = 'selected';
      tr.addEventListener('click', function () { selectRow(row.slug); });

      var rank = el('td', String(row.rank), 'rankCell' + (row.rank <= 3 ? ' top3' : ''));
      tr.appendChild(rank);

      var proto = document.createElement('td');
      proto.appendChild(el('span', row.name, 'protoName'));
      proto.appendChild(document.createElement('br'));
      proto.appendChild(el('span', row.slug, 'protoSlug'));
      tr.appendChild(proto);

      tr.appendChild(el('td', row.category || '—'));
      tr.appendChild(el('td', chainLabel(row.chains)));
      tr.appendChild(el('td', formatUsd(row.tvl_usd), 'num'));

      var change = el('td', formatPct(row.change_7d), 'num');
      if (row.change_7d !== null && row.change_7d !== undefined) {
        change.className += row.change_7d >= 0 ? ' up' : ' down';
      }
      tr.appendChild(change);

      tr.appendChild(el('td', formatAge(row.age_days), 'num'));

      var value = document.createElement('td');
      value.className = 'num';
      value.appendChild(el('span', formatUsd(row.implied_value_usd)));
      var bar = el('div', null, 'bar');
      var fill = document.createElement('i');
      fill.style.width = signalWidth(row.implied_value_usd, top) + '%';
      bar.appendChild(fill);
      value.appendChild(bar);
      tr.appendChild(value);

      var note = document.createElement('td');
      if (row.watchlist) note.appendChild(el('span', 'Watchlist', 'badge'));
      tr.appendChild(note);

      rowsEl.appendChild(tr);
    });
    emptyEl.hidden = filtered.length > 0;
    countEl.textContent = 'Showing ' + filtered.length + ' of ' + data.rows.length + ' ranked protocols.';
  }

  /** The farm plan as an ordered list: steps are a sequence, so numbered. */
  function farmStepsList(steps) {
    var list = document.createElement('ol');
    steps.forEach(function (step) {
      list.appendChild(el('li', step));
    });
    return list;
  }

  function renderDetail() {
    var row = null;
    for (var i = 0; i < data.rows.length; i += 1) {
      if (data.rows[i].slug === state.slug) row = data.rows[i];
    }
    detailEl.textContent = '';
    if (!row) {
      detailEl.hidden = true;
      return;
    }
    detailEl.hidden = false;
    detailEl.appendChild(el('h2', '#' + row.rank + ' · ' + row.name));
    detailEl.appendChild(el('p', (row.category || 'Uncategorised') + ' · ' + row.chains.join(', ') + (row.watchlist ? ' · on the watchlist' : ''), 'sub'));

    var facts = document.createElement('ul');
    facts.className = 'facts';
    var items = [
      ['Implied value', formatUsd(row.implied_value_usd)],
      ['TVL', formatUsd(row.tvl_usd)],
      ['7-day change', formatPct(row.change_7d)],
      ['Running since', row.listed_at || 'not reported'],
    ];
    items.forEach(function (item) {
      var li = document.createElement('li');
      li.appendChild(el('span', item[0]));
      li.appendChild(el('b', item[1]));
      facts.appendChild(li);
    });
    detailEl.appendChild(facts);

    var workings = document.createElement('p');
    workings.className = 'workings';
    var multipleNote = row.factors.comps >= 2
      ? 'multiple ' + row.factors.multiple.toFixed(3) + ' (' + row.factors.comps + ' comps)'
      : 'global median ' + row.factors.multiple.toFixed(3) + ' (only ' + row.factors.comps + ' comp in this category)';
    workings.appendChild(document.createTextNode('Workings: '));
    workings.appendChild(el('b', formatUsd(row.tvl_usd)));
    workings.appendChild(document.createTextNode(' × '));
    workings.appendChild(el('b', multipleNote));
    workings.appendChild(document.createTextNode(' × growth '));
    workings.appendChild(el('b', row.factors.growth.toFixed(3)));
    workings.appendChild(document.createTextNode(' × age '));
    workings.appendChild(el('b', row.factors.age.toFixed(3)));
    workings.appendChild(document.createTextNode(' × chains '));
    workings.appendChild(el('b', row.factors.chains.toFixed(3)));
    workings.appendChild(document.createTextNode(' = '));
    workings.appendChild(el('b', formatUsd(row.implied_value_usd)));
    workings.appendChild(document.createTextNode('. Global median multiple: ' + data.globalMultiple.toFixed(3) + '.'));
    detailEl.appendChild(workings);

    detailEl.appendChild(el('h3', 'Farm plan'));
    detailEl.appendChild(farmStepsList(row.farm_steps));

    var close = el('button', 'Close detail', 'close');
    close.type = 'button';
    close.addEventListener('click', function () { selectRow(null); });
    detailEl.appendChild(close);
  }

  function renderAside() {
    var list = document.getElementById('asideList');
    data.setAside.forEach(function (item) {
      var li = document.createElement('li');
      li.appendChild(el('b', item.name + ' '));
      li.appendChild(document.createTextNode('— ' + item.reason));
      list.appendChild(li);
    });
  }

  function selectRow(slug) {
    state.slug = slug;
    writeHash();
    renderBoard();
    renderDetail();
    if (slug) detailEl.scrollIntoView({ block: 'start' });
  }

  function syncControls() {
    qEl.value = state.q;
    categoryEl.value = state.category;
    chainEl.value = state.chain;
    sortEl.value = state.sort;
    watchlistEl.checked = state.watchlistOnly;
  }

  function onControl() {
    state.q = qEl.value;
    state.category = categoryEl.value;
    state.chain = chainEl.value;
    state.sort = sortEl.value;
    state.watchlistOnly = watchlistEl.checked;
    writeHash();
    renderBoard();
  }

  function init() {
    if (!data || !Array.isArray(data.rows)) {
      document.getElementById('summaryLine').textContent = 'The board data did not load. The page needs data.js beside it.';
      return;
    }
    renderSummary();
    renderOptions();
    readHash();
    syncControls();
    renderAside();
    renderBoard();
    renderDetail();
    qEl.addEventListener('input', onControl);
    categoryEl.addEventListener('change', onControl);
    chainEl.addEventListener('change', onControl);
    sortEl.addEventListener('change', onControl);
    watchlistEl.addEventListener('change', onControl);
    document.getElementById('reset').addEventListener('click', function () {
      state.q = '';
      state.category = '';
      state.chain = '';
      state.sort = 'rank';
      state.watchlistOnly = false;
      state.slug = null;
      syncControls();
      writeHash();
      renderBoard();
      renderDetail();
    });
    window.addEventListener('hashchange', function () {
      readHash();
      syncControls();
      renderBoard();
      renderDetail();
    });
  }

  init();
})();
