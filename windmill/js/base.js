/* global window, document, $, hljs, elasticlunr, base_url, is_top_frame */
/* exported getParam */
"use strict";

// The full page consists of a main window (top-frame.html) with navigation and table of contents,
// and an inner iframe containing the current article. Which article is shown is determined by the
// main window's #hash portion of the URL. In fact, we use the simple rule: main window's URL of
// "rootUrl#relPath" corresponds to iframe's URL of "rootUrl/relPath".

var mainWindow = is_top_frame ? window : (window.parent !== window ? window.parent : null);
var iframeWindow = null;
var rootUrl = mainWindow ? getRootUrl(mainWindow.location.href) : null;
var searchIndex = null;

var Keys = {
  ENTER:  13,
  ESCAPE: 27,
  UP:     38,
  DOWN:   40,
};

function startsWith(str, prefix) { return str.lastIndexOf(prefix, 0) === 0; }
function endsWith(str, suffix) { return str.indexOf(suffix, str.length - suffix.length) !== -1; }

/**
 * Returns the portion of the given URL ending at the last slash before the first '#' or '?' sign.
 */
function getRootUrl(url) {
  return url.replace(/[^/?#]*([?#].*)?$/, '');
}

/**
 * Turns an absolute path to relative, stripping out rootUrl + separator.
 */
function getRelPath(separator, absUrl) {
  var prefix = rootUrl + (endsWith(rootUrl, separator) ? '' : separator);
  return startsWith(absUrl, prefix) ? absUrl.slice(prefix.length) : null;
}

/**
 * Turns a relative path to absolute, adding a prefix of rootUrl + separator.
 */
function getAbsUrl(separator, relPath) {
  var sep = endsWith(rootUrl, separator) ? '' : separator;
  return relPath === null ? null : rootUrl + sep + relPath;
}

/**
 * Redirects the iframe to reflect the path represented by the main window's current URL.
 * (In our design, nothing should change iframe's src except via updateIframe(), or back/forward
 * history is likely to get messed up.)
 */
function updateIframe(enableForwardNav) {
  // Grey out the "forward" button if we don't expect 'forward' to work.
  $('#hist-fwd').toggleClass('greybtn', !enableForwardNav);

  var targetRelPath = getRelPath('#', mainWindow.location.href) || '';
  var targetIframeUrl = getAbsUrl('/', targetRelPath);
  var loc = iframeWindow.location;
  var currentIframeUrl = _safeGetLocationHref(loc);

  console.log("updateIframe: %s -> %s (%s)", currentIframeUrl, targetIframeUrl,
    currentIframeUrl === targetIframeUrl ? "same" : "replacing");

  if (currentIframeUrl !== targetIframeUrl) {
    loc.replace(targetIframeUrl);
  }
}

/**
 * Returns location.href, catching exception that's triggered if the iframe is on a different domain.
 */
function _safeGetLocationHref(location) {
  try {
    return location.href;
  } catch (e) {
    return null;
  }
}

/**
 * Returns the value of the given parameter in the URL's query portion.
 */
function getParam(key) {
  var params = window.location.search.substring(1).split('&');
  for (var i = 0; i < params.length; i++) {
    var param = params[i].split('=');
    if (param[0] === key) {
      return decodeURIComponent(param[1].replace(/\+/g, '%20'));
    }
  }
}

/**
 * Update the state of the button toggling table-of-contents. TOC has different behavior
 * depending on screen size, so the button's behavior depends on that too.
 */
function updateTocButtonState() {
  var shown;
  if (window.matchMedia("(max-width: 600px)").matches) {
    shown = $('.wm-toc-pane').hasClass('wm-toc-dropdown');
  } else {
    shown = !$('#main-content').hasClass('wm-toc-hidden');
  }
  $('#toc-button').toggleClass('active', shown);
}

/**
 * When TOC is a dropdown (on small screens), close it.
 */
function closeTocDropdown() {
  $('.wm-toc-dropdown').removeClass('wm-toc-dropdown');
  updateTocButtonState();
}

/**
 * Visit the given URL. This changes the hash of the top page to reflect the new URL's relative
 * path, and points the iframe to the new URL.
 */
function visitUrl(url, event) {
  var relPath = getRelPath('/', url);
  if (relPath !== null) {
    event.preventDefault();
    var newUrl = getAbsUrl('#', relPath);
    console.log("newUrl %s, mainWindow href %s", newUrl, mainWindow.location.href);
    if (newUrl !== mainWindow.location.href) {
      mainWindow.history.pushState(null, '', newUrl);
      updateIframe(false);
    }
  }
}

function stripUrlPath(relUrl) {
  return relUrl.replace(/[#?].*/, '');
}

/**
 * Initialize the main window.
 */
function initMainWindow() {
  // toc-button either opens the table of contents in the side-pane, or (on smaller screens) shows
  // the side-pane as a drop-down.
  $('#toc-button').on('click', function(e) {
    if (window.matchMedia("(max-width: 600px)").matches) {
      $('.wm-toc-pane').toggleClass('wm-toc-dropdown');
      $('#wm-main-content').removeClass('wm-toc-hidden');
    } else {
      $('#main-content').toggleClass('wm-toc-hidden');
      closeTocDropdown();
    }
    updateTocButtonState();
  });

  // Update the state of the toc-button
  updateTocButtonState();
  $(window).on('resize', updateTocButtonState);

  // Connect up the Back and Forward buttons (if present).
  $('#hist-back').on('click', function(e) { window.history.back(); });
  $('#hist-fwd').on('click', function(e) { window.history.forward(); });

  // When the side-pane is a dropdown, hide it on click-away.
  $(window).on('blur', closeTocDropdown);

  // When we click on an opener in the table of contents, open it.
  $('.wm-toc-pane').on('click', '.wm-toc-opener', function(e) { $(this).toggleClass('open'); });

  // Once the article loads in the side-pane, close the dropdown.
  $('.wm-article').on('load', function() {
    $('.current').removeClass('current');

    var relPath = stripUrlPath(getRelPath('/', iframeWindow.location.href) || ".");
    var selector = '.wm-article-link[href="' + relPath + '"]';
    $(selector).closest('.wm-toc-li').addClass('current');
    $(selector).closest('.wm-toc-li-nested').prev().addClass('open');

    if (iframeWindow.pageToc) {
      renderPageToc($(selector).closest('.wm-toc-li'), relPath, iframeWindow.pageToc);
    }

    closeTocDropdown();
    iframeWindow.focus();
  });

  // Initialize search functionality.
  initSearch();

  // Load the iframe now, and whenever we navigate the top frame.
  setTimeout(function() { updateIframe(false); }, 0);
  $(window).on('popstate', function() { updateIframe(true); });
}

// TODO:
// It would be nicer to turn page link into a toggle when active and page toc shown.
// (can't decide if a triangle is desirable)

function renderPageToc(parentElem, pageUrl, pageToc) {
  var ul = $('<ul class="wm-toctree">');
  function addItem(tocItem) {
    ul.append($('<li class="wm-toc-li">')
      .append($('<a class="wm-article-link wm-page-toc-text">')
        .attr('href', pageUrl + tocItem.url).text(tocItem.title)));
    if (tocItem.children) {
      tocItem.children.forEach(addItem);
    }
  }
  pageToc.forEach(addItem);
  $('.wm-page-toc').remove();
  parentElem.after($('<li class="wm-page-toc wm-toc-li-nested">').append(ul));
}

// Link clicks get intercepted to call visitUrl (except rendering an article without an iframe).
if (mainWindow) {
  $(document).on('click', 'a', function(e) { visitUrl(this.href, e); });
}

if (is_top_frame) {
  // Main window.
  $(document).ready(function() {
    iframeWindow = $('.wm-article')[0].contentWindow;
    initMainWindow();
  });

} else {
  // Article contents.
  iframeWindow = window;

  // Other initialization of iframe contents.
  hljs.initHighlightingOnLoad();
  $('table').addClass('table table-striped table-hover');
}


/**
 * Initialize search functionality.
 */
function initSearch() {
  // Create elasticlunr index.
  searchIndex = elasticlunr(function() {
    this.setRef('location');
    this.addField('title');
    this.addField('text');
  });

  var searchBox = $('#mkdocs-search-query');
  var searchResults = $('#mkdocs-search-results');

  // Fetch the prebuilt index data, and add to the index.
  $.getJSON(base_url + '/mkdocs/search_index.json')
  .done(function(data) {
    data.docs.forEach(function(doc) {
      doc.location = base_url + doc.location;
      searchIndex.addDoc(doc);
    });
  });

  function showSearchResults(optShow) {
    var show = (optShow === false ? false : Boolean(searchBox.val()));
    if (show) {
      doSearch({
        resultsElem: searchResults,
        query: searchBox.val(),
        snippetLen: 100,
        limit: 10
      });
    }
    searchResults.parent().toggleClass('open', show);
    return show;
  }

  searchBox.on('click', function(e) {
    if (!searchResults.parent().hasClass('open')) {
      if (showSearchResults()) {
        e.stopPropagation();
      }
    }
  });

  // Search automatically and show results on keyup event.
  searchBox.on('keyup', function(e) {
    var show = (e.which !== Keys.ESCAPE && e.which !== Keys.ENTER);
    showSearchResults(show);
  });

  // Open the search box (and run the search) on up/down arrow keys.
  searchBox.on('keydown', function(e) {
    if (e.which === Keys.UP || e.which === Keys.DOWN) {
      if (showSearchResults()) {
        e.stopPropagation();
        e.preventDefault();
        setTimeout(function() {
          searchResults.find('a').eq(e.which === Keys.UP ? -1 : 0).focus();
        }, 0);
      }
    }
  });

  searchResults.on('keydown', function(e) {
    if (e.which === Keys.UP || e.which === Keys.DOWN) {
      if (searchResults.find('a').eq(e.which === Keys.UP ? 0 : -1)[0] === e.target) {
        searchBox.focus();
        e.stopPropagation();
        e.preventDefault();
      }
    }
  });

  $(searchResults).on('click', '.search-all', function(e) {
    e.stopPropagation();
    e.preventDefault();
    $('#search-form').trigger('submit');
  });

  // Redirect to the search page on Enter or button-click (form submit).
  $('#search-form').on('submit', function(e) {
    var url = this.action + '?' + $(this).serialize();
    visitUrl(url, e);
    searchResults.parent().removeClass('open');
  });
}

function escapeRegex(s) {
  return s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

/**
 * This helps construct useful snippets to show in search results, and highlight matches.
 */
function SnippetBuilder(query) {
  var termsPattern = elasticlunr.tokenizer(query).map(escapeRegex).join("|");
  this._termsRegex = termsPattern ? new RegExp(termsPattern, "gi") : null;
}

SnippetBuilder.prototype.getSnippet = function(text, len) {
  if (!this._termsRegex) {
    return text.slice(0, len);
  }

  // Find a position that includes something we searched for.
  var pos = text.search(this._termsRegex);
  if (pos < 0) { pos = 0; }

  // Find a period before that position (a good starting point).
  var start = text.lastIndexOf('.', pos) + 1;
  if (pos - start > 30) {
    // If too long to previous period, give it 30 characters, and find a space before that.
    start = text.lastIndexOf(' ', pos - 30) + 1;
  }
  var rawSnippet = text.slice(start, start + len);
  return rawSnippet.replace(this._termsRegex, '<b>$&</b>');
};

/**
 * Search the elasticlunr index for the given query, and populate the dropdown with results.
 */
// TODO: it should know the index?
function doSearch(options) {
  var resultsElem = options.resultsElem;
  var query = options.query;
  var snippetLen = options.snippetLen;
  var limit = options.limit;

  resultsElem.empty();

  if (query === '') { return; }

  var results = searchIndex.search(query, {
    fields: { title: {boost: 10}, text: { boost: 1 } },
    expand: true,
    bool: "AND"
  });

  var snippetBuilder = new SnippetBuilder(query);
  if (results.length > 0){
    var len = Math.min(results.length, limit || Infinity);
    for (var i = 0; i < len; i++) {
      var doc = searchIndex.documentStore.getDoc(results[i].ref);
      var snippet = snippetBuilder.getSnippet(doc.text, snippetLen);

      resultsElem.append(
        $('<li>').append($('<a class="search-link">').attr('href', doc.location)
          .append($('<div class="search-title">').text(doc.title))
          .append($('<div class="search-text">').html(snippet)))
      );
    }
    resultsElem.append($('<li role="separator" class="divider"></li>'));
    if (limit) {
      resultsElem.append($(
        '<li><a class="search-link search-all" href="/search.html">' +
        '<div class="search-title">SEE ALL RESULTS</div></a></li>'));
    }
  } else {
    resultsElem.append($('<li class="disabled"><a class="search-link">NO RESULTS FOUND</a></li>'));
  }
}

// TODO: There is a problem clicking a link that takes you to /#foo (i.e. anchor within index
// page, when index page isn't the one loaded).

  /*
   * TODO not needed for dropdown, and index isn't ready.

// Returns the value of the 'q' parameter in the URL's query portion.
function _getSearchTerm() {
  var params = window.location.search.substring(1).split('&');
  for (var i = 0; i < params.length; i++) {
    var param = params[i].split('=');
    if (param[0] === 'q') {
      return decodeURIComponent(param[1].replace(/\+/g, '%20'));
    }
  }
}

   var term = _getSearchTerm();
    if (term) {
      searchBox.val(term);
      search(index, documents, term);
    }
  */

