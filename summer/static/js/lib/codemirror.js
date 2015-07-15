(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({"/Users/gaowhen/Lab/flaskr/app/static/src/js/lib/codemirror.js":[function(require,module,exports){
// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: http://codemirror.net/LICENSE

// This is CodeMirror (http://codemirror.net), a code editor
// implemented in JavaScript on top of the browser's DOM.
//
// You can find some technical background for some of the code below
// at http://marijnhaverbeke.nl/blog/#cm-internals .

(function(mod) {
  if (typeof exports == "object" && typeof module == "object") // CommonJS
    module.exports = mod();
  else if (typeof define == "function" && define.amd) // AMD
    return define([], mod);
  else // Plain browser env
    this.CodeMirror = mod();
})(function() {
  "use strict";

  // BROWSER SNIFFING

  // Kludges for bugs and behavior differences that can't be feature
  // detected are enabled based on userAgent etc sniffing.

  var gecko = /gecko\/\d/i.test(navigator.userAgent);
  var ie_upto10 = /MSIE \d/.test(navigator.userAgent);
  var ie_11up = /Trident\/(?:[7-9]|\d{2,})\..*rv:(\d+)/.exec(navigator.userAgent);
  var ie = ie_upto10 || ie_11up;
  var ie_version = ie && (ie_upto10 ? document.documentMode || 6 : ie_11up[1]);
  var webkit = /WebKit\//.test(navigator.userAgent);
  var qtwebkit = webkit && /Qt\/\d+\.\d+/.test(navigator.userAgent);
  var chrome = /Chrome\//.test(navigator.userAgent);
  var presto = /Opera\//.test(navigator.userAgent);
  var safari = /Apple Computer/.test(navigator.vendor);
  var mac_geMountainLion = /Mac OS X 1\d\D([8-9]|\d\d)\D/.test(navigator.userAgent);
  var phantom = /PhantomJS/.test(navigator.userAgent);

  var ios = /AppleWebKit/.test(navigator.userAgent) && /Mobile\/\w+/.test(navigator.userAgent);
  // This is woefully incomplete. Suggestions for alternative methods welcome.
  var mobile = ios || /Android|webOS|BlackBerry|Opera Mini|Opera Mobi|IEMobile/i.test(navigator.userAgent);
  var mac = ios || /Mac/.test(navigator.platform);
  var windows = /win/i.test(navigator.platform);

  var presto_version = presto && navigator.userAgent.match(/Version\/(\d*\.\d*)/);
  if (presto_version) presto_version = Number(presto_version[1]);
  if (presto_version && presto_version >= 15) { presto = false; webkit = true; }
  // Some browsers use the wrong event properties to signal cmd/ctrl on OS X
  var flipCtrlCmd = mac && (qtwebkit || presto && (presto_version == null || presto_version < 12.11));
  var captureRightClick = gecko || (ie && ie_version >= 9);

  // Optimize some code when these features are not used.
  var sawReadOnlySpans = false, sawCollapsedSpans = false;

  // EDITOR CONSTRUCTOR

  // A CodeMirror instance represents an editor. This is the object
  // that user code is usually dealing with.

  function CodeMirror(place, options) {
    if (!(this instanceof CodeMirror)) return new CodeMirror(place, options);

    this.options = options = options ? copyObj(options) : {};
    // Determine effective options based on given values and defaults.
    copyObj(defaults, options, false);
    setGuttersForLineNumbers(options);

    var doc = options.value;
    if (typeof doc == "string") doc = new Doc(doc, options.mode);
    this.doc = doc;

    var input = new CodeMirror.inputStyles[options.inputStyle](this);
    var display = this.display = new Display(place, doc, input);
    display.wrapper.CodeMirror = this;
    updateGutters(this);
    themeChanged(this);
    if (options.lineWrapping)
      this.display.wrapper.className += " CodeMirror-wrap";
    if (options.autofocus && !mobile) display.input.focus();
    initScrollbars(this);

    this.state = {
      keyMaps: [],  // stores maps added by addKeyMap
      overlays: [], // highlighting overlays, as added by addOverlay
      modeGen: 0,   // bumped when mode/overlay changes, used to invalidate highlighting info
      overwrite: false,
      delayingBlurEvent: false,
      focused: false,
      suppressEdits: false, // used to disable editing during key handlers when in readOnly mode
      pasteIncoming: false, cutIncoming: false, // help recognize paste/cut edits in input.poll
      draggingText: false,
      highlight: new Delayed(), // stores highlight worker timeout
      keySeq: null,  // Unfinished key sequence
      specialChars: null
    };

    var cm = this;

    // Override magic textarea content restore that IE sometimes does
    // on our hidden textarea on reload
    if (ie && ie_version < 11) setTimeout(function() { cm.display.input.reset(true); }, 20);

    registerEventHandlers(this);
    ensureGlobalHandlers();

    startOperation(this);
    this.curOp.forceUpdate = true;
    attachDoc(this, doc);

    if ((options.autofocus && !mobile) || cm.hasFocus())
      setTimeout(bind(onFocus, this), 20);
    else
      onBlur(this);

    for (var opt in optionHandlers) if (optionHandlers.hasOwnProperty(opt))
      optionHandlers[opt](this, options[opt], Init);
    maybeUpdateLineNumberWidth(this);
    if (options.finishInit) options.finishInit(this);
    for (var i = 0; i < initHooks.length; ++i) initHooks[i](this);
    endOperation(this);
    // Suppress optimizelegibility in Webkit, since it breaks text
    // measuring on line wrapping boundaries.
    if (webkit && options.lineWrapping &&
        getComputedStyle(display.lineDiv).textRendering == "optimizelegibility")
      display.lineDiv.style.textRendering = "auto";
  }

  // DISPLAY CONSTRUCTOR

  // The display handles the DOM integration, both for input reading
  // and content drawing. It holds references to DOM nodes and
  // display-related state.

  function Display(place, doc, input) {
    var d = this;
    this.input = input;

    // Covers bottom-right square when both scrollbars are present.
    d.scrollbarFiller = elt("div", null, "CodeMirror-scrollbar-filler");
    d.scrollbarFiller.setAttribute("cm-not-content", "true");
    // Covers bottom of gutter when coverGutterNextToScrollbar is on
    // and h scrollbar is present.
    d.gutterFiller = elt("div", null, "CodeMirror-gutter-filler");
    d.gutterFiller.setAttribute("cm-not-content", "true");
    // Will contain the actual code, positioned to cover the viewport.
    d.lineDiv = elt("div", null, "CodeMirror-code");
    // Elements are added to these to represent selection and cursors.
    d.selectionDiv = elt("div", null, null, "position: relative; z-index: 1");
    d.cursorDiv = elt("div", null, "CodeMirror-cursors");
    // A visibility: hidden element used to find the size of things.
    d.measure = elt("div", null, "CodeMirror-measure");
    // When lines outside of the viewport are measured, they are drawn in this.
    d.lineMeasure = elt("div", null, "CodeMirror-measure");
    // Wraps everything that needs to exist inside the vertically-padded coordinate system
    d.lineSpace = elt("div", [d.measure, d.lineMeasure, d.selectionDiv, d.cursorDiv, d.lineDiv],
                      null, "position: relative; outline: none");
    // Moved around its parent to cover visible view.
    d.mover = elt("div", [elt("div", [d.lineSpace], "CodeMirror-lines")], null, "position: relative");
    // Set to the height of the document, allowing scrolling.
    d.sizer = elt("div", [d.mover], "CodeMirror-sizer");
    d.sizerWidth = null;
    // Behavior of elts with overflow: auto and padding is
    // inconsistent across browsers. This is used to ensure the
    // scrollable area is big enough.
    d.heightForcer = elt("div", null, null, "position: absolute; height: " + scrollerGap + "px; width: 1px;");
    // Will contain the gutters, if any.
    d.gutters = elt("div", null, "CodeMirror-gutters");
    d.lineGutter = null;
    // Actual scrollable element.
    d.scroller = elt("div", [d.sizer, d.heightForcer, d.gutters], "CodeMirror-scroll");
    d.scroller.setAttribute("tabIndex", "-1");
    // The element in which the editor lives.
    d.wrapper = elt("div", [d.scrollbarFiller, d.gutterFiller, d.scroller], "CodeMirror");

    // Work around IE7 z-index bug (not perfect, hence IE7 not really being supported)
    if (ie && ie_version < 8) { d.gutters.style.zIndex = -1; d.scroller.style.paddingRight = 0; }
    if (!webkit && !(gecko && mobile)) d.scroller.draggable = true;

    if (place) {
      if (place.appendChild) place.appendChild(d.wrapper);
      else place(d.wrapper);
    }

    // Current rendered range (may be bigger than the view window).
    d.viewFrom = d.viewTo = doc.first;
    d.reportedViewFrom = d.reportedViewTo = doc.first;
    // Information about the rendered lines.
    d.view = [];
    d.renderedView = null;
    // Holds info about a single rendered line when it was rendered
    // for measurement, while not in view.
    d.externalMeasured = null;
    // Empty space (in pixels) above the view
    d.viewOffset = 0;
    d.lastWrapHeight = d.lastWrapWidth = 0;
    d.updateLineNumbers = null;

    d.nativeBarWidth = d.barHeight = d.barWidth = 0;
    d.scrollbarsClipped = false;

    // Used to only resize the line number gutter when necessary (when
    // the amount of lines crosses a boundary that makes its width change)
    d.lineNumWidth = d.lineNumInnerWidth = d.lineNumChars = null;
    // Set to true when a non-horizontal-scrolling line widget is
    // added. As an optimization, line widget aligning is skipped when
    // this is false.
    d.alignWidgets = false;

    d.cachedCharWidth = d.cachedTextHeight = d.cachedPaddingH = null;

    // Tracks the maximum line length so that the horizontal scrollbar
    // can be kept static when scrolling.
    d.maxLine = null;
    d.maxLineLength = 0;
    d.maxLineChanged = false;

    // Used for measuring wheel scrolling granularity
    d.wheelDX = d.wheelDY = d.wheelStartX = d.wheelStartY = null;

    // True when shift is held down.
    d.shift = false;

    // Used to track whether anything happened since the context menu
    // was opened.
    d.selForContextMenu = null;

    d.activeTouch = null;

    input.init(d);
  }

  // STATE UPDATES

  // Used to get the editor into a consistent state again when options change.

  function loadMode(cm) {
    cm.doc.mode = CodeMirror.getMode(cm.options, cm.doc.modeOption);
    resetModeState(cm);
  }

  function resetModeState(cm) {
    cm.doc.iter(function(line) {
      if (line.stateAfter) line.stateAfter = null;
      if (line.styles) line.styles = null;
    });
    cm.doc.frontier = cm.doc.first;
    startWorker(cm, 100);
    cm.state.modeGen++;
    if (cm.curOp) regChange(cm);
  }

  function wrappingChanged(cm) {
    if (cm.options.lineWrapping) {
      addClass(cm.display.wrapper, "CodeMirror-wrap");
      cm.display.sizer.style.minWidth = "";
      cm.display.sizerWidth = null;
    } else {
      rmClass(cm.display.wrapper, "CodeMirror-wrap");
      findMaxLine(cm);
    }
    estimateLineHeights(cm);
    regChange(cm);
    clearCaches(cm);
    setTimeout(function(){updateScrollbars(cm);}, 100);
  }

  // Returns a function that estimates the height of a line, to use as
  // first approximation until the line becomes visible (and is thus
  // properly measurable).
  function estimateHeight(cm) {
    var th = textHeight(cm.display), wrapping = cm.options.lineWrapping;
    var perLine = wrapping && Math.max(5, cm.display.scroller.clientWidth / charWidth(cm.display) - 3);
    return function(line) {
      if (lineIsHidden(cm.doc, line)) return 0;

      var widgetsHeight = 0;
      if (line.widgets) for (var i = 0; i < line.widgets.length; i++) {
        if (line.widgets[i].height) widgetsHeight += line.widgets[i].height;
      }

      if (wrapping)
        return widgetsHeight + (Math.ceil(line.text.length / perLine) || 1) * th;
      else
        return widgetsHeight + th;
    };
  }

  function estimateLineHeights(cm) {
    var doc = cm.doc, est = estimateHeight(cm);
    doc.iter(function(line) {
      var estHeight = est(line);
      if (estHeight != line.height) updateLineHeight(line, estHeight);
    });
  }

  function themeChanged(cm) {
    cm.display.wrapper.className = cm.display.wrapper.className.replace(/\s*cm-s-\S+/g, "") +
      cm.options.theme.replace(/(^|\s)\s*/g, " cm-s-");
    clearCaches(cm);
  }

  function guttersChanged(cm) {
    updateGutters(cm);
    regChange(cm);
    setTimeout(function(){alignHorizontally(cm);}, 20);
  }

  // Rebuild the gutter elements, ensure the margin to the left of the
  // code matches their width.
  function updateGutters(cm) {
    var gutters = cm.display.gutters, specs = cm.options.gutters;
    removeChildren(gutters);
    for (var i = 0; i < specs.length; ++i) {
      var gutterClass = specs[i];
      var gElt = gutters.appendChild(elt("div", null, "CodeMirror-gutter " + gutterClass));
      if (gutterClass == "CodeMirror-linenumbers") {
        cm.display.lineGutter = gElt;
        gElt.style.width = (cm.display.lineNumWidth || 1) + "px";
      }
    }
    gutters.style.display = i ? "" : "none";
    updateGutterSpace(cm);
  }

  function updateGutterSpace(cm) {
    var width = cm.display.gutters.offsetWidth;
    cm.display.sizer.style.marginLeft = width + "px";
  }

  // Compute the character length of a line, taking into account
  // collapsed ranges (see markText) that might hide parts, and join
  // other lines onto it.
  function lineLength(line) {
    if (line.height == 0) return 0;
    var len = line.text.length, merged, cur = line;
    while (merged = collapsedSpanAtStart(cur)) {
      var found = merged.find(0, true);
      cur = found.from.line;
      len += found.from.ch - found.to.ch;
    }
    cur = line;
    while (merged = collapsedSpanAtEnd(cur)) {
      var found = merged.find(0, true);
      len -= cur.text.length - found.from.ch;
      cur = found.to.line;
      len += cur.text.length - found.to.ch;
    }
    return len;
  }

  // Find the longest line in the document.
  function findMaxLine(cm) {
    var d = cm.display, doc = cm.doc;
    d.maxLine = getLine(doc, doc.first);
    d.maxLineLength = lineLength(d.maxLine);
    d.maxLineChanged = true;
    doc.iter(function(line) {
      var len = lineLength(line);
      if (len > d.maxLineLength) {
        d.maxLineLength = len;
        d.maxLine = line;
      }
    });
  }

  // Make sure the gutters options contains the element
  // "CodeMirror-linenumbers" when the lineNumbers option is true.
  function setGuttersForLineNumbers(options) {
    var found = indexOf(options.gutters, "CodeMirror-linenumbers");
    if (found == -1 && options.lineNumbers) {
      options.gutters = options.gutters.concat(["CodeMirror-linenumbers"]);
    } else if (found > -1 && !options.lineNumbers) {
      options.gutters = options.gutters.slice(0);
      options.gutters.splice(found, 1);
    }
  }

  // SCROLLBARS

  // Prepare DOM reads needed to update the scrollbars. Done in one
  // shot to minimize update/measure roundtrips.
  function measureForScrollbars(cm) {
    var d = cm.display, gutterW = d.gutters.offsetWidth;
    var docH = Math.round(cm.doc.height + paddingVert(cm.display));
    return {
      clientHeight: d.scroller.clientHeight,
      viewHeight: d.wrapper.clientHeight,
      scrollWidth: d.scroller.scrollWidth, clientWidth: d.scroller.clientWidth,
      viewWidth: d.wrapper.clientWidth,
      barLeft: cm.options.fixedGutter ? gutterW : 0,
      docHeight: docH,
      scrollHeight: docH + scrollGap(cm) + d.barHeight,
      nativeBarWidth: d.nativeBarWidth,
      gutterWidth: gutterW
    };
  }

  function NativeScrollbars(place, scroll, cm) {
    this.cm = cm;
    var vert = this.vert = elt("div", [elt("div", null, null, "min-width: 1px")], "CodeMirror-vscrollbar");
    var horiz = this.horiz = elt("div", [elt("div", null, null, "height: 100%; min-height: 1px")], "CodeMirror-hscrollbar");
    place(vert); place(horiz);

    on(vert, "scroll", function() {
      if (vert.clientHeight) scroll(vert.scrollTop, "vertical");
    });
    on(horiz, "scroll", function() {
      if (horiz.clientWidth) scroll(horiz.scrollLeft, "horizontal");
    });

    this.checkedOverlay = false;
    // Need to set a minimum width to see the scrollbar on IE7 (but must not set it on IE8).
    if (ie && ie_version < 8) this.horiz.style.minHeight = this.vert.style.minWidth = "18px";
  }

  NativeScrollbars.prototype = copyObj({
    update: function(measure) {
      var needsH = measure.scrollWidth > measure.clientWidth + 1;
      var needsV = measure.scrollHeight > measure.clientHeight + 1;
      var sWidth = measure.nativeBarWidth;

      if (needsV) {
        this.vert.style.display = "block";
        this.vert.style.bottom = needsH ? sWidth + "px" : "0";
        var totalHeight = measure.viewHeight - (needsH ? sWidth : 0);
        // A bug in IE8 can cause this value to be negative, so guard it.
        this.vert.firstChild.style.height =
          Math.max(0, measure.scrollHeight - measure.clientHeight + totalHeight) + "px";
      } else {
        this.vert.style.display = "";
        this.vert.firstChild.style.height = "0";
      }

      if (needsH) {
        this.horiz.style.display = "block";
        this.horiz.style.right = needsV ? sWidth + "px" : "0";
        this.horiz.style.left = measure.barLeft + "px";
        var totalWidth = measure.viewWidth - measure.barLeft - (needsV ? sWidth : 0);
        this.horiz.firstChild.style.width =
          (measure.scrollWidth - measure.clientWidth + totalWidth) + "px";
      } else {
        this.horiz.style.display = "";
        this.horiz.firstChild.style.width = "0";
      }

      if (!this.checkedOverlay && measure.clientHeight > 0) {
        if (sWidth == 0) this.overlayHack();
        this.checkedOverlay = true;
      }

      return {right: needsV ? sWidth : 0, bottom: needsH ? sWidth : 0};
    },
    setScrollLeft: function(pos) {
      if (this.horiz.scrollLeft != pos) this.horiz.scrollLeft = pos;
    },
    setScrollTop: function(pos) {
      if (this.vert.scrollTop != pos) this.vert.scrollTop = pos;
    },
    overlayHack: function() {
      var w = mac && !mac_geMountainLion ? "12px" : "18px";
      this.horiz.style.minHeight = this.vert.style.minWidth = w;
      var self = this;
      var barMouseDown = function(e) {
        if (e_target(e) != self.vert && e_target(e) != self.horiz)
          operation(self.cm, onMouseDown)(e);
      };
      on(this.vert, "mousedown", barMouseDown);
      on(this.horiz, "mousedown", barMouseDown);
    },
    clear: function() {
      var parent = this.horiz.parentNode;
      parent.removeChild(this.horiz);
      parent.removeChild(this.vert);
    }
  }, NativeScrollbars.prototype);

  function NullScrollbars() {}

  NullScrollbars.prototype = copyObj({
    update: function() { return {bottom: 0, right: 0}; },
    setScrollLeft: function() {},
    setScrollTop: function() {},
    clear: function() {}
  }, NullScrollbars.prototype);

  CodeMirror.scrollbarModel = {"native": NativeScrollbars, "null": NullScrollbars};

  function initScrollbars(cm) {
    if (cm.display.scrollbars) {
      cm.display.scrollbars.clear();
      if (cm.display.scrollbars.addClass)
        rmClass(cm.display.wrapper, cm.display.scrollbars.addClass);
    }

    cm.display.scrollbars = new CodeMirror.scrollbarModel[cm.options.scrollbarStyle](function(node) {
      cm.display.wrapper.insertBefore(node, cm.display.scrollbarFiller);
      // Prevent clicks in the scrollbars from killing focus
      on(node, "mousedown", function() {
        if (cm.state.focused) setTimeout(function() { cm.display.input.focus(); }, 0);
      });
      node.setAttribute("cm-not-content", "true");
    }, function(pos, axis) {
      if (axis == "horizontal") setScrollLeft(cm, pos);
      else setScrollTop(cm, pos);
    }, cm);
    if (cm.display.scrollbars.addClass)
      addClass(cm.display.wrapper, cm.display.scrollbars.addClass);
  }

  function updateScrollbars(cm, measure) {
    if (!measure) measure = measureForScrollbars(cm);
    var startWidth = cm.display.barWidth, startHeight = cm.display.barHeight;
    updateScrollbarsInner(cm, measure);
    for (var i = 0; i < 4 && startWidth != cm.display.barWidth || startHeight != cm.display.barHeight; i++) {
      if (startWidth != cm.display.barWidth && cm.options.lineWrapping)
        updateHeightsInViewport(cm);
      updateScrollbarsInner(cm, measureForScrollbars(cm));
      startWidth = cm.display.barWidth; startHeight = cm.display.barHeight;
    }
  }

  // Re-synchronize the fake scrollbars with the actual size of the
  // content.
  function updateScrollbarsInner(cm, measure) {
    var d = cm.display;
    var sizes = d.scrollbars.update(measure);

    d.sizer.style.paddingRight = (d.barWidth = sizes.right) + "px";
    d.sizer.style.paddingBottom = (d.barHeight = sizes.bottom) + "px";

    if (sizes.right && sizes.bottom) {
      d.scrollbarFiller.style.display = "block";
      d.scrollbarFiller.style.height = sizes.bottom + "px";
      d.scrollbarFiller.style.width = sizes.right + "px";
    } else d.scrollbarFiller.style.display = "";
    if (sizes.bottom && cm.options.coverGutterNextToScrollbar && cm.options.fixedGutter) {
      d.gutterFiller.style.display = "block";
      d.gutterFiller.style.height = sizes.bottom + "px";
      d.gutterFiller.style.width = measure.gutterWidth + "px";
    } else d.gutterFiller.style.display = "";
  }

  // Compute the lines that are visible in a given viewport (defaults
  // the the current scroll position). viewport may contain top,
  // height, and ensure (see op.scrollToPos) properties.
  function visibleLines(display, doc, viewport) {
    var top = viewport && viewport.top != null ? Math.max(0, viewport.top) : display.scroller.scrollTop;
    top = Math.floor(top - paddingTop(display));
    var bottom = viewport && viewport.bottom != null ? viewport.bottom : top + display.wrapper.clientHeight;

    var from = lineAtHeight(doc, top), to = lineAtHeight(doc, bottom);
    // Ensure is a {from: {line, ch}, to: {line, ch}} object, and
    // forces those lines into the viewport (if possible).
    if (viewport && viewport.ensure) {
      var ensureFrom = viewport.ensure.from.line, ensureTo = viewport.ensure.to.line;
      if (ensureFrom < from) {
        from = ensureFrom;
        to = lineAtHeight(doc, heightAtLine(getLine(doc, ensureFrom)) + display.wrapper.clientHeight);
      } else if (Math.min(ensureTo, doc.lastLine()) >= to) {
        from = lineAtHeight(doc, heightAtLine(getLine(doc, ensureTo)) - display.wrapper.clientHeight);
        to = ensureTo;
      }
    }
    return {from: from, to: Math.max(to, from + 1)};
  }

  // LINE NUMBERS

  // Re-align line numbers and gutter marks to compensate for
  // horizontal scrolling.
  function alignHorizontally(cm) {
    var display = cm.display, view = display.view;
    if (!display.alignWidgets && (!display.gutters.firstChild || !cm.options.fixedGutter)) return;
    var comp = compensateForHScroll(display) - display.scroller.scrollLeft + cm.doc.scrollLeft;
    var gutterW = display.gutters.offsetWidth, left = comp + "px";
    for (var i = 0; i < view.length; i++) if (!view[i].hidden) {
      if (cm.options.fixedGutter && view[i].gutter)
        view[i].gutter.style.left = left;
      var align = view[i].alignable;
      if (align) for (var j = 0; j < align.length; j++)
        align[j].style.left = left;
    }
    if (cm.options.fixedGutter)
      display.gutters.style.left = (comp + gutterW) + "px";
  }

  // Used to ensure that the line number gutter is still the right
  // size for the current document size. Returns true when an update
  // is needed.
  function maybeUpdateLineNumberWidth(cm) {
    if (!cm.options.lineNumbers) return false;
    var doc = cm.doc, last = lineNumberFor(cm.options, doc.first + doc.size - 1), display = cm.display;
    if (last.length != display.lineNumChars) {
      var test = display.measure.appendChild(elt("div", [elt("div", last)],
                                                 "CodeMirror-linenumber CodeMirror-gutter-elt"));
      var innerW = test.firstChild.offsetWidth, padding = test.offsetWidth - innerW;
      display.lineGutter.style.width = "";
      display.lineNumInnerWidth = Math.max(innerW, display.lineGutter.offsetWidth - padding) + 1;
      display.lineNumWidth = display.lineNumInnerWidth + padding;
      display.lineNumChars = display.lineNumInnerWidth ? last.length : -1;
      display.lineGutter.style.width = display.lineNumWidth + "px";
      updateGutterSpace(cm);
      return true;
    }
    return false;
  }

  function lineNumberFor(options, i) {
    return String(options.lineNumberFormatter(i + options.firstLineNumber));
  }

  // Computes display.scroller.scrollLeft + display.gutters.offsetWidth,
  // but using getBoundingClientRect to get a sub-pixel-accurate
  // result.
  function compensateForHScroll(display) {
    return display.scroller.getBoundingClientRect().left - display.sizer.getBoundingClientRect().left;
  }

  // DISPLAY DRAWING

  function DisplayUpdate(cm, viewport, force) {
    var display = cm.display;

    this.viewport = viewport;
    // Store some values that we'll need later (but don't want to force a relayout for)
    this.visible = visibleLines(display, cm.doc, viewport);
    this.editorIsHidden = !display.wrapper.offsetWidth;
    this.wrapperHeight = display.wrapper.clientHeight;
    this.wrapperWidth = display.wrapper.clientWidth;
    this.oldDisplayWidth = displayWidth(cm);
    this.force = force;
    this.dims = getDimensions(cm);
    this.events = [];
  }

  DisplayUpdate.prototype.signal = function(emitter, type) {
    if (hasHandler(emitter, type))
      this.events.push(arguments);
  };
  DisplayUpdate.prototype.finish = function() {
    for (var i = 0; i < this.events.length; i++)
      signal.apply(null, this.events[i]);
  };

  function maybeClipScrollbars(cm) {
    var display = cm.display;
    if (!display.scrollbarsClipped && display.scroller.offsetWidth) {
      display.nativeBarWidth = display.scroller.offsetWidth - display.scroller.clientWidth;
      display.heightForcer.style.height = scrollGap(cm) + "px";
      display.sizer.style.marginBottom = -display.nativeBarWidth + "px";
      display.sizer.style.borderRightWidth = scrollGap(cm) + "px";
      display.scrollbarsClipped = true;
    }
  }

  // Does the actual updating of the line display. Bails out
  // (returning false) when there is nothing to be done and forced is
  // false.
  function updateDisplayIfNeeded(cm, update) {
    var display = cm.display, doc = cm.doc;

    if (update.editorIsHidden) {
      resetView(cm);
      return false;
    }

    // Bail out if the visible area is already rendered and nothing changed.
    if (!update.force &&
        update.visible.from >= display.viewFrom && update.visible.to <= display.viewTo &&
        (display.updateLineNumbers == null || display.updateLineNumbers >= display.viewTo) &&
        display.renderedView == display.view && countDirtyView(cm) == 0)
      return false;

    if (maybeUpdateLineNumberWidth(cm)) {
      resetView(cm);
      update.dims = getDimensions(cm);
    }

    // Compute a suitable new viewport (from & to)
    var end = doc.first + doc.size;
    var from = Math.max(update.visible.from - cm.options.viewportMargin, doc.first);
    var to = Math.min(end, update.visible.to + cm.options.viewportMargin);
    if (display.viewFrom < from && from - display.viewFrom < 20) from = Math.max(doc.first, display.viewFrom);
    if (display.viewTo > to && display.viewTo - to < 20) to = Math.min(end, display.viewTo);
    if (sawCollapsedSpans) {
      from = visualLineNo(cm.doc, from);
      to = visualLineEndNo(cm.doc, to);
    }

    var different = from != display.viewFrom || to != display.viewTo ||
      display.lastWrapHeight != update.wrapperHeight || display.lastWrapWidth != update.wrapperWidth;
    adjustView(cm, from, to);

    display.viewOffset = heightAtLine(getLine(cm.doc, display.viewFrom));
    // Position the mover div to align with the current scroll position
    cm.display.mover.style.top = display.viewOffset + "px";

    var toUpdate = countDirtyView(cm);
    if (!different && toUpdate == 0 && !update.force && display.renderedView == display.view &&
        (display.updateLineNumbers == null || display.updateLineNumbers >= display.viewTo))
      return false;

    // For big changes, we hide the enclosing element during the
    // update, since that speeds up the operations on most browsers.
    var focused = activeElt();
    if (toUpdate > 4) display.lineDiv.style.display = "none";
    patchDisplay(cm, display.updateLineNumbers, update.dims);
    if (toUpdate > 4) display.lineDiv.style.display = "";
    display.renderedView = display.view;
    // There might have been a widget with a focused element that got
    // hidden or updated, if so re-focus it.
    if (focused && activeElt() != focused && focused.offsetHeight) focused.focus();

    // Prevent selection and cursors from interfering with the scroll
    // width and height.
    removeChildren(display.cursorDiv);
    removeChildren(display.selectionDiv);
    display.gutters.style.height = 0;

    if (different) {
      display.lastWrapHeight = update.wrapperHeight;
      display.lastWrapWidth = update.wrapperWidth;
      startWorker(cm, 400);
    }

    display.updateLineNumbers = null;

    return true;
  }

  function postUpdateDisplay(cm, update) {
    var viewport = update.viewport;
    for (var first = true;; first = false) {
      if (!first || !cm.options.lineWrapping || update.oldDisplayWidth == displayWidth(cm)) {
        // Clip forced viewport to actual scrollable area.
        if (viewport && viewport.top != null)
          viewport = {top: Math.min(cm.doc.height + paddingVert(cm.display) - displayHeight(cm), viewport.top)};
        // Updated line heights might result in the drawn area not
        // actually covering the viewport. Keep looping until it does.
        update.visible = visibleLines(cm.display, cm.doc, viewport);
        if (update.visible.from >= cm.display.viewFrom && update.visible.to <= cm.display.viewTo)
          break;
      }
      if (!updateDisplayIfNeeded(cm, update)) break;
      updateHeightsInViewport(cm);
      var barMeasure = measureForScrollbars(cm);
      updateSelection(cm);
      setDocumentHeight(cm, barMeasure);
      updateScrollbars(cm, barMeasure);
    }

    update.signal(cm, "update", cm);
    if (cm.display.viewFrom != cm.display.reportedViewFrom || cm.display.viewTo != cm.display.reportedViewTo) {
      update.signal(cm, "viewportChange", cm, cm.display.viewFrom, cm.display.viewTo);
      cm.display.reportedViewFrom = cm.display.viewFrom; cm.display.reportedViewTo = cm.display.viewTo;
    }
  }

  function updateDisplaySimple(cm, viewport) {
    var update = new DisplayUpdate(cm, viewport);
    if (updateDisplayIfNeeded(cm, update)) {
      updateHeightsInViewport(cm);
      postUpdateDisplay(cm, update);
      var barMeasure = measureForScrollbars(cm);
      updateSelection(cm);
      setDocumentHeight(cm, barMeasure);
      updateScrollbars(cm, barMeasure);
      update.finish();
    }
  }

  function setDocumentHeight(cm, measure) {
    cm.display.sizer.style.minHeight = measure.docHeight + "px";
    var total = measure.docHeight + cm.display.barHeight;
    cm.display.heightForcer.style.top = total + "px";
    cm.display.gutters.style.height = Math.max(total + scrollGap(cm), measure.clientHeight) + "px";
  }

  // Read the actual heights of the rendered lines, and update their
  // stored heights to match.
  function updateHeightsInViewport(cm) {
    var display = cm.display;
    var prevBottom = display.lineDiv.offsetTop;
    for (var i = 0; i < display.view.length; i++) {
      var cur = display.view[i], height;
      if (cur.hidden) continue;
      if (ie && ie_version < 8) {
        var bot = cur.node.offsetTop + cur.node.offsetHeight;
        height = bot - prevBottom;
        prevBottom = bot;
      } else {
        var box = cur.node.getBoundingClientRect();
        height = box.bottom - box.top;
      }
      var diff = cur.line.height - height;
      if (height < 2) height = textHeight(display);
      if (diff > .001 || diff < -.001) {
        updateLineHeight(cur.line, height);
        updateWidgetHeight(cur.line);
        if (cur.rest) for (var j = 0; j < cur.rest.length; j++)
          updateWidgetHeight(cur.rest[j]);
      }
    }
  }

  // Read and store the height of line widgets associated with the
  // given line.
  function updateWidgetHeight(line) {
    if (line.widgets) for (var i = 0; i < line.widgets.length; ++i)
      line.widgets[i].height = line.widgets[i].node.offsetHeight;
  }

  // Do a bulk-read of the DOM positions and sizes needed to draw the
  // view, so that we don't interleave reading and writing to the DOM.
  function getDimensions(cm) {
    var d = cm.display, left = {}, width = {};
    var gutterLeft = d.gutters.clientLeft;
    for (var n = d.gutters.firstChild, i = 0; n; n = n.nextSibling, ++i) {
      left[cm.options.gutters[i]] = n.offsetLeft + n.clientLeft + gutterLeft;
      width[cm.options.gutters[i]] = n.clientWidth;
    }
    return {fixedPos: compensateForHScroll(d),
            gutterTotalWidth: d.gutters.offsetWidth,
            gutterLeft: left,
            gutterWidth: width,
            wrapperWidth: d.wrapper.clientWidth};
  }

  // Sync the actual display DOM structure with display.view, removing
  // nodes for lines that are no longer in view, and creating the ones
  // that are not there yet, and updating the ones that are out of
  // date.
  function patchDisplay(cm, updateNumbersFrom, dims) {
    var display = cm.display, lineNumbers = cm.options.lineNumbers;
    var container = display.lineDiv, cur = container.firstChild;

    function rm(node) {
      var next = node.nextSibling;
      // Works around a throw-scroll bug in OS X Webkit
      if (webkit && mac && cm.display.currentWheelTarget == node)
        node.style.display = "none";
      else
        node.parentNode.removeChild(node);
      return next;
    }

    var view = display.view, lineN = display.viewFrom;
    // Loop over the elements in the view, syncing cur (the DOM nodes
    // in display.lineDiv) with the view as we go.
    for (var i = 0; i < view.length; i++) {
      var lineView = view[i];
      if (lineView.hidden) {
      } else if (!lineView.node || lineView.node.parentNode != container) { // Not drawn yet
        var node = buildLineElement(cm, lineView, lineN, dims);
        container.insertBefore(node, cur);
      } else { // Already drawn
        while (cur != lineView.node) cur = rm(cur);
        var updateNumber = lineNumbers && updateNumbersFrom != null &&
          updateNumbersFrom <= lineN && lineView.lineNumber;
        if (lineView.changes) {
          if (indexOf(lineView.changes, "gutter") > -1) updateNumber = false;
          updateLineForChanges(cm, lineView, lineN, dims);
        }
        if (updateNumber) {
          removeChildren(lineView.lineNumber);
          lineView.lineNumber.appendChild(document.createTextNode(lineNumberFor(cm.options, lineN)));
        }
        cur = lineView.node.nextSibling;
      }
      lineN += lineView.size;
    }
    while (cur) cur = rm(cur);
  }

  // When an aspect of a line changes, a string is added to
  // lineView.changes. This updates the relevant part of the line's
  // DOM structure.
  function updateLineForChanges(cm, lineView, lineN, dims) {
    for (var j = 0; j < lineView.changes.length; j++) {
      var type = lineView.changes[j];
      if (type == "text") updateLineText(cm, lineView);
      else if (type == "gutter") updateLineGutter(cm, lineView, lineN, dims);
      else if (type == "class") updateLineClasses(lineView);
      else if (type == "widget") updateLineWidgets(cm, lineView, dims);
    }
    lineView.changes = null;
  }

  // Lines with gutter elements, widgets or a background class need to
  // be wrapped, and have the extra elements added to the wrapper div
  function ensureLineWrapped(lineView) {
    if (lineView.node == lineView.text) {
      lineView.node = elt("div", null, null, "position: relative");
      if (lineView.text.parentNode)
        lineView.text.parentNode.replaceChild(lineView.node, lineView.text);
      lineView.node.appendChild(lineView.text);
      if (ie && ie_version < 8) lineView.node.style.zIndex = 2;
    }
    return lineView.node;
  }

  function updateLineBackground(lineView) {
    var cls = lineView.bgClass ? lineView.bgClass + " " + (lineView.line.bgClass || "") : lineView.line.bgClass;
    if (cls) cls += " CodeMirror-linebackground";
    if (lineView.background) {
      if (cls) lineView.background.className = cls;
      else { lineView.background.parentNode.removeChild(lineView.background); lineView.background = null; }
    } else if (cls) {
      var wrap = ensureLineWrapped(lineView);
      lineView.background = wrap.insertBefore(elt("div", null, cls), wrap.firstChild);
    }
  }

  // Wrapper around buildLineContent which will reuse the structure
  // in display.externalMeasured when possible.
  function getLineContent(cm, lineView) {
    var ext = cm.display.externalMeasured;
    if (ext && ext.line == lineView.line) {
      cm.display.externalMeasured = null;
      lineView.measure = ext.measure;
      return ext.built;
    }
    return buildLineContent(cm, lineView);
  }

  // Redraw the line's text. Interacts with the background and text
  // classes because the mode may output tokens that influence these
  // classes.
  function updateLineText(cm, lineView) {
    var cls = lineView.text.className;
    var built = getLineContent(cm, lineView);
    if (lineView.text == lineView.node) lineView.node = built.pre;
    lineView.text.parentNode.replaceChild(built.pre, lineView.text);
    lineView.text = built.pre;
    if (built.bgClass != lineView.bgClass || built.textClass != lineView.textClass) {
      lineView.bgClass = built.bgClass;
      lineView.textClass = built.textClass;
      updateLineClasses(lineView);
    } else if (cls) {
      lineView.text.className = cls;
    }
  }

  function updateLineClasses(lineView) {
    updateLineBackground(lineView);
    if (lineView.line.wrapClass)
      ensureLineWrapped(lineView).className = lineView.line.wrapClass;
    else if (lineView.node != lineView.text)
      lineView.node.className = "";
    var textClass = lineView.textClass ? lineView.textClass + " " + (lineView.line.textClass || "") : lineView.line.textClass;
    lineView.text.className = textClass || "";
  }

  function updateLineGutter(cm, lineView, lineN, dims) {
    if (lineView.gutter) {
      lineView.node.removeChild(lineView.gutter);
      lineView.gutter = null;
    }
    var markers = lineView.line.gutterMarkers;
    if (cm.options.lineNumbers || markers) {
      var wrap = ensureLineWrapped(lineView);
      var gutterWrap = lineView.gutter = elt("div", null, "CodeMirror-gutter-wrapper", "left: " +
                                             (cm.options.fixedGutter ? dims.fixedPos : -dims.gutterTotalWidth) +
                                             "px; width: " + dims.gutterTotalWidth + "px");
      cm.display.input.setUneditable(gutterWrap);
      wrap.insertBefore(gutterWrap, lineView.text);
      if (lineView.line.gutterClass)
        gutterWrap.className += " " + lineView.line.gutterClass;
      if (cm.options.lineNumbers && (!markers || !markers["CodeMirror-linenumbers"]))
        lineView.lineNumber = gutterWrap.appendChild(
          elt("div", lineNumberFor(cm.options, lineN),
              "CodeMirror-linenumber CodeMirror-gutter-elt",
              "left: " + dims.gutterLeft["CodeMirror-linenumbers"] + "px; width: "
              + cm.display.lineNumInnerWidth + "px"));
      if (markers) for (var k = 0; k < cm.options.gutters.length; ++k) {
        var id = cm.options.gutters[k], found = markers.hasOwnProperty(id) && markers[id];
        if (found)
          gutterWrap.appendChild(elt("div", [found], "CodeMirror-gutter-elt", "left: " +
                                     dims.gutterLeft[id] + "px; width: " + dims.gutterWidth[id] + "px"));
      }
    }
  }

  function updateLineWidgets(cm, lineView, dims) {
    if (lineView.alignable) lineView.alignable = null;
    for (var node = lineView.node.firstChild, next; node; node = next) {
      var next = node.nextSibling;
      if (node.className == "CodeMirror-linewidget")
        lineView.node.removeChild(node);
    }
    insertLineWidgets(cm, lineView, dims);
  }

  // Build a line's DOM representation from scratch
  function buildLineElement(cm, lineView, lineN, dims) {
    var built = getLineContent(cm, lineView);
    lineView.text = lineView.node = built.pre;
    if (built.bgClass) lineView.bgClass = built.bgClass;
    if (built.textClass) lineView.textClass = built.textClass;

    updateLineClasses(lineView);
    updateLineGutter(cm, lineView, lineN, dims);
    insertLineWidgets(cm, lineView, dims);
    return lineView.node;
  }

  // A lineView may contain multiple logical lines (when merged by
  // collapsed spans). The widgets for all of them need to be drawn.
  function insertLineWidgets(cm, lineView, dims) {
    insertLineWidgetsFor(cm, lineView.line, lineView, dims, true);
    if (lineView.rest) for (var i = 0; i < lineView.rest.length; i++)
      insertLineWidgetsFor(cm, lineView.rest[i], lineView, dims, false);
  }

  function insertLineWidgetsFor(cm, line, lineView, dims, allowAbove) {
    if (!line.widgets) return;
    var wrap = ensureLineWrapped(lineView);
    for (var i = 0, ws = line.widgets; i < ws.length; ++i) {
      var widget = ws[i], node = elt("div", [widget.node], "CodeMirror-linewidget");
      if (!widget.handleMouseEvents) node.setAttribute("cm-ignore-events", "true");
      positionLineWidget(widget, node, lineView, dims);
      cm.display.input.setUneditable(node);
      if (allowAbove && widget.above)
        wrap.insertBefore(node, lineView.gutter || lineView.text);
      else
        wrap.appendChild(node);
      signalLater(widget, "redraw");
    }
  }

  function positionLineWidget(widget, node, lineView, dims) {
    if (widget.noHScroll) {
      (lineView.alignable || (lineView.alignable = [])).push(node);
      var width = dims.wrapperWidth;
      node.style.left = dims.fixedPos + "px";
      if (!widget.coverGutter) {
        width -= dims.gutterTotalWidth;
        node.style.paddingLeft = dims.gutterTotalWidth + "px";
      }
      node.style.width = width + "px";
    }
    if (widget.coverGutter) {
      node.style.zIndex = 5;
      node.style.position = "relative";
      if (!widget.noHScroll) node.style.marginLeft = -dims.gutterTotalWidth + "px";
    }
  }

  // POSITION OBJECT

  // A Pos instance represents a position within the text.
  var Pos = CodeMirror.Pos = function(line, ch) {
    if (!(this instanceof Pos)) return new Pos(line, ch);
    this.line = line; this.ch = ch;
  };

  // Compare two positions, return 0 if they are the same, a negative
  // number when a is less, and a positive number otherwise.
  var cmp = CodeMirror.cmpPos = function(a, b) { return a.line - b.line || a.ch - b.ch; };

  function copyPos(x) {return Pos(x.line, x.ch);}
  function maxPos(a, b) { return cmp(a, b) < 0 ? b : a; }
  function minPos(a, b) { return cmp(a, b) < 0 ? a : b; }

  // INPUT HANDLING

  function ensureFocus(cm) {
    if (!cm.state.focused) { cm.display.input.focus(); onFocus(cm); }
  }

  function isReadOnly(cm) {
    return cm.options.readOnly || cm.doc.cantEdit;
  }

  // This will be set to an array of strings when copying, so that,
  // when pasting, we know what kind of selections the copied text
  // was made out of.
  var lastCopied = null;

  function applyTextInput(cm, inserted, deleted, sel, origin) {
    var doc = cm.doc;
    cm.display.shift = false;
    if (!sel) sel = doc.sel;

    var paste = cm.state.pasteIncoming || origin == "paste";
    var textLines = splitLines(inserted), multiPaste = null;
    // When pasing N lines into N selections, insert one line per selection
    if (paste && sel.ranges.length > 1) {
      if (lastCopied && lastCopied.join("\n") == inserted)
        multiPaste = sel.ranges.length % lastCopied.length == 0 && map(lastCopied, splitLines);
      else if (textLines.length == sel.ranges.length)
        multiPaste = map(textLines, function(l) { return [l]; });
    }

    // Normal behavior is to insert the new text into every selection
    for (var i = sel.ranges.length - 1; i >= 0; i--) {
      var range = sel.ranges[i];
      var from = range.from(), to = range.to();
      if (range.empty()) {
        if (deleted && deleted > 0) // Handle deletion
          from = Pos(from.line, from.ch - deleted);
        else if (cm.state.overwrite && !paste) // Handle overwrite
          to = Pos(to.line, Math.min(getLine(doc, to.line).text.length, to.ch + lst(textLines).length));
      }
      var updateInput = cm.curOp.updateInput;
      var changeEvent = {from: from, to: to, text: multiPaste ? multiPaste[i % multiPaste.length] : textLines,
                         origin: origin || (paste ? "paste" : cm.state.cutIncoming ? "cut" : "+input")};
      makeChange(cm.doc, changeEvent);
      signalLater(cm, "inputRead", cm, changeEvent);
    }
    if (inserted && !paste)
      triggerElectric(cm, inserted);

    ensureCursorVisible(cm);
    cm.curOp.updateInput = updateInput;
    cm.curOp.typing = true;
    cm.state.pasteIncoming = cm.state.cutIncoming = false;
  }

  function handlePaste(e, cm) {
    var pasted = e.clipboardData && e.clipboardData.getData("text/plain");
    if (pasted) {
      e.preventDefault();
      runInOp(cm, function() { applyTextInput(cm, pasted, 0, null, "paste"); });
      return true;
    }
  }

  function triggerElectric(cm, inserted) {
    // When an 'electric' character is inserted, immediately trigger a reindent
    if (!cm.options.electricChars || !cm.options.smartIndent) return;
    var sel = cm.doc.sel;

    for (var i = sel.ranges.length - 1; i >= 0; i--) {
      var range = sel.ranges[i];
      if (range.head.ch > 100 || (i && sel.ranges[i - 1].head.line == range.head.line)) continue;
      var mode = cm.getModeAt(range.head);
      var indented = false;
      if (mode.electricChars) {
        for (var j = 0; j < mode.electricChars.length; j++)
          if (inserted.indexOf(mode.electricChars.charAt(j)) > -1) {
            indented = indentLine(cm, range.head.line, "smart");
            break;
          }
      } else if (mode.electricInput) {
        if (mode.electricInput.test(getLine(cm.doc, range.head.line).text.slice(0, range.head.ch)))
          indented = indentLine(cm, range.head.line, "smart");
      }
      if (indented) signalLater(cm, "electricInput", cm, range.head.line);
    }
  }

  function copyableRanges(cm) {
    var text = [], ranges = [];
    for (var i = 0; i < cm.doc.sel.ranges.length; i++) {
      var line = cm.doc.sel.ranges[i].head.line;
      var lineRange = {anchor: Pos(line, 0), head: Pos(line + 1, 0)};
      ranges.push(lineRange);
      text.push(cm.getRange(lineRange.anchor, lineRange.head));
    }
    return {text: text, ranges: ranges};
  }

  function disableBrowserMagic(field) {
    field.setAttribute("autocorrect", "off");
    field.setAttribute("autocapitalize", "off");
    field.setAttribute("spellcheck", "false");
  }

  // TEXTAREA INPUT STYLE

  function TextareaInput(cm) {
    this.cm = cm;
    // See input.poll and input.reset
    this.prevInput = "";

    // Flag that indicates whether we expect input to appear real soon
    // now (after some event like 'keypress' or 'input') and are
    // polling intensively.
    this.pollingFast = false;
    // Self-resetting timeout for the poller
    this.polling = new Delayed();
    // Tracks when input.reset has punted to just putting a short
    // string into the textarea instead of the full selection.
    this.inaccurateSelection = false;
    // Used to work around IE issue with selection being forgotten when focus moves away from textarea
    this.hasSelection = false;
    this.composing = null;
  };

  function hiddenTextarea() {
    var te = elt("textarea", null, null, "position: absolute; padding: 0; width: 1px; height: 1em; outline: none");
    var div = elt("div", [te], null, "overflow: hidden; position: relative; width: 3px; height: 0px;");
    // The textarea is kept positioned near the cursor to prevent the
    // fact that it'll be scrolled into view on input from scrolling
    // our fake cursor out of view. On webkit, when wrap=off, paste is
    // very slow. So make the area wide instead.
    if (webkit) te.style.width = "1000px";
    else te.setAttribute("wrap", "off");
    // If border: 0; -- iOS fails to open keyboard (issue #1287)
    if (ios) te.style.border = "1px solid black";
    disableBrowserMagic(te);
    return div;
  }

  TextareaInput.prototype = copyObj({
    init: function(display) {
      var input = this, cm = this.cm;

      // Wraps and hides input textarea
      var div = this.wrapper = hiddenTextarea();
      // The semihidden textarea that is focused when the editor is
      // focused, and receives input.
      var te = this.textarea = div.firstChild;
      display.wrapper.insertBefore(div, display.wrapper.firstChild);

      // Needed to hide big blue blinking cursor on Mobile Safari (doesn't seem to work in iOS 8 anymore)
      if (ios) te.style.width = "0px";

      on(te, "input", function() {
        if (ie && ie_version >= 9 && input.hasSelection) input.hasSelection = null;
        input.poll();
      });

      on(te, "paste", function(e) {
        if (handlePaste(e, cm)) return true;

        cm.state.pasteIncoming = true;
        input.fastPoll();
      });

      function prepareCopyCut(e) {
        if (cm.somethingSelected()) {
          lastCopied = cm.getSelections();
          if (input.inaccurateSelection) {
            input.prevInput = "";
            input.inaccurateSelection = false;
            te.value = lastCopied.join("\n");
            selectInput(te);
          }
        } else if (!cm.options.lineWiseCopyCut) {
          return;
        } else {
          var ranges = copyableRanges(cm);
          lastCopied = ranges.text;
          if (e.type == "cut") {
            cm.setSelections(ranges.ranges, null, sel_dontScroll);
          } else {
            input.prevInput = "";
            te.value = ranges.text.join("\n");
            selectInput(te);
          }
        }
        if (e.type == "cut") cm.state.cutIncoming = true;
      }
      on(te, "cut", prepareCopyCut);
      on(te, "copy", prepareCopyCut);

      on(display.scroller, "paste", function(e) {
        if (eventInWidget(display, e)) return;
        cm.state.pasteIncoming = true;
        input.focus();
      });

      // Prevent normal selection in the editor (we handle our own)
      on(display.lineSpace, "selectstart", function(e) {
        if (!eventInWidget(display, e)) e_preventDefault(e);
      });

      on(te, "compositionstart", function() {
        var start = cm.getCursor("from");
        input.composing = {
          start: start,
          range: cm.markText(start, cm.getCursor("to"), {className: "CodeMirror-composing"})
        };
      });
      on(te, "compositionend", function() {
        if (input.composing) {
          input.poll();
          input.composing.range.clear();
          input.composing = null;
        }
      });
    },

    prepareSelection: function() {
      // Redraw the selection and/or cursor
      var cm = this.cm, display = cm.display, doc = cm.doc;
      var result = prepareSelection(cm);

      // Move the hidden textarea near the cursor to prevent scrolling artifacts
      if (cm.options.moveInputWithCursor) {
        var headPos = cursorCoords(cm, doc.sel.primary().head, "div");
        var wrapOff = display.wrapper.getBoundingClientRect(), lineOff = display.lineDiv.getBoundingClientRect();
        result.teTop = Math.max(0, Math.min(display.wrapper.clientHeight - 10,
                                            headPos.top + lineOff.top - wrapOff.top));
        result.teLeft = Math.max(0, Math.min(display.wrapper.clientWidth - 10,
                                             headPos.left + lineOff.left - wrapOff.left));
      }

      return result;
    },

    showSelection: function(drawn) {
      var cm = this.cm, display = cm.display;
      removeChildrenAndAdd(display.cursorDiv, drawn.cursors);
      removeChildrenAndAdd(display.selectionDiv, drawn.selection);
      if (drawn.teTop != null) {
        this.wrapper.style.top = drawn.teTop + "px";
        this.wrapper.style.left = drawn.teLeft + "px";
      }
    },

    // Reset the input to correspond to the selection (or to be empty,
    // when not typing and nothing is selected)
    reset: function(typing) {
      if (this.contextMenuPending) return;
      var minimal, selected, cm = this.cm, doc = cm.doc;
      if (cm.somethingSelected()) {
        this.prevInput = "";
        var range = doc.sel.primary();
        minimal = hasCopyEvent &&
          (range.to().line - range.from().line > 100 || (selected = cm.getSelection()).length > 1000);
        var content = minimal ? "-" : selected || cm.getSelection();
        this.textarea.value = content;
        if (cm.state.focused) selectInput(this.textarea);
        if (ie && ie_version >= 9) this.hasSelection = content;
      } else if (!typing) {
        this.prevInput = this.textarea.value = "";
        if (ie && ie_version >= 9) this.hasSelection = null;
      }
      this.inaccurateSelection = minimal;
    },

    getField: function() { return this.textarea; },

    supportsTouch: function() { return false; },

    focus: function() {
      if (this.cm.options.readOnly != "nocursor" && (!mobile || activeElt() != this.textarea)) {
        try { this.textarea.focus(); }
        catch (e) {} // IE8 will throw if the textarea is display: none or not in DOM
      }
    },

    blur: function() { this.textarea.blur(); },

    resetPosition: function() {
      this.wrapper.style.top = this.wrapper.style.left = 0;
    },

    receivedFocus: function() { this.slowPoll(); },

    // Poll for input changes, using the normal rate of polling. This
    // runs as long as the editor is focused.
    slowPoll: function() {
      var input = this;
      if (input.pollingFast) return;
      input.polling.set(this.cm.options.pollInterval, function() {
        input.poll();
        if (input.cm.state.focused) input.slowPoll();
      });
    },

    // When an event has just come in that is likely to add or change
    // something in the input textarea, we poll faster, to ensure that
    // the change appears on the screen quickly.
    fastPoll: function() {
      var missed = false, input = this;
      input.pollingFast = true;
      function p() {
        var changed = input.poll();
        if (!changed && !missed) {missed = true; input.polling.set(60, p);}
        else {input.pollingFast = false; input.slowPoll();}
      }
      input.polling.set(20, p);
    },

    // Read input from the textarea, and update the document to match.
    // When something is selected, it is present in the textarea, and
    // selected (unless it is huge, in which case a placeholder is
    // used). When nothing is selected, the cursor sits after previously
    // seen text (can be empty), which is stored in prevInput (we must
    // not reset the textarea when typing, because that breaks IME).
    poll: function() {
      var cm = this.cm, input = this.textarea, prevInput = this.prevInput;
      // Since this is called a *lot*, try to bail out as cheaply as
      // possible when it is clear that nothing happened. hasSelection
      // will be the case when there is a lot of text in the textarea,
      // in which case reading its value would be expensive.
      if (this.contextMenuPending || !cm.state.focused ||
          (hasSelection(input) && !prevInput) ||
          isReadOnly(cm) || cm.options.disableInput || cm.state.keySeq)
        return false;

      var text = input.value;
      // If nothing changed, bail.
      if (text == prevInput && !cm.somethingSelected()) return false;
      // Work around nonsensical selection resetting in IE9/10, and
      // inexplicable appearance of private area unicode characters on
      // some key combos in Mac (#2689).
      if (ie && ie_version >= 9 && this.hasSelection === text ||
          mac && /[\uf700-\uf7ff]/.test(text)) {
        cm.display.input.reset();
        return false;
      }

      if (cm.doc.sel == cm.display.selForContextMenu) {
        var first = text.charCodeAt(0);
        if (first == 0x200b && !prevInput) prevInput = "\u200b";
        if (first == 0x21da) { this.reset(); return this.cm.execCommand("undo"); }
      }
      // Find the part of the input that is actually new
      var same = 0, l = Math.min(prevInput.length, text.length);
      while (same < l && prevInput.charCodeAt(same) == text.charCodeAt(same)) ++same;

      var self = this;
      runInOp(cm, function() {
        applyTextInput(cm, text.slice(same), prevInput.length - same,
                       null, self.composing ? "*compose" : null);

        // Don't leave long text in the textarea, since it makes further polling slow
        if (text.length > 1000 || text.indexOf("\n") > -1) input.value = self.prevInput = "";
        else self.prevInput = text;

        if (self.composing) {
          self.composing.range.clear();
          self.composing.range = cm.markText(self.composing.start, cm.getCursor("to"),
                                             {className: "CodeMirror-composing"});
        }
      });
      return true;
    },

    ensurePolled: function() {
      if (this.pollingFast && this.poll()) this.pollingFast = false;
    },

    onKeyPress: function() {
      if (ie && ie_version >= 9) this.hasSelection = null;
      this.fastPoll();
    },

    onContextMenu: function(e) {
      var input = this, cm = input.cm, display = cm.display, te = input.textarea;
      var pos = posFromMouse(cm, e), scrollPos = display.scroller.scrollTop;
      if (!pos || presto) return; // Opera is difficult.

      // Reset the current text selection only if the click is done outside of the selection
      // and 'resetSelectionOnContextMenu' option is true.
      var reset = cm.options.resetSelectionOnContextMenu;
      if (reset && cm.doc.sel.contains(pos) == -1)
        operation(cm, setSelection)(cm.doc, simpleSelection(pos), sel_dontScroll);

      var oldCSS = te.style.cssText;
      input.wrapper.style.position = "absolute";
      te.style.cssText = "position: fixed; width: 30px; height: 30px; top: " + (e.clientY - 5) +
        "px; left: " + (e.clientX - 5) + "px; z-index: 1000; background: " +
        (ie ? "rgba(255, 255, 255, .05)" : "transparent") +
        "; outline: none; border-width: 0; outline: none; overflow: hidden; opacity: .05; filter: alpha(opacity=5);";
      if (webkit) var oldScrollY = window.scrollY; // Work around Chrome issue (#2712)
      display.input.focus();
      if (webkit) window.scrollTo(null, oldScrollY);
      display.input.reset();
      // Adds "Select all" to context menu in FF
      if (!cm.somethingSelected()) te.value = input.prevInput = " ";
      input.contextMenuPending = true;
      display.selForContextMenu = cm.doc.sel;
      clearTimeout(display.detectingSelectAll);

      // Select-all will be greyed out if there's nothing to select, so
      // this adds a zero-width space so that we can later check whether
      // it got selected.
      function prepareSelectAllHack() {
        if (te.selectionStart != null) {
          var selected = cm.somethingSelected();
          var extval = "\u200b" + (selected ? te.value : "");
          te.value = "\u21da"; // Used to catch context-menu undo
          te.value = extval;
          input.prevInput = selected ? "" : "\u200b";
          te.selectionStart = 1; te.selectionEnd = extval.length;
          // Re-set this, in case some other handler touched the
          // selection in the meantime.
          display.selForContextMenu = cm.doc.sel;
        }
      }
      function rehide() {
        input.contextMenuPending = false;
        input.wrapper.style.position = "relative";
        te.style.cssText = oldCSS;
        if (ie && ie_version < 9) display.scrollbars.setScrollTop(display.scroller.scrollTop = scrollPos);

        // Try to detect the user choosing select-all
        if (te.selectionStart != null) {
          if (!ie || (ie && ie_version < 9)) prepareSelectAllHack();
          var i = 0, poll = function() {
            if (display.selForContextMenu == cm.doc.sel && te.selectionStart == 0 &&
                te.selectionEnd > 0 && input.prevInput == "\u200b")
              operation(cm, commands.selectAll)(cm);
            else if (i++ < 10) display.detectingSelectAll = setTimeout(poll, 500);
            else display.input.reset();
          };
          display.detectingSelectAll = setTimeout(poll, 200);
        }
      }

      if (ie && ie_version >= 9) prepareSelectAllHack();
      if (captureRightClick) {
        e_stop(e);
        var mouseup = function() {
          off(window, "mouseup", mouseup);
          setTimeout(rehide, 20);
        };
        on(window, "mouseup", mouseup);
      } else {
        setTimeout(rehide, 50);
      }
    },

    setUneditable: nothing,

    needsContentAttribute: false
  }, TextareaInput.prototype);

  // CONTENTEDITABLE INPUT STYLE

  function ContentEditableInput(cm) {
    this.cm = cm;
    this.lastAnchorNode = this.lastAnchorOffset = this.lastFocusNode = this.lastFocusOffset = null;
    this.polling = new Delayed();
    this.gracePeriod = false;
  }

  ContentEditableInput.prototype = copyObj({
    init: function(display) {
      var input = this, cm = input.cm;
      var div = input.div = display.lineDiv;
      div.contentEditable = "true";
      disableBrowserMagic(div);

      on(div, "paste", function(e) { handlePaste(e, cm); })

      on(div, "compositionstart", function(e) {
        var data = e.data;
        input.composing = {sel: cm.doc.sel, data: data, startData: data};
        if (!data) return;
        var prim = cm.doc.sel.primary();
        var line = cm.getLine(prim.head.line);
        var found = line.indexOf(data, Math.max(0, prim.head.ch - data.length));
        if (found > -1 && found <= prim.head.ch)
          input.composing.sel = simpleSelection(Pos(prim.head.line, found),
                                                Pos(prim.head.line, found + data.length));
      });
      on(div, "compositionupdate", function(e) {
        input.composing.data = e.data;
      });
      on(div, "compositionend", function(e) {
        var ours = input.composing;
        if (!ours) return;
        if (e.data != ours.startData && !/\u200b/.test(e.data))
          ours.data = e.data;
        // Need a small delay to prevent other code (input event,
        // selection polling) from doing damage when fired right after
        // compositionend.
        setTimeout(function() {
          if (!ours.handled)
            input.applyComposition(ours);
          if (input.composing == ours)
            input.composing = null;
        }, 50);
      });

      on(div, "touchstart", function() {
        input.forceCompositionEnd();
      });

      on(div, "input", function() {
        if (input.composing) return;
        if (!input.pollContent())
          runInOp(input.cm, function() {regChange(cm);});
      });

      function onCopyCut(e) {
        if (cm.somethingSelected()) {
          lastCopied = cm.getSelections();
          if (e.type == "cut") cm.replaceSelection("", null, "cut");
        } else if (!cm.options.lineWiseCopyCut) {
          return;
        } else {
          var ranges = copyableRanges(cm);
          lastCopied = ranges.text;
          if (e.type == "cut") {
            cm.operation(function() {
              cm.setSelections(ranges.ranges, 0, sel_dontScroll);
              cm.replaceSelection("", null, "cut");
            });
          }
        }
        // iOS exposes the clipboard API, but seems to discard content inserted into it
        if (e.clipboardData && !ios) {
          e.preventDefault();
          e.clipboardData.clearData();
          e.clipboardData.setData("text/plain", lastCopied.join("\n"));
        } else {
          // Old-fashioned briefly-focus-a-textarea hack
          var kludge = hiddenTextarea(), te = kludge.firstChild;
          cm.display.lineSpace.insertBefore(kludge, cm.display.lineSpace.firstChild);
          te.value = lastCopied.join("\n");
          var hadFocus = document.activeElement;
          selectInput(te);
          setTimeout(function() {
            cm.display.lineSpace.removeChild(kludge);
            hadFocus.focus();
          }, 50);
        }
      }
      on(div, "copy", onCopyCut);
      on(div, "cut", onCopyCut);
    },

    prepareSelection: function() {
      var result = prepareSelection(this.cm, false);
      result.focus = this.cm.state.focused;
      return result;
    },

    showSelection: function(info) {
      if (!info || !this.cm.display.view.length) return;
      if (info.focus) this.showPrimarySelection();
      this.showMultipleSelections(info);
    },

    showPrimarySelection: function() {
      var sel = window.getSelection(), prim = this.cm.doc.sel.primary();
      var curAnchor = domToPos(this.cm, sel.anchorNode, sel.anchorOffset);
      var curFocus = domToPos(this.cm, sel.focusNode, sel.focusOffset);
      if (curAnchor && !curAnchor.bad && curFocus && !curFocus.bad &&
          cmp(minPos(curAnchor, curFocus), prim.from()) == 0 &&
          cmp(maxPos(curAnchor, curFocus), prim.to()) == 0)
        return;

      var start = posToDOM(this.cm, prim.from());
      var end = posToDOM(this.cm, prim.to());
      if (!start && !end) return;

      var view = this.cm.display.view;
      var old = sel.rangeCount && sel.getRangeAt(0);
      if (!start) {
        start = {node: view[0].measure.map[2], offset: 0};
      } else if (!end) { // FIXME dangerously hacky
        var measure = view[view.length - 1].measure;
        var map = measure.maps ? measure.maps[measure.maps.length - 1] : measure.map;
        end = {node: map[map.length - 1], offset: map[map.length - 2] - map[map.length - 3]};
      }

      try { var rng = range(start.node, start.offset, end.offset, end.node); }
      catch(e) {} // Our model of the DOM might be outdated, in which case the range we try to set can be impossible
      if (rng) {
        sel.removeAllRanges();
        sel.addRange(rng);
        if (old && sel.anchorNode == null) sel.addRange(old);
        else if (gecko) this.startGracePeriod();
      }
      this.rememberSelection();
    },

    startGracePeriod: function() {
      var input = this;
      clearTimeout(this.gracePeriod);
      this.gracePeriod = setTimeout(function() {
        input.gracePeriod = false;
        if (input.selectionChanged())
          input.cm.operation(function() { input.cm.curOp.selectionChanged = true; });
      }, 20);
    },

    showMultipleSelections: function(info) {
      removeChildrenAndAdd(this.cm.display.cursorDiv, info.cursors);
      removeChildrenAndAdd(this.cm.display.selectionDiv, info.selection);
    },

    rememberSelection: function() {
      var sel = window.getSelection();
      this.lastAnchorNode = sel.anchorNode; this.lastAnchorOffset = sel.anchorOffset;
      this.lastFocusNode = sel.focusNode; this.lastFocusOffset = sel.focusOffset;
    },

    selectionInEditor: function() {
      var sel = window.getSelection();
      if (!sel.rangeCount) return false;
      var node = sel.getRangeAt(0).commonAncestorContainer;
      return contains(this.div, node);
    },

    focus: function() {
      if (this.cm.options.readOnly != "nocursor") this.div.focus();
    },
    blur: function() { this.div.blur(); },
    getField: function() { return this.div; },

    supportsTouch: function() { return true; },

    receivedFocus: function() {
      var input = this;
      if (this.selectionInEditor())
        this.pollSelection();
      else
        runInOp(this.cm, function() { input.cm.curOp.selectionChanged = true; });

      function poll() {
        if (input.cm.state.focused) {
          input.pollSelection();
          input.polling.set(input.cm.options.pollInterval, poll);
        }
      }
      this.polling.set(this.cm.options.pollInterval, poll);
    },

    selectionChanged: function() {
      var sel = window.getSelection();
      return sel.anchorNode != this.lastAnchorNode || sel.anchorOffset != this.lastAnchorOffset ||
        sel.focusNode != this.lastFocusNode || sel.focusOffset != this.lastFocusOffset;
    },

    pollSelection: function() {
      if (!this.composing && !this.gracePeriod && this.selectionChanged()) {
        var sel = window.getSelection(), cm = this.cm;
        this.rememberSelection();
        var anchor = domToPos(cm, sel.anchorNode, sel.anchorOffset);
        var head = domToPos(cm, sel.focusNode, sel.focusOffset);
        if (anchor && head) runInOp(cm, function() {
          setSelection(cm.doc, simpleSelection(anchor, head), sel_dontScroll);
          if (anchor.bad || head.bad) cm.curOp.selectionChanged = true;
        });
      }
    },

    pollContent: function() {
      var cm = this.cm, display = cm.display, sel = cm.doc.sel.primary();
      var from = sel.from(), to = sel.to();
      if (from.line < display.viewFrom || to.line > display.viewTo - 1) return false;

      var fromIndex;
      if (from.line == display.viewFrom || (fromIndex = findViewIndex(cm, from.line)) == 0) {
        var fromLine = lineNo(display.view[0].line);
        var fromNode = display.view[0].node;
      } else {
        var fromLine = lineNo(display.view[fromIndex].line);
        var fromNode = display.view[fromIndex - 1].node.nextSibling;
      }
      var toIndex = findViewIndex(cm, to.line);
      if (toIndex == display.view.length - 1) {
        var toLine = display.viewTo - 1;
        var toNode = display.lineDiv.lastChild;
      } else {
        var toLine = lineNo(display.view[toIndex + 1].line) - 1;
        var toNode = display.view[toIndex + 1].node.previousSibling;
      }

      var newText = splitLines(domTextBetween(cm, fromNode, toNode, fromLine, toLine));
      var oldText = getBetween(cm.doc, Pos(fromLine, 0), Pos(toLine, getLine(cm.doc, toLine).text.length));
      while (newText.length > 1 && oldText.length > 1) {
        if (lst(newText) == lst(oldText)) { newText.pop(); oldText.pop(); toLine--; }
        else if (newText[0] == oldText[0]) { newText.shift(); oldText.shift(); fromLine++; }
        else break;
      }

      var cutFront = 0, cutEnd = 0;
      var newTop = newText[0], oldTop = oldText[0], maxCutFront = Math.min(newTop.length, oldTop.length);
      while (cutFront < maxCutFront && newTop.charCodeAt(cutFront) == oldTop.charCodeAt(cutFront))
        ++cutFront;
      var newBot = lst(newText), oldBot = lst(oldText);
      var maxCutEnd = Math.min(newBot.length - (newText.length == 1 ? cutFront : 0),
                               oldBot.length - (oldText.length == 1 ? cutFront : 0));
      while (cutEnd < maxCutEnd &&
             newBot.charCodeAt(newBot.length - cutEnd - 1) == oldBot.charCodeAt(oldBot.length - cutEnd - 1))
        ++cutEnd;

      newText[newText.length - 1] = newBot.slice(0, newBot.length - cutEnd);
      newText[0] = newText[0].slice(cutFront);

      var chFrom = Pos(fromLine, cutFront);
      var chTo = Pos(toLine, oldText.length ? lst(oldText).length - cutEnd : 0);
      if (newText.length > 1 || newText[0] || cmp(chFrom, chTo)) {
        replaceRange(cm.doc, newText, chFrom, chTo, "+input");
        return true;
      }
    },

    ensurePolled: function() {
      this.forceCompositionEnd();
    },
    reset: function() {
      this.forceCompositionEnd();
    },
    forceCompositionEnd: function() {
      if (!this.composing || this.composing.handled) return;
      this.applyComposition(this.composing);
      this.composing.handled = true;
      this.div.blur();
      this.div.focus();
    },
    applyComposition: function(composing) {
      if (composing.data && composing.data != composing.startData)
        operation(this.cm, applyTextInput)(this.cm, composing.data, 0, composing.sel);
    },

    setUneditable: function(node) {
      node.setAttribute("contenteditable", "false");
    },

    onKeyPress: function(e) {
      e.preventDefault();
      operation(this.cm, applyTextInput)(this.cm, String.fromCharCode(e.charCode == null ? e.keyCode : e.charCode), 0);
    },

    onContextMenu: nothing,
    resetPosition: nothing,

    needsContentAttribute: true
  }, ContentEditableInput.prototype);

  function posToDOM(cm, pos) {
    var view = findViewForLine(cm, pos.line);
    if (!view || view.hidden) return null;
    var line = getLine(cm.doc, pos.line);
    var info = mapFromLineView(view, line, pos.line);

    var order = getOrder(line), side = "left";
    if (order) {
      var partPos = getBidiPartAt(order, pos.ch);
      side = partPos % 2 ? "right" : "left";
    }
    var result = nodeAndOffsetInLineMap(info.map, pos.ch, side);
    result.offset = result.collapse == "right" ? result.end : result.start;
    return result;
  }

  function badPos(pos, bad) { if (bad) pos.bad = true; return pos; }

  function domToPos(cm, node, offset) {
    var lineNode;
    if (node == cm.display.lineDiv) {
      lineNode = cm.display.lineDiv.childNodes[offset];
      if (!lineNode) return badPos(cm.clipPos(Pos(cm.display.viewTo - 1)), true);
      node = null; offset = 0;
    } else {
      for (lineNode = node;; lineNode = lineNode.parentNode) {
        if (!lineNode || lineNode == cm.display.lineDiv) return null;
        if (lineNode.parentNode && lineNode.parentNode == cm.display.lineDiv) break;
      }
    }
    for (var i = 0; i < cm.display.view.length; i++) {
      var lineView = cm.display.view[i];
      if (lineView.node == lineNode)
        return locateNodeInLineView(lineView, node, offset);
    }
  }

  function locateNodeInLineView(lineView, node, offset) {
    var wrapper = lineView.text.firstChild, bad = false;
    if (!node || !contains(wrapper, node)) return badPos(Pos(lineNo(lineView.line), 0), true);
    if (node == wrapper) {
      bad = true;
      node = wrapper.childNodes[offset];
      offset = 0;
      if (!node) {
        var line = lineView.rest ? lst(lineView.rest) : lineView.line;
        return badPos(Pos(lineNo(line), line.text.length), bad);
      }
    }

    var textNode = node.nodeType == 3 ? node : null, topNode = node;
    if (!textNode && node.childNodes.length == 1 && node.firstChild.nodeType == 3) {
      textNode = node.firstChild;
      if (offset) offset = textNode.nodeValue.length;
    }
    while (topNode.parentNode != wrapper) topNode = topNode.parentNode;
    var measure = lineView.measure, maps = measure.maps;

    function find(textNode, topNode, offset) {
      for (var i = -1; i < (maps ? maps.length : 0); i++) {
        var map = i < 0 ? measure.map : maps[i];
        for (var j = 0; j < map.length; j += 3) {
          var curNode = map[j + 2];
          if (curNode == textNode || curNode == topNode) {
            var line = lineNo(i < 0 ? lineView.line : lineView.rest[i]);
            var ch = map[j] + offset;
            if (offset < 0 || curNode != textNode) ch = map[j + (offset ? 1 : 0)];
            return Pos(line, ch);
          }
        }
      }
    }
    var found = find(textNode, topNode, offset);
    if (found) return badPos(found, bad);

    // FIXME this is all really shaky. might handle the few cases it needs to handle, but likely to cause problems
    for (var after = topNode.nextSibling, dist = textNode ? textNode.nodeValue.length - offset : 0; after; after = after.nextSibling) {
      found = find(after, after.firstChild, 0);
      if (found)
        return badPos(Pos(found.line, found.ch - dist), bad);
      else
        dist += after.textContent.length;
    }
    for (var before = topNode.previousSibling, dist = offset; before; before = before.previousSibling) {
      found = find(before, before.firstChild, -1);
      if (found)
        return badPos(Pos(found.line, found.ch + dist), bad);
      else
        dist += after.textContent.length;
    }
  }

  function domTextBetween(cm, from, to, fromLine, toLine) {
    var text = "", closing = false;
    function recognizeMarker(id) { return function(marker) { return marker.id == id; }; }
    function walk(node) {
      if (node.nodeType == 1) {
        var cmText = node.getAttribute("cm-text");
        if (cmText != null) {
          if (cmText == "") cmText = node.textContent.replace(/\u200b/g, "");
          text += cmText;
          return;
        }
        var markerID = node.getAttribute("cm-marker"), range;
        if (markerID) {
          var found = cm.findMarks(Pos(fromLine, 0), Pos(toLine + 1, 0), recognizeMarker(+markerID));
          if (found.length && (range = found[0].find()))
            text += getBetween(cm.doc, range.from, range.to).join("\n");
          return;
        }
        if (node.getAttribute("contenteditable") == "false") return;
        for (var i = 0; i < node.childNodes.length; i++)
          walk(node.childNodes[i]);
        if (/^(pre|div|p)$/i.test(node.nodeName))
          closing = true;
      } else if (node.nodeType == 3) {
        var val = node.nodeValue;
        if (!val) return;
        if (closing) {
          text += "\n";
          closing = false;
        }
        text += val;
      }
    }
    for (;;) {
      walk(from);
      if (from == to) break;
      from = from.nextSibling;
    }
    return text;
  }

  CodeMirror.inputStyles = {"textarea": TextareaInput, "contenteditable": ContentEditableInput};

  // SELECTION / CURSOR

  // Selection objects are immutable. A new one is created every time
  // the selection changes. A selection is one or more non-overlapping
  // (and non-touching) ranges, sorted, and an integer that indicates
  // which one is the primary selection (the one that's scrolled into
  // view, that getCursor returns, etc).
  function Selection(ranges, primIndex) {
    this.ranges = ranges;
    this.primIndex = primIndex;
  }

  Selection.prototype = {
    primary: function() { return this.ranges[this.primIndex]; },
    equals: function(other) {
      if (other == this) return true;
      if (other.primIndex != this.primIndex || other.ranges.length != this.ranges.length) return false;
      for (var i = 0; i < this.ranges.length; i++) {
        var here = this.ranges[i], there = other.ranges[i];
        if (cmp(here.anchor, there.anchor) != 0 || cmp(here.head, there.head) != 0) return false;
      }
      return true;
    },
    deepCopy: function() {
      for (var out = [], i = 0; i < this.ranges.length; i++)
        out[i] = new Range(copyPos(this.ranges[i].anchor), copyPos(this.ranges[i].head));
      return new Selection(out, this.primIndex);
    },
    somethingSelected: function() {
      for (var i = 0; i < this.ranges.length; i++)
        if (!this.ranges[i].empty()) return true;
      return false;
    },
    contains: function(pos, end) {
      if (!end) end = pos;
      for (var i = 0; i < this.ranges.length; i++) {
        var range = this.ranges[i];
        if (cmp(end, range.from()) >= 0 && cmp(pos, range.to()) <= 0)
          return i;
      }
      return -1;
    }
  };

  function Range(anchor, head) {
    this.anchor = anchor; this.head = head;
  }

  Range.prototype = {
    from: function() { return minPos(this.anchor, this.head); },
    to: function() { return maxPos(this.anchor, this.head); },
    empty: function() {
      return this.head.line == this.anchor.line && this.head.ch == this.anchor.ch;
    }
  };

  // Take an unsorted, potentially overlapping set of ranges, and
  // build a selection out of it. 'Consumes' ranges array (modifying
  // it).
  function normalizeSelection(ranges, primIndex) {
    var prim = ranges[primIndex];
    ranges.sort(function(a, b) { return cmp(a.from(), b.from()); });
    primIndex = indexOf(ranges, prim);
    for (var i = 1; i < ranges.length; i++) {
      var cur = ranges[i], prev = ranges[i - 1];
      if (cmp(prev.to(), cur.from()) >= 0) {
        var from = minPos(prev.from(), cur.from()), to = maxPos(prev.to(), cur.to());
        var inv = prev.empty() ? cur.from() == cur.head : prev.from() == prev.head;
        if (i <= primIndex) --primIndex;
        ranges.splice(--i, 2, new Range(inv ? to : from, inv ? from : to));
      }
    }
    return new Selection(ranges, primIndex);
  }

  function simpleSelection(anchor, head) {
    return new Selection([new Range(anchor, head || anchor)], 0);
  }

  // Most of the external API clips given positions to make sure they
  // actually exist within the document.
  function clipLine(doc, n) {return Math.max(doc.first, Math.min(n, doc.first + doc.size - 1));}
  function clipPos(doc, pos) {
    if (pos.line < doc.first) return Pos(doc.first, 0);
    var last = doc.first + doc.size - 1;
    if (pos.line > last) return Pos(last, getLine(doc, last).text.length);
    return clipToLen(pos, getLine(doc, pos.line).text.length);
  }
  function clipToLen(pos, linelen) {
    var ch = pos.ch;
    if (ch == null || ch > linelen) return Pos(pos.line, linelen);
    else if (ch < 0) return Pos(pos.line, 0);
    else return pos;
  }
  function isLine(doc, l) {return l >= doc.first && l < doc.first + doc.size;}
  function clipPosArray(doc, array) {
    for (var out = [], i = 0; i < array.length; i++) out[i] = clipPos(doc, array[i]);
    return out;
  }

  // SELECTION UPDATES

  // The 'scroll' parameter given to many of these indicated whether
  // the new cursor position should be scrolled into view after
  // modifying the selection.

  // If shift is held or the extend flag is set, extends a range to
  // include a given position (and optionally a second position).
  // Otherwise, simply returns the range between the given positions.
  // Used for cursor motion and such.
  function extendRange(doc, range, head, other) {
    if (doc.cm && doc.cm.display.shift || doc.extend) {
      var anchor = range.anchor;
      if (other) {
        var posBefore = cmp(head, anchor) < 0;
        if (posBefore != (cmp(other, anchor) < 0)) {
          anchor = head;
          head = other;
        } else if (posBefore != (cmp(head, other) < 0)) {
          head = other;
        }
      }
      return new Range(anchor, head);
    } else {
      return new Range(other || head, head);
    }
  }

  // Extend the primary selection range, discard the rest.
  function extendSelection(doc, head, other, options) {
    setSelection(doc, new Selection([extendRange(doc, doc.sel.primary(), head, other)], 0), options);
  }

  // Extend all selections (pos is an array of selections with length
  // equal the number of selections)
  function extendSelections(doc, heads, options) {
    for (var out = [], i = 0; i < doc.sel.ranges.length; i++)
      out[i] = extendRange(doc, doc.sel.ranges[i], heads[i], null);
    var newSel = normalizeSelection(out, doc.sel.primIndex);
    setSelection(doc, newSel, options);
  }

  // Updates a single range in the selection.
  function replaceOneSelection(doc, i, range, options) {
    var ranges = doc.sel.ranges.slice(0);
    ranges[i] = range;
    setSelection(doc, normalizeSelection(ranges, doc.sel.primIndex), options);
  }

  // Reset the selection to a single range.
  function setSimpleSelection(doc, anchor, head, options) {
    setSelection(doc, simpleSelection(anchor, head), options);
  }

  // Give beforeSelectionChange handlers a change to influence a
  // selection update.
  function filterSelectionChange(doc, sel) {
    var obj = {
      ranges: sel.ranges,
      update: function(ranges) {
        this.ranges = [];
        for (var i = 0; i < ranges.length; i++)
          this.ranges[i] = new Range(clipPos(doc, ranges[i].anchor),
                                     clipPos(doc, ranges[i].head));
      }
    };
    signal(doc, "beforeSelectionChange", doc, obj);
    if (doc.cm) signal(doc.cm, "beforeSelectionChange", doc.cm, obj);
    if (obj.ranges != sel.ranges) return normalizeSelection(obj.ranges, obj.ranges.length - 1);
    else return sel;
  }

  function setSelectionReplaceHistory(doc, sel, options) {
    var done = doc.history.done, last = lst(done);
    if (last && last.ranges) {
      done[done.length - 1] = sel;
      setSelectionNoUndo(doc, sel, options);
    } else {
      setSelection(doc, sel, options);
    }
  }

  // Set a new selection.
  function setSelection(doc, sel, options) {
    setSelectionNoUndo(doc, sel, options);
    addSelectionToHistory(doc, doc.sel, doc.cm ? doc.cm.curOp.id : NaN, options);
  }

  function setSelectionNoUndo(doc, sel, options) {
    if (hasHandler(doc, "beforeSelectionChange") || doc.cm && hasHandler(doc.cm, "beforeSelectionChange"))
      sel = filterSelectionChange(doc, sel);

    var bias = options && options.bias ||
      (cmp(sel.primary().head, doc.sel.primary().head) < 0 ? -1 : 1);
    setSelectionInner(doc, skipAtomicInSelection(doc, sel, bias, true));

    if (!(options && options.scroll === false) && doc.cm)
      ensureCursorVisible(doc.cm);
  }

  function setSelectionInner(doc, sel) {
    if (sel.equals(doc.sel)) return;

    doc.sel = sel;

    if (doc.cm) {
      doc.cm.curOp.updateInput = doc.cm.curOp.selectionChanged = true;
      signalCursorActivity(doc.cm);
    }
    signalLater(doc, "cursorActivity", doc);
  }

  // Verify that the selection does not partially select any atomic
  // marked ranges.
  function reCheckSelection(doc) {
    setSelectionInner(doc, skipAtomicInSelection(doc, doc.sel, null, false), sel_dontScroll);
  }

  // Return a selection that does not partially select any atomic
  // ranges.
  function skipAtomicInSelection(doc, sel, bias, mayClear) {
    var out;
    for (var i = 0; i < sel.ranges.length; i++) {
      var range = sel.ranges[i];
      var newAnchor = skipAtomic(doc, range.anchor, bias, mayClear);
      var newHead = skipAtomic(doc, range.head, bias, mayClear);
      if (out || newAnchor != range.anchor || newHead != range.head) {
        if (!out) out = sel.ranges.slice(0, i);
        out[i] = new Range(newAnchor, newHead);
      }
    }
    return out ? normalizeSelection(out, sel.primIndex) : sel;
  }

  // Ensure a given position is not inside an atomic range.
  function skipAtomic(doc, pos, bias, mayClear) {
    var flipped = false, curPos = pos;
    var dir = bias || 1;
    doc.cantEdit = false;
    search: for (;;) {
      var line = getLine(doc, curPos.line);
      if (line.markedSpans) {
        for (var i = 0; i < line.markedSpans.length; ++i) {
          var sp = line.markedSpans[i], m = sp.marker;
          if ((sp.from == null || (m.inclusiveLeft ? sp.from <= curPos.ch : sp.from < curPos.ch)) &&
              (sp.to == null || (m.inclusiveRight ? sp.to >= curPos.ch : sp.to > curPos.ch))) {
            if (mayClear) {
              signal(m, "beforeCursorEnter");
              if (m.explicitlyCleared) {
                if (!line.markedSpans) break;
                else {--i; continue;}
              }
            }
            if (!m.atomic) continue;
            var newPos = m.find(dir < 0 ? -1 : 1);
            if (cmp(newPos, curPos) == 0) {
              newPos.ch += dir;
              if (newPos.ch < 0) {
                if (newPos.line > doc.first) newPos = clipPos(doc, Pos(newPos.line - 1));
                else newPos = null;
              } else if (newPos.ch > line.text.length) {
                if (newPos.line < doc.first + doc.size - 1) newPos = Pos(newPos.line + 1, 0);
                else newPos = null;
              }
              if (!newPos) {
                if (flipped) {
                  // Driven in a corner -- no valid cursor position found at all
                  // -- try again *with* clearing, if we didn't already
                  if (!mayClear) return skipAtomic(doc, pos, bias, true);
                  // Otherwise, turn off editing until further notice, and return the start of the doc
                  doc.cantEdit = true;
                  return Pos(doc.first, 0);
                }
                flipped = true; newPos = pos; dir = -dir;
              }
            }
            curPos = newPos;
            continue search;
          }
        }
      }
      return curPos;
    }
  }

  // SELECTION DRAWING

  function updateSelection(cm) {
    cm.display.input.showSelection(cm.display.input.prepareSelection());
  }

  function prepareSelection(cm, primary) {
    var doc = cm.doc, result = {};
    var curFragment = result.cursors = document.createDocumentFragment();
    var selFragment = result.selection = document.createDocumentFragment();

    for (var i = 0; i < doc.sel.ranges.length; i++) {
      if (primary === false && i == doc.sel.primIndex) continue;
      var range = doc.sel.ranges[i];
      var collapsed = range.empty();
      if (collapsed || cm.options.showCursorWhenSelecting)
        drawSelectionCursor(cm, range, curFragment);
      if (!collapsed)
        drawSelectionRange(cm, range, selFragment);
    }
    return result;
  }

  // Draws a cursor for the given range
  function drawSelectionCursor(cm, range, output) {
    var pos = cursorCoords(cm, range.head, "div", null, null, !cm.options.singleCursorHeightPerLine);

    var cursor = output.appendChild(elt("div", "\u00a0", "CodeMirror-cursor"));
    cursor.style.left = pos.left + "px";
    cursor.style.top = pos.top + "px";
    cursor.style.height = Math.max(0, pos.bottom - pos.top) * cm.options.cursorHeight + "px";

    if (pos.other) {
      // Secondary cursor, shown when on a 'jump' in bi-directional text
      var otherCursor = output.appendChild(elt("div", "\u00a0", "CodeMirror-cursor CodeMirror-secondarycursor"));
      otherCursor.style.display = "";
      otherCursor.style.left = pos.other.left + "px";
      otherCursor.style.top = pos.other.top + "px";
      otherCursor.style.height = (pos.other.bottom - pos.other.top) * .85 + "px";
    }
  }

  // Draws the given range as a highlighted selection
  function drawSelectionRange(cm, range, output) {
    var display = cm.display, doc = cm.doc;
    var fragment = document.createDocumentFragment();
    var padding = paddingH(cm.display), leftSide = padding.left;
    var rightSide = Math.max(display.sizerWidth, displayWidth(cm) - display.sizer.offsetLeft) - padding.right;

    function add(left, top, width, bottom) {
      if (top < 0) top = 0;
      top = Math.round(top);
      bottom = Math.round(bottom);
      fragment.appendChild(elt("div", null, "CodeMirror-selected", "position: absolute; left: " + left +
                               "px; top: " + top + "px; width: " + (width == null ? rightSide - left : width) +
                               "px; height: " + (bottom - top) + "px"));
    }

    function drawForLine(line, fromArg, toArg) {
      var lineObj = getLine(doc, line);
      var lineLen = lineObj.text.length;
      var start, end;
      function coords(ch, bias) {
        return charCoords(cm, Pos(line, ch), "div", lineObj, bias);
      }

      iterateBidiSections(getOrder(lineObj), fromArg || 0, toArg == null ? lineLen : toArg, function(from, to, dir) {
        var leftPos = coords(from, "left"), rightPos, left, right;
        if (from == to) {
          rightPos = leftPos;
          left = right = leftPos.left;
        } else {
          rightPos = coords(to - 1, "right");
          if (dir == "rtl") { var tmp = leftPos; leftPos = rightPos; rightPos = tmp; }
          left = leftPos.left;
          right = rightPos.right;
        }
        if (fromArg == null && from == 0) left = leftSide;
        if (rightPos.top - leftPos.top > 3) { // Different lines, draw top part
          add(left, leftPos.top, null, leftPos.bottom);
          left = leftSide;
          if (leftPos.bottom < rightPos.top) add(left, leftPos.bottom, null, rightPos.top);
        }
        if (toArg == null && to == lineLen) right = rightSide;
        if (!start || leftPos.top < start.top || leftPos.top == start.top && leftPos.left < start.left)
          start = leftPos;
        if (!end || rightPos.bottom > end.bottom || rightPos.bottom == end.bottom && rightPos.right > end.right)
          end = rightPos;
        if (left < leftSide + 1) left = leftSide;
        add(left, rightPos.top, right - left, rightPos.bottom);
      });
      return {start: start, end: end};
    }

    var sFrom = range.from(), sTo = range.to();
    if (sFrom.line == sTo.line) {
      drawForLine(sFrom.line, sFrom.ch, sTo.ch);
    } else {
      var fromLine = getLine(doc, sFrom.line), toLine = getLine(doc, sTo.line);
      var singleVLine = visualLine(fromLine) == visualLine(toLine);
      var leftEnd = drawForLine(sFrom.line, sFrom.ch, singleVLine ? fromLine.text.length + 1 : null).end;
      var rightStart = drawForLine(sTo.line, singleVLine ? 0 : null, sTo.ch).start;
      if (singleVLine) {
        if (leftEnd.top < rightStart.top - 2) {
          add(leftEnd.right, leftEnd.top, null, leftEnd.bottom);
          add(leftSide, rightStart.top, rightStart.left, rightStart.bottom);
        } else {
          add(leftEnd.right, leftEnd.top, rightStart.left - leftEnd.right, leftEnd.bottom);
        }
      }
      if (leftEnd.bottom < rightStart.top)
        add(leftSide, leftEnd.bottom, null, rightStart.top);
    }

    output.appendChild(fragment);
  }

  // Cursor-blinking
  function restartBlink(cm) {
    if (!cm.state.focused) return;
    var display = cm.display;
    clearInterval(display.blinker);
    var on = true;
    display.cursorDiv.style.visibility = "";
    if (cm.options.cursorBlinkRate > 0)
      display.blinker = setInterval(function() {
        display.cursorDiv.style.visibility = (on = !on) ? "" : "hidden";
      }, cm.options.cursorBlinkRate);
    else if (cm.options.cursorBlinkRate < 0)
      display.cursorDiv.style.visibility = "hidden";
  }

  // HIGHLIGHT WORKER

  function startWorker(cm, time) {
    if (cm.doc.mode.startState && cm.doc.frontier < cm.display.viewTo)
      cm.state.highlight.set(time, bind(highlightWorker, cm));
  }

  function highlightWorker(cm) {
    var doc = cm.doc;
    if (doc.frontier < doc.first) doc.frontier = doc.first;
    if (doc.frontier >= cm.display.viewTo) return;
    var end = +new Date + cm.options.workTime;
    var state = copyState(doc.mode, getStateBefore(cm, doc.frontier));
    var changedLines = [];

    doc.iter(doc.frontier, Math.min(doc.first + doc.size, cm.display.viewTo + 500), function(line) {
      if (doc.frontier >= cm.display.viewFrom) { // Visible
        var oldStyles = line.styles;
        var highlighted = highlightLine(cm, line, state, true);
        line.styles = highlighted.styles;
        var oldCls = line.styleClasses, newCls = highlighted.classes;
        if (newCls) line.styleClasses = newCls;
        else if (oldCls) line.styleClasses = null;
        var ischange = !oldStyles || oldStyles.length != line.styles.length ||
          oldCls != newCls && (!oldCls || !newCls || oldCls.bgClass != newCls.bgClass || oldCls.textClass != newCls.textClass);
        for (var i = 0; !ischange && i < oldStyles.length; ++i) ischange = oldStyles[i] != line.styles[i];
        if (ischange) changedLines.push(doc.frontier);
        line.stateAfter = copyState(doc.mode, state);
      } else {
        processLine(cm, line.text, state);
        line.stateAfter = doc.frontier % 5 == 0 ? copyState(doc.mode, state) : null;
      }
      ++doc.frontier;
      if (+new Date > end) {
        startWorker(cm, cm.options.workDelay);
        return true;
      }
    });
    if (changedLines.length) runInOp(cm, function() {
      for (var i = 0; i < changedLines.length; i++)
        regLineChange(cm, changedLines[i], "text");
    });
  }

  // Finds the line to start with when starting a parse. Tries to
  // find a line with a stateAfter, so that it can start with a
  // valid state. If that fails, it returns the line with the
  // smallest indentation, which tends to need the least context to
  // parse correctly.
  function findStartLine(cm, n, precise) {
    var minindent, minline, doc = cm.doc;
    var lim = precise ? -1 : n - (cm.doc.mode.innerMode ? 1000 : 100);
    for (var search = n; search > lim; --search) {
      if (search <= doc.first) return doc.first;
      var line = getLine(doc, search - 1);
      if (line.stateAfter && (!precise || search <= doc.frontier)) return search;
      var indented = countColumn(line.text, null, cm.options.tabSize);
      if (minline == null || minindent > indented) {
        minline = search - 1;
        minindent = indented;
      }
    }
    return minline;
  }

  function getStateBefore(cm, n, precise) {
    var doc = cm.doc, display = cm.display;
    if (!doc.mode.startState) return true;
    var pos = findStartLine(cm, n, precise), state = pos > doc.first && getLine(doc, pos-1).stateAfter;
    if (!state) state = startState(doc.mode);
    else state = copyState(doc.mode, state);
    doc.iter(pos, n, function(line) {
      processLine(cm, line.text, state);
      var save = pos == n - 1 || pos % 5 == 0 || pos >= display.viewFrom && pos < display.viewTo;
      line.stateAfter = save ? copyState(doc.mode, state) : null;
      ++pos;
    });
    if (precise) doc.frontier = pos;
    return state;
  }

  // POSITION MEASUREMENT

  function paddingTop(display) {return display.lineSpace.offsetTop;}
  function paddingVert(display) {return display.mover.offsetHeight - display.lineSpace.offsetHeight;}
  function paddingH(display) {
    if (display.cachedPaddingH) return display.cachedPaddingH;
    var e = removeChildrenAndAdd(display.measure, elt("pre", "x"));
    var style = window.getComputedStyle ? window.getComputedStyle(e) : e.currentStyle;
    var data = {left: parseInt(style.paddingLeft), right: parseInt(style.paddingRight)};
    if (!isNaN(data.left) && !isNaN(data.right)) display.cachedPaddingH = data;
    return data;
  }

  function scrollGap(cm) { return scrollerGap - cm.display.nativeBarWidth; }
  function displayWidth(cm) {
    return cm.display.scroller.clientWidth - scrollGap(cm) - cm.display.barWidth;
  }
  function displayHeight(cm) {
    return cm.display.scroller.clientHeight - scrollGap(cm) - cm.display.barHeight;
  }

  // Ensure the lineView.wrapping.heights array is populated. This is
  // an array of bottom offsets for the lines that make up a drawn
  // line. When lineWrapping is on, there might be more than one
  // height.
  function ensureLineHeights(cm, lineView, rect) {
    var wrapping = cm.options.lineWrapping;
    var curWidth = wrapping && displayWidth(cm);
    if (!lineView.measure.heights || wrapping && lineView.measure.width != curWidth) {
      var heights = lineView.measure.heights = [];
      if (wrapping) {
        lineView.measure.width = curWidth;
        var rects = lineView.text.firstChild.getClientRects();
        for (var i = 0; i < rects.length - 1; i++) {
          var cur = rects[i], next = rects[i + 1];
          if (Math.abs(cur.bottom - next.bottom) > 2)
            heights.push((cur.bottom + next.top) / 2 - rect.top);
        }
      }
      heights.push(rect.bottom - rect.top);
    }
  }

  // Find a line map (mapping character offsets to text nodes) and a
  // measurement cache for the given line number. (A line view might
  // contain multiple lines when collapsed ranges are present.)
  function mapFromLineView(lineView, line, lineN) {
    if (lineView.line == line)
      return {map: lineView.measure.map, cache: lineView.measure.cache};
    for (var i = 0; i < lineView.rest.length; i++)
      if (lineView.rest[i] == line)
        return {map: lineView.measure.maps[i], cache: lineView.measure.caches[i]};
    for (var i = 0; i < lineView.rest.length; i++)
      if (lineNo(lineView.rest[i]) > lineN)
        return {map: lineView.measure.maps[i], cache: lineView.measure.caches[i], before: true};
  }

  // Render a line into the hidden node display.externalMeasured. Used
  // when measurement is needed for a line that's not in the viewport.
  function updateExternalMeasurement(cm, line) {
    line = visualLine(line);
    var lineN = lineNo(line);
    var view = cm.display.externalMeasured = new LineView(cm.doc, line, lineN);
    view.lineN = lineN;
    var built = view.built = buildLineContent(cm, view);
    view.text = built.pre;
    removeChildrenAndAdd(cm.display.lineMeasure, built.pre);
    return view;
  }

  // Get a {top, bottom, left, right} box (in line-local coordinates)
  // for a given character.
  function measureChar(cm, line, ch, bias) {
    return measureCharPrepared(cm, prepareMeasureForLine(cm, line), ch, bias);
  }

  // Find a line view that corresponds to the given line number.
  function findViewForLine(cm, lineN) {
    if (lineN >= cm.display.viewFrom && lineN < cm.display.viewTo)
      return cm.display.view[findViewIndex(cm, lineN)];
    var ext = cm.display.externalMeasured;
    if (ext && lineN >= ext.lineN && lineN < ext.lineN + ext.size)
      return ext;
  }

  // Measurement can be split in two steps, the set-up work that
  // applies to the whole line, and the measurement of the actual
  // character. Functions like coordsChar, that need to do a lot of
  // measurements in a row, can thus ensure that the set-up work is
  // only done once.
  function prepareMeasureForLine(cm, line) {
    var lineN = lineNo(line);
    var view = findViewForLine(cm, lineN);
    if (view && !view.text)
      view = null;
    else if (view && view.changes)
      updateLineForChanges(cm, view, lineN, getDimensions(cm));
    if (!view)
      view = updateExternalMeasurement(cm, line);

    var info = mapFromLineView(view, line, lineN);
    return {
      line: line, view: view, rect: null,
      map: info.map, cache: info.cache, before: info.before,
      hasHeights: false
    };
  }

  // Given a prepared measurement object, measures the position of an
  // actual character (or fetches it from the cache).
  function measureCharPrepared(cm, prepared, ch, bias, varHeight) {
    if (prepared.before) ch = -1;
    var key = ch + (bias || ""), found;
    if (prepared.cache.hasOwnProperty(key)) {
      found = prepared.cache[key];
    } else {
      if (!prepared.rect)
        prepared.rect = prepared.view.text.getBoundingClientRect();
      if (!prepared.hasHeights) {
        ensureLineHeights(cm, prepared.view, prepared.rect);
        prepared.hasHeights = true;
      }
      found = measureCharInner(cm, prepared, ch, bias);
      if (!found.bogus) prepared.cache[key] = found;
    }
    return {left: found.left, right: found.right,
            top: varHeight ? found.rtop : found.top,
            bottom: varHeight ? found.rbottom : found.bottom};
  }

  var nullRect = {left: 0, right: 0, top: 0, bottom: 0};

  function nodeAndOffsetInLineMap(map, ch, bias) {
    var node, start, end, collapse;
    // First, search the line map for the text node corresponding to,
    // or closest to, the target character.
    for (var i = 0; i < map.length; i += 3) {
      var mStart = map[i], mEnd = map[i + 1];
      if (ch < mStart) {
        start = 0; end = 1;
        collapse = "left";
      } else if (ch < mEnd) {
        start = ch - mStart;
        end = start + 1;
      } else if (i == map.length - 3 || ch == mEnd && map[i + 3] > ch) {
        end = mEnd - mStart;
        start = end - 1;
        if (ch >= mEnd) collapse = "right";
      }
      if (start != null) {
        node = map[i + 2];
        if (mStart == mEnd && bias == (node.insertLeft ? "left" : "right"))
          collapse = bias;
        if (bias == "left" && start == 0)
          while (i && map[i - 2] == map[i - 3] && map[i - 1].insertLeft) {
            node = map[(i -= 3) + 2];
            collapse = "left";
          }
        if (bias == "right" && start == mEnd - mStart)
          while (i < map.length - 3 && map[i + 3] == map[i + 4] && !map[i + 5].insertLeft) {
            node = map[(i += 3) + 2];
            collapse = "right";
          }
        break;
      }
    }
    return {node: node, start: start, end: end, collapse: collapse, coverStart: mStart, coverEnd: mEnd};
  }

  function measureCharInner(cm, prepared, ch, bias) {
    var place = nodeAndOffsetInLineMap(prepared.map, ch, bias);
    var node = place.node, start = place.start, end = place.end, collapse = place.collapse;

    var rect;
    if (node.nodeType == 3) { // If it is a text node, use a range to retrieve the coordinates.
      for (var i = 0; i < 4; i++) { // Retry a maximum of 4 times when nonsense rectangles are returned
        while (start && isExtendingChar(prepared.line.text.charAt(place.coverStart + start))) --start;
        while (place.coverStart + end < place.coverEnd && isExtendingChar(prepared.line.text.charAt(place.coverStart + end))) ++end;
        if (ie && ie_version < 9 && start == 0 && end == place.coverEnd - place.coverStart) {
          rect = node.parentNode.getBoundingClientRect();
        } else if (ie && cm.options.lineWrapping) {
          var rects = range(node, start, end).getClientRects();
          if (rects.length)
            rect = rects[bias == "right" ? rects.length - 1 : 0];
          else
            rect = nullRect;
        } else {
          rect = range(node, start, end).getBoundingClientRect() || nullRect;
        }
        if (rect.left || rect.right || start == 0) break;
        end = start;
        start = start - 1;
        collapse = "right";
      }
      if (ie && ie_version < 11) rect = maybeUpdateRectForZooming(cm.display.measure, rect);
    } else { // If it is a widget, simply get the box for the whole widget.
      if (start > 0) collapse = bias = "right";
      var rects;
      if (cm.options.lineWrapping && (rects = node.getClientRects()).length > 1)
        rect = rects[bias == "right" ? rects.length - 1 : 0];
      else
        rect = node.getBoundingClientRect();
    }
    if (ie && ie_version < 9 && !start && (!rect || !rect.left && !rect.right)) {
      var rSpan = node.parentNode.getClientRects()[0];
      if (rSpan)
        rect = {left: rSpan.left, right: rSpan.left + charWidth(cm.display), top: rSpan.top, bottom: rSpan.bottom};
      else
        rect = nullRect;
    }

    var rtop = rect.top - prepared.rect.top, rbot = rect.bottom - prepared.rect.top;
    var mid = (rtop + rbot) / 2;
    var heights = prepared.view.measure.heights;
    for (var i = 0; i < heights.length - 1; i++)
      if (mid < heights[i]) break;
    var top = i ? heights[i - 1] : 0, bot = heights[i];
    var result = {left: (collapse == "right" ? rect.right : rect.left) - prepared.rect.left,
                  right: (collapse == "left" ? rect.left : rect.right) - prepared.rect.left,
                  top: top, bottom: bot};
    if (!rect.left && !rect.right) result.bogus = true;
    if (!cm.options.singleCursorHeightPerLine) { result.rtop = rtop; result.rbottom = rbot; }

    return result;
  }

  // Work around problem with bounding client rects on ranges being
  // returned incorrectly when zoomed on IE10 and below.
  function maybeUpdateRectForZooming(measure, rect) {
    if (!window.screen || screen.logicalXDPI == null ||
        screen.logicalXDPI == screen.deviceXDPI || !hasBadZoomedRects(measure))
      return rect;
    var scaleX = screen.logicalXDPI / screen.deviceXDPI;
    var scaleY = screen.logicalYDPI / screen.deviceYDPI;
    return {left: rect.left * scaleX, right: rect.right * scaleX,
            top: rect.top * scaleY, bottom: rect.bottom * scaleY};
  }

  function clearLineMeasurementCacheFor(lineView) {
    if (lineView.measure) {
      lineView.measure.cache = {};
      lineView.measure.heights = null;
      if (lineView.rest) for (var i = 0; i < lineView.rest.length; i++)
        lineView.measure.caches[i] = {};
    }
  }

  function clearLineMeasurementCache(cm) {
    cm.display.externalMeasure = null;
    removeChildren(cm.display.lineMeasure);
    for (var i = 0; i < cm.display.view.length; i++)
      clearLineMeasurementCacheFor(cm.display.view[i]);
  }

  function clearCaches(cm) {
    clearLineMeasurementCache(cm);
    cm.display.cachedCharWidth = cm.display.cachedTextHeight = cm.display.cachedPaddingH = null;
    if (!cm.options.lineWrapping) cm.display.maxLineChanged = true;
    cm.display.lineNumChars = null;
  }

  function pageScrollX() { return window.pageXOffset || (document.documentElement || document.body).scrollLeft; }
  function pageScrollY() { return window.pageYOffset || (document.documentElement || document.body).scrollTop; }

  // Converts a {top, bottom, left, right} box from line-local
  // coordinates into another coordinate system. Context may be one of
  // "line", "div" (display.lineDiv), "local"/null (editor), "window",
  // or "page".
  function intoCoordSystem(cm, lineObj, rect, context) {
    if (lineObj.widgets) for (var i = 0; i < lineObj.widgets.length; ++i) if (lineObj.widgets[i].above) {
      var size = widgetHeight(lineObj.widgets[i]);
      rect.top += size; rect.bottom += size;
    }
    if (context == "line") return rect;
    if (!context) context = "local";
    var yOff = heightAtLine(lineObj);
    if (context == "local") yOff += paddingTop(cm.display);
    else yOff -= cm.display.viewOffset;
    if (context == "page" || context == "window") {
      var lOff = cm.display.lineSpace.getBoundingClientRect();
      yOff += lOff.top + (context == "window" ? 0 : pageScrollY());
      var xOff = lOff.left + (context == "window" ? 0 : pageScrollX());
      rect.left += xOff; rect.right += xOff;
    }
    rect.top += yOff; rect.bottom += yOff;
    return rect;
  }

  // Coverts a box from "div" coords to another coordinate system.
  // Context may be "window", "page", "div", or "local"/null.
  function fromCoordSystem(cm, coords, context) {
    if (context == "div") return coords;
    var left = coords.left, top = coords.top;
    // First move into "page" coordinate system
    if (context == "page") {
      left -= pageScrollX();
      top -= pageScrollY();
    } else if (context == "local" || !context) {
      var localBox = cm.display.sizer.getBoundingClientRect();
      left += localBox.left;
      top += localBox.top;
    }

    var lineSpaceBox = cm.display.lineSpace.getBoundingClientRect();
    return {left: left - lineSpaceBox.left, top: top - lineSpaceBox.top};
  }

  function charCoords(cm, pos, context, lineObj, bias) {
    if (!lineObj) lineObj = getLine(cm.doc, pos.line);
    return intoCoordSystem(cm, lineObj, measureChar(cm, lineObj, pos.ch, bias), context);
  }

  // Returns a box for a given cursor position, which may have an
  // 'other' property containing the position of the secondary cursor
  // on a bidi boundary.
  function cursorCoords(cm, pos, context, lineObj, preparedMeasure, varHeight) {
    lineObj = lineObj || getLine(cm.doc, pos.line);
    if (!preparedMeasure) preparedMeasure = prepareMeasureForLine(cm, lineObj);
    function get(ch, right) {
      var m = measureCharPrepared(cm, preparedMeasure, ch, right ? "right" : "left", varHeight);
      if (right) m.left = m.right; else m.right = m.left;
      return intoCoordSystem(cm, lineObj, m, context);
    }
    function getBidi(ch, partPos) {
      var part = order[partPos], right = part.level % 2;
      if (ch == bidiLeft(part) && partPos && part.level < order[partPos - 1].level) {
        part = order[--partPos];
        ch = bidiRight(part) - (part.level % 2 ? 0 : 1);
        right = true;
      } else if (ch == bidiRight(part) && partPos < order.length - 1 && part.level < order[partPos + 1].level) {
        part = order[++partPos];
        ch = bidiLeft(part) - part.level % 2;
        right = false;
      }
      if (right && ch == part.to && ch > part.from) return get(ch - 1);
      return get(ch, right);
    }
    var order = getOrder(lineObj), ch = pos.ch;
    if (!order) return get(ch);
    var partPos = getBidiPartAt(order, ch);
    var val = getBidi(ch, partPos);
    if (bidiOther != null) val.other = getBidi(ch, bidiOther);
    return val;
  }

  // Used to cheaply estimate the coordinates for a position. Used for
  // intermediate scroll updates.
  function estimateCoords(cm, pos) {
    var left = 0, pos = clipPos(cm.doc, pos);
    if (!cm.options.lineWrapping) left = charWidth(cm.display) * pos.ch;
    var lineObj = getLine(cm.doc, pos.line);
    var top = heightAtLine(lineObj) + paddingTop(cm.display);
    return {left: left, right: left, top: top, bottom: top + lineObj.height};
  }

  // Positions returned by coordsChar contain some extra information.
  // xRel is the relative x position of the input coordinates compared
  // to the found position (so xRel > 0 means the coordinates are to
  // the right of the character position, for example). When outside
  // is true, that means the coordinates lie outside the line's
  // vertical range.
  function PosWithInfo(line, ch, outside, xRel) {
    var pos = Pos(line, ch);
    pos.xRel = xRel;
    if (outside) pos.outside = true;
    return pos;
  }

  // Compute the character position closest to the given coordinates.
  // Input must be lineSpace-local ("div" coordinate system).
  function coordsChar(cm, x, y) {
    var doc = cm.doc;
    y += cm.display.viewOffset;
    if (y < 0) return PosWithInfo(doc.first, 0, true, -1);
    var lineN = lineAtHeight(doc, y), last = doc.first + doc.size - 1;
    if (lineN > last)
      return PosWithInfo(doc.first + doc.size - 1, getLine(doc, last).text.length, true, 1);
    if (x < 0) x = 0;

    var lineObj = getLine(doc, lineN);
    for (;;) {
      var found = coordsCharInner(cm, lineObj, lineN, x, y);
      var merged = collapsedSpanAtEnd(lineObj);
      var mergedPos = merged && merged.find(0, true);
      if (merged && (found.ch > mergedPos.from.ch || found.ch == mergedPos.from.ch && found.xRel > 0))
        lineN = lineNo(lineObj = mergedPos.to.line);
      else
        return found;
    }
  }

  function coordsCharInner(cm, lineObj, lineNo, x, y) {
    var innerOff = y - heightAtLine(lineObj);
    var wrongLine = false, adjust = 2 * cm.display.wrapper.clientWidth;
    var preparedMeasure = prepareMeasureForLine(cm, lineObj);

    function getX(ch) {
      var sp = cursorCoords(cm, Pos(lineNo, ch), "line", lineObj, preparedMeasure);
      wrongLine = true;
      if (innerOff > sp.bottom) return sp.left - adjust;
      else if (innerOff < sp.top) return sp.left + adjust;
      else wrongLine = false;
      return sp.left;
    }

    var bidi = getOrder(lineObj), dist = lineObj.text.length;
    var from = lineLeft(lineObj), to = lineRight(lineObj);
    var fromX = getX(from), fromOutside = wrongLine, toX = getX(to), toOutside = wrongLine;

    if (x > toX) return PosWithInfo(lineNo, to, toOutside, 1);
    // Do a binary search between these bounds.
    for (;;) {
      if (bidi ? to == from || to == moveVisually(lineObj, from, 1) : to - from <= 1) {
        var ch = x < fromX || x - fromX <= toX - x ? from : to;
        var xDiff = x - (ch == from ? fromX : toX);
        while (isExtendingChar(lineObj.text.charAt(ch))) ++ch;
        var pos = PosWithInfo(lineNo, ch, ch == from ? fromOutside : toOutside,
                              xDiff < -1 ? -1 : xDiff > 1 ? 1 : 0);
        return pos;
      }
      var step = Math.ceil(dist / 2), middle = from + step;
      if (bidi) {
        middle = from;
        for (var i = 0; i < step; ++i) middle = moveVisually(lineObj, middle, 1);
      }
      var middleX = getX(middle);
      if (middleX > x) {to = middle; toX = middleX; if (toOutside = wrongLine) toX += 1000; dist = step;}
      else {from = middle; fromX = middleX; fromOutside = wrongLine; dist -= step;}
    }
  }

  var measureText;
  // Compute the default text height.
  function textHeight(display) {
    if (display.cachedTextHeight != null) return display.cachedTextHeight;
    if (measureText == null) {
      measureText = elt("pre");
      // Measure a bunch of lines, for browsers that compute
      // fractional heights.
      for (var i = 0; i < 49; ++i) {
        measureText.appendChild(document.createTextNode("x"));
        measureText.appendChild(elt("br"));
      }
      measureText.appendChild(document.createTextNode("x"));
    }
    removeChildrenAndAdd(display.measure, measureText);
    var height = measureText.offsetHeight / 50;
    if (height > 3) display.cachedTextHeight = height;
    removeChildren(display.measure);
    return height || 1;
  }

  // Compute the default character width.
  function charWidth(display) {
    if (display.cachedCharWidth != null) return display.cachedCharWidth;
    var anchor = elt("span", "xxxxxxxxxx");
    var pre = elt("pre", [anchor]);
    removeChildrenAndAdd(display.measure, pre);
    var rect = anchor.getBoundingClientRect(), width = (rect.right - rect.left) / 10;
    if (width > 2) display.cachedCharWidth = width;
    return width || 10;
  }

  // OPERATIONS

  // Operations are used to wrap a series of changes to the editor
  // state in such a way that each change won't have to update the
  // cursor and display (which would be awkward, slow, and
  // error-prone). Instead, display updates are batched and then all
  // combined and executed at once.

  var operationGroup = null;

  var nextOpId = 0;
  // Start a new operation.
  function startOperation(cm) {
    cm.curOp = {
      cm: cm,
      viewChanged: false,      // Flag that indicates that lines might need to be redrawn
      startHeight: cm.doc.height, // Used to detect need to update scrollbar
      forceUpdate: false,      // Used to force a redraw
      updateInput: null,       // Whether to reset the input textarea
      typing: false,           // Whether this reset should be careful to leave existing text (for compositing)
      changeObjs: null,        // Accumulated changes, for firing change events
      cursorActivityHandlers: null, // Set of handlers to fire cursorActivity on
      cursorActivityCalled: 0, // Tracks which cursorActivity handlers have been called already
      selectionChanged: false, // Whether the selection needs to be redrawn
      updateMaxLine: false,    // Set when the widest line needs to be determined anew
      scrollLeft: null, scrollTop: null, // Intermediate scroll position, not pushed to DOM yet
      scrollToPos: null,       // Used to scroll to a specific position
      focus: false,
      id: ++nextOpId           // Unique ID
    };
    if (operationGroup) {
      operationGroup.ops.push(cm.curOp);
    } else {
      cm.curOp.ownsGroup = operationGroup = {
        ops: [cm.curOp],
        delayedCallbacks: []
      };
    }
  }

  function fireCallbacksForOps(group) {
    // Calls delayed callbacks and cursorActivity handlers until no
    // new ones appear
    var callbacks = group.delayedCallbacks, i = 0;
    do {
      for (; i < callbacks.length; i++)
        callbacks[i]();
      for (var j = 0; j < group.ops.length; j++) {
        var op = group.ops[j];
        if (op.cursorActivityHandlers)
          while (op.cursorActivityCalled < op.cursorActivityHandlers.length)
            op.cursorActivityHandlers[op.cursorActivityCalled++](op.cm);
      }
    } while (i < callbacks.length);
  }

  // Finish an operation, updating the display and signalling delayed events
  function endOperation(cm) {
    var op = cm.curOp, group = op.ownsGroup;
    if (!group) return;

    try { fireCallbacksForOps(group); }
    finally {
      operationGroup = null;
      for (var i = 0; i < group.ops.length; i++)
        group.ops[i].cm.curOp = null;
      endOperations(group);
    }
  }

  // The DOM updates done when an operation finishes are batched so
  // that the minimum number of relayouts are required.
  function endOperations(group) {
    var ops = group.ops;
    for (var i = 0; i < ops.length; i++) // Read DOM
      endOperation_R1(ops[i]);
    for (var i = 0; i < ops.length; i++) // Write DOM (maybe)
      endOperation_W1(ops[i]);
    for (var i = 0; i < ops.length; i++) // Read DOM
      endOperation_R2(ops[i]);
    for (var i = 0; i < ops.length; i++) // Write DOM (maybe)
      endOperation_W2(ops[i]);
    for (var i = 0; i < ops.length; i++) // Read DOM
      endOperation_finish(ops[i]);
  }

  function endOperation_R1(op) {
    var cm = op.cm, display = cm.display;
    maybeClipScrollbars(cm);
    if (op.updateMaxLine) findMaxLine(cm);

    op.mustUpdate = op.viewChanged || op.forceUpdate || op.scrollTop != null ||
      op.scrollToPos && (op.scrollToPos.from.line < display.viewFrom ||
                         op.scrollToPos.to.line >= display.viewTo) ||
      display.maxLineChanged && cm.options.lineWrapping;
    op.update = op.mustUpdate &&
      new DisplayUpdate(cm, op.mustUpdate && {top: op.scrollTop, ensure: op.scrollToPos}, op.forceUpdate);
  }

  function endOperation_W1(op) {
    op.updatedDisplay = op.mustUpdate && updateDisplayIfNeeded(op.cm, op.update);
  }

  function endOperation_R2(op) {
    var cm = op.cm, display = cm.display;
    if (op.updatedDisplay) updateHeightsInViewport(cm);

    op.barMeasure = measureForScrollbars(cm);

    // If the max line changed since it was last measured, measure it,
    // and ensure the document's width matches it.
    // updateDisplay_W2 will use these properties to do the actual resizing
    if (display.maxLineChanged && !cm.options.lineWrapping) {
      op.adjustWidthTo = measureChar(cm, display.maxLine, display.maxLine.text.length).left + 3;
      cm.display.sizerWidth = op.adjustWidthTo;
      op.barMeasure.scrollWidth =
        Math.max(display.scroller.clientWidth, display.sizer.offsetLeft + op.adjustWidthTo + scrollGap(cm) + cm.display.barWidth);
      op.maxScrollLeft = Math.max(0, display.sizer.offsetLeft + op.adjustWidthTo - displayWidth(cm));
    }

    if (op.updatedDisplay || op.selectionChanged)
      op.preparedSelection = display.input.prepareSelection();
  }

  function endOperation_W2(op) {
    var cm = op.cm;

    if (op.adjustWidthTo != null) {
      cm.display.sizer.style.minWidth = op.adjustWidthTo + "px";
      if (op.maxScrollLeft < cm.doc.scrollLeft)
        setScrollLeft(cm, Math.min(cm.display.scroller.scrollLeft, op.maxScrollLeft), true);
      cm.display.maxLineChanged = false;
    }

    if (op.preparedSelection)
      cm.display.input.showSelection(op.preparedSelection);
    if (op.updatedDisplay)
      setDocumentHeight(cm, op.barMeasure);
    if (op.updatedDisplay || op.startHeight != cm.doc.height)
      updateScrollbars(cm, op.barMeasure);

    if (op.selectionChanged) restartBlink(cm);

    if (cm.state.focused && op.updateInput)
      cm.display.input.reset(op.typing);
    if (op.focus && op.focus == activeElt()) ensureFocus(op.cm);
  }

  function endOperation_finish(op) {
    var cm = op.cm, display = cm.display, doc = cm.doc;

    if (op.updatedDisplay) postUpdateDisplay(cm, op.update);

    // Abort mouse wheel delta measurement, when scrolling explicitly
    if (display.wheelStartX != null && (op.scrollTop != null || op.scrollLeft != null || op.scrollToPos))
      display.wheelStartX = display.wheelStartY = null;

    // Propagate the scroll position to the actual DOM scroller
    if (op.scrollTop != null && (display.scroller.scrollTop != op.scrollTop || op.forceScroll)) {
      doc.scrollTop = Math.max(0, Math.min(display.scroller.scrollHeight - display.scroller.clientHeight, op.scrollTop));
      display.scrollbars.setScrollTop(doc.scrollTop);
      display.scroller.scrollTop = doc.scrollTop;
    }
    if (op.scrollLeft != null && (display.scroller.scrollLeft != op.scrollLeft || op.forceScroll)) {
      doc.scrollLeft = Math.max(0, Math.min(display.scroller.scrollWidth - displayWidth(cm), op.scrollLeft));
      display.scrollbars.setScrollLeft(doc.scrollLeft);
      display.scroller.scrollLeft = doc.scrollLeft;
      alignHorizontally(cm);
    }
    // If we need to scroll a specific position into view, do so.
    if (op.scrollToPos) {
      var coords = scrollPosIntoView(cm, clipPos(doc, op.scrollToPos.from),
                                     clipPos(doc, op.scrollToPos.to), op.scrollToPos.margin);
      if (op.scrollToPos.isCursor && cm.state.focused) maybeScrollWindow(cm, coords);
    }

    // Fire events for markers that are hidden/unidden by editing or
    // undoing
    var hidden = op.maybeHiddenMarkers, unhidden = op.maybeUnhiddenMarkers;
    if (hidden) for (var i = 0; i < hidden.length; ++i)
      if (!hidden[i].lines.length) signal(hidden[i], "hide");
    if (unhidden) for (var i = 0; i < unhidden.length; ++i)
      if (unhidden[i].lines.length) signal(unhidden[i], "unhide");

    if (display.wrapper.offsetHeight)
      doc.scrollTop = cm.display.scroller.scrollTop;

    // Fire change events, and delayed event handlers
    if (op.changeObjs)
      signal(cm, "changes", cm, op.changeObjs);
    if (op.update)
      op.update.finish();
  }

  // Run the given function in an operation
  function runInOp(cm, f) {
    if (cm.curOp) return f();
    startOperation(cm);
    try { return f(); }
    finally { endOperation(cm); }
  }
  // Wraps a function in an operation. Returns the wrapped function.
  function operation(cm, f) {
    return function() {
      if (cm.curOp) return f.apply(cm, arguments);
      startOperation(cm);
      try { return f.apply(cm, arguments); }
      finally { endOperation(cm); }
    };
  }
  // Used to add methods to editor and doc instances, wrapping them in
  // operations.
  function methodOp(f) {
    return function() {
      if (this.curOp) return f.apply(this, arguments);
      startOperation(this);
      try { return f.apply(this, arguments); }
      finally { endOperation(this); }
    };
  }
  function docMethodOp(f) {
    return function() {
      var cm = this.cm;
      if (!cm || cm.curOp) return f.apply(this, arguments);
      startOperation(cm);
      try { return f.apply(this, arguments); }
      finally { endOperation(cm); }
    };
  }

  // VIEW TRACKING

  // These objects are used to represent the visible (currently drawn)
  // part of the document. A LineView may correspond to multiple
  // logical lines, if those are connected by collapsed ranges.
  function LineView(doc, line, lineN) {
    // The starting line
    this.line = line;
    // Continuing lines, if any
    this.rest = visualLineContinued(line);
    // Number of logical lines in this visual line
    this.size = this.rest ? lineNo(lst(this.rest)) - lineN + 1 : 1;
    this.node = this.text = null;
    this.hidden = lineIsHidden(doc, line);
  }

  // Create a range of LineView objects for the given lines.
  function buildViewArray(cm, from, to) {
    var array = [], nextPos;
    for (var pos = from; pos < to; pos = nextPos) {
      var view = new LineView(cm.doc, getLine(cm.doc, pos), pos);
      nextPos = pos + view.size;
      array.push(view);
    }
    return array;
  }

  // Updates the display.view data structure for a given change to the
  // document. From and to are in pre-change coordinates. Lendiff is
  // the amount of lines added or subtracted by the change. This is
  // used for changes that span multiple lines, or change the way
  // lines are divided into visual lines. regLineChange (below)
  // registers single-line changes.
  function regChange(cm, from, to, lendiff) {
    if (from == null) from = cm.doc.first;
    if (to == null) to = cm.doc.first + cm.doc.size;
    if (!lendiff) lendiff = 0;

    var display = cm.display;
    if (lendiff && to < display.viewTo &&
        (display.updateLineNumbers == null || display.updateLineNumbers > from))
      display.updateLineNumbers = from;

    cm.curOp.viewChanged = true;

    if (from >= display.viewTo) { // Change after
      if (sawCollapsedSpans && visualLineNo(cm.doc, from) < display.viewTo)
        resetView(cm);
    } else if (to <= display.viewFrom) { // Change before
      if (sawCollapsedSpans && visualLineEndNo(cm.doc, to + lendiff) > display.viewFrom) {
        resetView(cm);
      } else {
        display.viewFrom += lendiff;
        display.viewTo += lendiff;
      }
    } else if (from <= display.viewFrom && to >= display.viewTo) { // Full overlap
      resetView(cm);
    } else if (from <= display.viewFrom) { // Top overlap
      var cut = viewCuttingPoint(cm, to, to + lendiff, 1);
      if (cut) {
        display.view = display.view.slice(cut.index);
        display.viewFrom = cut.lineN;
        display.viewTo += lendiff;
      } else {
        resetView(cm);
      }
    } else if (to >= display.viewTo) { // Bottom overlap
      var cut = viewCuttingPoint(cm, from, from, -1);
      if (cut) {
        display.view = display.view.slice(0, cut.index);
        display.viewTo = cut.lineN;
      } else {
        resetView(cm);
      }
    } else { // Gap in the middle
      var cutTop = viewCuttingPoint(cm, from, from, -1);
      var cutBot = viewCuttingPoint(cm, to, to + lendiff, 1);
      if (cutTop && cutBot) {
        display.view = display.view.slice(0, cutTop.index)
          .concat(buildViewArray(cm, cutTop.lineN, cutBot.lineN))
          .concat(display.view.slice(cutBot.index));
        display.viewTo += lendiff;
      } else {
        resetView(cm);
      }
    }

    var ext = display.externalMeasured;
    if (ext) {
      if (to < ext.lineN)
        ext.lineN += lendiff;
      else if (from < ext.lineN + ext.size)
        display.externalMeasured = null;
    }
  }

  // Register a change to a single line. Type must be one of "text",
  // "gutter", "class", "widget"
  function regLineChange(cm, line, type) {
    cm.curOp.viewChanged = true;
    var display = cm.display, ext = cm.display.externalMeasured;
    if (ext && line >= ext.lineN && line < ext.lineN + ext.size)
      display.externalMeasured = null;

    if (line < display.viewFrom || line >= display.viewTo) return;
    var lineView = display.view[findViewIndex(cm, line)];
    if (lineView.node == null) return;
    var arr = lineView.changes || (lineView.changes = []);
    if (indexOf(arr, type) == -1) arr.push(type);
  }

  // Clear the view.
  function resetView(cm) {
    cm.display.viewFrom = cm.display.viewTo = cm.doc.first;
    cm.display.view = [];
    cm.display.viewOffset = 0;
  }

  // Find the view element corresponding to a given line. Return null
  // when the line isn't visible.
  function findViewIndex(cm, n) {
    if (n >= cm.display.viewTo) return null;
    n -= cm.display.viewFrom;
    if (n < 0) return null;
    var view = cm.display.view;
    for (var i = 0; i < view.length; i++) {
      n -= view[i].size;
      if (n < 0) return i;
    }
  }

  function viewCuttingPoint(cm, oldN, newN, dir) {
    var index = findViewIndex(cm, oldN), diff, view = cm.display.view;
    if (!sawCollapsedSpans || newN == cm.doc.first + cm.doc.size)
      return {index: index, lineN: newN};
    for (var i = 0, n = cm.display.viewFrom; i < index; i++)
      n += view[i].size;
    if (n != oldN) {
      if (dir > 0) {
        if (index == view.length - 1) return null;
        diff = (n + view[index].size) - oldN;
        index++;
      } else {
        diff = n - oldN;
      }
      oldN += diff; newN += diff;
    }
    while (visualLineNo(cm.doc, newN) != newN) {
      if (index == (dir < 0 ? 0 : view.length - 1)) return null;
      newN += dir * view[index - (dir < 0 ? 1 : 0)].size;
      index += dir;
    }
    return {index: index, lineN: newN};
  }

  // Force the view to cover a given range, adding empty view element
  // or clipping off existing ones as needed.
  function adjustView(cm, from, to) {
    var display = cm.display, view = display.view;
    if (view.length == 0 || from >= display.viewTo || to <= display.viewFrom) {
      display.view = buildViewArray(cm, from, to);
      display.viewFrom = from;
    } else {
      if (display.viewFrom > from)
        display.view = buildViewArray(cm, from, display.viewFrom).concat(display.view);
      else if (display.viewFrom < from)
        display.view = display.view.slice(findViewIndex(cm, from));
      display.viewFrom = from;
      if (display.viewTo < to)
        display.view = display.view.concat(buildViewArray(cm, display.viewTo, to));
      else if (display.viewTo > to)
        display.view = display.view.slice(0, findViewIndex(cm, to));
    }
    display.viewTo = to;
  }

  // Count the number of lines in the view whose DOM representation is
  // out of date (or nonexistent).
  function countDirtyView(cm) {
    var view = cm.display.view, dirty = 0;
    for (var i = 0; i < view.length; i++) {
      var lineView = view[i];
      if (!lineView.hidden && (!lineView.node || lineView.changes)) ++dirty;
    }
    return dirty;
  }

  // EVENT HANDLERS

  // Attach the necessary event handlers when initializing the editor
  function registerEventHandlers(cm) {
    var d = cm.display;
    on(d.scroller, "mousedown", operation(cm, onMouseDown));
    // Older IE's will not fire a second mousedown for a double click
    if (ie && ie_version < 11)
      on(d.scroller, "dblclick", operation(cm, function(e) {
        if (signalDOMEvent(cm, e)) return;
        var pos = posFromMouse(cm, e);
        if (!pos || clickInGutter(cm, e) || eventInWidget(cm.display, e)) return;
        e_preventDefault(e);
        var word = cm.findWordAt(pos);
        extendSelection(cm.doc, word.anchor, word.head);
      }));
    else
      on(d.scroller, "dblclick", function(e) { signalDOMEvent(cm, e) || e_preventDefault(e); });
    // Some browsers fire contextmenu *after* opening the menu, at
    // which point we can't mess with it anymore. Context menu is
    // handled in onMouseDown for these browsers.
    if (!captureRightClick) on(d.scroller, "contextmenu", function(e) {onContextMenu(cm, e);});

    // Used to suppress mouse event handling when a touch happens
    var touchFinished, prevTouch = {end: 0};
    function finishTouch() {
      if (d.activeTouch) {
        touchFinished = setTimeout(function() {d.activeTouch = null;}, 1000);
        prevTouch = d.activeTouch;
        prevTouch.end = +new Date;
      }
    };
    function isMouseLikeTouchEvent(e) {
      if (e.touches.length != 1) return false;
      var touch = e.touches[0];
      return touch.radiusX <= 1 && touch.radiusY <= 1;
    }
    function farAway(touch, other) {
      if (other.left == null) return true;
      var dx = other.left - touch.left, dy = other.top - touch.top;
      return dx * dx + dy * dy > 20 * 20;
    }
    on(d.scroller, "touchstart", function(e) {
      if (!isMouseLikeTouchEvent(e)) {
        clearTimeout(touchFinished);
        var now = +new Date;
        d.activeTouch = {start: now, moved: false,
                         prev: now - prevTouch.end <= 300 ? prevTouch : null};
        if (e.touches.length == 1) {
          d.activeTouch.left = e.touches[0].pageX;
          d.activeTouch.top = e.touches[0].pageY;
        }
      }
    });
    on(d.scroller, "touchmove", function() {
      if (d.activeTouch) d.activeTouch.moved = true;
    });
    on(d.scroller, "touchend", function(e) {
      var touch = d.activeTouch;
      if (touch && !eventInWidget(d, e) && touch.left != null &&
          !touch.moved && new Date - touch.start < 300) {
        var pos = cm.coordsChar(d.activeTouch, "page"), range;
        if (!touch.prev || farAway(touch, touch.prev)) // Single tap
          range = new Range(pos, pos);
        else if (!touch.prev.prev || farAway(touch, touch.prev.prev)) // Double tap
          range = cm.findWordAt(pos);
        else // Triple tap
          range = new Range(Pos(pos.line, 0), clipPos(cm.doc, Pos(pos.line + 1, 0)));
        cm.setSelection(range.anchor, range.head);
        cm.focus();
        e_preventDefault(e);
      }
      finishTouch();
    });
    on(d.scroller, "touchcancel", finishTouch);

    // Sync scrolling between fake scrollbars and real scrollable
    // area, ensure viewport is updated when scrolling.
    on(d.scroller, "scroll", function() {
      if (d.scroller.clientHeight) {
        setScrollTop(cm, d.scroller.scrollTop);
        setScrollLeft(cm, d.scroller.scrollLeft, true);
        signal(cm, "scroll", cm);
      }
    });

    // Listen to wheel events in order to try and update the viewport on time.
    on(d.scroller, "mousewheel", function(e){onScrollWheel(cm, e);});
    on(d.scroller, "DOMMouseScroll", function(e){onScrollWheel(cm, e);});

    // Prevent wrapper from ever scrolling
    on(d.wrapper, "scroll", function() { d.wrapper.scrollTop = d.wrapper.scrollLeft = 0; });

    d.dragFunctions = {
      simple: function(e) {if (!signalDOMEvent(cm, e)) e_stop(e);},
      start: function(e){onDragStart(cm, e);},
      drop: operation(cm, onDrop)
    };

    var inp = d.input.getField();
    on(inp, "keyup", function(e) { onKeyUp.call(cm, e); });
    on(inp, "keydown", operation(cm, onKeyDown));
    on(inp, "keypress", operation(cm, onKeyPress));
    on(inp, "focus", bind(onFocus, cm));
    on(inp, "blur", bind(onBlur, cm));
  }

  function dragDropChanged(cm, value, old) {
    var wasOn = old && old != CodeMirror.Init;
    if (!value != !wasOn) {
      var funcs = cm.display.dragFunctions;
      var toggle = value ? on : off;
      toggle(cm.display.scroller, "dragstart", funcs.start);
      toggle(cm.display.scroller, "dragenter", funcs.simple);
      toggle(cm.display.scroller, "dragover", funcs.simple);
      toggle(cm.display.scroller, "drop", funcs.drop);
    }
  }

  // Called when the window resizes
  function onResize(cm) {
    var d = cm.display;
    if (d.lastWrapHeight == d.wrapper.clientHeight && d.lastWrapWidth == d.wrapper.clientWidth)
      return;
    // Might be a text scaling operation, clear size caches.
    d.cachedCharWidth = d.cachedTextHeight = d.cachedPaddingH = null;
    d.scrollbarsClipped = false;
    cm.setSize();
  }

  // MOUSE EVENTS

  // Return true when the given mouse event happened in a widget
  function eventInWidget(display, e) {
    for (var n = e_target(e); n != display.wrapper; n = n.parentNode) {
      if (!n || (n.nodeType == 1 && n.getAttribute("cm-ignore-events") == "true") ||
          (n.parentNode == display.sizer && n != display.mover))
        return true;
    }
  }

  // Given a mouse event, find the corresponding position. If liberal
  // is false, it checks whether a gutter or scrollbar was clicked,
  // and returns null if it was. forRect is used by rectangular
  // selections, and tries to estimate a character position even for
  // coordinates beyond the right of the text.
  function posFromMouse(cm, e, liberal, forRect) {
    var display = cm.display;
    if (!liberal && e_target(e).getAttribute("cm-not-content") == "true") return null;

    var x, y, space = display.lineSpace.getBoundingClientRect();
    // Fails unpredictably on IE[67] when mouse is dragged around quickly.
    try { x = e.clientX - space.left; y = e.clientY - space.top; }
    catch (e) { return null; }
    var coords = coordsChar(cm, x, y), line;
    if (forRect && coords.xRel == 1 && (line = getLine(cm.doc, coords.line).text).length == coords.ch) {
      var colDiff = countColumn(line, line.length, cm.options.tabSize) - line.length;
      coords = Pos(coords.line, Math.max(0, Math.round((x - paddingH(cm.display).left) / charWidth(cm.display)) - colDiff));
    }
    return coords;
  }

  // A mouse down can be a single click, double click, triple click,
  // start of selection drag, start of text drag, new cursor
  // (ctrl-click), rectangle drag (alt-drag), or xwin
  // middle-click-paste. Or it might be a click on something we should
  // not interfere with, such as a scrollbar or widget.
  function onMouseDown(e) {
    var cm = this, display = cm.display;
    if (display.activeTouch && display.input.supportsTouch() || signalDOMEvent(cm, e)) return;
    display.shift = e.shiftKey;

    if (eventInWidget(display, e)) {
      if (!webkit) {
        // Briefly turn off draggability, to allow widgets to do
        // normal dragging things.
        display.scroller.draggable = false;
        setTimeout(function(){display.scroller.draggable = true;}, 100);
      }
      return;
    }
    if (clickInGutter(cm, e)) return;
    var start = posFromMouse(cm, e);
    window.focus();

    switch (e_button(e)) {
    case 1:
      if (start)
        leftButtonDown(cm, e, start);
      else if (e_target(e) == display.scroller)
        e_preventDefault(e);
      break;
    case 2:
      if (webkit) cm.state.lastMiddleDown = +new Date;
      if (start) extendSelection(cm.doc, start);
      setTimeout(function() {display.input.focus();}, 20);
      e_preventDefault(e);
      break;
    case 3:
      if (captureRightClick) onContextMenu(cm, e);
      else delayBlurEvent(cm);
      break;
    }
  }

  var lastClick, lastDoubleClick;
  function leftButtonDown(cm, e, start) {
    if (ie) setTimeout(bind(ensureFocus, cm), 0);
    else cm.curOp.focus = activeElt();

    var now = +new Date, type;
    if (lastDoubleClick && lastDoubleClick.time > now - 400 && cmp(lastDoubleClick.pos, start) == 0) {
      type = "triple";
    } else if (lastClick && lastClick.time > now - 400 && cmp(lastClick.pos, start) == 0) {
      type = "double";
      lastDoubleClick = {time: now, pos: start};
    } else {
      type = "single";
      lastClick = {time: now, pos: start};
    }

    var sel = cm.doc.sel, modifier = mac ? e.metaKey : e.ctrlKey, contained;
    if (cm.options.dragDrop && dragAndDrop && !isReadOnly(cm) &&
        type == "single" && (contained = sel.contains(start)) > -1 &&
        (cmp((contained = sel.ranges[contained]).from(), start) < 0 || start.xRel > 0) &&
        (cmp(contained.to(), start) > 0 || start.xRel < 0))
      leftButtonStartDrag(cm, e, start, modifier);
    else
      leftButtonSelect(cm, e, start, type, modifier);
  }

  // Start a text drag. When it ends, see if any dragging actually
  // happen, and treat as a click if it didn't.
  function leftButtonStartDrag(cm, e, start, modifier) {
    var display = cm.display, startTime = +new Date;
    var dragEnd = operation(cm, function(e2) {
      if (webkit) display.scroller.draggable = false;
      cm.state.draggingText = false;
      off(document, "mouseup", dragEnd);
      off(display.scroller, "drop", dragEnd);
      if (Math.abs(e.clientX - e2.clientX) + Math.abs(e.clientY - e2.clientY) < 10) {
        e_preventDefault(e2);
        if (!modifier && +new Date - 200 < startTime)
          extendSelection(cm.doc, start);
        // Work around unexplainable focus problem in IE9 (#2127) and Chrome (#3081)
        if (webkit || ie && ie_version == 9)
          setTimeout(function() {document.body.focus(); display.input.focus();}, 20);
        else
          display.input.focus();
      }
    });
    // Let the drag handler handle this.
    if (webkit) display.scroller.draggable = true;
    cm.state.draggingText = dragEnd;
    // IE's approach to draggable
    if (display.scroller.dragDrop) display.scroller.dragDrop();
    on(document, "mouseup", dragEnd);
    on(display.scroller, "drop", dragEnd);
  }

  // Normal selection, as opposed to text dragging.
  function leftButtonSelect(cm, e, start, type, addNew) {
    var display = cm.display, doc = cm.doc;
    e_preventDefault(e);

    var ourRange, ourIndex, startSel = doc.sel, ranges = startSel.ranges;
    if (addNew && !e.shiftKey) {
      ourIndex = doc.sel.contains(start);
      if (ourIndex > -1)
        ourRange = ranges[ourIndex];
      else
        ourRange = new Range(start, start);
    } else {
      ourRange = doc.sel.primary();
      ourIndex = doc.sel.primIndex;
    }

    if (e.altKey) {
      type = "rect";
      if (!addNew) ourRange = new Range(start, start);
      start = posFromMouse(cm, e, true, true);
      ourIndex = -1;
    } else if (type == "double") {
      var word = cm.findWordAt(start);
      if (cm.display.shift || doc.extend)
        ourRange = extendRange(doc, ourRange, word.anchor, word.head);
      else
        ourRange = word;
    } else if (type == "triple") {
      var line = new Range(Pos(start.line, 0), clipPos(doc, Pos(start.line + 1, 0)));
      if (cm.display.shift || doc.extend)
        ourRange = extendRange(doc, ourRange, line.anchor, line.head);
      else
        ourRange = line;
    } else {
      ourRange = extendRange(doc, ourRange, start);
    }

    if (!addNew) {
      ourIndex = 0;
      setSelection(doc, new Selection([ourRange], 0), sel_mouse);
      startSel = doc.sel;
    } else if (ourIndex == -1) {
      ourIndex = ranges.length;
      setSelection(doc, normalizeSelection(ranges.concat([ourRange]), ourIndex),
                   {scroll: false, origin: "*mouse"});
    } else if (ranges.length > 1 && ranges[ourIndex].empty() && type == "single" && !e.shiftKey) {
      setSelection(doc, normalizeSelection(ranges.slice(0, ourIndex).concat(ranges.slice(ourIndex + 1)), 0));
      startSel = doc.sel;
    } else {
      replaceOneSelection(doc, ourIndex, ourRange, sel_mouse);
    }

    var lastPos = start;
    function extendTo(pos) {
      if (cmp(lastPos, pos) == 0) return;
      lastPos = pos;

      if (type == "rect") {
        var ranges = [], tabSize = cm.options.tabSize;
        var startCol = countColumn(getLine(doc, start.line).text, start.ch, tabSize);
        var posCol = countColumn(getLine(doc, pos.line).text, pos.ch, tabSize);
        var left = Math.min(startCol, posCol), right = Math.max(startCol, posCol);
        for (var line = Math.min(start.line, pos.line), end = Math.min(cm.lastLine(), Math.max(start.line, pos.line));
             line <= end; line++) {
          var text = getLine(doc, line).text, leftPos = findColumn(text, left, tabSize);
          if (left == right)
            ranges.push(new Range(Pos(line, leftPos), Pos(line, leftPos)));
          else if (text.length > leftPos)
            ranges.push(new Range(Pos(line, leftPos), Pos(line, findColumn(text, right, tabSize))));
        }
        if (!ranges.length) ranges.push(new Range(start, start));
        setSelection(doc, normalizeSelection(startSel.ranges.slice(0, ourIndex).concat(ranges), ourIndex),
                     {origin: "*mouse", scroll: false});
        cm.scrollIntoView(pos);
      } else {
        var oldRange = ourRange;
        var anchor = oldRange.anchor, head = pos;
        if (type != "single") {
          if (type == "double")
            var range = cm.findWordAt(pos);
          else
            var range = new Range(Pos(pos.line, 0), clipPos(doc, Pos(pos.line + 1, 0)));
          if (cmp(range.anchor, anchor) > 0) {
            head = range.head;
            anchor = minPos(oldRange.from(), range.anchor);
          } else {
            head = range.anchor;
            anchor = maxPos(oldRange.to(), range.head);
          }
        }
        var ranges = startSel.ranges.slice(0);
        ranges[ourIndex] = new Range(clipPos(doc, anchor), head);
        setSelection(doc, normalizeSelection(ranges, ourIndex), sel_mouse);
      }
    }

    var editorSize = display.wrapper.getBoundingClientRect();
    // Used to ensure timeout re-tries don't fire when another extend
    // happened in the meantime (clearTimeout isn't reliable -- at
    // least on Chrome, the timeouts still happen even when cleared,
    // if the clear happens after their scheduled firing time).
    var counter = 0;

    function extend(e) {
      var curCount = ++counter;
      var cur = posFromMouse(cm, e, true, type == "rect");
      if (!cur) return;
      if (cmp(cur, lastPos) != 0) {
        cm.curOp.focus = activeElt();
        extendTo(cur);
        var visible = visibleLines(display, doc);
        if (cur.line >= visible.to || cur.line < visible.from)
          setTimeout(operation(cm, function(){if (counter == curCount) extend(e);}), 150);
      } else {
        var outside = e.clientY < editorSize.top ? -20 : e.clientY > editorSize.bottom ? 20 : 0;
        if (outside) setTimeout(operation(cm, function() {
          if (counter != curCount) return;
          display.scroller.scrollTop += outside;
          extend(e);
        }), 50);
      }
    }

    function done(e) {
      counter = Infinity;
      e_preventDefault(e);
      display.input.focus();
      off(document, "mousemove", move);
      off(document, "mouseup", up);
      doc.history.lastSelOrigin = null;
    }

    var move = operation(cm, function(e) {
      if (!e_button(e)) done(e);
      else extend(e);
    });
    var up = operation(cm, done);
    on(document, "mousemove", move);
    on(document, "mouseup", up);
  }

  // Determines whether an event happened in the gutter, and fires the
  // handlers for the corresponding event.
  function gutterEvent(cm, e, type, prevent, signalfn) {
    try { var mX = e.clientX, mY = e.clientY; }
    catch(e) { return false; }
    if (mX >= Math.floor(cm.display.gutters.getBoundingClientRect().right)) return false;
    if (prevent) e_preventDefault(e);

    var display = cm.display;
    var lineBox = display.lineDiv.getBoundingClientRect();

    if (mY > lineBox.bottom || !hasHandler(cm, type)) return e_defaultPrevented(e);
    mY -= lineBox.top - display.viewOffset;

    for (var i = 0; i < cm.options.gutters.length; ++i) {
      var g = display.gutters.childNodes[i];
      if (g && g.getBoundingClientRect().right >= mX) {
        var line = lineAtHeight(cm.doc, mY);
        var gutter = cm.options.gutters[i];
        signalfn(cm, type, cm, line, gutter, e);
        return e_defaultPrevented(e);
      }
    }
  }

  function clickInGutter(cm, e) {
    return gutterEvent(cm, e, "gutterClick", true, signalLater);
  }

  // Kludge to work around strange IE behavior where it'll sometimes
  // re-fire a series of drag-related events right after the drop (#1551)
  var lastDrop = 0;

  function onDrop(e) {
    var cm = this;
    if (signalDOMEvent(cm, e) || eventInWidget(cm.display, e))
      return;
    e_preventDefault(e);
    if (ie) lastDrop = +new Date;
    var pos = posFromMouse(cm, e, true), files = e.dataTransfer.files;
    if (!pos || isReadOnly(cm)) return;
    // Might be a file drop, in which case we simply extract the text
    // and insert it.
    if (files && files.length && window.FileReader && window.File) {
      var n = files.length, text = Array(n), read = 0;
      var loadFile = function(file, i) {
        var reader = new FileReader;
        reader.onload = operation(cm, function() {
          text[i] = reader.result;
          if (++read == n) {
            pos = clipPos(cm.doc, pos);
            var change = {from: pos, to: pos, text: splitLines(text.join("\n")), origin: "paste"};
            makeChange(cm.doc, change);
            setSelectionReplaceHistory(cm.doc, simpleSelection(pos, changeEnd(change)));
          }
        });
        reader.readAsText(file);
      };
      for (var i = 0; i < n; ++i) loadFile(files[i], i);
    } else { // Normal drop
      // Don't do a replace if the drop happened inside of the selected text.
      if (cm.state.draggingText && cm.doc.sel.contains(pos) > -1) {
        cm.state.draggingText(e);
        // Ensure the editor is re-focused
        setTimeout(function() {cm.display.input.focus();}, 20);
        return;
      }
      try {
        var text = e.dataTransfer.getData("Text");
        if (text) {
          if (cm.state.draggingText && !(mac ? e.altKey : e.ctrlKey))
            var selected = cm.listSelections();
          setSelectionNoUndo(cm.doc, simpleSelection(pos, pos));
          if (selected) for (var i = 0; i < selected.length; ++i)
            replaceRange(cm.doc, "", selected[i].anchor, selected[i].head, "drag");
          cm.replaceSelection(text, "around", "paste");
          cm.display.input.focus();
        }
      }
      catch(e){}
    }
  }

  function onDragStart(cm, e) {
    if (ie && (!cm.state.draggingText || +new Date - lastDrop < 100)) { e_stop(e); return; }
    if (signalDOMEvent(cm, e) || eventInWidget(cm.display, e)) return;

    e.dataTransfer.setData("Text", cm.getSelection());

    // Use dummy image instead of default browsers image.
    // Recent Safari (~6.0.2) have a tendency to segfault when this happens, so we don't do it there.
    if (e.dataTransfer.setDragImage && !safari) {
      var img = elt("img", null, null, "position: fixed; left: 0; top: 0;");
      img.src = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
      if (presto) {
        img.width = img.height = 1;
        cm.display.wrapper.appendChild(img);
        // Force a relayout, or Opera won't use our image for some obscure reason
        img._top = img.offsetTop;
      }
      e.dataTransfer.setDragImage(img, 0, 0);
      if (presto) img.parentNode.removeChild(img);
    }
  }

  // SCROLL EVENTS

  // Sync the scrollable area and scrollbars, ensure the viewport
  // covers the visible area.
  function setScrollTop(cm, val) {
    if (Math.abs(cm.doc.scrollTop - val) < 2) return;
    cm.doc.scrollTop = val;
    if (!gecko) updateDisplaySimple(cm, {top: val});
    if (cm.display.scroller.scrollTop != val) cm.display.scroller.scrollTop = val;
    cm.display.scrollbars.setScrollTop(val);
    if (gecko) updateDisplaySimple(cm);
    startWorker(cm, 100);
  }
  // Sync scroller and scrollbar, ensure the gutter elements are
  // aligned.
  function setScrollLeft(cm, val, isScroller) {
    if (isScroller ? val == cm.doc.scrollLeft : Math.abs(cm.doc.scrollLeft - val) < 2) return;
    val = Math.min(val, cm.display.scroller.scrollWidth - cm.display.scroller.clientWidth);
    cm.doc.scrollLeft = val;
    alignHorizontally(cm);
    if (cm.display.scroller.scrollLeft != val) cm.display.scroller.scrollLeft = val;
    cm.display.scrollbars.setScrollLeft(val);
  }

  // Since the delta values reported on mouse wheel events are
  // unstandardized between browsers and even browser versions, and
  // generally horribly unpredictable, this code starts by measuring
  // the scroll effect that the first few mouse wheel events have,
  // and, from that, detects the way it can convert deltas to pixel
  // offsets afterwards.
  //
  // The reason we want to know the amount a wheel event will scroll
  // is that it gives us a chance to update the display before the
  // actual scrolling happens, reducing flickering.

  var wheelSamples = 0, wheelPixelsPerUnit = null;
  // Fill in a browser-detected starting value on browsers where we
  // know one. These don't have to be accurate -- the result of them
  // being wrong would just be a slight flicker on the first wheel
  // scroll (if it is large enough).
  if (ie) wheelPixelsPerUnit = -.53;
  else if (gecko) wheelPixelsPerUnit = 15;
  else if (chrome) wheelPixelsPerUnit = -.7;
  else if (safari) wheelPixelsPerUnit = -1/3;

  var wheelEventDelta = function(e) {
    var dx = e.wheelDeltaX, dy = e.wheelDeltaY;
    if (dx == null && e.detail && e.axis == e.HORIZONTAL_AXIS) dx = e.detail;
    if (dy == null && e.detail && e.axis == e.VERTICAL_AXIS) dy = e.detail;
    else if (dy == null) dy = e.wheelDelta;
    return {x: dx, y: dy};
  };
  CodeMirror.wheelEventPixels = function(e) {
    var delta = wheelEventDelta(e);
    delta.x *= wheelPixelsPerUnit;
    delta.y *= wheelPixelsPerUnit;
    return delta;
  };

  function onScrollWheel(cm, e) {
    var delta = wheelEventDelta(e), dx = delta.x, dy = delta.y;

    var display = cm.display, scroll = display.scroller;
    // Quit if there's nothing to scroll here
    if (!(dx && scroll.scrollWidth > scroll.clientWidth ||
          dy && scroll.scrollHeight > scroll.clientHeight)) return;

    // Webkit browsers on OS X abort momentum scrolls when the target
    // of the scroll event is removed from the scrollable element.
    // This hack (see related code in patchDisplay) makes sure the
    // element is kept around.
    if (dy && mac && webkit) {
      outer: for (var cur = e.target, view = display.view; cur != scroll; cur = cur.parentNode) {
        for (var i = 0; i < view.length; i++) {
          if (view[i].node == cur) {
            cm.display.currentWheelTarget = cur;
            break outer;
          }
        }
      }
    }

    // On some browsers, horizontal scrolling will cause redraws to
    // happen before the gutter has been realigned, causing it to
    // wriggle around in a most unseemly way. When we have an
    // estimated pixels/delta value, we just handle horizontal
    // scrolling entirely here. It'll be slightly off from native, but
    // better than glitching out.
    if (dx && !gecko && !presto && wheelPixelsPerUnit != null) {
      if (dy)
        setScrollTop(cm, Math.max(0, Math.min(scroll.scrollTop + dy * wheelPixelsPerUnit, scroll.scrollHeight - scroll.clientHeight)));
      setScrollLeft(cm, Math.max(0, Math.min(scroll.scrollLeft + dx * wheelPixelsPerUnit, scroll.scrollWidth - scroll.clientWidth)));
      e_preventDefault(e);
      display.wheelStartX = null; // Abort measurement, if in progress
      return;
    }

    // 'Project' the visible viewport to cover the area that is being
    // scrolled into view (if we know enough to estimate it).
    if (dy && wheelPixelsPerUnit != null) {
      var pixels = dy * wheelPixelsPerUnit;
      var top = cm.doc.scrollTop, bot = top + display.wrapper.clientHeight;
      if (pixels < 0) top = Math.max(0, top + pixels - 50);
      else bot = Math.min(cm.doc.height, bot + pixels + 50);
      updateDisplaySimple(cm, {top: top, bottom: bot});
    }

    if (wheelSamples < 20) {
      if (display.wheelStartX == null) {
        display.wheelStartX = scroll.scrollLeft; display.wheelStartY = scroll.scrollTop;
        display.wheelDX = dx; display.wheelDY = dy;
        setTimeout(function() {
          if (display.wheelStartX == null) return;
          var movedX = scroll.scrollLeft - display.wheelStartX;
          var movedY = scroll.scrollTop - display.wheelStartY;
          var sample = (movedY && display.wheelDY && movedY / display.wheelDY) ||
            (movedX && display.wheelDX && movedX / display.wheelDX);
          display.wheelStartX = display.wheelStartY = null;
          if (!sample) return;
          wheelPixelsPerUnit = (wheelPixelsPerUnit * wheelSamples + sample) / (wheelSamples + 1);
          ++wheelSamples;
        }, 200);
      } else {
        display.wheelDX += dx; display.wheelDY += dy;
      }
    }
  }

  // KEY EVENTS

  // Run a handler that was bound to a key.
  function doHandleBinding(cm, bound, dropShift) {
    if (typeof bound == "string") {
      bound = commands[bound];
      if (!bound) return false;
    }
    // Ensure previous input has been read, so that the handler sees a
    // consistent view of the document
    cm.display.input.ensurePolled();
    var prevShift = cm.display.shift, done = false;
    try {
      if (isReadOnly(cm)) cm.state.suppressEdits = true;
      if (dropShift) cm.display.shift = false;
      done = bound(cm) != Pass;
    } finally {
      cm.display.shift = prevShift;
      cm.state.suppressEdits = false;
    }
    return done;
  }

  function lookupKeyForEditor(cm, name, handle) {
    for (var i = 0; i < cm.state.keyMaps.length; i++) {
      var result = lookupKey(name, cm.state.keyMaps[i], handle, cm);
      if (result) return result;
    }
    return (cm.options.extraKeys && lookupKey(name, cm.options.extraKeys, handle, cm))
      || lookupKey(name, cm.options.keyMap, handle, cm);
  }

  var stopSeq = new Delayed;
  function dispatchKey(cm, name, e, handle) {
    var seq = cm.state.keySeq;
    if (seq) {
      if (isModifierKey(name)) return "handled";
      stopSeq.set(50, function() {
        if (cm.state.keySeq == seq) {
          cm.state.keySeq = null;
          cm.display.input.reset();
        }
      });
      name = seq + " " + name;
    }
    var result = lookupKeyForEditor(cm, name, handle);

    if (result == "multi")
      cm.state.keySeq = name;
    if (result == "handled")
      signalLater(cm, "keyHandled", cm, name, e);

    if (result == "handled" || result == "multi") {
      e_preventDefault(e);
      restartBlink(cm);
    }

    if (seq && !result && /\'$/.test(name)) {
      e_preventDefault(e);
      return true;
    }
    return !!result;
  }

  // Handle a key from the keydown event.
  function handleKeyBinding(cm, e) {
    var name = keyName(e, true);
    if (!name) return false;

    if (e.shiftKey && !cm.state.keySeq) {
      // First try to resolve full name (including 'Shift-'). Failing
      // that, see if there is a cursor-motion command (starting with
      // 'go') bound to the keyname without 'Shift-'.
      return dispatchKey(cm, "Shift-" + name, e, function(b) {return doHandleBinding(cm, b, true);})
          || dispatchKey(cm, name, e, function(b) {
               if (typeof b == "string" ? /^go[A-Z]/.test(b) : b.motion)
                 return doHandleBinding(cm, b);
             });
    } else {
      return dispatchKey(cm, name, e, function(b) { return doHandleBinding(cm, b); });
    }
  }

  // Handle a key from the keypress event
  function handleCharBinding(cm, e, ch) {
    return dispatchKey(cm, "'" + ch + "'", e,
                       function(b) { return doHandleBinding(cm, b, true); });
  }

  var lastStoppedKey = null;
  function onKeyDown(e) {
    var cm = this;
    cm.curOp.focus = activeElt();
    if (signalDOMEvent(cm, e)) return;
    // IE does strange things with escape.
    if (ie && ie_version < 11 && e.keyCode == 27) e.returnValue = false;
    var code = e.keyCode;
    cm.display.shift = code == 16 || e.shiftKey;
    var handled = handleKeyBinding(cm, e);
    if (presto) {
      lastStoppedKey = handled ? code : null;
      // Opera has no cut event... we try to at least catch the key combo
      if (!handled && code == 88 && !hasCopyEvent && (mac ? e.metaKey : e.ctrlKey))
        cm.replaceSelection("", null, "cut");
    }

    // Turn mouse into crosshair when Alt is held on Mac.
    if (code == 18 && !/\bCodeMirror-crosshair\b/.test(cm.display.lineDiv.className))
      showCrossHair(cm);
  }

  function showCrossHair(cm) {
    var lineDiv = cm.display.lineDiv;
    addClass(lineDiv, "CodeMirror-crosshair");

    function up(e) {
      if (e.keyCode == 18 || !e.altKey) {
        rmClass(lineDiv, "CodeMirror-crosshair");
        off(document, "keyup", up);
        off(document, "mouseover", up);
      }
    }
    on(document, "keyup", up);
    on(document, "mouseover", up);
  }

  function onKeyUp(e) {
    if (e.keyCode == 16) this.doc.sel.shift = false;
    signalDOMEvent(this, e);
  }

  function onKeyPress(e) {
    var cm = this;
    if (eventInWidget(cm.display, e) || signalDOMEvent(cm, e) || e.ctrlKey && !e.altKey || mac && e.metaKey) return;
    var keyCode = e.keyCode, charCode = e.charCode;
    if (presto && keyCode == lastStoppedKey) {lastStoppedKey = null; e_preventDefault(e); return;}
    if ((presto && (!e.which || e.which < 10)) && handleKeyBinding(cm, e)) return;
    var ch = String.fromCharCode(charCode == null ? keyCode : charCode);
    if (handleCharBinding(cm, e, ch)) return;
    cm.display.input.onKeyPress(e);
  }

  // FOCUS/BLUR EVENTS

  function delayBlurEvent(cm) {
    cm.state.delayingBlurEvent = true;
    setTimeout(function() {
      if (cm.state.delayingBlurEvent) {
        cm.state.delayingBlurEvent = false;
        onBlur(cm);
      }
    }, 100);
  }

  function onFocus(cm) {
    if (cm.state.delayingBlurEvent) cm.state.delayingBlurEvent = false;

    if (cm.options.readOnly == "nocursor") return;
    if (!cm.state.focused) {
      signal(cm, "focus", cm);
      cm.state.focused = true;
      addClass(cm.display.wrapper, "CodeMirror-focused");
      // This test prevents this from firing when a context
      // menu is closed (since the input reset would kill the
      // select-all detection hack)
      if (!cm.curOp && cm.display.selForContextMenu != cm.doc.sel) {
        cm.display.input.reset();
        if (webkit) setTimeout(function() { cm.display.input.reset(true); }, 20); // Issue #1730
      }
      cm.display.input.receivedFocus();
    }
    restartBlink(cm);
  }
  function onBlur(cm) {
    if (cm.state.delayingBlurEvent) return;

    if (cm.state.focused) {
      signal(cm, "blur", cm);
      cm.state.focused = false;
      rmClass(cm.display.wrapper, "CodeMirror-focused");
    }
    clearInterval(cm.display.blinker);
    setTimeout(function() {if (!cm.state.focused) cm.display.shift = false;}, 150);
  }

  // CONTEXT MENU HANDLING

  // To make the context menu work, we need to briefly unhide the
  // textarea (making it as unobtrusive as possible) to let the
  // right-click take effect on it.
  function onContextMenu(cm, e) {
    if (eventInWidget(cm.display, e) || contextMenuInGutter(cm, e)) return;
    cm.display.input.onContextMenu(e);
  }

  function contextMenuInGutter(cm, e) {
    if (!hasHandler(cm, "gutterContextMenu")) return false;
    return gutterEvent(cm, e, "gutterContextMenu", false, signal);
  }

  // UPDATING

  // Compute the position of the end of a change (its 'to' property
  // refers to the pre-change end).
  var changeEnd = CodeMirror.changeEnd = function(change) {
    if (!change.text) return change.to;
    return Pos(change.from.line + change.text.length - 1,
               lst(change.text).length + (change.text.length == 1 ? change.from.ch : 0));
  };

  // Adjust a position to refer to the post-change position of the
  // same text, or the end of the change if the change covers it.
  function adjustForChange(pos, change) {
    if (cmp(pos, change.from) < 0) return pos;
    if (cmp(pos, change.to) <= 0) return changeEnd(change);

    var line = pos.line + change.text.length - (change.to.line - change.from.line) - 1, ch = pos.ch;
    if (pos.line == change.to.line) ch += changeEnd(change).ch - change.to.ch;
    return Pos(line, ch);
  }

  function computeSelAfterChange(doc, change) {
    var out = [];
    for (var i = 0; i < doc.sel.ranges.length; i++) {
      var range = doc.sel.ranges[i];
      out.push(new Range(adjustForChange(range.anchor, change),
                         adjustForChange(range.head, change)));
    }
    return normalizeSelection(out, doc.sel.primIndex);
  }

  function offsetPos(pos, old, nw) {
    if (pos.line == old.line)
      return Pos(nw.line, pos.ch - old.ch + nw.ch);
    else
      return Pos(nw.line + (pos.line - old.line), pos.ch);
  }

  // Used by replaceSelections to allow moving the selection to the
  // start or around the replaced test. Hint may be "start" or "around".
  function computeReplacedSel(doc, changes, hint) {
    var out = [];
    var oldPrev = Pos(doc.first, 0), newPrev = oldPrev;
    for (var i = 0; i < changes.length; i++) {
      var change = changes[i];
      var from = offsetPos(change.from, oldPrev, newPrev);
      var to = offsetPos(changeEnd(change), oldPrev, newPrev);
      oldPrev = change.to;
      newPrev = to;
      if (hint == "around") {
        var range = doc.sel.ranges[i], inv = cmp(range.head, range.anchor) < 0;
        out[i] = new Range(inv ? to : from, inv ? from : to);
      } else {
        out[i] = new Range(from, from);
      }
    }
    return new Selection(out, doc.sel.primIndex);
  }

  // Allow "beforeChange" event handlers to influence a change
  function filterChange(doc, change, update) {
    var obj = {
      canceled: false,
      from: change.from,
      to: change.to,
      text: change.text,
      origin: change.origin,
      cancel: function() { this.canceled = true; }
    };
    if (update) obj.update = function(from, to, text, origin) {
      if (from) this.from = clipPos(doc, from);
      if (to) this.to = clipPos(doc, to);
      if (text) this.text = text;
      if (origin !== undefined) this.origin = origin;
    };
    signal(doc, "beforeChange", doc, obj);
    if (doc.cm) signal(doc.cm, "beforeChange", doc.cm, obj);

    if (obj.canceled) return null;
    return {from: obj.from, to: obj.to, text: obj.text, origin: obj.origin};
  }

  // Apply a change to a document, and add it to the document's
  // history, and propagating it to all linked documents.
  function makeChange(doc, change, ignoreReadOnly) {
    if (doc.cm) {
      if (!doc.cm.curOp) return operation(doc.cm, makeChange)(doc, change, ignoreReadOnly);
      if (doc.cm.state.suppressEdits) return;
    }

    if (hasHandler(doc, "beforeChange") || doc.cm && hasHandler(doc.cm, "beforeChange")) {
      change = filterChange(doc, change, true);
      if (!change) return;
    }

    // Possibly split or suppress the update based on the presence
    // of read-only spans in its range.
    var split = sawReadOnlySpans && !ignoreReadOnly && removeReadOnlyRanges(doc, change.from, change.to);
    if (split) {
      for (var i = split.length - 1; i >= 0; --i)
        makeChangeInner(doc, {from: split[i].from, to: split[i].to, text: i ? [""] : change.text});
    } else {
      makeChangeInner(doc, change);
    }
  }

  function makeChangeInner(doc, change) {
    if (change.text.length == 1 && change.text[0] == "" && cmp(change.from, change.to) == 0) return;
    var selAfter = computeSelAfterChange(doc, change);
    addChangeToHistory(doc, change, selAfter, doc.cm ? doc.cm.curOp.id : NaN);

    makeChangeSingleDoc(doc, change, selAfter, stretchSpansOverChange(doc, change));
    var rebased = [];

    linkedDocs(doc, function(doc, sharedHist) {
      if (!sharedHist && indexOf(rebased, doc.history) == -1) {
        rebaseHist(doc.history, change);
        rebased.push(doc.history);
      }
      makeChangeSingleDoc(doc, change, null, stretchSpansOverChange(doc, change));
    });
  }

  // Revert a change stored in a document's history.
  function makeChangeFromHistory(doc, type, allowSelectionOnly) {
    if (doc.cm && doc.cm.state.suppressEdits) return;

    var hist = doc.history, event, selAfter = doc.sel;
    var source = type == "undo" ? hist.done : hist.undone, dest = type == "undo" ? hist.undone : hist.done;

    // Verify that there is a useable event (so that ctrl-z won't
    // needlessly clear selection events)
    for (var i = 0; i < source.length; i++) {
      event = source[i];
      if (allowSelectionOnly ? event.ranges && !event.equals(doc.sel) : !event.ranges)
        break;
    }
    if (i == source.length) return;
    hist.lastOrigin = hist.lastSelOrigin = null;

    for (;;) {
      event = source.pop();
      if (event.ranges) {
        pushSelectionToHistory(event, dest);
        if (allowSelectionOnly && !event.equals(doc.sel)) {
          setSelection(doc, event, {clearRedo: false});
          return;
        }
        selAfter = event;
      }
      else break;
    }

    // Build up a reverse change object to add to the opposite history
    // stack (redo when undoing, and vice versa).
    var antiChanges = [];
    pushSelectionToHistory(selAfter, dest);
    dest.push({changes: antiChanges, generation: hist.generation});
    hist.generation = event.generation || ++hist.maxGeneration;

    var filter = hasHandler(doc, "beforeChange") || doc.cm && hasHandler(doc.cm, "beforeChange");

    for (var i = event.changes.length - 1; i >= 0; --i) {
      var change = event.changes[i];
      change.origin = type;
      if (filter && !filterChange(doc, change, false)) {
        source.length = 0;
        return;
      }

      antiChanges.push(historyChangeFromChange(doc, change));

      var after = i ? computeSelAfterChange(doc, change) : lst(source);
      makeChangeSingleDoc(doc, change, after, mergeOldSpans(doc, change));
      if (!i && doc.cm) doc.cm.scrollIntoView({from: change.from, to: changeEnd(change)});
      var rebased = [];

      // Propagate to the linked documents
      linkedDocs(doc, function(doc, sharedHist) {
        if (!sharedHist && indexOf(rebased, doc.history) == -1) {
          rebaseHist(doc.history, change);
          rebased.push(doc.history);
        }
        makeChangeSingleDoc(doc, change, null, mergeOldSpans(doc, change));
      });
    }
  }

  // Sub-views need their line numbers shifted when text is added
  // above or below them in the parent document.
  function shiftDoc(doc, distance) {
    if (distance == 0) return;
    doc.first += distance;
    doc.sel = new Selection(map(doc.sel.ranges, function(range) {
      return new Range(Pos(range.anchor.line + distance, range.anchor.ch),
                       Pos(range.head.line + distance, range.head.ch));
    }), doc.sel.primIndex);
    if (doc.cm) {
      regChange(doc.cm, doc.first, doc.first - distance, distance);
      for (var d = doc.cm.display, l = d.viewFrom; l < d.viewTo; l++)
        regLineChange(doc.cm, l, "gutter");
    }
  }

  // More lower-level change function, handling only a single document
  // (not linked ones).
  function makeChangeSingleDoc(doc, change, selAfter, spans) {
    if (doc.cm && !doc.cm.curOp)
      return operation(doc.cm, makeChangeSingleDoc)(doc, change, selAfter, spans);

    if (change.to.line < doc.first) {
      shiftDoc(doc, change.text.length - 1 - (change.to.line - change.from.line));
      return;
    }
    if (change.from.line > doc.lastLine()) return;

    // Clip the change to the size of this doc
    if (change.from.line < doc.first) {
      var shift = change.text.length - 1 - (doc.first - change.from.line);
      shiftDoc(doc, shift);
      change = {from: Pos(doc.first, 0), to: Pos(change.to.line + shift, change.to.ch),
                text: [lst(change.text)], origin: change.origin};
    }
    var last = doc.lastLine();
    if (change.to.line > last) {
      change = {from: change.from, to: Pos(last, getLine(doc, last).text.length),
                text: [change.text[0]], origin: change.origin};
    }

    change.removed = getBetween(doc, change.from, change.to);

    if (!selAfter) selAfter = computeSelAfterChange(doc, change);
    if (doc.cm) makeChangeSingleDocInEditor(doc.cm, change, spans);
    else updateDoc(doc, change, spans);
    setSelectionNoUndo(doc, selAfter, sel_dontScroll);
  }

  // Handle the interaction of a change to a document with the editor
  // that this document is part of.
  function makeChangeSingleDocInEditor(cm, change, spans) {
    var doc = cm.doc, display = cm.display, from = change.from, to = change.to;

    var recomputeMaxLength = false, checkWidthStart = from.line;
    if (!cm.options.lineWrapping) {
      checkWidthStart = lineNo(visualLine(getLine(doc, from.line)));
      doc.iter(checkWidthStart, to.line + 1, function(line) {
        if (line == display.maxLine) {
          recomputeMaxLength = true;
          return true;
        }
      });
    }

    if (doc.sel.contains(change.from, change.to) > -1)
      signalCursorActivity(cm);

    updateDoc(doc, change, spans, estimateHeight(cm));

    if (!cm.options.lineWrapping) {
      doc.iter(checkWidthStart, from.line + change.text.length, function(line) {
        var len = lineLength(line);
        if (len > display.maxLineLength) {
          display.maxLine = line;
          display.maxLineLength = len;
          display.maxLineChanged = true;
          recomputeMaxLength = false;
        }
      });
      if (recomputeMaxLength) cm.curOp.updateMaxLine = true;
    }

    // Adjust frontier, schedule worker
    doc.frontier = Math.min(doc.frontier, from.line);
    startWorker(cm, 400);

    var lendiff = change.text.length - (to.line - from.line) - 1;
    // Remember that these lines changed, for updating the display
    if (change.full)
      regChange(cm);
    else if (from.line == to.line && change.text.length == 1 && !isWholeLineUpdate(cm.doc, change))
      regLineChange(cm, from.line, "text");
    else
      regChange(cm, from.line, to.line + 1, lendiff);

    var changesHandler = hasHandler(cm, "changes"), changeHandler = hasHandler(cm, "change");
    if (changeHandler || changesHandler) {
      var obj = {
        from: from, to: to,
        text: change.text,
        removed: change.removed,
        origin: change.origin
      };
      if (changeHandler) signalLater(cm, "change", cm, obj);
      if (changesHandler) (cm.curOp.changeObjs || (cm.curOp.changeObjs = [])).push(obj);
    }
    cm.display.selForContextMenu = null;
  }

  function replaceRange(doc, code, from, to, origin) {
    if (!to) to = from;
    if (cmp(to, from) < 0) { var tmp = to; to = from; from = tmp; }
    if (typeof code == "string") code = splitLines(code);
    makeChange(doc, {from: from, to: to, text: code, origin: origin});
  }

  // SCROLLING THINGS INTO VIEW

  // If an editor sits on the top or bottom of the window, partially
  // scrolled out of view, this ensures that the cursor is visible.
  function maybeScrollWindow(cm, coords) {
    if (signalDOMEvent(cm, "scrollCursorIntoView")) return;

    var display = cm.display, box = display.sizer.getBoundingClientRect(), doScroll = null;
    if (coords.top + box.top < 0) doScroll = true;
    else if (coords.bottom + box.top > (window.innerHeight || document.documentElement.clientHeight)) doScroll = false;
    if (doScroll != null && !phantom) {
      var scrollNode = elt("div", "\u200b", null, "position: absolute; top: " +
                           (coords.top - display.viewOffset - paddingTop(cm.display)) + "px; height: " +
                           (coords.bottom - coords.top + scrollGap(cm) + display.barHeight) + "px; left: " +
                           coords.left + "px; width: 2px;");
      cm.display.lineSpace.appendChild(scrollNode);
      scrollNode.scrollIntoView(doScroll);
      cm.display.lineSpace.removeChild(scrollNode);
    }
  }

  // Scroll a given position into view (immediately), verifying that
  // it actually became visible (as line heights are accurately
  // measured, the position of something may 'drift' during drawing).
  function scrollPosIntoView(cm, pos, end, margin) {
    if (margin == null) margin = 0;
    for (var limit = 0; limit < 5; limit++) {
      var changed = false, coords = cursorCoords(cm, pos);
      var endCoords = !end || end == pos ? coords : cursorCoords(cm, end);
      var scrollPos = calculateScrollPos(cm, Math.min(coords.left, endCoords.left),
                                         Math.min(coords.top, endCoords.top) - margin,
                                         Math.max(coords.left, endCoords.left),
                                         Math.max(coords.bottom, endCoords.bottom) + margin);
      var startTop = cm.doc.scrollTop, startLeft = cm.doc.scrollLeft;
      if (scrollPos.scrollTop != null) {
        setScrollTop(cm, scrollPos.scrollTop);
        if (Math.abs(cm.doc.scrollTop - startTop) > 1) changed = true;
      }
      if (scrollPos.scrollLeft != null) {
        setScrollLeft(cm, scrollPos.scrollLeft);
        if (Math.abs(cm.doc.scrollLeft - startLeft) > 1) changed = true;
      }
      if (!changed) break;
    }
    return coords;
  }

  // Scroll a given set of coordinates into view (immediately).
  function scrollIntoView(cm, x1, y1, x2, y2) {
    var scrollPos = calculateScrollPos(cm, x1, y1, x2, y2);
    if (scrollPos.scrollTop != null) setScrollTop(cm, scrollPos.scrollTop);
    if (scrollPos.scrollLeft != null) setScrollLeft(cm, scrollPos.scrollLeft);
  }

  // Calculate a new scroll position needed to scroll the given
  // rectangle into view. Returns an object with scrollTop and
  // scrollLeft properties. When these are undefined, the
  // vertical/horizontal position does not need to be adjusted.
  function calculateScrollPos(cm, x1, y1, x2, y2) {
    var display = cm.display, snapMargin = textHeight(cm.display);
    if (y1 < 0) y1 = 0;
    var screentop = cm.curOp && cm.curOp.scrollTop != null ? cm.curOp.scrollTop : display.scroller.scrollTop;
    var screen = displayHeight(cm), result = {};
    if (y2 - y1 > screen) y2 = y1 + screen;
    var docBottom = cm.doc.height + paddingVert(display);
    var atTop = y1 < snapMargin, atBottom = y2 > docBottom - snapMargin;
    if (y1 < screentop) {
      result.scrollTop = atTop ? 0 : y1;
    } else if (y2 > screentop + screen) {
      var newTop = Math.min(y1, (atBottom ? docBottom : y2) - screen);
      if (newTop != screentop) result.scrollTop = newTop;
    }

    var screenleft = cm.curOp && cm.curOp.scrollLeft != null ? cm.curOp.scrollLeft : display.scroller.scrollLeft;
    var screenw = displayWidth(cm) - (cm.options.fixedGutter ? display.gutters.offsetWidth : 0);
    var tooWide = x2 - x1 > screenw;
    if (tooWide) x2 = x1 + screenw;
    if (x1 < 10)
      result.scrollLeft = 0;
    else if (x1 < screenleft)
      result.scrollLeft = Math.max(0, x1 - (tooWide ? 0 : 10));
    else if (x2 > screenw + screenleft - 3)
      result.scrollLeft = x2 + (tooWide ? 0 : 10) - screenw;
    return result;
  }

  // Store a relative adjustment to the scroll position in the current
  // operation (to be applied when the operation finishes).
  function addToScrollPos(cm, left, top) {
    if (left != null || top != null) resolveScrollToPos(cm);
    if (left != null)
      cm.curOp.scrollLeft = (cm.curOp.scrollLeft == null ? cm.doc.scrollLeft : cm.curOp.scrollLeft) + left;
    if (top != null)
      cm.curOp.scrollTop = (cm.curOp.scrollTop == null ? cm.doc.scrollTop : cm.curOp.scrollTop) + top;
  }

  // Make sure that at the end of the operation the current cursor is
  // shown.
  function ensureCursorVisible(cm) {
    resolveScrollToPos(cm);
    var cur = cm.getCursor(), from = cur, to = cur;
    if (!cm.options.lineWrapping) {
      from = cur.ch ? Pos(cur.line, cur.ch - 1) : cur;
      to = Pos(cur.line, cur.ch + 1);
    }
    cm.curOp.scrollToPos = {from: from, to: to, margin: cm.options.cursorScrollMargin, isCursor: true};
  }

  // When an operation has its scrollToPos property set, and another
  // scroll action is applied before the end of the operation, this
  // 'simulates' scrolling that position into view in a cheap way, so
  // that the effect of intermediate scroll commands is not ignored.
  function resolveScrollToPos(cm) {
    var range = cm.curOp.scrollToPos;
    if (range) {
      cm.curOp.scrollToPos = null;
      var from = estimateCoords(cm, range.from), to = estimateCoords(cm, range.to);
      var sPos = calculateScrollPos(cm, Math.min(from.left, to.left),
                                    Math.min(from.top, to.top) - range.margin,
                                    Math.max(from.right, to.right),
                                    Math.max(from.bottom, to.bottom) + range.margin);
      cm.scrollTo(sPos.scrollLeft, sPos.scrollTop);
    }
  }

  // API UTILITIES

  // Indent the given line. The how parameter can be "smart",
  // "add"/null, "subtract", or "prev". When aggressive is false
  // (typically set to true for forced single-line indents), empty
  // lines are not indented, and places where the mode returns Pass
  // are left alone.
  function indentLine(cm, n, how, aggressive) {
    var doc = cm.doc, state;
    if (how == null) how = "add";
    if (how == "smart") {
      // Fall back to "prev" when the mode doesn't have an indentation
      // method.
      if (!doc.mode.indent) how = "prev";
      else state = getStateBefore(cm, n);
    }

    var tabSize = cm.options.tabSize;
    var line = getLine(doc, n), curSpace = countColumn(line.text, null, tabSize);
    if (line.stateAfter) line.stateAfter = null;
    var curSpaceString = line.text.match(/^\s*/)[0], indentation;
    if (!aggressive && !/\S/.test(line.text)) {
      indentation = 0;
      how = "not";
    } else if (how == "smart") {
      indentation = doc.mode.indent(state, line.text.slice(curSpaceString.length), line.text);
      if (indentation == Pass || indentation > 150) {
        if (!aggressive) return;
        how = "prev";
      }
    }
    if (how == "prev") {
      if (n > doc.first) indentation = countColumn(getLine(doc, n-1).text, null, tabSize);
      else indentation = 0;
    } else if (how == "add") {
      indentation = curSpace + cm.options.indentUnit;
    } else if (how == "subtract") {
      indentation = curSpace - cm.options.indentUnit;
    } else if (typeof how == "number") {
      indentation = curSpace + how;
    }
    indentation = Math.max(0, indentation);

    var indentString = "", pos = 0;
    if (cm.options.indentWithTabs)
      for (var i = Math.floor(indentation / tabSize); i; --i) {pos += tabSize; indentString += "\t";}
    if (pos < indentation) indentString += spaceStr(indentation - pos);

    if (indentString != curSpaceString) {
      replaceRange(doc, indentString, Pos(n, 0), Pos(n, curSpaceString.length), "+input");
      line.stateAfter = null;
      return true;
    } else {
      // Ensure that, if the cursor was in the whitespace at the start
      // of the line, it is moved to the end of that space.
      for (var i = 0; i < doc.sel.ranges.length; i++) {
        var range = doc.sel.ranges[i];
        if (range.head.line == n && range.head.ch < curSpaceString.length) {
          var pos = Pos(n, curSpaceString.length);
          replaceOneSelection(doc, i, new Range(pos, pos));
          break;
        }
      }
    }
  }

  // Utility for applying a change to a line by handle or number,
  // returning the number and optionally registering the line as
  // changed.
  function changeLine(doc, handle, changeType, op) {
    var no = handle, line = handle;
    if (typeof handle == "number") line = getLine(doc, clipLine(doc, handle));
    else no = lineNo(handle);
    if (no == null) return null;
    if (op(line, no) && doc.cm) regLineChange(doc.cm, no, changeType);
    return line;
  }

  // Helper for deleting text near the selection(s), used to implement
  // backspace, delete, and similar functionality.
  function deleteNearSelection(cm, compute) {
    var ranges = cm.doc.sel.ranges, kill = [];
    // Build up a set of ranges to kill first, merging overlapping
    // ranges.
    for (var i = 0; i < ranges.length; i++) {
      var toKill = compute(ranges[i]);
      while (kill.length && cmp(toKill.from, lst(kill).to) <= 0) {
        var replaced = kill.pop();
        if (cmp(replaced.from, toKill.from) < 0) {
          toKill.from = replaced.from;
          break;
        }
      }
      kill.push(toKill);
    }
    // Next, remove those actual ranges.
    runInOp(cm, function() {
      for (var i = kill.length - 1; i >= 0; i--)
        replaceRange(cm.doc, "", kill[i].from, kill[i].to, "+delete");
      ensureCursorVisible(cm);
    });
  }

  // Used for horizontal relative motion. Dir is -1 or 1 (left or
  // right), unit can be "char", "column" (like char, but doesn't
  // cross line boundaries), "word" (across next word), or "group" (to
  // the start of next group of word or non-word-non-whitespace
  // chars). The visually param controls whether, in right-to-left
  // text, direction 1 means to move towards the next index in the
  // string, or towards the character to the right of the current
  // position. The resulting position will have a hitSide=true
  // property if it reached the end of the document.
  function findPosH(doc, pos, dir, unit, visually) {
    var line = pos.line, ch = pos.ch, origDir = dir;
    var lineObj = getLine(doc, line);
    var possible = true;
    function findNextLine() {
      var l = line + dir;
      if (l < doc.first || l >= doc.first + doc.size) return (possible = false);
      line = l;
      return lineObj = getLine(doc, l);
    }
    function moveOnce(boundToLine) {
      var next = (visually ? moveVisually : moveLogically)(lineObj, ch, dir, true);
      if (next == null) {
        if (!boundToLine && findNextLine()) {
          if (visually) ch = (dir < 0 ? lineRight : lineLeft)(lineObj);
          else ch = dir < 0 ? lineObj.text.length : 0;
        } else return (possible = false);
      } else ch = next;
      return true;
    }

    if (unit == "char") moveOnce();
    else if (unit == "column") moveOnce(true);
    else if (unit == "word" || unit == "group") {
      var sawType = null, group = unit == "group";
      var helper = doc.cm && doc.cm.getHelper(pos, "wordChars");
      for (var first = true;; first = false) {
        if (dir < 0 && !moveOnce(!first)) break;
        var cur = lineObj.text.charAt(ch) || "\n";
        var type = isWordChar(cur, helper) ? "w"
          : group && cur == "\n" ? "n"
          : !group || /\s/.test(cur) ? null
          : "p";
        if (group && !first && !type) type = "s";
        if (sawType && sawType != type) {
          if (dir < 0) {dir = 1; moveOnce();}
          break;
        }

        if (type) sawType = type;
        if (dir > 0 && !moveOnce(!first)) break;
      }
    }
    var result = skipAtomic(doc, Pos(line, ch), origDir, true);
    if (!possible) result.hitSide = true;
    return result;
  }

  // For relative vertical movement. Dir may be -1 or 1. Unit can be
  // "page" or "line". The resulting position will have a hitSide=true
  // property if it reached the end of the document.
  function findPosV(cm, pos, dir, unit) {
    var doc = cm.doc, x = pos.left, y;
    if (unit == "page") {
      var pageSize = Math.min(cm.display.wrapper.clientHeight, window.innerHeight || document.documentElement.clientHeight);
      y = pos.top + dir * (pageSize - (dir < 0 ? 1.5 : .5) * textHeight(cm.display));
    } else if (unit == "line") {
      y = dir > 0 ? pos.bottom + 3 : pos.top - 3;
    }
    for (;;) {
      var target = coordsChar(cm, x, y);
      if (!target.outside) break;
      if (dir < 0 ? y <= 0 : y >= doc.height) { target.hitSide = true; break; }
      y += dir * 5;
    }
    return target;
  }

  // EDITOR METHODS

  // The publicly visible API. Note that methodOp(f) means
  // 'wrap f in an operation, performed on its `this` parameter'.

  // This is not the complete set of editor methods. Most of the
  // methods defined on the Doc type are also injected into
  // CodeMirror.prototype, for backwards compatibility and
  // convenience.

  CodeMirror.prototype = {
    constructor: CodeMirror,
    focus: function(){window.focus(); this.display.input.focus();},

    setOption: function(option, value) {
      var options = this.options, old = options[option];
      if (options[option] == value && option != "mode") return;
      options[option] = value;
      if (optionHandlers.hasOwnProperty(option))
        operation(this, optionHandlers[option])(this, value, old);
    },

    getOption: function(option) {return this.options[option];},
    getDoc: function() {return this.doc;},

    addKeyMap: function(map, bottom) {
      this.state.keyMaps[bottom ? "push" : "unshift"](getKeyMap(map));
    },
    removeKeyMap: function(map) {
      var maps = this.state.keyMaps;
      for (var i = 0; i < maps.length; ++i)
        if (maps[i] == map || maps[i].name == map) {
          maps.splice(i, 1);
          return true;
        }
    },

    addOverlay: methodOp(function(spec, options) {
      var mode = spec.token ? spec : CodeMirror.getMode(this.options, spec);
      if (mode.startState) throw new Error("Overlays may not be stateful.");
      this.state.overlays.push({mode: mode, modeSpec: spec, opaque: options && options.opaque});
      this.state.modeGen++;
      regChange(this);
    }),
    removeOverlay: methodOp(function(spec) {
      var overlays = this.state.overlays;
      for (var i = 0; i < overlays.length; ++i) {
        var cur = overlays[i].modeSpec;
        if (cur == spec || typeof spec == "string" && cur.name == spec) {
          overlays.splice(i, 1);
          this.state.modeGen++;
          regChange(this);
          return;
        }
      }
    }),

    indentLine: methodOp(function(n, dir, aggressive) {
      if (typeof dir != "string" && typeof dir != "number") {
        if (dir == null) dir = this.options.smartIndent ? "smart" : "prev";
        else dir = dir ? "add" : "subtract";
      }
      if (isLine(this.doc, n)) indentLine(this, n, dir, aggressive);
    }),
    indentSelection: methodOp(function(how) {
      var ranges = this.doc.sel.ranges, end = -1;
      for (var i = 0; i < ranges.length; i++) {
        var range = ranges[i];
        if (!range.empty()) {
          var from = range.from(), to = range.to();
          var start = Math.max(end, from.line);
          end = Math.min(this.lastLine(), to.line - (to.ch ? 0 : 1)) + 1;
          for (var j = start; j < end; ++j)
            indentLine(this, j, how);
          var newRanges = this.doc.sel.ranges;
          if (from.ch == 0 && ranges.length == newRanges.length && newRanges[i].from().ch > 0)
            replaceOneSelection(this.doc, i, new Range(from, newRanges[i].to()), sel_dontScroll);
        } else if (range.head.line > end) {
          indentLine(this, range.head.line, how, true);
          end = range.head.line;
          if (i == this.doc.sel.primIndex) ensureCursorVisible(this);
        }
      }
    }),

    // Fetch the parser token for a given character. Useful for hacks
    // that want to inspect the mode state (say, for completion).
    getTokenAt: function(pos, precise) {
      return takeToken(this, pos, precise);
    },

    getLineTokens: function(line, precise) {
      return takeToken(this, Pos(line), precise, true);
    },

    getTokenTypeAt: function(pos) {
      pos = clipPos(this.doc, pos);
      var styles = getLineStyles(this, getLine(this.doc, pos.line));
      var before = 0, after = (styles.length - 1) / 2, ch = pos.ch;
      var type;
      if (ch == 0) type = styles[2];
      else for (;;) {
        var mid = (before + after) >> 1;
        if ((mid ? styles[mid * 2 - 1] : 0) >= ch) after = mid;
        else if (styles[mid * 2 + 1] < ch) before = mid + 1;
        else { type = styles[mid * 2 + 2]; break; }
      }
      var cut = type ? type.indexOf("cm-overlay ") : -1;
      return cut < 0 ? type : cut == 0 ? null : type.slice(0, cut - 1);
    },

    getModeAt: function(pos) {
      var mode = this.doc.mode;
      if (!mode.innerMode) return mode;
      return CodeMirror.innerMode(mode, this.getTokenAt(pos).state).mode;
    },

    getHelper: function(pos, type) {
      return this.getHelpers(pos, type)[0];
    },

    getHelpers: function(pos, type) {
      var found = [];
      if (!helpers.hasOwnProperty(type)) return found;
      var help = helpers[type], mode = this.getModeAt(pos);
      if (typeof mode[type] == "string") {
        if (help[mode[type]]) found.push(help[mode[type]]);
      } else if (mode[type]) {
        for (var i = 0; i < mode[type].length; i++) {
          var val = help[mode[type][i]];
          if (val) found.push(val);
        }
      } else if (mode.helperType && help[mode.helperType]) {
        found.push(help[mode.helperType]);
      } else if (help[mode.name]) {
        found.push(help[mode.name]);
      }
      for (var i = 0; i < help._global.length; i++) {
        var cur = help._global[i];
        if (cur.pred(mode, this) && indexOf(found, cur.val) == -1)
          found.push(cur.val);
      }
      return found;
    },

    getStateAfter: function(line, precise) {
      var doc = this.doc;
      line = clipLine(doc, line == null ? doc.first + doc.size - 1: line);
      return getStateBefore(this, line + 1, precise);
    },

    cursorCoords: function(start, mode) {
      var pos, range = this.doc.sel.primary();
      if (start == null) pos = range.head;
      else if (typeof start == "object") pos = clipPos(this.doc, start);
      else pos = start ? range.from() : range.to();
      return cursorCoords(this, pos, mode || "page");
    },

    charCoords: function(pos, mode) {
      return charCoords(this, clipPos(this.doc, pos), mode || "page");
    },

    coordsChar: function(coords, mode) {
      coords = fromCoordSystem(this, coords, mode || "page");
      return coordsChar(this, coords.left, coords.top);
    },

    lineAtHeight: function(height, mode) {
      height = fromCoordSystem(this, {top: height, left: 0}, mode || "page").top;
      return lineAtHeight(this.doc, height + this.display.viewOffset);
    },
    heightAtLine: function(line, mode) {
      var end = false, lineObj;
      if (typeof line == "number") {
        var last = this.doc.first + this.doc.size - 1;
        if (line < this.doc.first) line = this.doc.first;
        else if (line > last) { line = last; end = true; }
        lineObj = getLine(this.doc, line);
      } else {
        lineObj = line;
      }
      return intoCoordSystem(this, lineObj, {top: 0, left: 0}, mode || "page").top +
        (end ? this.doc.height - heightAtLine(lineObj) : 0);
    },

    defaultTextHeight: function() { return textHeight(this.display); },
    defaultCharWidth: function() { return charWidth(this.display); },

    setGutterMarker: methodOp(function(line, gutterID, value) {
      return changeLine(this.doc, line, "gutter", function(line) {
        var markers = line.gutterMarkers || (line.gutterMarkers = {});
        markers[gutterID] = value;
        if (!value && isEmpty(markers)) line.gutterMarkers = null;
        return true;
      });
    }),

    clearGutter: methodOp(function(gutterID) {
      var cm = this, doc = cm.doc, i = doc.first;
      doc.iter(function(line) {
        if (line.gutterMarkers && line.gutterMarkers[gutterID]) {
          line.gutterMarkers[gutterID] = null;
          regLineChange(cm, i, "gutter");
          if (isEmpty(line.gutterMarkers)) line.gutterMarkers = null;
        }
        ++i;
      });
    }),

    lineInfo: function(line) {
      if (typeof line == "number") {
        if (!isLine(this.doc, line)) return null;
        var n = line;
        line = getLine(this.doc, line);
        if (!line) return null;
      } else {
        var n = lineNo(line);
        if (n == null) return null;
      }
      return {line: n, handle: line, text: line.text, gutterMarkers: line.gutterMarkers,
              textClass: line.textClass, bgClass: line.bgClass, wrapClass: line.wrapClass,
              widgets: line.widgets};
    },

    getViewport: function() { return {from: this.display.viewFrom, to: this.display.viewTo};},

    addWidget: function(pos, node, scroll, vert, horiz) {
      var display = this.display;
      pos = cursorCoords(this, clipPos(this.doc, pos));
      var top = pos.bottom, left = pos.left;
      node.style.position = "absolute";
      node.setAttribute("cm-ignore-events", "true");
      this.display.input.setUneditable(node);
      display.sizer.appendChild(node);
      if (vert == "over") {
        top = pos.top;
      } else if (vert == "above" || vert == "near") {
        var vspace = Math.max(display.wrapper.clientHeight, this.doc.height),
        hspace = Math.max(display.sizer.clientWidth, display.lineSpace.clientWidth);
        // Default to positioning above (if specified and possible); otherwise default to positioning below
        if ((vert == 'above' || pos.bottom + node.offsetHeight > vspace) && pos.top > node.offsetHeight)
          top = pos.top - node.offsetHeight;
        else if (pos.bottom + node.offsetHeight <= vspace)
          top = pos.bottom;
        if (left + node.offsetWidth > hspace)
          left = hspace - node.offsetWidth;
      }
      node.style.top = top + "px";
      node.style.left = node.style.right = "";
      if (horiz == "right") {
        left = display.sizer.clientWidth - node.offsetWidth;
        node.style.right = "0px";
      } else {
        if (horiz == "left") left = 0;
        else if (horiz == "middle") left = (display.sizer.clientWidth - node.offsetWidth) / 2;
        node.style.left = left + "px";
      }
      if (scroll)
        scrollIntoView(this, left, top, left + node.offsetWidth, top + node.offsetHeight);
    },

    triggerOnKeyDown: methodOp(onKeyDown),
    triggerOnKeyPress: methodOp(onKeyPress),
    triggerOnKeyUp: onKeyUp,

    execCommand: function(cmd) {
      if (commands.hasOwnProperty(cmd))
        return commands[cmd](this);
    },

    triggerElectric: methodOp(function(text) { triggerElectric(this, text); }),

    findPosH: function(from, amount, unit, visually) {
      var dir = 1;
      if (amount < 0) { dir = -1; amount = -amount; }
      for (var i = 0, cur = clipPos(this.doc, from); i < amount; ++i) {
        cur = findPosH(this.doc, cur, dir, unit, visually);
        if (cur.hitSide) break;
      }
      return cur;
    },

    moveH: methodOp(function(dir, unit) {
      var cm = this;
      cm.extendSelectionsBy(function(range) {
        if (cm.display.shift || cm.doc.extend || range.empty())
          return findPosH(cm.doc, range.head, dir, unit, cm.options.rtlMoveVisually);
        else
          return dir < 0 ? range.from() : range.to();
      }, sel_move);
    }),

    deleteH: methodOp(function(dir, unit) {
      var sel = this.doc.sel, doc = this.doc;
      if (sel.somethingSelected())
        doc.replaceSelection("", null, "+delete");
      else
        deleteNearSelection(this, function(range) {
          var other = findPosH(doc, range.head, dir, unit, false);
          return dir < 0 ? {from: other, to: range.head} : {from: range.head, to: other};
        });
    }),

    findPosV: function(from, amount, unit, goalColumn) {
      var dir = 1, x = goalColumn;
      if (amount < 0) { dir = -1; amount = -amount; }
      for (var i = 0, cur = clipPos(this.doc, from); i < amount; ++i) {
        var coords = cursorCoords(this, cur, "div");
        if (x == null) x = coords.left;
        else coords.left = x;
        cur = findPosV(this, coords, dir, unit);
        if (cur.hitSide) break;
      }
      return cur;
    },

    moveV: methodOp(function(dir, unit) {
      var cm = this, doc = this.doc, goals = [];
      var collapse = !cm.display.shift && !doc.extend && doc.sel.somethingSelected();
      doc.extendSelectionsBy(function(range) {
        if (collapse)
          return dir < 0 ? range.from() : range.to();
        var headPos = cursorCoords(cm, range.head, "div");
        if (range.goalColumn != null) headPos.left = range.goalColumn;
        goals.push(headPos.left);
        var pos = findPosV(cm, headPos, dir, unit);
        if (unit == "page" && range == doc.sel.primary())
          addToScrollPos(cm, null, charCoords(cm, pos, "div").top - headPos.top);
        return pos;
      }, sel_move);
      if (goals.length) for (var i = 0; i < doc.sel.ranges.length; i++)
        doc.sel.ranges[i].goalColumn = goals[i];
    }),

    // Find the word at the given position (as returned by coordsChar).
    findWordAt: function(pos) {
      var doc = this.doc, line = getLine(doc, pos.line).text;
      var start = pos.ch, end = pos.ch;
      if (line) {
        var helper = this.getHelper(pos, "wordChars");
        if ((pos.xRel < 0 || end == line.length) && start) --start; else ++end;
        var startChar = line.charAt(start);
        var check = isWordChar(startChar, helper)
          ? function(ch) { return isWordChar(ch, helper); }
          : /\s/.test(startChar) ? function(ch) {return /\s/.test(ch);}
          : function(ch) {return !/\s/.test(ch) && !isWordChar(ch);};
        while (start > 0 && check(line.charAt(start - 1))) --start;
        while (end < line.length && check(line.charAt(end))) ++end;
      }
      return new Range(Pos(pos.line, start), Pos(pos.line, end));
    },

    toggleOverwrite: function(value) {
      if (value != null && value == this.state.overwrite) return;
      if (this.state.overwrite = !this.state.overwrite)
        addClass(this.display.cursorDiv, "CodeMirror-overwrite");
      else
        rmClass(this.display.cursorDiv, "CodeMirror-overwrite");

      signal(this, "overwriteToggle", this, this.state.overwrite);
    },
    hasFocus: function() { return this.display.input.getField() == activeElt(); },

    scrollTo: methodOp(function(x, y) {
      if (x != null || y != null) resolveScrollToPos(this);
      if (x != null) this.curOp.scrollLeft = x;
      if (y != null) this.curOp.scrollTop = y;
    }),
    getScrollInfo: function() {
      var scroller = this.display.scroller;
      return {left: scroller.scrollLeft, top: scroller.scrollTop,
              height: scroller.scrollHeight - scrollGap(this) - this.display.barHeight,
              width: scroller.scrollWidth - scrollGap(this) - this.display.barWidth,
              clientHeight: displayHeight(this), clientWidth: displayWidth(this)};
    },

    scrollIntoView: methodOp(function(range, margin) {
      if (range == null) {
        range = {from: this.doc.sel.primary().head, to: null};
        if (margin == null) margin = this.options.cursorScrollMargin;
      } else if (typeof range == "number") {
        range = {from: Pos(range, 0), to: null};
      } else if (range.from == null) {
        range = {from: range, to: null};
      }
      if (!range.to) range.to = range.from;
      range.margin = margin || 0;

      if (range.from.line != null) {
        resolveScrollToPos(this);
        this.curOp.scrollToPos = range;
      } else {
        var sPos = calculateScrollPos(this, Math.min(range.from.left, range.to.left),
                                      Math.min(range.from.top, range.to.top) - range.margin,
                                      Math.max(range.from.right, range.to.right),
                                      Math.max(range.from.bottom, range.to.bottom) + range.margin);
        this.scrollTo(sPos.scrollLeft, sPos.scrollTop);
      }
    }),

    setSize: methodOp(function(width, height) {
      var cm = this;
      function interpret(val) {
        return typeof val == "number" || /^\d+$/.test(String(val)) ? val + "px" : val;
      }
      if (width != null) cm.display.wrapper.style.width = interpret(width);
      if (height != null) cm.display.wrapper.style.height = interpret(height);
      if (cm.options.lineWrapping) clearLineMeasurementCache(this);
      var lineNo = cm.display.viewFrom;
      cm.doc.iter(lineNo, cm.display.viewTo, function(line) {
        if (line.widgets) for (var i = 0; i < line.widgets.length; i++)
          if (line.widgets[i].noHScroll) { regLineChange(cm, lineNo, "widget"); break; }
        ++lineNo;
      });
      cm.curOp.forceUpdate = true;
      signal(cm, "refresh", this);
    }),

    operation: function(f){return runInOp(this, f);},

    refresh: methodOp(function() {
      var oldHeight = this.display.cachedTextHeight;
      regChange(this);
      this.curOp.forceUpdate = true;
      clearCaches(this);
      this.scrollTo(this.doc.scrollLeft, this.doc.scrollTop);
      updateGutterSpace(this);
      if (oldHeight == null || Math.abs(oldHeight - textHeight(this.display)) > .5)
        estimateLineHeights(this);
      signal(this, "refresh", this);
    }),

    swapDoc: methodOp(function(doc) {
      var old = this.doc;
      old.cm = null;
      attachDoc(this, doc);
      clearCaches(this);
      this.display.input.reset();
      this.scrollTo(doc.scrollLeft, doc.scrollTop);
      this.curOp.forceScroll = true;
      signalLater(this, "swapDoc", this, old);
      return old;
    }),

    getInputField: function(){return this.display.input.getField();},
    getWrapperElement: function(){return this.display.wrapper;},
    getScrollerElement: function(){return this.display.scroller;},
    getGutterElement: function(){return this.display.gutters;}
  };
  eventMixin(CodeMirror);

  // OPTION DEFAULTS

  // The default configuration options.
  var defaults = CodeMirror.defaults = {};
  // Functions to run when options are changed.
  var optionHandlers = CodeMirror.optionHandlers = {};

  function option(name, deflt, handle, notOnInit) {
    CodeMirror.defaults[name] = deflt;
    if (handle) optionHandlers[name] =
      notOnInit ? function(cm, val, old) {if (old != Init) handle(cm, val, old);} : handle;
  }

  // Passed to option handlers when there is no old value.
  var Init = CodeMirror.Init = {toString: function(){return "CodeMirror.Init";}};

  // These two are, on init, called from the constructor because they
  // have to be initialized before the editor can start at all.
  option("value", "", function(cm, val) {
    cm.setValue(val);
  }, true);
  option("mode", null, function(cm, val) {
    cm.doc.modeOption = val;
    loadMode(cm);
  }, true);

  option("indentUnit", 2, loadMode, true);
  option("indentWithTabs", false);
  option("smartIndent", true);
  option("tabSize", 4, function(cm) {
    resetModeState(cm);
    clearCaches(cm);
    regChange(cm);
  }, true);
  option("specialChars", /[\t\u0000-\u0019\u00ad\u200b-\u200f\u2028\u2029\ufeff]/g, function(cm, val, old) {
    cm.state.specialChars = new RegExp(val.source + (val.test("\t") ? "" : "|\t"), "g");
    if (old != CodeMirror.Init) cm.refresh();
  });
  option("specialCharPlaceholder", defaultSpecialCharPlaceholder, function(cm) {cm.refresh();}, true);
  option("electricChars", true);
  option("inputStyle", mobile ? "contenteditable" : "textarea", function() {
    throw new Error("inputStyle can not (yet) be changed in a running editor"); // FIXME
  }, true);
  option("rtlMoveVisually", !windows);
  option("wholeLineUpdateBefore", true);

  option("theme", "default", function(cm) {
    themeChanged(cm);
    guttersChanged(cm);
  }, true);
  option("keyMap", "default", function(cm, val, old) {
    var next = getKeyMap(val);
    var prev = old != CodeMirror.Init && getKeyMap(old);
    if (prev && prev.detach) prev.detach(cm, next);
    if (next.attach) next.attach(cm, prev || null);
  });
  option("extraKeys", null);

  option("lineWrapping", false, wrappingChanged, true);
  option("gutters", [], function(cm) {
    setGuttersForLineNumbers(cm.options);
    guttersChanged(cm);
  }, true);
  option("fixedGutter", true, function(cm, val) {
    cm.display.gutters.style.left = val ? compensateForHScroll(cm.display) + "px" : "0";
    cm.refresh();
  }, true);
  option("coverGutterNextToScrollbar", false, function(cm) {updateScrollbars(cm);}, true);
  option("scrollbarStyle", "native", function(cm) {
    initScrollbars(cm);
    updateScrollbars(cm);
    cm.display.scrollbars.setScrollTop(cm.doc.scrollTop);
    cm.display.scrollbars.setScrollLeft(cm.doc.scrollLeft);
  }, true);
  option("lineNumbers", false, function(cm) {
    setGuttersForLineNumbers(cm.options);
    guttersChanged(cm);
  }, true);
  option("firstLineNumber", 1, guttersChanged, true);
  option("lineNumberFormatter", function(integer) {return integer;}, guttersChanged, true);
  option("showCursorWhenSelecting", false, updateSelection, true);

  option("resetSelectionOnContextMenu", true);
  option("lineWiseCopyCut", true);

  option("readOnly", false, function(cm, val) {
    if (val == "nocursor") {
      onBlur(cm);
      cm.display.input.blur();
      cm.display.disabled = true;
    } else {
      cm.display.disabled = false;
      if (!val) cm.display.input.reset();
    }
  });
  option("disableInput", false, function(cm, val) {if (!val) cm.display.input.reset();}, true);
  option("dragDrop", true, dragDropChanged);

  option("cursorBlinkRate", 530);
  option("cursorScrollMargin", 0);
  option("cursorHeight", 1, updateSelection, true);
  option("singleCursorHeightPerLine", true, updateSelection, true);
  option("workTime", 100);
  option("workDelay", 100);
  option("flattenSpans", true, resetModeState, true);
  option("addModeClass", false, resetModeState, true);
  option("pollInterval", 100);
  option("undoDepth", 200, function(cm, val){cm.doc.history.undoDepth = val;});
  option("historyEventDelay", 1250);
  option("viewportMargin", 10, function(cm){cm.refresh();}, true);
  option("maxHighlightLength", 10000, resetModeState, true);
  option("moveInputWithCursor", true, function(cm, val) {
    if (!val) cm.display.input.resetPosition();
  });

  option("tabindex", null, function(cm, val) {
    cm.display.input.getField().tabIndex = val || "";
  });
  option("autofocus", null);

  // MODE DEFINITION AND QUERYING

  // Known modes, by name and by MIME
  var modes = CodeMirror.modes = {}, mimeModes = CodeMirror.mimeModes = {};

  // Extra arguments are stored as the mode's dependencies, which is
  // used by (legacy) mechanisms like loadmode.js to automatically
  // load a mode. (Preferred mechanism is the require/define calls.)
  CodeMirror.defineMode = function(name, mode) {
    if (!CodeMirror.defaults.mode && name != "null") CodeMirror.defaults.mode = name;
    if (arguments.length > 2)
      mode.dependencies = Array.prototype.slice.call(arguments, 2);
    modes[name] = mode;
  };

  CodeMirror.defineMIME = function(mime, spec) {
    mimeModes[mime] = spec;
  };

  // Given a MIME type, a {name, ...options} config object, or a name
  // string, return a mode config object.
  CodeMirror.resolveMode = function(spec) {
    if (typeof spec == "string" && mimeModes.hasOwnProperty(spec)) {
      spec = mimeModes[spec];
    } else if (spec && typeof spec.name == "string" && mimeModes.hasOwnProperty(spec.name)) {
      var found = mimeModes[spec.name];
      if (typeof found == "string") found = {name: found};
      spec = createObj(found, spec);
      spec.name = found.name;
    } else if (typeof spec == "string" && /^[\w\-]+\/[\w\-]+\+xml$/.test(spec)) {
      return CodeMirror.resolveMode("application/xml");
    }
    if (typeof spec == "string") return {name: spec};
    else return spec || {name: "null"};
  };

  // Given a mode spec (anything that resolveMode accepts), find and
  // initialize an actual mode object.
  CodeMirror.getMode = function(options, spec) {
    var spec = CodeMirror.resolveMode(spec);
    var mfactory = modes[spec.name];
    if (!mfactory) return CodeMirror.getMode(options, "text/plain");
    var modeObj = mfactory(options, spec);
    if (modeExtensions.hasOwnProperty(spec.name)) {
      var exts = modeExtensions[spec.name];
      for (var prop in exts) {
        if (!exts.hasOwnProperty(prop)) continue;
        if (modeObj.hasOwnProperty(prop)) modeObj["_" + prop] = modeObj[prop];
        modeObj[prop] = exts[prop];
      }
    }
    modeObj.name = spec.name;
    if (spec.helperType) modeObj.helperType = spec.helperType;
    if (spec.modeProps) for (var prop in spec.modeProps)
      modeObj[prop] = spec.modeProps[prop];

    return modeObj;
  };

  // Minimal default mode.
  CodeMirror.defineMode("null", function() {
    return {token: function(stream) {stream.skipToEnd();}};
  });
  CodeMirror.defineMIME("text/plain", "null");

  // This can be used to attach properties to mode objects from
  // outside the actual mode definition.
  var modeExtensions = CodeMirror.modeExtensions = {};
  CodeMirror.extendMode = function(mode, properties) {
    var exts = modeExtensions.hasOwnProperty(mode) ? modeExtensions[mode] : (modeExtensions[mode] = {});
    copyObj(properties, exts);
  };

  // EXTENSIONS

  CodeMirror.defineExtension = function(name, func) {
    CodeMirror.prototype[name] = func;
  };
  CodeMirror.defineDocExtension = function(name, func) {
    Doc.prototype[name] = func;
  };
  CodeMirror.defineOption = option;

  var initHooks = [];
  CodeMirror.defineInitHook = function(f) {initHooks.push(f);};

  var helpers = CodeMirror.helpers = {};
  CodeMirror.registerHelper = function(type, name, value) {
    if (!helpers.hasOwnProperty(type)) helpers[type] = CodeMirror[type] = {_global: []};
    helpers[type][name] = value;
  };
  CodeMirror.registerGlobalHelper = function(type, name, predicate, value) {
    CodeMirror.registerHelper(type, name, value);
    helpers[type]._global.push({pred: predicate, val: value});
  };

  // MODE STATE HANDLING

  // Utility functions for working with state. Exported because nested
  // modes need to do this for their inner modes.

  var copyState = CodeMirror.copyState = function(mode, state) {
    if (state === true) return state;
    if (mode.copyState) return mode.copyState(state);
    var nstate = {};
    for (var n in state) {
      var val = state[n];
      if (val instanceof Array) val = val.concat([]);
      nstate[n] = val;
    }
    return nstate;
  };

  var startState = CodeMirror.startState = function(mode, a1, a2) {
    return mode.startState ? mode.startState(a1, a2) : true;
  };

  // Given a mode and a state (for that mode), find the inner mode and
  // state at the position that the state refers to.
  CodeMirror.innerMode = function(mode, state) {
    while (mode.innerMode) {
      var info = mode.innerMode(state);
      if (!info || info.mode == mode) break;
      state = info.state;
      mode = info.mode;
    }
    return info || {mode: mode, state: state};
  };

  // STANDARD COMMANDS

  // Commands are parameter-less actions that can be performed on an
  // editor, mostly used for keybindings.
  var commands = CodeMirror.commands = {
    selectAll: function(cm) {cm.setSelection(Pos(cm.firstLine(), 0), Pos(cm.lastLine()), sel_dontScroll);},
    singleSelection: function(cm) {
      cm.setSelection(cm.getCursor("anchor"), cm.getCursor("head"), sel_dontScroll);
    },
    killLine: function(cm) {
      deleteNearSelection(cm, function(range) {
        if (range.empty()) {
          var len = getLine(cm.doc, range.head.line).text.length;
          if (range.head.ch == len && range.head.line < cm.lastLine())
            return {from: range.head, to: Pos(range.head.line + 1, 0)};
          else
            return {from: range.head, to: Pos(range.head.line, len)};
        } else {
          return {from: range.from(), to: range.to()};
        }
      });
    },
    deleteLine: function(cm) {
      deleteNearSelection(cm, function(range) {
        return {from: Pos(range.from().line, 0),
                to: clipPos(cm.doc, Pos(range.to().line + 1, 0))};
      });
    },
    delLineLeft: function(cm) {
      deleteNearSelection(cm, function(range) {
        return {from: Pos(range.from().line, 0), to: range.from()};
      });
    },
    delWrappedLineLeft: function(cm) {
      deleteNearSelection(cm, function(range) {
        var top = cm.charCoords(range.head, "div").top + 5;
        var leftPos = cm.coordsChar({left: 0, top: top}, "div");
        return {from: leftPos, to: range.from()};
      });
    },
    delWrappedLineRight: function(cm) {
      deleteNearSelection(cm, function(range) {
        var top = cm.charCoords(range.head, "div").top + 5;
        var rightPos = cm.coordsChar({left: cm.display.lineDiv.offsetWidth + 100, top: top}, "div");
        return {from: range.from(), to: rightPos };
      });
    },
    undo: function(cm) {cm.undo();},
    redo: function(cm) {cm.redo();},
    undoSelection: function(cm) {cm.undoSelection();},
    redoSelection: function(cm) {cm.redoSelection();},
    goDocStart: function(cm) {cm.extendSelection(Pos(cm.firstLine(), 0));},
    goDocEnd: function(cm) {cm.extendSelection(Pos(cm.lastLine()));},
    goLineStart: function(cm) {
      cm.extendSelectionsBy(function(range) { return lineStart(cm, range.head.line); },
                            {origin: "+move", bias: 1});
    },
    goLineStartSmart: function(cm) {
      cm.extendSelectionsBy(function(range) {
        return lineStartSmart(cm, range.head);
      }, {origin: "+move", bias: 1});
    },
    goLineEnd: function(cm) {
      cm.extendSelectionsBy(function(range) { return lineEnd(cm, range.head.line); },
                            {origin: "+move", bias: -1});
    },
    goLineRight: function(cm) {
      cm.extendSelectionsBy(function(range) {
        var top = cm.charCoords(range.head, "div").top + 5;
        return cm.coordsChar({left: cm.display.lineDiv.offsetWidth + 100, top: top}, "div");
      }, sel_move);
    },
    goLineLeft: function(cm) {
      cm.extendSelectionsBy(function(range) {
        var top = cm.charCoords(range.head, "div").top + 5;
        return cm.coordsChar({left: 0, top: top}, "div");
      }, sel_move);
    },
    goLineLeftSmart: function(cm) {
      cm.extendSelectionsBy(function(range) {
        var top = cm.charCoords(range.head, "div").top + 5;
        var pos = cm.coordsChar({left: 0, top: top}, "div");
        if (pos.ch < cm.getLine(pos.line).search(/\S/)) return lineStartSmart(cm, range.head);
        return pos;
      }, sel_move);
    },
    goLineUp: function(cm) {cm.moveV(-1, "line");},
    goLineDown: function(cm) {cm.moveV(1, "line");},
    goPageUp: function(cm) {cm.moveV(-1, "page");},
    goPageDown: function(cm) {cm.moveV(1, "page");},
    goCharLeft: function(cm) {cm.moveH(-1, "char");},
    goCharRight: function(cm) {cm.moveH(1, "char");},
    goColumnLeft: function(cm) {cm.moveH(-1, "column");},
    goColumnRight: function(cm) {cm.moveH(1, "column");},
    goWordLeft: function(cm) {cm.moveH(-1, "word");},
    goGroupRight: function(cm) {cm.moveH(1, "group");},
    goGroupLeft: function(cm) {cm.moveH(-1, "group");},
    goWordRight: function(cm) {cm.moveH(1, "word");},
    delCharBefore: function(cm) {cm.deleteH(-1, "char");},
    delCharAfter: function(cm) {cm.deleteH(1, "char");},
    delWordBefore: function(cm) {cm.deleteH(-1, "word");},
    delWordAfter: function(cm) {cm.deleteH(1, "word");},
    delGroupBefore: function(cm) {cm.deleteH(-1, "group");},
    delGroupAfter: function(cm) {cm.deleteH(1, "group");},
    indentAuto: function(cm) {cm.indentSelection("smart");},
    indentMore: function(cm) {cm.indentSelection("add");},
    indentLess: function(cm) {cm.indentSelection("subtract");},
    insertTab: function(cm) {cm.replaceSelection("\t");},
    insertSoftTab: function(cm) {
      var spaces = [], ranges = cm.listSelections(), tabSize = cm.options.tabSize;
      for (var i = 0; i < ranges.length; i++) {
        var pos = ranges[i].from();
        var col = countColumn(cm.getLine(pos.line), pos.ch, tabSize);
        spaces.push(new Array(tabSize - col % tabSize + 1).join(" "));
      }
      cm.replaceSelections(spaces);
    },
    defaultTab: function(cm) {
      if (cm.somethingSelected()) cm.indentSelection("add");
      else cm.execCommand("insertTab");
    },
    transposeChars: function(cm) {
      runInOp(cm, function() {
        var ranges = cm.listSelections(), newSel = [];
        for (var i = 0; i < ranges.length; i++) {
          var cur = ranges[i].head, line = getLine(cm.doc, cur.line).text;
          if (line) {
            if (cur.ch == line.length) cur = new Pos(cur.line, cur.ch - 1);
            if (cur.ch > 0) {
              cur = new Pos(cur.line, cur.ch + 1);
              cm.replaceRange(line.charAt(cur.ch - 1) + line.charAt(cur.ch - 2),
                              Pos(cur.line, cur.ch - 2), cur, "+transpose");
            } else if (cur.line > cm.doc.first) {
              var prev = getLine(cm.doc, cur.line - 1).text;
              if (prev)
                cm.replaceRange(line.charAt(0) + "\n" + prev.charAt(prev.length - 1),
                                Pos(cur.line - 1, prev.length - 1), Pos(cur.line, 1), "+transpose");
            }
          }
          newSel.push(new Range(cur, cur));
        }
        cm.setSelections(newSel);
      });
    },
    newlineAndIndent: function(cm) {
      runInOp(cm, function() {
        var len = cm.listSelections().length;
        for (var i = 0; i < len; i++) {
          var range = cm.listSelections()[i];
          cm.replaceRange("\n", range.anchor, range.head, "+input");
          cm.indentLine(range.from().line + 1, null, true);
          ensureCursorVisible(cm);
        }
      });
    },
    toggleOverwrite: function(cm) {cm.toggleOverwrite();}
  };


  // STANDARD KEYMAPS

  var keyMap = CodeMirror.keyMap = {};

  keyMap.basic = {
    "Left": "goCharLeft", "Right": "goCharRight", "Up": "goLineUp", "Down": "goLineDown",
    "End": "goLineEnd", "Home": "goLineStartSmart", "PageUp": "goPageUp", "PageDown": "goPageDown",
    "Delete": "delCharAfter", "Backspace": "delCharBefore", "Shift-Backspace": "delCharBefore",
    "Tab": "defaultTab", "Shift-Tab": "indentAuto",
    "Enter": "newlineAndIndent", "Insert": "toggleOverwrite",
    "Esc": "singleSelection"
  };
  // Note that the save and find-related commands aren't defined by
  // default. User code or addons can define them. Unknown commands
  // are simply ignored.
  keyMap.pcDefault = {
    "Ctrl-A": "selectAll", "Ctrl-D": "deleteLine", "Ctrl-Z": "undo", "Shift-Ctrl-Z": "redo", "Ctrl-Y": "redo",
    "Ctrl-Home": "goDocStart", "Ctrl-End": "goDocEnd", "Ctrl-Up": "goLineUp", "Ctrl-Down": "goLineDown",
    "Ctrl-Left": "goGroupLeft", "Ctrl-Right": "goGroupRight", "Alt-Left": "goLineStart", "Alt-Right": "goLineEnd",
    "Ctrl-Backspace": "delGroupBefore", "Ctrl-Delete": "delGroupAfter", "Ctrl-S": "save", "Ctrl-F": "find",
    "Ctrl-G": "findNext", "Shift-Ctrl-G": "findPrev", "Shift-Ctrl-F": "replace", "Shift-Ctrl-R": "replaceAll",
    "Ctrl-[": "indentLess", "Ctrl-]": "indentMore",
    "Ctrl-U": "undoSelection", "Shift-Ctrl-U": "redoSelection", "Alt-U": "redoSelection",
    fallthrough: "basic"
  };
  // Very basic readline/emacs-style bindings, which are standard on Mac.
  keyMap.emacsy = {
    "Ctrl-F": "goCharRight", "Ctrl-B": "goCharLeft", "Ctrl-P": "goLineUp", "Ctrl-N": "goLineDown",
    "Alt-F": "goWordRight", "Alt-B": "goWordLeft", "Ctrl-A": "goLineStart", "Ctrl-E": "goLineEnd",
    "Ctrl-V": "goPageDown", "Shift-Ctrl-V": "goPageUp", "Ctrl-D": "delCharAfter", "Ctrl-H": "delCharBefore",
    "Alt-D": "delWordAfter", "Alt-Backspace": "delWordBefore", "Ctrl-K": "killLine", "Ctrl-T": "transposeChars"
  };
  keyMap.macDefault = {
    "Cmd-A": "selectAll", "Cmd-D": "deleteLine", "Cmd-Z": "undo", "Shift-Cmd-Z": "redo", "Cmd-Y": "redo",
    "Cmd-Home": "goDocStart", "Cmd-Up": "goDocStart", "Cmd-End": "goDocEnd", "Cmd-Down": "goDocEnd", "Alt-Left": "goGroupLeft",
    "Alt-Right": "goGroupRight", "Cmd-Left": "goLineLeft", "Cmd-Right": "goLineRight", "Alt-Backspace": "delGroupBefore",
    "Ctrl-Alt-Backspace": "delGroupAfter", "Alt-Delete": "delGroupAfter", "Cmd-S": "save", "Cmd-F": "find",
    "Cmd-G": "findNext", "Shift-Cmd-G": "findPrev", "Cmd-Alt-F": "replace", "Shift-Cmd-Alt-F": "replaceAll",
    "Cmd-[": "indentLess", "Cmd-]": "indentMore", "Cmd-Backspace": "delWrappedLineLeft", "Cmd-Delete": "delWrappedLineRight",
    "Cmd-U": "undoSelection", "Shift-Cmd-U": "redoSelection", "Ctrl-Up": "goDocStart", "Ctrl-Down": "goDocEnd",
    fallthrough: ["basic", "emacsy"]
  };
  keyMap["default"] = mac ? keyMap.macDefault : keyMap.pcDefault;

  // KEYMAP DISPATCH

  function normalizeKeyName(name) {
    var parts = name.split(/-(?!$)/), name = parts[parts.length - 1];
    var alt, ctrl, shift, cmd;
    for (var i = 0; i < parts.length - 1; i++) {
      var mod = parts[i];
      if (/^(cmd|meta|m)$/i.test(mod)) cmd = true;
      else if (/^a(lt)?$/i.test(mod)) alt = true;
      else if (/^(c|ctrl|control)$/i.test(mod)) ctrl = true;
      else if (/^s(hift)$/i.test(mod)) shift = true;
      else throw new Error("Unrecognized modifier name: " + mod);
    }
    if (alt) name = "Alt-" + name;
    if (ctrl) name = "Ctrl-" + name;
    if (cmd) name = "Cmd-" + name;
    if (shift) name = "Shift-" + name;
    return name;
  }

  // This is a kludge to keep keymaps mostly working as raw objects
  // (backwards compatibility) while at the same time support features
  // like normalization and multi-stroke key bindings. It compiles a
  // new normalized keymap, and then updates the old object to reflect
  // this.
  CodeMirror.normalizeKeyMap = function(keymap) {
    var copy = {};
    for (var keyname in keymap) if (keymap.hasOwnProperty(keyname)) {
      var value = keymap[keyname];
      if (/^(name|fallthrough|(de|at)tach)$/.test(keyname)) continue;
      if (value == "...") { delete keymap[keyname]; continue; }

      var keys = map(keyname.split(" "), normalizeKeyName);
      for (var i = 0; i < keys.length; i++) {
        var val, name;
        if (i == keys.length - 1) {
          name = keys.join(" ");
          val = value;
        } else {
          name = keys.slice(0, i + 1).join(" ");
          val = "...";
        }
        var prev = copy[name];
        if (!prev) copy[name] = val;
        else if (prev != val) throw new Error("Inconsistent bindings for " + name);
      }
      delete keymap[keyname];
    }
    for (var prop in copy) keymap[prop] = copy[prop];
    return keymap;
  };

  var lookupKey = CodeMirror.lookupKey = function(key, map, handle, context) {
    map = getKeyMap(map);
    var found = map.call ? map.call(key, context) : map[key];
    if (found === false) return "nothing";
    if (found === "...") return "multi";
    if (found != null && handle(found)) return "handled";

    if (map.fallthrough) {
      if (Object.prototype.toString.call(map.fallthrough) != "[object Array]")
        return lookupKey(key, map.fallthrough, handle, context);
      for (var i = 0; i < map.fallthrough.length; i++) {
        var result = lookupKey(key, map.fallthrough[i], handle, context);
        if (result) return result;
      }
    }
  };

  // Modifier key presses don't count as 'real' key presses for the
  // purpose of keymap fallthrough.
  var isModifierKey = CodeMirror.isModifierKey = function(value) {
    var name = typeof value == "string" ? value : keyNames[value.keyCode];
    return name == "Ctrl" || name == "Alt" || name == "Shift" || name == "Mod";
  };

  // Look up the name of a key as indicated by an event object.
  var keyName = CodeMirror.keyName = function(event, noShift) {
    if (presto && event.keyCode == 34 && event["char"]) return false;
    var base = keyNames[event.keyCode], name = base;
    if (name == null || event.altGraphKey) return false;
    if (event.altKey && base != "Alt") name = "Alt-" + name;
    if ((flipCtrlCmd ? event.metaKey : event.ctrlKey) && base != "Ctrl") name = "Ctrl-" + name;
    if ((flipCtrlCmd ? event.ctrlKey : event.metaKey) && base != "Cmd") name = "Cmd-" + name;
    if (!noShift && event.shiftKey && base != "Shift") name = "Shift-" + name;
    return name;
  };

  function getKeyMap(val) {
    return typeof val == "string" ? keyMap[val] : val;
  }

  // FROMTEXTAREA

  CodeMirror.fromTextArea = function(textarea, options) {
    options = options ? copyObj(options) : {};
    options.value = textarea.value;
    if (!options.tabindex && textarea.tabIndex)
      options.tabindex = textarea.tabIndex;
    if (!options.placeholder && textarea.placeholder)
      options.placeholder = textarea.placeholder;
    // Set autofocus to true if this textarea is focused, or if it has
    // autofocus and no other element is focused.
    if (options.autofocus == null) {
      var hasFocus = activeElt();
      options.autofocus = hasFocus == textarea ||
        textarea.getAttribute("autofocus") != null && hasFocus == document.body;
    }

    function save() {textarea.value = cm.getValue();}
    if (textarea.form) {
      on(textarea.form, "submit", save);
      // Deplorable hack to make the submit method do the right thing.
      if (!options.leaveSubmitMethodAlone) {
        var form = textarea.form, realSubmit = form.submit;
        try {
          var wrappedSubmit = form.submit = function() {
            save();
            form.submit = realSubmit;
            form.submit();
            form.submit = wrappedSubmit;
          };
        } catch(e) {}
      }
    }

    options.finishInit = function(cm) {
      cm.save = save;
      cm.getTextArea = function() { return textarea; };
      cm.toTextArea = function() {
        cm.toTextArea = isNaN; // Prevent this from being ran twice
        save();
        textarea.parentNode.removeChild(cm.getWrapperElement());
        textarea.style.display = "";
        if (textarea.form) {
          off(textarea.form, "submit", save);
          if (typeof textarea.form.submit == "function")
            textarea.form.submit = realSubmit;
        }
      };
    };

    textarea.style.display = "none";
    var cm = CodeMirror(function(node) {
      textarea.parentNode.insertBefore(node, textarea.nextSibling);
    }, options);
    return cm;
  };

  // STRING STREAM

  // Fed to the mode parsers, provides helper functions to make
  // parsers more succinct.

  var StringStream = CodeMirror.StringStream = function(string, tabSize) {
    this.pos = this.start = 0;
    this.string = string;
    this.tabSize = tabSize || 8;
    this.lastColumnPos = this.lastColumnValue = 0;
    this.lineStart = 0;
  };

  StringStream.prototype = {
    eol: function() {return this.pos >= this.string.length;},
    sol: function() {return this.pos == this.lineStart;},
    peek: function() {return this.string.charAt(this.pos) || undefined;},
    next: function() {
      if (this.pos < this.string.length)
        return this.string.charAt(this.pos++);
    },
    eat: function(match) {
      var ch = this.string.charAt(this.pos);
      if (typeof match == "string") var ok = ch == match;
      else var ok = ch && (match.test ? match.test(ch) : match(ch));
      if (ok) {++this.pos; return ch;}
    },
    eatWhile: function(match) {
      var start = this.pos;
      while (this.eat(match)){}
      return this.pos > start;
    },
    eatSpace: function() {
      var start = this.pos;
      while (/[\s\u00a0]/.test(this.string.charAt(this.pos))) ++this.pos;
      return this.pos > start;
    },
    skipToEnd: function() {this.pos = this.string.length;},
    skipTo: function(ch) {
      var found = this.string.indexOf(ch, this.pos);
      if (found > -1) {this.pos = found; return true;}
    },
    backUp: function(n) {this.pos -= n;},
    column: function() {
      if (this.lastColumnPos < this.start) {
        this.lastColumnValue = countColumn(this.string, this.start, this.tabSize, this.lastColumnPos, this.lastColumnValue);
        this.lastColumnPos = this.start;
      }
      return this.lastColumnValue - (this.lineStart ? countColumn(this.string, this.lineStart, this.tabSize) : 0);
    },
    indentation: function() {
      return countColumn(this.string, null, this.tabSize) -
        (this.lineStart ? countColumn(this.string, this.lineStart, this.tabSize) : 0);
    },
    match: function(pattern, consume, caseInsensitive) {
      if (typeof pattern == "string") {
        var cased = function(str) {return caseInsensitive ? str.toLowerCase() : str;};
        var substr = this.string.substr(this.pos, pattern.length);
        if (cased(substr) == cased(pattern)) {
          if (consume !== false) this.pos += pattern.length;
          return true;
        }
      } else {
        var match = this.string.slice(this.pos).match(pattern);
        if (match && match.index > 0) return null;
        if (match && consume !== false) this.pos += match[0].length;
        return match;
      }
    },
    current: function(){return this.string.slice(this.start, this.pos);},
    hideFirstChars: function(n, inner) {
      this.lineStart += n;
      try { return inner(); }
      finally { this.lineStart -= n; }
    }
  };

  // TEXTMARKERS

  // Created with markText and setBookmark methods. A TextMarker is a
  // handle that can be used to clear or find a marked position in the
  // document. Line objects hold arrays (markedSpans) containing
  // {from, to, marker} object pointing to such marker objects, and
  // indicating that such a marker is present on that line. Multiple
  // lines may point to the same marker when it spans across lines.
  // The spans will have null for their from/to properties when the
  // marker continues beyond the start/end of the line. Markers have
  // links back to the lines they currently touch.

  var nextMarkerId = 0;

  var TextMarker = CodeMirror.TextMarker = function(doc, type) {
    this.lines = [];
    this.type = type;
    this.doc = doc;
    this.id = ++nextMarkerId;
  };
  eventMixin(TextMarker);

  // Clear the marker.
  TextMarker.prototype.clear = function() {
    if (this.explicitlyCleared) return;
    var cm = this.doc.cm, withOp = cm && !cm.curOp;
    if (withOp) startOperation(cm);
    if (hasHandler(this, "clear")) {
      var found = this.find();
      if (found) signalLater(this, "clear", found.from, found.to);
    }
    var min = null, max = null;
    for (var i = 0; i < this.lines.length; ++i) {
      var line = this.lines[i];
      var span = getMarkedSpanFor(line.markedSpans, this);
      if (cm && !this.collapsed) regLineChange(cm, lineNo(line), "text");
      else if (cm) {
        if (span.to != null) max = lineNo(line);
        if (span.from != null) min = lineNo(line);
      }
      line.markedSpans = removeMarkedSpan(line.markedSpans, span);
      if (span.from == null && this.collapsed && !lineIsHidden(this.doc, line) && cm)
        updateLineHeight(line, textHeight(cm.display));
    }
    if (cm && this.collapsed && !cm.options.lineWrapping) for (var i = 0; i < this.lines.length; ++i) {
      var visual = visualLine(this.lines[i]), len = lineLength(visual);
      if (len > cm.display.maxLineLength) {
        cm.display.maxLine = visual;
        cm.display.maxLineLength = len;
        cm.display.maxLineChanged = true;
      }
    }

    if (min != null && cm && this.collapsed) regChange(cm, min, max + 1);
    this.lines.length = 0;
    this.explicitlyCleared = true;
    if (this.atomic && this.doc.cantEdit) {
      this.doc.cantEdit = false;
      if (cm) reCheckSelection(cm.doc);
    }
    if (cm) signalLater(cm, "markerCleared", cm, this);
    if (withOp) endOperation(cm);
    if (this.parent) this.parent.clear();
  };

  // Find the position of the marker in the document. Returns a {from,
  // to} object by default. Side can be passed to get a specific side
  // -- 0 (both), -1 (left), or 1 (right). When lineObj is true, the
  // Pos objects returned contain a line object, rather than a line
  // number (used to prevent looking up the same line twice).
  TextMarker.prototype.find = function(side, lineObj) {
    if (side == null && this.type == "bookmark") side = 1;
    var from, to;
    for (var i = 0; i < this.lines.length; ++i) {
      var line = this.lines[i];
      var span = getMarkedSpanFor(line.markedSpans, this);
      if (span.from != null) {
        from = Pos(lineObj ? line : lineNo(line), span.from);
        if (side == -1) return from;
      }
      if (span.to != null) {
        to = Pos(lineObj ? line : lineNo(line), span.to);
        if (side == 1) return to;
      }
    }
    return from && {from: from, to: to};
  };

  // Signals that the marker's widget changed, and surrounding layout
  // should be recomputed.
  TextMarker.prototype.changed = function() {
    var pos = this.find(-1, true), widget = this, cm = this.doc.cm;
    if (!pos || !cm) return;
    runInOp(cm, function() {
      var line = pos.line, lineN = lineNo(pos.line);
      var view = findViewForLine(cm, lineN);
      if (view) {
        clearLineMeasurementCacheFor(view);
        cm.curOp.selectionChanged = cm.curOp.forceUpdate = true;
      }
      cm.curOp.updateMaxLine = true;
      if (!lineIsHidden(widget.doc, line) && widget.height != null) {
        var oldHeight = widget.height;
        widget.height = null;
        var dHeight = widgetHeight(widget) - oldHeight;
        if (dHeight)
          updateLineHeight(line, line.height + dHeight);
      }
    });
  };

  TextMarker.prototype.attachLine = function(line) {
    if (!this.lines.length && this.doc.cm) {
      var op = this.doc.cm.curOp;
      if (!op.maybeHiddenMarkers || indexOf(op.maybeHiddenMarkers, this) == -1)
        (op.maybeUnhiddenMarkers || (op.maybeUnhiddenMarkers = [])).push(this);
    }
    this.lines.push(line);
  };
  TextMarker.prototype.detachLine = function(line) {
    this.lines.splice(indexOf(this.lines, line), 1);
    if (!this.lines.length && this.doc.cm) {
      var op = this.doc.cm.curOp;
      (op.maybeHiddenMarkers || (op.maybeHiddenMarkers = [])).push(this);
    }
  };

  // Collapsed markers have unique ids, in order to be able to order
  // them, which is needed for uniquely determining an outer marker
  // when they overlap (they may nest, but not partially overlap).
  var nextMarkerId = 0;

  // Create a marker, wire it up to the right lines, and
  function markText(doc, from, to, options, type) {
    // Shared markers (across linked documents) are handled separately
    // (markTextShared will call out to this again, once per
    // document).
    if (options && options.shared) return markTextShared(doc, from, to, options, type);
    // Ensure we are in an operation.
    if (doc.cm && !doc.cm.curOp) return operation(doc.cm, markText)(doc, from, to, options, type);

    var marker = new TextMarker(doc, type), diff = cmp(from, to);
    if (options) copyObj(options, marker, false);
    // Don't connect empty markers unless clearWhenEmpty is false
    if (diff > 0 || diff == 0 && marker.clearWhenEmpty !== false)
      return marker;
    if (marker.replacedWith) {
      // Showing up as a widget implies collapsed (widget replaces text)
      marker.collapsed = true;
      marker.widgetNode = elt("span", [marker.replacedWith], "CodeMirror-widget");
      if (!options.handleMouseEvents) marker.widgetNode.setAttribute("cm-ignore-events", "true");
      if (options.insertLeft) marker.widgetNode.insertLeft = true;
    }
    if (marker.collapsed) {
      if (conflictingCollapsedRange(doc, from.line, from, to, marker) ||
          from.line != to.line && conflictingCollapsedRange(doc, to.line, from, to, marker))
        throw new Error("Inserting collapsed marker partially overlapping an existing one");
      sawCollapsedSpans = true;
    }

    if (marker.addToHistory)
      addChangeToHistory(doc, {from: from, to: to, origin: "markText"}, doc.sel, NaN);

    var curLine = from.line, cm = doc.cm, updateMaxLine;
    doc.iter(curLine, to.line + 1, function(line) {
      if (cm && marker.collapsed && !cm.options.lineWrapping && visualLine(line) == cm.display.maxLine)
        updateMaxLine = true;
      if (marker.collapsed && curLine != from.line) updateLineHeight(line, 0);
      addMarkedSpan(line, new MarkedSpan(marker,
                                         curLine == from.line ? from.ch : null,
                                         curLine == to.line ? to.ch : null));
      ++curLine;
    });
    // lineIsHidden depends on the presence of the spans, so needs a second pass
    if (marker.collapsed) doc.iter(from.line, to.line + 1, function(line) {
      if (lineIsHidden(doc, line)) updateLineHeight(line, 0);
    });

    if (marker.clearOnEnter) on(marker, "beforeCursorEnter", function() { marker.clear(); });

    if (marker.readOnly) {
      sawReadOnlySpans = true;
      if (doc.history.done.length || doc.history.undone.length)
        doc.clearHistory();
    }
    if (marker.collapsed) {
      marker.id = ++nextMarkerId;
      marker.atomic = true;
    }
    if (cm) {
      // Sync editor state
      if (updateMaxLine) cm.curOp.updateMaxLine = true;
      if (marker.collapsed)
        regChange(cm, from.line, to.line + 1);
      else if (marker.className || marker.title || marker.startStyle || marker.endStyle || marker.css)
        for (var i = from.line; i <= to.line; i++) regLineChange(cm, i, "text");
      if (marker.atomic) reCheckSelection(cm.doc);
      signalLater(cm, "markerAdded", cm, marker);
    }
    return marker;
  }

  // SHARED TEXTMARKERS

  // A shared marker spans multiple linked documents. It is
  // implemented as a meta-marker-object controlling multiple normal
  // markers.
  var SharedTextMarker = CodeMirror.SharedTextMarker = function(markers, primary) {
    this.markers = markers;
    this.primary = primary;
    for (var i = 0; i < markers.length; ++i)
      markers[i].parent = this;
  };
  eventMixin(SharedTextMarker);

  SharedTextMarker.prototype.clear = function() {
    if (this.explicitlyCleared) return;
    this.explicitlyCleared = true;
    for (var i = 0; i < this.markers.length; ++i)
      this.markers[i].clear();
    signalLater(this, "clear");
  };
  SharedTextMarker.prototype.find = function(side, lineObj) {
    return this.primary.find(side, lineObj);
  };

  function markTextShared(doc, from, to, options, type) {
    options = copyObj(options);
    options.shared = false;
    var markers = [markText(doc, from, to, options, type)], primary = markers[0];
    var widget = options.widgetNode;
    linkedDocs(doc, function(doc) {
      if (widget) options.widgetNode = widget.cloneNode(true);
      markers.push(markText(doc, clipPos(doc, from), clipPos(doc, to), options, type));
      for (var i = 0; i < doc.linked.length; ++i)
        if (doc.linked[i].isParent) return;
      primary = lst(markers);
    });
    return new SharedTextMarker(markers, primary);
  }

  function findSharedMarkers(doc) {
    return doc.findMarks(Pos(doc.first, 0), doc.clipPos(Pos(doc.lastLine())),
                         function(m) { return m.parent; });
  }

  function copySharedMarkers(doc, markers) {
    for (var i = 0; i < markers.length; i++) {
      var marker = markers[i], pos = marker.find();
      var mFrom = doc.clipPos(pos.from), mTo = doc.clipPos(pos.to);
      if (cmp(mFrom, mTo)) {
        var subMark = markText(doc, mFrom, mTo, marker.primary, marker.primary.type);
        marker.markers.push(subMark);
        subMark.parent = marker;
      }
    }
  }

  function detachSharedMarkers(markers) {
    for (var i = 0; i < markers.length; i++) {
      var marker = markers[i], linked = [marker.primary.doc];;
      linkedDocs(marker.primary.doc, function(d) { linked.push(d); });
      for (var j = 0; j < marker.markers.length; j++) {
        var subMarker = marker.markers[j];
        if (indexOf(linked, subMarker.doc) == -1) {
          subMarker.parent = null;
          marker.markers.splice(j--, 1);
        }
      }
    }
  }

  // TEXTMARKER SPANS

  function MarkedSpan(marker, from, to) {
    this.marker = marker;
    this.from = from; this.to = to;
  }

  // Search an array of spans for a span matching the given marker.
  function getMarkedSpanFor(spans, marker) {
    if (spans) for (var i = 0; i < spans.length; ++i) {
      var span = spans[i];
      if (span.marker == marker) return span;
    }
  }
  // Remove a span from an array, returning undefined if no spans are
  // left (we don't store arrays for lines without spans).
  function removeMarkedSpan(spans, span) {
    for (var r, i = 0; i < spans.length; ++i)
      if (spans[i] != span) (r || (r = [])).push(spans[i]);
    return r;
  }
  // Add a span to a line.
  function addMarkedSpan(line, span) {
    line.markedSpans = line.markedSpans ? line.markedSpans.concat([span]) : [span];
    span.marker.attachLine(line);
  }

  // Used for the algorithm that adjusts markers for a change in the
  // document. These functions cut an array of spans at a given
  // character position, returning an array of remaining chunks (or
  // undefined if nothing remains).
  function markedSpansBefore(old, startCh, isInsert) {
    if (old) for (var i = 0, nw; i < old.length; ++i) {
      var span = old[i], marker = span.marker;
      var startsBefore = span.from == null || (marker.inclusiveLeft ? span.from <= startCh : span.from < startCh);
      if (startsBefore || span.from == startCh && marker.type == "bookmark" && (!isInsert || !span.marker.insertLeft)) {
        var endsAfter = span.to == null || (marker.inclusiveRight ? span.to >= startCh : span.to > startCh);
        (nw || (nw = [])).push(new MarkedSpan(marker, span.from, endsAfter ? null : span.to));
      }
    }
    return nw;
  }
  function markedSpansAfter(old, endCh, isInsert) {
    if (old) for (var i = 0, nw; i < old.length; ++i) {
      var span = old[i], marker = span.marker;
      var endsAfter = span.to == null || (marker.inclusiveRight ? span.to >= endCh : span.to > endCh);
      if (endsAfter || span.from == endCh && marker.type == "bookmark" && (!isInsert || span.marker.insertLeft)) {
        var startsBefore = span.from == null || (marker.inclusiveLeft ? span.from <= endCh : span.from < endCh);
        (nw || (nw = [])).push(new MarkedSpan(marker, startsBefore ? null : span.from - endCh,
                                              span.to == null ? null : span.to - endCh));
      }
    }
    return nw;
  }

  // Given a change object, compute the new set of marker spans that
  // cover the line in which the change took place. Removes spans
  // entirely within the change, reconnects spans belonging to the
  // same marker that appear on both sides of the change, and cuts off
  // spans partially within the change. Returns an array of span
  // arrays with one element for each line in (after) the change.
  function stretchSpansOverChange(doc, change) {
    if (change.full) return null;
    var oldFirst = isLine(doc, change.from.line) && getLine(doc, change.from.line).markedSpans;
    var oldLast = isLine(doc, change.to.line) && getLine(doc, change.to.line).markedSpans;
    if (!oldFirst && !oldLast) return null;

    var startCh = change.from.ch, endCh = change.to.ch, isInsert = cmp(change.from, change.to) == 0;
    // Get the spans that 'stick out' on both sides
    var first = markedSpansBefore(oldFirst, startCh, isInsert);
    var last = markedSpansAfter(oldLast, endCh, isInsert);

    // Next, merge those two ends
    var sameLine = change.text.length == 1, offset = lst(change.text).length + (sameLine ? startCh : 0);
    if (first) {
      // Fix up .to properties of first
      for (var i = 0; i < first.length; ++i) {
        var span = first[i];
        if (span.to == null) {
          var found = getMarkedSpanFor(last, span.marker);
          if (!found) span.to = startCh;
          else if (sameLine) span.to = found.to == null ? null : found.to + offset;
        }
      }
    }
    if (last) {
      // Fix up .from in last (or move them into first in case of sameLine)
      for (var i = 0; i < last.length; ++i) {
        var span = last[i];
        if (span.to != null) span.to += offset;
        if (span.from == null) {
          var found = getMarkedSpanFor(first, span.marker);
          if (!found) {
            span.from = offset;
            if (sameLine) (first || (first = [])).push(span);
          }
        } else {
          span.from += offset;
          if (sameLine) (first || (first = [])).push(span);
        }
      }
    }
    // Make sure we didn't create any zero-length spans
    if (first) first = clearEmptySpans(first);
    if (last && last != first) last = clearEmptySpans(last);

    var newMarkers = [first];
    if (!sameLine) {
      // Fill gap with whole-line-spans
      var gap = change.text.length - 2, gapMarkers;
      if (gap > 0 && first)
        for (var i = 0; i < first.length; ++i)
          if (first[i].to == null)
            (gapMarkers || (gapMarkers = [])).push(new MarkedSpan(first[i].marker, null, null));
      for (var i = 0; i < gap; ++i)
        newMarkers.push(gapMarkers);
      newMarkers.push(last);
    }
    return newMarkers;
  }

  // Remove spans that are empty and don't have a clearWhenEmpty
  // option of false.
  function clearEmptySpans(spans) {
    for (var i = 0; i < spans.length; ++i) {
      var span = spans[i];
      if (span.from != null && span.from == span.to && span.marker.clearWhenEmpty !== false)
        spans.splice(i--, 1);
    }
    if (!spans.length) return null;
    return spans;
  }

  // Used for un/re-doing changes from the history. Combines the
  // result of computing the existing spans with the set of spans that
  // existed in the history (so that deleting around a span and then
  // undoing brings back the span).
  function mergeOldSpans(doc, change) {
    var old = getOldSpans(doc, change);
    var stretched = stretchSpansOverChange(doc, change);
    if (!old) return stretched;
    if (!stretched) return old;

    for (var i = 0; i < old.length; ++i) {
      var oldCur = old[i], stretchCur = stretched[i];
      if (oldCur && stretchCur) {
        spans: for (var j = 0; j < stretchCur.length; ++j) {
          var span = stretchCur[j];
          for (var k = 0; k < oldCur.length; ++k)
            if (oldCur[k].marker == span.marker) continue spans;
          oldCur.push(span);
        }
      } else if (stretchCur) {
        old[i] = stretchCur;
      }
    }
    return old;
  }

  // Used to 'clip' out readOnly ranges when making a change.
  function removeReadOnlyRanges(doc, from, to) {
    var markers = null;
    doc.iter(from.line, to.line + 1, function(line) {
      if (line.markedSpans) for (var i = 0; i < line.markedSpans.length; ++i) {
        var mark = line.markedSpans[i].marker;
        if (mark.readOnly && (!markers || indexOf(markers, mark) == -1))
          (markers || (markers = [])).push(mark);
      }
    });
    if (!markers) return null;
    var parts = [{from: from, to: to}];
    for (var i = 0; i < markers.length; ++i) {
      var mk = markers[i], m = mk.find(0);
      for (var j = 0; j < parts.length; ++j) {
        var p = parts[j];
        if (cmp(p.to, m.from) < 0 || cmp(p.from, m.to) > 0) continue;
        var newParts = [j, 1], dfrom = cmp(p.from, m.from), dto = cmp(p.to, m.to);
        if (dfrom < 0 || !mk.inclusiveLeft && !dfrom)
          newParts.push({from: p.from, to: m.from});
        if (dto > 0 || !mk.inclusiveRight && !dto)
          newParts.push({from: m.to, to: p.to});
        parts.splice.apply(parts, newParts);
        j += newParts.length - 1;
      }
    }
    return parts;
  }

  // Connect or disconnect spans from a line.
  function detachMarkedSpans(line) {
    var spans = line.markedSpans;
    if (!spans) return;
    for (var i = 0; i < spans.length; ++i)
      spans[i].marker.detachLine(line);
    line.markedSpans = null;
  }
  function attachMarkedSpans(line, spans) {
    if (!spans) return;
    for (var i = 0; i < spans.length; ++i)
      spans[i].marker.attachLine(line);
    line.markedSpans = spans;
  }

  // Helpers used when computing which overlapping collapsed span
  // counts as the larger one.
  function extraLeft(marker) { return marker.inclusiveLeft ? -1 : 0; }
  function extraRight(marker) { return marker.inclusiveRight ? 1 : 0; }

  // Returns a number indicating which of two overlapping collapsed
  // spans is larger (and thus includes the other). Falls back to
  // comparing ids when the spans cover exactly the same range.
  function compareCollapsedMarkers(a, b) {
    var lenDiff = a.lines.length - b.lines.length;
    if (lenDiff != 0) return lenDiff;
    var aPos = a.find(), bPos = b.find();
    var fromCmp = cmp(aPos.from, bPos.from) || extraLeft(a) - extraLeft(b);
    if (fromCmp) return -fromCmp;
    var toCmp = cmp(aPos.to, bPos.to) || extraRight(a) - extraRight(b);
    if (toCmp) return toCmp;
    return b.id - a.id;
  }

  // Find out whether a line ends or starts in a collapsed span. If
  // so, return the marker for that span.
  function collapsedSpanAtSide(line, start) {
    var sps = sawCollapsedSpans && line.markedSpans, found;
    if (sps) for (var sp, i = 0; i < sps.length; ++i) {
      sp = sps[i];
      if (sp.marker.collapsed && (start ? sp.from : sp.to) == null &&
          (!found || compareCollapsedMarkers(found, sp.marker) < 0))
        found = sp.marker;
    }
    return found;
  }
  function collapsedSpanAtStart(line) { return collapsedSpanAtSide(line, true); }
  function collapsedSpanAtEnd(line) { return collapsedSpanAtSide(line, false); }

  // Test whether there exists a collapsed span that partially
  // overlaps (covers the start or end, but not both) of a new span.
  // Such overlap is not allowed.
  function conflictingCollapsedRange(doc, lineNo, from, to, marker) {
    var line = getLine(doc, lineNo);
    var sps = sawCollapsedSpans && line.markedSpans;
    if (sps) for (var i = 0; i < sps.length; ++i) {
      var sp = sps[i];
      if (!sp.marker.collapsed) continue;
      var found = sp.marker.find(0);
      var fromCmp = cmp(found.from, from) || extraLeft(sp.marker) - extraLeft(marker);
      var toCmp = cmp(found.to, to) || extraRight(sp.marker) - extraRight(marker);
      if (fromCmp >= 0 && toCmp <= 0 || fromCmp <= 0 && toCmp >= 0) continue;
      if (fromCmp <= 0 && (cmp(found.to, from) > 0 || (sp.marker.inclusiveRight && marker.inclusiveLeft)) ||
          fromCmp >= 0 && (cmp(found.from, to) < 0 || (sp.marker.inclusiveLeft && marker.inclusiveRight)))
        return true;
    }
  }

  // A visual line is a line as drawn on the screen. Folding, for
  // example, can cause multiple logical lines to appear on the same
  // visual line. This finds the start of the visual line that the
  // given line is part of (usually that is the line itself).
  function visualLine(line) {
    var merged;
    while (merged = collapsedSpanAtStart(line))
      line = merged.find(-1, true).line;
    return line;
  }

  // Returns an array of logical lines that continue the visual line
  // started by the argument, or undefined if there are no such lines.
  function visualLineContinued(line) {
    var merged, lines;
    while (merged = collapsedSpanAtEnd(line)) {
      line = merged.find(1, true).line;
      (lines || (lines = [])).push(line);
    }
    return lines;
  }

  // Get the line number of the start of the visual line that the
  // given line number is part of.
  function visualLineNo(doc, lineN) {
    var line = getLine(doc, lineN), vis = visualLine(line);
    if (line == vis) return lineN;
    return lineNo(vis);
  }
  // Get the line number of the start of the next visual line after
  // the given line.
  function visualLineEndNo(doc, lineN) {
    if (lineN > doc.lastLine()) return lineN;
    var line = getLine(doc, lineN), merged;
    if (!lineIsHidden(doc, line)) return lineN;
    while (merged = collapsedSpanAtEnd(line))
      line = merged.find(1, true).line;
    return lineNo(line) + 1;
  }

  // Compute whether a line is hidden. Lines count as hidden when they
  // are part of a visual line that starts with another line, or when
  // they are entirely covered by collapsed, non-widget span.
  function lineIsHidden(doc, line) {
    var sps = sawCollapsedSpans && line.markedSpans;
    if (sps) for (var sp, i = 0; i < sps.length; ++i) {
      sp = sps[i];
      if (!sp.marker.collapsed) continue;
      if (sp.from == null) return true;
      if (sp.marker.widgetNode) continue;
      if (sp.from == 0 && sp.marker.inclusiveLeft && lineIsHiddenInner(doc, line, sp))
        return true;
    }
  }
  function lineIsHiddenInner(doc, line, span) {
    if (span.to == null) {
      var end = span.marker.find(1, true);
      return lineIsHiddenInner(doc, end.line, getMarkedSpanFor(end.line.markedSpans, span.marker));
    }
    if (span.marker.inclusiveRight && span.to == line.text.length)
      return true;
    for (var sp, i = 0; i < line.markedSpans.length; ++i) {
      sp = line.markedSpans[i];
      if (sp.marker.collapsed && !sp.marker.widgetNode && sp.from == span.to &&
          (sp.to == null || sp.to != span.from) &&
          (sp.marker.inclusiveLeft || span.marker.inclusiveRight) &&
          lineIsHiddenInner(doc, line, sp)) return true;
    }
  }

  // LINE WIDGETS

  // Line widgets are block elements displayed above or below a line.

  var LineWidget = CodeMirror.LineWidget = function(doc, node, options) {
    if (options) for (var opt in options) if (options.hasOwnProperty(opt))
      this[opt] = options[opt];
    this.doc = doc;
    this.node = node;
  };
  eventMixin(LineWidget);

  function adjustScrollWhenAboveVisible(cm, line, diff) {
    if (heightAtLine(line) < ((cm.curOp && cm.curOp.scrollTop) || cm.doc.scrollTop))
      addToScrollPos(cm, null, diff);
  }

  LineWidget.prototype.clear = function() {
    var cm = this.doc.cm, ws = this.line.widgets, line = this.line, no = lineNo(line);
    if (no == null || !ws) return;
    for (var i = 0; i < ws.length; ++i) if (ws[i] == this) ws.splice(i--, 1);
    if (!ws.length) line.widgets = null;
    var height = widgetHeight(this);
    updateLineHeight(line, Math.max(0, line.height - height));
    if (cm) runInOp(cm, function() {
      adjustScrollWhenAboveVisible(cm, line, -height);
      regLineChange(cm, no, "widget");
    });
  };
  LineWidget.prototype.changed = function() {
    var oldH = this.height, cm = this.doc.cm, line = this.line;
    this.height = null;
    var diff = widgetHeight(this) - oldH;
    if (!diff) return;
    updateLineHeight(line, line.height + diff);
    if (cm) runInOp(cm, function() {
      cm.curOp.forceUpdate = true;
      adjustScrollWhenAboveVisible(cm, line, diff);
    });
  };

  function widgetHeight(widget) {
    if (widget.height != null) return widget.height;
    var cm = widget.doc.cm;
    if (!cm) return 0;
    if (!contains(document.body, widget.node)) {
      var parentStyle = "position: relative;";
      if (widget.coverGutter)
        parentStyle += "margin-left: -" + cm.display.gutters.offsetWidth + "px;";
      if (widget.noHScroll)
        parentStyle += "width: " + cm.display.wrapper.clientWidth + "px;";
      removeChildrenAndAdd(cm.display.measure, elt("div", [widget.node], null, parentStyle));
    }
    return widget.height = widget.node.offsetHeight;
  }

  function addLineWidget(doc, handle, node, options) {
    var widget = new LineWidget(doc, node, options);
    var cm = doc.cm;
    if (cm && widget.noHScroll) cm.display.alignWidgets = true;
    changeLine(doc, handle, "widget", function(line) {
      var widgets = line.widgets || (line.widgets = []);
      if (widget.insertAt == null) widgets.push(widget);
      else widgets.splice(Math.min(widgets.length - 1, Math.max(0, widget.insertAt)), 0, widget);
      widget.line = line;
      if (cm && !lineIsHidden(doc, line)) {
        var aboveVisible = heightAtLine(line) < doc.scrollTop;
        updateLineHeight(line, line.height + widgetHeight(widget));
        if (aboveVisible) addToScrollPos(cm, null, widget.height);
        cm.curOp.forceUpdate = true;
      }
      return true;
    });
    return widget;
  }

  // LINE DATA STRUCTURE

  // Line objects. These hold state related to a line, including
  // highlighting info (the styles array).
  var Line = CodeMirror.Line = function(text, markedSpans, estimateHeight) {
    this.text = text;
    attachMarkedSpans(this, markedSpans);
    this.height = estimateHeight ? estimateHeight(this) : 1;
  };
  eventMixin(Line);
  Line.prototype.lineNo = function() { return lineNo(this); };

  // Change the content (text, markers) of a line. Automatically
  // invalidates cached information and tries to re-estimate the
  // line's height.
  function updateLine(line, text, markedSpans, estimateHeight) {
    line.text = text;
    if (line.stateAfter) line.stateAfter = null;
    if (line.styles) line.styles = null;
    if (line.order != null) line.order = null;
    detachMarkedSpans(line);
    attachMarkedSpans(line, markedSpans);
    var estHeight = estimateHeight ? estimateHeight(line) : 1;
    if (estHeight != line.height) updateLineHeight(line, estHeight);
  }

  // Detach a line from the document tree and its markers.
  function cleanUpLine(line) {
    line.parent = null;
    detachMarkedSpans(line);
  }

  function extractLineClasses(type, output) {
    if (type) for (;;) {
      var lineClass = type.match(/(?:^|\s+)line-(background-)?(\S+)/);
      if (!lineClass) break;
      type = type.slice(0, lineClass.index) + type.slice(lineClass.index + lineClass[0].length);
      var prop = lineClass[1] ? "bgClass" : "textClass";
      if (output[prop] == null)
        output[prop] = lineClass[2];
      else if (!(new RegExp("(?:^|\s)" + lineClass[2] + "(?:$|\s)")).test(output[prop]))
        output[prop] += " " + lineClass[2];
    }
    return type;
  }

  function callBlankLine(mode, state) {
    if (mode.blankLine) return mode.blankLine(state);
    if (!mode.innerMode) return;
    var inner = CodeMirror.innerMode(mode, state);
    if (inner.mode.blankLine) return inner.mode.blankLine(inner.state);
  }

  function readToken(mode, stream, state, inner) {
    for (var i = 0; i < 10; i++) {
      if (inner) inner[0] = CodeMirror.innerMode(mode, state).mode;
      var style = mode.token(stream, state);
      if (stream.pos > stream.start) return style;
    }
    throw new Error("Mode " + mode.name + " failed to advance stream.");
  }

  // Utility for getTokenAt and getLineTokens
  function takeToken(cm, pos, precise, asArray) {
    function getObj(copy) {
      return {start: stream.start, end: stream.pos,
              string: stream.current(),
              type: style || null,
              state: copy ? copyState(doc.mode, state) : state};
    }

    var doc = cm.doc, mode = doc.mode, style;
    pos = clipPos(doc, pos);
    var line = getLine(doc, pos.line), state = getStateBefore(cm, pos.line, precise);
    var stream = new StringStream(line.text, cm.options.tabSize), tokens;
    if (asArray) tokens = [];
    while ((asArray || stream.pos < pos.ch) && !stream.eol()) {
      stream.start = stream.pos;
      style = readToken(mode, stream, state);
      if (asArray) tokens.push(getObj(true));
    }
    return asArray ? tokens : getObj();
  }

  // Run the given mode's parser over a line, calling f for each token.
  function runMode(cm, text, mode, state, f, lineClasses, forceToEnd) {
    var flattenSpans = mode.flattenSpans;
    if (flattenSpans == null) flattenSpans = cm.options.flattenSpans;
    var curStart = 0, curStyle = null;
    var stream = new StringStream(text, cm.options.tabSize), style;
    var inner = cm.options.addModeClass && [null];
    if (text == "") extractLineClasses(callBlankLine(mode, state), lineClasses);
    while (!stream.eol()) {
      if (stream.pos > cm.options.maxHighlightLength) {
        flattenSpans = false;
        if (forceToEnd) processLine(cm, text, state, stream.pos);
        stream.pos = text.length;
        style = null;
      } else {
        style = extractLineClasses(readToken(mode, stream, state, inner), lineClasses);
      }
      if (inner) {
        var mName = inner[0].name;
        if (mName) style = "m-" + (style ? mName + " " + style : mName);
      }
      if (!flattenSpans || curStyle != style) {
        while (curStart < stream.start) {
          curStart = Math.min(stream.start, curStart + 50000);
          f(curStart, curStyle);
        }
        curStyle = style;
      }
      stream.start = stream.pos;
    }
    while (curStart < stream.pos) {
      // Webkit seems to refuse to render text nodes longer than 57444 characters
      var pos = Math.min(stream.pos, curStart + 50000);
      f(pos, curStyle);
      curStart = pos;
    }
  }

  // Compute a style array (an array starting with a mode generation
  // -- for invalidation -- followed by pairs of end positions and
  // style strings), which is used to highlight the tokens on the
  // line.
  function highlightLine(cm, line, state, forceToEnd) {
    // A styles array always starts with a number identifying the
    // mode/overlays that it is based on (for easy invalidation).
    var st = [cm.state.modeGen], lineClasses = {};
    // Compute the base array of styles
    runMode(cm, line.text, cm.doc.mode, state, function(end, style) {
      st.push(end, style);
    }, lineClasses, forceToEnd);

    // Run overlays, adjust style array.
    for (var o = 0; o < cm.state.overlays.length; ++o) {
      var overlay = cm.state.overlays[o], i = 1, at = 0;
      runMode(cm, line.text, overlay.mode, true, function(end, style) {
        var start = i;
        // Ensure there's a token end at the current position, and that i points at it
        while (at < end) {
          var i_end = st[i];
          if (i_end > end)
            st.splice(i, 1, end, st[i+1], i_end);
          i += 2;
          at = Math.min(end, i_end);
        }
        if (!style) return;
        if (overlay.opaque) {
          st.splice(start, i - start, end, "cm-overlay " + style);
          i = start + 2;
        } else {
          for (; start < i; start += 2) {
            var cur = st[start+1];
            st[start+1] = (cur ? cur + " " : "") + "cm-overlay " + style;
          }
        }
      }, lineClasses);
    }

    return {styles: st, classes: lineClasses.bgClass || lineClasses.textClass ? lineClasses : null};
  }

  function getLineStyles(cm, line, updateFrontier) {
    if (!line.styles || line.styles[0] != cm.state.modeGen) {
      var result = highlightLine(cm, line, line.stateAfter = getStateBefore(cm, lineNo(line)));
      line.styles = result.styles;
      if (result.classes) line.styleClasses = result.classes;
      else if (line.styleClasses) line.styleClasses = null;
      if (updateFrontier === cm.doc.frontier) cm.doc.frontier++;
    }
    return line.styles;
  }

  // Lightweight form of highlight -- proceed over this line and
  // update state, but don't save a style array. Used for lines that
  // aren't currently visible.
  function processLine(cm, text, state, startAt) {
    var mode = cm.doc.mode;
    var stream = new StringStream(text, cm.options.tabSize);
    stream.start = stream.pos = startAt || 0;
    if (text == "") callBlankLine(mode, state);
    while (!stream.eol() && stream.pos <= cm.options.maxHighlightLength) {
      readToken(mode, stream, state);
      stream.start = stream.pos;
    }
  }

  // Convert a style as returned by a mode (either null, or a string
  // containing one or more styles) to a CSS style. This is cached,
  // and also looks for line-wide styles.
  var styleToClassCache = {}, styleToClassCacheWithMode = {};
  function interpretTokenStyle(style, options) {
    if (!style || /^\s*$/.test(style)) return null;
    var cache = options.addModeClass ? styleToClassCacheWithMode : styleToClassCache;
    return cache[style] ||
      (cache[style] = style.replace(/\S+/g, "cm-$&"));
  }

  // Render the DOM representation of the text of a line. Also builds
  // up a 'line map', which points at the DOM nodes that represent
  // specific stretches of text, and is used by the measuring code.
  // The returned object contains the DOM node, this map, and
  // information about line-wide styles that were set by the mode.
  function buildLineContent(cm, lineView) {
    // The padding-right forces the element to have a 'border', which
    // is needed on Webkit to be able to get line-level bounding
    // rectangles for it (in measureChar).
    var content = elt("span", null, null, webkit ? "padding-right: .1px" : null);
    var builder = {pre: elt("pre", [content]), content: content,
                   col: 0, pos: 0, cm: cm,
                   splitSpaces: (ie || webkit) && cm.getOption("lineWrapping")};
    lineView.measure = {};

    // Iterate over the logical lines that make up this visual line.
    for (var i = 0; i <= (lineView.rest ? lineView.rest.length : 0); i++) {
      var line = i ? lineView.rest[i - 1] : lineView.line, order;
      builder.pos = 0;
      builder.addToken = buildToken;
      // Optionally wire in some hacks into the token-rendering
      // algorithm, to deal with browser quirks.
      if (hasBadBidiRects(cm.display.measure) && (order = getOrder(line)))
        builder.addToken = buildTokenBadBidi(builder.addToken, order);
      builder.map = [];
      var allowFrontierUpdate = lineView != cm.display.externalMeasured && lineNo(line);
      insertLineContent(line, builder, getLineStyles(cm, line, allowFrontierUpdate));
      if (line.styleClasses) {
        if (line.styleClasses.bgClass)
          builder.bgClass = joinClasses(line.styleClasses.bgClass, builder.bgClass || "");
        if (line.styleClasses.textClass)
          builder.textClass = joinClasses(line.styleClasses.textClass, builder.textClass || "");
      }

      // Ensure at least a single node is present, for measuring.
      if (builder.map.length == 0)
        builder.map.push(0, 0, builder.content.appendChild(zeroWidthElement(cm.display.measure)));

      // Store the map and a cache object for the current logical line
      if (i == 0) {
        lineView.measure.map = builder.map;
        lineView.measure.cache = {};
      } else {
        (lineView.measure.maps || (lineView.measure.maps = [])).push(builder.map);
        (lineView.measure.caches || (lineView.measure.caches = [])).push({});
      }
    }

    // See issue #2901
    if (webkit && /\bcm-tab\b/.test(builder.content.lastChild.className))
      builder.content.className = "cm-tab-wrap-hack";

    signal(cm, "renderLine", cm, lineView.line, builder.pre);
    if (builder.pre.className)
      builder.textClass = joinClasses(builder.pre.className, builder.textClass || "");

    return builder;
  }

  function defaultSpecialCharPlaceholder(ch) {
    var token = elt("span", "\u2022", "cm-invalidchar");
    token.title = "\\u" + ch.charCodeAt(0).toString(16);
    token.setAttribute("aria-label", token.title);
    return token;
  }

  // Build up the DOM representation for a single token, and add it to
  // the line map. Takes care to render special characters separately.
  function buildToken(builder, text, style, startStyle, endStyle, title, css) {
    if (!text) return;
    var displayText = builder.splitSpaces ? text.replace(/ {3,}/g, splitSpaces) : text;
    var special = builder.cm.state.specialChars, mustWrap = false;
    if (!special.test(text)) {
      builder.col += text.length;
      var content = document.createTextNode(displayText);
      builder.map.push(builder.pos, builder.pos + text.length, content);
      if (ie && ie_version < 9) mustWrap = true;
      builder.pos += text.length;
    } else {
      var content = document.createDocumentFragment(), pos = 0;
      while (true) {
        special.lastIndex = pos;
        var m = special.exec(text);
        var skipped = m ? m.index - pos : text.length - pos;
        if (skipped) {
          var txt = document.createTextNode(displayText.slice(pos, pos + skipped));
          if (ie && ie_version < 9) content.appendChild(elt("span", [txt]));
          else content.appendChild(txt);
          builder.map.push(builder.pos, builder.pos + skipped, txt);
          builder.col += skipped;
          builder.pos += skipped;
        }
        if (!m) break;
        pos += skipped + 1;
        if (m[0] == "\t") {
          var tabSize = builder.cm.options.tabSize, tabWidth = tabSize - builder.col % tabSize;
          var txt = content.appendChild(elt("span", spaceStr(tabWidth), "cm-tab"));
          txt.setAttribute("role", "presentation");
          txt.setAttribute("cm-text", "\t");
          builder.col += tabWidth;
        } else {
          var txt = builder.cm.options.specialCharPlaceholder(m[0]);
          txt.setAttribute("cm-text", m[0]);
          if (ie && ie_version < 9) content.appendChild(elt("span", [txt]));
          else content.appendChild(txt);
          builder.col += 1;
        }
        builder.map.push(builder.pos, builder.pos + 1, txt);
        builder.pos++;
      }
    }
    if (style || startStyle || endStyle || mustWrap || css) {
      var fullStyle = style || "";
      if (startStyle) fullStyle += startStyle;
      if (endStyle) fullStyle += endStyle;
      var token = elt("span", [content], fullStyle, css);
      if (title) token.title = title;
      return builder.content.appendChild(token);
    }
    builder.content.appendChild(content);
  }

  function splitSpaces(old) {
    var out = " ";
    for (var i = 0; i < old.length - 2; ++i) out += i % 2 ? " " : "\u00a0";
    out += " ";
    return out;
  }

  // Work around nonsense dimensions being reported for stretches of
  // right-to-left text.
  function buildTokenBadBidi(inner, order) {
    return function(builder, text, style, startStyle, endStyle, title, css) {
      style = style ? style + " cm-force-border" : "cm-force-border";
      var start = builder.pos, end = start + text.length;
      for (;;) {
        // Find the part that overlaps with the start of this text
        for (var i = 0; i < order.length; i++) {
          var part = order[i];
          if (part.to > start && part.from <= start) break;
        }
        if (part.to >= end) return inner(builder, text, style, startStyle, endStyle, title, css);
        inner(builder, text.slice(0, part.to - start), style, startStyle, null, title, css);
        startStyle = null;
        text = text.slice(part.to - start);
        start = part.to;
      }
    };
  }

  function buildCollapsedSpan(builder, size, marker, ignoreWidget) {
    var widget = !ignoreWidget && marker.widgetNode;
    if (widget) builder.map.push(builder.pos, builder.pos + size, widget);
    if (!ignoreWidget && builder.cm.display.input.needsContentAttribute) {
      if (!widget)
        widget = builder.content.appendChild(document.createElement("span"));
      widget.setAttribute("cm-marker", marker.id);
    }
    if (widget) {
      builder.cm.display.input.setUneditable(widget);
      builder.content.appendChild(widget);
    }
    builder.pos += size;
  }

  // Outputs a number of spans to make up a line, taking highlighting
  // and marked text into account.
  function insertLineContent(line, builder, styles) {
    var spans = line.markedSpans, allText = line.text, at = 0;
    if (!spans) {
      for (var i = 1; i < styles.length; i+=2)
        builder.addToken(builder, allText.slice(at, at = styles[i]), interpretTokenStyle(styles[i+1], builder.cm.options));
      return;
    }

    var len = allText.length, pos = 0, i = 1, text = "", style, css;
    var nextChange = 0, spanStyle, spanEndStyle, spanStartStyle, title, collapsed;
    for (;;) {
      if (nextChange == pos) { // Update current marker set
        spanStyle = spanEndStyle = spanStartStyle = title = css = "";
        collapsed = null; nextChange = Infinity;
        var foundBookmarks = [];
        for (var j = 0; j < spans.length; ++j) {
          var sp = spans[j], m = sp.marker;
          if (m.type == "bookmark" && sp.from == pos && m.widgetNode) {
            foundBookmarks.push(m);
          } else if (sp.from <= pos && (sp.to == null || sp.to > pos || m.collapsed && sp.to == pos && sp.from == pos)) {
            if (sp.to != null && sp.to != pos && nextChange > sp.to) {
              nextChange = sp.to;
              spanEndStyle = "";
            }
            if (m.className) spanStyle += " " + m.className;
            if (m.css) css = m.css;
            if (m.startStyle && sp.from == pos) spanStartStyle += " " + m.startStyle;
            if (m.endStyle && sp.to == nextChange) spanEndStyle += " " + m.endStyle;
            if (m.title && !title) title = m.title;
            if (m.collapsed && (!collapsed || compareCollapsedMarkers(collapsed.marker, m) < 0))
              collapsed = sp;
          } else if (sp.from > pos && nextChange > sp.from) {
            nextChange = sp.from;
          }
        }
        if (collapsed && (collapsed.from || 0) == pos) {
          buildCollapsedSpan(builder, (collapsed.to == null ? len + 1 : collapsed.to) - pos,
                             collapsed.marker, collapsed.from == null);
          if (collapsed.to == null) return;
          if (collapsed.to == pos) collapsed = false;
        }
        if (!collapsed && foundBookmarks.length) for (var j = 0; j < foundBookmarks.length; ++j)
          buildCollapsedSpan(builder, 0, foundBookmarks[j]);
      }
      if (pos >= len) break;

      var upto = Math.min(len, nextChange);
      while (true) {
        if (text) {
          var end = pos + text.length;
          if (!collapsed) {
            var tokenText = end > upto ? text.slice(0, upto - pos) : text;
            builder.addToken(builder, tokenText, style ? style + spanStyle : spanStyle,
                             spanStartStyle, pos + tokenText.length == nextChange ? spanEndStyle : "", title, css);
          }
          if (end >= upto) {text = text.slice(upto - pos); pos = upto; break;}
          pos = end;
          spanStartStyle = "";
        }
        text = allText.slice(at, at = styles[i++]);
        style = interpretTokenStyle(styles[i++], builder.cm.options);
      }
    }
  }

  // DOCUMENT DATA STRUCTURE

  // By default, updates that start and end at the beginning of a line
  // are treated specially, in order to make the association of line
  // widgets and marker elements with the text behave more intuitive.
  function isWholeLineUpdate(doc, change) {
    return change.from.ch == 0 && change.to.ch == 0 && lst(change.text) == "" &&
      (!doc.cm || doc.cm.options.wholeLineUpdateBefore);
  }

  // Perform a change on the document data structure.
  function updateDoc(doc, change, markedSpans, estimateHeight) {
    function spansFor(n) {return markedSpans ? markedSpans[n] : null;}
    function update(line, text, spans) {
      updateLine(line, text, spans, estimateHeight);
      signalLater(line, "change", line, change);
    }
    function linesFor(start, end) {
      for (var i = start, result = []; i < end; ++i)
        result.push(new Line(text[i], spansFor(i), estimateHeight));
      return result;
    }

    var from = change.from, to = change.to, text = change.text;
    var firstLine = getLine(doc, from.line), lastLine = getLine(doc, to.line);
    var lastText = lst(text), lastSpans = spansFor(text.length - 1), nlines = to.line - from.line;

    // Adjust the line structure
    if (change.full) {
      doc.insert(0, linesFor(0, text.length));
      doc.remove(text.length, doc.size - text.length);
    } else if (isWholeLineUpdate(doc, change)) {
      // This is a whole-line replace. Treated specially to make
      // sure line objects move the way they are supposed to.
      var added = linesFor(0, text.length - 1);
      update(lastLine, lastLine.text, lastSpans);
      if (nlines) doc.remove(from.line, nlines);
      if (added.length) doc.insert(from.line, added);
    } else if (firstLine == lastLine) {
      if (text.length == 1) {
        update(firstLine, firstLine.text.slice(0, from.ch) + lastText + firstLine.text.slice(to.ch), lastSpans);
      } else {
        var added = linesFor(1, text.length - 1);
        added.push(new Line(lastText + firstLine.text.slice(to.ch), lastSpans, estimateHeight));
        update(firstLine, firstLine.text.slice(0, from.ch) + text[0], spansFor(0));
        doc.insert(from.line + 1, added);
      }
    } else if (text.length == 1) {
      update(firstLine, firstLine.text.slice(0, from.ch) + text[0] + lastLine.text.slice(to.ch), spansFor(0));
      doc.remove(from.line + 1, nlines);
    } else {
      update(firstLine, firstLine.text.slice(0, from.ch) + text[0], spansFor(0));
      update(lastLine, lastText + lastLine.text.slice(to.ch), lastSpans);
      var added = linesFor(1, text.length - 1);
      if (nlines > 1) doc.remove(from.line + 1, nlines - 1);
      doc.insert(from.line + 1, added);
    }

    signalLater(doc, "change", doc, change);
  }

  // The document is represented as a BTree consisting of leaves, with
  // chunk of lines in them, and branches, with up to ten leaves or
  // other branch nodes below them. The top node is always a branch
  // node, and is the document object itself (meaning it has
  // additional methods and properties).
  //
  // All nodes have parent links. The tree is used both to go from
  // line numbers to line objects, and to go from objects to numbers.
  // It also indexes by height, and is used to convert between height
  // and line object, and to find the total height of the document.
  //
  // See also http://marijnhaverbeke.nl/blog/codemirror-line-tree.html

  function LeafChunk(lines) {
    this.lines = lines;
    this.parent = null;
    for (var i = 0, height = 0; i < lines.length; ++i) {
      lines[i].parent = this;
      height += lines[i].height;
    }
    this.height = height;
  }

  LeafChunk.prototype = {
    chunkSize: function() { return this.lines.length; },
    // Remove the n lines at offset 'at'.
    removeInner: function(at, n) {
      for (var i = at, e = at + n; i < e; ++i) {
        var line = this.lines[i];
        this.height -= line.height;
        cleanUpLine(line);
        signalLater(line, "delete");
      }
      this.lines.splice(at, n);
    },
    // Helper used to collapse a small branch into a single leaf.
    collapse: function(lines) {
      lines.push.apply(lines, this.lines);
    },
    // Insert the given array of lines at offset 'at', count them as
    // having the given height.
    insertInner: function(at, lines, height) {
      this.height += height;
      this.lines = this.lines.slice(0, at).concat(lines).concat(this.lines.slice(at));
      for (var i = 0; i < lines.length; ++i) lines[i].parent = this;
    },
    // Used to iterate over a part of the tree.
    iterN: function(at, n, op) {
      for (var e = at + n; at < e; ++at)
        if (op(this.lines[at])) return true;
    }
  };

  function BranchChunk(children) {
    this.children = children;
    var size = 0, height = 0;
    for (var i = 0; i < children.length; ++i) {
      var ch = children[i];
      size += ch.chunkSize(); height += ch.height;
      ch.parent = this;
    }
    this.size = size;
    this.height = height;
    this.parent = null;
  }

  BranchChunk.prototype = {
    chunkSize: function() { return this.size; },
    removeInner: function(at, n) {
      this.size -= n;
      for (var i = 0; i < this.children.length; ++i) {
        var child = this.children[i], sz = child.chunkSize();
        if (at < sz) {
          var rm = Math.min(n, sz - at), oldHeight = child.height;
          child.removeInner(at, rm);
          this.height -= oldHeight - child.height;
          if (sz == rm) { this.children.splice(i--, 1); child.parent = null; }
          if ((n -= rm) == 0) break;
          at = 0;
        } else at -= sz;
      }
      // If the result is smaller than 25 lines, ensure that it is a
      // single leaf node.
      if (this.size - n < 25 &&
          (this.children.length > 1 || !(this.children[0] instanceof LeafChunk))) {
        var lines = [];
        this.collapse(lines);
        this.children = [new LeafChunk(lines)];
        this.children[0].parent = this;
      }
    },
    collapse: function(lines) {
      for (var i = 0; i < this.children.length; ++i) this.children[i].collapse(lines);
    },
    insertInner: function(at, lines, height) {
      this.size += lines.length;
      this.height += height;
      for (var i = 0; i < this.children.length; ++i) {
        var child = this.children[i], sz = child.chunkSize();
        if (at <= sz) {
          child.insertInner(at, lines, height);
          if (child.lines && child.lines.length > 50) {
            while (child.lines.length > 50) {
              var spilled = child.lines.splice(child.lines.length - 25, 25);
              var newleaf = new LeafChunk(spilled);
              child.height -= newleaf.height;
              this.children.splice(i + 1, 0, newleaf);
              newleaf.parent = this;
            }
            this.maybeSpill();
          }
          break;
        }
        at -= sz;
      }
    },
    // When a node has grown, check whether it should be split.
    maybeSpill: function() {
      if (this.children.length <= 10) return;
      var me = this;
      do {
        var spilled = me.children.splice(me.children.length - 5, 5);
        var sibling = new BranchChunk(spilled);
        if (!me.parent) { // Become the parent node
          var copy = new BranchChunk(me.children);
          copy.parent = me;
          me.children = [copy, sibling];
          me = copy;
        } else {
          me.size -= sibling.size;
          me.height -= sibling.height;
          var myIndex = indexOf(me.parent.children, me);
          me.parent.children.splice(myIndex + 1, 0, sibling);
        }
        sibling.parent = me.parent;
      } while (me.children.length > 10);
      me.parent.maybeSpill();
    },
    iterN: function(at, n, op) {
      for (var i = 0; i < this.children.length; ++i) {
        var child = this.children[i], sz = child.chunkSize();
        if (at < sz) {
          var used = Math.min(n, sz - at);
          if (child.iterN(at, used, op)) return true;
          if ((n -= used) == 0) break;
          at = 0;
        } else at -= sz;
      }
    }
  };

  var nextDocId = 0;
  var Doc = CodeMirror.Doc = function(text, mode, firstLine) {
    if (!(this instanceof Doc)) return new Doc(text, mode, firstLine);
    if (firstLine == null) firstLine = 0;

    BranchChunk.call(this, [new LeafChunk([new Line("", null)])]);
    this.first = firstLine;
    this.scrollTop = this.scrollLeft = 0;
    this.cantEdit = false;
    this.cleanGeneration = 1;
    this.frontier = firstLine;
    var start = Pos(firstLine, 0);
    this.sel = simpleSelection(start);
    this.history = new History(null);
    this.id = ++nextDocId;
    this.modeOption = mode;

    if (typeof text == "string") text = splitLines(text);
    updateDoc(this, {from: start, to: start, text: text});
    setSelection(this, simpleSelection(start), sel_dontScroll);
  };

  Doc.prototype = createObj(BranchChunk.prototype, {
    constructor: Doc,
    // Iterate over the document. Supports two forms -- with only one
    // argument, it calls that for each line in the document. With
    // three, it iterates over the range given by the first two (with
    // the second being non-inclusive).
    iter: function(from, to, op) {
      if (op) this.iterN(from - this.first, to - from, op);
      else this.iterN(this.first, this.first + this.size, from);
    },

    // Non-public interface for adding and removing lines.
    insert: function(at, lines) {
      var height = 0;
      for (var i = 0; i < lines.length; ++i) height += lines[i].height;
      this.insertInner(at - this.first, lines, height);
    },
    remove: function(at, n) { this.removeInner(at - this.first, n); },

    // From here, the methods are part of the public interface. Most
    // are also available from CodeMirror (editor) instances.

    getValue: function(lineSep) {
      var lines = getLines(this, this.first, this.first + this.size);
      if (lineSep === false) return lines;
      return lines.join(lineSep || "\n");
    },
    setValue: docMethodOp(function(code) {
      var top = Pos(this.first, 0), last = this.first + this.size - 1;
      makeChange(this, {from: top, to: Pos(last, getLine(this, last).text.length),
                        text: splitLines(code), origin: "setValue", full: true}, true);
      setSelection(this, simpleSelection(top));
    }),
    replaceRange: function(code, from, to, origin) {
      from = clipPos(this, from);
      to = to ? clipPos(this, to) : from;
      replaceRange(this, code, from, to, origin);
    },
    getRange: function(from, to, lineSep) {
      var lines = getBetween(this, clipPos(this, from), clipPos(this, to));
      if (lineSep === false) return lines;
      return lines.join(lineSep || "\n");
    },

    getLine: function(line) {var l = this.getLineHandle(line); return l && l.text;},

    getLineHandle: function(line) {if (isLine(this, line)) return getLine(this, line);},
    getLineNumber: function(line) {return lineNo(line);},

    getLineHandleVisualStart: function(line) {
      if (typeof line == "number") line = getLine(this, line);
      return visualLine(line);
    },

    lineCount: function() {return this.size;},
    firstLine: function() {return this.first;},
    lastLine: function() {return this.first + this.size - 1;},

    clipPos: function(pos) {return clipPos(this, pos);},

    getCursor: function(start) {
      var range = this.sel.primary(), pos;
      if (start == null || start == "head") pos = range.head;
      else if (start == "anchor") pos = range.anchor;
      else if (start == "end" || start == "to" || start === false) pos = range.to();
      else pos = range.from();
      return pos;
    },
    listSelections: function() { return this.sel.ranges; },
    somethingSelected: function() {return this.sel.somethingSelected();},

    setCursor: docMethodOp(function(line, ch, options) {
      setSimpleSelection(this, clipPos(this, typeof line == "number" ? Pos(line, ch || 0) : line), null, options);
    }),
    setSelection: docMethodOp(function(anchor, head, options) {
      setSimpleSelection(this, clipPos(this, anchor), clipPos(this, head || anchor), options);
    }),
    extendSelection: docMethodOp(function(head, other, options) {
      extendSelection(this, clipPos(this, head), other && clipPos(this, other), options);
    }),
    extendSelections: docMethodOp(function(heads, options) {
      extendSelections(this, clipPosArray(this, heads, options));
    }),
    extendSelectionsBy: docMethodOp(function(f, options) {
      extendSelections(this, map(this.sel.ranges, f), options);
    }),
    setSelections: docMethodOp(function(ranges, primary, options) {
      if (!ranges.length) return;
      for (var i = 0, out = []; i < ranges.length; i++)
        out[i] = new Range(clipPos(this, ranges[i].anchor),
                           clipPos(this, ranges[i].head));
      if (primary == null) primary = Math.min(ranges.length - 1, this.sel.primIndex);
      setSelection(this, normalizeSelection(out, primary), options);
    }),
    addSelection: docMethodOp(function(anchor, head, options) {
      var ranges = this.sel.ranges.slice(0);
      ranges.push(new Range(clipPos(this, anchor), clipPos(this, head || anchor)));
      setSelection(this, normalizeSelection(ranges, ranges.length - 1), options);
    }),

    getSelection: function(lineSep) {
      var ranges = this.sel.ranges, lines;
      for (var i = 0; i < ranges.length; i++) {
        var sel = getBetween(this, ranges[i].from(), ranges[i].to());
        lines = lines ? lines.concat(sel) : sel;
      }
      if (lineSep === false) return lines;
      else return lines.join(lineSep || "\n");
    },
    getSelections: function(lineSep) {
      var parts = [], ranges = this.sel.ranges;
      for (var i = 0; i < ranges.length; i++) {
        var sel = getBetween(this, ranges[i].from(), ranges[i].to());
        if (lineSep !== false) sel = sel.join(lineSep || "\n");
        parts[i] = sel;
      }
      return parts;
    },
    replaceSelection: function(code, collapse, origin) {
      var dup = [];
      for (var i = 0; i < this.sel.ranges.length; i++)
        dup[i] = code;
      this.replaceSelections(dup, collapse, origin || "+input");
    },
    replaceSelections: docMethodOp(function(code, collapse, origin) {
      var changes = [], sel = this.sel;
      for (var i = 0; i < sel.ranges.length; i++) {
        var range = sel.ranges[i];
        changes[i] = {from: range.from(), to: range.to(), text: splitLines(code[i]), origin: origin};
      }
      var newSel = collapse && collapse != "end" && computeReplacedSel(this, changes, collapse);
      for (var i = changes.length - 1; i >= 0; i--)
        makeChange(this, changes[i]);
      if (newSel) setSelectionReplaceHistory(this, newSel);
      else if (this.cm) ensureCursorVisible(this.cm);
    }),
    undo: docMethodOp(function() {makeChangeFromHistory(this, "undo");}),
    redo: docMethodOp(function() {makeChangeFromHistory(this, "redo");}),
    undoSelection: docMethodOp(function() {makeChangeFromHistory(this, "undo", true);}),
    redoSelection: docMethodOp(function() {makeChangeFromHistory(this, "redo", true);}),

    setExtending: function(val) {this.extend = val;},
    getExtending: function() {return this.extend;},

    historySize: function() {
      var hist = this.history, done = 0, undone = 0;
      for (var i = 0; i < hist.done.length; i++) if (!hist.done[i].ranges) ++done;
      for (var i = 0; i < hist.undone.length; i++) if (!hist.undone[i].ranges) ++undone;
      return {undo: done, redo: undone};
    },
    clearHistory: function() {this.history = new History(this.history.maxGeneration);},

    markClean: function() {
      this.cleanGeneration = this.changeGeneration(true);
    },
    changeGeneration: function(forceSplit) {
      if (forceSplit)
        this.history.lastOp = this.history.lastSelOp = this.history.lastOrigin = null;
      return this.history.generation;
    },
    isClean: function (gen) {
      return this.history.generation == (gen || this.cleanGeneration);
    },

    getHistory: function() {
      return {done: copyHistoryArray(this.history.done),
              undone: copyHistoryArray(this.history.undone)};
    },
    setHistory: function(histData) {
      var hist = this.history = new History(this.history.maxGeneration);
      hist.done = copyHistoryArray(histData.done.slice(0), null, true);
      hist.undone = copyHistoryArray(histData.undone.slice(0), null, true);
    },

    addLineClass: docMethodOp(function(handle, where, cls) {
      return changeLine(this, handle, where == "gutter" ? "gutter" : "class", function(line) {
        var prop = where == "text" ? "textClass"
                 : where == "background" ? "bgClass"
                 : where == "gutter" ? "gutterClass" : "wrapClass";
        if (!line[prop]) line[prop] = cls;
        else if (classTest(cls).test(line[prop])) return false;
        else line[prop] += " " + cls;
        return true;
      });
    }),
    removeLineClass: docMethodOp(function(handle, where, cls) {
      return changeLine(this, handle, where == "gutter" ? "gutter" : "class", function(line) {
        var prop = where == "text" ? "textClass"
                 : where == "background" ? "bgClass"
                 : where == "gutter" ? "gutterClass" : "wrapClass";
        var cur = line[prop];
        if (!cur) return false;
        else if (cls == null) line[prop] = null;
        else {
          var found = cur.match(classTest(cls));
          if (!found) return false;
          var end = found.index + found[0].length;
          line[prop] = cur.slice(0, found.index) + (!found.index || end == cur.length ? "" : " ") + cur.slice(end) || null;
        }
        return true;
      });
    }),

    addLineWidget: docMethodOp(function(handle, node, options) {
      return addLineWidget(this, handle, node, options);
    }),
    removeLineWidget: function(widget) { widget.clear(); },

    markText: function(from, to, options) {
      return markText(this, clipPos(this, from), clipPos(this, to), options, "range");
    },
    setBookmark: function(pos, options) {
      var realOpts = {replacedWith: options && (options.nodeType == null ? options.widget : options),
                      insertLeft: options && options.insertLeft,
                      clearWhenEmpty: false, shared: options && options.shared,
                      handleMouseEvents: options && options.handleMouseEvents};
      pos = clipPos(this, pos);
      return markText(this, pos, pos, realOpts, "bookmark");
    },
    findMarksAt: function(pos) {
      pos = clipPos(this, pos);
      var markers = [], spans = getLine(this, pos.line).markedSpans;
      if (spans) for (var i = 0; i < spans.length; ++i) {
        var span = spans[i];
        if ((span.from == null || span.from <= pos.ch) &&
            (span.to == null || span.to >= pos.ch))
          markers.push(span.marker.parent || span.marker);
      }
      return markers;
    },
    findMarks: function(from, to, filter) {
      from = clipPos(this, from); to = clipPos(this, to);
      var found = [], lineNo = from.line;
      this.iter(from.line, to.line + 1, function(line) {
        var spans = line.markedSpans;
        if (spans) for (var i = 0; i < spans.length; i++) {
          var span = spans[i];
          if (!(lineNo == from.line && from.ch > span.to ||
                span.from == null && lineNo != from.line||
                lineNo == to.line && span.from > to.ch) &&
              (!filter || filter(span.marker)))
            found.push(span.marker.parent || span.marker);
        }
        ++lineNo;
      });
      return found;
    },
    getAllMarks: function() {
      var markers = [];
      this.iter(function(line) {
        var sps = line.markedSpans;
        if (sps) for (var i = 0; i < sps.length; ++i)
          if (sps[i].from != null) markers.push(sps[i].marker);
      });
      return markers;
    },

    posFromIndex: function(off) {
      var ch, lineNo = this.first;
      this.iter(function(line) {
        var sz = line.text.length + 1;
        if (sz > off) { ch = off; return true; }
        off -= sz;
        ++lineNo;
      });
      return clipPos(this, Pos(lineNo, ch));
    },
    indexFromPos: function (coords) {
      coords = clipPos(this, coords);
      var index = coords.ch;
      if (coords.line < this.first || coords.ch < 0) return 0;
      this.iter(this.first, coords.line, function (line) {
        index += line.text.length + 1;
      });
      return index;
    },

    copy: function(copyHistory) {
      var doc = new Doc(getLines(this, this.first, this.first + this.size), this.modeOption, this.first);
      doc.scrollTop = this.scrollTop; doc.scrollLeft = this.scrollLeft;
      doc.sel = this.sel;
      doc.extend = false;
      if (copyHistory) {
        doc.history.undoDepth = this.history.undoDepth;
        doc.setHistory(this.getHistory());
      }
      return doc;
    },

    linkedDoc: function(options) {
      if (!options) options = {};
      var from = this.first, to = this.first + this.size;
      if (options.from != null && options.from > from) from = options.from;
      if (options.to != null && options.to < to) to = options.to;
      var copy = new Doc(getLines(this, from, to), options.mode || this.modeOption, from);
      if (options.sharedHist) copy.history = this.history;
      (this.linked || (this.linked = [])).push({doc: copy, sharedHist: options.sharedHist});
      copy.linked = [{doc: this, isParent: true, sharedHist: options.sharedHist}];
      copySharedMarkers(copy, findSharedMarkers(this));
      return copy;
    },
    unlinkDoc: function(other) {
      if (other instanceof CodeMirror) other = other.doc;
      if (this.linked) for (var i = 0; i < this.linked.length; ++i) {
        var link = this.linked[i];
        if (link.doc != other) continue;
        this.linked.splice(i, 1);
        other.unlinkDoc(this);
        detachSharedMarkers(findSharedMarkers(this));
        break;
      }
      // If the histories were shared, split them again
      if (other.history == this.history) {
        var splitIds = [other.id];
        linkedDocs(other, function(doc) {splitIds.push(doc.id);}, true);
        other.history = new History(null);
        other.history.done = copyHistoryArray(this.history.done, splitIds);
        other.history.undone = copyHistoryArray(this.history.undone, splitIds);
      }
    },
    iterLinkedDocs: function(f) {linkedDocs(this, f);},

    getMode: function() {return this.mode;},
    getEditor: function() {return this.cm;}
  });

  // Public alias.
  Doc.prototype.eachLine = Doc.prototype.iter;

  // Set up methods on CodeMirror's prototype to redirect to the editor's document.
  var dontDelegate = "iter insert remove copy getEditor constructor".split(" ");
  for (var prop in Doc.prototype) if (Doc.prototype.hasOwnProperty(prop) && indexOf(dontDelegate, prop) < 0)
    CodeMirror.prototype[prop] = (function(method) {
      return function() {return method.apply(this.doc, arguments);};
    })(Doc.prototype[prop]);

  eventMixin(Doc);

  // Call f for all linked documents.
  function linkedDocs(doc, f, sharedHistOnly) {
    function propagate(doc, skip, sharedHist) {
      if (doc.linked) for (var i = 0; i < doc.linked.length; ++i) {
        var rel = doc.linked[i];
        if (rel.doc == skip) continue;
        var shared = sharedHist && rel.sharedHist;
        if (sharedHistOnly && !shared) continue;
        f(rel.doc, shared);
        propagate(rel.doc, doc, shared);
      }
    }
    propagate(doc, null, true);
  }

  // Attach a document to an editor.
  function attachDoc(cm, doc) {
    if (doc.cm) throw new Error("This document is already in use.");
    cm.doc = doc;
    doc.cm = cm;
    estimateLineHeights(cm);
    loadMode(cm);
    if (!cm.options.lineWrapping) findMaxLine(cm);
    cm.options.mode = doc.modeOption;
    regChange(cm);
  }

  // LINE UTILITIES

  // Find the line object corresponding to the given line number.
  function getLine(doc, n) {
    n -= doc.first;
    if (n < 0 || n >= doc.size) throw new Error("There is no line " + (n + doc.first) + " in the document.");
    for (var chunk = doc; !chunk.lines;) {
      for (var i = 0;; ++i) {
        var child = chunk.children[i], sz = child.chunkSize();
        if (n < sz) { chunk = child; break; }
        n -= sz;
      }
    }
    return chunk.lines[n];
  }

  // Get the part of a document between two positions, as an array of
  // strings.
  function getBetween(doc, start, end) {
    var out = [], n = start.line;
    doc.iter(start.line, end.line + 1, function(line) {
      var text = line.text;
      if (n == end.line) text = text.slice(0, end.ch);
      if (n == start.line) text = text.slice(start.ch);
      out.push(text);
      ++n;
    });
    return out;
  }
  // Get the lines between from and to, as array of strings.
  function getLines(doc, from, to) {
    var out = [];
    doc.iter(from, to, function(line) { out.push(line.text); });
    return out;
  }

  // Update the height of a line, propagating the height change
  // upwards to parent nodes.
  function updateLineHeight(line, height) {
    var diff = height - line.height;
    if (diff) for (var n = line; n; n = n.parent) n.height += diff;
  }

  // Given a line object, find its line number by walking up through
  // its parent links.
  function lineNo(line) {
    if (line.parent == null) return null;
    var cur = line.parent, no = indexOf(cur.lines, line);
    for (var chunk = cur.parent; chunk; cur = chunk, chunk = chunk.parent) {
      for (var i = 0;; ++i) {
        if (chunk.children[i] == cur) break;
        no += chunk.children[i].chunkSize();
      }
    }
    return no + cur.first;
  }

  // Find the line at the given vertical position, using the height
  // information in the document tree.
  function lineAtHeight(chunk, h) {
    var n = chunk.first;
    outer: do {
      for (var i = 0; i < chunk.children.length; ++i) {
        var child = chunk.children[i], ch = child.height;
        if (h < ch) { chunk = child; continue outer; }
        h -= ch;
        n += child.chunkSize();
      }
      return n;
    } while (!chunk.lines);
    for (var i = 0; i < chunk.lines.length; ++i) {
      var line = chunk.lines[i], lh = line.height;
      if (h < lh) break;
      h -= lh;
    }
    return n + i;
  }


  // Find the height above the given line.
  function heightAtLine(lineObj) {
    lineObj = visualLine(lineObj);

    var h = 0, chunk = lineObj.parent;
    for (var i = 0; i < chunk.lines.length; ++i) {
      var line = chunk.lines[i];
      if (line == lineObj) break;
      else h += line.height;
    }
    for (var p = chunk.parent; p; chunk = p, p = chunk.parent) {
      for (var i = 0; i < p.children.length; ++i) {
        var cur = p.children[i];
        if (cur == chunk) break;
        else h += cur.height;
      }
    }
    return h;
  }

  // Get the bidi ordering for the given line (and cache it). Returns
  // false for lines that are fully left-to-right, and an array of
  // BidiSpan objects otherwise.
  function getOrder(line) {
    var order = line.order;
    if (order == null) order = line.order = bidiOrdering(line.text);
    return order;
  }

  // HISTORY

  function History(startGen) {
    // Arrays of change events and selections. Doing something adds an
    // event to done and clears undo. Undoing moves events from done
    // to undone, redoing moves them in the other direction.
    this.done = []; this.undone = [];
    this.undoDepth = Infinity;
    // Used to track when changes can be merged into a single undo
    // event
    this.lastModTime = this.lastSelTime = 0;
    this.lastOp = this.lastSelOp = null;
    this.lastOrigin = this.lastSelOrigin = null;
    // Used by the isClean() method
    this.generation = this.maxGeneration = startGen || 1;
  }

  // Create a history change event from an updateDoc-style change
  // object.
  function historyChangeFromChange(doc, change) {
    var histChange = {from: copyPos(change.from), to: changeEnd(change), text: getBetween(doc, change.from, change.to)};
    attachLocalSpans(doc, histChange, change.from.line, change.to.line + 1);
    linkedDocs(doc, function(doc) {attachLocalSpans(doc, histChange, change.from.line, change.to.line + 1);}, true);
    return histChange;
  }

  // Pop all selection events off the end of a history array. Stop at
  // a change event.
  function clearSelectionEvents(array) {
    while (array.length) {
      var last = lst(array);
      if (last.ranges) array.pop();
      else break;
    }
  }

  // Find the top change event in the history. Pop off selection
  // events that are in the way.
  function lastChangeEvent(hist, force) {
    if (force) {
      clearSelectionEvents(hist.done);
      return lst(hist.done);
    } else if (hist.done.length && !lst(hist.done).ranges) {
      return lst(hist.done);
    } else if (hist.done.length > 1 && !hist.done[hist.done.length - 2].ranges) {
      hist.done.pop();
      return lst(hist.done);
    }
  }

  // Register a change in the history. Merges changes that are within
  // a single operation, ore are close together with an origin that
  // allows merging (starting with "+") into a single event.
  function addChangeToHistory(doc, change, selAfter, opId) {
    var hist = doc.history;
    hist.undone.length = 0;
    var time = +new Date, cur;

    if ((hist.lastOp == opId ||
         hist.lastOrigin == change.origin && change.origin &&
         ((change.origin.charAt(0) == "+" && doc.cm && hist.lastModTime > time - doc.cm.options.historyEventDelay) ||
          change.origin.charAt(0) == "*")) &&
        (cur = lastChangeEvent(hist, hist.lastOp == opId))) {
      // Merge this change into the last event
      var last = lst(cur.changes);
      if (cmp(change.from, change.to) == 0 && cmp(change.from, last.to) == 0) {
        // Optimized case for simple insertion -- don't want to add
        // new changesets for every character typed
        last.to = changeEnd(change);
      } else {
        // Add new sub-event
        cur.changes.push(historyChangeFromChange(doc, change));
      }
    } else {
      // Can not be merged, start a new event.
      var before = lst(hist.done);
      if (!before || !before.ranges)
        pushSelectionToHistory(doc.sel, hist.done);
      cur = {changes: [historyChangeFromChange(doc, change)],
             generation: hist.generation};
      hist.done.push(cur);
      while (hist.done.length > hist.undoDepth) {
        hist.done.shift();
        if (!hist.done[0].ranges) hist.done.shift();
      }
    }
    hist.done.push(selAfter);
    hist.generation = ++hist.maxGeneration;
    hist.lastModTime = hist.lastSelTime = time;
    hist.lastOp = hist.lastSelOp = opId;
    hist.lastOrigin = hist.lastSelOrigin = change.origin;

    if (!last) signal(doc, "historyAdded");
  }

  function selectionEventCanBeMerged(doc, origin, prev, sel) {
    var ch = origin.charAt(0);
    return ch == "*" ||
      ch == "+" &&
      prev.ranges.length == sel.ranges.length &&
      prev.somethingSelected() == sel.somethingSelected() &&
      new Date - doc.history.lastSelTime <= (doc.cm ? doc.cm.options.historyEventDelay : 500);
  }

  // Called whenever the selection changes, sets the new selection as
  // the pending selection in the history, and pushes the old pending
  // selection into the 'done' array when it was significantly
  // different (in number of selected ranges, emptiness, or time).
  function addSelectionToHistory(doc, sel, opId, options) {
    var hist = doc.history, origin = options && options.origin;

    // A new event is started when the previous origin does not match
    // the current, or the origins don't allow matching. Origins
    // starting with * are always merged, those starting with + are
    // merged when similar and close together in time.
    if (opId == hist.lastSelOp ||
        (origin && hist.lastSelOrigin == origin &&
         (hist.lastModTime == hist.lastSelTime && hist.lastOrigin == origin ||
          selectionEventCanBeMerged(doc, origin, lst(hist.done), sel))))
      hist.done[hist.done.length - 1] = sel;
    else
      pushSelectionToHistory(sel, hist.done);

    hist.lastSelTime = +new Date;
    hist.lastSelOrigin = origin;
    hist.lastSelOp = opId;
    if (options && options.clearRedo !== false)
      clearSelectionEvents(hist.undone);
  }

  function pushSelectionToHistory(sel, dest) {
    var top = lst(dest);
    if (!(top && top.ranges && top.equals(sel)))
      dest.push(sel);
  }

  // Used to store marked span information in the history.
  function attachLocalSpans(doc, change, from, to) {
    var existing = change["spans_" + doc.id], n = 0;
    doc.iter(Math.max(doc.first, from), Math.min(doc.first + doc.size, to), function(line) {
      if (line.markedSpans)
        (existing || (existing = change["spans_" + doc.id] = {}))[n] = line.markedSpans;
      ++n;
    });
  }

  // When un/re-doing restores text containing marked spans, those
  // that have been explicitly cleared should not be restored.
  function removeClearedSpans(spans) {
    if (!spans) return null;
    for (var i = 0, out; i < spans.length; ++i) {
      if (spans[i].marker.explicitlyCleared) { if (!out) out = spans.slice(0, i); }
      else if (out) out.push(spans[i]);
    }
    return !out ? spans : out.length ? out : null;
  }

  // Retrieve and filter the old marked spans stored in a change event.
  function getOldSpans(doc, change) {
    var found = change["spans_" + doc.id];
    if (!found) return null;
    for (var i = 0, nw = []; i < change.text.length; ++i)
      nw.push(removeClearedSpans(found[i]));
    return nw;
  }

  // Used both to provide a JSON-safe object in .getHistory, and, when
  // detaching a document, to split the history in two
  function copyHistoryArray(events, newGroup, instantiateSel) {
    for (var i = 0, copy = []; i < events.length; ++i) {
      var event = events[i];
      if (event.ranges) {
        copy.push(instantiateSel ? Selection.prototype.deepCopy.call(event) : event);
        continue;
      }
      var changes = event.changes, newChanges = [];
      copy.push({changes: newChanges});
      for (var j = 0; j < changes.length; ++j) {
        var change = changes[j], m;
        newChanges.push({from: change.from, to: change.to, text: change.text});
        if (newGroup) for (var prop in change) if (m = prop.match(/^spans_(\d+)$/)) {
          if (indexOf(newGroup, Number(m[1])) > -1) {
            lst(newChanges)[prop] = change[prop];
            delete change[prop];
          }
        }
      }
    }
    return copy;
  }

  // Rebasing/resetting history to deal with externally-sourced changes

  function rebaseHistSelSingle(pos, from, to, diff) {
    if (to < pos.line) {
      pos.line += diff;
    } else if (from < pos.line) {
      pos.line = from;
      pos.ch = 0;
    }
  }

  // Tries to rebase an array of history events given a change in the
  // document. If the change touches the same lines as the event, the
  // event, and everything 'behind' it, is discarded. If the change is
  // before the event, the event's positions are updated. Uses a
  // copy-on-write scheme for the positions, to avoid having to
  // reallocate them all on every rebase, but also avoid problems with
  // shared position objects being unsafely updated.
  function rebaseHistArray(array, from, to, diff) {
    for (var i = 0; i < array.length; ++i) {
      var sub = array[i], ok = true;
      if (sub.ranges) {
        if (!sub.copied) { sub = array[i] = sub.deepCopy(); sub.copied = true; }
        for (var j = 0; j < sub.ranges.length; j++) {
          rebaseHistSelSingle(sub.ranges[j].anchor, from, to, diff);
          rebaseHistSelSingle(sub.ranges[j].head, from, to, diff);
        }
        continue;
      }
      for (var j = 0; j < sub.changes.length; ++j) {
        var cur = sub.changes[j];
        if (to < cur.from.line) {
          cur.from = Pos(cur.from.line + diff, cur.from.ch);
          cur.to = Pos(cur.to.line + diff, cur.to.ch);
        } else if (from <= cur.to.line) {
          ok = false;
          break;
        }
      }
      if (!ok) {
        array.splice(0, i + 1);
        i = 0;
      }
    }
  }

  function rebaseHist(hist, change) {
    var from = change.from.line, to = change.to.line, diff = change.text.length - (to - from) - 1;
    rebaseHistArray(hist.done, from, to, diff);
    rebaseHistArray(hist.undone, from, to, diff);
  }

  // EVENT UTILITIES

  // Due to the fact that we still support jurassic IE versions, some
  // compatibility wrappers are needed.

  var e_preventDefault = CodeMirror.e_preventDefault = function(e) {
    if (e.preventDefault) e.preventDefault();
    else e.returnValue = false;
  };
  var e_stopPropagation = CodeMirror.e_stopPropagation = function(e) {
    if (e.stopPropagation) e.stopPropagation();
    else e.cancelBubble = true;
  };
  function e_defaultPrevented(e) {
    return e.defaultPrevented != null ? e.defaultPrevented : e.returnValue == false;
  }
  var e_stop = CodeMirror.e_stop = function(e) {e_preventDefault(e); e_stopPropagation(e);};

  function e_target(e) {return e.target || e.srcElement;}
  function e_button(e) {
    var b = e.which;
    if (b == null) {
      if (e.button & 1) b = 1;
      else if (e.button & 2) b = 3;
      else if (e.button & 4) b = 2;
    }
    if (mac && e.ctrlKey && b == 1) b = 3;
    return b;
  }

  // EVENT HANDLING

  // Lightweight event framework. on/off also work on DOM nodes,
  // registering native DOM handlers.

  var on = CodeMirror.on = function(emitter, type, f) {
    if (emitter.addEventListener)
      emitter.addEventListener(type, f, false);
    else if (emitter.attachEvent)
      emitter.attachEvent("on" + type, f);
    else {
      var map = emitter._handlers || (emitter._handlers = {});
      var arr = map[type] || (map[type] = []);
      arr.push(f);
    }
  };

  var off = CodeMirror.off = function(emitter, type, f) {
    if (emitter.removeEventListener)
      emitter.removeEventListener(type, f, false);
    else if (emitter.detachEvent)
      emitter.detachEvent("on" + type, f);
    else {
      var arr = emitter._handlers && emitter._handlers[type];
      if (!arr) return;
      for (var i = 0; i < arr.length; ++i)
        if (arr[i] == f) { arr.splice(i, 1); break; }
    }
  };

  var signal = CodeMirror.signal = function(emitter, type /*, values...*/) {
    var arr = emitter._handlers && emitter._handlers[type];
    if (!arr) return;
    var args = Array.prototype.slice.call(arguments, 2);
    for (var i = 0; i < arr.length; ++i) arr[i].apply(null, args);
  };

  var orphanDelayedCallbacks = null;

  // Often, we want to signal events at a point where we are in the
  // middle of some work, but don't want the handler to start calling
  // other methods on the editor, which might be in an inconsistent
  // state or simply not expect any other events to happen.
  // signalLater looks whether there are any handlers, and schedules
  // them to be executed when the last operation ends, or, if no
  // operation is active, when a timeout fires.
  function signalLater(emitter, type /*, values...*/) {
    var arr = emitter._handlers && emitter._handlers[type];
    if (!arr) return;
    var args = Array.prototype.slice.call(arguments, 2), list;
    if (operationGroup) {
      list = operationGroup.delayedCallbacks;
    } else if (orphanDelayedCallbacks) {
      list = orphanDelayedCallbacks;
    } else {
      list = orphanDelayedCallbacks = [];
      setTimeout(fireOrphanDelayed, 0);
    }
    function bnd(f) {return function(){f.apply(null, args);};};
    for (var i = 0; i < arr.length; ++i)
      list.push(bnd(arr[i]));
  }

  function fireOrphanDelayed() {
    var delayed = orphanDelayedCallbacks;
    orphanDelayedCallbacks = null;
    for (var i = 0; i < delayed.length; ++i) delayed[i]();
  }

  // The DOM events that CodeMirror handles can be overridden by
  // registering a (non-DOM) handler on the editor for the event name,
  // and preventDefault-ing the event in that handler.
  function signalDOMEvent(cm, e, override) {
    if (typeof e == "string")
      e = {type: e, preventDefault: function() { this.defaultPrevented = true; }};
    signal(cm, override || e.type, cm, e);
    return e_defaultPrevented(e) || e.codemirrorIgnore;
  }

  function signalCursorActivity(cm) {
    var arr = cm._handlers && cm._handlers.cursorActivity;
    if (!arr) return;
    var set = cm.curOp.cursorActivityHandlers || (cm.curOp.cursorActivityHandlers = []);
    for (var i = 0; i < arr.length; ++i) if (indexOf(set, arr[i]) == -1)
      set.push(arr[i]);
  }

  function hasHandler(emitter, type) {
    var arr = emitter._handlers && emitter._handlers[type];
    return arr && arr.length > 0;
  }

  // Add on and off methods to a constructor's prototype, to make
  // registering events on such objects more convenient.
  function eventMixin(ctor) {
    ctor.prototype.on = function(type, f) {on(this, type, f);};
    ctor.prototype.off = function(type, f) {off(this, type, f);};
  }

  // MISC UTILITIES

  // Number of pixels added to scroller and sizer to hide scrollbar
  var scrollerGap = 30;

  // Returned or thrown by various protocols to signal 'I'm not
  // handling this'.
  var Pass = CodeMirror.Pass = {toString: function(){return "CodeMirror.Pass";}};

  // Reused option objects for setSelection & friends
  var sel_dontScroll = {scroll: false}, sel_mouse = {origin: "*mouse"}, sel_move = {origin: "+move"};

  function Delayed() {this.id = null;}
  Delayed.prototype.set = function(ms, f) {
    clearTimeout(this.id);
    this.id = setTimeout(f, ms);
  };

  // Counts the column offset in a string, taking tabs into account.
  // Used mostly to find indentation.
  var countColumn = CodeMirror.countColumn = function(string, end, tabSize, startIndex, startValue) {
    if (end == null) {
      end = string.search(/[^\s\u00a0]/);
      if (end == -1) end = string.length;
    }
    for (var i = startIndex || 0, n = startValue || 0;;) {
      var nextTab = string.indexOf("\t", i);
      if (nextTab < 0 || nextTab >= end)
        return n + (end - i);
      n += nextTab - i;
      n += tabSize - (n % tabSize);
      i = nextTab + 1;
    }
  };

  // The inverse of countColumn -- find the offset that corresponds to
  // a particular column.
  function findColumn(string, goal, tabSize) {
    for (var pos = 0, col = 0;;) {
      var nextTab = string.indexOf("\t", pos);
      if (nextTab == -1) nextTab = string.length;
      var skipped = nextTab - pos;
      if (nextTab == string.length || col + skipped >= goal)
        return pos + Math.min(skipped, goal - col);
      col += nextTab - pos;
      col += tabSize - (col % tabSize);
      pos = nextTab + 1;
      if (col >= goal) return pos;
    }
  }

  var spaceStrs = [""];
  function spaceStr(n) {
    while (spaceStrs.length <= n)
      spaceStrs.push(lst(spaceStrs) + " ");
    return spaceStrs[n];
  }

  function lst(arr) { return arr[arr.length-1]; }

  var selectInput = function(node) { node.select(); };
  if (ios) // Mobile Safari apparently has a bug where select() is broken.
    selectInput = function(node) { node.selectionStart = 0; node.selectionEnd = node.value.length; };
  else if (ie) // Suppress mysterious IE10 errors
    selectInput = function(node) { try { node.select(); } catch(_e) {} };

  function indexOf(array, elt) {
    for (var i = 0; i < array.length; ++i)
      if (array[i] == elt) return i;
    return -1;
  }
  function map(array, f) {
    var out = [];
    for (var i = 0; i < array.length; i++) out[i] = f(array[i], i);
    return out;
  }

  function nothing() {}

  function createObj(base, props) {
    var inst;
    if (Object.create) {
      inst = Object.create(base);
    } else {
      nothing.prototype = base;
      inst = new nothing();
    }
    if (props) copyObj(props, inst);
    return inst;
  };

  function copyObj(obj, target, overwrite) {
    if (!target) target = {};
    for (var prop in obj)
      if (obj.hasOwnProperty(prop) && (overwrite !== false || !target.hasOwnProperty(prop)))
        target[prop] = obj[prop];
    return target;
  }

  function bind(f) {
    var args = Array.prototype.slice.call(arguments, 1);
    return function(){return f.apply(null, args);};
  }

  var nonASCIISingleCaseWordChar = /[\u00df\u0587\u0590-\u05f4\u0600-\u06ff\u3040-\u309f\u30a0-\u30ff\u3400-\u4db5\u4e00-\u9fcc\uac00-\ud7af]/;
  var isWordCharBasic = CodeMirror.isWordChar = function(ch) {
    return /\w/.test(ch) || ch > "\x80" &&
      (ch.toUpperCase() != ch.toLowerCase() || nonASCIISingleCaseWordChar.test(ch));
  };
  function isWordChar(ch, helper) {
    if (!helper) return isWordCharBasic(ch);
    if (helper.source.indexOf("\\w") > -1 && isWordCharBasic(ch)) return true;
    return helper.test(ch);
  }

  function isEmpty(obj) {
    for (var n in obj) if (obj.hasOwnProperty(n) && obj[n]) return false;
    return true;
  }

  // Extending unicode characters. A series of a non-extending char +
  // any number of extending chars is treated as a single unit as far
  // as editing and measuring is concerned. This is not fully correct,
  // since some scripts/fonts/browsers also treat other configurations
  // of code points as a group.
  var extendingChars = /[\u0300-\u036f\u0483-\u0489\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7\u0610-\u061a\u064b-\u065e\u0670\u06d6-\u06dc\u06de-\u06e4\u06e7\u06e8\u06ea-\u06ed\u0711\u0730-\u074a\u07a6-\u07b0\u07eb-\u07f3\u0816-\u0819\u081b-\u0823\u0825-\u0827\u0829-\u082d\u0900-\u0902\u093c\u0941-\u0948\u094d\u0951-\u0955\u0962\u0963\u0981\u09bc\u09be\u09c1-\u09c4\u09cd\u09d7\u09e2\u09e3\u0a01\u0a02\u0a3c\u0a41\u0a42\u0a47\u0a48\u0a4b-\u0a4d\u0a51\u0a70\u0a71\u0a75\u0a81\u0a82\u0abc\u0ac1-\u0ac5\u0ac7\u0ac8\u0acd\u0ae2\u0ae3\u0b01\u0b3c\u0b3e\u0b3f\u0b41-\u0b44\u0b4d\u0b56\u0b57\u0b62\u0b63\u0b82\u0bbe\u0bc0\u0bcd\u0bd7\u0c3e-\u0c40\u0c46-\u0c48\u0c4a-\u0c4d\u0c55\u0c56\u0c62\u0c63\u0cbc\u0cbf\u0cc2\u0cc6\u0ccc\u0ccd\u0cd5\u0cd6\u0ce2\u0ce3\u0d3e\u0d41-\u0d44\u0d4d\u0d57\u0d62\u0d63\u0dca\u0dcf\u0dd2-\u0dd4\u0dd6\u0ddf\u0e31\u0e34-\u0e3a\u0e47-\u0e4e\u0eb1\u0eb4-\u0eb9\u0ebb\u0ebc\u0ec8-\u0ecd\u0f18\u0f19\u0f35\u0f37\u0f39\u0f71-\u0f7e\u0f80-\u0f84\u0f86\u0f87\u0f90-\u0f97\u0f99-\u0fbc\u0fc6\u102d-\u1030\u1032-\u1037\u1039\u103a\u103d\u103e\u1058\u1059\u105e-\u1060\u1071-\u1074\u1082\u1085\u1086\u108d\u109d\u135f\u1712-\u1714\u1732-\u1734\u1752\u1753\u1772\u1773\u17b7-\u17bd\u17c6\u17c9-\u17d3\u17dd\u180b-\u180d\u18a9\u1920-\u1922\u1927\u1928\u1932\u1939-\u193b\u1a17\u1a18\u1a56\u1a58-\u1a5e\u1a60\u1a62\u1a65-\u1a6c\u1a73-\u1a7c\u1a7f\u1b00-\u1b03\u1b34\u1b36-\u1b3a\u1b3c\u1b42\u1b6b-\u1b73\u1b80\u1b81\u1ba2-\u1ba5\u1ba8\u1ba9\u1c2c-\u1c33\u1c36\u1c37\u1cd0-\u1cd2\u1cd4-\u1ce0\u1ce2-\u1ce8\u1ced\u1dc0-\u1de6\u1dfd-\u1dff\u200c\u200d\u20d0-\u20f0\u2cef-\u2cf1\u2de0-\u2dff\u302a-\u302f\u3099\u309a\ua66f-\ua672\ua67c\ua67d\ua6f0\ua6f1\ua802\ua806\ua80b\ua825\ua826\ua8c4\ua8e0-\ua8f1\ua926-\ua92d\ua947-\ua951\ua980-\ua982\ua9b3\ua9b6-\ua9b9\ua9bc\uaa29-\uaa2e\uaa31\uaa32\uaa35\uaa36\uaa43\uaa4c\uaab0\uaab2-\uaab4\uaab7\uaab8\uaabe\uaabf\uaac1\uabe5\uabe8\uabed\udc00-\udfff\ufb1e\ufe00-\ufe0f\ufe20-\ufe26\uff9e\uff9f]/;
  function isExtendingChar(ch) { return ch.charCodeAt(0) >= 768 && extendingChars.test(ch); }

  // DOM UTILITIES

  function elt(tag, content, className, style) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (style) e.style.cssText = style;
    if (typeof content == "string") e.appendChild(document.createTextNode(content));
    else if (content) for (var i = 0; i < content.length; ++i) e.appendChild(content[i]);
    return e;
  }

  var range;
  if (document.createRange) range = function(node, start, end, endNode) {
    var r = document.createRange();
    r.setEnd(endNode || node, end);
    r.setStart(node, start);
    return r;
  };
  else range = function(node, start, end) {
    var r = document.body.createTextRange();
    try { r.moveToElementText(node.parentNode); }
    catch(e) { return r; }
    r.collapse(true);
    r.moveEnd("character", end);
    r.moveStart("character", start);
    return r;
  };

  function removeChildren(e) {
    for (var count = e.childNodes.length; count > 0; --count)
      e.removeChild(e.firstChild);
    return e;
  }

  function removeChildrenAndAdd(parent, e) {
    return removeChildren(parent).appendChild(e);
  }

  var contains = CodeMirror.contains = function(parent, child) {
    if (child.nodeType == 3) // Android browser always returns false when child is a textnode
      child = child.parentNode;
    if (parent.contains)
      return parent.contains(child);
    do {
      if (child.nodeType == 11) child = child.host;
      if (child == parent) return true;
    } while (child = child.parentNode);
  };

  function activeElt() { return document.activeElement; }
  // Older versions of IE throws unspecified error when touching
  // document.activeElement in some cases (during loading, in iframe)
  if (ie && ie_version < 11) activeElt = function() {
    try { return document.activeElement; }
    catch(e) { return document.body; }
  };

  function classTest(cls) { return new RegExp("(^|\\s)" + cls + "(?:$|\\s)\\s*"); }
  var rmClass = CodeMirror.rmClass = function(node, cls) {
    var current = node.className;
    var match = classTest(cls).exec(current);
    if (match) {
      var after = current.slice(match.index + match[0].length);
      node.className = current.slice(0, match.index) + (after ? match[1] + after : "");
    }
  };
  var addClass = CodeMirror.addClass = function(node, cls) {
    var current = node.className;
    if (!classTest(cls).test(current)) node.className += (current ? " " : "") + cls;
  };
  function joinClasses(a, b) {
    var as = a.split(" ");
    for (var i = 0; i < as.length; i++)
      if (as[i] && !classTest(as[i]).test(b)) b += " " + as[i];
    return b;
  }

  // WINDOW-WIDE EVENTS

  // These must be handled carefully, because naively registering a
  // handler for each editor will cause the editors to never be
  // garbage collected.

  function forEachCodeMirror(f) {
    if (!document.body.getElementsByClassName) return;
    var byClass = document.body.getElementsByClassName("CodeMirror");
    for (var i = 0; i < byClass.length; i++) {
      var cm = byClass[i].CodeMirror;
      if (cm) f(cm);
    }
  }

  var globalsRegistered = false;
  function ensureGlobalHandlers() {
    if (globalsRegistered) return;
    registerGlobalHandlers();
    globalsRegistered = true;
  }
  function registerGlobalHandlers() {
    // When the window resizes, we need to refresh active editors.
    var resizeTimer;
    on(window, "resize", function() {
      if (resizeTimer == null) resizeTimer = setTimeout(function() {
        resizeTimer = null;
        forEachCodeMirror(onResize);
      }, 100);
    });
    // When the window loses focus, we want to show the editor as blurred
    on(window, "blur", function() {
      forEachCodeMirror(onBlur);
    });
  }

  // FEATURE DETECTION

  // Detect drag-and-drop
  var dragAndDrop = function() {
    // There is *some* kind of drag-and-drop support in IE6-8, but I
    // couldn't get it to work yet.
    if (ie && ie_version < 9) return false;
    var div = elt('div');
    return "draggable" in div || "dragDrop" in div;
  }();

  var zwspSupported;
  function zeroWidthElement(measure) {
    if (zwspSupported == null) {
      var test = elt("span", "\u200b");
      removeChildrenAndAdd(measure, elt("span", [test, document.createTextNode("x")]));
      if (measure.firstChild.offsetHeight != 0)
        zwspSupported = test.offsetWidth <= 1 && test.offsetHeight > 2 && !(ie && ie_version < 8);
    }
    var node = zwspSupported ? elt("span", "\u200b") :
      elt("span", "\u00a0", null, "display: inline-block; width: 1px; margin-right: -1px");
    node.setAttribute("cm-text", "");
    return node;
  }

  // Feature-detect IE's crummy client rect reporting for bidi text
  var badBidiRects;
  function hasBadBidiRects(measure) {
    if (badBidiRects != null) return badBidiRects;
    var txt = removeChildrenAndAdd(measure, document.createTextNode("A\u062eA"));
    var r0 = range(txt, 0, 1).getBoundingClientRect();
    if (!r0 || r0.left == r0.right) return false; // Safari returns null in some cases (#2780)
    var r1 = range(txt, 1, 2).getBoundingClientRect();
    return badBidiRects = (r1.right - r0.right < 3);
  }

  // See if "".split is the broken IE version, if so, provide an
  // alternative way to split lines.
  var splitLines = CodeMirror.splitLines = "\n\nb".split(/\n/).length != 3 ? function(string) {
    var pos = 0, result = [], l = string.length;
    while (pos <= l) {
      var nl = string.indexOf("\n", pos);
      if (nl == -1) nl = string.length;
      var line = string.slice(pos, string.charAt(nl - 1) == "\r" ? nl - 1 : nl);
      var rt = line.indexOf("\r");
      if (rt != -1) {
        result.push(line.slice(0, rt));
        pos += rt + 1;
      } else {
        result.push(line);
        pos = nl + 1;
      }
    }
    return result;
  } : function(string){return string.split(/\r\n?|\n/);};

  var hasSelection = window.getSelection ? function(te) {
    try { return te.selectionStart != te.selectionEnd; }
    catch(e) { return false; }
  } : function(te) {
    try {var range = te.ownerDocument.selection.createRange();}
    catch(e) {}
    if (!range || range.parentElement() != te) return false;
    return range.compareEndPoints("StartToEnd", range) != 0;
  };

  var hasCopyEvent = (function() {
    var e = elt("div");
    if ("oncopy" in e) return true;
    e.setAttribute("oncopy", "return;");
    return typeof e.oncopy == "function";
  })();

  var badZoomedRects = null;
  function hasBadZoomedRects(measure) {
    if (badZoomedRects != null) return badZoomedRects;
    var node = removeChildrenAndAdd(measure, elt("span", "x"));
    var normal = node.getBoundingClientRect();
    var fromRange = range(node, 0, 1).getBoundingClientRect();
    return badZoomedRects = Math.abs(normal.left - fromRange.left) > 1;
  }

  // KEY NAMES

  var keyNames = {3: "Enter", 8: "Backspace", 9: "Tab", 13: "Enter", 16: "Shift", 17: "Ctrl", 18: "Alt",
                  19: "Pause", 20: "CapsLock", 27: "Esc", 32: "Space", 33: "PageUp", 34: "PageDown", 35: "End",
                  36: "Home", 37: "Left", 38: "Up", 39: "Right", 40: "Down", 44: "PrintScrn", 45: "Insert",
                  46: "Delete", 59: ";", 61: "=", 91: "Mod", 92: "Mod", 93: "Mod", 107: "=", 109: "-", 127: "Delete",
                  173: "-", 186: ";", 187: "=", 188: ",", 189: "-", 190: ".", 191: "/", 192: "`", 219: "[", 220: "\\",
                  221: "]", 222: "'", 63232: "Up", 63233: "Down", 63234: "Left", 63235: "Right", 63272: "Delete",
                  63273: "Home", 63275: "End", 63276: "PageUp", 63277: "PageDown", 63302: "Insert"};
  CodeMirror.keyNames = keyNames;
  (function() {
    // Number keys
    for (var i = 0; i < 10; i++) keyNames[i + 48] = keyNames[i + 96] = String(i);
    // Alphabetic keys
    for (var i = 65; i <= 90; i++) keyNames[i] = String.fromCharCode(i);
    // Function keys
    for (var i = 1; i <= 12; i++) keyNames[i + 111] = keyNames[i + 63235] = "F" + i;
  })();

  // BIDI HELPERS

  function iterateBidiSections(order, from, to, f) {
    if (!order) return f(from, to, "ltr");
    var found = false;
    for (var i = 0; i < order.length; ++i) {
      var part = order[i];
      if (part.from < to && part.to > from || from == to && part.to == from) {
        f(Math.max(part.from, from), Math.min(part.to, to), part.level == 1 ? "rtl" : "ltr");
        found = true;
      }
    }
    if (!found) f(from, to, "ltr");
  }

  function bidiLeft(part) { return part.level % 2 ? part.to : part.from; }
  function bidiRight(part) { return part.level % 2 ? part.from : part.to; }

  function lineLeft(line) { var order = getOrder(line); return order ? bidiLeft(order[0]) : 0; }
  function lineRight(line) {
    var order = getOrder(line);
    if (!order) return line.text.length;
    return bidiRight(lst(order));
  }

  function lineStart(cm, lineN) {
    var line = getLine(cm.doc, lineN);
    var visual = visualLine(line);
    if (visual != line) lineN = lineNo(visual);
    var order = getOrder(visual);
    var ch = !order ? 0 : order[0].level % 2 ? lineRight(visual) : lineLeft(visual);
    return Pos(lineN, ch);
  }
  function lineEnd(cm, lineN) {
    var merged, line = getLine(cm.doc, lineN);
    while (merged = collapsedSpanAtEnd(line)) {
      line = merged.find(1, true).line;
      lineN = null;
    }
    var order = getOrder(line);
    var ch = !order ? line.text.length : order[0].level % 2 ? lineLeft(line) : lineRight(line);
    return Pos(lineN == null ? lineNo(line) : lineN, ch);
  }
  function lineStartSmart(cm, pos) {
    var start = lineStart(cm, pos.line);
    var line = getLine(cm.doc, start.line);
    var order = getOrder(line);
    if (!order || order[0].level == 0) {
      var firstNonWS = Math.max(0, line.text.search(/\S/));
      var inWS = pos.line == start.line && pos.ch <= firstNonWS && pos.ch;
      return Pos(start.line, inWS ? 0 : firstNonWS);
    }
    return start;
  }

  function compareBidiLevel(order, a, b) {
    var linedir = order[0].level;
    if (a == linedir) return true;
    if (b == linedir) return false;
    return a < b;
  }
  var bidiOther;
  function getBidiPartAt(order, pos) {
    bidiOther = null;
    for (var i = 0, found; i < order.length; ++i) {
      var cur = order[i];
      if (cur.from < pos && cur.to > pos) return i;
      if ((cur.from == pos || cur.to == pos)) {
        if (found == null) {
          found = i;
        } else if (compareBidiLevel(order, cur.level, order[found].level)) {
          if (cur.from != cur.to) bidiOther = found;
          return i;
        } else {
          if (cur.from != cur.to) bidiOther = i;
          return found;
        }
      }
    }
    return found;
  }

  function moveInLine(line, pos, dir, byUnit) {
    if (!byUnit) return pos + dir;
    do pos += dir;
    while (pos > 0 && isExtendingChar(line.text.charAt(pos)));
    return pos;
  }

  // This is needed in order to move 'visually' through bi-directional
  // text -- i.e., pressing left should make the cursor go left, even
  // when in RTL text. The tricky part is the 'jumps', where RTL and
  // LTR text touch each other. This often requires the cursor offset
  // to move more than one unit, in order to visually move one unit.
  function moveVisually(line, start, dir, byUnit) {
    var bidi = getOrder(line);
    if (!bidi) return moveLogically(line, start, dir, byUnit);
    var pos = getBidiPartAt(bidi, start), part = bidi[pos];
    var target = moveInLine(line, start, part.level % 2 ? -dir : dir, byUnit);

    for (;;) {
      if (target > part.from && target < part.to) return target;
      if (target == part.from || target == part.to) {
        if (getBidiPartAt(bidi, target) == pos) return target;
        part = bidi[pos += dir];
        return (dir > 0) == part.level % 2 ? part.to : part.from;
      } else {
        part = bidi[pos += dir];
        if (!part) return null;
        if ((dir > 0) == part.level % 2)
          target = moveInLine(line, part.to, -1, byUnit);
        else
          target = moveInLine(line, part.from, 1, byUnit);
      }
    }
  }

  function moveLogically(line, start, dir, byUnit) {
    var target = start + dir;
    if (byUnit) while (target > 0 && isExtendingChar(line.text.charAt(target))) target += dir;
    return target < 0 || target > line.text.length ? null : target;
  }

  // Bidirectional ordering algorithm
  // See http://unicode.org/reports/tr9/tr9-13.html for the algorithm
  // that this (partially) implements.

  // One-char codes used for character types:
  // L (L):   Left-to-Right
  // R (R):   Right-to-Left
  // r (AL):  Right-to-Left Arabic
  // 1 (EN):  European Number
  // + (ES):  European Number Separator
  // % (ET):  European Number Terminator
  // n (AN):  Arabic Number
  // , (CS):  Common Number Separator
  // m (NSM): Non-Spacing Mark
  // b (BN):  Boundary Neutral
  // s (B):   Paragraph Separator
  // t (S):   Segment Separator
  // w (WS):  Whitespace
  // N (ON):  Other Neutrals

  // Returns null if characters are ordered as they appear
  // (left-to-right), or an array of sections ({from, to, level}
  // objects) in the order in which they occur visually.
  var bidiOrdering = (function() {
    // Character types for codepoints 0 to 0xff
    var lowTypes = "bbbbbbbbbtstwsbbbbbbbbbbbbbbssstwNN%%%NNNNNN,N,N1111111111NNNNNNNLLLLLLLLLLLLLLLLLLLLLLLLLLNNNNNNLLLLLLLLLLLLLLLLLLLLLLLLLLNNNNbbbbbbsbbbbbbbbbbbbbbbbbbbbbbbbbb,N%%%%NNNNLNNNNN%%11NLNNN1LNNNNNLLLLLLLLLLLLLLLLLLLLLLLNLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLN";
    // Character types for codepoints 0x600 to 0x6ff
    var arabicTypes = "rrrrrrrrrrrr,rNNmmmmmmrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrmmmmmmmmmmmmmmrrrrrrrnnnnnnnnnn%nnrrrmrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrmmmmmmmmmmmmmmmmmmmNmmmm";
    function charType(code) {
      if (code <= 0xf7) return lowTypes.charAt(code);
      else if (0x590 <= code && code <= 0x5f4) return "R";
      else if (0x600 <= code && code <= 0x6ed) return arabicTypes.charAt(code - 0x600);
      else if (0x6ee <= code && code <= 0x8ac) return "r";
      else if (0x2000 <= code && code <= 0x200b) return "w";
      else if (code == 0x200c) return "b";
      else return "L";
    }

    var bidiRE = /[\u0590-\u05f4\u0600-\u06ff\u0700-\u08ac]/;
    var isNeutral = /[stwN]/, isStrong = /[LRr]/, countsAsLeft = /[Lb1n]/, countsAsNum = /[1n]/;
    // Browsers seem to always treat the boundaries of block elements as being L.
    var outerType = "L";

    function BidiSpan(level, from, to) {
      this.level = level;
      this.from = from; this.to = to;
    }

    return function(str) {
      if (!bidiRE.test(str)) return false;
      var len = str.length, types = [];
      for (var i = 0, type; i < len; ++i)
        types.push(type = charType(str.charCodeAt(i)));

      // W1. Examine each non-spacing mark (NSM) in the level run, and
      // change the type of the NSM to the type of the previous
      // character. If the NSM is at the start of the level run, it will
      // get the type of sor.
      for (var i = 0, prev = outerType; i < len; ++i) {
        var type = types[i];
        if (type == "m") types[i] = prev;
        else prev = type;
      }

      // W2. Search backwards from each instance of a European number
      // until the first strong type (R, L, AL, or sor) is found. If an
      // AL is found, change the type of the European number to Arabic
      // number.
      // W3. Change all ALs to R.
      for (var i = 0, cur = outerType; i < len; ++i) {
        var type = types[i];
        if (type == "1" && cur == "r") types[i] = "n";
        else if (isStrong.test(type)) { cur = type; if (type == "r") types[i] = "R"; }
      }

      // W4. A single European separator between two European numbers
      // changes to a European number. A single common separator between
      // two numbers of the same type changes to that type.
      for (var i = 1, prev = types[0]; i < len - 1; ++i) {
        var type = types[i];
        if (type == "+" && prev == "1" && types[i+1] == "1") types[i] = "1";
        else if (type == "," && prev == types[i+1] &&
                 (prev == "1" || prev == "n")) types[i] = prev;
        prev = type;
      }

      // W5. A sequence of European terminators adjacent to European
      // numbers changes to all European numbers.
      // W6. Otherwise, separators and terminators change to Other
      // Neutral.
      for (var i = 0; i < len; ++i) {
        var type = types[i];
        if (type == ",") types[i] = "N";
        else if (type == "%") {
          for (var end = i + 1; end < len && types[end] == "%"; ++end) {}
          var replace = (i && types[i-1] == "!") || (end < len && types[end] == "1") ? "1" : "N";
          for (var j = i; j < end; ++j) types[j] = replace;
          i = end - 1;
        }
      }

      // W7. Search backwards from each instance of a European number
      // until the first strong type (R, L, or sor) is found. If an L is
      // found, then change the type of the European number to L.
      for (var i = 0, cur = outerType; i < len; ++i) {
        var type = types[i];
        if (cur == "L" && type == "1") types[i] = "L";
        else if (isStrong.test(type)) cur = type;
      }

      // N1. A sequence of neutrals takes the direction of the
      // surrounding strong text if the text on both sides has the same
      // direction. European and Arabic numbers act as if they were R in
      // terms of their influence on neutrals. Start-of-level-run (sor)
      // and end-of-level-run (eor) are used at level run boundaries.
      // N2. Any remaining neutrals take the embedding direction.
      for (var i = 0; i < len; ++i) {
        if (isNeutral.test(types[i])) {
          for (var end = i + 1; end < len && isNeutral.test(types[end]); ++end) {}
          var before = (i ? types[i-1] : outerType) == "L";
          var after = (end < len ? types[end] : outerType) == "L";
          var replace = before || after ? "L" : "R";
          for (var j = i; j < end; ++j) types[j] = replace;
          i = end - 1;
        }
      }

      // Here we depart from the documented algorithm, in order to avoid
      // building up an actual levels array. Since there are only three
      // levels (0, 1, 2) in an implementation that doesn't take
      // explicit embedding into account, we can build up the order on
      // the fly, without following the level-based algorithm.
      var order = [], m;
      for (var i = 0; i < len;) {
        if (countsAsLeft.test(types[i])) {
          var start = i;
          for (++i; i < len && countsAsLeft.test(types[i]); ++i) {}
          order.push(new BidiSpan(0, start, i));
        } else {
          var pos = i, at = order.length;
          for (++i; i < len && types[i] != "L"; ++i) {}
          for (var j = pos; j < i;) {
            if (countsAsNum.test(types[j])) {
              if (pos < j) order.splice(at, 0, new BidiSpan(1, pos, j));
              var nstart = j;
              for (++j; j < i && countsAsNum.test(types[j]); ++j) {}
              order.splice(at, 0, new BidiSpan(2, nstart, j));
              pos = j;
            } else ++j;
          }
          if (pos < i) order.splice(at, 0, new BidiSpan(1, pos, i));
        }
      }
      if (order[0].level == 1 && (m = str.match(/^\s+/))) {
        order[0].from = m[0].length;
        order.unshift(new BidiSpan(0, 0, m[0].length));
      }
      if (lst(order).level == 1 && (m = str.match(/\s+$/))) {
        lst(order).to -= m[0].length;
        order.push(new BidiSpan(0, len - m[0].length, len));
      }
      if (order[0].level == 2)
        order.unshift(new BidiSpan(1, order[0].to, order[0].to));
      if (order[0].level != lst(order).level)
        order.push(new BidiSpan(order[0].level, len, len));

      return order;
    };
  })();

  // THE END

  CodeMirror.version = "5.4.0";

  return CodeMirror;
});

},{}]},{},["/Users/gaowhen/Lab/flaskr/app/static/src/js/lib/codemirror.js"])
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzdGF0aWMvc3JjL2pzL2xpYi9jb2RlbWlycm9yLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIi8vIENvZGVNaXJyb3IsIGNvcHlyaWdodCAoYykgYnkgTWFyaWpuIEhhdmVyYmVrZSBhbmQgb3RoZXJzXG4vLyBEaXN0cmlidXRlZCB1bmRlciBhbiBNSVQgbGljZW5zZTogaHR0cDovL2NvZGVtaXJyb3IubmV0L0xJQ0VOU0VcblxuLy8gVGhpcyBpcyBDb2RlTWlycm9yIChodHRwOi8vY29kZW1pcnJvci5uZXQpLCBhIGNvZGUgZWRpdG9yXG4vLyBpbXBsZW1lbnRlZCBpbiBKYXZhU2NyaXB0IG9uIHRvcCBvZiB0aGUgYnJvd3NlcidzIERPTS5cbi8vXG4vLyBZb3UgY2FuIGZpbmQgc29tZSB0ZWNobmljYWwgYmFja2dyb3VuZCBmb3Igc29tZSBvZiB0aGUgY29kZSBiZWxvd1xuLy8gYXQgaHR0cDovL21hcmlqbmhhdmVyYmVrZS5ubC9ibG9nLyNjbS1pbnRlcm5hbHMgLlxuXG4oZnVuY3Rpb24obW9kKSB7XG4gIGlmICh0eXBlb2YgZXhwb3J0cyA9PSBcIm9iamVjdFwiICYmIHR5cGVvZiBtb2R1bGUgPT0gXCJvYmplY3RcIikgLy8gQ29tbW9uSlNcbiAgICBtb2R1bGUuZXhwb3J0cyA9IG1vZCgpO1xuICBlbHNlIGlmICh0eXBlb2YgZGVmaW5lID09IFwiZnVuY3Rpb25cIiAmJiBkZWZpbmUuYW1kKSAvLyBBTURcbiAgICByZXR1cm4gZGVmaW5lKFtdLCBtb2QpO1xuICBlbHNlIC8vIFBsYWluIGJyb3dzZXIgZW52XG4gICAgdGhpcy5Db2RlTWlycm9yID0gbW9kKCk7XG59KShmdW5jdGlvbigpIHtcbiAgXCJ1c2Ugc3RyaWN0XCI7XG5cbiAgLy8gQlJPV1NFUiBTTklGRklOR1xuXG4gIC8vIEtsdWRnZXMgZm9yIGJ1Z3MgYW5kIGJlaGF2aW9yIGRpZmZlcmVuY2VzIHRoYXQgY2FuJ3QgYmUgZmVhdHVyZVxuICAvLyBkZXRlY3RlZCBhcmUgZW5hYmxlZCBiYXNlZCBvbiB1c2VyQWdlbnQgZXRjIHNuaWZmaW5nLlxuXG4gIHZhciBnZWNrbyA9IC9nZWNrb1xcL1xcZC9pLnRlc3QobmF2aWdhdG9yLnVzZXJBZ2VudCk7XG4gIHZhciBpZV91cHRvMTAgPSAvTVNJRSBcXGQvLnRlc3QobmF2aWdhdG9yLnVzZXJBZ2VudCk7XG4gIHZhciBpZV8xMXVwID0gL1RyaWRlbnRcXC8oPzpbNy05XXxcXGR7Mix9KVxcLi4qcnY6KFxcZCspLy5leGVjKG5hdmlnYXRvci51c2VyQWdlbnQpO1xuICB2YXIgaWUgPSBpZV91cHRvMTAgfHwgaWVfMTF1cDtcbiAgdmFyIGllX3ZlcnNpb24gPSBpZSAmJiAoaWVfdXB0bzEwID8gZG9jdW1lbnQuZG9jdW1lbnRNb2RlIHx8IDYgOiBpZV8xMXVwWzFdKTtcbiAgdmFyIHdlYmtpdCA9IC9XZWJLaXRcXC8vLnRlc3QobmF2aWdhdG9yLnVzZXJBZ2VudCk7XG4gIHZhciBxdHdlYmtpdCA9IHdlYmtpdCAmJiAvUXRcXC9cXGQrXFwuXFxkKy8udGVzdChuYXZpZ2F0b3IudXNlckFnZW50KTtcbiAgdmFyIGNocm9tZSA9IC9DaHJvbWVcXC8vLnRlc3QobmF2aWdhdG9yLnVzZXJBZ2VudCk7XG4gIHZhciBwcmVzdG8gPSAvT3BlcmFcXC8vLnRlc3QobmF2aWdhdG9yLnVzZXJBZ2VudCk7XG4gIHZhciBzYWZhcmkgPSAvQXBwbGUgQ29tcHV0ZXIvLnRlc3QobmF2aWdhdG9yLnZlbmRvcik7XG4gIHZhciBtYWNfZ2VNb3VudGFpbkxpb24gPSAvTWFjIE9TIFggMVxcZFxcRChbOC05XXxcXGRcXGQpXFxELy50ZXN0KG5hdmlnYXRvci51c2VyQWdlbnQpO1xuICB2YXIgcGhhbnRvbSA9IC9QaGFudG9tSlMvLnRlc3QobmF2aWdhdG9yLnVzZXJBZ2VudCk7XG5cbiAgdmFyIGlvcyA9IC9BcHBsZVdlYktpdC8udGVzdChuYXZpZ2F0b3IudXNlckFnZW50KSAmJiAvTW9iaWxlXFwvXFx3Ky8udGVzdChuYXZpZ2F0b3IudXNlckFnZW50KTtcbiAgLy8gVGhpcyBpcyB3b2VmdWxseSBpbmNvbXBsZXRlLiBTdWdnZXN0aW9ucyBmb3IgYWx0ZXJuYXRpdmUgbWV0aG9kcyB3ZWxjb21lLlxuICB2YXIgbW9iaWxlID0gaW9zIHx8IC9BbmRyb2lkfHdlYk9TfEJsYWNrQmVycnl8T3BlcmEgTWluaXxPcGVyYSBNb2JpfElFTW9iaWxlL2kudGVzdChuYXZpZ2F0b3IudXNlckFnZW50KTtcbiAgdmFyIG1hYyA9IGlvcyB8fCAvTWFjLy50ZXN0KG5hdmlnYXRvci5wbGF0Zm9ybSk7XG4gIHZhciB3aW5kb3dzID0gL3dpbi9pLnRlc3QobmF2aWdhdG9yLnBsYXRmb3JtKTtcblxuICB2YXIgcHJlc3RvX3ZlcnNpb24gPSBwcmVzdG8gJiYgbmF2aWdhdG9yLnVzZXJBZ2VudC5tYXRjaCgvVmVyc2lvblxcLyhcXGQqXFwuXFxkKikvKTtcbiAgaWYgKHByZXN0b192ZXJzaW9uKSBwcmVzdG9fdmVyc2lvbiA9IE51bWJlcihwcmVzdG9fdmVyc2lvblsxXSk7XG4gIGlmIChwcmVzdG9fdmVyc2lvbiAmJiBwcmVzdG9fdmVyc2lvbiA+PSAxNSkgeyBwcmVzdG8gPSBmYWxzZTsgd2Via2l0ID0gdHJ1ZTsgfVxuICAvLyBTb21lIGJyb3dzZXJzIHVzZSB0aGUgd3JvbmcgZXZlbnQgcHJvcGVydGllcyB0byBzaWduYWwgY21kL2N0cmwgb24gT1MgWFxuICB2YXIgZmxpcEN0cmxDbWQgPSBtYWMgJiYgKHF0d2Via2l0IHx8IHByZXN0byAmJiAocHJlc3RvX3ZlcnNpb24gPT0gbnVsbCB8fCBwcmVzdG9fdmVyc2lvbiA8IDEyLjExKSk7XG4gIHZhciBjYXB0dXJlUmlnaHRDbGljayA9IGdlY2tvIHx8IChpZSAmJiBpZV92ZXJzaW9uID49IDkpO1xuXG4gIC8vIE9wdGltaXplIHNvbWUgY29kZSB3aGVuIHRoZXNlIGZlYXR1cmVzIGFyZSBub3QgdXNlZC5cbiAgdmFyIHNhd1JlYWRPbmx5U3BhbnMgPSBmYWxzZSwgc2F3Q29sbGFwc2VkU3BhbnMgPSBmYWxzZTtcblxuICAvLyBFRElUT1IgQ09OU1RSVUNUT1JcblxuICAvLyBBIENvZGVNaXJyb3IgaW5zdGFuY2UgcmVwcmVzZW50cyBhbiBlZGl0b3IuIFRoaXMgaXMgdGhlIG9iamVjdFxuICAvLyB0aGF0IHVzZXIgY29kZSBpcyB1c3VhbGx5IGRlYWxpbmcgd2l0aC5cblxuICBmdW5jdGlvbiBDb2RlTWlycm9yKHBsYWNlLCBvcHRpb25zKSB7XG4gICAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIENvZGVNaXJyb3IpKSByZXR1cm4gbmV3IENvZGVNaXJyb3IocGxhY2UsIG9wdGlvbnMpO1xuXG4gICAgdGhpcy5vcHRpb25zID0gb3B0aW9ucyA9IG9wdGlvbnMgPyBjb3B5T2JqKG9wdGlvbnMpIDoge307XG4gICAgLy8gRGV0ZXJtaW5lIGVmZmVjdGl2ZSBvcHRpb25zIGJhc2VkIG9uIGdpdmVuIHZhbHVlcyBhbmQgZGVmYXVsdHMuXG4gICAgY29weU9iaihkZWZhdWx0cywgb3B0aW9ucywgZmFsc2UpO1xuICAgIHNldEd1dHRlcnNGb3JMaW5lTnVtYmVycyhvcHRpb25zKTtcblxuICAgIHZhciBkb2MgPSBvcHRpb25zLnZhbHVlO1xuICAgIGlmICh0eXBlb2YgZG9jID09IFwic3RyaW5nXCIpIGRvYyA9IG5ldyBEb2MoZG9jLCBvcHRpb25zLm1vZGUpO1xuICAgIHRoaXMuZG9jID0gZG9jO1xuXG4gICAgdmFyIGlucHV0ID0gbmV3IENvZGVNaXJyb3IuaW5wdXRTdHlsZXNbb3B0aW9ucy5pbnB1dFN0eWxlXSh0aGlzKTtcbiAgICB2YXIgZGlzcGxheSA9IHRoaXMuZGlzcGxheSA9IG5ldyBEaXNwbGF5KHBsYWNlLCBkb2MsIGlucHV0KTtcbiAgICBkaXNwbGF5LndyYXBwZXIuQ29kZU1pcnJvciA9IHRoaXM7XG4gICAgdXBkYXRlR3V0dGVycyh0aGlzKTtcbiAgICB0aGVtZUNoYW5nZWQodGhpcyk7XG4gICAgaWYgKG9wdGlvbnMubGluZVdyYXBwaW5nKVxuICAgICAgdGhpcy5kaXNwbGF5LndyYXBwZXIuY2xhc3NOYW1lICs9IFwiIENvZGVNaXJyb3Itd3JhcFwiO1xuICAgIGlmIChvcHRpb25zLmF1dG9mb2N1cyAmJiAhbW9iaWxlKSBkaXNwbGF5LmlucHV0LmZvY3VzKCk7XG4gICAgaW5pdFNjcm9sbGJhcnModGhpcyk7XG5cbiAgICB0aGlzLnN0YXRlID0ge1xuICAgICAga2V5TWFwczogW10sICAvLyBzdG9yZXMgbWFwcyBhZGRlZCBieSBhZGRLZXlNYXBcbiAgICAgIG92ZXJsYXlzOiBbXSwgLy8gaGlnaGxpZ2h0aW5nIG92ZXJsYXlzLCBhcyBhZGRlZCBieSBhZGRPdmVybGF5XG4gICAgICBtb2RlR2VuOiAwLCAgIC8vIGJ1bXBlZCB3aGVuIG1vZGUvb3ZlcmxheSBjaGFuZ2VzLCB1c2VkIHRvIGludmFsaWRhdGUgaGlnaGxpZ2h0aW5nIGluZm9cbiAgICAgIG92ZXJ3cml0ZTogZmFsc2UsXG4gICAgICBkZWxheWluZ0JsdXJFdmVudDogZmFsc2UsXG4gICAgICBmb2N1c2VkOiBmYWxzZSxcbiAgICAgIHN1cHByZXNzRWRpdHM6IGZhbHNlLCAvLyB1c2VkIHRvIGRpc2FibGUgZWRpdGluZyBkdXJpbmcga2V5IGhhbmRsZXJzIHdoZW4gaW4gcmVhZE9ubHkgbW9kZVxuICAgICAgcGFzdGVJbmNvbWluZzogZmFsc2UsIGN1dEluY29taW5nOiBmYWxzZSwgLy8gaGVscCByZWNvZ25pemUgcGFzdGUvY3V0IGVkaXRzIGluIGlucHV0LnBvbGxcbiAgICAgIGRyYWdnaW5nVGV4dDogZmFsc2UsXG4gICAgICBoaWdobGlnaHQ6IG5ldyBEZWxheWVkKCksIC8vIHN0b3JlcyBoaWdobGlnaHQgd29ya2VyIHRpbWVvdXRcbiAgICAgIGtleVNlcTogbnVsbCwgIC8vIFVuZmluaXNoZWQga2V5IHNlcXVlbmNlXG4gICAgICBzcGVjaWFsQ2hhcnM6IG51bGxcbiAgICB9O1xuXG4gICAgdmFyIGNtID0gdGhpcztcblxuICAgIC8vIE92ZXJyaWRlIG1hZ2ljIHRleHRhcmVhIGNvbnRlbnQgcmVzdG9yZSB0aGF0IElFIHNvbWV0aW1lcyBkb2VzXG4gICAgLy8gb24gb3VyIGhpZGRlbiB0ZXh0YXJlYSBvbiByZWxvYWRcbiAgICBpZiAoaWUgJiYgaWVfdmVyc2lvbiA8IDExKSBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkgeyBjbS5kaXNwbGF5LmlucHV0LnJlc2V0KHRydWUpOyB9LCAyMCk7XG5cbiAgICByZWdpc3RlckV2ZW50SGFuZGxlcnModGhpcyk7XG4gICAgZW5zdXJlR2xvYmFsSGFuZGxlcnMoKTtcblxuICAgIHN0YXJ0T3BlcmF0aW9uKHRoaXMpO1xuICAgIHRoaXMuY3VyT3AuZm9yY2VVcGRhdGUgPSB0cnVlO1xuICAgIGF0dGFjaERvYyh0aGlzLCBkb2MpO1xuXG4gICAgaWYgKChvcHRpb25zLmF1dG9mb2N1cyAmJiAhbW9iaWxlKSB8fCBjbS5oYXNGb2N1cygpKVxuICAgICAgc2V0VGltZW91dChiaW5kKG9uRm9jdXMsIHRoaXMpLCAyMCk7XG4gICAgZWxzZVxuICAgICAgb25CbHVyKHRoaXMpO1xuXG4gICAgZm9yICh2YXIgb3B0IGluIG9wdGlvbkhhbmRsZXJzKSBpZiAob3B0aW9uSGFuZGxlcnMuaGFzT3duUHJvcGVydHkob3B0KSlcbiAgICAgIG9wdGlvbkhhbmRsZXJzW29wdF0odGhpcywgb3B0aW9uc1tvcHRdLCBJbml0KTtcbiAgICBtYXliZVVwZGF0ZUxpbmVOdW1iZXJXaWR0aCh0aGlzKTtcbiAgICBpZiAob3B0aW9ucy5maW5pc2hJbml0KSBvcHRpb25zLmZpbmlzaEluaXQodGhpcyk7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBpbml0SG9va3MubGVuZ3RoOyArK2kpIGluaXRIb29rc1tpXSh0aGlzKTtcbiAgICBlbmRPcGVyYXRpb24odGhpcyk7XG4gICAgLy8gU3VwcHJlc3Mgb3B0aW1pemVsZWdpYmlsaXR5IGluIFdlYmtpdCwgc2luY2UgaXQgYnJlYWtzIHRleHRcbiAgICAvLyBtZWFzdXJpbmcgb24gbGluZSB3cmFwcGluZyBib3VuZGFyaWVzLlxuICAgIGlmICh3ZWJraXQgJiYgb3B0aW9ucy5saW5lV3JhcHBpbmcgJiZcbiAgICAgICAgZ2V0Q29tcHV0ZWRTdHlsZShkaXNwbGF5LmxpbmVEaXYpLnRleHRSZW5kZXJpbmcgPT0gXCJvcHRpbWl6ZWxlZ2liaWxpdHlcIilcbiAgICAgIGRpc3BsYXkubGluZURpdi5zdHlsZS50ZXh0UmVuZGVyaW5nID0gXCJhdXRvXCI7XG4gIH1cblxuICAvLyBESVNQTEFZIENPTlNUUlVDVE9SXG5cbiAgLy8gVGhlIGRpc3BsYXkgaGFuZGxlcyB0aGUgRE9NIGludGVncmF0aW9uLCBib3RoIGZvciBpbnB1dCByZWFkaW5nXG4gIC8vIGFuZCBjb250ZW50IGRyYXdpbmcuIEl0IGhvbGRzIHJlZmVyZW5jZXMgdG8gRE9NIG5vZGVzIGFuZFxuICAvLyBkaXNwbGF5LXJlbGF0ZWQgc3RhdGUuXG5cbiAgZnVuY3Rpb24gRGlzcGxheShwbGFjZSwgZG9jLCBpbnB1dCkge1xuICAgIHZhciBkID0gdGhpcztcbiAgICB0aGlzLmlucHV0ID0gaW5wdXQ7XG5cbiAgICAvLyBDb3ZlcnMgYm90dG9tLXJpZ2h0IHNxdWFyZSB3aGVuIGJvdGggc2Nyb2xsYmFycyBhcmUgcHJlc2VudC5cbiAgICBkLnNjcm9sbGJhckZpbGxlciA9IGVsdChcImRpdlwiLCBudWxsLCBcIkNvZGVNaXJyb3Itc2Nyb2xsYmFyLWZpbGxlclwiKTtcbiAgICBkLnNjcm9sbGJhckZpbGxlci5zZXRBdHRyaWJ1dGUoXCJjbS1ub3QtY29udGVudFwiLCBcInRydWVcIik7XG4gICAgLy8gQ292ZXJzIGJvdHRvbSBvZiBndXR0ZXIgd2hlbiBjb3Zlckd1dHRlck5leHRUb1Njcm9sbGJhciBpcyBvblxuICAgIC8vIGFuZCBoIHNjcm9sbGJhciBpcyBwcmVzZW50LlxuICAgIGQuZ3V0dGVyRmlsbGVyID0gZWx0KFwiZGl2XCIsIG51bGwsIFwiQ29kZU1pcnJvci1ndXR0ZXItZmlsbGVyXCIpO1xuICAgIGQuZ3V0dGVyRmlsbGVyLnNldEF0dHJpYnV0ZShcImNtLW5vdC1jb250ZW50XCIsIFwidHJ1ZVwiKTtcbiAgICAvLyBXaWxsIGNvbnRhaW4gdGhlIGFjdHVhbCBjb2RlLCBwb3NpdGlvbmVkIHRvIGNvdmVyIHRoZSB2aWV3cG9ydC5cbiAgICBkLmxpbmVEaXYgPSBlbHQoXCJkaXZcIiwgbnVsbCwgXCJDb2RlTWlycm9yLWNvZGVcIik7XG4gICAgLy8gRWxlbWVudHMgYXJlIGFkZGVkIHRvIHRoZXNlIHRvIHJlcHJlc2VudCBzZWxlY3Rpb24gYW5kIGN1cnNvcnMuXG4gICAgZC5zZWxlY3Rpb25EaXYgPSBlbHQoXCJkaXZcIiwgbnVsbCwgbnVsbCwgXCJwb3NpdGlvbjogcmVsYXRpdmU7IHotaW5kZXg6IDFcIik7XG4gICAgZC5jdXJzb3JEaXYgPSBlbHQoXCJkaXZcIiwgbnVsbCwgXCJDb2RlTWlycm9yLWN1cnNvcnNcIik7XG4gICAgLy8gQSB2aXNpYmlsaXR5OiBoaWRkZW4gZWxlbWVudCB1c2VkIHRvIGZpbmQgdGhlIHNpemUgb2YgdGhpbmdzLlxuICAgIGQubWVhc3VyZSA9IGVsdChcImRpdlwiLCBudWxsLCBcIkNvZGVNaXJyb3ItbWVhc3VyZVwiKTtcbiAgICAvLyBXaGVuIGxpbmVzIG91dHNpZGUgb2YgdGhlIHZpZXdwb3J0IGFyZSBtZWFzdXJlZCwgdGhleSBhcmUgZHJhd24gaW4gdGhpcy5cbiAgICBkLmxpbmVNZWFzdXJlID0gZWx0KFwiZGl2XCIsIG51bGwsIFwiQ29kZU1pcnJvci1tZWFzdXJlXCIpO1xuICAgIC8vIFdyYXBzIGV2ZXJ5dGhpbmcgdGhhdCBuZWVkcyB0byBleGlzdCBpbnNpZGUgdGhlIHZlcnRpY2FsbHktcGFkZGVkIGNvb3JkaW5hdGUgc3lzdGVtXG4gICAgZC5saW5lU3BhY2UgPSBlbHQoXCJkaXZcIiwgW2QubWVhc3VyZSwgZC5saW5lTWVhc3VyZSwgZC5zZWxlY3Rpb25EaXYsIGQuY3Vyc29yRGl2LCBkLmxpbmVEaXZdLFxuICAgICAgICAgICAgICAgICAgICAgIG51bGwsIFwicG9zaXRpb246IHJlbGF0aXZlOyBvdXRsaW5lOiBub25lXCIpO1xuICAgIC8vIE1vdmVkIGFyb3VuZCBpdHMgcGFyZW50IHRvIGNvdmVyIHZpc2libGUgdmlldy5cbiAgICBkLm1vdmVyID0gZWx0KFwiZGl2XCIsIFtlbHQoXCJkaXZcIiwgW2QubGluZVNwYWNlXSwgXCJDb2RlTWlycm9yLWxpbmVzXCIpXSwgbnVsbCwgXCJwb3NpdGlvbjogcmVsYXRpdmVcIik7XG4gICAgLy8gU2V0IHRvIHRoZSBoZWlnaHQgb2YgdGhlIGRvY3VtZW50LCBhbGxvd2luZyBzY3JvbGxpbmcuXG4gICAgZC5zaXplciA9IGVsdChcImRpdlwiLCBbZC5tb3Zlcl0sIFwiQ29kZU1pcnJvci1zaXplclwiKTtcbiAgICBkLnNpemVyV2lkdGggPSBudWxsO1xuICAgIC8vIEJlaGF2aW9yIG9mIGVsdHMgd2l0aCBvdmVyZmxvdzogYXV0byBhbmQgcGFkZGluZyBpc1xuICAgIC8vIGluY29uc2lzdGVudCBhY3Jvc3MgYnJvd3NlcnMuIFRoaXMgaXMgdXNlZCB0byBlbnN1cmUgdGhlXG4gICAgLy8gc2Nyb2xsYWJsZSBhcmVhIGlzIGJpZyBlbm91Z2guXG4gICAgZC5oZWlnaHRGb3JjZXIgPSBlbHQoXCJkaXZcIiwgbnVsbCwgbnVsbCwgXCJwb3NpdGlvbjogYWJzb2x1dGU7IGhlaWdodDogXCIgKyBzY3JvbGxlckdhcCArIFwicHg7IHdpZHRoOiAxcHg7XCIpO1xuICAgIC8vIFdpbGwgY29udGFpbiB0aGUgZ3V0dGVycywgaWYgYW55LlxuICAgIGQuZ3V0dGVycyA9IGVsdChcImRpdlwiLCBudWxsLCBcIkNvZGVNaXJyb3ItZ3V0dGVyc1wiKTtcbiAgICBkLmxpbmVHdXR0ZXIgPSBudWxsO1xuICAgIC8vIEFjdHVhbCBzY3JvbGxhYmxlIGVsZW1lbnQuXG4gICAgZC5zY3JvbGxlciA9IGVsdChcImRpdlwiLCBbZC5zaXplciwgZC5oZWlnaHRGb3JjZXIsIGQuZ3V0dGVyc10sIFwiQ29kZU1pcnJvci1zY3JvbGxcIik7XG4gICAgZC5zY3JvbGxlci5zZXRBdHRyaWJ1dGUoXCJ0YWJJbmRleFwiLCBcIi0xXCIpO1xuICAgIC8vIFRoZSBlbGVtZW50IGluIHdoaWNoIHRoZSBlZGl0b3IgbGl2ZXMuXG4gICAgZC53cmFwcGVyID0gZWx0KFwiZGl2XCIsIFtkLnNjcm9sbGJhckZpbGxlciwgZC5ndXR0ZXJGaWxsZXIsIGQuc2Nyb2xsZXJdLCBcIkNvZGVNaXJyb3JcIik7XG5cbiAgICAvLyBXb3JrIGFyb3VuZCBJRTcgei1pbmRleCBidWcgKG5vdCBwZXJmZWN0LCBoZW5jZSBJRTcgbm90IHJlYWxseSBiZWluZyBzdXBwb3J0ZWQpXG4gICAgaWYgKGllICYmIGllX3ZlcnNpb24gPCA4KSB7IGQuZ3V0dGVycy5zdHlsZS56SW5kZXggPSAtMTsgZC5zY3JvbGxlci5zdHlsZS5wYWRkaW5nUmlnaHQgPSAwOyB9XG4gICAgaWYgKCF3ZWJraXQgJiYgIShnZWNrbyAmJiBtb2JpbGUpKSBkLnNjcm9sbGVyLmRyYWdnYWJsZSA9IHRydWU7XG5cbiAgICBpZiAocGxhY2UpIHtcbiAgICAgIGlmIChwbGFjZS5hcHBlbmRDaGlsZCkgcGxhY2UuYXBwZW5kQ2hpbGQoZC53cmFwcGVyKTtcbiAgICAgIGVsc2UgcGxhY2UoZC53cmFwcGVyKTtcbiAgICB9XG5cbiAgICAvLyBDdXJyZW50IHJlbmRlcmVkIHJhbmdlIChtYXkgYmUgYmlnZ2VyIHRoYW4gdGhlIHZpZXcgd2luZG93KS5cbiAgICBkLnZpZXdGcm9tID0gZC52aWV3VG8gPSBkb2MuZmlyc3Q7XG4gICAgZC5yZXBvcnRlZFZpZXdGcm9tID0gZC5yZXBvcnRlZFZpZXdUbyA9IGRvYy5maXJzdDtcbiAgICAvLyBJbmZvcm1hdGlvbiBhYm91dCB0aGUgcmVuZGVyZWQgbGluZXMuXG4gICAgZC52aWV3ID0gW107XG4gICAgZC5yZW5kZXJlZFZpZXcgPSBudWxsO1xuICAgIC8vIEhvbGRzIGluZm8gYWJvdXQgYSBzaW5nbGUgcmVuZGVyZWQgbGluZSB3aGVuIGl0IHdhcyByZW5kZXJlZFxuICAgIC8vIGZvciBtZWFzdXJlbWVudCwgd2hpbGUgbm90IGluIHZpZXcuXG4gICAgZC5leHRlcm5hbE1lYXN1cmVkID0gbnVsbDtcbiAgICAvLyBFbXB0eSBzcGFjZSAoaW4gcGl4ZWxzKSBhYm92ZSB0aGUgdmlld1xuICAgIGQudmlld09mZnNldCA9IDA7XG4gICAgZC5sYXN0V3JhcEhlaWdodCA9IGQubGFzdFdyYXBXaWR0aCA9IDA7XG4gICAgZC51cGRhdGVMaW5lTnVtYmVycyA9IG51bGw7XG5cbiAgICBkLm5hdGl2ZUJhcldpZHRoID0gZC5iYXJIZWlnaHQgPSBkLmJhcldpZHRoID0gMDtcbiAgICBkLnNjcm9sbGJhcnNDbGlwcGVkID0gZmFsc2U7XG5cbiAgICAvLyBVc2VkIHRvIG9ubHkgcmVzaXplIHRoZSBsaW5lIG51bWJlciBndXR0ZXIgd2hlbiBuZWNlc3NhcnkgKHdoZW5cbiAgICAvLyB0aGUgYW1vdW50IG9mIGxpbmVzIGNyb3NzZXMgYSBib3VuZGFyeSB0aGF0IG1ha2VzIGl0cyB3aWR0aCBjaGFuZ2UpXG4gICAgZC5saW5lTnVtV2lkdGggPSBkLmxpbmVOdW1Jbm5lcldpZHRoID0gZC5saW5lTnVtQ2hhcnMgPSBudWxsO1xuICAgIC8vIFNldCB0byB0cnVlIHdoZW4gYSBub24taG9yaXpvbnRhbC1zY3JvbGxpbmcgbGluZSB3aWRnZXQgaXNcbiAgICAvLyBhZGRlZC4gQXMgYW4gb3B0aW1pemF0aW9uLCBsaW5lIHdpZGdldCBhbGlnbmluZyBpcyBza2lwcGVkIHdoZW5cbiAgICAvLyB0aGlzIGlzIGZhbHNlLlxuICAgIGQuYWxpZ25XaWRnZXRzID0gZmFsc2U7XG5cbiAgICBkLmNhY2hlZENoYXJXaWR0aCA9IGQuY2FjaGVkVGV4dEhlaWdodCA9IGQuY2FjaGVkUGFkZGluZ0ggPSBudWxsO1xuXG4gICAgLy8gVHJhY2tzIHRoZSBtYXhpbXVtIGxpbmUgbGVuZ3RoIHNvIHRoYXQgdGhlIGhvcml6b250YWwgc2Nyb2xsYmFyXG4gICAgLy8gY2FuIGJlIGtlcHQgc3RhdGljIHdoZW4gc2Nyb2xsaW5nLlxuICAgIGQubWF4TGluZSA9IG51bGw7XG4gICAgZC5tYXhMaW5lTGVuZ3RoID0gMDtcbiAgICBkLm1heExpbmVDaGFuZ2VkID0gZmFsc2U7XG5cbiAgICAvLyBVc2VkIGZvciBtZWFzdXJpbmcgd2hlZWwgc2Nyb2xsaW5nIGdyYW51bGFyaXR5XG4gICAgZC53aGVlbERYID0gZC53aGVlbERZID0gZC53aGVlbFN0YXJ0WCA9IGQud2hlZWxTdGFydFkgPSBudWxsO1xuXG4gICAgLy8gVHJ1ZSB3aGVuIHNoaWZ0IGlzIGhlbGQgZG93bi5cbiAgICBkLnNoaWZ0ID0gZmFsc2U7XG5cbiAgICAvLyBVc2VkIHRvIHRyYWNrIHdoZXRoZXIgYW55dGhpbmcgaGFwcGVuZWQgc2luY2UgdGhlIGNvbnRleHQgbWVudVxuICAgIC8vIHdhcyBvcGVuZWQuXG4gICAgZC5zZWxGb3JDb250ZXh0TWVudSA9IG51bGw7XG5cbiAgICBkLmFjdGl2ZVRvdWNoID0gbnVsbDtcblxuICAgIGlucHV0LmluaXQoZCk7XG4gIH1cblxuICAvLyBTVEFURSBVUERBVEVTXG5cbiAgLy8gVXNlZCB0byBnZXQgdGhlIGVkaXRvciBpbnRvIGEgY29uc2lzdGVudCBzdGF0ZSBhZ2FpbiB3aGVuIG9wdGlvbnMgY2hhbmdlLlxuXG4gIGZ1bmN0aW9uIGxvYWRNb2RlKGNtKSB7XG4gICAgY20uZG9jLm1vZGUgPSBDb2RlTWlycm9yLmdldE1vZGUoY20ub3B0aW9ucywgY20uZG9jLm1vZGVPcHRpb24pO1xuICAgIHJlc2V0TW9kZVN0YXRlKGNtKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHJlc2V0TW9kZVN0YXRlKGNtKSB7XG4gICAgY20uZG9jLml0ZXIoZnVuY3Rpb24obGluZSkge1xuICAgICAgaWYgKGxpbmUuc3RhdGVBZnRlcikgbGluZS5zdGF0ZUFmdGVyID0gbnVsbDtcbiAgICAgIGlmIChsaW5lLnN0eWxlcykgbGluZS5zdHlsZXMgPSBudWxsO1xuICAgIH0pO1xuICAgIGNtLmRvYy5mcm9udGllciA9IGNtLmRvYy5maXJzdDtcbiAgICBzdGFydFdvcmtlcihjbSwgMTAwKTtcbiAgICBjbS5zdGF0ZS5tb2RlR2VuKys7XG4gICAgaWYgKGNtLmN1ck9wKSByZWdDaGFuZ2UoY20pO1xuICB9XG5cbiAgZnVuY3Rpb24gd3JhcHBpbmdDaGFuZ2VkKGNtKSB7XG4gICAgaWYgKGNtLm9wdGlvbnMubGluZVdyYXBwaW5nKSB7XG4gICAgICBhZGRDbGFzcyhjbS5kaXNwbGF5LndyYXBwZXIsIFwiQ29kZU1pcnJvci13cmFwXCIpO1xuICAgICAgY20uZGlzcGxheS5zaXplci5zdHlsZS5taW5XaWR0aCA9IFwiXCI7XG4gICAgICBjbS5kaXNwbGF5LnNpemVyV2lkdGggPSBudWxsO1xuICAgIH0gZWxzZSB7XG4gICAgICBybUNsYXNzKGNtLmRpc3BsYXkud3JhcHBlciwgXCJDb2RlTWlycm9yLXdyYXBcIik7XG4gICAgICBmaW5kTWF4TGluZShjbSk7XG4gICAgfVxuICAgIGVzdGltYXRlTGluZUhlaWdodHMoY20pO1xuICAgIHJlZ0NoYW5nZShjbSk7XG4gICAgY2xlYXJDYWNoZXMoY20pO1xuICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKXt1cGRhdGVTY3JvbGxiYXJzKGNtKTt9LCAxMDApO1xuICB9XG5cbiAgLy8gUmV0dXJucyBhIGZ1bmN0aW9uIHRoYXQgZXN0aW1hdGVzIHRoZSBoZWlnaHQgb2YgYSBsaW5lLCB0byB1c2UgYXNcbiAgLy8gZmlyc3QgYXBwcm94aW1hdGlvbiB1bnRpbCB0aGUgbGluZSBiZWNvbWVzIHZpc2libGUgKGFuZCBpcyB0aHVzXG4gIC8vIHByb3Blcmx5IG1lYXN1cmFibGUpLlxuICBmdW5jdGlvbiBlc3RpbWF0ZUhlaWdodChjbSkge1xuICAgIHZhciB0aCA9IHRleHRIZWlnaHQoY20uZGlzcGxheSksIHdyYXBwaW5nID0gY20ub3B0aW9ucy5saW5lV3JhcHBpbmc7XG4gICAgdmFyIHBlckxpbmUgPSB3cmFwcGluZyAmJiBNYXRoLm1heCg1LCBjbS5kaXNwbGF5LnNjcm9sbGVyLmNsaWVudFdpZHRoIC8gY2hhcldpZHRoKGNtLmRpc3BsYXkpIC0gMyk7XG4gICAgcmV0dXJuIGZ1bmN0aW9uKGxpbmUpIHtcbiAgICAgIGlmIChsaW5lSXNIaWRkZW4oY20uZG9jLCBsaW5lKSkgcmV0dXJuIDA7XG5cbiAgICAgIHZhciB3aWRnZXRzSGVpZ2h0ID0gMDtcbiAgICAgIGlmIChsaW5lLndpZGdldHMpIGZvciAodmFyIGkgPSAwOyBpIDwgbGluZS53aWRnZXRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGlmIChsaW5lLndpZGdldHNbaV0uaGVpZ2h0KSB3aWRnZXRzSGVpZ2h0ICs9IGxpbmUud2lkZ2V0c1tpXS5oZWlnaHQ7XG4gICAgICB9XG5cbiAgICAgIGlmICh3cmFwcGluZylcbiAgICAgICAgcmV0dXJuIHdpZGdldHNIZWlnaHQgKyAoTWF0aC5jZWlsKGxpbmUudGV4dC5sZW5ndGggLyBwZXJMaW5lKSB8fCAxKSAqIHRoO1xuICAgICAgZWxzZVxuICAgICAgICByZXR1cm4gd2lkZ2V0c0hlaWdodCArIHRoO1xuICAgIH07XG4gIH1cblxuICBmdW5jdGlvbiBlc3RpbWF0ZUxpbmVIZWlnaHRzKGNtKSB7XG4gICAgdmFyIGRvYyA9IGNtLmRvYywgZXN0ID0gZXN0aW1hdGVIZWlnaHQoY20pO1xuICAgIGRvYy5pdGVyKGZ1bmN0aW9uKGxpbmUpIHtcbiAgICAgIHZhciBlc3RIZWlnaHQgPSBlc3QobGluZSk7XG4gICAgICBpZiAoZXN0SGVpZ2h0ICE9IGxpbmUuaGVpZ2h0KSB1cGRhdGVMaW5lSGVpZ2h0KGxpbmUsIGVzdEhlaWdodCk7XG4gICAgfSk7XG4gIH1cblxuICBmdW5jdGlvbiB0aGVtZUNoYW5nZWQoY20pIHtcbiAgICBjbS5kaXNwbGF5LndyYXBwZXIuY2xhc3NOYW1lID0gY20uZGlzcGxheS53cmFwcGVyLmNsYXNzTmFtZS5yZXBsYWNlKC9cXHMqY20tcy1cXFMrL2csIFwiXCIpICtcbiAgICAgIGNtLm9wdGlvbnMudGhlbWUucmVwbGFjZSgvKF58XFxzKVxccyovZywgXCIgY20tcy1cIik7XG4gICAgY2xlYXJDYWNoZXMoY20pO1xuICB9XG5cbiAgZnVuY3Rpb24gZ3V0dGVyc0NoYW5nZWQoY20pIHtcbiAgICB1cGRhdGVHdXR0ZXJzKGNtKTtcbiAgICByZWdDaGFuZ2UoY20pO1xuICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKXthbGlnbkhvcml6b250YWxseShjbSk7fSwgMjApO1xuICB9XG5cbiAgLy8gUmVidWlsZCB0aGUgZ3V0dGVyIGVsZW1lbnRzLCBlbnN1cmUgdGhlIG1hcmdpbiB0byB0aGUgbGVmdCBvZiB0aGVcbiAgLy8gY29kZSBtYXRjaGVzIHRoZWlyIHdpZHRoLlxuICBmdW5jdGlvbiB1cGRhdGVHdXR0ZXJzKGNtKSB7XG4gICAgdmFyIGd1dHRlcnMgPSBjbS5kaXNwbGF5Lmd1dHRlcnMsIHNwZWNzID0gY20ub3B0aW9ucy5ndXR0ZXJzO1xuICAgIHJlbW92ZUNoaWxkcmVuKGd1dHRlcnMpO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc3BlY3MubGVuZ3RoOyArK2kpIHtcbiAgICAgIHZhciBndXR0ZXJDbGFzcyA9IHNwZWNzW2ldO1xuICAgICAgdmFyIGdFbHQgPSBndXR0ZXJzLmFwcGVuZENoaWxkKGVsdChcImRpdlwiLCBudWxsLCBcIkNvZGVNaXJyb3ItZ3V0dGVyIFwiICsgZ3V0dGVyQ2xhc3MpKTtcbiAgICAgIGlmIChndXR0ZXJDbGFzcyA9PSBcIkNvZGVNaXJyb3ItbGluZW51bWJlcnNcIikge1xuICAgICAgICBjbS5kaXNwbGF5LmxpbmVHdXR0ZXIgPSBnRWx0O1xuICAgICAgICBnRWx0LnN0eWxlLndpZHRoID0gKGNtLmRpc3BsYXkubGluZU51bVdpZHRoIHx8IDEpICsgXCJweFwiO1xuICAgICAgfVxuICAgIH1cbiAgICBndXR0ZXJzLnN0eWxlLmRpc3BsYXkgPSBpID8gXCJcIiA6IFwibm9uZVwiO1xuICAgIHVwZGF0ZUd1dHRlclNwYWNlKGNtKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHVwZGF0ZUd1dHRlclNwYWNlKGNtKSB7XG4gICAgdmFyIHdpZHRoID0gY20uZGlzcGxheS5ndXR0ZXJzLm9mZnNldFdpZHRoO1xuICAgIGNtLmRpc3BsYXkuc2l6ZXIuc3R5bGUubWFyZ2luTGVmdCA9IHdpZHRoICsgXCJweFwiO1xuICB9XG5cbiAgLy8gQ29tcHV0ZSB0aGUgY2hhcmFjdGVyIGxlbmd0aCBvZiBhIGxpbmUsIHRha2luZyBpbnRvIGFjY291bnRcbiAgLy8gY29sbGFwc2VkIHJhbmdlcyAoc2VlIG1hcmtUZXh0KSB0aGF0IG1pZ2h0IGhpZGUgcGFydHMsIGFuZCBqb2luXG4gIC8vIG90aGVyIGxpbmVzIG9udG8gaXQuXG4gIGZ1bmN0aW9uIGxpbmVMZW5ndGgobGluZSkge1xuICAgIGlmIChsaW5lLmhlaWdodCA9PSAwKSByZXR1cm4gMDtcbiAgICB2YXIgbGVuID0gbGluZS50ZXh0Lmxlbmd0aCwgbWVyZ2VkLCBjdXIgPSBsaW5lO1xuICAgIHdoaWxlIChtZXJnZWQgPSBjb2xsYXBzZWRTcGFuQXRTdGFydChjdXIpKSB7XG4gICAgICB2YXIgZm91bmQgPSBtZXJnZWQuZmluZCgwLCB0cnVlKTtcbiAgICAgIGN1ciA9IGZvdW5kLmZyb20ubGluZTtcbiAgICAgIGxlbiArPSBmb3VuZC5mcm9tLmNoIC0gZm91bmQudG8uY2g7XG4gICAgfVxuICAgIGN1ciA9IGxpbmU7XG4gICAgd2hpbGUgKG1lcmdlZCA9IGNvbGxhcHNlZFNwYW5BdEVuZChjdXIpKSB7XG4gICAgICB2YXIgZm91bmQgPSBtZXJnZWQuZmluZCgwLCB0cnVlKTtcbiAgICAgIGxlbiAtPSBjdXIudGV4dC5sZW5ndGggLSBmb3VuZC5mcm9tLmNoO1xuICAgICAgY3VyID0gZm91bmQudG8ubGluZTtcbiAgICAgIGxlbiArPSBjdXIudGV4dC5sZW5ndGggLSBmb3VuZC50by5jaDtcbiAgICB9XG4gICAgcmV0dXJuIGxlbjtcbiAgfVxuXG4gIC8vIEZpbmQgdGhlIGxvbmdlc3QgbGluZSBpbiB0aGUgZG9jdW1lbnQuXG4gIGZ1bmN0aW9uIGZpbmRNYXhMaW5lKGNtKSB7XG4gICAgdmFyIGQgPSBjbS5kaXNwbGF5LCBkb2MgPSBjbS5kb2M7XG4gICAgZC5tYXhMaW5lID0gZ2V0TGluZShkb2MsIGRvYy5maXJzdCk7XG4gICAgZC5tYXhMaW5lTGVuZ3RoID0gbGluZUxlbmd0aChkLm1heExpbmUpO1xuICAgIGQubWF4TGluZUNoYW5nZWQgPSB0cnVlO1xuICAgIGRvYy5pdGVyKGZ1bmN0aW9uKGxpbmUpIHtcbiAgICAgIHZhciBsZW4gPSBsaW5lTGVuZ3RoKGxpbmUpO1xuICAgICAgaWYgKGxlbiA+IGQubWF4TGluZUxlbmd0aCkge1xuICAgICAgICBkLm1heExpbmVMZW5ndGggPSBsZW47XG4gICAgICAgIGQubWF4TGluZSA9IGxpbmU7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICAvLyBNYWtlIHN1cmUgdGhlIGd1dHRlcnMgb3B0aW9ucyBjb250YWlucyB0aGUgZWxlbWVudFxuICAvLyBcIkNvZGVNaXJyb3ItbGluZW51bWJlcnNcIiB3aGVuIHRoZSBsaW5lTnVtYmVycyBvcHRpb24gaXMgdHJ1ZS5cbiAgZnVuY3Rpb24gc2V0R3V0dGVyc0ZvckxpbmVOdW1iZXJzKG9wdGlvbnMpIHtcbiAgICB2YXIgZm91bmQgPSBpbmRleE9mKG9wdGlvbnMuZ3V0dGVycywgXCJDb2RlTWlycm9yLWxpbmVudW1iZXJzXCIpO1xuICAgIGlmIChmb3VuZCA9PSAtMSAmJiBvcHRpb25zLmxpbmVOdW1iZXJzKSB7XG4gICAgICBvcHRpb25zLmd1dHRlcnMgPSBvcHRpb25zLmd1dHRlcnMuY29uY2F0KFtcIkNvZGVNaXJyb3ItbGluZW51bWJlcnNcIl0pO1xuICAgIH0gZWxzZSBpZiAoZm91bmQgPiAtMSAmJiAhb3B0aW9ucy5saW5lTnVtYmVycykge1xuICAgICAgb3B0aW9ucy5ndXR0ZXJzID0gb3B0aW9ucy5ndXR0ZXJzLnNsaWNlKDApO1xuICAgICAgb3B0aW9ucy5ndXR0ZXJzLnNwbGljZShmb3VuZCwgMSk7XG4gICAgfVxuICB9XG5cbiAgLy8gU0NST0xMQkFSU1xuXG4gIC8vIFByZXBhcmUgRE9NIHJlYWRzIG5lZWRlZCB0byB1cGRhdGUgdGhlIHNjcm9sbGJhcnMuIERvbmUgaW4gb25lXG4gIC8vIHNob3QgdG8gbWluaW1pemUgdXBkYXRlL21lYXN1cmUgcm91bmR0cmlwcy5cbiAgZnVuY3Rpb24gbWVhc3VyZUZvclNjcm9sbGJhcnMoY20pIHtcbiAgICB2YXIgZCA9IGNtLmRpc3BsYXksIGd1dHRlclcgPSBkLmd1dHRlcnMub2Zmc2V0V2lkdGg7XG4gICAgdmFyIGRvY0ggPSBNYXRoLnJvdW5kKGNtLmRvYy5oZWlnaHQgKyBwYWRkaW5nVmVydChjbS5kaXNwbGF5KSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIGNsaWVudEhlaWdodDogZC5zY3JvbGxlci5jbGllbnRIZWlnaHQsXG4gICAgICB2aWV3SGVpZ2h0OiBkLndyYXBwZXIuY2xpZW50SGVpZ2h0LFxuICAgICAgc2Nyb2xsV2lkdGg6IGQuc2Nyb2xsZXIuc2Nyb2xsV2lkdGgsIGNsaWVudFdpZHRoOiBkLnNjcm9sbGVyLmNsaWVudFdpZHRoLFxuICAgICAgdmlld1dpZHRoOiBkLndyYXBwZXIuY2xpZW50V2lkdGgsXG4gICAgICBiYXJMZWZ0OiBjbS5vcHRpb25zLmZpeGVkR3V0dGVyID8gZ3V0dGVyVyA6IDAsXG4gICAgICBkb2NIZWlnaHQ6IGRvY0gsXG4gICAgICBzY3JvbGxIZWlnaHQ6IGRvY0ggKyBzY3JvbGxHYXAoY20pICsgZC5iYXJIZWlnaHQsXG4gICAgICBuYXRpdmVCYXJXaWR0aDogZC5uYXRpdmVCYXJXaWR0aCxcbiAgICAgIGd1dHRlcldpZHRoOiBndXR0ZXJXXG4gICAgfTtcbiAgfVxuXG4gIGZ1bmN0aW9uIE5hdGl2ZVNjcm9sbGJhcnMocGxhY2UsIHNjcm9sbCwgY20pIHtcbiAgICB0aGlzLmNtID0gY207XG4gICAgdmFyIHZlcnQgPSB0aGlzLnZlcnQgPSBlbHQoXCJkaXZcIiwgW2VsdChcImRpdlwiLCBudWxsLCBudWxsLCBcIm1pbi13aWR0aDogMXB4XCIpXSwgXCJDb2RlTWlycm9yLXZzY3JvbGxiYXJcIik7XG4gICAgdmFyIGhvcml6ID0gdGhpcy5ob3JpeiA9IGVsdChcImRpdlwiLCBbZWx0KFwiZGl2XCIsIG51bGwsIG51bGwsIFwiaGVpZ2h0OiAxMDAlOyBtaW4taGVpZ2h0OiAxcHhcIildLCBcIkNvZGVNaXJyb3ItaHNjcm9sbGJhclwiKTtcbiAgICBwbGFjZSh2ZXJ0KTsgcGxhY2UoaG9yaXopO1xuXG4gICAgb24odmVydCwgXCJzY3JvbGxcIiwgZnVuY3Rpb24oKSB7XG4gICAgICBpZiAodmVydC5jbGllbnRIZWlnaHQpIHNjcm9sbCh2ZXJ0LnNjcm9sbFRvcCwgXCJ2ZXJ0aWNhbFwiKTtcbiAgICB9KTtcbiAgICBvbihob3JpeiwgXCJzY3JvbGxcIiwgZnVuY3Rpb24oKSB7XG4gICAgICBpZiAoaG9yaXouY2xpZW50V2lkdGgpIHNjcm9sbChob3Jpei5zY3JvbGxMZWZ0LCBcImhvcml6b250YWxcIik7XG4gICAgfSk7XG5cbiAgICB0aGlzLmNoZWNrZWRPdmVybGF5ID0gZmFsc2U7XG4gICAgLy8gTmVlZCB0byBzZXQgYSBtaW5pbXVtIHdpZHRoIHRvIHNlZSB0aGUgc2Nyb2xsYmFyIG9uIElFNyAoYnV0IG11c3Qgbm90IHNldCBpdCBvbiBJRTgpLlxuICAgIGlmIChpZSAmJiBpZV92ZXJzaW9uIDwgOCkgdGhpcy5ob3Jpei5zdHlsZS5taW5IZWlnaHQgPSB0aGlzLnZlcnQuc3R5bGUubWluV2lkdGggPSBcIjE4cHhcIjtcbiAgfVxuXG4gIE5hdGl2ZVNjcm9sbGJhcnMucHJvdG90eXBlID0gY29weU9iaih7XG4gICAgdXBkYXRlOiBmdW5jdGlvbihtZWFzdXJlKSB7XG4gICAgICB2YXIgbmVlZHNIID0gbWVhc3VyZS5zY3JvbGxXaWR0aCA+IG1lYXN1cmUuY2xpZW50V2lkdGggKyAxO1xuICAgICAgdmFyIG5lZWRzViA9IG1lYXN1cmUuc2Nyb2xsSGVpZ2h0ID4gbWVhc3VyZS5jbGllbnRIZWlnaHQgKyAxO1xuICAgICAgdmFyIHNXaWR0aCA9IG1lYXN1cmUubmF0aXZlQmFyV2lkdGg7XG5cbiAgICAgIGlmIChuZWVkc1YpIHtcbiAgICAgICAgdGhpcy52ZXJ0LnN0eWxlLmRpc3BsYXkgPSBcImJsb2NrXCI7XG4gICAgICAgIHRoaXMudmVydC5zdHlsZS5ib3R0b20gPSBuZWVkc0ggPyBzV2lkdGggKyBcInB4XCIgOiBcIjBcIjtcbiAgICAgICAgdmFyIHRvdGFsSGVpZ2h0ID0gbWVhc3VyZS52aWV3SGVpZ2h0IC0gKG5lZWRzSCA/IHNXaWR0aCA6IDApO1xuICAgICAgICAvLyBBIGJ1ZyBpbiBJRTggY2FuIGNhdXNlIHRoaXMgdmFsdWUgdG8gYmUgbmVnYXRpdmUsIHNvIGd1YXJkIGl0LlxuICAgICAgICB0aGlzLnZlcnQuZmlyc3RDaGlsZC5zdHlsZS5oZWlnaHQgPVxuICAgICAgICAgIE1hdGgubWF4KDAsIG1lYXN1cmUuc2Nyb2xsSGVpZ2h0IC0gbWVhc3VyZS5jbGllbnRIZWlnaHQgKyB0b3RhbEhlaWdodCkgKyBcInB4XCI7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnZlcnQuc3R5bGUuZGlzcGxheSA9IFwiXCI7XG4gICAgICAgIHRoaXMudmVydC5maXJzdENoaWxkLnN0eWxlLmhlaWdodCA9IFwiMFwiO1xuICAgICAgfVxuXG4gICAgICBpZiAobmVlZHNIKSB7XG4gICAgICAgIHRoaXMuaG9yaXouc3R5bGUuZGlzcGxheSA9IFwiYmxvY2tcIjtcbiAgICAgICAgdGhpcy5ob3Jpei5zdHlsZS5yaWdodCA9IG5lZWRzViA/IHNXaWR0aCArIFwicHhcIiA6IFwiMFwiO1xuICAgICAgICB0aGlzLmhvcml6LnN0eWxlLmxlZnQgPSBtZWFzdXJlLmJhckxlZnQgKyBcInB4XCI7XG4gICAgICAgIHZhciB0b3RhbFdpZHRoID0gbWVhc3VyZS52aWV3V2lkdGggLSBtZWFzdXJlLmJhckxlZnQgLSAobmVlZHNWID8gc1dpZHRoIDogMCk7XG4gICAgICAgIHRoaXMuaG9yaXouZmlyc3RDaGlsZC5zdHlsZS53aWR0aCA9XG4gICAgICAgICAgKG1lYXN1cmUuc2Nyb2xsV2lkdGggLSBtZWFzdXJlLmNsaWVudFdpZHRoICsgdG90YWxXaWR0aCkgKyBcInB4XCI7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLmhvcml6LnN0eWxlLmRpc3BsYXkgPSBcIlwiO1xuICAgICAgICB0aGlzLmhvcml6LmZpcnN0Q2hpbGQuc3R5bGUud2lkdGggPSBcIjBcIjtcbiAgICAgIH1cblxuICAgICAgaWYgKCF0aGlzLmNoZWNrZWRPdmVybGF5ICYmIG1lYXN1cmUuY2xpZW50SGVpZ2h0ID4gMCkge1xuICAgICAgICBpZiAoc1dpZHRoID09IDApIHRoaXMub3ZlcmxheUhhY2soKTtcbiAgICAgICAgdGhpcy5jaGVja2VkT3ZlcmxheSA9IHRydWU7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7cmlnaHQ6IG5lZWRzViA/IHNXaWR0aCA6IDAsIGJvdHRvbTogbmVlZHNIID8gc1dpZHRoIDogMH07XG4gICAgfSxcbiAgICBzZXRTY3JvbGxMZWZ0OiBmdW5jdGlvbihwb3MpIHtcbiAgICAgIGlmICh0aGlzLmhvcml6LnNjcm9sbExlZnQgIT0gcG9zKSB0aGlzLmhvcml6LnNjcm9sbExlZnQgPSBwb3M7XG4gICAgfSxcbiAgICBzZXRTY3JvbGxUb3A6IGZ1bmN0aW9uKHBvcykge1xuICAgICAgaWYgKHRoaXMudmVydC5zY3JvbGxUb3AgIT0gcG9zKSB0aGlzLnZlcnQuc2Nyb2xsVG9wID0gcG9zO1xuICAgIH0sXG4gICAgb3ZlcmxheUhhY2s6IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIHcgPSBtYWMgJiYgIW1hY19nZU1vdW50YWluTGlvbiA/IFwiMTJweFwiIDogXCIxOHB4XCI7XG4gICAgICB0aGlzLmhvcml6LnN0eWxlLm1pbkhlaWdodCA9IHRoaXMudmVydC5zdHlsZS5taW5XaWR0aCA9IHc7XG4gICAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgICB2YXIgYmFyTW91c2VEb3duID0gZnVuY3Rpb24oZSkge1xuICAgICAgICBpZiAoZV90YXJnZXQoZSkgIT0gc2VsZi52ZXJ0ICYmIGVfdGFyZ2V0KGUpICE9IHNlbGYuaG9yaXopXG4gICAgICAgICAgb3BlcmF0aW9uKHNlbGYuY20sIG9uTW91c2VEb3duKShlKTtcbiAgICAgIH07XG4gICAgICBvbih0aGlzLnZlcnQsIFwibW91c2Vkb3duXCIsIGJhck1vdXNlRG93bik7XG4gICAgICBvbih0aGlzLmhvcml6LCBcIm1vdXNlZG93blwiLCBiYXJNb3VzZURvd24pO1xuICAgIH0sXG4gICAgY2xlYXI6IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIHBhcmVudCA9IHRoaXMuaG9yaXoucGFyZW50Tm9kZTtcbiAgICAgIHBhcmVudC5yZW1vdmVDaGlsZCh0aGlzLmhvcml6KTtcbiAgICAgIHBhcmVudC5yZW1vdmVDaGlsZCh0aGlzLnZlcnQpO1xuICAgIH1cbiAgfSwgTmF0aXZlU2Nyb2xsYmFycy5wcm90b3R5cGUpO1xuXG4gIGZ1bmN0aW9uIE51bGxTY3JvbGxiYXJzKCkge31cblxuICBOdWxsU2Nyb2xsYmFycy5wcm90b3R5cGUgPSBjb3B5T2JqKHtcbiAgICB1cGRhdGU6IGZ1bmN0aW9uKCkgeyByZXR1cm4ge2JvdHRvbTogMCwgcmlnaHQ6IDB9OyB9LFxuICAgIHNldFNjcm9sbExlZnQ6IGZ1bmN0aW9uKCkge30sXG4gICAgc2V0U2Nyb2xsVG9wOiBmdW5jdGlvbigpIHt9LFxuICAgIGNsZWFyOiBmdW5jdGlvbigpIHt9XG4gIH0sIE51bGxTY3JvbGxiYXJzLnByb3RvdHlwZSk7XG5cbiAgQ29kZU1pcnJvci5zY3JvbGxiYXJNb2RlbCA9IHtcIm5hdGl2ZVwiOiBOYXRpdmVTY3JvbGxiYXJzLCBcIm51bGxcIjogTnVsbFNjcm9sbGJhcnN9O1xuXG4gIGZ1bmN0aW9uIGluaXRTY3JvbGxiYXJzKGNtKSB7XG4gICAgaWYgKGNtLmRpc3BsYXkuc2Nyb2xsYmFycykge1xuICAgICAgY20uZGlzcGxheS5zY3JvbGxiYXJzLmNsZWFyKCk7XG4gICAgICBpZiAoY20uZGlzcGxheS5zY3JvbGxiYXJzLmFkZENsYXNzKVxuICAgICAgICBybUNsYXNzKGNtLmRpc3BsYXkud3JhcHBlciwgY20uZGlzcGxheS5zY3JvbGxiYXJzLmFkZENsYXNzKTtcbiAgICB9XG5cbiAgICBjbS5kaXNwbGF5LnNjcm9sbGJhcnMgPSBuZXcgQ29kZU1pcnJvci5zY3JvbGxiYXJNb2RlbFtjbS5vcHRpb25zLnNjcm9sbGJhclN0eWxlXShmdW5jdGlvbihub2RlKSB7XG4gICAgICBjbS5kaXNwbGF5LndyYXBwZXIuaW5zZXJ0QmVmb3JlKG5vZGUsIGNtLmRpc3BsYXkuc2Nyb2xsYmFyRmlsbGVyKTtcbiAgICAgIC8vIFByZXZlbnQgY2xpY2tzIGluIHRoZSBzY3JvbGxiYXJzIGZyb20ga2lsbGluZyBmb2N1c1xuICAgICAgb24obm9kZSwgXCJtb3VzZWRvd25cIiwgZnVuY3Rpb24oKSB7XG4gICAgICAgIGlmIChjbS5zdGF0ZS5mb2N1c2VkKSBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkgeyBjbS5kaXNwbGF5LmlucHV0LmZvY3VzKCk7IH0sIDApO1xuICAgICAgfSk7XG4gICAgICBub2RlLnNldEF0dHJpYnV0ZShcImNtLW5vdC1jb250ZW50XCIsIFwidHJ1ZVwiKTtcbiAgICB9LCBmdW5jdGlvbihwb3MsIGF4aXMpIHtcbiAgICAgIGlmIChheGlzID09IFwiaG9yaXpvbnRhbFwiKSBzZXRTY3JvbGxMZWZ0KGNtLCBwb3MpO1xuICAgICAgZWxzZSBzZXRTY3JvbGxUb3AoY20sIHBvcyk7XG4gICAgfSwgY20pO1xuICAgIGlmIChjbS5kaXNwbGF5LnNjcm9sbGJhcnMuYWRkQ2xhc3MpXG4gICAgICBhZGRDbGFzcyhjbS5kaXNwbGF5LndyYXBwZXIsIGNtLmRpc3BsYXkuc2Nyb2xsYmFycy5hZGRDbGFzcyk7XG4gIH1cblxuICBmdW5jdGlvbiB1cGRhdGVTY3JvbGxiYXJzKGNtLCBtZWFzdXJlKSB7XG4gICAgaWYgKCFtZWFzdXJlKSBtZWFzdXJlID0gbWVhc3VyZUZvclNjcm9sbGJhcnMoY20pO1xuICAgIHZhciBzdGFydFdpZHRoID0gY20uZGlzcGxheS5iYXJXaWR0aCwgc3RhcnRIZWlnaHQgPSBjbS5kaXNwbGF5LmJhckhlaWdodDtcbiAgICB1cGRhdGVTY3JvbGxiYXJzSW5uZXIoY20sIG1lYXN1cmUpO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgNCAmJiBzdGFydFdpZHRoICE9IGNtLmRpc3BsYXkuYmFyV2lkdGggfHwgc3RhcnRIZWlnaHQgIT0gY20uZGlzcGxheS5iYXJIZWlnaHQ7IGkrKykge1xuICAgICAgaWYgKHN0YXJ0V2lkdGggIT0gY20uZGlzcGxheS5iYXJXaWR0aCAmJiBjbS5vcHRpb25zLmxpbmVXcmFwcGluZylcbiAgICAgICAgdXBkYXRlSGVpZ2h0c0luVmlld3BvcnQoY20pO1xuICAgICAgdXBkYXRlU2Nyb2xsYmFyc0lubmVyKGNtLCBtZWFzdXJlRm9yU2Nyb2xsYmFycyhjbSkpO1xuICAgICAgc3RhcnRXaWR0aCA9IGNtLmRpc3BsYXkuYmFyV2lkdGg7IHN0YXJ0SGVpZ2h0ID0gY20uZGlzcGxheS5iYXJIZWlnaHQ7XG4gICAgfVxuICB9XG5cbiAgLy8gUmUtc3luY2hyb25pemUgdGhlIGZha2Ugc2Nyb2xsYmFycyB3aXRoIHRoZSBhY3R1YWwgc2l6ZSBvZiB0aGVcbiAgLy8gY29udGVudC5cbiAgZnVuY3Rpb24gdXBkYXRlU2Nyb2xsYmFyc0lubmVyKGNtLCBtZWFzdXJlKSB7XG4gICAgdmFyIGQgPSBjbS5kaXNwbGF5O1xuICAgIHZhciBzaXplcyA9IGQuc2Nyb2xsYmFycy51cGRhdGUobWVhc3VyZSk7XG5cbiAgICBkLnNpemVyLnN0eWxlLnBhZGRpbmdSaWdodCA9IChkLmJhcldpZHRoID0gc2l6ZXMucmlnaHQpICsgXCJweFwiO1xuICAgIGQuc2l6ZXIuc3R5bGUucGFkZGluZ0JvdHRvbSA9IChkLmJhckhlaWdodCA9IHNpemVzLmJvdHRvbSkgKyBcInB4XCI7XG5cbiAgICBpZiAoc2l6ZXMucmlnaHQgJiYgc2l6ZXMuYm90dG9tKSB7XG4gICAgICBkLnNjcm9sbGJhckZpbGxlci5zdHlsZS5kaXNwbGF5ID0gXCJibG9ja1wiO1xuICAgICAgZC5zY3JvbGxiYXJGaWxsZXIuc3R5bGUuaGVpZ2h0ID0gc2l6ZXMuYm90dG9tICsgXCJweFwiO1xuICAgICAgZC5zY3JvbGxiYXJGaWxsZXIuc3R5bGUud2lkdGggPSBzaXplcy5yaWdodCArIFwicHhcIjtcbiAgICB9IGVsc2UgZC5zY3JvbGxiYXJGaWxsZXIuc3R5bGUuZGlzcGxheSA9IFwiXCI7XG4gICAgaWYgKHNpemVzLmJvdHRvbSAmJiBjbS5vcHRpb25zLmNvdmVyR3V0dGVyTmV4dFRvU2Nyb2xsYmFyICYmIGNtLm9wdGlvbnMuZml4ZWRHdXR0ZXIpIHtcbiAgICAgIGQuZ3V0dGVyRmlsbGVyLnN0eWxlLmRpc3BsYXkgPSBcImJsb2NrXCI7XG4gICAgICBkLmd1dHRlckZpbGxlci5zdHlsZS5oZWlnaHQgPSBzaXplcy5ib3R0b20gKyBcInB4XCI7XG4gICAgICBkLmd1dHRlckZpbGxlci5zdHlsZS53aWR0aCA9IG1lYXN1cmUuZ3V0dGVyV2lkdGggKyBcInB4XCI7XG4gICAgfSBlbHNlIGQuZ3V0dGVyRmlsbGVyLnN0eWxlLmRpc3BsYXkgPSBcIlwiO1xuICB9XG5cbiAgLy8gQ29tcHV0ZSB0aGUgbGluZXMgdGhhdCBhcmUgdmlzaWJsZSBpbiBhIGdpdmVuIHZpZXdwb3J0IChkZWZhdWx0c1xuICAvLyB0aGUgdGhlIGN1cnJlbnQgc2Nyb2xsIHBvc2l0aW9uKS4gdmlld3BvcnQgbWF5IGNvbnRhaW4gdG9wLFxuICAvLyBoZWlnaHQsIGFuZCBlbnN1cmUgKHNlZSBvcC5zY3JvbGxUb1BvcykgcHJvcGVydGllcy5cbiAgZnVuY3Rpb24gdmlzaWJsZUxpbmVzKGRpc3BsYXksIGRvYywgdmlld3BvcnQpIHtcbiAgICB2YXIgdG9wID0gdmlld3BvcnQgJiYgdmlld3BvcnQudG9wICE9IG51bGwgPyBNYXRoLm1heCgwLCB2aWV3cG9ydC50b3ApIDogZGlzcGxheS5zY3JvbGxlci5zY3JvbGxUb3A7XG4gICAgdG9wID0gTWF0aC5mbG9vcih0b3AgLSBwYWRkaW5nVG9wKGRpc3BsYXkpKTtcbiAgICB2YXIgYm90dG9tID0gdmlld3BvcnQgJiYgdmlld3BvcnQuYm90dG9tICE9IG51bGwgPyB2aWV3cG9ydC5ib3R0b20gOiB0b3AgKyBkaXNwbGF5LndyYXBwZXIuY2xpZW50SGVpZ2h0O1xuXG4gICAgdmFyIGZyb20gPSBsaW5lQXRIZWlnaHQoZG9jLCB0b3ApLCB0byA9IGxpbmVBdEhlaWdodChkb2MsIGJvdHRvbSk7XG4gICAgLy8gRW5zdXJlIGlzIGEge2Zyb206IHtsaW5lLCBjaH0sIHRvOiB7bGluZSwgY2h9fSBvYmplY3QsIGFuZFxuICAgIC8vIGZvcmNlcyB0aG9zZSBsaW5lcyBpbnRvIHRoZSB2aWV3cG9ydCAoaWYgcG9zc2libGUpLlxuICAgIGlmICh2aWV3cG9ydCAmJiB2aWV3cG9ydC5lbnN1cmUpIHtcbiAgICAgIHZhciBlbnN1cmVGcm9tID0gdmlld3BvcnQuZW5zdXJlLmZyb20ubGluZSwgZW5zdXJlVG8gPSB2aWV3cG9ydC5lbnN1cmUudG8ubGluZTtcbiAgICAgIGlmIChlbnN1cmVGcm9tIDwgZnJvbSkge1xuICAgICAgICBmcm9tID0gZW5zdXJlRnJvbTtcbiAgICAgICAgdG8gPSBsaW5lQXRIZWlnaHQoZG9jLCBoZWlnaHRBdExpbmUoZ2V0TGluZShkb2MsIGVuc3VyZUZyb20pKSArIGRpc3BsYXkud3JhcHBlci5jbGllbnRIZWlnaHQpO1xuICAgICAgfSBlbHNlIGlmIChNYXRoLm1pbihlbnN1cmVUbywgZG9jLmxhc3RMaW5lKCkpID49IHRvKSB7XG4gICAgICAgIGZyb20gPSBsaW5lQXRIZWlnaHQoZG9jLCBoZWlnaHRBdExpbmUoZ2V0TGluZShkb2MsIGVuc3VyZVRvKSkgLSBkaXNwbGF5LndyYXBwZXIuY2xpZW50SGVpZ2h0KTtcbiAgICAgICAgdG8gPSBlbnN1cmVUbztcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHtmcm9tOiBmcm9tLCB0bzogTWF0aC5tYXgodG8sIGZyb20gKyAxKX07XG4gIH1cblxuICAvLyBMSU5FIE5VTUJFUlNcblxuICAvLyBSZS1hbGlnbiBsaW5lIG51bWJlcnMgYW5kIGd1dHRlciBtYXJrcyB0byBjb21wZW5zYXRlIGZvclxuICAvLyBob3Jpem9udGFsIHNjcm9sbGluZy5cbiAgZnVuY3Rpb24gYWxpZ25Ib3Jpem9udGFsbHkoY20pIHtcbiAgICB2YXIgZGlzcGxheSA9IGNtLmRpc3BsYXksIHZpZXcgPSBkaXNwbGF5LnZpZXc7XG4gICAgaWYgKCFkaXNwbGF5LmFsaWduV2lkZ2V0cyAmJiAoIWRpc3BsYXkuZ3V0dGVycy5maXJzdENoaWxkIHx8ICFjbS5vcHRpb25zLmZpeGVkR3V0dGVyKSkgcmV0dXJuO1xuICAgIHZhciBjb21wID0gY29tcGVuc2F0ZUZvckhTY3JvbGwoZGlzcGxheSkgLSBkaXNwbGF5LnNjcm9sbGVyLnNjcm9sbExlZnQgKyBjbS5kb2Muc2Nyb2xsTGVmdDtcbiAgICB2YXIgZ3V0dGVyVyA9IGRpc3BsYXkuZ3V0dGVycy5vZmZzZXRXaWR0aCwgbGVmdCA9IGNvbXAgKyBcInB4XCI7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCB2aWV3Lmxlbmd0aDsgaSsrKSBpZiAoIXZpZXdbaV0uaGlkZGVuKSB7XG4gICAgICBpZiAoY20ub3B0aW9ucy5maXhlZEd1dHRlciAmJiB2aWV3W2ldLmd1dHRlcilcbiAgICAgICAgdmlld1tpXS5ndXR0ZXIuc3R5bGUubGVmdCA9IGxlZnQ7XG4gICAgICB2YXIgYWxpZ24gPSB2aWV3W2ldLmFsaWduYWJsZTtcbiAgICAgIGlmIChhbGlnbikgZm9yICh2YXIgaiA9IDA7IGogPCBhbGlnbi5sZW5ndGg7IGorKylcbiAgICAgICAgYWxpZ25bal0uc3R5bGUubGVmdCA9IGxlZnQ7XG4gICAgfVxuICAgIGlmIChjbS5vcHRpb25zLmZpeGVkR3V0dGVyKVxuICAgICAgZGlzcGxheS5ndXR0ZXJzLnN0eWxlLmxlZnQgPSAoY29tcCArIGd1dHRlclcpICsgXCJweFwiO1xuICB9XG5cbiAgLy8gVXNlZCB0byBlbnN1cmUgdGhhdCB0aGUgbGluZSBudW1iZXIgZ3V0dGVyIGlzIHN0aWxsIHRoZSByaWdodFxuICAvLyBzaXplIGZvciB0aGUgY3VycmVudCBkb2N1bWVudCBzaXplLiBSZXR1cm5zIHRydWUgd2hlbiBhbiB1cGRhdGVcbiAgLy8gaXMgbmVlZGVkLlxuICBmdW5jdGlvbiBtYXliZVVwZGF0ZUxpbmVOdW1iZXJXaWR0aChjbSkge1xuICAgIGlmICghY20ub3B0aW9ucy5saW5lTnVtYmVycykgcmV0dXJuIGZhbHNlO1xuICAgIHZhciBkb2MgPSBjbS5kb2MsIGxhc3QgPSBsaW5lTnVtYmVyRm9yKGNtLm9wdGlvbnMsIGRvYy5maXJzdCArIGRvYy5zaXplIC0gMSksIGRpc3BsYXkgPSBjbS5kaXNwbGF5O1xuICAgIGlmIChsYXN0Lmxlbmd0aCAhPSBkaXNwbGF5LmxpbmVOdW1DaGFycykge1xuICAgICAgdmFyIHRlc3QgPSBkaXNwbGF5Lm1lYXN1cmUuYXBwZW5kQ2hpbGQoZWx0KFwiZGl2XCIsIFtlbHQoXCJkaXZcIiwgbGFzdCldLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFwiQ29kZU1pcnJvci1saW5lbnVtYmVyIENvZGVNaXJyb3ItZ3V0dGVyLWVsdFwiKSk7XG4gICAgICB2YXIgaW5uZXJXID0gdGVzdC5maXJzdENoaWxkLm9mZnNldFdpZHRoLCBwYWRkaW5nID0gdGVzdC5vZmZzZXRXaWR0aCAtIGlubmVyVztcbiAgICAgIGRpc3BsYXkubGluZUd1dHRlci5zdHlsZS53aWR0aCA9IFwiXCI7XG4gICAgICBkaXNwbGF5LmxpbmVOdW1Jbm5lcldpZHRoID0gTWF0aC5tYXgoaW5uZXJXLCBkaXNwbGF5LmxpbmVHdXR0ZXIub2Zmc2V0V2lkdGggLSBwYWRkaW5nKSArIDE7XG4gICAgICBkaXNwbGF5LmxpbmVOdW1XaWR0aCA9IGRpc3BsYXkubGluZU51bUlubmVyV2lkdGggKyBwYWRkaW5nO1xuICAgICAgZGlzcGxheS5saW5lTnVtQ2hhcnMgPSBkaXNwbGF5LmxpbmVOdW1Jbm5lcldpZHRoID8gbGFzdC5sZW5ndGggOiAtMTtcbiAgICAgIGRpc3BsYXkubGluZUd1dHRlci5zdHlsZS53aWR0aCA9IGRpc3BsYXkubGluZU51bVdpZHRoICsgXCJweFwiO1xuICAgICAgdXBkYXRlR3V0dGVyU3BhY2UoY20pO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGxpbmVOdW1iZXJGb3Iob3B0aW9ucywgaSkge1xuICAgIHJldHVybiBTdHJpbmcob3B0aW9ucy5saW5lTnVtYmVyRm9ybWF0dGVyKGkgKyBvcHRpb25zLmZpcnN0TGluZU51bWJlcikpO1xuICB9XG5cbiAgLy8gQ29tcHV0ZXMgZGlzcGxheS5zY3JvbGxlci5zY3JvbGxMZWZ0ICsgZGlzcGxheS5ndXR0ZXJzLm9mZnNldFdpZHRoLFxuICAvLyBidXQgdXNpbmcgZ2V0Qm91bmRpbmdDbGllbnRSZWN0IHRvIGdldCBhIHN1Yi1waXhlbC1hY2N1cmF0ZVxuICAvLyByZXN1bHQuXG4gIGZ1bmN0aW9uIGNvbXBlbnNhdGVGb3JIU2Nyb2xsKGRpc3BsYXkpIHtcbiAgICByZXR1cm4gZGlzcGxheS5zY3JvbGxlci5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKS5sZWZ0IC0gZGlzcGxheS5zaXplci5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKS5sZWZ0O1xuICB9XG5cbiAgLy8gRElTUExBWSBEUkFXSU5HXG5cbiAgZnVuY3Rpb24gRGlzcGxheVVwZGF0ZShjbSwgdmlld3BvcnQsIGZvcmNlKSB7XG4gICAgdmFyIGRpc3BsYXkgPSBjbS5kaXNwbGF5O1xuXG4gICAgdGhpcy52aWV3cG9ydCA9IHZpZXdwb3J0O1xuICAgIC8vIFN0b3JlIHNvbWUgdmFsdWVzIHRoYXQgd2UnbGwgbmVlZCBsYXRlciAoYnV0IGRvbid0IHdhbnQgdG8gZm9yY2UgYSByZWxheW91dCBmb3IpXG4gICAgdGhpcy52aXNpYmxlID0gdmlzaWJsZUxpbmVzKGRpc3BsYXksIGNtLmRvYywgdmlld3BvcnQpO1xuICAgIHRoaXMuZWRpdG9ySXNIaWRkZW4gPSAhZGlzcGxheS53cmFwcGVyLm9mZnNldFdpZHRoO1xuICAgIHRoaXMud3JhcHBlckhlaWdodCA9IGRpc3BsYXkud3JhcHBlci5jbGllbnRIZWlnaHQ7XG4gICAgdGhpcy53cmFwcGVyV2lkdGggPSBkaXNwbGF5LndyYXBwZXIuY2xpZW50V2lkdGg7XG4gICAgdGhpcy5vbGREaXNwbGF5V2lkdGggPSBkaXNwbGF5V2lkdGgoY20pO1xuICAgIHRoaXMuZm9yY2UgPSBmb3JjZTtcbiAgICB0aGlzLmRpbXMgPSBnZXREaW1lbnNpb25zKGNtKTtcbiAgICB0aGlzLmV2ZW50cyA9IFtdO1xuICB9XG5cbiAgRGlzcGxheVVwZGF0ZS5wcm90b3R5cGUuc2lnbmFsID0gZnVuY3Rpb24oZW1pdHRlciwgdHlwZSkge1xuICAgIGlmIChoYXNIYW5kbGVyKGVtaXR0ZXIsIHR5cGUpKVxuICAgICAgdGhpcy5ldmVudHMucHVzaChhcmd1bWVudHMpO1xuICB9O1xuICBEaXNwbGF5VXBkYXRlLnByb3RvdHlwZS5maW5pc2ggPSBmdW5jdGlvbigpIHtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMuZXZlbnRzLmxlbmd0aDsgaSsrKVxuICAgICAgc2lnbmFsLmFwcGx5KG51bGwsIHRoaXMuZXZlbnRzW2ldKTtcbiAgfTtcblxuICBmdW5jdGlvbiBtYXliZUNsaXBTY3JvbGxiYXJzKGNtKSB7XG4gICAgdmFyIGRpc3BsYXkgPSBjbS5kaXNwbGF5O1xuICAgIGlmICghZGlzcGxheS5zY3JvbGxiYXJzQ2xpcHBlZCAmJiBkaXNwbGF5LnNjcm9sbGVyLm9mZnNldFdpZHRoKSB7XG4gICAgICBkaXNwbGF5Lm5hdGl2ZUJhcldpZHRoID0gZGlzcGxheS5zY3JvbGxlci5vZmZzZXRXaWR0aCAtIGRpc3BsYXkuc2Nyb2xsZXIuY2xpZW50V2lkdGg7XG4gICAgICBkaXNwbGF5LmhlaWdodEZvcmNlci5zdHlsZS5oZWlnaHQgPSBzY3JvbGxHYXAoY20pICsgXCJweFwiO1xuICAgICAgZGlzcGxheS5zaXplci5zdHlsZS5tYXJnaW5Cb3R0b20gPSAtZGlzcGxheS5uYXRpdmVCYXJXaWR0aCArIFwicHhcIjtcbiAgICAgIGRpc3BsYXkuc2l6ZXIuc3R5bGUuYm9yZGVyUmlnaHRXaWR0aCA9IHNjcm9sbEdhcChjbSkgKyBcInB4XCI7XG4gICAgICBkaXNwbGF5LnNjcm9sbGJhcnNDbGlwcGVkID0gdHJ1ZTtcbiAgICB9XG4gIH1cblxuICAvLyBEb2VzIHRoZSBhY3R1YWwgdXBkYXRpbmcgb2YgdGhlIGxpbmUgZGlzcGxheS4gQmFpbHMgb3V0XG4gIC8vIChyZXR1cm5pbmcgZmFsc2UpIHdoZW4gdGhlcmUgaXMgbm90aGluZyB0byBiZSBkb25lIGFuZCBmb3JjZWQgaXNcbiAgLy8gZmFsc2UuXG4gIGZ1bmN0aW9uIHVwZGF0ZURpc3BsYXlJZk5lZWRlZChjbSwgdXBkYXRlKSB7XG4gICAgdmFyIGRpc3BsYXkgPSBjbS5kaXNwbGF5LCBkb2MgPSBjbS5kb2M7XG5cbiAgICBpZiAodXBkYXRlLmVkaXRvcklzSGlkZGVuKSB7XG4gICAgICByZXNldFZpZXcoY20pO1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIC8vIEJhaWwgb3V0IGlmIHRoZSB2aXNpYmxlIGFyZWEgaXMgYWxyZWFkeSByZW5kZXJlZCBhbmQgbm90aGluZyBjaGFuZ2VkLlxuICAgIGlmICghdXBkYXRlLmZvcmNlICYmXG4gICAgICAgIHVwZGF0ZS52aXNpYmxlLmZyb20gPj0gZGlzcGxheS52aWV3RnJvbSAmJiB1cGRhdGUudmlzaWJsZS50byA8PSBkaXNwbGF5LnZpZXdUbyAmJlxuICAgICAgICAoZGlzcGxheS51cGRhdGVMaW5lTnVtYmVycyA9PSBudWxsIHx8IGRpc3BsYXkudXBkYXRlTGluZU51bWJlcnMgPj0gZGlzcGxheS52aWV3VG8pICYmXG4gICAgICAgIGRpc3BsYXkucmVuZGVyZWRWaWV3ID09IGRpc3BsYXkudmlldyAmJiBjb3VudERpcnR5VmlldyhjbSkgPT0gMClcbiAgICAgIHJldHVybiBmYWxzZTtcblxuICAgIGlmIChtYXliZVVwZGF0ZUxpbmVOdW1iZXJXaWR0aChjbSkpIHtcbiAgICAgIHJlc2V0VmlldyhjbSk7XG4gICAgICB1cGRhdGUuZGltcyA9IGdldERpbWVuc2lvbnMoY20pO1xuICAgIH1cblxuICAgIC8vIENvbXB1dGUgYSBzdWl0YWJsZSBuZXcgdmlld3BvcnQgKGZyb20gJiB0bylcbiAgICB2YXIgZW5kID0gZG9jLmZpcnN0ICsgZG9jLnNpemU7XG4gICAgdmFyIGZyb20gPSBNYXRoLm1heCh1cGRhdGUudmlzaWJsZS5mcm9tIC0gY20ub3B0aW9ucy52aWV3cG9ydE1hcmdpbiwgZG9jLmZpcnN0KTtcbiAgICB2YXIgdG8gPSBNYXRoLm1pbihlbmQsIHVwZGF0ZS52aXNpYmxlLnRvICsgY20ub3B0aW9ucy52aWV3cG9ydE1hcmdpbik7XG4gICAgaWYgKGRpc3BsYXkudmlld0Zyb20gPCBmcm9tICYmIGZyb20gLSBkaXNwbGF5LnZpZXdGcm9tIDwgMjApIGZyb20gPSBNYXRoLm1heChkb2MuZmlyc3QsIGRpc3BsYXkudmlld0Zyb20pO1xuICAgIGlmIChkaXNwbGF5LnZpZXdUbyA+IHRvICYmIGRpc3BsYXkudmlld1RvIC0gdG8gPCAyMCkgdG8gPSBNYXRoLm1pbihlbmQsIGRpc3BsYXkudmlld1RvKTtcbiAgICBpZiAoc2F3Q29sbGFwc2VkU3BhbnMpIHtcbiAgICAgIGZyb20gPSB2aXN1YWxMaW5lTm8oY20uZG9jLCBmcm9tKTtcbiAgICAgIHRvID0gdmlzdWFsTGluZUVuZE5vKGNtLmRvYywgdG8pO1xuICAgIH1cblxuICAgIHZhciBkaWZmZXJlbnQgPSBmcm9tICE9IGRpc3BsYXkudmlld0Zyb20gfHwgdG8gIT0gZGlzcGxheS52aWV3VG8gfHxcbiAgICAgIGRpc3BsYXkubGFzdFdyYXBIZWlnaHQgIT0gdXBkYXRlLndyYXBwZXJIZWlnaHQgfHwgZGlzcGxheS5sYXN0V3JhcFdpZHRoICE9IHVwZGF0ZS53cmFwcGVyV2lkdGg7XG4gICAgYWRqdXN0VmlldyhjbSwgZnJvbSwgdG8pO1xuXG4gICAgZGlzcGxheS52aWV3T2Zmc2V0ID0gaGVpZ2h0QXRMaW5lKGdldExpbmUoY20uZG9jLCBkaXNwbGF5LnZpZXdGcm9tKSk7XG4gICAgLy8gUG9zaXRpb24gdGhlIG1vdmVyIGRpdiB0byBhbGlnbiB3aXRoIHRoZSBjdXJyZW50IHNjcm9sbCBwb3NpdGlvblxuICAgIGNtLmRpc3BsYXkubW92ZXIuc3R5bGUudG9wID0gZGlzcGxheS52aWV3T2Zmc2V0ICsgXCJweFwiO1xuXG4gICAgdmFyIHRvVXBkYXRlID0gY291bnREaXJ0eVZpZXcoY20pO1xuICAgIGlmICghZGlmZmVyZW50ICYmIHRvVXBkYXRlID09IDAgJiYgIXVwZGF0ZS5mb3JjZSAmJiBkaXNwbGF5LnJlbmRlcmVkVmlldyA9PSBkaXNwbGF5LnZpZXcgJiZcbiAgICAgICAgKGRpc3BsYXkudXBkYXRlTGluZU51bWJlcnMgPT0gbnVsbCB8fCBkaXNwbGF5LnVwZGF0ZUxpbmVOdW1iZXJzID49IGRpc3BsYXkudmlld1RvKSlcbiAgICAgIHJldHVybiBmYWxzZTtcblxuICAgIC8vIEZvciBiaWcgY2hhbmdlcywgd2UgaGlkZSB0aGUgZW5jbG9zaW5nIGVsZW1lbnQgZHVyaW5nIHRoZVxuICAgIC8vIHVwZGF0ZSwgc2luY2UgdGhhdCBzcGVlZHMgdXAgdGhlIG9wZXJhdGlvbnMgb24gbW9zdCBicm93c2Vycy5cbiAgICB2YXIgZm9jdXNlZCA9IGFjdGl2ZUVsdCgpO1xuICAgIGlmICh0b1VwZGF0ZSA+IDQpIGRpc3BsYXkubGluZURpdi5zdHlsZS5kaXNwbGF5ID0gXCJub25lXCI7XG4gICAgcGF0Y2hEaXNwbGF5KGNtLCBkaXNwbGF5LnVwZGF0ZUxpbmVOdW1iZXJzLCB1cGRhdGUuZGltcyk7XG4gICAgaWYgKHRvVXBkYXRlID4gNCkgZGlzcGxheS5saW5lRGl2LnN0eWxlLmRpc3BsYXkgPSBcIlwiO1xuICAgIGRpc3BsYXkucmVuZGVyZWRWaWV3ID0gZGlzcGxheS52aWV3O1xuICAgIC8vIFRoZXJlIG1pZ2h0IGhhdmUgYmVlbiBhIHdpZGdldCB3aXRoIGEgZm9jdXNlZCBlbGVtZW50IHRoYXQgZ290XG4gICAgLy8gaGlkZGVuIG9yIHVwZGF0ZWQsIGlmIHNvIHJlLWZvY3VzIGl0LlxuICAgIGlmIChmb2N1c2VkICYmIGFjdGl2ZUVsdCgpICE9IGZvY3VzZWQgJiYgZm9jdXNlZC5vZmZzZXRIZWlnaHQpIGZvY3VzZWQuZm9jdXMoKTtcblxuICAgIC8vIFByZXZlbnQgc2VsZWN0aW9uIGFuZCBjdXJzb3JzIGZyb20gaW50ZXJmZXJpbmcgd2l0aCB0aGUgc2Nyb2xsXG4gICAgLy8gd2lkdGggYW5kIGhlaWdodC5cbiAgICByZW1vdmVDaGlsZHJlbihkaXNwbGF5LmN1cnNvckRpdik7XG4gICAgcmVtb3ZlQ2hpbGRyZW4oZGlzcGxheS5zZWxlY3Rpb25EaXYpO1xuICAgIGRpc3BsYXkuZ3V0dGVycy5zdHlsZS5oZWlnaHQgPSAwO1xuXG4gICAgaWYgKGRpZmZlcmVudCkge1xuICAgICAgZGlzcGxheS5sYXN0V3JhcEhlaWdodCA9IHVwZGF0ZS53cmFwcGVySGVpZ2h0O1xuICAgICAgZGlzcGxheS5sYXN0V3JhcFdpZHRoID0gdXBkYXRlLndyYXBwZXJXaWR0aDtcbiAgICAgIHN0YXJ0V29ya2VyKGNtLCA0MDApO1xuICAgIH1cblxuICAgIGRpc3BsYXkudXBkYXRlTGluZU51bWJlcnMgPSBudWxsO1xuXG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICBmdW5jdGlvbiBwb3N0VXBkYXRlRGlzcGxheShjbSwgdXBkYXRlKSB7XG4gICAgdmFyIHZpZXdwb3J0ID0gdXBkYXRlLnZpZXdwb3J0O1xuICAgIGZvciAodmFyIGZpcnN0ID0gdHJ1ZTs7IGZpcnN0ID0gZmFsc2UpIHtcbiAgICAgIGlmICghZmlyc3QgfHwgIWNtLm9wdGlvbnMubGluZVdyYXBwaW5nIHx8IHVwZGF0ZS5vbGREaXNwbGF5V2lkdGggPT0gZGlzcGxheVdpZHRoKGNtKSkge1xuICAgICAgICAvLyBDbGlwIGZvcmNlZCB2aWV3cG9ydCB0byBhY3R1YWwgc2Nyb2xsYWJsZSBhcmVhLlxuICAgICAgICBpZiAodmlld3BvcnQgJiYgdmlld3BvcnQudG9wICE9IG51bGwpXG4gICAgICAgICAgdmlld3BvcnQgPSB7dG9wOiBNYXRoLm1pbihjbS5kb2MuaGVpZ2h0ICsgcGFkZGluZ1ZlcnQoY20uZGlzcGxheSkgLSBkaXNwbGF5SGVpZ2h0KGNtKSwgdmlld3BvcnQudG9wKX07XG4gICAgICAgIC8vIFVwZGF0ZWQgbGluZSBoZWlnaHRzIG1pZ2h0IHJlc3VsdCBpbiB0aGUgZHJhd24gYXJlYSBub3RcbiAgICAgICAgLy8gYWN0dWFsbHkgY292ZXJpbmcgdGhlIHZpZXdwb3J0LiBLZWVwIGxvb3BpbmcgdW50aWwgaXQgZG9lcy5cbiAgICAgICAgdXBkYXRlLnZpc2libGUgPSB2aXNpYmxlTGluZXMoY20uZGlzcGxheSwgY20uZG9jLCB2aWV3cG9ydCk7XG4gICAgICAgIGlmICh1cGRhdGUudmlzaWJsZS5mcm9tID49IGNtLmRpc3BsYXkudmlld0Zyb20gJiYgdXBkYXRlLnZpc2libGUudG8gPD0gY20uZGlzcGxheS52aWV3VG8pXG4gICAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgICBpZiAoIXVwZGF0ZURpc3BsYXlJZk5lZWRlZChjbSwgdXBkYXRlKSkgYnJlYWs7XG4gICAgICB1cGRhdGVIZWlnaHRzSW5WaWV3cG9ydChjbSk7XG4gICAgICB2YXIgYmFyTWVhc3VyZSA9IG1lYXN1cmVGb3JTY3JvbGxiYXJzKGNtKTtcbiAgICAgIHVwZGF0ZVNlbGVjdGlvbihjbSk7XG4gICAgICBzZXREb2N1bWVudEhlaWdodChjbSwgYmFyTWVhc3VyZSk7XG4gICAgICB1cGRhdGVTY3JvbGxiYXJzKGNtLCBiYXJNZWFzdXJlKTtcbiAgICB9XG5cbiAgICB1cGRhdGUuc2lnbmFsKGNtLCBcInVwZGF0ZVwiLCBjbSk7XG4gICAgaWYgKGNtLmRpc3BsYXkudmlld0Zyb20gIT0gY20uZGlzcGxheS5yZXBvcnRlZFZpZXdGcm9tIHx8IGNtLmRpc3BsYXkudmlld1RvICE9IGNtLmRpc3BsYXkucmVwb3J0ZWRWaWV3VG8pIHtcbiAgICAgIHVwZGF0ZS5zaWduYWwoY20sIFwidmlld3BvcnRDaGFuZ2VcIiwgY20sIGNtLmRpc3BsYXkudmlld0Zyb20sIGNtLmRpc3BsYXkudmlld1RvKTtcbiAgICAgIGNtLmRpc3BsYXkucmVwb3J0ZWRWaWV3RnJvbSA9IGNtLmRpc3BsYXkudmlld0Zyb207IGNtLmRpc3BsYXkucmVwb3J0ZWRWaWV3VG8gPSBjbS5kaXNwbGF5LnZpZXdUbztcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiB1cGRhdGVEaXNwbGF5U2ltcGxlKGNtLCB2aWV3cG9ydCkge1xuICAgIHZhciB1cGRhdGUgPSBuZXcgRGlzcGxheVVwZGF0ZShjbSwgdmlld3BvcnQpO1xuICAgIGlmICh1cGRhdGVEaXNwbGF5SWZOZWVkZWQoY20sIHVwZGF0ZSkpIHtcbiAgICAgIHVwZGF0ZUhlaWdodHNJblZpZXdwb3J0KGNtKTtcbiAgICAgIHBvc3RVcGRhdGVEaXNwbGF5KGNtLCB1cGRhdGUpO1xuICAgICAgdmFyIGJhck1lYXN1cmUgPSBtZWFzdXJlRm9yU2Nyb2xsYmFycyhjbSk7XG4gICAgICB1cGRhdGVTZWxlY3Rpb24oY20pO1xuICAgICAgc2V0RG9jdW1lbnRIZWlnaHQoY20sIGJhck1lYXN1cmUpO1xuICAgICAgdXBkYXRlU2Nyb2xsYmFycyhjbSwgYmFyTWVhc3VyZSk7XG4gICAgICB1cGRhdGUuZmluaXNoKCk7XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gc2V0RG9jdW1lbnRIZWlnaHQoY20sIG1lYXN1cmUpIHtcbiAgICBjbS5kaXNwbGF5LnNpemVyLnN0eWxlLm1pbkhlaWdodCA9IG1lYXN1cmUuZG9jSGVpZ2h0ICsgXCJweFwiO1xuICAgIHZhciB0b3RhbCA9IG1lYXN1cmUuZG9jSGVpZ2h0ICsgY20uZGlzcGxheS5iYXJIZWlnaHQ7XG4gICAgY20uZGlzcGxheS5oZWlnaHRGb3JjZXIuc3R5bGUudG9wID0gdG90YWwgKyBcInB4XCI7XG4gICAgY20uZGlzcGxheS5ndXR0ZXJzLnN0eWxlLmhlaWdodCA9IE1hdGgubWF4KHRvdGFsICsgc2Nyb2xsR2FwKGNtKSwgbWVhc3VyZS5jbGllbnRIZWlnaHQpICsgXCJweFwiO1xuICB9XG5cbiAgLy8gUmVhZCB0aGUgYWN0dWFsIGhlaWdodHMgb2YgdGhlIHJlbmRlcmVkIGxpbmVzLCBhbmQgdXBkYXRlIHRoZWlyXG4gIC8vIHN0b3JlZCBoZWlnaHRzIHRvIG1hdGNoLlxuICBmdW5jdGlvbiB1cGRhdGVIZWlnaHRzSW5WaWV3cG9ydChjbSkge1xuICAgIHZhciBkaXNwbGF5ID0gY20uZGlzcGxheTtcbiAgICB2YXIgcHJldkJvdHRvbSA9IGRpc3BsYXkubGluZURpdi5vZmZzZXRUb3A7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBkaXNwbGF5LnZpZXcubGVuZ3RoOyBpKyspIHtcbiAgICAgIHZhciBjdXIgPSBkaXNwbGF5LnZpZXdbaV0sIGhlaWdodDtcbiAgICAgIGlmIChjdXIuaGlkZGVuKSBjb250aW51ZTtcbiAgICAgIGlmIChpZSAmJiBpZV92ZXJzaW9uIDwgOCkge1xuICAgICAgICB2YXIgYm90ID0gY3VyLm5vZGUub2Zmc2V0VG9wICsgY3VyLm5vZGUub2Zmc2V0SGVpZ2h0O1xuICAgICAgICBoZWlnaHQgPSBib3QgLSBwcmV2Qm90dG9tO1xuICAgICAgICBwcmV2Qm90dG9tID0gYm90O1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdmFyIGJveCA9IGN1ci5ub2RlLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgICAgICBoZWlnaHQgPSBib3guYm90dG9tIC0gYm94LnRvcDtcbiAgICAgIH1cbiAgICAgIHZhciBkaWZmID0gY3VyLmxpbmUuaGVpZ2h0IC0gaGVpZ2h0O1xuICAgICAgaWYgKGhlaWdodCA8IDIpIGhlaWdodCA9IHRleHRIZWlnaHQoZGlzcGxheSk7XG4gICAgICBpZiAoZGlmZiA+IC4wMDEgfHwgZGlmZiA8IC0uMDAxKSB7XG4gICAgICAgIHVwZGF0ZUxpbmVIZWlnaHQoY3VyLmxpbmUsIGhlaWdodCk7XG4gICAgICAgIHVwZGF0ZVdpZGdldEhlaWdodChjdXIubGluZSk7XG4gICAgICAgIGlmIChjdXIucmVzdCkgZm9yICh2YXIgaiA9IDA7IGogPCBjdXIucmVzdC5sZW5ndGg7IGorKylcbiAgICAgICAgICB1cGRhdGVXaWRnZXRIZWlnaHQoY3VyLnJlc3Rbal0pO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIFJlYWQgYW5kIHN0b3JlIHRoZSBoZWlnaHQgb2YgbGluZSB3aWRnZXRzIGFzc29jaWF0ZWQgd2l0aCB0aGVcbiAgLy8gZ2l2ZW4gbGluZS5cbiAgZnVuY3Rpb24gdXBkYXRlV2lkZ2V0SGVpZ2h0KGxpbmUpIHtcbiAgICBpZiAobGluZS53aWRnZXRzKSBmb3IgKHZhciBpID0gMDsgaSA8IGxpbmUud2lkZ2V0cy5sZW5ndGg7ICsraSlcbiAgICAgIGxpbmUud2lkZ2V0c1tpXS5oZWlnaHQgPSBsaW5lLndpZGdldHNbaV0ubm9kZS5vZmZzZXRIZWlnaHQ7XG4gIH1cblxuICAvLyBEbyBhIGJ1bGstcmVhZCBvZiB0aGUgRE9NIHBvc2l0aW9ucyBhbmQgc2l6ZXMgbmVlZGVkIHRvIGRyYXcgdGhlXG4gIC8vIHZpZXcsIHNvIHRoYXQgd2UgZG9uJ3QgaW50ZXJsZWF2ZSByZWFkaW5nIGFuZCB3cml0aW5nIHRvIHRoZSBET00uXG4gIGZ1bmN0aW9uIGdldERpbWVuc2lvbnMoY20pIHtcbiAgICB2YXIgZCA9IGNtLmRpc3BsYXksIGxlZnQgPSB7fSwgd2lkdGggPSB7fTtcbiAgICB2YXIgZ3V0dGVyTGVmdCA9IGQuZ3V0dGVycy5jbGllbnRMZWZ0O1xuICAgIGZvciAodmFyIG4gPSBkLmd1dHRlcnMuZmlyc3RDaGlsZCwgaSA9IDA7IG47IG4gPSBuLm5leHRTaWJsaW5nLCArK2kpIHtcbiAgICAgIGxlZnRbY20ub3B0aW9ucy5ndXR0ZXJzW2ldXSA9IG4ub2Zmc2V0TGVmdCArIG4uY2xpZW50TGVmdCArIGd1dHRlckxlZnQ7XG4gICAgICB3aWR0aFtjbS5vcHRpb25zLmd1dHRlcnNbaV1dID0gbi5jbGllbnRXaWR0aDtcbiAgICB9XG4gICAgcmV0dXJuIHtmaXhlZFBvczogY29tcGVuc2F0ZUZvckhTY3JvbGwoZCksXG4gICAgICAgICAgICBndXR0ZXJUb3RhbFdpZHRoOiBkLmd1dHRlcnMub2Zmc2V0V2lkdGgsXG4gICAgICAgICAgICBndXR0ZXJMZWZ0OiBsZWZ0LFxuICAgICAgICAgICAgZ3V0dGVyV2lkdGg6IHdpZHRoLFxuICAgICAgICAgICAgd3JhcHBlcldpZHRoOiBkLndyYXBwZXIuY2xpZW50V2lkdGh9O1xuICB9XG5cbiAgLy8gU3luYyB0aGUgYWN0dWFsIGRpc3BsYXkgRE9NIHN0cnVjdHVyZSB3aXRoIGRpc3BsYXkudmlldywgcmVtb3ZpbmdcbiAgLy8gbm9kZXMgZm9yIGxpbmVzIHRoYXQgYXJlIG5vIGxvbmdlciBpbiB2aWV3LCBhbmQgY3JlYXRpbmcgdGhlIG9uZXNcbiAgLy8gdGhhdCBhcmUgbm90IHRoZXJlIHlldCwgYW5kIHVwZGF0aW5nIHRoZSBvbmVzIHRoYXQgYXJlIG91dCBvZlxuICAvLyBkYXRlLlxuICBmdW5jdGlvbiBwYXRjaERpc3BsYXkoY20sIHVwZGF0ZU51bWJlcnNGcm9tLCBkaW1zKSB7XG4gICAgdmFyIGRpc3BsYXkgPSBjbS5kaXNwbGF5LCBsaW5lTnVtYmVycyA9IGNtLm9wdGlvbnMubGluZU51bWJlcnM7XG4gICAgdmFyIGNvbnRhaW5lciA9IGRpc3BsYXkubGluZURpdiwgY3VyID0gY29udGFpbmVyLmZpcnN0Q2hpbGQ7XG5cbiAgICBmdW5jdGlvbiBybShub2RlKSB7XG4gICAgICB2YXIgbmV4dCA9IG5vZGUubmV4dFNpYmxpbmc7XG4gICAgICAvLyBXb3JrcyBhcm91bmQgYSB0aHJvdy1zY3JvbGwgYnVnIGluIE9TIFggV2Via2l0XG4gICAgICBpZiAod2Via2l0ICYmIG1hYyAmJiBjbS5kaXNwbGF5LmN1cnJlbnRXaGVlbFRhcmdldCA9PSBub2RlKVxuICAgICAgICBub2RlLnN0eWxlLmRpc3BsYXkgPSBcIm5vbmVcIjtcbiAgICAgIGVsc2VcbiAgICAgICAgbm9kZS5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKG5vZGUpO1xuICAgICAgcmV0dXJuIG5leHQ7XG4gICAgfVxuXG4gICAgdmFyIHZpZXcgPSBkaXNwbGF5LnZpZXcsIGxpbmVOID0gZGlzcGxheS52aWV3RnJvbTtcbiAgICAvLyBMb29wIG92ZXIgdGhlIGVsZW1lbnRzIGluIHRoZSB2aWV3LCBzeW5jaW5nIGN1ciAodGhlIERPTSBub2Rlc1xuICAgIC8vIGluIGRpc3BsYXkubGluZURpdikgd2l0aCB0aGUgdmlldyBhcyB3ZSBnby5cbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHZpZXcubGVuZ3RoOyBpKyspIHtcbiAgICAgIHZhciBsaW5lVmlldyA9IHZpZXdbaV07XG4gICAgICBpZiAobGluZVZpZXcuaGlkZGVuKSB7XG4gICAgICB9IGVsc2UgaWYgKCFsaW5lVmlldy5ub2RlIHx8IGxpbmVWaWV3Lm5vZGUucGFyZW50Tm9kZSAhPSBjb250YWluZXIpIHsgLy8gTm90IGRyYXduIHlldFxuICAgICAgICB2YXIgbm9kZSA9IGJ1aWxkTGluZUVsZW1lbnQoY20sIGxpbmVWaWV3LCBsaW5lTiwgZGltcyk7XG4gICAgICAgIGNvbnRhaW5lci5pbnNlcnRCZWZvcmUobm9kZSwgY3VyKTtcbiAgICAgIH0gZWxzZSB7IC8vIEFscmVhZHkgZHJhd25cbiAgICAgICAgd2hpbGUgKGN1ciAhPSBsaW5lVmlldy5ub2RlKSBjdXIgPSBybShjdXIpO1xuICAgICAgICB2YXIgdXBkYXRlTnVtYmVyID0gbGluZU51bWJlcnMgJiYgdXBkYXRlTnVtYmVyc0Zyb20gIT0gbnVsbCAmJlxuICAgICAgICAgIHVwZGF0ZU51bWJlcnNGcm9tIDw9IGxpbmVOICYmIGxpbmVWaWV3LmxpbmVOdW1iZXI7XG4gICAgICAgIGlmIChsaW5lVmlldy5jaGFuZ2VzKSB7XG4gICAgICAgICAgaWYgKGluZGV4T2YobGluZVZpZXcuY2hhbmdlcywgXCJndXR0ZXJcIikgPiAtMSkgdXBkYXRlTnVtYmVyID0gZmFsc2U7XG4gICAgICAgICAgdXBkYXRlTGluZUZvckNoYW5nZXMoY20sIGxpbmVWaWV3LCBsaW5lTiwgZGltcyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHVwZGF0ZU51bWJlcikge1xuICAgICAgICAgIHJlbW92ZUNoaWxkcmVuKGxpbmVWaWV3LmxpbmVOdW1iZXIpO1xuICAgICAgICAgIGxpbmVWaWV3LmxpbmVOdW1iZXIuYXBwZW5kQ2hpbGQoZG9jdW1lbnQuY3JlYXRlVGV4dE5vZGUobGluZU51bWJlckZvcihjbS5vcHRpb25zLCBsaW5lTikpKTtcbiAgICAgICAgfVxuICAgICAgICBjdXIgPSBsaW5lVmlldy5ub2RlLm5leHRTaWJsaW5nO1xuICAgICAgfVxuICAgICAgbGluZU4gKz0gbGluZVZpZXcuc2l6ZTtcbiAgICB9XG4gICAgd2hpbGUgKGN1cikgY3VyID0gcm0oY3VyKTtcbiAgfVxuXG4gIC8vIFdoZW4gYW4gYXNwZWN0IG9mIGEgbGluZSBjaGFuZ2VzLCBhIHN0cmluZyBpcyBhZGRlZCB0b1xuICAvLyBsaW5lVmlldy5jaGFuZ2VzLiBUaGlzIHVwZGF0ZXMgdGhlIHJlbGV2YW50IHBhcnQgb2YgdGhlIGxpbmUnc1xuICAvLyBET00gc3RydWN0dXJlLlxuICBmdW5jdGlvbiB1cGRhdGVMaW5lRm9yQ2hhbmdlcyhjbSwgbGluZVZpZXcsIGxpbmVOLCBkaW1zKSB7XG4gICAgZm9yICh2YXIgaiA9IDA7IGogPCBsaW5lVmlldy5jaGFuZ2VzLmxlbmd0aDsgaisrKSB7XG4gICAgICB2YXIgdHlwZSA9IGxpbmVWaWV3LmNoYW5nZXNbal07XG4gICAgICBpZiAodHlwZSA9PSBcInRleHRcIikgdXBkYXRlTGluZVRleHQoY20sIGxpbmVWaWV3KTtcbiAgICAgIGVsc2UgaWYgKHR5cGUgPT0gXCJndXR0ZXJcIikgdXBkYXRlTGluZUd1dHRlcihjbSwgbGluZVZpZXcsIGxpbmVOLCBkaW1zKTtcbiAgICAgIGVsc2UgaWYgKHR5cGUgPT0gXCJjbGFzc1wiKSB1cGRhdGVMaW5lQ2xhc3NlcyhsaW5lVmlldyk7XG4gICAgICBlbHNlIGlmICh0eXBlID09IFwid2lkZ2V0XCIpIHVwZGF0ZUxpbmVXaWRnZXRzKGNtLCBsaW5lVmlldywgZGltcyk7XG4gICAgfVxuICAgIGxpbmVWaWV3LmNoYW5nZXMgPSBudWxsO1xuICB9XG5cbiAgLy8gTGluZXMgd2l0aCBndXR0ZXIgZWxlbWVudHMsIHdpZGdldHMgb3IgYSBiYWNrZ3JvdW5kIGNsYXNzIG5lZWQgdG9cbiAgLy8gYmUgd3JhcHBlZCwgYW5kIGhhdmUgdGhlIGV4dHJhIGVsZW1lbnRzIGFkZGVkIHRvIHRoZSB3cmFwcGVyIGRpdlxuICBmdW5jdGlvbiBlbnN1cmVMaW5lV3JhcHBlZChsaW5lVmlldykge1xuICAgIGlmIChsaW5lVmlldy5ub2RlID09IGxpbmVWaWV3LnRleHQpIHtcbiAgICAgIGxpbmVWaWV3Lm5vZGUgPSBlbHQoXCJkaXZcIiwgbnVsbCwgbnVsbCwgXCJwb3NpdGlvbjogcmVsYXRpdmVcIik7XG4gICAgICBpZiAobGluZVZpZXcudGV4dC5wYXJlbnROb2RlKVxuICAgICAgICBsaW5lVmlldy50ZXh0LnBhcmVudE5vZGUucmVwbGFjZUNoaWxkKGxpbmVWaWV3Lm5vZGUsIGxpbmVWaWV3LnRleHQpO1xuICAgICAgbGluZVZpZXcubm9kZS5hcHBlbmRDaGlsZChsaW5lVmlldy50ZXh0KTtcbiAgICAgIGlmIChpZSAmJiBpZV92ZXJzaW9uIDwgOCkgbGluZVZpZXcubm9kZS5zdHlsZS56SW5kZXggPSAyO1xuICAgIH1cbiAgICByZXR1cm4gbGluZVZpZXcubm9kZTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHVwZGF0ZUxpbmVCYWNrZ3JvdW5kKGxpbmVWaWV3KSB7XG4gICAgdmFyIGNscyA9IGxpbmVWaWV3LmJnQ2xhc3MgPyBsaW5lVmlldy5iZ0NsYXNzICsgXCIgXCIgKyAobGluZVZpZXcubGluZS5iZ0NsYXNzIHx8IFwiXCIpIDogbGluZVZpZXcubGluZS5iZ0NsYXNzO1xuICAgIGlmIChjbHMpIGNscyArPSBcIiBDb2RlTWlycm9yLWxpbmViYWNrZ3JvdW5kXCI7XG4gICAgaWYgKGxpbmVWaWV3LmJhY2tncm91bmQpIHtcbiAgICAgIGlmIChjbHMpIGxpbmVWaWV3LmJhY2tncm91bmQuY2xhc3NOYW1lID0gY2xzO1xuICAgICAgZWxzZSB7IGxpbmVWaWV3LmJhY2tncm91bmQucGFyZW50Tm9kZS5yZW1vdmVDaGlsZChsaW5lVmlldy5iYWNrZ3JvdW5kKTsgbGluZVZpZXcuYmFja2dyb3VuZCA9IG51bGw7IH1cbiAgICB9IGVsc2UgaWYgKGNscykge1xuICAgICAgdmFyIHdyYXAgPSBlbnN1cmVMaW5lV3JhcHBlZChsaW5lVmlldyk7XG4gICAgICBsaW5lVmlldy5iYWNrZ3JvdW5kID0gd3JhcC5pbnNlcnRCZWZvcmUoZWx0KFwiZGl2XCIsIG51bGwsIGNscyksIHdyYXAuZmlyc3RDaGlsZCk7XG4gICAgfVxuICB9XG5cbiAgLy8gV3JhcHBlciBhcm91bmQgYnVpbGRMaW5lQ29udGVudCB3aGljaCB3aWxsIHJldXNlIHRoZSBzdHJ1Y3R1cmVcbiAgLy8gaW4gZGlzcGxheS5leHRlcm5hbE1lYXN1cmVkIHdoZW4gcG9zc2libGUuXG4gIGZ1bmN0aW9uIGdldExpbmVDb250ZW50KGNtLCBsaW5lVmlldykge1xuICAgIHZhciBleHQgPSBjbS5kaXNwbGF5LmV4dGVybmFsTWVhc3VyZWQ7XG4gICAgaWYgKGV4dCAmJiBleHQubGluZSA9PSBsaW5lVmlldy5saW5lKSB7XG4gICAgICBjbS5kaXNwbGF5LmV4dGVybmFsTWVhc3VyZWQgPSBudWxsO1xuICAgICAgbGluZVZpZXcubWVhc3VyZSA9IGV4dC5tZWFzdXJlO1xuICAgICAgcmV0dXJuIGV4dC5idWlsdDtcbiAgICB9XG4gICAgcmV0dXJuIGJ1aWxkTGluZUNvbnRlbnQoY20sIGxpbmVWaWV3KTtcbiAgfVxuXG4gIC8vIFJlZHJhdyB0aGUgbGluZSdzIHRleHQuIEludGVyYWN0cyB3aXRoIHRoZSBiYWNrZ3JvdW5kIGFuZCB0ZXh0XG4gIC8vIGNsYXNzZXMgYmVjYXVzZSB0aGUgbW9kZSBtYXkgb3V0cHV0IHRva2VucyB0aGF0IGluZmx1ZW5jZSB0aGVzZVxuICAvLyBjbGFzc2VzLlxuICBmdW5jdGlvbiB1cGRhdGVMaW5lVGV4dChjbSwgbGluZVZpZXcpIHtcbiAgICB2YXIgY2xzID0gbGluZVZpZXcudGV4dC5jbGFzc05hbWU7XG4gICAgdmFyIGJ1aWx0ID0gZ2V0TGluZUNvbnRlbnQoY20sIGxpbmVWaWV3KTtcbiAgICBpZiAobGluZVZpZXcudGV4dCA9PSBsaW5lVmlldy5ub2RlKSBsaW5lVmlldy5ub2RlID0gYnVpbHQucHJlO1xuICAgIGxpbmVWaWV3LnRleHQucGFyZW50Tm9kZS5yZXBsYWNlQ2hpbGQoYnVpbHQucHJlLCBsaW5lVmlldy50ZXh0KTtcbiAgICBsaW5lVmlldy50ZXh0ID0gYnVpbHQucHJlO1xuICAgIGlmIChidWlsdC5iZ0NsYXNzICE9IGxpbmVWaWV3LmJnQ2xhc3MgfHwgYnVpbHQudGV4dENsYXNzICE9IGxpbmVWaWV3LnRleHRDbGFzcykge1xuICAgICAgbGluZVZpZXcuYmdDbGFzcyA9IGJ1aWx0LmJnQ2xhc3M7XG4gICAgICBsaW5lVmlldy50ZXh0Q2xhc3MgPSBidWlsdC50ZXh0Q2xhc3M7XG4gICAgICB1cGRhdGVMaW5lQ2xhc3NlcyhsaW5lVmlldyk7XG4gICAgfSBlbHNlIGlmIChjbHMpIHtcbiAgICAgIGxpbmVWaWV3LnRleHQuY2xhc3NOYW1lID0gY2xzO1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIHVwZGF0ZUxpbmVDbGFzc2VzKGxpbmVWaWV3KSB7XG4gICAgdXBkYXRlTGluZUJhY2tncm91bmQobGluZVZpZXcpO1xuICAgIGlmIChsaW5lVmlldy5saW5lLndyYXBDbGFzcylcbiAgICAgIGVuc3VyZUxpbmVXcmFwcGVkKGxpbmVWaWV3KS5jbGFzc05hbWUgPSBsaW5lVmlldy5saW5lLndyYXBDbGFzcztcbiAgICBlbHNlIGlmIChsaW5lVmlldy5ub2RlICE9IGxpbmVWaWV3LnRleHQpXG4gICAgICBsaW5lVmlldy5ub2RlLmNsYXNzTmFtZSA9IFwiXCI7XG4gICAgdmFyIHRleHRDbGFzcyA9IGxpbmVWaWV3LnRleHRDbGFzcyA/IGxpbmVWaWV3LnRleHRDbGFzcyArIFwiIFwiICsgKGxpbmVWaWV3LmxpbmUudGV4dENsYXNzIHx8IFwiXCIpIDogbGluZVZpZXcubGluZS50ZXh0Q2xhc3M7XG4gICAgbGluZVZpZXcudGV4dC5jbGFzc05hbWUgPSB0ZXh0Q2xhc3MgfHwgXCJcIjtcbiAgfVxuXG4gIGZ1bmN0aW9uIHVwZGF0ZUxpbmVHdXR0ZXIoY20sIGxpbmVWaWV3LCBsaW5lTiwgZGltcykge1xuICAgIGlmIChsaW5lVmlldy5ndXR0ZXIpIHtcbiAgICAgIGxpbmVWaWV3Lm5vZGUucmVtb3ZlQ2hpbGQobGluZVZpZXcuZ3V0dGVyKTtcbiAgICAgIGxpbmVWaWV3Lmd1dHRlciA9IG51bGw7XG4gICAgfVxuICAgIHZhciBtYXJrZXJzID0gbGluZVZpZXcubGluZS5ndXR0ZXJNYXJrZXJzO1xuICAgIGlmIChjbS5vcHRpb25zLmxpbmVOdW1iZXJzIHx8IG1hcmtlcnMpIHtcbiAgICAgIHZhciB3cmFwID0gZW5zdXJlTGluZVdyYXBwZWQobGluZVZpZXcpO1xuICAgICAgdmFyIGd1dHRlcldyYXAgPSBsaW5lVmlldy5ndXR0ZXIgPSBlbHQoXCJkaXZcIiwgbnVsbCwgXCJDb2RlTWlycm9yLWd1dHRlci13cmFwcGVyXCIsIFwibGVmdDogXCIgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKGNtLm9wdGlvbnMuZml4ZWRHdXR0ZXIgPyBkaW1zLmZpeGVkUG9zIDogLWRpbXMuZ3V0dGVyVG90YWxXaWR0aCkgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXCJweDsgd2lkdGg6IFwiICsgZGltcy5ndXR0ZXJUb3RhbFdpZHRoICsgXCJweFwiKTtcbiAgICAgIGNtLmRpc3BsYXkuaW5wdXQuc2V0VW5lZGl0YWJsZShndXR0ZXJXcmFwKTtcbiAgICAgIHdyYXAuaW5zZXJ0QmVmb3JlKGd1dHRlcldyYXAsIGxpbmVWaWV3LnRleHQpO1xuICAgICAgaWYgKGxpbmVWaWV3LmxpbmUuZ3V0dGVyQ2xhc3MpXG4gICAgICAgIGd1dHRlcldyYXAuY2xhc3NOYW1lICs9IFwiIFwiICsgbGluZVZpZXcubGluZS5ndXR0ZXJDbGFzcztcbiAgICAgIGlmIChjbS5vcHRpb25zLmxpbmVOdW1iZXJzICYmICghbWFya2VycyB8fCAhbWFya2Vyc1tcIkNvZGVNaXJyb3ItbGluZW51bWJlcnNcIl0pKVxuICAgICAgICBsaW5lVmlldy5saW5lTnVtYmVyID0gZ3V0dGVyV3JhcC5hcHBlbmRDaGlsZChcbiAgICAgICAgICBlbHQoXCJkaXZcIiwgbGluZU51bWJlckZvcihjbS5vcHRpb25zLCBsaW5lTiksXG4gICAgICAgICAgICAgIFwiQ29kZU1pcnJvci1saW5lbnVtYmVyIENvZGVNaXJyb3ItZ3V0dGVyLWVsdFwiLFxuICAgICAgICAgICAgICBcImxlZnQ6IFwiICsgZGltcy5ndXR0ZXJMZWZ0W1wiQ29kZU1pcnJvci1saW5lbnVtYmVyc1wiXSArIFwicHg7IHdpZHRoOiBcIlxuICAgICAgICAgICAgICArIGNtLmRpc3BsYXkubGluZU51bUlubmVyV2lkdGggKyBcInB4XCIpKTtcbiAgICAgIGlmIChtYXJrZXJzKSBmb3IgKHZhciBrID0gMDsgayA8IGNtLm9wdGlvbnMuZ3V0dGVycy5sZW5ndGg7ICsraykge1xuICAgICAgICB2YXIgaWQgPSBjbS5vcHRpb25zLmd1dHRlcnNba10sIGZvdW5kID0gbWFya2Vycy5oYXNPd25Qcm9wZXJ0eShpZCkgJiYgbWFya2Vyc1tpZF07XG4gICAgICAgIGlmIChmb3VuZClcbiAgICAgICAgICBndXR0ZXJXcmFwLmFwcGVuZENoaWxkKGVsdChcImRpdlwiLCBbZm91bmRdLCBcIkNvZGVNaXJyb3ItZ3V0dGVyLWVsdFwiLCBcImxlZnQ6IFwiICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBkaW1zLmd1dHRlckxlZnRbaWRdICsgXCJweDsgd2lkdGg6IFwiICsgZGltcy5ndXR0ZXJXaWR0aFtpZF0gKyBcInB4XCIpKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiB1cGRhdGVMaW5lV2lkZ2V0cyhjbSwgbGluZVZpZXcsIGRpbXMpIHtcbiAgICBpZiAobGluZVZpZXcuYWxpZ25hYmxlKSBsaW5lVmlldy5hbGlnbmFibGUgPSBudWxsO1xuICAgIGZvciAodmFyIG5vZGUgPSBsaW5lVmlldy5ub2RlLmZpcnN0Q2hpbGQsIG5leHQ7IG5vZGU7IG5vZGUgPSBuZXh0KSB7XG4gICAgICB2YXIgbmV4dCA9IG5vZGUubmV4dFNpYmxpbmc7XG4gICAgICBpZiAobm9kZS5jbGFzc05hbWUgPT0gXCJDb2RlTWlycm9yLWxpbmV3aWRnZXRcIilcbiAgICAgICAgbGluZVZpZXcubm9kZS5yZW1vdmVDaGlsZChub2RlKTtcbiAgICB9XG4gICAgaW5zZXJ0TGluZVdpZGdldHMoY20sIGxpbmVWaWV3LCBkaW1zKTtcbiAgfVxuXG4gIC8vIEJ1aWxkIGEgbGluZSdzIERPTSByZXByZXNlbnRhdGlvbiBmcm9tIHNjcmF0Y2hcbiAgZnVuY3Rpb24gYnVpbGRMaW5lRWxlbWVudChjbSwgbGluZVZpZXcsIGxpbmVOLCBkaW1zKSB7XG4gICAgdmFyIGJ1aWx0ID0gZ2V0TGluZUNvbnRlbnQoY20sIGxpbmVWaWV3KTtcbiAgICBsaW5lVmlldy50ZXh0ID0gbGluZVZpZXcubm9kZSA9IGJ1aWx0LnByZTtcbiAgICBpZiAoYnVpbHQuYmdDbGFzcykgbGluZVZpZXcuYmdDbGFzcyA9IGJ1aWx0LmJnQ2xhc3M7XG4gICAgaWYgKGJ1aWx0LnRleHRDbGFzcykgbGluZVZpZXcudGV4dENsYXNzID0gYnVpbHQudGV4dENsYXNzO1xuXG4gICAgdXBkYXRlTGluZUNsYXNzZXMobGluZVZpZXcpO1xuICAgIHVwZGF0ZUxpbmVHdXR0ZXIoY20sIGxpbmVWaWV3LCBsaW5lTiwgZGltcyk7XG4gICAgaW5zZXJ0TGluZVdpZGdldHMoY20sIGxpbmVWaWV3LCBkaW1zKTtcbiAgICByZXR1cm4gbGluZVZpZXcubm9kZTtcbiAgfVxuXG4gIC8vIEEgbGluZVZpZXcgbWF5IGNvbnRhaW4gbXVsdGlwbGUgbG9naWNhbCBsaW5lcyAod2hlbiBtZXJnZWQgYnlcbiAgLy8gY29sbGFwc2VkIHNwYW5zKS4gVGhlIHdpZGdldHMgZm9yIGFsbCBvZiB0aGVtIG5lZWQgdG8gYmUgZHJhd24uXG4gIGZ1bmN0aW9uIGluc2VydExpbmVXaWRnZXRzKGNtLCBsaW5lVmlldywgZGltcykge1xuICAgIGluc2VydExpbmVXaWRnZXRzRm9yKGNtLCBsaW5lVmlldy5saW5lLCBsaW5lVmlldywgZGltcywgdHJ1ZSk7XG4gICAgaWYgKGxpbmVWaWV3LnJlc3QpIGZvciAodmFyIGkgPSAwOyBpIDwgbGluZVZpZXcucmVzdC5sZW5ndGg7IGkrKylcbiAgICAgIGluc2VydExpbmVXaWRnZXRzRm9yKGNtLCBsaW5lVmlldy5yZXN0W2ldLCBsaW5lVmlldywgZGltcywgZmFsc2UpO1xuICB9XG5cbiAgZnVuY3Rpb24gaW5zZXJ0TGluZVdpZGdldHNGb3IoY20sIGxpbmUsIGxpbmVWaWV3LCBkaW1zLCBhbGxvd0Fib3ZlKSB7XG4gICAgaWYgKCFsaW5lLndpZGdldHMpIHJldHVybjtcbiAgICB2YXIgd3JhcCA9IGVuc3VyZUxpbmVXcmFwcGVkKGxpbmVWaWV3KTtcbiAgICBmb3IgKHZhciBpID0gMCwgd3MgPSBsaW5lLndpZGdldHM7IGkgPCB3cy5sZW5ndGg7ICsraSkge1xuICAgICAgdmFyIHdpZGdldCA9IHdzW2ldLCBub2RlID0gZWx0KFwiZGl2XCIsIFt3aWRnZXQubm9kZV0sIFwiQ29kZU1pcnJvci1saW5ld2lkZ2V0XCIpO1xuICAgICAgaWYgKCF3aWRnZXQuaGFuZGxlTW91c2VFdmVudHMpIG5vZGUuc2V0QXR0cmlidXRlKFwiY20taWdub3JlLWV2ZW50c1wiLCBcInRydWVcIik7XG4gICAgICBwb3NpdGlvbkxpbmVXaWRnZXQod2lkZ2V0LCBub2RlLCBsaW5lVmlldywgZGltcyk7XG4gICAgICBjbS5kaXNwbGF5LmlucHV0LnNldFVuZWRpdGFibGUobm9kZSk7XG4gICAgICBpZiAoYWxsb3dBYm92ZSAmJiB3aWRnZXQuYWJvdmUpXG4gICAgICAgIHdyYXAuaW5zZXJ0QmVmb3JlKG5vZGUsIGxpbmVWaWV3Lmd1dHRlciB8fCBsaW5lVmlldy50ZXh0KTtcbiAgICAgIGVsc2VcbiAgICAgICAgd3JhcC5hcHBlbmRDaGlsZChub2RlKTtcbiAgICAgIHNpZ25hbExhdGVyKHdpZGdldCwgXCJyZWRyYXdcIik7XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gcG9zaXRpb25MaW5lV2lkZ2V0KHdpZGdldCwgbm9kZSwgbGluZVZpZXcsIGRpbXMpIHtcbiAgICBpZiAod2lkZ2V0Lm5vSFNjcm9sbCkge1xuICAgICAgKGxpbmVWaWV3LmFsaWduYWJsZSB8fCAobGluZVZpZXcuYWxpZ25hYmxlID0gW10pKS5wdXNoKG5vZGUpO1xuICAgICAgdmFyIHdpZHRoID0gZGltcy53cmFwcGVyV2lkdGg7XG4gICAgICBub2RlLnN0eWxlLmxlZnQgPSBkaW1zLmZpeGVkUG9zICsgXCJweFwiO1xuICAgICAgaWYgKCF3aWRnZXQuY292ZXJHdXR0ZXIpIHtcbiAgICAgICAgd2lkdGggLT0gZGltcy5ndXR0ZXJUb3RhbFdpZHRoO1xuICAgICAgICBub2RlLnN0eWxlLnBhZGRpbmdMZWZ0ID0gZGltcy5ndXR0ZXJUb3RhbFdpZHRoICsgXCJweFwiO1xuICAgICAgfVxuICAgICAgbm9kZS5zdHlsZS53aWR0aCA9IHdpZHRoICsgXCJweFwiO1xuICAgIH1cbiAgICBpZiAod2lkZ2V0LmNvdmVyR3V0dGVyKSB7XG4gICAgICBub2RlLnN0eWxlLnpJbmRleCA9IDU7XG4gICAgICBub2RlLnN0eWxlLnBvc2l0aW9uID0gXCJyZWxhdGl2ZVwiO1xuICAgICAgaWYgKCF3aWRnZXQubm9IU2Nyb2xsKSBub2RlLnN0eWxlLm1hcmdpbkxlZnQgPSAtZGltcy5ndXR0ZXJUb3RhbFdpZHRoICsgXCJweFwiO1xuICAgIH1cbiAgfVxuXG4gIC8vIFBPU0lUSU9OIE9CSkVDVFxuXG4gIC8vIEEgUG9zIGluc3RhbmNlIHJlcHJlc2VudHMgYSBwb3NpdGlvbiB3aXRoaW4gdGhlIHRleHQuXG4gIHZhciBQb3MgPSBDb2RlTWlycm9yLlBvcyA9IGZ1bmN0aW9uKGxpbmUsIGNoKSB7XG4gICAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIFBvcykpIHJldHVybiBuZXcgUG9zKGxpbmUsIGNoKTtcbiAgICB0aGlzLmxpbmUgPSBsaW5lOyB0aGlzLmNoID0gY2g7XG4gIH07XG5cbiAgLy8gQ29tcGFyZSB0d28gcG9zaXRpb25zLCByZXR1cm4gMCBpZiB0aGV5IGFyZSB0aGUgc2FtZSwgYSBuZWdhdGl2ZVxuICAvLyBudW1iZXIgd2hlbiBhIGlzIGxlc3MsIGFuZCBhIHBvc2l0aXZlIG51bWJlciBvdGhlcndpc2UuXG4gIHZhciBjbXAgPSBDb2RlTWlycm9yLmNtcFBvcyA9IGZ1bmN0aW9uKGEsIGIpIHsgcmV0dXJuIGEubGluZSAtIGIubGluZSB8fCBhLmNoIC0gYi5jaDsgfTtcblxuICBmdW5jdGlvbiBjb3B5UG9zKHgpIHtyZXR1cm4gUG9zKHgubGluZSwgeC5jaCk7fVxuICBmdW5jdGlvbiBtYXhQb3MoYSwgYikgeyByZXR1cm4gY21wKGEsIGIpIDwgMCA/IGIgOiBhOyB9XG4gIGZ1bmN0aW9uIG1pblBvcyhhLCBiKSB7IHJldHVybiBjbXAoYSwgYikgPCAwID8gYSA6IGI7IH1cblxuICAvLyBJTlBVVCBIQU5ETElOR1xuXG4gIGZ1bmN0aW9uIGVuc3VyZUZvY3VzKGNtKSB7XG4gICAgaWYgKCFjbS5zdGF0ZS5mb2N1c2VkKSB7IGNtLmRpc3BsYXkuaW5wdXQuZm9jdXMoKTsgb25Gb2N1cyhjbSk7IH1cbiAgfVxuXG4gIGZ1bmN0aW9uIGlzUmVhZE9ubHkoY20pIHtcbiAgICByZXR1cm4gY20ub3B0aW9ucy5yZWFkT25seSB8fCBjbS5kb2MuY2FudEVkaXQ7XG4gIH1cblxuICAvLyBUaGlzIHdpbGwgYmUgc2V0IHRvIGFuIGFycmF5IG9mIHN0cmluZ3Mgd2hlbiBjb3B5aW5nLCBzbyB0aGF0LFxuICAvLyB3aGVuIHBhc3RpbmcsIHdlIGtub3cgd2hhdCBraW5kIG9mIHNlbGVjdGlvbnMgdGhlIGNvcGllZCB0ZXh0XG4gIC8vIHdhcyBtYWRlIG91dCBvZi5cbiAgdmFyIGxhc3RDb3BpZWQgPSBudWxsO1xuXG4gIGZ1bmN0aW9uIGFwcGx5VGV4dElucHV0KGNtLCBpbnNlcnRlZCwgZGVsZXRlZCwgc2VsLCBvcmlnaW4pIHtcbiAgICB2YXIgZG9jID0gY20uZG9jO1xuICAgIGNtLmRpc3BsYXkuc2hpZnQgPSBmYWxzZTtcbiAgICBpZiAoIXNlbCkgc2VsID0gZG9jLnNlbDtcblxuICAgIHZhciBwYXN0ZSA9IGNtLnN0YXRlLnBhc3RlSW5jb21pbmcgfHwgb3JpZ2luID09IFwicGFzdGVcIjtcbiAgICB2YXIgdGV4dExpbmVzID0gc3BsaXRMaW5lcyhpbnNlcnRlZCksIG11bHRpUGFzdGUgPSBudWxsO1xuICAgIC8vIFdoZW4gcGFzaW5nIE4gbGluZXMgaW50byBOIHNlbGVjdGlvbnMsIGluc2VydCBvbmUgbGluZSBwZXIgc2VsZWN0aW9uXG4gICAgaWYgKHBhc3RlICYmIHNlbC5yYW5nZXMubGVuZ3RoID4gMSkge1xuICAgICAgaWYgKGxhc3RDb3BpZWQgJiYgbGFzdENvcGllZC5qb2luKFwiXFxuXCIpID09IGluc2VydGVkKVxuICAgICAgICBtdWx0aVBhc3RlID0gc2VsLnJhbmdlcy5sZW5ndGggJSBsYXN0Q29waWVkLmxlbmd0aCA9PSAwICYmIG1hcChsYXN0Q29waWVkLCBzcGxpdExpbmVzKTtcbiAgICAgIGVsc2UgaWYgKHRleHRMaW5lcy5sZW5ndGggPT0gc2VsLnJhbmdlcy5sZW5ndGgpXG4gICAgICAgIG11bHRpUGFzdGUgPSBtYXAodGV4dExpbmVzLCBmdW5jdGlvbihsKSB7IHJldHVybiBbbF07IH0pO1xuICAgIH1cblxuICAgIC8vIE5vcm1hbCBiZWhhdmlvciBpcyB0byBpbnNlcnQgdGhlIG5ldyB0ZXh0IGludG8gZXZlcnkgc2VsZWN0aW9uXG4gICAgZm9yICh2YXIgaSA9IHNlbC5yYW5nZXMubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgICAgIHZhciByYW5nZSA9IHNlbC5yYW5nZXNbaV07XG4gICAgICB2YXIgZnJvbSA9IHJhbmdlLmZyb20oKSwgdG8gPSByYW5nZS50bygpO1xuICAgICAgaWYgKHJhbmdlLmVtcHR5KCkpIHtcbiAgICAgICAgaWYgKGRlbGV0ZWQgJiYgZGVsZXRlZCA+IDApIC8vIEhhbmRsZSBkZWxldGlvblxuICAgICAgICAgIGZyb20gPSBQb3MoZnJvbS5saW5lLCBmcm9tLmNoIC0gZGVsZXRlZCk7XG4gICAgICAgIGVsc2UgaWYgKGNtLnN0YXRlLm92ZXJ3cml0ZSAmJiAhcGFzdGUpIC8vIEhhbmRsZSBvdmVyd3JpdGVcbiAgICAgICAgICB0byA9IFBvcyh0by5saW5lLCBNYXRoLm1pbihnZXRMaW5lKGRvYywgdG8ubGluZSkudGV4dC5sZW5ndGgsIHRvLmNoICsgbHN0KHRleHRMaW5lcykubGVuZ3RoKSk7XG4gICAgICB9XG4gICAgICB2YXIgdXBkYXRlSW5wdXQgPSBjbS5jdXJPcC51cGRhdGVJbnB1dDtcbiAgICAgIHZhciBjaGFuZ2VFdmVudCA9IHtmcm9tOiBmcm9tLCB0bzogdG8sIHRleHQ6IG11bHRpUGFzdGUgPyBtdWx0aVBhc3RlW2kgJSBtdWx0aVBhc3RlLmxlbmd0aF0gOiB0ZXh0TGluZXMsXG4gICAgICAgICAgICAgICAgICAgICAgICAgb3JpZ2luOiBvcmlnaW4gfHwgKHBhc3RlID8gXCJwYXN0ZVwiIDogY20uc3RhdGUuY3V0SW5jb21pbmcgPyBcImN1dFwiIDogXCIraW5wdXRcIil9O1xuICAgICAgbWFrZUNoYW5nZShjbS5kb2MsIGNoYW5nZUV2ZW50KTtcbiAgICAgIHNpZ25hbExhdGVyKGNtLCBcImlucHV0UmVhZFwiLCBjbSwgY2hhbmdlRXZlbnQpO1xuICAgIH1cbiAgICBpZiAoaW5zZXJ0ZWQgJiYgIXBhc3RlKVxuICAgICAgdHJpZ2dlckVsZWN0cmljKGNtLCBpbnNlcnRlZCk7XG5cbiAgICBlbnN1cmVDdXJzb3JWaXNpYmxlKGNtKTtcbiAgICBjbS5jdXJPcC51cGRhdGVJbnB1dCA9IHVwZGF0ZUlucHV0O1xuICAgIGNtLmN1ck9wLnR5cGluZyA9IHRydWU7XG4gICAgY20uc3RhdGUucGFzdGVJbmNvbWluZyA9IGNtLnN0YXRlLmN1dEluY29taW5nID0gZmFsc2U7XG4gIH1cblxuICBmdW5jdGlvbiBoYW5kbGVQYXN0ZShlLCBjbSkge1xuICAgIHZhciBwYXN0ZWQgPSBlLmNsaXBib2FyZERhdGEgJiYgZS5jbGlwYm9hcmREYXRhLmdldERhdGEoXCJ0ZXh0L3BsYWluXCIpO1xuICAgIGlmIChwYXN0ZWQpIHtcbiAgICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICAgIHJ1bkluT3AoY20sIGZ1bmN0aW9uKCkgeyBhcHBseVRleHRJbnB1dChjbSwgcGFzdGVkLCAwLCBudWxsLCBcInBhc3RlXCIpOyB9KTtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIHRyaWdnZXJFbGVjdHJpYyhjbSwgaW5zZXJ0ZWQpIHtcbiAgICAvLyBXaGVuIGFuICdlbGVjdHJpYycgY2hhcmFjdGVyIGlzIGluc2VydGVkLCBpbW1lZGlhdGVseSB0cmlnZ2VyIGEgcmVpbmRlbnRcbiAgICBpZiAoIWNtLm9wdGlvbnMuZWxlY3RyaWNDaGFycyB8fCAhY20ub3B0aW9ucy5zbWFydEluZGVudCkgcmV0dXJuO1xuICAgIHZhciBzZWwgPSBjbS5kb2Muc2VsO1xuXG4gICAgZm9yICh2YXIgaSA9IHNlbC5yYW5nZXMubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgICAgIHZhciByYW5nZSA9IHNlbC5yYW5nZXNbaV07XG4gICAgICBpZiAocmFuZ2UuaGVhZC5jaCA+IDEwMCB8fCAoaSAmJiBzZWwucmFuZ2VzW2kgLSAxXS5oZWFkLmxpbmUgPT0gcmFuZ2UuaGVhZC5saW5lKSkgY29udGludWU7XG4gICAgICB2YXIgbW9kZSA9IGNtLmdldE1vZGVBdChyYW5nZS5oZWFkKTtcbiAgICAgIHZhciBpbmRlbnRlZCA9IGZhbHNlO1xuICAgICAgaWYgKG1vZGUuZWxlY3RyaWNDaGFycykge1xuICAgICAgICBmb3IgKHZhciBqID0gMDsgaiA8IG1vZGUuZWxlY3RyaWNDaGFycy5sZW5ndGg7IGorKylcbiAgICAgICAgICBpZiAoaW5zZXJ0ZWQuaW5kZXhPZihtb2RlLmVsZWN0cmljQ2hhcnMuY2hhckF0KGopKSA+IC0xKSB7XG4gICAgICAgICAgICBpbmRlbnRlZCA9IGluZGVudExpbmUoY20sIHJhbmdlLmhlYWQubGluZSwgXCJzbWFydFwiKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAobW9kZS5lbGVjdHJpY0lucHV0KSB7XG4gICAgICAgIGlmIChtb2RlLmVsZWN0cmljSW5wdXQudGVzdChnZXRMaW5lKGNtLmRvYywgcmFuZ2UuaGVhZC5saW5lKS50ZXh0LnNsaWNlKDAsIHJhbmdlLmhlYWQuY2gpKSlcbiAgICAgICAgICBpbmRlbnRlZCA9IGluZGVudExpbmUoY20sIHJhbmdlLmhlYWQubGluZSwgXCJzbWFydFwiKTtcbiAgICAgIH1cbiAgICAgIGlmIChpbmRlbnRlZCkgc2lnbmFsTGF0ZXIoY20sIFwiZWxlY3RyaWNJbnB1dFwiLCBjbSwgcmFuZ2UuaGVhZC5saW5lKTtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBjb3B5YWJsZVJhbmdlcyhjbSkge1xuICAgIHZhciB0ZXh0ID0gW10sIHJhbmdlcyA9IFtdO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgY20uZG9jLnNlbC5yYW5nZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgIHZhciBsaW5lID0gY20uZG9jLnNlbC5yYW5nZXNbaV0uaGVhZC5saW5lO1xuICAgICAgdmFyIGxpbmVSYW5nZSA9IHthbmNob3I6IFBvcyhsaW5lLCAwKSwgaGVhZDogUG9zKGxpbmUgKyAxLCAwKX07XG4gICAgICByYW5nZXMucHVzaChsaW5lUmFuZ2UpO1xuICAgICAgdGV4dC5wdXNoKGNtLmdldFJhbmdlKGxpbmVSYW5nZS5hbmNob3IsIGxpbmVSYW5nZS5oZWFkKSk7XG4gICAgfVxuICAgIHJldHVybiB7dGV4dDogdGV4dCwgcmFuZ2VzOiByYW5nZXN9O1xuICB9XG5cbiAgZnVuY3Rpb24gZGlzYWJsZUJyb3dzZXJNYWdpYyhmaWVsZCkge1xuICAgIGZpZWxkLnNldEF0dHJpYnV0ZShcImF1dG9jb3JyZWN0XCIsIFwib2ZmXCIpO1xuICAgIGZpZWxkLnNldEF0dHJpYnV0ZShcImF1dG9jYXBpdGFsaXplXCIsIFwib2ZmXCIpO1xuICAgIGZpZWxkLnNldEF0dHJpYnV0ZShcInNwZWxsY2hlY2tcIiwgXCJmYWxzZVwiKTtcbiAgfVxuXG4gIC8vIFRFWFRBUkVBIElOUFVUIFNUWUxFXG5cbiAgZnVuY3Rpb24gVGV4dGFyZWFJbnB1dChjbSkge1xuICAgIHRoaXMuY20gPSBjbTtcbiAgICAvLyBTZWUgaW5wdXQucG9sbCBhbmQgaW5wdXQucmVzZXRcbiAgICB0aGlzLnByZXZJbnB1dCA9IFwiXCI7XG5cbiAgICAvLyBGbGFnIHRoYXQgaW5kaWNhdGVzIHdoZXRoZXIgd2UgZXhwZWN0IGlucHV0IHRvIGFwcGVhciByZWFsIHNvb25cbiAgICAvLyBub3cgKGFmdGVyIHNvbWUgZXZlbnQgbGlrZSAna2V5cHJlc3MnIG9yICdpbnB1dCcpIGFuZCBhcmVcbiAgICAvLyBwb2xsaW5nIGludGVuc2l2ZWx5LlxuICAgIHRoaXMucG9sbGluZ0Zhc3QgPSBmYWxzZTtcbiAgICAvLyBTZWxmLXJlc2V0dGluZyB0aW1lb3V0IGZvciB0aGUgcG9sbGVyXG4gICAgdGhpcy5wb2xsaW5nID0gbmV3IERlbGF5ZWQoKTtcbiAgICAvLyBUcmFja3Mgd2hlbiBpbnB1dC5yZXNldCBoYXMgcHVudGVkIHRvIGp1c3QgcHV0dGluZyBhIHNob3J0XG4gICAgLy8gc3RyaW5nIGludG8gdGhlIHRleHRhcmVhIGluc3RlYWQgb2YgdGhlIGZ1bGwgc2VsZWN0aW9uLlxuICAgIHRoaXMuaW5hY2N1cmF0ZVNlbGVjdGlvbiA9IGZhbHNlO1xuICAgIC8vIFVzZWQgdG8gd29yayBhcm91bmQgSUUgaXNzdWUgd2l0aCBzZWxlY3Rpb24gYmVpbmcgZm9yZ290dGVuIHdoZW4gZm9jdXMgbW92ZXMgYXdheSBmcm9tIHRleHRhcmVhXG4gICAgdGhpcy5oYXNTZWxlY3Rpb24gPSBmYWxzZTtcbiAgICB0aGlzLmNvbXBvc2luZyA9IG51bGw7XG4gIH07XG5cbiAgZnVuY3Rpb24gaGlkZGVuVGV4dGFyZWEoKSB7XG4gICAgdmFyIHRlID0gZWx0KFwidGV4dGFyZWFcIiwgbnVsbCwgbnVsbCwgXCJwb3NpdGlvbjogYWJzb2x1dGU7IHBhZGRpbmc6IDA7IHdpZHRoOiAxcHg7IGhlaWdodDogMWVtOyBvdXRsaW5lOiBub25lXCIpO1xuICAgIHZhciBkaXYgPSBlbHQoXCJkaXZcIiwgW3RlXSwgbnVsbCwgXCJvdmVyZmxvdzogaGlkZGVuOyBwb3NpdGlvbjogcmVsYXRpdmU7IHdpZHRoOiAzcHg7IGhlaWdodDogMHB4O1wiKTtcbiAgICAvLyBUaGUgdGV4dGFyZWEgaXMga2VwdCBwb3NpdGlvbmVkIG5lYXIgdGhlIGN1cnNvciB0byBwcmV2ZW50IHRoZVxuICAgIC8vIGZhY3QgdGhhdCBpdCdsbCBiZSBzY3JvbGxlZCBpbnRvIHZpZXcgb24gaW5wdXQgZnJvbSBzY3JvbGxpbmdcbiAgICAvLyBvdXIgZmFrZSBjdXJzb3Igb3V0IG9mIHZpZXcuIE9uIHdlYmtpdCwgd2hlbiB3cmFwPW9mZiwgcGFzdGUgaXNcbiAgICAvLyB2ZXJ5IHNsb3cuIFNvIG1ha2UgdGhlIGFyZWEgd2lkZSBpbnN0ZWFkLlxuICAgIGlmICh3ZWJraXQpIHRlLnN0eWxlLndpZHRoID0gXCIxMDAwcHhcIjtcbiAgICBlbHNlIHRlLnNldEF0dHJpYnV0ZShcIndyYXBcIiwgXCJvZmZcIik7XG4gICAgLy8gSWYgYm9yZGVyOiAwOyAtLSBpT1MgZmFpbHMgdG8gb3BlbiBrZXlib2FyZCAoaXNzdWUgIzEyODcpXG4gICAgaWYgKGlvcykgdGUuc3R5bGUuYm9yZGVyID0gXCIxcHggc29saWQgYmxhY2tcIjtcbiAgICBkaXNhYmxlQnJvd3Nlck1hZ2ljKHRlKTtcbiAgICByZXR1cm4gZGl2O1xuICB9XG5cbiAgVGV4dGFyZWFJbnB1dC5wcm90b3R5cGUgPSBjb3B5T2JqKHtcbiAgICBpbml0OiBmdW5jdGlvbihkaXNwbGF5KSB7XG4gICAgICB2YXIgaW5wdXQgPSB0aGlzLCBjbSA9IHRoaXMuY207XG5cbiAgICAgIC8vIFdyYXBzIGFuZCBoaWRlcyBpbnB1dCB0ZXh0YXJlYVxuICAgICAgdmFyIGRpdiA9IHRoaXMud3JhcHBlciA9IGhpZGRlblRleHRhcmVhKCk7XG4gICAgICAvLyBUaGUgc2VtaWhpZGRlbiB0ZXh0YXJlYSB0aGF0IGlzIGZvY3VzZWQgd2hlbiB0aGUgZWRpdG9yIGlzXG4gICAgICAvLyBmb2N1c2VkLCBhbmQgcmVjZWl2ZXMgaW5wdXQuXG4gICAgICB2YXIgdGUgPSB0aGlzLnRleHRhcmVhID0gZGl2LmZpcnN0Q2hpbGQ7XG4gICAgICBkaXNwbGF5LndyYXBwZXIuaW5zZXJ0QmVmb3JlKGRpdiwgZGlzcGxheS53cmFwcGVyLmZpcnN0Q2hpbGQpO1xuXG4gICAgICAvLyBOZWVkZWQgdG8gaGlkZSBiaWcgYmx1ZSBibGlua2luZyBjdXJzb3Igb24gTW9iaWxlIFNhZmFyaSAoZG9lc24ndCBzZWVtIHRvIHdvcmsgaW4gaU9TIDggYW55bW9yZSlcbiAgICAgIGlmIChpb3MpIHRlLnN0eWxlLndpZHRoID0gXCIwcHhcIjtcblxuICAgICAgb24odGUsIFwiaW5wdXRcIiwgZnVuY3Rpb24oKSB7XG4gICAgICAgIGlmIChpZSAmJiBpZV92ZXJzaW9uID49IDkgJiYgaW5wdXQuaGFzU2VsZWN0aW9uKSBpbnB1dC5oYXNTZWxlY3Rpb24gPSBudWxsO1xuICAgICAgICBpbnB1dC5wb2xsKCk7XG4gICAgICB9KTtcblxuICAgICAgb24odGUsIFwicGFzdGVcIiwgZnVuY3Rpb24oZSkge1xuICAgICAgICBpZiAoaGFuZGxlUGFzdGUoZSwgY20pKSByZXR1cm4gdHJ1ZTtcblxuICAgICAgICBjbS5zdGF0ZS5wYXN0ZUluY29taW5nID0gdHJ1ZTtcbiAgICAgICAgaW5wdXQuZmFzdFBvbGwoKTtcbiAgICAgIH0pO1xuXG4gICAgICBmdW5jdGlvbiBwcmVwYXJlQ29weUN1dChlKSB7XG4gICAgICAgIGlmIChjbS5zb21ldGhpbmdTZWxlY3RlZCgpKSB7XG4gICAgICAgICAgbGFzdENvcGllZCA9IGNtLmdldFNlbGVjdGlvbnMoKTtcbiAgICAgICAgICBpZiAoaW5wdXQuaW5hY2N1cmF0ZVNlbGVjdGlvbikge1xuICAgICAgICAgICAgaW5wdXQucHJldklucHV0ID0gXCJcIjtcbiAgICAgICAgICAgIGlucHV0LmluYWNjdXJhdGVTZWxlY3Rpb24gPSBmYWxzZTtcbiAgICAgICAgICAgIHRlLnZhbHVlID0gbGFzdENvcGllZC5qb2luKFwiXFxuXCIpO1xuICAgICAgICAgICAgc2VsZWN0SW5wdXQodGUpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmICghY20ub3B0aW9ucy5saW5lV2lzZUNvcHlDdXQpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdmFyIHJhbmdlcyA9IGNvcHlhYmxlUmFuZ2VzKGNtKTtcbiAgICAgICAgICBsYXN0Q29waWVkID0gcmFuZ2VzLnRleHQ7XG4gICAgICAgICAgaWYgKGUudHlwZSA9PSBcImN1dFwiKSB7XG4gICAgICAgICAgICBjbS5zZXRTZWxlY3Rpb25zKHJhbmdlcy5yYW5nZXMsIG51bGwsIHNlbF9kb250U2Nyb2xsKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgaW5wdXQucHJldklucHV0ID0gXCJcIjtcbiAgICAgICAgICAgIHRlLnZhbHVlID0gcmFuZ2VzLnRleHQuam9pbihcIlxcblwiKTtcbiAgICAgICAgICAgIHNlbGVjdElucHV0KHRlKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGUudHlwZSA9PSBcImN1dFwiKSBjbS5zdGF0ZS5jdXRJbmNvbWluZyA9IHRydWU7XG4gICAgICB9XG4gICAgICBvbih0ZSwgXCJjdXRcIiwgcHJlcGFyZUNvcHlDdXQpO1xuICAgICAgb24odGUsIFwiY29weVwiLCBwcmVwYXJlQ29weUN1dCk7XG5cbiAgICAgIG9uKGRpc3BsYXkuc2Nyb2xsZXIsIFwicGFzdGVcIiwgZnVuY3Rpb24oZSkge1xuICAgICAgICBpZiAoZXZlbnRJbldpZGdldChkaXNwbGF5LCBlKSkgcmV0dXJuO1xuICAgICAgICBjbS5zdGF0ZS5wYXN0ZUluY29taW5nID0gdHJ1ZTtcbiAgICAgICAgaW5wdXQuZm9jdXMoKTtcbiAgICAgIH0pO1xuXG4gICAgICAvLyBQcmV2ZW50IG5vcm1hbCBzZWxlY3Rpb24gaW4gdGhlIGVkaXRvciAod2UgaGFuZGxlIG91ciBvd24pXG4gICAgICBvbihkaXNwbGF5LmxpbmVTcGFjZSwgXCJzZWxlY3RzdGFydFwiLCBmdW5jdGlvbihlKSB7XG4gICAgICAgIGlmICghZXZlbnRJbldpZGdldChkaXNwbGF5LCBlKSkgZV9wcmV2ZW50RGVmYXVsdChlKTtcbiAgICAgIH0pO1xuXG4gICAgICBvbih0ZSwgXCJjb21wb3NpdGlvbnN0YXJ0XCIsIGZ1bmN0aW9uKCkge1xuICAgICAgICB2YXIgc3RhcnQgPSBjbS5nZXRDdXJzb3IoXCJmcm9tXCIpO1xuICAgICAgICBpbnB1dC5jb21wb3NpbmcgPSB7XG4gICAgICAgICAgc3RhcnQ6IHN0YXJ0LFxuICAgICAgICAgIHJhbmdlOiBjbS5tYXJrVGV4dChzdGFydCwgY20uZ2V0Q3Vyc29yKFwidG9cIiksIHtjbGFzc05hbWU6IFwiQ29kZU1pcnJvci1jb21wb3NpbmdcIn0pXG4gICAgICAgIH07XG4gICAgICB9KTtcbiAgICAgIG9uKHRlLCBcImNvbXBvc2l0aW9uZW5kXCIsIGZ1bmN0aW9uKCkge1xuICAgICAgICBpZiAoaW5wdXQuY29tcG9zaW5nKSB7XG4gICAgICAgICAgaW5wdXQucG9sbCgpO1xuICAgICAgICAgIGlucHV0LmNvbXBvc2luZy5yYW5nZS5jbGVhcigpO1xuICAgICAgICAgIGlucHV0LmNvbXBvc2luZyA9IG51bGw7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0sXG5cbiAgICBwcmVwYXJlU2VsZWN0aW9uOiBmdW5jdGlvbigpIHtcbiAgICAgIC8vIFJlZHJhdyB0aGUgc2VsZWN0aW9uIGFuZC9vciBjdXJzb3JcbiAgICAgIHZhciBjbSA9IHRoaXMuY20sIGRpc3BsYXkgPSBjbS5kaXNwbGF5LCBkb2MgPSBjbS5kb2M7XG4gICAgICB2YXIgcmVzdWx0ID0gcHJlcGFyZVNlbGVjdGlvbihjbSk7XG5cbiAgICAgIC8vIE1vdmUgdGhlIGhpZGRlbiB0ZXh0YXJlYSBuZWFyIHRoZSBjdXJzb3IgdG8gcHJldmVudCBzY3JvbGxpbmcgYXJ0aWZhY3RzXG4gICAgICBpZiAoY20ub3B0aW9ucy5tb3ZlSW5wdXRXaXRoQ3Vyc29yKSB7XG4gICAgICAgIHZhciBoZWFkUG9zID0gY3Vyc29yQ29vcmRzKGNtLCBkb2Muc2VsLnByaW1hcnkoKS5oZWFkLCBcImRpdlwiKTtcbiAgICAgICAgdmFyIHdyYXBPZmYgPSBkaXNwbGF5LndyYXBwZXIuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCksIGxpbmVPZmYgPSBkaXNwbGF5LmxpbmVEaXYuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgICAgIHJlc3VsdC50ZVRvcCA9IE1hdGgubWF4KDAsIE1hdGgubWluKGRpc3BsYXkud3JhcHBlci5jbGllbnRIZWlnaHQgLSAxMCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGVhZFBvcy50b3AgKyBsaW5lT2ZmLnRvcCAtIHdyYXBPZmYudG9wKSk7XG4gICAgICAgIHJlc3VsdC50ZUxlZnQgPSBNYXRoLm1heCgwLCBNYXRoLm1pbihkaXNwbGF5LndyYXBwZXIuY2xpZW50V2lkdGggLSAxMCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhlYWRQb3MubGVmdCArIGxpbmVPZmYubGVmdCAtIHdyYXBPZmYubGVmdCkpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH0sXG5cbiAgICBzaG93U2VsZWN0aW9uOiBmdW5jdGlvbihkcmF3bikge1xuICAgICAgdmFyIGNtID0gdGhpcy5jbSwgZGlzcGxheSA9IGNtLmRpc3BsYXk7XG4gICAgICByZW1vdmVDaGlsZHJlbkFuZEFkZChkaXNwbGF5LmN1cnNvckRpdiwgZHJhd24uY3Vyc29ycyk7XG4gICAgICByZW1vdmVDaGlsZHJlbkFuZEFkZChkaXNwbGF5LnNlbGVjdGlvbkRpdiwgZHJhd24uc2VsZWN0aW9uKTtcbiAgICAgIGlmIChkcmF3bi50ZVRvcCAhPSBudWxsKSB7XG4gICAgICAgIHRoaXMud3JhcHBlci5zdHlsZS50b3AgPSBkcmF3bi50ZVRvcCArIFwicHhcIjtcbiAgICAgICAgdGhpcy53cmFwcGVyLnN0eWxlLmxlZnQgPSBkcmF3bi50ZUxlZnQgKyBcInB4XCI7XG4gICAgICB9XG4gICAgfSxcblxuICAgIC8vIFJlc2V0IHRoZSBpbnB1dCB0byBjb3JyZXNwb25kIHRvIHRoZSBzZWxlY3Rpb24gKG9yIHRvIGJlIGVtcHR5LFxuICAgIC8vIHdoZW4gbm90IHR5cGluZyBhbmQgbm90aGluZyBpcyBzZWxlY3RlZClcbiAgICByZXNldDogZnVuY3Rpb24odHlwaW5nKSB7XG4gICAgICBpZiAodGhpcy5jb250ZXh0TWVudVBlbmRpbmcpIHJldHVybjtcbiAgICAgIHZhciBtaW5pbWFsLCBzZWxlY3RlZCwgY20gPSB0aGlzLmNtLCBkb2MgPSBjbS5kb2M7XG4gICAgICBpZiAoY20uc29tZXRoaW5nU2VsZWN0ZWQoKSkge1xuICAgICAgICB0aGlzLnByZXZJbnB1dCA9IFwiXCI7XG4gICAgICAgIHZhciByYW5nZSA9IGRvYy5zZWwucHJpbWFyeSgpO1xuICAgICAgICBtaW5pbWFsID0gaGFzQ29weUV2ZW50ICYmXG4gICAgICAgICAgKHJhbmdlLnRvKCkubGluZSAtIHJhbmdlLmZyb20oKS5saW5lID4gMTAwIHx8IChzZWxlY3RlZCA9IGNtLmdldFNlbGVjdGlvbigpKS5sZW5ndGggPiAxMDAwKTtcbiAgICAgICAgdmFyIGNvbnRlbnQgPSBtaW5pbWFsID8gXCItXCIgOiBzZWxlY3RlZCB8fCBjbS5nZXRTZWxlY3Rpb24oKTtcbiAgICAgICAgdGhpcy50ZXh0YXJlYS52YWx1ZSA9IGNvbnRlbnQ7XG4gICAgICAgIGlmIChjbS5zdGF0ZS5mb2N1c2VkKSBzZWxlY3RJbnB1dCh0aGlzLnRleHRhcmVhKTtcbiAgICAgICAgaWYgKGllICYmIGllX3ZlcnNpb24gPj0gOSkgdGhpcy5oYXNTZWxlY3Rpb24gPSBjb250ZW50O1xuICAgICAgfSBlbHNlIGlmICghdHlwaW5nKSB7XG4gICAgICAgIHRoaXMucHJldklucHV0ID0gdGhpcy50ZXh0YXJlYS52YWx1ZSA9IFwiXCI7XG4gICAgICAgIGlmIChpZSAmJiBpZV92ZXJzaW9uID49IDkpIHRoaXMuaGFzU2VsZWN0aW9uID0gbnVsbDtcbiAgICAgIH1cbiAgICAgIHRoaXMuaW5hY2N1cmF0ZVNlbGVjdGlvbiA9IG1pbmltYWw7XG4gICAgfSxcblxuICAgIGdldEZpZWxkOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudGV4dGFyZWE7IH0sXG5cbiAgICBzdXBwb3J0c1RvdWNoOiBmdW5jdGlvbigpIHsgcmV0dXJuIGZhbHNlOyB9LFxuXG4gICAgZm9jdXM6IGZ1bmN0aW9uKCkge1xuICAgICAgaWYgKHRoaXMuY20ub3B0aW9ucy5yZWFkT25seSAhPSBcIm5vY3Vyc29yXCIgJiYgKCFtb2JpbGUgfHwgYWN0aXZlRWx0KCkgIT0gdGhpcy50ZXh0YXJlYSkpIHtcbiAgICAgICAgdHJ5IHsgdGhpcy50ZXh0YXJlYS5mb2N1cygpOyB9XG4gICAgICAgIGNhdGNoIChlKSB7fSAvLyBJRTggd2lsbCB0aHJvdyBpZiB0aGUgdGV4dGFyZWEgaXMgZGlzcGxheTogbm9uZSBvciBub3QgaW4gRE9NXG4gICAgICB9XG4gICAgfSxcblxuICAgIGJsdXI6IGZ1bmN0aW9uKCkgeyB0aGlzLnRleHRhcmVhLmJsdXIoKTsgfSxcblxuICAgIHJlc2V0UG9zaXRpb246IGZ1bmN0aW9uKCkge1xuICAgICAgdGhpcy53cmFwcGVyLnN0eWxlLnRvcCA9IHRoaXMud3JhcHBlci5zdHlsZS5sZWZ0ID0gMDtcbiAgICB9LFxuXG4gICAgcmVjZWl2ZWRGb2N1czogZnVuY3Rpb24oKSB7IHRoaXMuc2xvd1BvbGwoKTsgfSxcblxuICAgIC8vIFBvbGwgZm9yIGlucHV0IGNoYW5nZXMsIHVzaW5nIHRoZSBub3JtYWwgcmF0ZSBvZiBwb2xsaW5nLiBUaGlzXG4gICAgLy8gcnVucyBhcyBsb25nIGFzIHRoZSBlZGl0b3IgaXMgZm9jdXNlZC5cbiAgICBzbG93UG9sbDogZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgaW5wdXQgPSB0aGlzO1xuICAgICAgaWYgKGlucHV0LnBvbGxpbmdGYXN0KSByZXR1cm47XG4gICAgICBpbnB1dC5wb2xsaW5nLnNldCh0aGlzLmNtLm9wdGlvbnMucG9sbEludGVydmFsLCBmdW5jdGlvbigpIHtcbiAgICAgICAgaW5wdXQucG9sbCgpO1xuICAgICAgICBpZiAoaW5wdXQuY20uc3RhdGUuZm9jdXNlZCkgaW5wdXQuc2xvd1BvbGwoKTtcbiAgICAgIH0pO1xuICAgIH0sXG5cbiAgICAvLyBXaGVuIGFuIGV2ZW50IGhhcyBqdXN0IGNvbWUgaW4gdGhhdCBpcyBsaWtlbHkgdG8gYWRkIG9yIGNoYW5nZVxuICAgIC8vIHNvbWV0aGluZyBpbiB0aGUgaW5wdXQgdGV4dGFyZWEsIHdlIHBvbGwgZmFzdGVyLCB0byBlbnN1cmUgdGhhdFxuICAgIC8vIHRoZSBjaGFuZ2UgYXBwZWFycyBvbiB0aGUgc2NyZWVuIHF1aWNrbHkuXG4gICAgZmFzdFBvbGw6IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIG1pc3NlZCA9IGZhbHNlLCBpbnB1dCA9IHRoaXM7XG4gICAgICBpbnB1dC5wb2xsaW5nRmFzdCA9IHRydWU7XG4gICAgICBmdW5jdGlvbiBwKCkge1xuICAgICAgICB2YXIgY2hhbmdlZCA9IGlucHV0LnBvbGwoKTtcbiAgICAgICAgaWYgKCFjaGFuZ2VkICYmICFtaXNzZWQpIHttaXNzZWQgPSB0cnVlOyBpbnB1dC5wb2xsaW5nLnNldCg2MCwgcCk7fVxuICAgICAgICBlbHNlIHtpbnB1dC5wb2xsaW5nRmFzdCA9IGZhbHNlOyBpbnB1dC5zbG93UG9sbCgpO31cbiAgICAgIH1cbiAgICAgIGlucHV0LnBvbGxpbmcuc2V0KDIwLCBwKTtcbiAgICB9LFxuXG4gICAgLy8gUmVhZCBpbnB1dCBmcm9tIHRoZSB0ZXh0YXJlYSwgYW5kIHVwZGF0ZSB0aGUgZG9jdW1lbnQgdG8gbWF0Y2guXG4gICAgLy8gV2hlbiBzb21ldGhpbmcgaXMgc2VsZWN0ZWQsIGl0IGlzIHByZXNlbnQgaW4gdGhlIHRleHRhcmVhLCBhbmRcbiAgICAvLyBzZWxlY3RlZCAodW5sZXNzIGl0IGlzIGh1Z2UsIGluIHdoaWNoIGNhc2UgYSBwbGFjZWhvbGRlciBpc1xuICAgIC8vIHVzZWQpLiBXaGVuIG5vdGhpbmcgaXMgc2VsZWN0ZWQsIHRoZSBjdXJzb3Igc2l0cyBhZnRlciBwcmV2aW91c2x5XG4gICAgLy8gc2VlbiB0ZXh0IChjYW4gYmUgZW1wdHkpLCB3aGljaCBpcyBzdG9yZWQgaW4gcHJldklucHV0ICh3ZSBtdXN0XG4gICAgLy8gbm90IHJlc2V0IHRoZSB0ZXh0YXJlYSB3aGVuIHR5cGluZywgYmVjYXVzZSB0aGF0IGJyZWFrcyBJTUUpLlxuICAgIHBvbGw6IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIGNtID0gdGhpcy5jbSwgaW5wdXQgPSB0aGlzLnRleHRhcmVhLCBwcmV2SW5wdXQgPSB0aGlzLnByZXZJbnB1dDtcbiAgICAgIC8vIFNpbmNlIHRoaXMgaXMgY2FsbGVkIGEgKmxvdCosIHRyeSB0byBiYWlsIG91dCBhcyBjaGVhcGx5IGFzXG4gICAgICAvLyBwb3NzaWJsZSB3aGVuIGl0IGlzIGNsZWFyIHRoYXQgbm90aGluZyBoYXBwZW5lZC4gaGFzU2VsZWN0aW9uXG4gICAgICAvLyB3aWxsIGJlIHRoZSBjYXNlIHdoZW4gdGhlcmUgaXMgYSBsb3Qgb2YgdGV4dCBpbiB0aGUgdGV4dGFyZWEsXG4gICAgICAvLyBpbiB3aGljaCBjYXNlIHJlYWRpbmcgaXRzIHZhbHVlIHdvdWxkIGJlIGV4cGVuc2l2ZS5cbiAgICAgIGlmICh0aGlzLmNvbnRleHRNZW51UGVuZGluZyB8fCAhY20uc3RhdGUuZm9jdXNlZCB8fFxuICAgICAgICAgIChoYXNTZWxlY3Rpb24oaW5wdXQpICYmICFwcmV2SW5wdXQpIHx8XG4gICAgICAgICAgaXNSZWFkT25seShjbSkgfHwgY20ub3B0aW9ucy5kaXNhYmxlSW5wdXQgfHwgY20uc3RhdGUua2V5U2VxKVxuICAgICAgICByZXR1cm4gZmFsc2U7XG5cbiAgICAgIHZhciB0ZXh0ID0gaW5wdXQudmFsdWU7XG4gICAgICAvLyBJZiBub3RoaW5nIGNoYW5nZWQsIGJhaWwuXG4gICAgICBpZiAodGV4dCA9PSBwcmV2SW5wdXQgJiYgIWNtLnNvbWV0aGluZ1NlbGVjdGVkKCkpIHJldHVybiBmYWxzZTtcbiAgICAgIC8vIFdvcmsgYXJvdW5kIG5vbnNlbnNpY2FsIHNlbGVjdGlvbiByZXNldHRpbmcgaW4gSUU5LzEwLCBhbmRcbiAgICAgIC8vIGluZXhwbGljYWJsZSBhcHBlYXJhbmNlIG9mIHByaXZhdGUgYXJlYSB1bmljb2RlIGNoYXJhY3RlcnMgb25cbiAgICAgIC8vIHNvbWUga2V5IGNvbWJvcyBpbiBNYWMgKCMyNjg5KS5cbiAgICAgIGlmIChpZSAmJiBpZV92ZXJzaW9uID49IDkgJiYgdGhpcy5oYXNTZWxlY3Rpb24gPT09IHRleHQgfHxcbiAgICAgICAgICBtYWMgJiYgL1tcXHVmNzAwLVxcdWY3ZmZdLy50ZXN0KHRleHQpKSB7XG4gICAgICAgIGNtLmRpc3BsYXkuaW5wdXQucmVzZXQoKTtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuXG4gICAgICBpZiAoY20uZG9jLnNlbCA9PSBjbS5kaXNwbGF5LnNlbEZvckNvbnRleHRNZW51KSB7XG4gICAgICAgIHZhciBmaXJzdCA9IHRleHQuY2hhckNvZGVBdCgwKTtcbiAgICAgICAgaWYgKGZpcnN0ID09IDB4MjAwYiAmJiAhcHJldklucHV0KSBwcmV2SW5wdXQgPSBcIlxcdTIwMGJcIjtcbiAgICAgICAgaWYgKGZpcnN0ID09IDB4MjFkYSkgeyB0aGlzLnJlc2V0KCk7IHJldHVybiB0aGlzLmNtLmV4ZWNDb21tYW5kKFwidW5kb1wiKTsgfVxuICAgICAgfVxuICAgICAgLy8gRmluZCB0aGUgcGFydCBvZiB0aGUgaW5wdXQgdGhhdCBpcyBhY3R1YWxseSBuZXdcbiAgICAgIHZhciBzYW1lID0gMCwgbCA9IE1hdGgubWluKHByZXZJbnB1dC5sZW5ndGgsIHRleHQubGVuZ3RoKTtcbiAgICAgIHdoaWxlIChzYW1lIDwgbCAmJiBwcmV2SW5wdXQuY2hhckNvZGVBdChzYW1lKSA9PSB0ZXh0LmNoYXJDb2RlQXQoc2FtZSkpICsrc2FtZTtcblxuICAgICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgICAgcnVuSW5PcChjbSwgZnVuY3Rpb24oKSB7XG4gICAgICAgIGFwcGx5VGV4dElucHV0KGNtLCB0ZXh0LnNsaWNlKHNhbWUpLCBwcmV2SW5wdXQubGVuZ3RoIC0gc2FtZSxcbiAgICAgICAgICAgICAgICAgICAgICAgbnVsbCwgc2VsZi5jb21wb3NpbmcgPyBcIipjb21wb3NlXCIgOiBudWxsKTtcblxuICAgICAgICAvLyBEb24ndCBsZWF2ZSBsb25nIHRleHQgaW4gdGhlIHRleHRhcmVhLCBzaW5jZSBpdCBtYWtlcyBmdXJ0aGVyIHBvbGxpbmcgc2xvd1xuICAgICAgICBpZiAodGV4dC5sZW5ndGggPiAxMDAwIHx8IHRleHQuaW5kZXhPZihcIlxcblwiKSA+IC0xKSBpbnB1dC52YWx1ZSA9IHNlbGYucHJldklucHV0ID0gXCJcIjtcbiAgICAgICAgZWxzZSBzZWxmLnByZXZJbnB1dCA9IHRleHQ7XG5cbiAgICAgICAgaWYgKHNlbGYuY29tcG9zaW5nKSB7XG4gICAgICAgICAgc2VsZi5jb21wb3NpbmcucmFuZ2UuY2xlYXIoKTtcbiAgICAgICAgICBzZWxmLmNvbXBvc2luZy5yYW5nZSA9IGNtLm1hcmtUZXh0KHNlbGYuY29tcG9zaW5nLnN0YXJ0LCBjbS5nZXRDdXJzb3IoXCJ0b1wiKSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHtjbGFzc05hbWU6IFwiQ29kZU1pcnJvci1jb21wb3NpbmdcIn0pO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH0sXG5cbiAgICBlbnN1cmVQb2xsZWQ6IGZ1bmN0aW9uKCkge1xuICAgICAgaWYgKHRoaXMucG9sbGluZ0Zhc3QgJiYgdGhpcy5wb2xsKCkpIHRoaXMucG9sbGluZ0Zhc3QgPSBmYWxzZTtcbiAgICB9LFxuXG4gICAgb25LZXlQcmVzczogZnVuY3Rpb24oKSB7XG4gICAgICBpZiAoaWUgJiYgaWVfdmVyc2lvbiA+PSA5KSB0aGlzLmhhc1NlbGVjdGlvbiA9IG51bGw7XG4gICAgICB0aGlzLmZhc3RQb2xsKCk7XG4gICAgfSxcblxuICAgIG9uQ29udGV4dE1lbnU6IGZ1bmN0aW9uKGUpIHtcbiAgICAgIHZhciBpbnB1dCA9IHRoaXMsIGNtID0gaW5wdXQuY20sIGRpc3BsYXkgPSBjbS5kaXNwbGF5LCB0ZSA9IGlucHV0LnRleHRhcmVhO1xuICAgICAgdmFyIHBvcyA9IHBvc0Zyb21Nb3VzZShjbSwgZSksIHNjcm9sbFBvcyA9IGRpc3BsYXkuc2Nyb2xsZXIuc2Nyb2xsVG9wO1xuICAgICAgaWYgKCFwb3MgfHwgcHJlc3RvKSByZXR1cm47IC8vIE9wZXJhIGlzIGRpZmZpY3VsdC5cblxuICAgICAgLy8gUmVzZXQgdGhlIGN1cnJlbnQgdGV4dCBzZWxlY3Rpb24gb25seSBpZiB0aGUgY2xpY2sgaXMgZG9uZSBvdXRzaWRlIG9mIHRoZSBzZWxlY3Rpb25cbiAgICAgIC8vIGFuZCAncmVzZXRTZWxlY3Rpb25PbkNvbnRleHRNZW51JyBvcHRpb24gaXMgdHJ1ZS5cbiAgICAgIHZhciByZXNldCA9IGNtLm9wdGlvbnMucmVzZXRTZWxlY3Rpb25PbkNvbnRleHRNZW51O1xuICAgICAgaWYgKHJlc2V0ICYmIGNtLmRvYy5zZWwuY29udGFpbnMocG9zKSA9PSAtMSlcbiAgICAgICAgb3BlcmF0aW9uKGNtLCBzZXRTZWxlY3Rpb24pKGNtLmRvYywgc2ltcGxlU2VsZWN0aW9uKHBvcyksIHNlbF9kb250U2Nyb2xsKTtcblxuICAgICAgdmFyIG9sZENTUyA9IHRlLnN0eWxlLmNzc1RleHQ7XG4gICAgICBpbnB1dC53cmFwcGVyLnN0eWxlLnBvc2l0aW9uID0gXCJhYnNvbHV0ZVwiO1xuICAgICAgdGUuc3R5bGUuY3NzVGV4dCA9IFwicG9zaXRpb246IGZpeGVkOyB3aWR0aDogMzBweDsgaGVpZ2h0OiAzMHB4OyB0b3A6IFwiICsgKGUuY2xpZW50WSAtIDUpICtcbiAgICAgICAgXCJweDsgbGVmdDogXCIgKyAoZS5jbGllbnRYIC0gNSkgKyBcInB4OyB6LWluZGV4OiAxMDAwOyBiYWNrZ3JvdW5kOiBcIiArXG4gICAgICAgIChpZSA/IFwicmdiYSgyNTUsIDI1NSwgMjU1LCAuMDUpXCIgOiBcInRyYW5zcGFyZW50XCIpICtcbiAgICAgICAgXCI7IG91dGxpbmU6IG5vbmU7IGJvcmRlci13aWR0aDogMDsgb3V0bGluZTogbm9uZTsgb3ZlcmZsb3c6IGhpZGRlbjsgb3BhY2l0eTogLjA1OyBmaWx0ZXI6IGFscGhhKG9wYWNpdHk9NSk7XCI7XG4gICAgICBpZiAod2Via2l0KSB2YXIgb2xkU2Nyb2xsWSA9IHdpbmRvdy5zY3JvbGxZOyAvLyBXb3JrIGFyb3VuZCBDaHJvbWUgaXNzdWUgKCMyNzEyKVxuICAgICAgZGlzcGxheS5pbnB1dC5mb2N1cygpO1xuICAgICAgaWYgKHdlYmtpdCkgd2luZG93LnNjcm9sbFRvKG51bGwsIG9sZFNjcm9sbFkpO1xuICAgICAgZGlzcGxheS5pbnB1dC5yZXNldCgpO1xuICAgICAgLy8gQWRkcyBcIlNlbGVjdCBhbGxcIiB0byBjb250ZXh0IG1lbnUgaW4gRkZcbiAgICAgIGlmICghY20uc29tZXRoaW5nU2VsZWN0ZWQoKSkgdGUudmFsdWUgPSBpbnB1dC5wcmV2SW5wdXQgPSBcIiBcIjtcbiAgICAgIGlucHV0LmNvbnRleHRNZW51UGVuZGluZyA9IHRydWU7XG4gICAgICBkaXNwbGF5LnNlbEZvckNvbnRleHRNZW51ID0gY20uZG9jLnNlbDtcbiAgICAgIGNsZWFyVGltZW91dChkaXNwbGF5LmRldGVjdGluZ1NlbGVjdEFsbCk7XG5cbiAgICAgIC8vIFNlbGVjdC1hbGwgd2lsbCBiZSBncmV5ZWQgb3V0IGlmIHRoZXJlJ3Mgbm90aGluZyB0byBzZWxlY3QsIHNvXG4gICAgICAvLyB0aGlzIGFkZHMgYSB6ZXJvLXdpZHRoIHNwYWNlIHNvIHRoYXQgd2UgY2FuIGxhdGVyIGNoZWNrIHdoZXRoZXJcbiAgICAgIC8vIGl0IGdvdCBzZWxlY3RlZC5cbiAgICAgIGZ1bmN0aW9uIHByZXBhcmVTZWxlY3RBbGxIYWNrKCkge1xuICAgICAgICBpZiAodGUuc2VsZWN0aW9uU3RhcnQgIT0gbnVsbCkge1xuICAgICAgICAgIHZhciBzZWxlY3RlZCA9IGNtLnNvbWV0aGluZ1NlbGVjdGVkKCk7XG4gICAgICAgICAgdmFyIGV4dHZhbCA9IFwiXFx1MjAwYlwiICsgKHNlbGVjdGVkID8gdGUudmFsdWUgOiBcIlwiKTtcbiAgICAgICAgICB0ZS52YWx1ZSA9IFwiXFx1MjFkYVwiOyAvLyBVc2VkIHRvIGNhdGNoIGNvbnRleHQtbWVudSB1bmRvXG4gICAgICAgICAgdGUudmFsdWUgPSBleHR2YWw7XG4gICAgICAgICAgaW5wdXQucHJldklucHV0ID0gc2VsZWN0ZWQgPyBcIlwiIDogXCJcXHUyMDBiXCI7XG4gICAgICAgICAgdGUuc2VsZWN0aW9uU3RhcnQgPSAxOyB0ZS5zZWxlY3Rpb25FbmQgPSBleHR2YWwubGVuZ3RoO1xuICAgICAgICAgIC8vIFJlLXNldCB0aGlzLCBpbiBjYXNlIHNvbWUgb3RoZXIgaGFuZGxlciB0b3VjaGVkIHRoZVxuICAgICAgICAgIC8vIHNlbGVjdGlvbiBpbiB0aGUgbWVhbnRpbWUuXG4gICAgICAgICAgZGlzcGxheS5zZWxGb3JDb250ZXh0TWVudSA9IGNtLmRvYy5zZWw7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGZ1bmN0aW9uIHJlaGlkZSgpIHtcbiAgICAgICAgaW5wdXQuY29udGV4dE1lbnVQZW5kaW5nID0gZmFsc2U7XG4gICAgICAgIGlucHV0LndyYXBwZXIuc3R5bGUucG9zaXRpb24gPSBcInJlbGF0aXZlXCI7XG4gICAgICAgIHRlLnN0eWxlLmNzc1RleHQgPSBvbGRDU1M7XG4gICAgICAgIGlmIChpZSAmJiBpZV92ZXJzaW9uIDwgOSkgZGlzcGxheS5zY3JvbGxiYXJzLnNldFNjcm9sbFRvcChkaXNwbGF5LnNjcm9sbGVyLnNjcm9sbFRvcCA9IHNjcm9sbFBvcyk7XG5cbiAgICAgICAgLy8gVHJ5IHRvIGRldGVjdCB0aGUgdXNlciBjaG9vc2luZyBzZWxlY3QtYWxsXG4gICAgICAgIGlmICh0ZS5zZWxlY3Rpb25TdGFydCAhPSBudWxsKSB7XG4gICAgICAgICAgaWYgKCFpZSB8fCAoaWUgJiYgaWVfdmVyc2lvbiA8IDkpKSBwcmVwYXJlU2VsZWN0QWxsSGFjaygpO1xuICAgICAgICAgIHZhciBpID0gMCwgcG9sbCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgaWYgKGRpc3BsYXkuc2VsRm9yQ29udGV4dE1lbnUgPT0gY20uZG9jLnNlbCAmJiB0ZS5zZWxlY3Rpb25TdGFydCA9PSAwICYmXG4gICAgICAgICAgICAgICAgdGUuc2VsZWN0aW9uRW5kID4gMCAmJiBpbnB1dC5wcmV2SW5wdXQgPT0gXCJcXHUyMDBiXCIpXG4gICAgICAgICAgICAgIG9wZXJhdGlvbihjbSwgY29tbWFuZHMuc2VsZWN0QWxsKShjbSk7XG4gICAgICAgICAgICBlbHNlIGlmIChpKysgPCAxMCkgZGlzcGxheS5kZXRlY3RpbmdTZWxlY3RBbGwgPSBzZXRUaW1lb3V0KHBvbGwsIDUwMCk7XG4gICAgICAgICAgICBlbHNlIGRpc3BsYXkuaW5wdXQucmVzZXQoKTtcbiAgICAgICAgICB9O1xuICAgICAgICAgIGRpc3BsYXkuZGV0ZWN0aW5nU2VsZWN0QWxsID0gc2V0VGltZW91dChwb2xsLCAyMDApO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmIChpZSAmJiBpZV92ZXJzaW9uID49IDkpIHByZXBhcmVTZWxlY3RBbGxIYWNrKCk7XG4gICAgICBpZiAoY2FwdHVyZVJpZ2h0Q2xpY2spIHtcbiAgICAgICAgZV9zdG9wKGUpO1xuICAgICAgICB2YXIgbW91c2V1cCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIG9mZih3aW5kb3csIFwibW91c2V1cFwiLCBtb3VzZXVwKTtcbiAgICAgICAgICBzZXRUaW1lb3V0KHJlaGlkZSwgMjApO1xuICAgICAgICB9O1xuICAgICAgICBvbih3aW5kb3csIFwibW91c2V1cFwiLCBtb3VzZXVwKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNldFRpbWVvdXQocmVoaWRlLCA1MCk7XG4gICAgICB9XG4gICAgfSxcblxuICAgIHNldFVuZWRpdGFibGU6IG5vdGhpbmcsXG5cbiAgICBuZWVkc0NvbnRlbnRBdHRyaWJ1dGU6IGZhbHNlXG4gIH0sIFRleHRhcmVhSW5wdXQucHJvdG90eXBlKTtcblxuICAvLyBDT05URU5URURJVEFCTEUgSU5QVVQgU1RZTEVcblxuICBmdW5jdGlvbiBDb250ZW50RWRpdGFibGVJbnB1dChjbSkge1xuICAgIHRoaXMuY20gPSBjbTtcbiAgICB0aGlzLmxhc3RBbmNob3JOb2RlID0gdGhpcy5sYXN0QW5jaG9yT2Zmc2V0ID0gdGhpcy5sYXN0Rm9jdXNOb2RlID0gdGhpcy5sYXN0Rm9jdXNPZmZzZXQgPSBudWxsO1xuICAgIHRoaXMucG9sbGluZyA9IG5ldyBEZWxheWVkKCk7XG4gICAgdGhpcy5ncmFjZVBlcmlvZCA9IGZhbHNlO1xuICB9XG5cbiAgQ29udGVudEVkaXRhYmxlSW5wdXQucHJvdG90eXBlID0gY29weU9iaih7XG4gICAgaW5pdDogZnVuY3Rpb24oZGlzcGxheSkge1xuICAgICAgdmFyIGlucHV0ID0gdGhpcywgY20gPSBpbnB1dC5jbTtcbiAgICAgIHZhciBkaXYgPSBpbnB1dC5kaXYgPSBkaXNwbGF5LmxpbmVEaXY7XG4gICAgICBkaXYuY29udGVudEVkaXRhYmxlID0gXCJ0cnVlXCI7XG4gICAgICBkaXNhYmxlQnJvd3Nlck1hZ2ljKGRpdik7XG5cbiAgICAgIG9uKGRpdiwgXCJwYXN0ZVwiLCBmdW5jdGlvbihlKSB7IGhhbmRsZVBhc3RlKGUsIGNtKTsgfSlcblxuICAgICAgb24oZGl2LCBcImNvbXBvc2l0aW9uc3RhcnRcIiwgZnVuY3Rpb24oZSkge1xuICAgICAgICB2YXIgZGF0YSA9IGUuZGF0YTtcbiAgICAgICAgaW5wdXQuY29tcG9zaW5nID0ge3NlbDogY20uZG9jLnNlbCwgZGF0YTogZGF0YSwgc3RhcnREYXRhOiBkYXRhfTtcbiAgICAgICAgaWYgKCFkYXRhKSByZXR1cm47XG4gICAgICAgIHZhciBwcmltID0gY20uZG9jLnNlbC5wcmltYXJ5KCk7XG4gICAgICAgIHZhciBsaW5lID0gY20uZ2V0TGluZShwcmltLmhlYWQubGluZSk7XG4gICAgICAgIHZhciBmb3VuZCA9IGxpbmUuaW5kZXhPZihkYXRhLCBNYXRoLm1heCgwLCBwcmltLmhlYWQuY2ggLSBkYXRhLmxlbmd0aCkpO1xuICAgICAgICBpZiAoZm91bmQgPiAtMSAmJiBmb3VuZCA8PSBwcmltLmhlYWQuY2gpXG4gICAgICAgICAgaW5wdXQuY29tcG9zaW5nLnNlbCA9IHNpbXBsZVNlbGVjdGlvbihQb3MocHJpbS5oZWFkLmxpbmUsIGZvdW5kKSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFBvcyhwcmltLmhlYWQubGluZSwgZm91bmQgKyBkYXRhLmxlbmd0aCkpO1xuICAgICAgfSk7XG4gICAgICBvbihkaXYsIFwiY29tcG9zaXRpb251cGRhdGVcIiwgZnVuY3Rpb24oZSkge1xuICAgICAgICBpbnB1dC5jb21wb3NpbmcuZGF0YSA9IGUuZGF0YTtcbiAgICAgIH0pO1xuICAgICAgb24oZGl2LCBcImNvbXBvc2l0aW9uZW5kXCIsIGZ1bmN0aW9uKGUpIHtcbiAgICAgICAgdmFyIG91cnMgPSBpbnB1dC5jb21wb3Npbmc7XG4gICAgICAgIGlmICghb3VycykgcmV0dXJuO1xuICAgICAgICBpZiAoZS5kYXRhICE9IG91cnMuc3RhcnREYXRhICYmICEvXFx1MjAwYi8udGVzdChlLmRhdGEpKVxuICAgICAgICAgIG91cnMuZGF0YSA9IGUuZGF0YTtcbiAgICAgICAgLy8gTmVlZCBhIHNtYWxsIGRlbGF5IHRvIHByZXZlbnQgb3RoZXIgY29kZSAoaW5wdXQgZXZlbnQsXG4gICAgICAgIC8vIHNlbGVjdGlvbiBwb2xsaW5nKSBmcm9tIGRvaW5nIGRhbWFnZSB3aGVuIGZpcmVkIHJpZ2h0IGFmdGVyXG4gICAgICAgIC8vIGNvbXBvc2l0aW9uZW5kLlxuICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgICAgIGlmICghb3Vycy5oYW5kbGVkKVxuICAgICAgICAgICAgaW5wdXQuYXBwbHlDb21wb3NpdGlvbihvdXJzKTtcbiAgICAgICAgICBpZiAoaW5wdXQuY29tcG9zaW5nID09IG91cnMpXG4gICAgICAgICAgICBpbnB1dC5jb21wb3NpbmcgPSBudWxsO1xuICAgICAgICB9LCA1MCk7XG4gICAgICB9KTtcblxuICAgICAgb24oZGl2LCBcInRvdWNoc3RhcnRcIiwgZnVuY3Rpb24oKSB7XG4gICAgICAgIGlucHV0LmZvcmNlQ29tcG9zaXRpb25FbmQoKTtcbiAgICAgIH0pO1xuXG4gICAgICBvbihkaXYsIFwiaW5wdXRcIiwgZnVuY3Rpb24oKSB7XG4gICAgICAgIGlmIChpbnB1dC5jb21wb3NpbmcpIHJldHVybjtcbiAgICAgICAgaWYgKCFpbnB1dC5wb2xsQ29udGVudCgpKVxuICAgICAgICAgIHJ1bkluT3AoaW5wdXQuY20sIGZ1bmN0aW9uKCkge3JlZ0NoYW5nZShjbSk7fSk7XG4gICAgICB9KTtcblxuICAgICAgZnVuY3Rpb24gb25Db3B5Q3V0KGUpIHtcbiAgICAgICAgaWYgKGNtLnNvbWV0aGluZ1NlbGVjdGVkKCkpIHtcbiAgICAgICAgICBsYXN0Q29waWVkID0gY20uZ2V0U2VsZWN0aW9ucygpO1xuICAgICAgICAgIGlmIChlLnR5cGUgPT0gXCJjdXRcIikgY20ucmVwbGFjZVNlbGVjdGlvbihcIlwiLCBudWxsLCBcImN1dFwiKTtcbiAgICAgICAgfSBlbHNlIGlmICghY20ub3B0aW9ucy5saW5lV2lzZUNvcHlDdXQpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdmFyIHJhbmdlcyA9IGNvcHlhYmxlUmFuZ2VzKGNtKTtcbiAgICAgICAgICBsYXN0Q29waWVkID0gcmFuZ2VzLnRleHQ7XG4gICAgICAgICAgaWYgKGUudHlwZSA9PSBcImN1dFwiKSB7XG4gICAgICAgICAgICBjbS5vcGVyYXRpb24oZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgIGNtLnNldFNlbGVjdGlvbnMocmFuZ2VzLnJhbmdlcywgMCwgc2VsX2RvbnRTY3JvbGwpO1xuICAgICAgICAgICAgICBjbS5yZXBsYWNlU2VsZWN0aW9uKFwiXCIsIG51bGwsIFwiY3V0XCIpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIC8vIGlPUyBleHBvc2VzIHRoZSBjbGlwYm9hcmQgQVBJLCBidXQgc2VlbXMgdG8gZGlzY2FyZCBjb250ZW50IGluc2VydGVkIGludG8gaXRcbiAgICAgICAgaWYgKGUuY2xpcGJvYXJkRGF0YSAmJiAhaW9zKSB7XG4gICAgICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAgIGUuY2xpcGJvYXJkRGF0YS5jbGVhckRhdGEoKTtcbiAgICAgICAgICBlLmNsaXBib2FyZERhdGEuc2V0RGF0YShcInRleHQvcGxhaW5cIiwgbGFzdENvcGllZC5qb2luKFwiXFxuXCIpKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBPbGQtZmFzaGlvbmVkIGJyaWVmbHktZm9jdXMtYS10ZXh0YXJlYSBoYWNrXG4gICAgICAgICAgdmFyIGtsdWRnZSA9IGhpZGRlblRleHRhcmVhKCksIHRlID0ga2x1ZGdlLmZpcnN0Q2hpbGQ7XG4gICAgICAgICAgY20uZGlzcGxheS5saW5lU3BhY2UuaW5zZXJ0QmVmb3JlKGtsdWRnZSwgY20uZGlzcGxheS5saW5lU3BhY2UuZmlyc3RDaGlsZCk7XG4gICAgICAgICAgdGUudmFsdWUgPSBsYXN0Q29waWVkLmpvaW4oXCJcXG5cIik7XG4gICAgICAgICAgdmFyIGhhZEZvY3VzID0gZG9jdW1lbnQuYWN0aXZlRWxlbWVudDtcbiAgICAgICAgICBzZWxlY3RJbnB1dCh0ZSk7XG4gICAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIGNtLmRpc3BsYXkubGluZVNwYWNlLnJlbW92ZUNoaWxkKGtsdWRnZSk7XG4gICAgICAgICAgICBoYWRGb2N1cy5mb2N1cygpO1xuICAgICAgICAgIH0sIDUwKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgb24oZGl2LCBcImNvcHlcIiwgb25Db3B5Q3V0KTtcbiAgICAgIG9uKGRpdiwgXCJjdXRcIiwgb25Db3B5Q3V0KTtcbiAgICB9LFxuXG4gICAgcHJlcGFyZVNlbGVjdGlvbjogZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgcmVzdWx0ID0gcHJlcGFyZVNlbGVjdGlvbih0aGlzLmNtLCBmYWxzZSk7XG4gICAgICByZXN1bHQuZm9jdXMgPSB0aGlzLmNtLnN0YXRlLmZvY3VzZWQ7XG4gICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH0sXG5cbiAgICBzaG93U2VsZWN0aW9uOiBmdW5jdGlvbihpbmZvKSB7XG4gICAgICBpZiAoIWluZm8gfHwgIXRoaXMuY20uZGlzcGxheS52aWV3Lmxlbmd0aCkgcmV0dXJuO1xuICAgICAgaWYgKGluZm8uZm9jdXMpIHRoaXMuc2hvd1ByaW1hcnlTZWxlY3Rpb24oKTtcbiAgICAgIHRoaXMuc2hvd011bHRpcGxlU2VsZWN0aW9ucyhpbmZvKTtcbiAgICB9LFxuXG4gICAgc2hvd1ByaW1hcnlTZWxlY3Rpb246IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIHNlbCA9IHdpbmRvdy5nZXRTZWxlY3Rpb24oKSwgcHJpbSA9IHRoaXMuY20uZG9jLnNlbC5wcmltYXJ5KCk7XG4gICAgICB2YXIgY3VyQW5jaG9yID0gZG9tVG9Qb3ModGhpcy5jbSwgc2VsLmFuY2hvck5vZGUsIHNlbC5hbmNob3JPZmZzZXQpO1xuICAgICAgdmFyIGN1ckZvY3VzID0gZG9tVG9Qb3ModGhpcy5jbSwgc2VsLmZvY3VzTm9kZSwgc2VsLmZvY3VzT2Zmc2V0KTtcbiAgICAgIGlmIChjdXJBbmNob3IgJiYgIWN1ckFuY2hvci5iYWQgJiYgY3VyRm9jdXMgJiYgIWN1ckZvY3VzLmJhZCAmJlxuICAgICAgICAgIGNtcChtaW5Qb3MoY3VyQW5jaG9yLCBjdXJGb2N1cyksIHByaW0uZnJvbSgpKSA9PSAwICYmXG4gICAgICAgICAgY21wKG1heFBvcyhjdXJBbmNob3IsIGN1ckZvY3VzKSwgcHJpbS50bygpKSA9PSAwKVxuICAgICAgICByZXR1cm47XG5cbiAgICAgIHZhciBzdGFydCA9IHBvc1RvRE9NKHRoaXMuY20sIHByaW0uZnJvbSgpKTtcbiAgICAgIHZhciBlbmQgPSBwb3NUb0RPTSh0aGlzLmNtLCBwcmltLnRvKCkpO1xuICAgICAgaWYgKCFzdGFydCAmJiAhZW5kKSByZXR1cm47XG5cbiAgICAgIHZhciB2aWV3ID0gdGhpcy5jbS5kaXNwbGF5LnZpZXc7XG4gICAgICB2YXIgb2xkID0gc2VsLnJhbmdlQ291bnQgJiYgc2VsLmdldFJhbmdlQXQoMCk7XG4gICAgICBpZiAoIXN0YXJ0KSB7XG4gICAgICAgIHN0YXJ0ID0ge25vZGU6IHZpZXdbMF0ubWVhc3VyZS5tYXBbMl0sIG9mZnNldDogMH07XG4gICAgICB9IGVsc2UgaWYgKCFlbmQpIHsgLy8gRklYTUUgZGFuZ2Vyb3VzbHkgaGFja3lcbiAgICAgICAgdmFyIG1lYXN1cmUgPSB2aWV3W3ZpZXcubGVuZ3RoIC0gMV0ubWVhc3VyZTtcbiAgICAgICAgdmFyIG1hcCA9IG1lYXN1cmUubWFwcyA/IG1lYXN1cmUubWFwc1ttZWFzdXJlLm1hcHMubGVuZ3RoIC0gMV0gOiBtZWFzdXJlLm1hcDtcbiAgICAgICAgZW5kID0ge25vZGU6IG1hcFttYXAubGVuZ3RoIC0gMV0sIG9mZnNldDogbWFwW21hcC5sZW5ndGggLSAyXSAtIG1hcFttYXAubGVuZ3RoIC0gM119O1xuICAgICAgfVxuXG4gICAgICB0cnkgeyB2YXIgcm5nID0gcmFuZ2Uoc3RhcnQubm9kZSwgc3RhcnQub2Zmc2V0LCBlbmQub2Zmc2V0LCBlbmQubm9kZSk7IH1cbiAgICAgIGNhdGNoKGUpIHt9IC8vIE91ciBtb2RlbCBvZiB0aGUgRE9NIG1pZ2h0IGJlIG91dGRhdGVkLCBpbiB3aGljaCBjYXNlIHRoZSByYW5nZSB3ZSB0cnkgdG8gc2V0IGNhbiBiZSBpbXBvc3NpYmxlXG4gICAgICBpZiAocm5nKSB7XG4gICAgICAgIHNlbC5yZW1vdmVBbGxSYW5nZXMoKTtcbiAgICAgICAgc2VsLmFkZFJhbmdlKHJuZyk7XG4gICAgICAgIGlmIChvbGQgJiYgc2VsLmFuY2hvck5vZGUgPT0gbnVsbCkgc2VsLmFkZFJhbmdlKG9sZCk7XG4gICAgICAgIGVsc2UgaWYgKGdlY2tvKSB0aGlzLnN0YXJ0R3JhY2VQZXJpb2QoKTtcbiAgICAgIH1cbiAgICAgIHRoaXMucmVtZW1iZXJTZWxlY3Rpb24oKTtcbiAgICB9LFxuXG4gICAgc3RhcnRHcmFjZVBlcmlvZDogZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgaW5wdXQgPSB0aGlzO1xuICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuZ3JhY2VQZXJpb2QpO1xuICAgICAgdGhpcy5ncmFjZVBlcmlvZCA9IHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAgIGlucHV0LmdyYWNlUGVyaW9kID0gZmFsc2U7XG4gICAgICAgIGlmIChpbnB1dC5zZWxlY3Rpb25DaGFuZ2VkKCkpXG4gICAgICAgICAgaW5wdXQuY20ub3BlcmF0aW9uKGZ1bmN0aW9uKCkgeyBpbnB1dC5jbS5jdXJPcC5zZWxlY3Rpb25DaGFuZ2VkID0gdHJ1ZTsgfSk7XG4gICAgICB9LCAyMCk7XG4gICAgfSxcblxuICAgIHNob3dNdWx0aXBsZVNlbGVjdGlvbnM6IGZ1bmN0aW9uKGluZm8pIHtcbiAgICAgIHJlbW92ZUNoaWxkcmVuQW5kQWRkKHRoaXMuY20uZGlzcGxheS5jdXJzb3JEaXYsIGluZm8uY3Vyc29ycyk7XG4gICAgICByZW1vdmVDaGlsZHJlbkFuZEFkZCh0aGlzLmNtLmRpc3BsYXkuc2VsZWN0aW9uRGl2LCBpbmZvLnNlbGVjdGlvbik7XG4gICAgfSxcblxuICAgIHJlbWVtYmVyU2VsZWN0aW9uOiBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBzZWwgPSB3aW5kb3cuZ2V0U2VsZWN0aW9uKCk7XG4gICAgICB0aGlzLmxhc3RBbmNob3JOb2RlID0gc2VsLmFuY2hvck5vZGU7IHRoaXMubGFzdEFuY2hvck9mZnNldCA9IHNlbC5hbmNob3JPZmZzZXQ7XG4gICAgICB0aGlzLmxhc3RGb2N1c05vZGUgPSBzZWwuZm9jdXNOb2RlOyB0aGlzLmxhc3RGb2N1c09mZnNldCA9IHNlbC5mb2N1c09mZnNldDtcbiAgICB9LFxuXG4gICAgc2VsZWN0aW9uSW5FZGl0b3I6IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIHNlbCA9IHdpbmRvdy5nZXRTZWxlY3Rpb24oKTtcbiAgICAgIGlmICghc2VsLnJhbmdlQ291bnQpIHJldHVybiBmYWxzZTtcbiAgICAgIHZhciBub2RlID0gc2VsLmdldFJhbmdlQXQoMCkuY29tbW9uQW5jZXN0b3JDb250YWluZXI7XG4gICAgICByZXR1cm4gY29udGFpbnModGhpcy5kaXYsIG5vZGUpO1xuICAgIH0sXG5cbiAgICBmb2N1czogZnVuY3Rpb24oKSB7XG4gICAgICBpZiAodGhpcy5jbS5vcHRpb25zLnJlYWRPbmx5ICE9IFwibm9jdXJzb3JcIikgdGhpcy5kaXYuZm9jdXMoKTtcbiAgICB9LFxuICAgIGJsdXI6IGZ1bmN0aW9uKCkgeyB0aGlzLmRpdi5ibHVyKCk7IH0sXG4gICAgZ2V0RmllbGQ6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy5kaXY7IH0sXG5cbiAgICBzdXBwb3J0c1RvdWNoOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRydWU7IH0sXG5cbiAgICByZWNlaXZlZEZvY3VzOiBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBpbnB1dCA9IHRoaXM7XG4gICAgICBpZiAodGhpcy5zZWxlY3Rpb25JbkVkaXRvcigpKVxuICAgICAgICB0aGlzLnBvbGxTZWxlY3Rpb24oKTtcbiAgICAgIGVsc2VcbiAgICAgICAgcnVuSW5PcCh0aGlzLmNtLCBmdW5jdGlvbigpIHsgaW5wdXQuY20uY3VyT3Auc2VsZWN0aW9uQ2hhbmdlZCA9IHRydWU7IH0pO1xuXG4gICAgICBmdW5jdGlvbiBwb2xsKCkge1xuICAgICAgICBpZiAoaW5wdXQuY20uc3RhdGUuZm9jdXNlZCkge1xuICAgICAgICAgIGlucHV0LnBvbGxTZWxlY3Rpb24oKTtcbiAgICAgICAgICBpbnB1dC5wb2xsaW5nLnNldChpbnB1dC5jbS5vcHRpb25zLnBvbGxJbnRlcnZhbCwgcG9sbCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHRoaXMucG9sbGluZy5zZXQodGhpcy5jbS5vcHRpb25zLnBvbGxJbnRlcnZhbCwgcG9sbCk7XG4gICAgfSxcblxuICAgIHNlbGVjdGlvbkNoYW5nZWQ6IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIHNlbCA9IHdpbmRvdy5nZXRTZWxlY3Rpb24oKTtcbiAgICAgIHJldHVybiBzZWwuYW5jaG9yTm9kZSAhPSB0aGlzLmxhc3RBbmNob3JOb2RlIHx8IHNlbC5hbmNob3JPZmZzZXQgIT0gdGhpcy5sYXN0QW5jaG9yT2Zmc2V0IHx8XG4gICAgICAgIHNlbC5mb2N1c05vZGUgIT0gdGhpcy5sYXN0Rm9jdXNOb2RlIHx8IHNlbC5mb2N1c09mZnNldCAhPSB0aGlzLmxhc3RGb2N1c09mZnNldDtcbiAgICB9LFxuXG4gICAgcG9sbFNlbGVjdGlvbjogZnVuY3Rpb24oKSB7XG4gICAgICBpZiAoIXRoaXMuY29tcG9zaW5nICYmICF0aGlzLmdyYWNlUGVyaW9kICYmIHRoaXMuc2VsZWN0aW9uQ2hhbmdlZCgpKSB7XG4gICAgICAgIHZhciBzZWwgPSB3aW5kb3cuZ2V0U2VsZWN0aW9uKCksIGNtID0gdGhpcy5jbTtcbiAgICAgICAgdGhpcy5yZW1lbWJlclNlbGVjdGlvbigpO1xuICAgICAgICB2YXIgYW5jaG9yID0gZG9tVG9Qb3MoY20sIHNlbC5hbmNob3JOb2RlLCBzZWwuYW5jaG9yT2Zmc2V0KTtcbiAgICAgICAgdmFyIGhlYWQgPSBkb21Ub1BvcyhjbSwgc2VsLmZvY3VzTm9kZSwgc2VsLmZvY3VzT2Zmc2V0KTtcbiAgICAgICAgaWYgKGFuY2hvciAmJiBoZWFkKSBydW5Jbk9wKGNtLCBmdW5jdGlvbigpIHtcbiAgICAgICAgICBzZXRTZWxlY3Rpb24oY20uZG9jLCBzaW1wbGVTZWxlY3Rpb24oYW5jaG9yLCBoZWFkKSwgc2VsX2RvbnRTY3JvbGwpO1xuICAgICAgICAgIGlmIChhbmNob3IuYmFkIHx8IGhlYWQuYmFkKSBjbS5jdXJPcC5zZWxlY3Rpb25DaGFuZ2VkID0gdHJ1ZTtcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSxcblxuICAgIHBvbGxDb250ZW50OiBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBjbSA9IHRoaXMuY20sIGRpc3BsYXkgPSBjbS5kaXNwbGF5LCBzZWwgPSBjbS5kb2Muc2VsLnByaW1hcnkoKTtcbiAgICAgIHZhciBmcm9tID0gc2VsLmZyb20oKSwgdG8gPSBzZWwudG8oKTtcbiAgICAgIGlmIChmcm9tLmxpbmUgPCBkaXNwbGF5LnZpZXdGcm9tIHx8IHRvLmxpbmUgPiBkaXNwbGF5LnZpZXdUbyAtIDEpIHJldHVybiBmYWxzZTtcblxuICAgICAgdmFyIGZyb21JbmRleDtcbiAgICAgIGlmIChmcm9tLmxpbmUgPT0gZGlzcGxheS52aWV3RnJvbSB8fCAoZnJvbUluZGV4ID0gZmluZFZpZXdJbmRleChjbSwgZnJvbS5saW5lKSkgPT0gMCkge1xuICAgICAgICB2YXIgZnJvbUxpbmUgPSBsaW5lTm8oZGlzcGxheS52aWV3WzBdLmxpbmUpO1xuICAgICAgICB2YXIgZnJvbU5vZGUgPSBkaXNwbGF5LnZpZXdbMF0ubm9kZTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHZhciBmcm9tTGluZSA9IGxpbmVObyhkaXNwbGF5LnZpZXdbZnJvbUluZGV4XS5saW5lKTtcbiAgICAgICAgdmFyIGZyb21Ob2RlID0gZGlzcGxheS52aWV3W2Zyb21JbmRleCAtIDFdLm5vZGUubmV4dFNpYmxpbmc7XG4gICAgICB9XG4gICAgICB2YXIgdG9JbmRleCA9IGZpbmRWaWV3SW5kZXgoY20sIHRvLmxpbmUpO1xuICAgICAgaWYgKHRvSW5kZXggPT0gZGlzcGxheS52aWV3Lmxlbmd0aCAtIDEpIHtcbiAgICAgICAgdmFyIHRvTGluZSA9IGRpc3BsYXkudmlld1RvIC0gMTtcbiAgICAgICAgdmFyIHRvTm9kZSA9IGRpc3BsYXkubGluZURpdi5sYXN0Q2hpbGQ7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB2YXIgdG9MaW5lID0gbGluZU5vKGRpc3BsYXkudmlld1t0b0luZGV4ICsgMV0ubGluZSkgLSAxO1xuICAgICAgICB2YXIgdG9Ob2RlID0gZGlzcGxheS52aWV3W3RvSW5kZXggKyAxXS5ub2RlLnByZXZpb3VzU2libGluZztcbiAgICAgIH1cblxuICAgICAgdmFyIG5ld1RleHQgPSBzcGxpdExpbmVzKGRvbVRleHRCZXR3ZWVuKGNtLCBmcm9tTm9kZSwgdG9Ob2RlLCBmcm9tTGluZSwgdG9MaW5lKSk7XG4gICAgICB2YXIgb2xkVGV4dCA9IGdldEJldHdlZW4oY20uZG9jLCBQb3MoZnJvbUxpbmUsIDApLCBQb3ModG9MaW5lLCBnZXRMaW5lKGNtLmRvYywgdG9MaW5lKS50ZXh0Lmxlbmd0aCkpO1xuICAgICAgd2hpbGUgKG5ld1RleHQubGVuZ3RoID4gMSAmJiBvbGRUZXh0Lmxlbmd0aCA+IDEpIHtcbiAgICAgICAgaWYgKGxzdChuZXdUZXh0KSA9PSBsc3Qob2xkVGV4dCkpIHsgbmV3VGV4dC5wb3AoKTsgb2xkVGV4dC5wb3AoKTsgdG9MaW5lLS07IH1cbiAgICAgICAgZWxzZSBpZiAobmV3VGV4dFswXSA9PSBvbGRUZXh0WzBdKSB7IG5ld1RleHQuc2hpZnQoKTsgb2xkVGV4dC5zaGlmdCgpOyBmcm9tTGluZSsrOyB9XG4gICAgICAgIGVsc2UgYnJlYWs7XG4gICAgICB9XG5cbiAgICAgIHZhciBjdXRGcm9udCA9IDAsIGN1dEVuZCA9IDA7XG4gICAgICB2YXIgbmV3VG9wID0gbmV3VGV4dFswXSwgb2xkVG9wID0gb2xkVGV4dFswXSwgbWF4Q3V0RnJvbnQgPSBNYXRoLm1pbihuZXdUb3AubGVuZ3RoLCBvbGRUb3AubGVuZ3RoKTtcbiAgICAgIHdoaWxlIChjdXRGcm9udCA8IG1heEN1dEZyb250ICYmIG5ld1RvcC5jaGFyQ29kZUF0KGN1dEZyb250KSA9PSBvbGRUb3AuY2hhckNvZGVBdChjdXRGcm9udCkpXG4gICAgICAgICsrY3V0RnJvbnQ7XG4gICAgICB2YXIgbmV3Qm90ID0gbHN0KG5ld1RleHQpLCBvbGRCb3QgPSBsc3Qob2xkVGV4dCk7XG4gICAgICB2YXIgbWF4Q3V0RW5kID0gTWF0aC5taW4obmV3Qm90Lmxlbmd0aCAtIChuZXdUZXh0Lmxlbmd0aCA9PSAxID8gY3V0RnJvbnQgOiAwKSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvbGRCb3QubGVuZ3RoIC0gKG9sZFRleHQubGVuZ3RoID09IDEgPyBjdXRGcm9udCA6IDApKTtcbiAgICAgIHdoaWxlIChjdXRFbmQgPCBtYXhDdXRFbmQgJiZcbiAgICAgICAgICAgICBuZXdCb3QuY2hhckNvZGVBdChuZXdCb3QubGVuZ3RoIC0gY3V0RW5kIC0gMSkgPT0gb2xkQm90LmNoYXJDb2RlQXQob2xkQm90Lmxlbmd0aCAtIGN1dEVuZCAtIDEpKVxuICAgICAgICArK2N1dEVuZDtcblxuICAgICAgbmV3VGV4dFtuZXdUZXh0Lmxlbmd0aCAtIDFdID0gbmV3Qm90LnNsaWNlKDAsIG5ld0JvdC5sZW5ndGggLSBjdXRFbmQpO1xuICAgICAgbmV3VGV4dFswXSA9IG5ld1RleHRbMF0uc2xpY2UoY3V0RnJvbnQpO1xuXG4gICAgICB2YXIgY2hGcm9tID0gUG9zKGZyb21MaW5lLCBjdXRGcm9udCk7XG4gICAgICB2YXIgY2hUbyA9IFBvcyh0b0xpbmUsIG9sZFRleHQubGVuZ3RoID8gbHN0KG9sZFRleHQpLmxlbmd0aCAtIGN1dEVuZCA6IDApO1xuICAgICAgaWYgKG5ld1RleHQubGVuZ3RoID4gMSB8fCBuZXdUZXh0WzBdIHx8IGNtcChjaEZyb20sIGNoVG8pKSB7XG4gICAgICAgIHJlcGxhY2VSYW5nZShjbS5kb2MsIG5ld1RleHQsIGNoRnJvbSwgY2hUbywgXCIraW5wdXRcIik7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICBlbnN1cmVQb2xsZWQ6IGZ1bmN0aW9uKCkge1xuICAgICAgdGhpcy5mb3JjZUNvbXBvc2l0aW9uRW5kKCk7XG4gICAgfSxcbiAgICByZXNldDogZnVuY3Rpb24oKSB7XG4gICAgICB0aGlzLmZvcmNlQ29tcG9zaXRpb25FbmQoKTtcbiAgICB9LFxuICAgIGZvcmNlQ29tcG9zaXRpb25FbmQ6IGZ1bmN0aW9uKCkge1xuICAgICAgaWYgKCF0aGlzLmNvbXBvc2luZyB8fCB0aGlzLmNvbXBvc2luZy5oYW5kbGVkKSByZXR1cm47XG4gICAgICB0aGlzLmFwcGx5Q29tcG9zaXRpb24odGhpcy5jb21wb3NpbmcpO1xuICAgICAgdGhpcy5jb21wb3NpbmcuaGFuZGxlZCA9IHRydWU7XG4gICAgICB0aGlzLmRpdi5ibHVyKCk7XG4gICAgICB0aGlzLmRpdi5mb2N1cygpO1xuICAgIH0sXG4gICAgYXBwbHlDb21wb3NpdGlvbjogZnVuY3Rpb24oY29tcG9zaW5nKSB7XG4gICAgICBpZiAoY29tcG9zaW5nLmRhdGEgJiYgY29tcG9zaW5nLmRhdGEgIT0gY29tcG9zaW5nLnN0YXJ0RGF0YSlcbiAgICAgICAgb3BlcmF0aW9uKHRoaXMuY20sIGFwcGx5VGV4dElucHV0KSh0aGlzLmNtLCBjb21wb3NpbmcuZGF0YSwgMCwgY29tcG9zaW5nLnNlbCk7XG4gICAgfSxcblxuICAgIHNldFVuZWRpdGFibGU6IGZ1bmN0aW9uKG5vZGUpIHtcbiAgICAgIG5vZGUuc2V0QXR0cmlidXRlKFwiY29udGVudGVkaXRhYmxlXCIsIFwiZmFsc2VcIik7XG4gICAgfSxcblxuICAgIG9uS2V5UHJlc3M6IGZ1bmN0aW9uKGUpIHtcbiAgICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICAgIG9wZXJhdGlvbih0aGlzLmNtLCBhcHBseVRleHRJbnB1dCkodGhpcy5jbSwgU3RyaW5nLmZyb21DaGFyQ29kZShlLmNoYXJDb2RlID09IG51bGwgPyBlLmtleUNvZGUgOiBlLmNoYXJDb2RlKSwgMCk7XG4gICAgfSxcblxuICAgIG9uQ29udGV4dE1lbnU6IG5vdGhpbmcsXG4gICAgcmVzZXRQb3NpdGlvbjogbm90aGluZyxcblxuICAgIG5lZWRzQ29udGVudEF0dHJpYnV0ZTogdHJ1ZVxuICB9LCBDb250ZW50RWRpdGFibGVJbnB1dC5wcm90b3R5cGUpO1xuXG4gIGZ1bmN0aW9uIHBvc1RvRE9NKGNtLCBwb3MpIHtcbiAgICB2YXIgdmlldyA9IGZpbmRWaWV3Rm9yTGluZShjbSwgcG9zLmxpbmUpO1xuICAgIGlmICghdmlldyB8fCB2aWV3LmhpZGRlbikgcmV0dXJuIG51bGw7XG4gICAgdmFyIGxpbmUgPSBnZXRMaW5lKGNtLmRvYywgcG9zLmxpbmUpO1xuICAgIHZhciBpbmZvID0gbWFwRnJvbUxpbmVWaWV3KHZpZXcsIGxpbmUsIHBvcy5saW5lKTtcblxuICAgIHZhciBvcmRlciA9IGdldE9yZGVyKGxpbmUpLCBzaWRlID0gXCJsZWZ0XCI7XG4gICAgaWYgKG9yZGVyKSB7XG4gICAgICB2YXIgcGFydFBvcyA9IGdldEJpZGlQYXJ0QXQob3JkZXIsIHBvcy5jaCk7XG4gICAgICBzaWRlID0gcGFydFBvcyAlIDIgPyBcInJpZ2h0XCIgOiBcImxlZnRcIjtcbiAgICB9XG4gICAgdmFyIHJlc3VsdCA9IG5vZGVBbmRPZmZzZXRJbkxpbmVNYXAoaW5mby5tYXAsIHBvcy5jaCwgc2lkZSk7XG4gICAgcmVzdWx0Lm9mZnNldCA9IHJlc3VsdC5jb2xsYXBzZSA9PSBcInJpZ2h0XCIgPyByZXN1bHQuZW5kIDogcmVzdWx0LnN0YXJ0O1xuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cblxuICBmdW5jdGlvbiBiYWRQb3MocG9zLCBiYWQpIHsgaWYgKGJhZCkgcG9zLmJhZCA9IHRydWU7IHJldHVybiBwb3M7IH1cblxuICBmdW5jdGlvbiBkb21Ub1BvcyhjbSwgbm9kZSwgb2Zmc2V0KSB7XG4gICAgdmFyIGxpbmVOb2RlO1xuICAgIGlmIChub2RlID09IGNtLmRpc3BsYXkubGluZURpdikge1xuICAgICAgbGluZU5vZGUgPSBjbS5kaXNwbGF5LmxpbmVEaXYuY2hpbGROb2Rlc1tvZmZzZXRdO1xuICAgICAgaWYgKCFsaW5lTm9kZSkgcmV0dXJuIGJhZFBvcyhjbS5jbGlwUG9zKFBvcyhjbS5kaXNwbGF5LnZpZXdUbyAtIDEpKSwgdHJ1ZSk7XG4gICAgICBub2RlID0gbnVsbDsgb2Zmc2V0ID0gMDtcbiAgICB9IGVsc2Uge1xuICAgICAgZm9yIChsaW5lTm9kZSA9IG5vZGU7OyBsaW5lTm9kZSA9IGxpbmVOb2RlLnBhcmVudE5vZGUpIHtcbiAgICAgICAgaWYgKCFsaW5lTm9kZSB8fCBsaW5lTm9kZSA9PSBjbS5kaXNwbGF5LmxpbmVEaXYpIHJldHVybiBudWxsO1xuICAgICAgICBpZiAobGluZU5vZGUucGFyZW50Tm9kZSAmJiBsaW5lTm9kZS5wYXJlbnROb2RlID09IGNtLmRpc3BsYXkubGluZURpdikgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgY20uZGlzcGxheS52aWV3Lmxlbmd0aDsgaSsrKSB7XG4gICAgICB2YXIgbGluZVZpZXcgPSBjbS5kaXNwbGF5LnZpZXdbaV07XG4gICAgICBpZiAobGluZVZpZXcubm9kZSA9PSBsaW5lTm9kZSlcbiAgICAgICAgcmV0dXJuIGxvY2F0ZU5vZGVJbkxpbmVWaWV3KGxpbmVWaWV3LCBub2RlLCBvZmZzZXQpO1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIGxvY2F0ZU5vZGVJbkxpbmVWaWV3KGxpbmVWaWV3LCBub2RlLCBvZmZzZXQpIHtcbiAgICB2YXIgd3JhcHBlciA9IGxpbmVWaWV3LnRleHQuZmlyc3RDaGlsZCwgYmFkID0gZmFsc2U7XG4gICAgaWYgKCFub2RlIHx8ICFjb250YWlucyh3cmFwcGVyLCBub2RlKSkgcmV0dXJuIGJhZFBvcyhQb3MobGluZU5vKGxpbmVWaWV3LmxpbmUpLCAwKSwgdHJ1ZSk7XG4gICAgaWYgKG5vZGUgPT0gd3JhcHBlcikge1xuICAgICAgYmFkID0gdHJ1ZTtcbiAgICAgIG5vZGUgPSB3cmFwcGVyLmNoaWxkTm9kZXNbb2Zmc2V0XTtcbiAgICAgIG9mZnNldCA9IDA7XG4gICAgICBpZiAoIW5vZGUpIHtcbiAgICAgICAgdmFyIGxpbmUgPSBsaW5lVmlldy5yZXN0ID8gbHN0KGxpbmVWaWV3LnJlc3QpIDogbGluZVZpZXcubGluZTtcbiAgICAgICAgcmV0dXJuIGJhZFBvcyhQb3MobGluZU5vKGxpbmUpLCBsaW5lLnRleHQubGVuZ3RoKSwgYmFkKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICB2YXIgdGV4dE5vZGUgPSBub2RlLm5vZGVUeXBlID09IDMgPyBub2RlIDogbnVsbCwgdG9wTm9kZSA9IG5vZGU7XG4gICAgaWYgKCF0ZXh0Tm9kZSAmJiBub2RlLmNoaWxkTm9kZXMubGVuZ3RoID09IDEgJiYgbm9kZS5maXJzdENoaWxkLm5vZGVUeXBlID09IDMpIHtcbiAgICAgIHRleHROb2RlID0gbm9kZS5maXJzdENoaWxkO1xuICAgICAgaWYgKG9mZnNldCkgb2Zmc2V0ID0gdGV4dE5vZGUubm9kZVZhbHVlLmxlbmd0aDtcbiAgICB9XG4gICAgd2hpbGUgKHRvcE5vZGUucGFyZW50Tm9kZSAhPSB3cmFwcGVyKSB0b3BOb2RlID0gdG9wTm9kZS5wYXJlbnROb2RlO1xuICAgIHZhciBtZWFzdXJlID0gbGluZVZpZXcubWVhc3VyZSwgbWFwcyA9IG1lYXN1cmUubWFwcztcblxuICAgIGZ1bmN0aW9uIGZpbmQodGV4dE5vZGUsIHRvcE5vZGUsIG9mZnNldCkge1xuICAgICAgZm9yICh2YXIgaSA9IC0xOyBpIDwgKG1hcHMgPyBtYXBzLmxlbmd0aCA6IDApOyBpKyspIHtcbiAgICAgICAgdmFyIG1hcCA9IGkgPCAwID8gbWVhc3VyZS5tYXAgOiBtYXBzW2ldO1xuICAgICAgICBmb3IgKHZhciBqID0gMDsgaiA8IG1hcC5sZW5ndGg7IGogKz0gMykge1xuICAgICAgICAgIHZhciBjdXJOb2RlID0gbWFwW2ogKyAyXTtcbiAgICAgICAgICBpZiAoY3VyTm9kZSA9PSB0ZXh0Tm9kZSB8fCBjdXJOb2RlID09IHRvcE5vZGUpIHtcbiAgICAgICAgICAgIHZhciBsaW5lID0gbGluZU5vKGkgPCAwID8gbGluZVZpZXcubGluZSA6IGxpbmVWaWV3LnJlc3RbaV0pO1xuICAgICAgICAgICAgdmFyIGNoID0gbWFwW2pdICsgb2Zmc2V0O1xuICAgICAgICAgICAgaWYgKG9mZnNldCA8IDAgfHwgY3VyTm9kZSAhPSB0ZXh0Tm9kZSkgY2ggPSBtYXBbaiArIChvZmZzZXQgPyAxIDogMCldO1xuICAgICAgICAgICAgcmV0dXJuIFBvcyhsaW5lLCBjaCk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIHZhciBmb3VuZCA9IGZpbmQodGV4dE5vZGUsIHRvcE5vZGUsIG9mZnNldCk7XG4gICAgaWYgKGZvdW5kKSByZXR1cm4gYmFkUG9zKGZvdW5kLCBiYWQpO1xuXG4gICAgLy8gRklYTUUgdGhpcyBpcyBhbGwgcmVhbGx5IHNoYWt5LiBtaWdodCBoYW5kbGUgdGhlIGZldyBjYXNlcyBpdCBuZWVkcyB0byBoYW5kbGUsIGJ1dCBsaWtlbHkgdG8gY2F1c2UgcHJvYmxlbXNcbiAgICBmb3IgKHZhciBhZnRlciA9IHRvcE5vZGUubmV4dFNpYmxpbmcsIGRpc3QgPSB0ZXh0Tm9kZSA/IHRleHROb2RlLm5vZGVWYWx1ZS5sZW5ndGggLSBvZmZzZXQgOiAwOyBhZnRlcjsgYWZ0ZXIgPSBhZnRlci5uZXh0U2libGluZykge1xuICAgICAgZm91bmQgPSBmaW5kKGFmdGVyLCBhZnRlci5maXJzdENoaWxkLCAwKTtcbiAgICAgIGlmIChmb3VuZClcbiAgICAgICAgcmV0dXJuIGJhZFBvcyhQb3MoZm91bmQubGluZSwgZm91bmQuY2ggLSBkaXN0KSwgYmFkKTtcbiAgICAgIGVsc2VcbiAgICAgICAgZGlzdCArPSBhZnRlci50ZXh0Q29udGVudC5sZW5ndGg7XG4gICAgfVxuICAgIGZvciAodmFyIGJlZm9yZSA9IHRvcE5vZGUucHJldmlvdXNTaWJsaW5nLCBkaXN0ID0gb2Zmc2V0OyBiZWZvcmU7IGJlZm9yZSA9IGJlZm9yZS5wcmV2aW91c1NpYmxpbmcpIHtcbiAgICAgIGZvdW5kID0gZmluZChiZWZvcmUsIGJlZm9yZS5maXJzdENoaWxkLCAtMSk7XG4gICAgICBpZiAoZm91bmQpXG4gICAgICAgIHJldHVybiBiYWRQb3MoUG9zKGZvdW5kLmxpbmUsIGZvdW5kLmNoICsgZGlzdCksIGJhZCk7XG4gICAgICBlbHNlXG4gICAgICAgIGRpc3QgKz0gYWZ0ZXIudGV4dENvbnRlbnQubGVuZ3RoO1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIGRvbVRleHRCZXR3ZWVuKGNtLCBmcm9tLCB0bywgZnJvbUxpbmUsIHRvTGluZSkge1xuICAgIHZhciB0ZXh0ID0gXCJcIiwgY2xvc2luZyA9IGZhbHNlO1xuICAgIGZ1bmN0aW9uIHJlY29nbml6ZU1hcmtlcihpZCkgeyByZXR1cm4gZnVuY3Rpb24obWFya2VyKSB7IHJldHVybiBtYXJrZXIuaWQgPT0gaWQ7IH07IH1cbiAgICBmdW5jdGlvbiB3YWxrKG5vZGUpIHtcbiAgICAgIGlmIChub2RlLm5vZGVUeXBlID09IDEpIHtcbiAgICAgICAgdmFyIGNtVGV4dCA9IG5vZGUuZ2V0QXR0cmlidXRlKFwiY20tdGV4dFwiKTtcbiAgICAgICAgaWYgKGNtVGV4dCAhPSBudWxsKSB7XG4gICAgICAgICAgaWYgKGNtVGV4dCA9PSBcIlwiKSBjbVRleHQgPSBub2RlLnRleHRDb250ZW50LnJlcGxhY2UoL1xcdTIwMGIvZywgXCJcIik7XG4gICAgICAgICAgdGV4dCArPSBjbVRleHQ7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHZhciBtYXJrZXJJRCA9IG5vZGUuZ2V0QXR0cmlidXRlKFwiY20tbWFya2VyXCIpLCByYW5nZTtcbiAgICAgICAgaWYgKG1hcmtlcklEKSB7XG4gICAgICAgICAgdmFyIGZvdW5kID0gY20uZmluZE1hcmtzKFBvcyhmcm9tTGluZSwgMCksIFBvcyh0b0xpbmUgKyAxLCAwKSwgcmVjb2duaXplTWFya2VyKCttYXJrZXJJRCkpO1xuICAgICAgICAgIGlmIChmb3VuZC5sZW5ndGggJiYgKHJhbmdlID0gZm91bmRbMF0uZmluZCgpKSlcbiAgICAgICAgICAgIHRleHQgKz0gZ2V0QmV0d2VlbihjbS5kb2MsIHJhbmdlLmZyb20sIHJhbmdlLnRvKS5qb2luKFwiXFxuXCIpO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAobm9kZS5nZXRBdHRyaWJ1dGUoXCJjb250ZW50ZWRpdGFibGVcIikgPT0gXCJmYWxzZVwiKSByZXR1cm47XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbm9kZS5jaGlsZE5vZGVzLmxlbmd0aDsgaSsrKVxuICAgICAgICAgIHdhbGsobm9kZS5jaGlsZE5vZGVzW2ldKTtcbiAgICAgICAgaWYgKC9eKHByZXxkaXZ8cCkkL2kudGVzdChub2RlLm5vZGVOYW1lKSlcbiAgICAgICAgICBjbG9zaW5nID0gdHJ1ZTtcbiAgICAgIH0gZWxzZSBpZiAobm9kZS5ub2RlVHlwZSA9PSAzKSB7XG4gICAgICAgIHZhciB2YWwgPSBub2RlLm5vZGVWYWx1ZTtcbiAgICAgICAgaWYgKCF2YWwpIHJldHVybjtcbiAgICAgICAgaWYgKGNsb3NpbmcpIHtcbiAgICAgICAgICB0ZXh0ICs9IFwiXFxuXCI7XG4gICAgICAgICAgY2xvc2luZyA9IGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIHRleHQgKz0gdmFsO1xuICAgICAgfVxuICAgIH1cbiAgICBmb3IgKDs7KSB7XG4gICAgICB3YWxrKGZyb20pO1xuICAgICAgaWYgKGZyb20gPT0gdG8pIGJyZWFrO1xuICAgICAgZnJvbSA9IGZyb20ubmV4dFNpYmxpbmc7XG4gICAgfVxuICAgIHJldHVybiB0ZXh0O1xuICB9XG5cbiAgQ29kZU1pcnJvci5pbnB1dFN0eWxlcyA9IHtcInRleHRhcmVhXCI6IFRleHRhcmVhSW5wdXQsIFwiY29udGVudGVkaXRhYmxlXCI6IENvbnRlbnRFZGl0YWJsZUlucHV0fTtcblxuICAvLyBTRUxFQ1RJT04gLyBDVVJTT1JcblxuICAvLyBTZWxlY3Rpb24gb2JqZWN0cyBhcmUgaW1tdXRhYmxlLiBBIG5ldyBvbmUgaXMgY3JlYXRlZCBldmVyeSB0aW1lXG4gIC8vIHRoZSBzZWxlY3Rpb24gY2hhbmdlcy4gQSBzZWxlY3Rpb24gaXMgb25lIG9yIG1vcmUgbm9uLW92ZXJsYXBwaW5nXG4gIC8vIChhbmQgbm9uLXRvdWNoaW5nKSByYW5nZXMsIHNvcnRlZCwgYW5kIGFuIGludGVnZXIgdGhhdCBpbmRpY2F0ZXNcbiAgLy8gd2hpY2ggb25lIGlzIHRoZSBwcmltYXJ5IHNlbGVjdGlvbiAodGhlIG9uZSB0aGF0J3Mgc2Nyb2xsZWQgaW50b1xuICAvLyB2aWV3LCB0aGF0IGdldEN1cnNvciByZXR1cm5zLCBldGMpLlxuICBmdW5jdGlvbiBTZWxlY3Rpb24ocmFuZ2VzLCBwcmltSW5kZXgpIHtcbiAgICB0aGlzLnJhbmdlcyA9IHJhbmdlcztcbiAgICB0aGlzLnByaW1JbmRleCA9IHByaW1JbmRleDtcbiAgfVxuXG4gIFNlbGVjdGlvbi5wcm90b3R5cGUgPSB7XG4gICAgcHJpbWFyeTogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnJhbmdlc1t0aGlzLnByaW1JbmRleF07IH0sXG4gICAgZXF1YWxzOiBmdW5jdGlvbihvdGhlcikge1xuICAgICAgaWYgKG90aGVyID09IHRoaXMpIHJldHVybiB0cnVlO1xuICAgICAgaWYgKG90aGVyLnByaW1JbmRleCAhPSB0aGlzLnByaW1JbmRleCB8fCBvdGhlci5yYW5nZXMubGVuZ3RoICE9IHRoaXMucmFuZ2VzLmxlbmd0aCkgcmV0dXJuIGZhbHNlO1xuICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLnJhbmdlcy5sZW5ndGg7IGkrKykge1xuICAgICAgICB2YXIgaGVyZSA9IHRoaXMucmFuZ2VzW2ldLCB0aGVyZSA9IG90aGVyLnJhbmdlc1tpXTtcbiAgICAgICAgaWYgKGNtcChoZXJlLmFuY2hvciwgdGhlcmUuYW5jaG9yKSAhPSAwIHx8IGNtcChoZXJlLmhlYWQsIHRoZXJlLmhlYWQpICE9IDApIHJldHVybiBmYWxzZTtcbiAgICAgIH1cbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH0sXG4gICAgZGVlcENvcHk6IGZ1bmN0aW9uKCkge1xuICAgICAgZm9yICh2YXIgb3V0ID0gW10sIGkgPSAwOyBpIDwgdGhpcy5yYW5nZXMubGVuZ3RoOyBpKyspXG4gICAgICAgIG91dFtpXSA9IG5ldyBSYW5nZShjb3B5UG9zKHRoaXMucmFuZ2VzW2ldLmFuY2hvciksIGNvcHlQb3ModGhpcy5yYW5nZXNbaV0uaGVhZCkpO1xuICAgICAgcmV0dXJuIG5ldyBTZWxlY3Rpb24ob3V0LCB0aGlzLnByaW1JbmRleCk7XG4gICAgfSxcbiAgICBzb21ldGhpbmdTZWxlY3RlZDogZnVuY3Rpb24oKSB7XG4gICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMucmFuZ2VzLmxlbmd0aDsgaSsrKVxuICAgICAgICBpZiAoIXRoaXMucmFuZ2VzW2ldLmVtcHR5KCkpIHJldHVybiB0cnVlO1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH0sXG4gICAgY29udGFpbnM6IGZ1bmN0aW9uKHBvcywgZW5kKSB7XG4gICAgICBpZiAoIWVuZCkgZW5kID0gcG9zO1xuICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLnJhbmdlcy5sZW5ndGg7IGkrKykge1xuICAgICAgICB2YXIgcmFuZ2UgPSB0aGlzLnJhbmdlc1tpXTtcbiAgICAgICAgaWYgKGNtcChlbmQsIHJhbmdlLmZyb20oKSkgPj0gMCAmJiBjbXAocG9zLCByYW5nZS50bygpKSA8PSAwKVxuICAgICAgICAgIHJldHVybiBpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIC0xO1xuICAgIH1cbiAgfTtcblxuICBmdW5jdGlvbiBSYW5nZShhbmNob3IsIGhlYWQpIHtcbiAgICB0aGlzLmFuY2hvciA9IGFuY2hvcjsgdGhpcy5oZWFkID0gaGVhZDtcbiAgfVxuXG4gIFJhbmdlLnByb3RvdHlwZSA9IHtcbiAgICBmcm9tOiBmdW5jdGlvbigpIHsgcmV0dXJuIG1pblBvcyh0aGlzLmFuY2hvciwgdGhpcy5oZWFkKTsgfSxcbiAgICB0bzogZnVuY3Rpb24oKSB7IHJldHVybiBtYXhQb3ModGhpcy5hbmNob3IsIHRoaXMuaGVhZCk7IH0sXG4gICAgZW1wdHk6IGZ1bmN0aW9uKCkge1xuICAgICAgcmV0dXJuIHRoaXMuaGVhZC5saW5lID09IHRoaXMuYW5jaG9yLmxpbmUgJiYgdGhpcy5oZWFkLmNoID09IHRoaXMuYW5jaG9yLmNoO1xuICAgIH1cbiAgfTtcblxuICAvLyBUYWtlIGFuIHVuc29ydGVkLCBwb3RlbnRpYWxseSBvdmVybGFwcGluZyBzZXQgb2YgcmFuZ2VzLCBhbmRcbiAgLy8gYnVpbGQgYSBzZWxlY3Rpb24gb3V0IG9mIGl0LiAnQ29uc3VtZXMnIHJhbmdlcyBhcnJheSAobW9kaWZ5aW5nXG4gIC8vIGl0KS5cbiAgZnVuY3Rpb24gbm9ybWFsaXplU2VsZWN0aW9uKHJhbmdlcywgcHJpbUluZGV4KSB7XG4gICAgdmFyIHByaW0gPSByYW5nZXNbcHJpbUluZGV4XTtcbiAgICByYW5nZXMuc29ydChmdW5jdGlvbihhLCBiKSB7IHJldHVybiBjbXAoYS5mcm9tKCksIGIuZnJvbSgpKTsgfSk7XG4gICAgcHJpbUluZGV4ID0gaW5kZXhPZihyYW5nZXMsIHByaW0pO1xuICAgIGZvciAodmFyIGkgPSAxOyBpIDwgcmFuZ2VzLmxlbmd0aDsgaSsrKSB7XG4gICAgICB2YXIgY3VyID0gcmFuZ2VzW2ldLCBwcmV2ID0gcmFuZ2VzW2kgLSAxXTtcbiAgICAgIGlmIChjbXAocHJldi50bygpLCBjdXIuZnJvbSgpKSA+PSAwKSB7XG4gICAgICAgIHZhciBmcm9tID0gbWluUG9zKHByZXYuZnJvbSgpLCBjdXIuZnJvbSgpKSwgdG8gPSBtYXhQb3MocHJldi50bygpLCBjdXIudG8oKSk7XG4gICAgICAgIHZhciBpbnYgPSBwcmV2LmVtcHR5KCkgPyBjdXIuZnJvbSgpID09IGN1ci5oZWFkIDogcHJldi5mcm9tKCkgPT0gcHJldi5oZWFkO1xuICAgICAgICBpZiAoaSA8PSBwcmltSW5kZXgpIC0tcHJpbUluZGV4O1xuICAgICAgICByYW5nZXMuc3BsaWNlKC0taSwgMiwgbmV3IFJhbmdlKGludiA/IHRvIDogZnJvbSwgaW52ID8gZnJvbSA6IHRvKSk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBuZXcgU2VsZWN0aW9uKHJhbmdlcywgcHJpbUluZGV4KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHNpbXBsZVNlbGVjdGlvbihhbmNob3IsIGhlYWQpIHtcbiAgICByZXR1cm4gbmV3IFNlbGVjdGlvbihbbmV3IFJhbmdlKGFuY2hvciwgaGVhZCB8fCBhbmNob3IpXSwgMCk7XG4gIH1cblxuICAvLyBNb3N0IG9mIHRoZSBleHRlcm5hbCBBUEkgY2xpcHMgZ2l2ZW4gcG9zaXRpb25zIHRvIG1ha2Ugc3VyZSB0aGV5XG4gIC8vIGFjdHVhbGx5IGV4aXN0IHdpdGhpbiB0aGUgZG9jdW1lbnQuXG4gIGZ1bmN0aW9uIGNsaXBMaW5lKGRvYywgbikge3JldHVybiBNYXRoLm1heChkb2MuZmlyc3QsIE1hdGgubWluKG4sIGRvYy5maXJzdCArIGRvYy5zaXplIC0gMSkpO31cbiAgZnVuY3Rpb24gY2xpcFBvcyhkb2MsIHBvcykge1xuICAgIGlmIChwb3MubGluZSA8IGRvYy5maXJzdCkgcmV0dXJuIFBvcyhkb2MuZmlyc3QsIDApO1xuICAgIHZhciBsYXN0ID0gZG9jLmZpcnN0ICsgZG9jLnNpemUgLSAxO1xuICAgIGlmIChwb3MubGluZSA+IGxhc3QpIHJldHVybiBQb3MobGFzdCwgZ2V0TGluZShkb2MsIGxhc3QpLnRleHQubGVuZ3RoKTtcbiAgICByZXR1cm4gY2xpcFRvTGVuKHBvcywgZ2V0TGluZShkb2MsIHBvcy5saW5lKS50ZXh0Lmxlbmd0aCk7XG4gIH1cbiAgZnVuY3Rpb24gY2xpcFRvTGVuKHBvcywgbGluZWxlbikge1xuICAgIHZhciBjaCA9IHBvcy5jaDtcbiAgICBpZiAoY2ggPT0gbnVsbCB8fCBjaCA+IGxpbmVsZW4pIHJldHVybiBQb3MocG9zLmxpbmUsIGxpbmVsZW4pO1xuICAgIGVsc2UgaWYgKGNoIDwgMCkgcmV0dXJuIFBvcyhwb3MubGluZSwgMCk7XG4gICAgZWxzZSByZXR1cm4gcG9zO1xuICB9XG4gIGZ1bmN0aW9uIGlzTGluZShkb2MsIGwpIHtyZXR1cm4gbCA+PSBkb2MuZmlyc3QgJiYgbCA8IGRvYy5maXJzdCArIGRvYy5zaXplO31cbiAgZnVuY3Rpb24gY2xpcFBvc0FycmF5KGRvYywgYXJyYXkpIHtcbiAgICBmb3IgKHZhciBvdXQgPSBbXSwgaSA9IDA7IGkgPCBhcnJheS5sZW5ndGg7IGkrKykgb3V0W2ldID0gY2xpcFBvcyhkb2MsIGFycmF5W2ldKTtcbiAgICByZXR1cm4gb3V0O1xuICB9XG5cbiAgLy8gU0VMRUNUSU9OIFVQREFURVNcblxuICAvLyBUaGUgJ3Njcm9sbCcgcGFyYW1ldGVyIGdpdmVuIHRvIG1hbnkgb2YgdGhlc2UgaW5kaWNhdGVkIHdoZXRoZXJcbiAgLy8gdGhlIG5ldyBjdXJzb3IgcG9zaXRpb24gc2hvdWxkIGJlIHNjcm9sbGVkIGludG8gdmlldyBhZnRlclxuICAvLyBtb2RpZnlpbmcgdGhlIHNlbGVjdGlvbi5cblxuICAvLyBJZiBzaGlmdCBpcyBoZWxkIG9yIHRoZSBleHRlbmQgZmxhZyBpcyBzZXQsIGV4dGVuZHMgYSByYW5nZSB0b1xuICAvLyBpbmNsdWRlIGEgZ2l2ZW4gcG9zaXRpb24gKGFuZCBvcHRpb25hbGx5IGEgc2Vjb25kIHBvc2l0aW9uKS5cbiAgLy8gT3RoZXJ3aXNlLCBzaW1wbHkgcmV0dXJucyB0aGUgcmFuZ2UgYmV0d2VlbiB0aGUgZ2l2ZW4gcG9zaXRpb25zLlxuICAvLyBVc2VkIGZvciBjdXJzb3IgbW90aW9uIGFuZCBzdWNoLlxuICBmdW5jdGlvbiBleHRlbmRSYW5nZShkb2MsIHJhbmdlLCBoZWFkLCBvdGhlcikge1xuICAgIGlmIChkb2MuY20gJiYgZG9jLmNtLmRpc3BsYXkuc2hpZnQgfHwgZG9jLmV4dGVuZCkge1xuICAgICAgdmFyIGFuY2hvciA9IHJhbmdlLmFuY2hvcjtcbiAgICAgIGlmIChvdGhlcikge1xuICAgICAgICB2YXIgcG9zQmVmb3JlID0gY21wKGhlYWQsIGFuY2hvcikgPCAwO1xuICAgICAgICBpZiAocG9zQmVmb3JlICE9IChjbXAob3RoZXIsIGFuY2hvcikgPCAwKSkge1xuICAgICAgICAgIGFuY2hvciA9IGhlYWQ7XG4gICAgICAgICAgaGVhZCA9IG90aGVyO1xuICAgICAgICB9IGVsc2UgaWYgKHBvc0JlZm9yZSAhPSAoY21wKGhlYWQsIG90aGVyKSA8IDApKSB7XG4gICAgICAgICAgaGVhZCA9IG90aGVyO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm4gbmV3IFJhbmdlKGFuY2hvciwgaGVhZCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBuZXcgUmFuZ2Uob3RoZXIgfHwgaGVhZCwgaGVhZCk7XG4gICAgfVxuICB9XG5cbiAgLy8gRXh0ZW5kIHRoZSBwcmltYXJ5IHNlbGVjdGlvbiByYW5nZSwgZGlzY2FyZCB0aGUgcmVzdC5cbiAgZnVuY3Rpb24gZXh0ZW5kU2VsZWN0aW9uKGRvYywgaGVhZCwgb3RoZXIsIG9wdGlvbnMpIHtcbiAgICBzZXRTZWxlY3Rpb24oZG9jLCBuZXcgU2VsZWN0aW9uKFtleHRlbmRSYW5nZShkb2MsIGRvYy5zZWwucHJpbWFyeSgpLCBoZWFkLCBvdGhlcildLCAwKSwgb3B0aW9ucyk7XG4gIH1cblxuICAvLyBFeHRlbmQgYWxsIHNlbGVjdGlvbnMgKHBvcyBpcyBhbiBhcnJheSBvZiBzZWxlY3Rpb25zIHdpdGggbGVuZ3RoXG4gIC8vIGVxdWFsIHRoZSBudW1iZXIgb2Ygc2VsZWN0aW9ucylcbiAgZnVuY3Rpb24gZXh0ZW5kU2VsZWN0aW9ucyhkb2MsIGhlYWRzLCBvcHRpb25zKSB7XG4gICAgZm9yICh2YXIgb3V0ID0gW10sIGkgPSAwOyBpIDwgZG9jLnNlbC5yYW5nZXMubGVuZ3RoOyBpKyspXG4gICAgICBvdXRbaV0gPSBleHRlbmRSYW5nZShkb2MsIGRvYy5zZWwucmFuZ2VzW2ldLCBoZWFkc1tpXSwgbnVsbCk7XG4gICAgdmFyIG5ld1NlbCA9IG5vcm1hbGl6ZVNlbGVjdGlvbihvdXQsIGRvYy5zZWwucHJpbUluZGV4KTtcbiAgICBzZXRTZWxlY3Rpb24oZG9jLCBuZXdTZWwsIG9wdGlvbnMpO1xuICB9XG5cbiAgLy8gVXBkYXRlcyBhIHNpbmdsZSByYW5nZSBpbiB0aGUgc2VsZWN0aW9uLlxuICBmdW5jdGlvbiByZXBsYWNlT25lU2VsZWN0aW9uKGRvYywgaSwgcmFuZ2UsIG9wdGlvbnMpIHtcbiAgICB2YXIgcmFuZ2VzID0gZG9jLnNlbC5yYW5nZXMuc2xpY2UoMCk7XG4gICAgcmFuZ2VzW2ldID0gcmFuZ2U7XG4gICAgc2V0U2VsZWN0aW9uKGRvYywgbm9ybWFsaXplU2VsZWN0aW9uKHJhbmdlcywgZG9jLnNlbC5wcmltSW5kZXgpLCBvcHRpb25zKTtcbiAgfVxuXG4gIC8vIFJlc2V0IHRoZSBzZWxlY3Rpb24gdG8gYSBzaW5nbGUgcmFuZ2UuXG4gIGZ1bmN0aW9uIHNldFNpbXBsZVNlbGVjdGlvbihkb2MsIGFuY2hvciwgaGVhZCwgb3B0aW9ucykge1xuICAgIHNldFNlbGVjdGlvbihkb2MsIHNpbXBsZVNlbGVjdGlvbihhbmNob3IsIGhlYWQpLCBvcHRpb25zKTtcbiAgfVxuXG4gIC8vIEdpdmUgYmVmb3JlU2VsZWN0aW9uQ2hhbmdlIGhhbmRsZXJzIGEgY2hhbmdlIHRvIGluZmx1ZW5jZSBhXG4gIC8vIHNlbGVjdGlvbiB1cGRhdGUuXG4gIGZ1bmN0aW9uIGZpbHRlclNlbGVjdGlvbkNoYW5nZShkb2MsIHNlbCkge1xuICAgIHZhciBvYmogPSB7XG4gICAgICByYW5nZXM6IHNlbC5yYW5nZXMsXG4gICAgICB1cGRhdGU6IGZ1bmN0aW9uKHJhbmdlcykge1xuICAgICAgICB0aGlzLnJhbmdlcyA9IFtdO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHJhbmdlcy5sZW5ndGg7IGkrKylcbiAgICAgICAgICB0aGlzLnJhbmdlc1tpXSA9IG5ldyBSYW5nZShjbGlwUG9zKGRvYywgcmFuZ2VzW2ldLmFuY2hvciksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xpcFBvcyhkb2MsIHJhbmdlc1tpXS5oZWFkKSk7XG4gICAgICB9XG4gICAgfTtcbiAgICBzaWduYWwoZG9jLCBcImJlZm9yZVNlbGVjdGlvbkNoYW5nZVwiLCBkb2MsIG9iaik7XG4gICAgaWYgKGRvYy5jbSkgc2lnbmFsKGRvYy5jbSwgXCJiZWZvcmVTZWxlY3Rpb25DaGFuZ2VcIiwgZG9jLmNtLCBvYmopO1xuICAgIGlmIChvYmoucmFuZ2VzICE9IHNlbC5yYW5nZXMpIHJldHVybiBub3JtYWxpemVTZWxlY3Rpb24ob2JqLnJhbmdlcywgb2JqLnJhbmdlcy5sZW5ndGggLSAxKTtcbiAgICBlbHNlIHJldHVybiBzZWw7XG4gIH1cblxuICBmdW5jdGlvbiBzZXRTZWxlY3Rpb25SZXBsYWNlSGlzdG9yeShkb2MsIHNlbCwgb3B0aW9ucykge1xuICAgIHZhciBkb25lID0gZG9jLmhpc3RvcnkuZG9uZSwgbGFzdCA9IGxzdChkb25lKTtcbiAgICBpZiAobGFzdCAmJiBsYXN0LnJhbmdlcykge1xuICAgICAgZG9uZVtkb25lLmxlbmd0aCAtIDFdID0gc2VsO1xuICAgICAgc2V0U2VsZWN0aW9uTm9VbmRvKGRvYywgc2VsLCBvcHRpb25zKTtcbiAgICB9IGVsc2Uge1xuICAgICAgc2V0U2VsZWN0aW9uKGRvYywgc2VsLCBvcHRpb25zKTtcbiAgICB9XG4gIH1cblxuICAvLyBTZXQgYSBuZXcgc2VsZWN0aW9uLlxuICBmdW5jdGlvbiBzZXRTZWxlY3Rpb24oZG9jLCBzZWwsIG9wdGlvbnMpIHtcbiAgICBzZXRTZWxlY3Rpb25Ob1VuZG8oZG9jLCBzZWwsIG9wdGlvbnMpO1xuICAgIGFkZFNlbGVjdGlvblRvSGlzdG9yeShkb2MsIGRvYy5zZWwsIGRvYy5jbSA/IGRvYy5jbS5jdXJPcC5pZCA6IE5hTiwgb3B0aW9ucyk7XG4gIH1cblxuICBmdW5jdGlvbiBzZXRTZWxlY3Rpb25Ob1VuZG8oZG9jLCBzZWwsIG9wdGlvbnMpIHtcbiAgICBpZiAoaGFzSGFuZGxlcihkb2MsIFwiYmVmb3JlU2VsZWN0aW9uQ2hhbmdlXCIpIHx8IGRvYy5jbSAmJiBoYXNIYW5kbGVyKGRvYy5jbSwgXCJiZWZvcmVTZWxlY3Rpb25DaGFuZ2VcIikpXG4gICAgICBzZWwgPSBmaWx0ZXJTZWxlY3Rpb25DaGFuZ2UoZG9jLCBzZWwpO1xuXG4gICAgdmFyIGJpYXMgPSBvcHRpb25zICYmIG9wdGlvbnMuYmlhcyB8fFxuICAgICAgKGNtcChzZWwucHJpbWFyeSgpLmhlYWQsIGRvYy5zZWwucHJpbWFyeSgpLmhlYWQpIDwgMCA/IC0xIDogMSk7XG4gICAgc2V0U2VsZWN0aW9uSW5uZXIoZG9jLCBza2lwQXRvbWljSW5TZWxlY3Rpb24oZG9jLCBzZWwsIGJpYXMsIHRydWUpKTtcblxuICAgIGlmICghKG9wdGlvbnMgJiYgb3B0aW9ucy5zY3JvbGwgPT09IGZhbHNlKSAmJiBkb2MuY20pXG4gICAgICBlbnN1cmVDdXJzb3JWaXNpYmxlKGRvYy5jbSk7XG4gIH1cblxuICBmdW5jdGlvbiBzZXRTZWxlY3Rpb25Jbm5lcihkb2MsIHNlbCkge1xuICAgIGlmIChzZWwuZXF1YWxzKGRvYy5zZWwpKSByZXR1cm47XG5cbiAgICBkb2Muc2VsID0gc2VsO1xuXG4gICAgaWYgKGRvYy5jbSkge1xuICAgICAgZG9jLmNtLmN1ck9wLnVwZGF0ZUlucHV0ID0gZG9jLmNtLmN1ck9wLnNlbGVjdGlvbkNoYW5nZWQgPSB0cnVlO1xuICAgICAgc2lnbmFsQ3Vyc29yQWN0aXZpdHkoZG9jLmNtKTtcbiAgICB9XG4gICAgc2lnbmFsTGF0ZXIoZG9jLCBcImN1cnNvckFjdGl2aXR5XCIsIGRvYyk7XG4gIH1cblxuICAvLyBWZXJpZnkgdGhhdCB0aGUgc2VsZWN0aW9uIGRvZXMgbm90IHBhcnRpYWxseSBzZWxlY3QgYW55IGF0b21pY1xuICAvLyBtYXJrZWQgcmFuZ2VzLlxuICBmdW5jdGlvbiByZUNoZWNrU2VsZWN0aW9uKGRvYykge1xuICAgIHNldFNlbGVjdGlvbklubmVyKGRvYywgc2tpcEF0b21pY0luU2VsZWN0aW9uKGRvYywgZG9jLnNlbCwgbnVsbCwgZmFsc2UpLCBzZWxfZG9udFNjcm9sbCk7XG4gIH1cblxuICAvLyBSZXR1cm4gYSBzZWxlY3Rpb24gdGhhdCBkb2VzIG5vdCBwYXJ0aWFsbHkgc2VsZWN0IGFueSBhdG9taWNcbiAgLy8gcmFuZ2VzLlxuICBmdW5jdGlvbiBza2lwQXRvbWljSW5TZWxlY3Rpb24oZG9jLCBzZWwsIGJpYXMsIG1heUNsZWFyKSB7XG4gICAgdmFyIG91dDtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHNlbC5yYW5nZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgIHZhciByYW5nZSA9IHNlbC5yYW5nZXNbaV07XG4gICAgICB2YXIgbmV3QW5jaG9yID0gc2tpcEF0b21pYyhkb2MsIHJhbmdlLmFuY2hvciwgYmlhcywgbWF5Q2xlYXIpO1xuICAgICAgdmFyIG5ld0hlYWQgPSBza2lwQXRvbWljKGRvYywgcmFuZ2UuaGVhZCwgYmlhcywgbWF5Q2xlYXIpO1xuICAgICAgaWYgKG91dCB8fCBuZXdBbmNob3IgIT0gcmFuZ2UuYW5jaG9yIHx8IG5ld0hlYWQgIT0gcmFuZ2UuaGVhZCkge1xuICAgICAgICBpZiAoIW91dCkgb3V0ID0gc2VsLnJhbmdlcy5zbGljZSgwLCBpKTtcbiAgICAgICAgb3V0W2ldID0gbmV3IFJhbmdlKG5ld0FuY2hvciwgbmV3SGVhZCk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBvdXQgPyBub3JtYWxpemVTZWxlY3Rpb24ob3V0LCBzZWwucHJpbUluZGV4KSA6IHNlbDtcbiAgfVxuXG4gIC8vIEVuc3VyZSBhIGdpdmVuIHBvc2l0aW9uIGlzIG5vdCBpbnNpZGUgYW4gYXRvbWljIHJhbmdlLlxuICBmdW5jdGlvbiBza2lwQXRvbWljKGRvYywgcG9zLCBiaWFzLCBtYXlDbGVhcikge1xuICAgIHZhciBmbGlwcGVkID0gZmFsc2UsIGN1clBvcyA9IHBvcztcbiAgICB2YXIgZGlyID0gYmlhcyB8fCAxO1xuICAgIGRvYy5jYW50RWRpdCA9IGZhbHNlO1xuICAgIHNlYXJjaDogZm9yICg7Oykge1xuICAgICAgdmFyIGxpbmUgPSBnZXRMaW5lKGRvYywgY3VyUG9zLmxpbmUpO1xuICAgICAgaWYgKGxpbmUubWFya2VkU3BhbnMpIHtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsaW5lLm1hcmtlZFNwYW5zLmxlbmd0aDsgKytpKSB7XG4gICAgICAgICAgdmFyIHNwID0gbGluZS5tYXJrZWRTcGFuc1tpXSwgbSA9IHNwLm1hcmtlcjtcbiAgICAgICAgICBpZiAoKHNwLmZyb20gPT0gbnVsbCB8fCAobS5pbmNsdXNpdmVMZWZ0ID8gc3AuZnJvbSA8PSBjdXJQb3MuY2ggOiBzcC5mcm9tIDwgY3VyUG9zLmNoKSkgJiZcbiAgICAgICAgICAgICAgKHNwLnRvID09IG51bGwgfHwgKG0uaW5jbHVzaXZlUmlnaHQgPyBzcC50byA+PSBjdXJQb3MuY2ggOiBzcC50byA+IGN1clBvcy5jaCkpKSB7XG4gICAgICAgICAgICBpZiAobWF5Q2xlYXIpIHtcbiAgICAgICAgICAgICAgc2lnbmFsKG0sIFwiYmVmb3JlQ3Vyc29yRW50ZXJcIik7XG4gICAgICAgICAgICAgIGlmIChtLmV4cGxpY2l0bHlDbGVhcmVkKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFsaW5lLm1hcmtlZFNwYW5zKSBicmVhaztcbiAgICAgICAgICAgICAgICBlbHNlIHstLWk7IGNvbnRpbnVlO31cbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKCFtLmF0b21pYykgY29udGludWU7XG4gICAgICAgICAgICB2YXIgbmV3UG9zID0gbS5maW5kKGRpciA8IDAgPyAtMSA6IDEpO1xuICAgICAgICAgICAgaWYgKGNtcChuZXdQb3MsIGN1clBvcykgPT0gMCkge1xuICAgICAgICAgICAgICBuZXdQb3MuY2ggKz0gZGlyO1xuICAgICAgICAgICAgICBpZiAobmV3UG9zLmNoIDwgMCkge1xuICAgICAgICAgICAgICAgIGlmIChuZXdQb3MubGluZSA+IGRvYy5maXJzdCkgbmV3UG9zID0gY2xpcFBvcyhkb2MsIFBvcyhuZXdQb3MubGluZSAtIDEpKTtcbiAgICAgICAgICAgICAgICBlbHNlIG5ld1BvcyA9IG51bGw7XG4gICAgICAgICAgICAgIH0gZWxzZSBpZiAobmV3UG9zLmNoID4gbGluZS50ZXh0Lmxlbmd0aCkge1xuICAgICAgICAgICAgICAgIGlmIChuZXdQb3MubGluZSA8IGRvYy5maXJzdCArIGRvYy5zaXplIC0gMSkgbmV3UG9zID0gUG9zKG5ld1Bvcy5saW5lICsgMSwgMCk7XG4gICAgICAgICAgICAgICAgZWxzZSBuZXdQb3MgPSBudWxsO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGlmICghbmV3UG9zKSB7XG4gICAgICAgICAgICAgICAgaWYgKGZsaXBwZWQpIHtcbiAgICAgICAgICAgICAgICAgIC8vIERyaXZlbiBpbiBhIGNvcm5lciAtLSBubyB2YWxpZCBjdXJzb3IgcG9zaXRpb24gZm91bmQgYXQgYWxsXG4gICAgICAgICAgICAgICAgICAvLyAtLSB0cnkgYWdhaW4gKndpdGgqIGNsZWFyaW5nLCBpZiB3ZSBkaWRuJ3QgYWxyZWFkeVxuICAgICAgICAgICAgICAgICAgaWYgKCFtYXlDbGVhcikgcmV0dXJuIHNraXBBdG9taWMoZG9jLCBwb3MsIGJpYXMsIHRydWUpO1xuICAgICAgICAgICAgICAgICAgLy8gT3RoZXJ3aXNlLCB0dXJuIG9mZiBlZGl0aW5nIHVudGlsIGZ1cnRoZXIgbm90aWNlLCBhbmQgcmV0dXJuIHRoZSBzdGFydCBvZiB0aGUgZG9jXG4gICAgICAgICAgICAgICAgICBkb2MuY2FudEVkaXQgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgcmV0dXJuIFBvcyhkb2MuZmlyc3QsIDApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBmbGlwcGVkID0gdHJ1ZTsgbmV3UG9zID0gcG9zOyBkaXIgPSAtZGlyO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjdXJQb3MgPSBuZXdQb3M7XG4gICAgICAgICAgICBjb250aW51ZSBzZWFyY2g7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm4gY3VyUG9zO1xuICAgIH1cbiAgfVxuXG4gIC8vIFNFTEVDVElPTiBEUkFXSU5HXG5cbiAgZnVuY3Rpb24gdXBkYXRlU2VsZWN0aW9uKGNtKSB7XG4gICAgY20uZGlzcGxheS5pbnB1dC5zaG93U2VsZWN0aW9uKGNtLmRpc3BsYXkuaW5wdXQucHJlcGFyZVNlbGVjdGlvbigpKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHByZXBhcmVTZWxlY3Rpb24oY20sIHByaW1hcnkpIHtcbiAgICB2YXIgZG9jID0gY20uZG9jLCByZXN1bHQgPSB7fTtcbiAgICB2YXIgY3VyRnJhZ21lbnQgPSByZXN1bHQuY3Vyc29ycyA9IGRvY3VtZW50LmNyZWF0ZURvY3VtZW50RnJhZ21lbnQoKTtcbiAgICB2YXIgc2VsRnJhZ21lbnQgPSByZXN1bHQuc2VsZWN0aW9uID0gZG9jdW1lbnQuY3JlYXRlRG9jdW1lbnRGcmFnbWVudCgpO1xuXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBkb2Muc2VsLnJhbmdlcy5sZW5ndGg7IGkrKykge1xuICAgICAgaWYgKHByaW1hcnkgPT09IGZhbHNlICYmIGkgPT0gZG9jLnNlbC5wcmltSW5kZXgpIGNvbnRpbnVlO1xuICAgICAgdmFyIHJhbmdlID0gZG9jLnNlbC5yYW5nZXNbaV07XG4gICAgICB2YXIgY29sbGFwc2VkID0gcmFuZ2UuZW1wdHkoKTtcbiAgICAgIGlmIChjb2xsYXBzZWQgfHwgY20ub3B0aW9ucy5zaG93Q3Vyc29yV2hlblNlbGVjdGluZylcbiAgICAgICAgZHJhd1NlbGVjdGlvbkN1cnNvcihjbSwgcmFuZ2UsIGN1ckZyYWdtZW50KTtcbiAgICAgIGlmICghY29sbGFwc2VkKVxuICAgICAgICBkcmF3U2VsZWN0aW9uUmFuZ2UoY20sIHJhbmdlLCBzZWxGcmFnbWVudCk7XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cblxuICAvLyBEcmF3cyBhIGN1cnNvciBmb3IgdGhlIGdpdmVuIHJhbmdlXG4gIGZ1bmN0aW9uIGRyYXdTZWxlY3Rpb25DdXJzb3IoY20sIHJhbmdlLCBvdXRwdXQpIHtcbiAgICB2YXIgcG9zID0gY3Vyc29yQ29vcmRzKGNtLCByYW5nZS5oZWFkLCBcImRpdlwiLCBudWxsLCBudWxsLCAhY20ub3B0aW9ucy5zaW5nbGVDdXJzb3JIZWlnaHRQZXJMaW5lKTtcblxuICAgIHZhciBjdXJzb3IgPSBvdXRwdXQuYXBwZW5kQ2hpbGQoZWx0KFwiZGl2XCIsIFwiXFx1MDBhMFwiLCBcIkNvZGVNaXJyb3ItY3Vyc29yXCIpKTtcbiAgICBjdXJzb3Iuc3R5bGUubGVmdCA9IHBvcy5sZWZ0ICsgXCJweFwiO1xuICAgIGN1cnNvci5zdHlsZS50b3AgPSBwb3MudG9wICsgXCJweFwiO1xuICAgIGN1cnNvci5zdHlsZS5oZWlnaHQgPSBNYXRoLm1heCgwLCBwb3MuYm90dG9tIC0gcG9zLnRvcCkgKiBjbS5vcHRpb25zLmN1cnNvckhlaWdodCArIFwicHhcIjtcblxuICAgIGlmIChwb3Mub3RoZXIpIHtcbiAgICAgIC8vIFNlY29uZGFyeSBjdXJzb3IsIHNob3duIHdoZW4gb24gYSAnanVtcCcgaW4gYmktZGlyZWN0aW9uYWwgdGV4dFxuICAgICAgdmFyIG90aGVyQ3Vyc29yID0gb3V0cHV0LmFwcGVuZENoaWxkKGVsdChcImRpdlwiLCBcIlxcdTAwYTBcIiwgXCJDb2RlTWlycm9yLWN1cnNvciBDb2RlTWlycm9yLXNlY29uZGFyeWN1cnNvclwiKSk7XG4gICAgICBvdGhlckN1cnNvci5zdHlsZS5kaXNwbGF5ID0gXCJcIjtcbiAgICAgIG90aGVyQ3Vyc29yLnN0eWxlLmxlZnQgPSBwb3Mub3RoZXIubGVmdCArIFwicHhcIjtcbiAgICAgIG90aGVyQ3Vyc29yLnN0eWxlLnRvcCA9IHBvcy5vdGhlci50b3AgKyBcInB4XCI7XG4gICAgICBvdGhlckN1cnNvci5zdHlsZS5oZWlnaHQgPSAocG9zLm90aGVyLmJvdHRvbSAtIHBvcy5vdGhlci50b3ApICogLjg1ICsgXCJweFwiO1xuICAgIH1cbiAgfVxuXG4gIC8vIERyYXdzIHRoZSBnaXZlbiByYW5nZSBhcyBhIGhpZ2hsaWdodGVkIHNlbGVjdGlvblxuICBmdW5jdGlvbiBkcmF3U2VsZWN0aW9uUmFuZ2UoY20sIHJhbmdlLCBvdXRwdXQpIHtcbiAgICB2YXIgZGlzcGxheSA9IGNtLmRpc3BsYXksIGRvYyA9IGNtLmRvYztcbiAgICB2YXIgZnJhZ21lbnQgPSBkb2N1bWVudC5jcmVhdGVEb2N1bWVudEZyYWdtZW50KCk7XG4gICAgdmFyIHBhZGRpbmcgPSBwYWRkaW5nSChjbS5kaXNwbGF5KSwgbGVmdFNpZGUgPSBwYWRkaW5nLmxlZnQ7XG4gICAgdmFyIHJpZ2h0U2lkZSA9IE1hdGgubWF4KGRpc3BsYXkuc2l6ZXJXaWR0aCwgZGlzcGxheVdpZHRoKGNtKSAtIGRpc3BsYXkuc2l6ZXIub2Zmc2V0TGVmdCkgLSBwYWRkaW5nLnJpZ2h0O1xuXG4gICAgZnVuY3Rpb24gYWRkKGxlZnQsIHRvcCwgd2lkdGgsIGJvdHRvbSkge1xuICAgICAgaWYgKHRvcCA8IDApIHRvcCA9IDA7XG4gICAgICB0b3AgPSBNYXRoLnJvdW5kKHRvcCk7XG4gICAgICBib3R0b20gPSBNYXRoLnJvdW5kKGJvdHRvbSk7XG4gICAgICBmcmFnbWVudC5hcHBlbmRDaGlsZChlbHQoXCJkaXZcIiwgbnVsbCwgXCJDb2RlTWlycm9yLXNlbGVjdGVkXCIsIFwicG9zaXRpb246IGFic29sdXRlOyBsZWZ0OiBcIiArIGxlZnQgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFwicHg7IHRvcDogXCIgKyB0b3AgKyBcInB4OyB3aWR0aDogXCIgKyAod2lkdGggPT0gbnVsbCA/IHJpZ2h0U2lkZSAtIGxlZnQgOiB3aWR0aCkgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFwicHg7IGhlaWdodDogXCIgKyAoYm90dG9tIC0gdG9wKSArIFwicHhcIikpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGRyYXdGb3JMaW5lKGxpbmUsIGZyb21BcmcsIHRvQXJnKSB7XG4gICAgICB2YXIgbGluZU9iaiA9IGdldExpbmUoZG9jLCBsaW5lKTtcbiAgICAgIHZhciBsaW5lTGVuID0gbGluZU9iai50ZXh0Lmxlbmd0aDtcbiAgICAgIHZhciBzdGFydCwgZW5kO1xuICAgICAgZnVuY3Rpb24gY29vcmRzKGNoLCBiaWFzKSB7XG4gICAgICAgIHJldHVybiBjaGFyQ29vcmRzKGNtLCBQb3MobGluZSwgY2gpLCBcImRpdlwiLCBsaW5lT2JqLCBiaWFzKTtcbiAgICAgIH1cblxuICAgICAgaXRlcmF0ZUJpZGlTZWN0aW9ucyhnZXRPcmRlcihsaW5lT2JqKSwgZnJvbUFyZyB8fCAwLCB0b0FyZyA9PSBudWxsID8gbGluZUxlbiA6IHRvQXJnLCBmdW5jdGlvbihmcm9tLCB0bywgZGlyKSB7XG4gICAgICAgIHZhciBsZWZ0UG9zID0gY29vcmRzKGZyb20sIFwibGVmdFwiKSwgcmlnaHRQb3MsIGxlZnQsIHJpZ2h0O1xuICAgICAgICBpZiAoZnJvbSA9PSB0bykge1xuICAgICAgICAgIHJpZ2h0UG9zID0gbGVmdFBvcztcbiAgICAgICAgICBsZWZ0ID0gcmlnaHQgPSBsZWZ0UG9zLmxlZnQ7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmlnaHRQb3MgPSBjb29yZHModG8gLSAxLCBcInJpZ2h0XCIpO1xuICAgICAgICAgIGlmIChkaXIgPT0gXCJydGxcIikgeyB2YXIgdG1wID0gbGVmdFBvczsgbGVmdFBvcyA9IHJpZ2h0UG9zOyByaWdodFBvcyA9IHRtcDsgfVxuICAgICAgICAgIGxlZnQgPSBsZWZ0UG9zLmxlZnQ7XG4gICAgICAgICAgcmlnaHQgPSByaWdodFBvcy5yaWdodDtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZnJvbUFyZyA9PSBudWxsICYmIGZyb20gPT0gMCkgbGVmdCA9IGxlZnRTaWRlO1xuICAgICAgICBpZiAocmlnaHRQb3MudG9wIC0gbGVmdFBvcy50b3AgPiAzKSB7IC8vIERpZmZlcmVudCBsaW5lcywgZHJhdyB0b3AgcGFydFxuICAgICAgICAgIGFkZChsZWZ0LCBsZWZ0UG9zLnRvcCwgbnVsbCwgbGVmdFBvcy5ib3R0b20pO1xuICAgICAgICAgIGxlZnQgPSBsZWZ0U2lkZTtcbiAgICAgICAgICBpZiAobGVmdFBvcy5ib3R0b20gPCByaWdodFBvcy50b3ApIGFkZChsZWZ0LCBsZWZ0UG9zLmJvdHRvbSwgbnVsbCwgcmlnaHRQb3MudG9wKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAodG9BcmcgPT0gbnVsbCAmJiB0byA9PSBsaW5lTGVuKSByaWdodCA9IHJpZ2h0U2lkZTtcbiAgICAgICAgaWYgKCFzdGFydCB8fCBsZWZ0UG9zLnRvcCA8IHN0YXJ0LnRvcCB8fCBsZWZ0UG9zLnRvcCA9PSBzdGFydC50b3AgJiYgbGVmdFBvcy5sZWZ0IDwgc3RhcnQubGVmdClcbiAgICAgICAgICBzdGFydCA9IGxlZnRQb3M7XG4gICAgICAgIGlmICghZW5kIHx8IHJpZ2h0UG9zLmJvdHRvbSA+IGVuZC5ib3R0b20gfHwgcmlnaHRQb3MuYm90dG9tID09IGVuZC5ib3R0b20gJiYgcmlnaHRQb3MucmlnaHQgPiBlbmQucmlnaHQpXG4gICAgICAgICAgZW5kID0gcmlnaHRQb3M7XG4gICAgICAgIGlmIChsZWZ0IDwgbGVmdFNpZGUgKyAxKSBsZWZ0ID0gbGVmdFNpZGU7XG4gICAgICAgIGFkZChsZWZ0LCByaWdodFBvcy50b3AsIHJpZ2h0IC0gbGVmdCwgcmlnaHRQb3MuYm90dG9tKTtcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIHtzdGFydDogc3RhcnQsIGVuZDogZW5kfTtcbiAgICB9XG5cbiAgICB2YXIgc0Zyb20gPSByYW5nZS5mcm9tKCksIHNUbyA9IHJhbmdlLnRvKCk7XG4gICAgaWYgKHNGcm9tLmxpbmUgPT0gc1RvLmxpbmUpIHtcbiAgICAgIGRyYXdGb3JMaW5lKHNGcm9tLmxpbmUsIHNGcm9tLmNoLCBzVG8uY2gpO1xuICAgIH0gZWxzZSB7XG4gICAgICB2YXIgZnJvbUxpbmUgPSBnZXRMaW5lKGRvYywgc0Zyb20ubGluZSksIHRvTGluZSA9IGdldExpbmUoZG9jLCBzVG8ubGluZSk7XG4gICAgICB2YXIgc2luZ2xlVkxpbmUgPSB2aXN1YWxMaW5lKGZyb21MaW5lKSA9PSB2aXN1YWxMaW5lKHRvTGluZSk7XG4gICAgICB2YXIgbGVmdEVuZCA9IGRyYXdGb3JMaW5lKHNGcm9tLmxpbmUsIHNGcm9tLmNoLCBzaW5nbGVWTGluZSA/IGZyb21MaW5lLnRleHQubGVuZ3RoICsgMSA6IG51bGwpLmVuZDtcbiAgICAgIHZhciByaWdodFN0YXJ0ID0gZHJhd0ZvckxpbmUoc1RvLmxpbmUsIHNpbmdsZVZMaW5lID8gMCA6IG51bGwsIHNUby5jaCkuc3RhcnQ7XG4gICAgICBpZiAoc2luZ2xlVkxpbmUpIHtcbiAgICAgICAgaWYgKGxlZnRFbmQudG9wIDwgcmlnaHRTdGFydC50b3AgLSAyKSB7XG4gICAgICAgICAgYWRkKGxlZnRFbmQucmlnaHQsIGxlZnRFbmQudG9wLCBudWxsLCBsZWZ0RW5kLmJvdHRvbSk7XG4gICAgICAgICAgYWRkKGxlZnRTaWRlLCByaWdodFN0YXJ0LnRvcCwgcmlnaHRTdGFydC5sZWZ0LCByaWdodFN0YXJ0LmJvdHRvbSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgYWRkKGxlZnRFbmQucmlnaHQsIGxlZnRFbmQudG9wLCByaWdodFN0YXJ0LmxlZnQgLSBsZWZ0RW5kLnJpZ2h0LCBsZWZ0RW5kLmJvdHRvbSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChsZWZ0RW5kLmJvdHRvbSA8IHJpZ2h0U3RhcnQudG9wKVxuICAgICAgICBhZGQobGVmdFNpZGUsIGxlZnRFbmQuYm90dG9tLCBudWxsLCByaWdodFN0YXJ0LnRvcCk7XG4gICAgfVxuXG4gICAgb3V0cHV0LmFwcGVuZENoaWxkKGZyYWdtZW50KTtcbiAgfVxuXG4gIC8vIEN1cnNvci1ibGlua2luZ1xuICBmdW5jdGlvbiByZXN0YXJ0QmxpbmsoY20pIHtcbiAgICBpZiAoIWNtLnN0YXRlLmZvY3VzZWQpIHJldHVybjtcbiAgICB2YXIgZGlzcGxheSA9IGNtLmRpc3BsYXk7XG4gICAgY2xlYXJJbnRlcnZhbChkaXNwbGF5LmJsaW5rZXIpO1xuICAgIHZhciBvbiA9IHRydWU7XG4gICAgZGlzcGxheS5jdXJzb3JEaXYuc3R5bGUudmlzaWJpbGl0eSA9IFwiXCI7XG4gICAgaWYgKGNtLm9wdGlvbnMuY3Vyc29yQmxpbmtSYXRlID4gMClcbiAgICAgIGRpc3BsYXkuYmxpbmtlciA9IHNldEludGVydmFsKGZ1bmN0aW9uKCkge1xuICAgICAgICBkaXNwbGF5LmN1cnNvckRpdi5zdHlsZS52aXNpYmlsaXR5ID0gKG9uID0gIW9uKSA/IFwiXCIgOiBcImhpZGRlblwiO1xuICAgICAgfSwgY20ub3B0aW9ucy5jdXJzb3JCbGlua1JhdGUpO1xuICAgIGVsc2UgaWYgKGNtLm9wdGlvbnMuY3Vyc29yQmxpbmtSYXRlIDwgMClcbiAgICAgIGRpc3BsYXkuY3Vyc29yRGl2LnN0eWxlLnZpc2liaWxpdHkgPSBcImhpZGRlblwiO1xuICB9XG5cbiAgLy8gSElHSExJR0hUIFdPUktFUlxuXG4gIGZ1bmN0aW9uIHN0YXJ0V29ya2VyKGNtLCB0aW1lKSB7XG4gICAgaWYgKGNtLmRvYy5tb2RlLnN0YXJ0U3RhdGUgJiYgY20uZG9jLmZyb250aWVyIDwgY20uZGlzcGxheS52aWV3VG8pXG4gICAgICBjbS5zdGF0ZS5oaWdobGlnaHQuc2V0KHRpbWUsIGJpbmQoaGlnaGxpZ2h0V29ya2VyLCBjbSkpO1xuICB9XG5cbiAgZnVuY3Rpb24gaGlnaGxpZ2h0V29ya2VyKGNtKSB7XG4gICAgdmFyIGRvYyA9IGNtLmRvYztcbiAgICBpZiAoZG9jLmZyb250aWVyIDwgZG9jLmZpcnN0KSBkb2MuZnJvbnRpZXIgPSBkb2MuZmlyc3Q7XG4gICAgaWYgKGRvYy5mcm9udGllciA+PSBjbS5kaXNwbGF5LnZpZXdUbykgcmV0dXJuO1xuICAgIHZhciBlbmQgPSArbmV3IERhdGUgKyBjbS5vcHRpb25zLndvcmtUaW1lO1xuICAgIHZhciBzdGF0ZSA9IGNvcHlTdGF0ZShkb2MubW9kZSwgZ2V0U3RhdGVCZWZvcmUoY20sIGRvYy5mcm9udGllcikpO1xuICAgIHZhciBjaGFuZ2VkTGluZXMgPSBbXTtcblxuICAgIGRvYy5pdGVyKGRvYy5mcm9udGllciwgTWF0aC5taW4oZG9jLmZpcnN0ICsgZG9jLnNpemUsIGNtLmRpc3BsYXkudmlld1RvICsgNTAwKSwgZnVuY3Rpb24obGluZSkge1xuICAgICAgaWYgKGRvYy5mcm9udGllciA+PSBjbS5kaXNwbGF5LnZpZXdGcm9tKSB7IC8vIFZpc2libGVcbiAgICAgICAgdmFyIG9sZFN0eWxlcyA9IGxpbmUuc3R5bGVzO1xuICAgICAgICB2YXIgaGlnaGxpZ2h0ZWQgPSBoaWdobGlnaHRMaW5lKGNtLCBsaW5lLCBzdGF0ZSwgdHJ1ZSk7XG4gICAgICAgIGxpbmUuc3R5bGVzID0gaGlnaGxpZ2h0ZWQuc3R5bGVzO1xuICAgICAgICB2YXIgb2xkQ2xzID0gbGluZS5zdHlsZUNsYXNzZXMsIG5ld0NscyA9IGhpZ2hsaWdodGVkLmNsYXNzZXM7XG4gICAgICAgIGlmIChuZXdDbHMpIGxpbmUuc3R5bGVDbGFzc2VzID0gbmV3Q2xzO1xuICAgICAgICBlbHNlIGlmIChvbGRDbHMpIGxpbmUuc3R5bGVDbGFzc2VzID0gbnVsbDtcbiAgICAgICAgdmFyIGlzY2hhbmdlID0gIW9sZFN0eWxlcyB8fCBvbGRTdHlsZXMubGVuZ3RoICE9IGxpbmUuc3R5bGVzLmxlbmd0aCB8fFxuICAgICAgICAgIG9sZENscyAhPSBuZXdDbHMgJiYgKCFvbGRDbHMgfHwgIW5ld0NscyB8fCBvbGRDbHMuYmdDbGFzcyAhPSBuZXdDbHMuYmdDbGFzcyB8fCBvbGRDbHMudGV4dENsYXNzICE9IG5ld0Nscy50ZXh0Q2xhc3MpO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgIWlzY2hhbmdlICYmIGkgPCBvbGRTdHlsZXMubGVuZ3RoOyArK2kpIGlzY2hhbmdlID0gb2xkU3R5bGVzW2ldICE9IGxpbmUuc3R5bGVzW2ldO1xuICAgICAgICBpZiAoaXNjaGFuZ2UpIGNoYW5nZWRMaW5lcy5wdXNoKGRvYy5mcm9udGllcik7XG4gICAgICAgIGxpbmUuc3RhdGVBZnRlciA9IGNvcHlTdGF0ZShkb2MubW9kZSwgc3RhdGUpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcHJvY2Vzc0xpbmUoY20sIGxpbmUudGV4dCwgc3RhdGUpO1xuICAgICAgICBsaW5lLnN0YXRlQWZ0ZXIgPSBkb2MuZnJvbnRpZXIgJSA1ID09IDAgPyBjb3B5U3RhdGUoZG9jLm1vZGUsIHN0YXRlKSA6IG51bGw7XG4gICAgICB9XG4gICAgICArK2RvYy5mcm9udGllcjtcbiAgICAgIGlmICgrbmV3IERhdGUgPiBlbmQpIHtcbiAgICAgICAgc3RhcnRXb3JrZXIoY20sIGNtLm9wdGlvbnMud29ya0RlbGF5KTtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9XG4gICAgfSk7XG4gICAgaWYgKGNoYW5nZWRMaW5lcy5sZW5ndGgpIHJ1bkluT3AoY20sIGZ1bmN0aW9uKCkge1xuICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBjaGFuZ2VkTGluZXMubGVuZ3RoOyBpKyspXG4gICAgICAgIHJlZ0xpbmVDaGFuZ2UoY20sIGNoYW5nZWRMaW5lc1tpXSwgXCJ0ZXh0XCIpO1xuICAgIH0pO1xuICB9XG5cbiAgLy8gRmluZHMgdGhlIGxpbmUgdG8gc3RhcnQgd2l0aCB3aGVuIHN0YXJ0aW5nIGEgcGFyc2UuIFRyaWVzIHRvXG4gIC8vIGZpbmQgYSBsaW5lIHdpdGggYSBzdGF0ZUFmdGVyLCBzbyB0aGF0IGl0IGNhbiBzdGFydCB3aXRoIGFcbiAgLy8gdmFsaWQgc3RhdGUuIElmIHRoYXQgZmFpbHMsIGl0IHJldHVybnMgdGhlIGxpbmUgd2l0aCB0aGVcbiAgLy8gc21hbGxlc3QgaW5kZW50YXRpb24sIHdoaWNoIHRlbmRzIHRvIG5lZWQgdGhlIGxlYXN0IGNvbnRleHQgdG9cbiAgLy8gcGFyc2UgY29ycmVjdGx5LlxuICBmdW5jdGlvbiBmaW5kU3RhcnRMaW5lKGNtLCBuLCBwcmVjaXNlKSB7XG4gICAgdmFyIG1pbmluZGVudCwgbWlubGluZSwgZG9jID0gY20uZG9jO1xuICAgIHZhciBsaW0gPSBwcmVjaXNlID8gLTEgOiBuIC0gKGNtLmRvYy5tb2RlLmlubmVyTW9kZSA/IDEwMDAgOiAxMDApO1xuICAgIGZvciAodmFyIHNlYXJjaCA9IG47IHNlYXJjaCA+IGxpbTsgLS1zZWFyY2gpIHtcbiAgICAgIGlmIChzZWFyY2ggPD0gZG9jLmZpcnN0KSByZXR1cm4gZG9jLmZpcnN0O1xuICAgICAgdmFyIGxpbmUgPSBnZXRMaW5lKGRvYywgc2VhcmNoIC0gMSk7XG4gICAgICBpZiAobGluZS5zdGF0ZUFmdGVyICYmICghcHJlY2lzZSB8fCBzZWFyY2ggPD0gZG9jLmZyb250aWVyKSkgcmV0dXJuIHNlYXJjaDtcbiAgICAgIHZhciBpbmRlbnRlZCA9IGNvdW50Q29sdW1uKGxpbmUudGV4dCwgbnVsbCwgY20ub3B0aW9ucy50YWJTaXplKTtcbiAgICAgIGlmIChtaW5saW5lID09IG51bGwgfHwgbWluaW5kZW50ID4gaW5kZW50ZWQpIHtcbiAgICAgICAgbWlubGluZSA9IHNlYXJjaCAtIDE7XG4gICAgICAgIG1pbmluZGVudCA9IGluZGVudGVkO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gbWlubGluZTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGdldFN0YXRlQmVmb3JlKGNtLCBuLCBwcmVjaXNlKSB7XG4gICAgdmFyIGRvYyA9IGNtLmRvYywgZGlzcGxheSA9IGNtLmRpc3BsYXk7XG4gICAgaWYgKCFkb2MubW9kZS5zdGFydFN0YXRlKSByZXR1cm4gdHJ1ZTtcbiAgICB2YXIgcG9zID0gZmluZFN0YXJ0TGluZShjbSwgbiwgcHJlY2lzZSksIHN0YXRlID0gcG9zID4gZG9jLmZpcnN0ICYmIGdldExpbmUoZG9jLCBwb3MtMSkuc3RhdGVBZnRlcjtcbiAgICBpZiAoIXN0YXRlKSBzdGF0ZSA9IHN0YXJ0U3RhdGUoZG9jLm1vZGUpO1xuICAgIGVsc2Ugc3RhdGUgPSBjb3B5U3RhdGUoZG9jLm1vZGUsIHN0YXRlKTtcbiAgICBkb2MuaXRlcihwb3MsIG4sIGZ1bmN0aW9uKGxpbmUpIHtcbiAgICAgIHByb2Nlc3NMaW5lKGNtLCBsaW5lLnRleHQsIHN0YXRlKTtcbiAgICAgIHZhciBzYXZlID0gcG9zID09IG4gLSAxIHx8IHBvcyAlIDUgPT0gMCB8fCBwb3MgPj0gZGlzcGxheS52aWV3RnJvbSAmJiBwb3MgPCBkaXNwbGF5LnZpZXdUbztcbiAgICAgIGxpbmUuc3RhdGVBZnRlciA9IHNhdmUgPyBjb3B5U3RhdGUoZG9jLm1vZGUsIHN0YXRlKSA6IG51bGw7XG4gICAgICArK3BvcztcbiAgICB9KTtcbiAgICBpZiAocHJlY2lzZSkgZG9jLmZyb250aWVyID0gcG9zO1xuICAgIHJldHVybiBzdGF0ZTtcbiAgfVxuXG4gIC8vIFBPU0lUSU9OIE1FQVNVUkVNRU5UXG5cbiAgZnVuY3Rpb24gcGFkZGluZ1RvcChkaXNwbGF5KSB7cmV0dXJuIGRpc3BsYXkubGluZVNwYWNlLm9mZnNldFRvcDt9XG4gIGZ1bmN0aW9uIHBhZGRpbmdWZXJ0KGRpc3BsYXkpIHtyZXR1cm4gZGlzcGxheS5tb3Zlci5vZmZzZXRIZWlnaHQgLSBkaXNwbGF5LmxpbmVTcGFjZS5vZmZzZXRIZWlnaHQ7fVxuICBmdW5jdGlvbiBwYWRkaW5nSChkaXNwbGF5KSB7XG4gICAgaWYgKGRpc3BsYXkuY2FjaGVkUGFkZGluZ0gpIHJldHVybiBkaXNwbGF5LmNhY2hlZFBhZGRpbmdIO1xuICAgIHZhciBlID0gcmVtb3ZlQ2hpbGRyZW5BbmRBZGQoZGlzcGxheS5tZWFzdXJlLCBlbHQoXCJwcmVcIiwgXCJ4XCIpKTtcbiAgICB2YXIgc3R5bGUgPSB3aW5kb3cuZ2V0Q29tcHV0ZWRTdHlsZSA/IHdpbmRvdy5nZXRDb21wdXRlZFN0eWxlKGUpIDogZS5jdXJyZW50U3R5bGU7XG4gICAgdmFyIGRhdGEgPSB7bGVmdDogcGFyc2VJbnQoc3R5bGUucGFkZGluZ0xlZnQpLCByaWdodDogcGFyc2VJbnQoc3R5bGUucGFkZGluZ1JpZ2h0KX07XG4gICAgaWYgKCFpc05hTihkYXRhLmxlZnQpICYmICFpc05hTihkYXRhLnJpZ2h0KSkgZGlzcGxheS5jYWNoZWRQYWRkaW5nSCA9IGRhdGE7XG4gICAgcmV0dXJuIGRhdGE7XG4gIH1cblxuICBmdW5jdGlvbiBzY3JvbGxHYXAoY20pIHsgcmV0dXJuIHNjcm9sbGVyR2FwIC0gY20uZGlzcGxheS5uYXRpdmVCYXJXaWR0aDsgfVxuICBmdW5jdGlvbiBkaXNwbGF5V2lkdGgoY20pIHtcbiAgICByZXR1cm4gY20uZGlzcGxheS5zY3JvbGxlci5jbGllbnRXaWR0aCAtIHNjcm9sbEdhcChjbSkgLSBjbS5kaXNwbGF5LmJhcldpZHRoO1xuICB9XG4gIGZ1bmN0aW9uIGRpc3BsYXlIZWlnaHQoY20pIHtcbiAgICByZXR1cm4gY20uZGlzcGxheS5zY3JvbGxlci5jbGllbnRIZWlnaHQgLSBzY3JvbGxHYXAoY20pIC0gY20uZGlzcGxheS5iYXJIZWlnaHQ7XG4gIH1cblxuICAvLyBFbnN1cmUgdGhlIGxpbmVWaWV3LndyYXBwaW5nLmhlaWdodHMgYXJyYXkgaXMgcG9wdWxhdGVkLiBUaGlzIGlzXG4gIC8vIGFuIGFycmF5IG9mIGJvdHRvbSBvZmZzZXRzIGZvciB0aGUgbGluZXMgdGhhdCBtYWtlIHVwIGEgZHJhd25cbiAgLy8gbGluZS4gV2hlbiBsaW5lV3JhcHBpbmcgaXMgb24sIHRoZXJlIG1pZ2h0IGJlIG1vcmUgdGhhbiBvbmVcbiAgLy8gaGVpZ2h0LlxuICBmdW5jdGlvbiBlbnN1cmVMaW5lSGVpZ2h0cyhjbSwgbGluZVZpZXcsIHJlY3QpIHtcbiAgICB2YXIgd3JhcHBpbmcgPSBjbS5vcHRpb25zLmxpbmVXcmFwcGluZztcbiAgICB2YXIgY3VyV2lkdGggPSB3cmFwcGluZyAmJiBkaXNwbGF5V2lkdGgoY20pO1xuICAgIGlmICghbGluZVZpZXcubWVhc3VyZS5oZWlnaHRzIHx8IHdyYXBwaW5nICYmIGxpbmVWaWV3Lm1lYXN1cmUud2lkdGggIT0gY3VyV2lkdGgpIHtcbiAgICAgIHZhciBoZWlnaHRzID0gbGluZVZpZXcubWVhc3VyZS5oZWlnaHRzID0gW107XG4gICAgICBpZiAod3JhcHBpbmcpIHtcbiAgICAgICAgbGluZVZpZXcubWVhc3VyZS53aWR0aCA9IGN1cldpZHRoO1xuICAgICAgICB2YXIgcmVjdHMgPSBsaW5lVmlldy50ZXh0LmZpcnN0Q2hpbGQuZ2V0Q2xpZW50UmVjdHMoKTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCByZWN0cy5sZW5ndGggLSAxOyBpKyspIHtcbiAgICAgICAgICB2YXIgY3VyID0gcmVjdHNbaV0sIG5leHQgPSByZWN0c1tpICsgMV07XG4gICAgICAgICAgaWYgKE1hdGguYWJzKGN1ci5ib3R0b20gLSBuZXh0LmJvdHRvbSkgPiAyKVxuICAgICAgICAgICAgaGVpZ2h0cy5wdXNoKChjdXIuYm90dG9tICsgbmV4dC50b3ApIC8gMiAtIHJlY3QudG9wKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaGVpZ2h0cy5wdXNoKHJlY3QuYm90dG9tIC0gcmVjdC50b3ApO1xuICAgIH1cbiAgfVxuXG4gIC8vIEZpbmQgYSBsaW5lIG1hcCAobWFwcGluZyBjaGFyYWN0ZXIgb2Zmc2V0cyB0byB0ZXh0IG5vZGVzKSBhbmQgYVxuICAvLyBtZWFzdXJlbWVudCBjYWNoZSBmb3IgdGhlIGdpdmVuIGxpbmUgbnVtYmVyLiAoQSBsaW5lIHZpZXcgbWlnaHRcbiAgLy8gY29udGFpbiBtdWx0aXBsZSBsaW5lcyB3aGVuIGNvbGxhcHNlZCByYW5nZXMgYXJlIHByZXNlbnQuKVxuICBmdW5jdGlvbiBtYXBGcm9tTGluZVZpZXcobGluZVZpZXcsIGxpbmUsIGxpbmVOKSB7XG4gICAgaWYgKGxpbmVWaWV3LmxpbmUgPT0gbGluZSlcbiAgICAgIHJldHVybiB7bWFwOiBsaW5lVmlldy5tZWFzdXJlLm1hcCwgY2FjaGU6IGxpbmVWaWV3Lm1lYXN1cmUuY2FjaGV9O1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGluZVZpZXcucmVzdC5sZW5ndGg7IGkrKylcbiAgICAgIGlmIChsaW5lVmlldy5yZXN0W2ldID09IGxpbmUpXG4gICAgICAgIHJldHVybiB7bWFwOiBsaW5lVmlldy5tZWFzdXJlLm1hcHNbaV0sIGNhY2hlOiBsaW5lVmlldy5tZWFzdXJlLmNhY2hlc1tpXX07XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsaW5lVmlldy5yZXN0Lmxlbmd0aDsgaSsrKVxuICAgICAgaWYgKGxpbmVObyhsaW5lVmlldy5yZXN0W2ldKSA+IGxpbmVOKVxuICAgICAgICByZXR1cm4ge21hcDogbGluZVZpZXcubWVhc3VyZS5tYXBzW2ldLCBjYWNoZTogbGluZVZpZXcubWVhc3VyZS5jYWNoZXNbaV0sIGJlZm9yZTogdHJ1ZX07XG4gIH1cblxuICAvLyBSZW5kZXIgYSBsaW5lIGludG8gdGhlIGhpZGRlbiBub2RlIGRpc3BsYXkuZXh0ZXJuYWxNZWFzdXJlZC4gVXNlZFxuICAvLyB3aGVuIG1lYXN1cmVtZW50IGlzIG5lZWRlZCBmb3IgYSBsaW5lIHRoYXQncyBub3QgaW4gdGhlIHZpZXdwb3J0LlxuICBmdW5jdGlvbiB1cGRhdGVFeHRlcm5hbE1lYXN1cmVtZW50KGNtLCBsaW5lKSB7XG4gICAgbGluZSA9IHZpc3VhbExpbmUobGluZSk7XG4gICAgdmFyIGxpbmVOID0gbGluZU5vKGxpbmUpO1xuICAgIHZhciB2aWV3ID0gY20uZGlzcGxheS5leHRlcm5hbE1lYXN1cmVkID0gbmV3IExpbmVWaWV3KGNtLmRvYywgbGluZSwgbGluZU4pO1xuICAgIHZpZXcubGluZU4gPSBsaW5lTjtcbiAgICB2YXIgYnVpbHQgPSB2aWV3LmJ1aWx0ID0gYnVpbGRMaW5lQ29udGVudChjbSwgdmlldyk7XG4gICAgdmlldy50ZXh0ID0gYnVpbHQucHJlO1xuICAgIHJlbW92ZUNoaWxkcmVuQW5kQWRkKGNtLmRpc3BsYXkubGluZU1lYXN1cmUsIGJ1aWx0LnByZSk7XG4gICAgcmV0dXJuIHZpZXc7XG4gIH1cblxuICAvLyBHZXQgYSB7dG9wLCBib3R0b20sIGxlZnQsIHJpZ2h0fSBib3ggKGluIGxpbmUtbG9jYWwgY29vcmRpbmF0ZXMpXG4gIC8vIGZvciBhIGdpdmVuIGNoYXJhY3Rlci5cbiAgZnVuY3Rpb24gbWVhc3VyZUNoYXIoY20sIGxpbmUsIGNoLCBiaWFzKSB7XG4gICAgcmV0dXJuIG1lYXN1cmVDaGFyUHJlcGFyZWQoY20sIHByZXBhcmVNZWFzdXJlRm9yTGluZShjbSwgbGluZSksIGNoLCBiaWFzKTtcbiAgfVxuXG4gIC8vIEZpbmQgYSBsaW5lIHZpZXcgdGhhdCBjb3JyZXNwb25kcyB0byB0aGUgZ2l2ZW4gbGluZSBudW1iZXIuXG4gIGZ1bmN0aW9uIGZpbmRWaWV3Rm9yTGluZShjbSwgbGluZU4pIHtcbiAgICBpZiAobGluZU4gPj0gY20uZGlzcGxheS52aWV3RnJvbSAmJiBsaW5lTiA8IGNtLmRpc3BsYXkudmlld1RvKVxuICAgICAgcmV0dXJuIGNtLmRpc3BsYXkudmlld1tmaW5kVmlld0luZGV4KGNtLCBsaW5lTildO1xuICAgIHZhciBleHQgPSBjbS5kaXNwbGF5LmV4dGVybmFsTWVhc3VyZWQ7XG4gICAgaWYgKGV4dCAmJiBsaW5lTiA+PSBleHQubGluZU4gJiYgbGluZU4gPCBleHQubGluZU4gKyBleHQuc2l6ZSlcbiAgICAgIHJldHVybiBleHQ7XG4gIH1cblxuICAvLyBNZWFzdXJlbWVudCBjYW4gYmUgc3BsaXQgaW4gdHdvIHN0ZXBzLCB0aGUgc2V0LXVwIHdvcmsgdGhhdFxuICAvLyBhcHBsaWVzIHRvIHRoZSB3aG9sZSBsaW5lLCBhbmQgdGhlIG1lYXN1cmVtZW50IG9mIHRoZSBhY3R1YWxcbiAgLy8gY2hhcmFjdGVyLiBGdW5jdGlvbnMgbGlrZSBjb29yZHNDaGFyLCB0aGF0IG5lZWQgdG8gZG8gYSBsb3Qgb2ZcbiAgLy8gbWVhc3VyZW1lbnRzIGluIGEgcm93LCBjYW4gdGh1cyBlbnN1cmUgdGhhdCB0aGUgc2V0LXVwIHdvcmsgaXNcbiAgLy8gb25seSBkb25lIG9uY2UuXG4gIGZ1bmN0aW9uIHByZXBhcmVNZWFzdXJlRm9yTGluZShjbSwgbGluZSkge1xuICAgIHZhciBsaW5lTiA9IGxpbmVObyhsaW5lKTtcbiAgICB2YXIgdmlldyA9IGZpbmRWaWV3Rm9yTGluZShjbSwgbGluZU4pO1xuICAgIGlmICh2aWV3ICYmICF2aWV3LnRleHQpXG4gICAgICB2aWV3ID0gbnVsbDtcbiAgICBlbHNlIGlmICh2aWV3ICYmIHZpZXcuY2hhbmdlcylcbiAgICAgIHVwZGF0ZUxpbmVGb3JDaGFuZ2VzKGNtLCB2aWV3LCBsaW5lTiwgZ2V0RGltZW5zaW9ucyhjbSkpO1xuICAgIGlmICghdmlldylcbiAgICAgIHZpZXcgPSB1cGRhdGVFeHRlcm5hbE1lYXN1cmVtZW50KGNtLCBsaW5lKTtcblxuICAgIHZhciBpbmZvID0gbWFwRnJvbUxpbmVWaWV3KHZpZXcsIGxpbmUsIGxpbmVOKTtcbiAgICByZXR1cm4ge1xuICAgICAgbGluZTogbGluZSwgdmlldzogdmlldywgcmVjdDogbnVsbCxcbiAgICAgIG1hcDogaW5mby5tYXAsIGNhY2hlOiBpbmZvLmNhY2hlLCBiZWZvcmU6IGluZm8uYmVmb3JlLFxuICAgICAgaGFzSGVpZ2h0czogZmFsc2VcbiAgICB9O1xuICB9XG5cbiAgLy8gR2l2ZW4gYSBwcmVwYXJlZCBtZWFzdXJlbWVudCBvYmplY3QsIG1lYXN1cmVzIHRoZSBwb3NpdGlvbiBvZiBhblxuICAvLyBhY3R1YWwgY2hhcmFjdGVyIChvciBmZXRjaGVzIGl0IGZyb20gdGhlIGNhY2hlKS5cbiAgZnVuY3Rpb24gbWVhc3VyZUNoYXJQcmVwYXJlZChjbSwgcHJlcGFyZWQsIGNoLCBiaWFzLCB2YXJIZWlnaHQpIHtcbiAgICBpZiAocHJlcGFyZWQuYmVmb3JlKSBjaCA9IC0xO1xuICAgIHZhciBrZXkgPSBjaCArIChiaWFzIHx8IFwiXCIpLCBmb3VuZDtcbiAgICBpZiAocHJlcGFyZWQuY2FjaGUuaGFzT3duUHJvcGVydHkoa2V5KSkge1xuICAgICAgZm91bmQgPSBwcmVwYXJlZC5jYWNoZVtrZXldO1xuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoIXByZXBhcmVkLnJlY3QpXG4gICAgICAgIHByZXBhcmVkLnJlY3QgPSBwcmVwYXJlZC52aWV3LnRleHQuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgICBpZiAoIXByZXBhcmVkLmhhc0hlaWdodHMpIHtcbiAgICAgICAgZW5zdXJlTGluZUhlaWdodHMoY20sIHByZXBhcmVkLnZpZXcsIHByZXBhcmVkLnJlY3QpO1xuICAgICAgICBwcmVwYXJlZC5oYXNIZWlnaHRzID0gdHJ1ZTtcbiAgICAgIH1cbiAgICAgIGZvdW5kID0gbWVhc3VyZUNoYXJJbm5lcihjbSwgcHJlcGFyZWQsIGNoLCBiaWFzKTtcbiAgICAgIGlmICghZm91bmQuYm9ndXMpIHByZXBhcmVkLmNhY2hlW2tleV0gPSBmb3VuZDtcbiAgICB9XG4gICAgcmV0dXJuIHtsZWZ0OiBmb3VuZC5sZWZ0LCByaWdodDogZm91bmQucmlnaHQsXG4gICAgICAgICAgICB0b3A6IHZhckhlaWdodCA/IGZvdW5kLnJ0b3AgOiBmb3VuZC50b3AsXG4gICAgICAgICAgICBib3R0b206IHZhckhlaWdodCA/IGZvdW5kLnJib3R0b20gOiBmb3VuZC5ib3R0b219O1xuICB9XG5cbiAgdmFyIG51bGxSZWN0ID0ge2xlZnQ6IDAsIHJpZ2h0OiAwLCB0b3A6IDAsIGJvdHRvbTogMH07XG5cbiAgZnVuY3Rpb24gbm9kZUFuZE9mZnNldEluTGluZU1hcChtYXAsIGNoLCBiaWFzKSB7XG4gICAgdmFyIG5vZGUsIHN0YXJ0LCBlbmQsIGNvbGxhcHNlO1xuICAgIC8vIEZpcnN0LCBzZWFyY2ggdGhlIGxpbmUgbWFwIGZvciB0aGUgdGV4dCBub2RlIGNvcnJlc3BvbmRpbmcgdG8sXG4gICAgLy8gb3IgY2xvc2VzdCB0bywgdGhlIHRhcmdldCBjaGFyYWN0ZXIuXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBtYXAubGVuZ3RoOyBpICs9IDMpIHtcbiAgICAgIHZhciBtU3RhcnQgPSBtYXBbaV0sIG1FbmQgPSBtYXBbaSArIDFdO1xuICAgICAgaWYgKGNoIDwgbVN0YXJ0KSB7XG4gICAgICAgIHN0YXJ0ID0gMDsgZW5kID0gMTtcbiAgICAgICAgY29sbGFwc2UgPSBcImxlZnRcIjtcbiAgICAgIH0gZWxzZSBpZiAoY2ggPCBtRW5kKSB7XG4gICAgICAgIHN0YXJ0ID0gY2ggLSBtU3RhcnQ7XG4gICAgICAgIGVuZCA9IHN0YXJ0ICsgMTtcbiAgICAgIH0gZWxzZSBpZiAoaSA9PSBtYXAubGVuZ3RoIC0gMyB8fCBjaCA9PSBtRW5kICYmIG1hcFtpICsgM10gPiBjaCkge1xuICAgICAgICBlbmQgPSBtRW5kIC0gbVN0YXJ0O1xuICAgICAgICBzdGFydCA9IGVuZCAtIDE7XG4gICAgICAgIGlmIChjaCA+PSBtRW5kKSBjb2xsYXBzZSA9IFwicmlnaHRcIjtcbiAgICAgIH1cbiAgICAgIGlmIChzdGFydCAhPSBudWxsKSB7XG4gICAgICAgIG5vZGUgPSBtYXBbaSArIDJdO1xuICAgICAgICBpZiAobVN0YXJ0ID09IG1FbmQgJiYgYmlhcyA9PSAobm9kZS5pbnNlcnRMZWZ0ID8gXCJsZWZ0XCIgOiBcInJpZ2h0XCIpKVxuICAgICAgICAgIGNvbGxhcHNlID0gYmlhcztcbiAgICAgICAgaWYgKGJpYXMgPT0gXCJsZWZ0XCIgJiYgc3RhcnQgPT0gMClcbiAgICAgICAgICB3aGlsZSAoaSAmJiBtYXBbaSAtIDJdID09IG1hcFtpIC0gM10gJiYgbWFwW2kgLSAxXS5pbnNlcnRMZWZ0KSB7XG4gICAgICAgICAgICBub2RlID0gbWFwWyhpIC09IDMpICsgMl07XG4gICAgICAgICAgICBjb2xsYXBzZSA9IFwibGVmdFwiO1xuICAgICAgICAgIH1cbiAgICAgICAgaWYgKGJpYXMgPT0gXCJyaWdodFwiICYmIHN0YXJ0ID09IG1FbmQgLSBtU3RhcnQpXG4gICAgICAgICAgd2hpbGUgKGkgPCBtYXAubGVuZ3RoIC0gMyAmJiBtYXBbaSArIDNdID09IG1hcFtpICsgNF0gJiYgIW1hcFtpICsgNV0uaW5zZXJ0TGVmdCkge1xuICAgICAgICAgICAgbm9kZSA9IG1hcFsoaSArPSAzKSArIDJdO1xuICAgICAgICAgICAgY29sbGFwc2UgPSBcInJpZ2h0XCI7XG4gICAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHtub2RlOiBub2RlLCBzdGFydDogc3RhcnQsIGVuZDogZW5kLCBjb2xsYXBzZTogY29sbGFwc2UsIGNvdmVyU3RhcnQ6IG1TdGFydCwgY292ZXJFbmQ6IG1FbmR9O1xuICB9XG5cbiAgZnVuY3Rpb24gbWVhc3VyZUNoYXJJbm5lcihjbSwgcHJlcGFyZWQsIGNoLCBiaWFzKSB7XG4gICAgdmFyIHBsYWNlID0gbm9kZUFuZE9mZnNldEluTGluZU1hcChwcmVwYXJlZC5tYXAsIGNoLCBiaWFzKTtcbiAgICB2YXIgbm9kZSA9IHBsYWNlLm5vZGUsIHN0YXJ0ID0gcGxhY2Uuc3RhcnQsIGVuZCA9IHBsYWNlLmVuZCwgY29sbGFwc2UgPSBwbGFjZS5jb2xsYXBzZTtcblxuICAgIHZhciByZWN0O1xuICAgIGlmIChub2RlLm5vZGVUeXBlID09IDMpIHsgLy8gSWYgaXQgaXMgYSB0ZXh0IG5vZGUsIHVzZSBhIHJhbmdlIHRvIHJldHJpZXZlIHRoZSBjb29yZGluYXRlcy5cbiAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgNDsgaSsrKSB7IC8vIFJldHJ5IGEgbWF4aW11bSBvZiA0IHRpbWVzIHdoZW4gbm9uc2Vuc2UgcmVjdGFuZ2xlcyBhcmUgcmV0dXJuZWRcbiAgICAgICAgd2hpbGUgKHN0YXJ0ICYmIGlzRXh0ZW5kaW5nQ2hhcihwcmVwYXJlZC5saW5lLnRleHQuY2hhckF0KHBsYWNlLmNvdmVyU3RhcnQgKyBzdGFydCkpKSAtLXN0YXJ0O1xuICAgICAgICB3aGlsZSAocGxhY2UuY292ZXJTdGFydCArIGVuZCA8IHBsYWNlLmNvdmVyRW5kICYmIGlzRXh0ZW5kaW5nQ2hhcihwcmVwYXJlZC5saW5lLnRleHQuY2hhckF0KHBsYWNlLmNvdmVyU3RhcnQgKyBlbmQpKSkgKytlbmQ7XG4gICAgICAgIGlmIChpZSAmJiBpZV92ZXJzaW9uIDwgOSAmJiBzdGFydCA9PSAwICYmIGVuZCA9PSBwbGFjZS5jb3ZlckVuZCAtIHBsYWNlLmNvdmVyU3RhcnQpIHtcbiAgICAgICAgICByZWN0ID0gbm9kZS5wYXJlbnROb2RlLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgICAgICB9IGVsc2UgaWYgKGllICYmIGNtLm9wdGlvbnMubGluZVdyYXBwaW5nKSB7XG4gICAgICAgICAgdmFyIHJlY3RzID0gcmFuZ2Uobm9kZSwgc3RhcnQsIGVuZCkuZ2V0Q2xpZW50UmVjdHMoKTtcbiAgICAgICAgICBpZiAocmVjdHMubGVuZ3RoKVxuICAgICAgICAgICAgcmVjdCA9IHJlY3RzW2JpYXMgPT0gXCJyaWdodFwiID8gcmVjdHMubGVuZ3RoIC0gMSA6IDBdO1xuICAgICAgICAgIGVsc2VcbiAgICAgICAgICAgIHJlY3QgPSBudWxsUmVjdDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZWN0ID0gcmFuZ2Uobm9kZSwgc3RhcnQsIGVuZCkuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCkgfHwgbnVsbFJlY3Q7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHJlY3QubGVmdCB8fCByZWN0LnJpZ2h0IHx8IHN0YXJ0ID09IDApIGJyZWFrO1xuICAgICAgICBlbmQgPSBzdGFydDtcbiAgICAgICAgc3RhcnQgPSBzdGFydCAtIDE7XG4gICAgICAgIGNvbGxhcHNlID0gXCJyaWdodFwiO1xuICAgICAgfVxuICAgICAgaWYgKGllICYmIGllX3ZlcnNpb24gPCAxMSkgcmVjdCA9IG1heWJlVXBkYXRlUmVjdEZvclpvb21pbmcoY20uZGlzcGxheS5tZWFzdXJlLCByZWN0KTtcbiAgICB9IGVsc2UgeyAvLyBJZiBpdCBpcyBhIHdpZGdldCwgc2ltcGx5IGdldCB0aGUgYm94IGZvciB0aGUgd2hvbGUgd2lkZ2V0LlxuICAgICAgaWYgKHN0YXJ0ID4gMCkgY29sbGFwc2UgPSBiaWFzID0gXCJyaWdodFwiO1xuICAgICAgdmFyIHJlY3RzO1xuICAgICAgaWYgKGNtLm9wdGlvbnMubGluZVdyYXBwaW5nICYmIChyZWN0cyA9IG5vZGUuZ2V0Q2xpZW50UmVjdHMoKSkubGVuZ3RoID4gMSlcbiAgICAgICAgcmVjdCA9IHJlY3RzW2JpYXMgPT0gXCJyaWdodFwiID8gcmVjdHMubGVuZ3RoIC0gMSA6IDBdO1xuICAgICAgZWxzZVxuICAgICAgICByZWN0ID0gbm9kZS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICB9XG4gICAgaWYgKGllICYmIGllX3ZlcnNpb24gPCA5ICYmICFzdGFydCAmJiAoIXJlY3QgfHwgIXJlY3QubGVmdCAmJiAhcmVjdC5yaWdodCkpIHtcbiAgICAgIHZhciByU3BhbiA9IG5vZGUucGFyZW50Tm9kZS5nZXRDbGllbnRSZWN0cygpWzBdO1xuICAgICAgaWYgKHJTcGFuKVxuICAgICAgICByZWN0ID0ge2xlZnQ6IHJTcGFuLmxlZnQsIHJpZ2h0OiByU3Bhbi5sZWZ0ICsgY2hhcldpZHRoKGNtLmRpc3BsYXkpLCB0b3A6IHJTcGFuLnRvcCwgYm90dG9tOiByU3Bhbi5ib3R0b219O1xuICAgICAgZWxzZVxuICAgICAgICByZWN0ID0gbnVsbFJlY3Q7XG4gICAgfVxuXG4gICAgdmFyIHJ0b3AgPSByZWN0LnRvcCAtIHByZXBhcmVkLnJlY3QudG9wLCByYm90ID0gcmVjdC5ib3R0b20gLSBwcmVwYXJlZC5yZWN0LnRvcDtcbiAgICB2YXIgbWlkID0gKHJ0b3AgKyByYm90KSAvIDI7XG4gICAgdmFyIGhlaWdodHMgPSBwcmVwYXJlZC52aWV3Lm1lYXN1cmUuaGVpZ2h0cztcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGhlaWdodHMubGVuZ3RoIC0gMTsgaSsrKVxuICAgICAgaWYgKG1pZCA8IGhlaWdodHNbaV0pIGJyZWFrO1xuICAgIHZhciB0b3AgPSBpID8gaGVpZ2h0c1tpIC0gMV0gOiAwLCBib3QgPSBoZWlnaHRzW2ldO1xuICAgIHZhciByZXN1bHQgPSB7bGVmdDogKGNvbGxhcHNlID09IFwicmlnaHRcIiA/IHJlY3QucmlnaHQgOiByZWN0LmxlZnQpIC0gcHJlcGFyZWQucmVjdC5sZWZ0LFxuICAgICAgICAgICAgICAgICAgcmlnaHQ6IChjb2xsYXBzZSA9PSBcImxlZnRcIiA/IHJlY3QubGVmdCA6IHJlY3QucmlnaHQpIC0gcHJlcGFyZWQucmVjdC5sZWZ0LFxuICAgICAgICAgICAgICAgICAgdG9wOiB0b3AsIGJvdHRvbTogYm90fTtcbiAgICBpZiAoIXJlY3QubGVmdCAmJiAhcmVjdC5yaWdodCkgcmVzdWx0LmJvZ3VzID0gdHJ1ZTtcbiAgICBpZiAoIWNtLm9wdGlvbnMuc2luZ2xlQ3Vyc29ySGVpZ2h0UGVyTGluZSkgeyByZXN1bHQucnRvcCA9IHJ0b3A7IHJlc3VsdC5yYm90dG9tID0gcmJvdDsgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuXG4gIC8vIFdvcmsgYXJvdW5kIHByb2JsZW0gd2l0aCBib3VuZGluZyBjbGllbnQgcmVjdHMgb24gcmFuZ2VzIGJlaW5nXG4gIC8vIHJldHVybmVkIGluY29ycmVjdGx5IHdoZW4gem9vbWVkIG9uIElFMTAgYW5kIGJlbG93LlxuICBmdW5jdGlvbiBtYXliZVVwZGF0ZVJlY3RGb3Jab29taW5nKG1lYXN1cmUsIHJlY3QpIHtcbiAgICBpZiAoIXdpbmRvdy5zY3JlZW4gfHwgc2NyZWVuLmxvZ2ljYWxYRFBJID09IG51bGwgfHxcbiAgICAgICAgc2NyZWVuLmxvZ2ljYWxYRFBJID09IHNjcmVlbi5kZXZpY2VYRFBJIHx8ICFoYXNCYWRab29tZWRSZWN0cyhtZWFzdXJlKSlcbiAgICAgIHJldHVybiByZWN0O1xuICAgIHZhciBzY2FsZVggPSBzY3JlZW4ubG9naWNhbFhEUEkgLyBzY3JlZW4uZGV2aWNlWERQSTtcbiAgICB2YXIgc2NhbGVZID0gc2NyZWVuLmxvZ2ljYWxZRFBJIC8gc2NyZWVuLmRldmljZVlEUEk7XG4gICAgcmV0dXJuIHtsZWZ0OiByZWN0LmxlZnQgKiBzY2FsZVgsIHJpZ2h0OiByZWN0LnJpZ2h0ICogc2NhbGVYLFxuICAgICAgICAgICAgdG9wOiByZWN0LnRvcCAqIHNjYWxlWSwgYm90dG9tOiByZWN0LmJvdHRvbSAqIHNjYWxlWX07XG4gIH1cblxuICBmdW5jdGlvbiBjbGVhckxpbmVNZWFzdXJlbWVudENhY2hlRm9yKGxpbmVWaWV3KSB7XG4gICAgaWYgKGxpbmVWaWV3Lm1lYXN1cmUpIHtcbiAgICAgIGxpbmVWaWV3Lm1lYXN1cmUuY2FjaGUgPSB7fTtcbiAgICAgIGxpbmVWaWV3Lm1lYXN1cmUuaGVpZ2h0cyA9IG51bGw7XG4gICAgICBpZiAobGluZVZpZXcucmVzdCkgZm9yICh2YXIgaSA9IDA7IGkgPCBsaW5lVmlldy5yZXN0Lmxlbmd0aDsgaSsrKVxuICAgICAgICBsaW5lVmlldy5tZWFzdXJlLmNhY2hlc1tpXSA9IHt9O1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIGNsZWFyTGluZU1lYXN1cmVtZW50Q2FjaGUoY20pIHtcbiAgICBjbS5kaXNwbGF5LmV4dGVybmFsTWVhc3VyZSA9IG51bGw7XG4gICAgcmVtb3ZlQ2hpbGRyZW4oY20uZGlzcGxheS5saW5lTWVhc3VyZSk7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBjbS5kaXNwbGF5LnZpZXcubGVuZ3RoOyBpKyspXG4gICAgICBjbGVhckxpbmVNZWFzdXJlbWVudENhY2hlRm9yKGNtLmRpc3BsYXkudmlld1tpXSk7XG4gIH1cblxuICBmdW5jdGlvbiBjbGVhckNhY2hlcyhjbSkge1xuICAgIGNsZWFyTGluZU1lYXN1cmVtZW50Q2FjaGUoY20pO1xuICAgIGNtLmRpc3BsYXkuY2FjaGVkQ2hhcldpZHRoID0gY20uZGlzcGxheS5jYWNoZWRUZXh0SGVpZ2h0ID0gY20uZGlzcGxheS5jYWNoZWRQYWRkaW5nSCA9IG51bGw7XG4gICAgaWYgKCFjbS5vcHRpb25zLmxpbmVXcmFwcGluZykgY20uZGlzcGxheS5tYXhMaW5lQ2hhbmdlZCA9IHRydWU7XG4gICAgY20uZGlzcGxheS5saW5lTnVtQ2hhcnMgPSBudWxsO1xuICB9XG5cbiAgZnVuY3Rpb24gcGFnZVNjcm9sbFgoKSB7IHJldHVybiB3aW5kb3cucGFnZVhPZmZzZXQgfHwgKGRvY3VtZW50LmRvY3VtZW50RWxlbWVudCB8fCBkb2N1bWVudC5ib2R5KS5zY3JvbGxMZWZ0OyB9XG4gIGZ1bmN0aW9uIHBhZ2VTY3JvbGxZKCkgeyByZXR1cm4gd2luZG93LnBhZ2VZT2Zmc2V0IHx8IChkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQgfHwgZG9jdW1lbnQuYm9keSkuc2Nyb2xsVG9wOyB9XG5cbiAgLy8gQ29udmVydHMgYSB7dG9wLCBib3R0b20sIGxlZnQsIHJpZ2h0fSBib3ggZnJvbSBsaW5lLWxvY2FsXG4gIC8vIGNvb3JkaW5hdGVzIGludG8gYW5vdGhlciBjb29yZGluYXRlIHN5c3RlbS4gQ29udGV4dCBtYXkgYmUgb25lIG9mXG4gIC8vIFwibGluZVwiLCBcImRpdlwiIChkaXNwbGF5LmxpbmVEaXYpLCBcImxvY2FsXCIvbnVsbCAoZWRpdG9yKSwgXCJ3aW5kb3dcIixcbiAgLy8gb3IgXCJwYWdlXCIuXG4gIGZ1bmN0aW9uIGludG9Db29yZFN5c3RlbShjbSwgbGluZU9iaiwgcmVjdCwgY29udGV4dCkge1xuICAgIGlmIChsaW5lT2JqLndpZGdldHMpIGZvciAodmFyIGkgPSAwOyBpIDwgbGluZU9iai53aWRnZXRzLmxlbmd0aDsgKytpKSBpZiAobGluZU9iai53aWRnZXRzW2ldLmFib3ZlKSB7XG4gICAgICB2YXIgc2l6ZSA9IHdpZGdldEhlaWdodChsaW5lT2JqLndpZGdldHNbaV0pO1xuICAgICAgcmVjdC50b3AgKz0gc2l6ZTsgcmVjdC5ib3R0b20gKz0gc2l6ZTtcbiAgICB9XG4gICAgaWYgKGNvbnRleHQgPT0gXCJsaW5lXCIpIHJldHVybiByZWN0O1xuICAgIGlmICghY29udGV4dCkgY29udGV4dCA9IFwibG9jYWxcIjtcbiAgICB2YXIgeU9mZiA9IGhlaWdodEF0TGluZShsaW5lT2JqKTtcbiAgICBpZiAoY29udGV4dCA9PSBcImxvY2FsXCIpIHlPZmYgKz0gcGFkZGluZ1RvcChjbS5kaXNwbGF5KTtcbiAgICBlbHNlIHlPZmYgLT0gY20uZGlzcGxheS52aWV3T2Zmc2V0O1xuICAgIGlmIChjb250ZXh0ID09IFwicGFnZVwiIHx8IGNvbnRleHQgPT0gXCJ3aW5kb3dcIikge1xuICAgICAgdmFyIGxPZmYgPSBjbS5kaXNwbGF5LmxpbmVTcGFjZS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICAgIHlPZmYgKz0gbE9mZi50b3AgKyAoY29udGV4dCA9PSBcIndpbmRvd1wiID8gMCA6IHBhZ2VTY3JvbGxZKCkpO1xuICAgICAgdmFyIHhPZmYgPSBsT2ZmLmxlZnQgKyAoY29udGV4dCA9PSBcIndpbmRvd1wiID8gMCA6IHBhZ2VTY3JvbGxYKCkpO1xuICAgICAgcmVjdC5sZWZ0ICs9IHhPZmY7IHJlY3QucmlnaHQgKz0geE9mZjtcbiAgICB9XG4gICAgcmVjdC50b3AgKz0geU9mZjsgcmVjdC5ib3R0b20gKz0geU9mZjtcbiAgICByZXR1cm4gcmVjdDtcbiAgfVxuXG4gIC8vIENvdmVydHMgYSBib3ggZnJvbSBcImRpdlwiIGNvb3JkcyB0byBhbm90aGVyIGNvb3JkaW5hdGUgc3lzdGVtLlxuICAvLyBDb250ZXh0IG1heSBiZSBcIndpbmRvd1wiLCBcInBhZ2VcIiwgXCJkaXZcIiwgb3IgXCJsb2NhbFwiL251bGwuXG4gIGZ1bmN0aW9uIGZyb21Db29yZFN5c3RlbShjbSwgY29vcmRzLCBjb250ZXh0KSB7XG4gICAgaWYgKGNvbnRleHQgPT0gXCJkaXZcIikgcmV0dXJuIGNvb3JkcztcbiAgICB2YXIgbGVmdCA9IGNvb3Jkcy5sZWZ0LCB0b3AgPSBjb29yZHMudG9wO1xuICAgIC8vIEZpcnN0IG1vdmUgaW50byBcInBhZ2VcIiBjb29yZGluYXRlIHN5c3RlbVxuICAgIGlmIChjb250ZXh0ID09IFwicGFnZVwiKSB7XG4gICAgICBsZWZ0IC09IHBhZ2VTY3JvbGxYKCk7XG4gICAgICB0b3AgLT0gcGFnZVNjcm9sbFkoKTtcbiAgICB9IGVsc2UgaWYgKGNvbnRleHQgPT0gXCJsb2NhbFwiIHx8ICFjb250ZXh0KSB7XG4gICAgICB2YXIgbG9jYWxCb3ggPSBjbS5kaXNwbGF5LnNpemVyLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgICAgbGVmdCArPSBsb2NhbEJveC5sZWZ0O1xuICAgICAgdG9wICs9IGxvY2FsQm94LnRvcDtcbiAgICB9XG5cbiAgICB2YXIgbGluZVNwYWNlQm94ID0gY20uZGlzcGxheS5saW5lU3BhY2UuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgcmV0dXJuIHtsZWZ0OiBsZWZ0IC0gbGluZVNwYWNlQm94LmxlZnQsIHRvcDogdG9wIC0gbGluZVNwYWNlQm94LnRvcH07XG4gIH1cblxuICBmdW5jdGlvbiBjaGFyQ29vcmRzKGNtLCBwb3MsIGNvbnRleHQsIGxpbmVPYmosIGJpYXMpIHtcbiAgICBpZiAoIWxpbmVPYmopIGxpbmVPYmogPSBnZXRMaW5lKGNtLmRvYywgcG9zLmxpbmUpO1xuICAgIHJldHVybiBpbnRvQ29vcmRTeXN0ZW0oY20sIGxpbmVPYmosIG1lYXN1cmVDaGFyKGNtLCBsaW5lT2JqLCBwb3MuY2gsIGJpYXMpLCBjb250ZXh0KTtcbiAgfVxuXG4gIC8vIFJldHVybnMgYSBib3ggZm9yIGEgZ2l2ZW4gY3Vyc29yIHBvc2l0aW9uLCB3aGljaCBtYXkgaGF2ZSBhblxuICAvLyAnb3RoZXInIHByb3BlcnR5IGNvbnRhaW5pbmcgdGhlIHBvc2l0aW9uIG9mIHRoZSBzZWNvbmRhcnkgY3Vyc29yXG4gIC8vIG9uIGEgYmlkaSBib3VuZGFyeS5cbiAgZnVuY3Rpb24gY3Vyc29yQ29vcmRzKGNtLCBwb3MsIGNvbnRleHQsIGxpbmVPYmosIHByZXBhcmVkTWVhc3VyZSwgdmFySGVpZ2h0KSB7XG4gICAgbGluZU9iaiA9IGxpbmVPYmogfHwgZ2V0TGluZShjbS5kb2MsIHBvcy5saW5lKTtcbiAgICBpZiAoIXByZXBhcmVkTWVhc3VyZSkgcHJlcGFyZWRNZWFzdXJlID0gcHJlcGFyZU1lYXN1cmVGb3JMaW5lKGNtLCBsaW5lT2JqKTtcbiAgICBmdW5jdGlvbiBnZXQoY2gsIHJpZ2h0KSB7XG4gICAgICB2YXIgbSA9IG1lYXN1cmVDaGFyUHJlcGFyZWQoY20sIHByZXBhcmVkTWVhc3VyZSwgY2gsIHJpZ2h0ID8gXCJyaWdodFwiIDogXCJsZWZ0XCIsIHZhckhlaWdodCk7XG4gICAgICBpZiAocmlnaHQpIG0ubGVmdCA9IG0ucmlnaHQ7IGVsc2UgbS5yaWdodCA9IG0ubGVmdDtcbiAgICAgIHJldHVybiBpbnRvQ29vcmRTeXN0ZW0oY20sIGxpbmVPYmosIG0sIGNvbnRleHQpO1xuICAgIH1cbiAgICBmdW5jdGlvbiBnZXRCaWRpKGNoLCBwYXJ0UG9zKSB7XG4gICAgICB2YXIgcGFydCA9IG9yZGVyW3BhcnRQb3NdLCByaWdodCA9IHBhcnQubGV2ZWwgJSAyO1xuICAgICAgaWYgKGNoID09IGJpZGlMZWZ0KHBhcnQpICYmIHBhcnRQb3MgJiYgcGFydC5sZXZlbCA8IG9yZGVyW3BhcnRQb3MgLSAxXS5sZXZlbCkge1xuICAgICAgICBwYXJ0ID0gb3JkZXJbLS1wYXJ0UG9zXTtcbiAgICAgICAgY2ggPSBiaWRpUmlnaHQocGFydCkgLSAocGFydC5sZXZlbCAlIDIgPyAwIDogMSk7XG4gICAgICAgIHJpZ2h0ID0gdHJ1ZTtcbiAgICAgIH0gZWxzZSBpZiAoY2ggPT0gYmlkaVJpZ2h0KHBhcnQpICYmIHBhcnRQb3MgPCBvcmRlci5sZW5ndGggLSAxICYmIHBhcnQubGV2ZWwgPCBvcmRlcltwYXJ0UG9zICsgMV0ubGV2ZWwpIHtcbiAgICAgICAgcGFydCA9IG9yZGVyWysrcGFydFBvc107XG4gICAgICAgIGNoID0gYmlkaUxlZnQocGFydCkgLSBwYXJ0LmxldmVsICUgMjtcbiAgICAgICAgcmlnaHQgPSBmYWxzZTtcbiAgICAgIH1cbiAgICAgIGlmIChyaWdodCAmJiBjaCA9PSBwYXJ0LnRvICYmIGNoID4gcGFydC5mcm9tKSByZXR1cm4gZ2V0KGNoIC0gMSk7XG4gICAgICByZXR1cm4gZ2V0KGNoLCByaWdodCk7XG4gICAgfVxuICAgIHZhciBvcmRlciA9IGdldE9yZGVyKGxpbmVPYmopLCBjaCA9IHBvcy5jaDtcbiAgICBpZiAoIW9yZGVyKSByZXR1cm4gZ2V0KGNoKTtcbiAgICB2YXIgcGFydFBvcyA9IGdldEJpZGlQYXJ0QXQob3JkZXIsIGNoKTtcbiAgICB2YXIgdmFsID0gZ2V0QmlkaShjaCwgcGFydFBvcyk7XG4gICAgaWYgKGJpZGlPdGhlciAhPSBudWxsKSB2YWwub3RoZXIgPSBnZXRCaWRpKGNoLCBiaWRpT3RoZXIpO1xuICAgIHJldHVybiB2YWw7XG4gIH1cblxuICAvLyBVc2VkIHRvIGNoZWFwbHkgZXN0aW1hdGUgdGhlIGNvb3JkaW5hdGVzIGZvciBhIHBvc2l0aW9uLiBVc2VkIGZvclxuICAvLyBpbnRlcm1lZGlhdGUgc2Nyb2xsIHVwZGF0ZXMuXG4gIGZ1bmN0aW9uIGVzdGltYXRlQ29vcmRzKGNtLCBwb3MpIHtcbiAgICB2YXIgbGVmdCA9IDAsIHBvcyA9IGNsaXBQb3MoY20uZG9jLCBwb3MpO1xuICAgIGlmICghY20ub3B0aW9ucy5saW5lV3JhcHBpbmcpIGxlZnQgPSBjaGFyV2lkdGgoY20uZGlzcGxheSkgKiBwb3MuY2g7XG4gICAgdmFyIGxpbmVPYmogPSBnZXRMaW5lKGNtLmRvYywgcG9zLmxpbmUpO1xuICAgIHZhciB0b3AgPSBoZWlnaHRBdExpbmUobGluZU9iaikgKyBwYWRkaW5nVG9wKGNtLmRpc3BsYXkpO1xuICAgIHJldHVybiB7bGVmdDogbGVmdCwgcmlnaHQ6IGxlZnQsIHRvcDogdG9wLCBib3R0b206IHRvcCArIGxpbmVPYmouaGVpZ2h0fTtcbiAgfVxuXG4gIC8vIFBvc2l0aW9ucyByZXR1cm5lZCBieSBjb29yZHNDaGFyIGNvbnRhaW4gc29tZSBleHRyYSBpbmZvcm1hdGlvbi5cbiAgLy8geFJlbCBpcyB0aGUgcmVsYXRpdmUgeCBwb3NpdGlvbiBvZiB0aGUgaW5wdXQgY29vcmRpbmF0ZXMgY29tcGFyZWRcbiAgLy8gdG8gdGhlIGZvdW5kIHBvc2l0aW9uIChzbyB4UmVsID4gMCBtZWFucyB0aGUgY29vcmRpbmF0ZXMgYXJlIHRvXG4gIC8vIHRoZSByaWdodCBvZiB0aGUgY2hhcmFjdGVyIHBvc2l0aW9uLCBmb3IgZXhhbXBsZSkuIFdoZW4gb3V0c2lkZVxuICAvLyBpcyB0cnVlLCB0aGF0IG1lYW5zIHRoZSBjb29yZGluYXRlcyBsaWUgb3V0c2lkZSB0aGUgbGluZSdzXG4gIC8vIHZlcnRpY2FsIHJhbmdlLlxuICBmdW5jdGlvbiBQb3NXaXRoSW5mbyhsaW5lLCBjaCwgb3V0c2lkZSwgeFJlbCkge1xuICAgIHZhciBwb3MgPSBQb3MobGluZSwgY2gpO1xuICAgIHBvcy54UmVsID0geFJlbDtcbiAgICBpZiAob3V0c2lkZSkgcG9zLm91dHNpZGUgPSB0cnVlO1xuICAgIHJldHVybiBwb3M7XG4gIH1cblxuICAvLyBDb21wdXRlIHRoZSBjaGFyYWN0ZXIgcG9zaXRpb24gY2xvc2VzdCB0byB0aGUgZ2l2ZW4gY29vcmRpbmF0ZXMuXG4gIC8vIElucHV0IG11c3QgYmUgbGluZVNwYWNlLWxvY2FsIChcImRpdlwiIGNvb3JkaW5hdGUgc3lzdGVtKS5cbiAgZnVuY3Rpb24gY29vcmRzQ2hhcihjbSwgeCwgeSkge1xuICAgIHZhciBkb2MgPSBjbS5kb2M7XG4gICAgeSArPSBjbS5kaXNwbGF5LnZpZXdPZmZzZXQ7XG4gICAgaWYgKHkgPCAwKSByZXR1cm4gUG9zV2l0aEluZm8oZG9jLmZpcnN0LCAwLCB0cnVlLCAtMSk7XG4gICAgdmFyIGxpbmVOID0gbGluZUF0SGVpZ2h0KGRvYywgeSksIGxhc3QgPSBkb2MuZmlyc3QgKyBkb2Muc2l6ZSAtIDE7XG4gICAgaWYgKGxpbmVOID4gbGFzdClcbiAgICAgIHJldHVybiBQb3NXaXRoSW5mbyhkb2MuZmlyc3QgKyBkb2Muc2l6ZSAtIDEsIGdldExpbmUoZG9jLCBsYXN0KS50ZXh0Lmxlbmd0aCwgdHJ1ZSwgMSk7XG4gICAgaWYgKHggPCAwKSB4ID0gMDtcblxuICAgIHZhciBsaW5lT2JqID0gZ2V0TGluZShkb2MsIGxpbmVOKTtcbiAgICBmb3IgKDs7KSB7XG4gICAgICB2YXIgZm91bmQgPSBjb29yZHNDaGFySW5uZXIoY20sIGxpbmVPYmosIGxpbmVOLCB4LCB5KTtcbiAgICAgIHZhciBtZXJnZWQgPSBjb2xsYXBzZWRTcGFuQXRFbmQobGluZU9iaik7XG4gICAgICB2YXIgbWVyZ2VkUG9zID0gbWVyZ2VkICYmIG1lcmdlZC5maW5kKDAsIHRydWUpO1xuICAgICAgaWYgKG1lcmdlZCAmJiAoZm91bmQuY2ggPiBtZXJnZWRQb3MuZnJvbS5jaCB8fCBmb3VuZC5jaCA9PSBtZXJnZWRQb3MuZnJvbS5jaCAmJiBmb3VuZC54UmVsID4gMCkpXG4gICAgICAgIGxpbmVOID0gbGluZU5vKGxpbmVPYmogPSBtZXJnZWRQb3MudG8ubGluZSk7XG4gICAgICBlbHNlXG4gICAgICAgIHJldHVybiBmb3VuZDtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBjb29yZHNDaGFySW5uZXIoY20sIGxpbmVPYmosIGxpbmVObywgeCwgeSkge1xuICAgIHZhciBpbm5lck9mZiA9IHkgLSBoZWlnaHRBdExpbmUobGluZU9iaik7XG4gICAgdmFyIHdyb25nTGluZSA9IGZhbHNlLCBhZGp1c3QgPSAyICogY20uZGlzcGxheS53cmFwcGVyLmNsaWVudFdpZHRoO1xuICAgIHZhciBwcmVwYXJlZE1lYXN1cmUgPSBwcmVwYXJlTWVhc3VyZUZvckxpbmUoY20sIGxpbmVPYmopO1xuXG4gICAgZnVuY3Rpb24gZ2V0WChjaCkge1xuICAgICAgdmFyIHNwID0gY3Vyc29yQ29vcmRzKGNtLCBQb3MobGluZU5vLCBjaCksIFwibGluZVwiLCBsaW5lT2JqLCBwcmVwYXJlZE1lYXN1cmUpO1xuICAgICAgd3JvbmdMaW5lID0gdHJ1ZTtcbiAgICAgIGlmIChpbm5lck9mZiA+IHNwLmJvdHRvbSkgcmV0dXJuIHNwLmxlZnQgLSBhZGp1c3Q7XG4gICAgICBlbHNlIGlmIChpbm5lck9mZiA8IHNwLnRvcCkgcmV0dXJuIHNwLmxlZnQgKyBhZGp1c3Q7XG4gICAgICBlbHNlIHdyb25nTGluZSA9IGZhbHNlO1xuICAgICAgcmV0dXJuIHNwLmxlZnQ7XG4gICAgfVxuXG4gICAgdmFyIGJpZGkgPSBnZXRPcmRlcihsaW5lT2JqKSwgZGlzdCA9IGxpbmVPYmoudGV4dC5sZW5ndGg7XG4gICAgdmFyIGZyb20gPSBsaW5lTGVmdChsaW5lT2JqKSwgdG8gPSBsaW5lUmlnaHQobGluZU9iaik7XG4gICAgdmFyIGZyb21YID0gZ2V0WChmcm9tKSwgZnJvbU91dHNpZGUgPSB3cm9uZ0xpbmUsIHRvWCA9IGdldFgodG8pLCB0b091dHNpZGUgPSB3cm9uZ0xpbmU7XG5cbiAgICBpZiAoeCA+IHRvWCkgcmV0dXJuIFBvc1dpdGhJbmZvKGxpbmVObywgdG8sIHRvT3V0c2lkZSwgMSk7XG4gICAgLy8gRG8gYSBiaW5hcnkgc2VhcmNoIGJldHdlZW4gdGhlc2UgYm91bmRzLlxuICAgIGZvciAoOzspIHtcbiAgICAgIGlmIChiaWRpID8gdG8gPT0gZnJvbSB8fCB0byA9PSBtb3ZlVmlzdWFsbHkobGluZU9iaiwgZnJvbSwgMSkgOiB0byAtIGZyb20gPD0gMSkge1xuICAgICAgICB2YXIgY2ggPSB4IDwgZnJvbVggfHwgeCAtIGZyb21YIDw9IHRvWCAtIHggPyBmcm9tIDogdG87XG4gICAgICAgIHZhciB4RGlmZiA9IHggLSAoY2ggPT0gZnJvbSA/IGZyb21YIDogdG9YKTtcbiAgICAgICAgd2hpbGUgKGlzRXh0ZW5kaW5nQ2hhcihsaW5lT2JqLnRleHQuY2hhckF0KGNoKSkpICsrY2g7XG4gICAgICAgIHZhciBwb3MgPSBQb3NXaXRoSW5mbyhsaW5lTm8sIGNoLCBjaCA9PSBmcm9tID8gZnJvbU91dHNpZGUgOiB0b091dHNpZGUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICB4RGlmZiA8IC0xID8gLTEgOiB4RGlmZiA+IDEgPyAxIDogMCk7XG4gICAgICAgIHJldHVybiBwb3M7XG4gICAgICB9XG4gICAgICB2YXIgc3RlcCA9IE1hdGguY2VpbChkaXN0IC8gMiksIG1pZGRsZSA9IGZyb20gKyBzdGVwO1xuICAgICAgaWYgKGJpZGkpIHtcbiAgICAgICAgbWlkZGxlID0gZnJvbTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdGVwOyArK2kpIG1pZGRsZSA9IG1vdmVWaXN1YWxseShsaW5lT2JqLCBtaWRkbGUsIDEpO1xuICAgICAgfVxuICAgICAgdmFyIG1pZGRsZVggPSBnZXRYKG1pZGRsZSk7XG4gICAgICBpZiAobWlkZGxlWCA+IHgpIHt0byA9IG1pZGRsZTsgdG9YID0gbWlkZGxlWDsgaWYgKHRvT3V0c2lkZSA9IHdyb25nTGluZSkgdG9YICs9IDEwMDA7IGRpc3QgPSBzdGVwO31cbiAgICAgIGVsc2Uge2Zyb20gPSBtaWRkbGU7IGZyb21YID0gbWlkZGxlWDsgZnJvbU91dHNpZGUgPSB3cm9uZ0xpbmU7IGRpc3QgLT0gc3RlcDt9XG4gICAgfVxuICB9XG5cbiAgdmFyIG1lYXN1cmVUZXh0O1xuICAvLyBDb21wdXRlIHRoZSBkZWZhdWx0IHRleHQgaGVpZ2h0LlxuICBmdW5jdGlvbiB0ZXh0SGVpZ2h0KGRpc3BsYXkpIHtcbiAgICBpZiAoZGlzcGxheS5jYWNoZWRUZXh0SGVpZ2h0ICE9IG51bGwpIHJldHVybiBkaXNwbGF5LmNhY2hlZFRleHRIZWlnaHQ7XG4gICAgaWYgKG1lYXN1cmVUZXh0ID09IG51bGwpIHtcbiAgICAgIG1lYXN1cmVUZXh0ID0gZWx0KFwicHJlXCIpO1xuICAgICAgLy8gTWVhc3VyZSBhIGJ1bmNoIG9mIGxpbmVzLCBmb3IgYnJvd3NlcnMgdGhhdCBjb21wdXRlXG4gICAgICAvLyBmcmFjdGlvbmFsIGhlaWdodHMuXG4gICAgICBmb3IgKHZhciBpID0gMDsgaSA8IDQ5OyArK2kpIHtcbiAgICAgICAgbWVhc3VyZVRleHQuYXBwZW5kQ2hpbGQoZG9jdW1lbnQuY3JlYXRlVGV4dE5vZGUoXCJ4XCIpKTtcbiAgICAgICAgbWVhc3VyZVRleHQuYXBwZW5kQ2hpbGQoZWx0KFwiYnJcIikpO1xuICAgICAgfVxuICAgICAgbWVhc3VyZVRleHQuYXBwZW5kQ2hpbGQoZG9jdW1lbnQuY3JlYXRlVGV4dE5vZGUoXCJ4XCIpKTtcbiAgICB9XG4gICAgcmVtb3ZlQ2hpbGRyZW5BbmRBZGQoZGlzcGxheS5tZWFzdXJlLCBtZWFzdXJlVGV4dCk7XG4gICAgdmFyIGhlaWdodCA9IG1lYXN1cmVUZXh0Lm9mZnNldEhlaWdodCAvIDUwO1xuICAgIGlmIChoZWlnaHQgPiAzKSBkaXNwbGF5LmNhY2hlZFRleHRIZWlnaHQgPSBoZWlnaHQ7XG4gICAgcmVtb3ZlQ2hpbGRyZW4oZGlzcGxheS5tZWFzdXJlKTtcbiAgICByZXR1cm4gaGVpZ2h0IHx8IDE7XG4gIH1cblxuICAvLyBDb21wdXRlIHRoZSBkZWZhdWx0IGNoYXJhY3RlciB3aWR0aC5cbiAgZnVuY3Rpb24gY2hhcldpZHRoKGRpc3BsYXkpIHtcbiAgICBpZiAoZGlzcGxheS5jYWNoZWRDaGFyV2lkdGggIT0gbnVsbCkgcmV0dXJuIGRpc3BsYXkuY2FjaGVkQ2hhcldpZHRoO1xuICAgIHZhciBhbmNob3IgPSBlbHQoXCJzcGFuXCIsIFwieHh4eHh4eHh4eFwiKTtcbiAgICB2YXIgcHJlID0gZWx0KFwicHJlXCIsIFthbmNob3JdKTtcbiAgICByZW1vdmVDaGlsZHJlbkFuZEFkZChkaXNwbGF5Lm1lYXN1cmUsIHByZSk7XG4gICAgdmFyIHJlY3QgPSBhbmNob3IuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCksIHdpZHRoID0gKHJlY3QucmlnaHQgLSByZWN0LmxlZnQpIC8gMTA7XG4gICAgaWYgKHdpZHRoID4gMikgZGlzcGxheS5jYWNoZWRDaGFyV2lkdGggPSB3aWR0aDtcbiAgICByZXR1cm4gd2lkdGggfHwgMTA7XG4gIH1cblxuICAvLyBPUEVSQVRJT05TXG5cbiAgLy8gT3BlcmF0aW9ucyBhcmUgdXNlZCB0byB3cmFwIGEgc2VyaWVzIG9mIGNoYW5nZXMgdG8gdGhlIGVkaXRvclxuICAvLyBzdGF0ZSBpbiBzdWNoIGEgd2F5IHRoYXQgZWFjaCBjaGFuZ2Ugd29uJ3QgaGF2ZSB0byB1cGRhdGUgdGhlXG4gIC8vIGN1cnNvciBhbmQgZGlzcGxheSAod2hpY2ggd291bGQgYmUgYXdrd2FyZCwgc2xvdywgYW5kXG4gIC8vIGVycm9yLXByb25lKS4gSW5zdGVhZCwgZGlzcGxheSB1cGRhdGVzIGFyZSBiYXRjaGVkIGFuZCB0aGVuIGFsbFxuICAvLyBjb21iaW5lZCBhbmQgZXhlY3V0ZWQgYXQgb25jZS5cblxuICB2YXIgb3BlcmF0aW9uR3JvdXAgPSBudWxsO1xuXG4gIHZhciBuZXh0T3BJZCA9IDA7XG4gIC8vIFN0YXJ0IGEgbmV3IG9wZXJhdGlvbi5cbiAgZnVuY3Rpb24gc3RhcnRPcGVyYXRpb24oY20pIHtcbiAgICBjbS5jdXJPcCA9IHtcbiAgICAgIGNtOiBjbSxcbiAgICAgIHZpZXdDaGFuZ2VkOiBmYWxzZSwgICAgICAvLyBGbGFnIHRoYXQgaW5kaWNhdGVzIHRoYXQgbGluZXMgbWlnaHQgbmVlZCB0byBiZSByZWRyYXduXG4gICAgICBzdGFydEhlaWdodDogY20uZG9jLmhlaWdodCwgLy8gVXNlZCB0byBkZXRlY3QgbmVlZCB0byB1cGRhdGUgc2Nyb2xsYmFyXG4gICAgICBmb3JjZVVwZGF0ZTogZmFsc2UsICAgICAgLy8gVXNlZCB0byBmb3JjZSBhIHJlZHJhd1xuICAgICAgdXBkYXRlSW5wdXQ6IG51bGwsICAgICAgIC8vIFdoZXRoZXIgdG8gcmVzZXQgdGhlIGlucHV0IHRleHRhcmVhXG4gICAgICB0eXBpbmc6IGZhbHNlLCAgICAgICAgICAgLy8gV2hldGhlciB0aGlzIHJlc2V0IHNob3VsZCBiZSBjYXJlZnVsIHRvIGxlYXZlIGV4aXN0aW5nIHRleHQgKGZvciBjb21wb3NpdGluZylcbiAgICAgIGNoYW5nZU9ianM6IG51bGwsICAgICAgICAvLyBBY2N1bXVsYXRlZCBjaGFuZ2VzLCBmb3IgZmlyaW5nIGNoYW5nZSBldmVudHNcbiAgICAgIGN1cnNvckFjdGl2aXR5SGFuZGxlcnM6IG51bGwsIC8vIFNldCBvZiBoYW5kbGVycyB0byBmaXJlIGN1cnNvckFjdGl2aXR5IG9uXG4gICAgICBjdXJzb3JBY3Rpdml0eUNhbGxlZDogMCwgLy8gVHJhY2tzIHdoaWNoIGN1cnNvckFjdGl2aXR5IGhhbmRsZXJzIGhhdmUgYmVlbiBjYWxsZWQgYWxyZWFkeVxuICAgICAgc2VsZWN0aW9uQ2hhbmdlZDogZmFsc2UsIC8vIFdoZXRoZXIgdGhlIHNlbGVjdGlvbiBuZWVkcyB0byBiZSByZWRyYXduXG4gICAgICB1cGRhdGVNYXhMaW5lOiBmYWxzZSwgICAgLy8gU2V0IHdoZW4gdGhlIHdpZGVzdCBsaW5lIG5lZWRzIHRvIGJlIGRldGVybWluZWQgYW5ld1xuICAgICAgc2Nyb2xsTGVmdDogbnVsbCwgc2Nyb2xsVG9wOiBudWxsLCAvLyBJbnRlcm1lZGlhdGUgc2Nyb2xsIHBvc2l0aW9uLCBub3QgcHVzaGVkIHRvIERPTSB5ZXRcbiAgICAgIHNjcm9sbFRvUG9zOiBudWxsLCAgICAgICAvLyBVc2VkIHRvIHNjcm9sbCB0byBhIHNwZWNpZmljIHBvc2l0aW9uXG4gICAgICBmb2N1czogZmFsc2UsXG4gICAgICBpZDogKytuZXh0T3BJZCAgICAgICAgICAgLy8gVW5pcXVlIElEXG4gICAgfTtcbiAgICBpZiAob3BlcmF0aW9uR3JvdXApIHtcbiAgICAgIG9wZXJhdGlvbkdyb3VwLm9wcy5wdXNoKGNtLmN1ck9wKTtcbiAgICB9IGVsc2Uge1xuICAgICAgY20uY3VyT3Aub3duc0dyb3VwID0gb3BlcmF0aW9uR3JvdXAgPSB7XG4gICAgICAgIG9wczogW2NtLmN1ck9wXSxcbiAgICAgICAgZGVsYXllZENhbGxiYWNrczogW11cbiAgICAgIH07XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gZmlyZUNhbGxiYWNrc0Zvck9wcyhncm91cCkge1xuICAgIC8vIENhbGxzIGRlbGF5ZWQgY2FsbGJhY2tzIGFuZCBjdXJzb3JBY3Rpdml0eSBoYW5kbGVycyB1bnRpbCBub1xuICAgIC8vIG5ldyBvbmVzIGFwcGVhclxuICAgIHZhciBjYWxsYmFja3MgPSBncm91cC5kZWxheWVkQ2FsbGJhY2tzLCBpID0gMDtcbiAgICBkbyB7XG4gICAgICBmb3IgKDsgaSA8IGNhbGxiYWNrcy5sZW5ndGg7IGkrKylcbiAgICAgICAgY2FsbGJhY2tzW2ldKCk7XG4gICAgICBmb3IgKHZhciBqID0gMDsgaiA8IGdyb3VwLm9wcy5sZW5ndGg7IGorKykge1xuICAgICAgICB2YXIgb3AgPSBncm91cC5vcHNbal07XG4gICAgICAgIGlmIChvcC5jdXJzb3JBY3Rpdml0eUhhbmRsZXJzKVxuICAgICAgICAgIHdoaWxlIChvcC5jdXJzb3JBY3Rpdml0eUNhbGxlZCA8IG9wLmN1cnNvckFjdGl2aXR5SGFuZGxlcnMubGVuZ3RoKVxuICAgICAgICAgICAgb3AuY3Vyc29yQWN0aXZpdHlIYW5kbGVyc1tvcC5jdXJzb3JBY3Rpdml0eUNhbGxlZCsrXShvcC5jbSk7XG4gICAgICB9XG4gICAgfSB3aGlsZSAoaSA8IGNhbGxiYWNrcy5sZW5ndGgpO1xuICB9XG5cbiAgLy8gRmluaXNoIGFuIG9wZXJhdGlvbiwgdXBkYXRpbmcgdGhlIGRpc3BsYXkgYW5kIHNpZ25hbGxpbmcgZGVsYXllZCBldmVudHNcbiAgZnVuY3Rpb24gZW5kT3BlcmF0aW9uKGNtKSB7XG4gICAgdmFyIG9wID0gY20uY3VyT3AsIGdyb3VwID0gb3Aub3duc0dyb3VwO1xuICAgIGlmICghZ3JvdXApIHJldHVybjtcblxuICAgIHRyeSB7IGZpcmVDYWxsYmFja3NGb3JPcHMoZ3JvdXApOyB9XG4gICAgZmluYWxseSB7XG4gICAgICBvcGVyYXRpb25Hcm91cCA9IG51bGw7XG4gICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGdyb3VwLm9wcy5sZW5ndGg7IGkrKylcbiAgICAgICAgZ3JvdXAub3BzW2ldLmNtLmN1ck9wID0gbnVsbDtcbiAgICAgIGVuZE9wZXJhdGlvbnMoZ3JvdXApO1xuICAgIH1cbiAgfVxuXG4gIC8vIFRoZSBET00gdXBkYXRlcyBkb25lIHdoZW4gYW4gb3BlcmF0aW9uIGZpbmlzaGVzIGFyZSBiYXRjaGVkIHNvXG4gIC8vIHRoYXQgdGhlIG1pbmltdW0gbnVtYmVyIG9mIHJlbGF5b3V0cyBhcmUgcmVxdWlyZWQuXG4gIGZ1bmN0aW9uIGVuZE9wZXJhdGlvbnMoZ3JvdXApIHtcbiAgICB2YXIgb3BzID0gZ3JvdXAub3BzO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgb3BzLmxlbmd0aDsgaSsrKSAvLyBSZWFkIERPTVxuICAgICAgZW5kT3BlcmF0aW9uX1IxKG9wc1tpXSk7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBvcHMubGVuZ3RoOyBpKyspIC8vIFdyaXRlIERPTSAobWF5YmUpXG4gICAgICBlbmRPcGVyYXRpb25fVzEob3BzW2ldKTtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IG9wcy5sZW5ndGg7IGkrKykgLy8gUmVhZCBET01cbiAgICAgIGVuZE9wZXJhdGlvbl9SMihvcHNbaV0pO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgb3BzLmxlbmd0aDsgaSsrKSAvLyBXcml0ZSBET00gKG1heWJlKVxuICAgICAgZW5kT3BlcmF0aW9uX1cyKG9wc1tpXSk7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBvcHMubGVuZ3RoOyBpKyspIC8vIFJlYWQgRE9NXG4gICAgICBlbmRPcGVyYXRpb25fZmluaXNoKG9wc1tpXSk7XG4gIH1cblxuICBmdW5jdGlvbiBlbmRPcGVyYXRpb25fUjEob3ApIHtcbiAgICB2YXIgY20gPSBvcC5jbSwgZGlzcGxheSA9IGNtLmRpc3BsYXk7XG4gICAgbWF5YmVDbGlwU2Nyb2xsYmFycyhjbSk7XG4gICAgaWYgKG9wLnVwZGF0ZU1heExpbmUpIGZpbmRNYXhMaW5lKGNtKTtcblxuICAgIG9wLm11c3RVcGRhdGUgPSBvcC52aWV3Q2hhbmdlZCB8fCBvcC5mb3JjZVVwZGF0ZSB8fCBvcC5zY3JvbGxUb3AgIT0gbnVsbCB8fFxuICAgICAgb3Auc2Nyb2xsVG9Qb3MgJiYgKG9wLnNjcm9sbFRvUG9zLmZyb20ubGluZSA8IGRpc3BsYXkudmlld0Zyb20gfHxcbiAgICAgICAgICAgICAgICAgICAgICAgICBvcC5zY3JvbGxUb1Bvcy50by5saW5lID49IGRpc3BsYXkudmlld1RvKSB8fFxuICAgICAgZGlzcGxheS5tYXhMaW5lQ2hhbmdlZCAmJiBjbS5vcHRpb25zLmxpbmVXcmFwcGluZztcbiAgICBvcC51cGRhdGUgPSBvcC5tdXN0VXBkYXRlICYmXG4gICAgICBuZXcgRGlzcGxheVVwZGF0ZShjbSwgb3AubXVzdFVwZGF0ZSAmJiB7dG9wOiBvcC5zY3JvbGxUb3AsIGVuc3VyZTogb3Auc2Nyb2xsVG9Qb3N9LCBvcC5mb3JjZVVwZGF0ZSk7XG4gIH1cblxuICBmdW5jdGlvbiBlbmRPcGVyYXRpb25fVzEob3ApIHtcbiAgICBvcC51cGRhdGVkRGlzcGxheSA9IG9wLm11c3RVcGRhdGUgJiYgdXBkYXRlRGlzcGxheUlmTmVlZGVkKG9wLmNtLCBvcC51cGRhdGUpO1xuICB9XG5cbiAgZnVuY3Rpb24gZW5kT3BlcmF0aW9uX1IyKG9wKSB7XG4gICAgdmFyIGNtID0gb3AuY20sIGRpc3BsYXkgPSBjbS5kaXNwbGF5O1xuICAgIGlmIChvcC51cGRhdGVkRGlzcGxheSkgdXBkYXRlSGVpZ2h0c0luVmlld3BvcnQoY20pO1xuXG4gICAgb3AuYmFyTWVhc3VyZSA9IG1lYXN1cmVGb3JTY3JvbGxiYXJzKGNtKTtcblxuICAgIC8vIElmIHRoZSBtYXggbGluZSBjaGFuZ2VkIHNpbmNlIGl0IHdhcyBsYXN0IG1lYXN1cmVkLCBtZWFzdXJlIGl0LFxuICAgIC8vIGFuZCBlbnN1cmUgdGhlIGRvY3VtZW50J3Mgd2lkdGggbWF0Y2hlcyBpdC5cbiAgICAvLyB1cGRhdGVEaXNwbGF5X1cyIHdpbGwgdXNlIHRoZXNlIHByb3BlcnRpZXMgdG8gZG8gdGhlIGFjdHVhbCByZXNpemluZ1xuICAgIGlmIChkaXNwbGF5Lm1heExpbmVDaGFuZ2VkICYmICFjbS5vcHRpb25zLmxpbmVXcmFwcGluZykge1xuICAgICAgb3AuYWRqdXN0V2lkdGhUbyA9IG1lYXN1cmVDaGFyKGNtLCBkaXNwbGF5Lm1heExpbmUsIGRpc3BsYXkubWF4TGluZS50ZXh0Lmxlbmd0aCkubGVmdCArIDM7XG4gICAgICBjbS5kaXNwbGF5LnNpemVyV2lkdGggPSBvcC5hZGp1c3RXaWR0aFRvO1xuICAgICAgb3AuYmFyTWVhc3VyZS5zY3JvbGxXaWR0aCA9XG4gICAgICAgIE1hdGgubWF4KGRpc3BsYXkuc2Nyb2xsZXIuY2xpZW50V2lkdGgsIGRpc3BsYXkuc2l6ZXIub2Zmc2V0TGVmdCArIG9wLmFkanVzdFdpZHRoVG8gKyBzY3JvbGxHYXAoY20pICsgY20uZGlzcGxheS5iYXJXaWR0aCk7XG4gICAgICBvcC5tYXhTY3JvbGxMZWZ0ID0gTWF0aC5tYXgoMCwgZGlzcGxheS5zaXplci5vZmZzZXRMZWZ0ICsgb3AuYWRqdXN0V2lkdGhUbyAtIGRpc3BsYXlXaWR0aChjbSkpO1xuICAgIH1cblxuICAgIGlmIChvcC51cGRhdGVkRGlzcGxheSB8fCBvcC5zZWxlY3Rpb25DaGFuZ2VkKVxuICAgICAgb3AucHJlcGFyZWRTZWxlY3Rpb24gPSBkaXNwbGF5LmlucHV0LnByZXBhcmVTZWxlY3Rpb24oKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGVuZE9wZXJhdGlvbl9XMihvcCkge1xuICAgIHZhciBjbSA9IG9wLmNtO1xuXG4gICAgaWYgKG9wLmFkanVzdFdpZHRoVG8gIT0gbnVsbCkge1xuICAgICAgY20uZGlzcGxheS5zaXplci5zdHlsZS5taW5XaWR0aCA9IG9wLmFkanVzdFdpZHRoVG8gKyBcInB4XCI7XG4gICAgICBpZiAob3AubWF4U2Nyb2xsTGVmdCA8IGNtLmRvYy5zY3JvbGxMZWZ0KVxuICAgICAgICBzZXRTY3JvbGxMZWZ0KGNtLCBNYXRoLm1pbihjbS5kaXNwbGF5LnNjcm9sbGVyLnNjcm9sbExlZnQsIG9wLm1heFNjcm9sbExlZnQpLCB0cnVlKTtcbiAgICAgIGNtLmRpc3BsYXkubWF4TGluZUNoYW5nZWQgPSBmYWxzZTtcbiAgICB9XG5cbiAgICBpZiAob3AucHJlcGFyZWRTZWxlY3Rpb24pXG4gICAgICBjbS5kaXNwbGF5LmlucHV0LnNob3dTZWxlY3Rpb24ob3AucHJlcGFyZWRTZWxlY3Rpb24pO1xuICAgIGlmIChvcC51cGRhdGVkRGlzcGxheSlcbiAgICAgIHNldERvY3VtZW50SGVpZ2h0KGNtLCBvcC5iYXJNZWFzdXJlKTtcbiAgICBpZiAob3AudXBkYXRlZERpc3BsYXkgfHwgb3Auc3RhcnRIZWlnaHQgIT0gY20uZG9jLmhlaWdodClcbiAgICAgIHVwZGF0ZVNjcm9sbGJhcnMoY20sIG9wLmJhck1lYXN1cmUpO1xuXG4gICAgaWYgKG9wLnNlbGVjdGlvbkNoYW5nZWQpIHJlc3RhcnRCbGluayhjbSk7XG5cbiAgICBpZiAoY20uc3RhdGUuZm9jdXNlZCAmJiBvcC51cGRhdGVJbnB1dClcbiAgICAgIGNtLmRpc3BsYXkuaW5wdXQucmVzZXQob3AudHlwaW5nKTtcbiAgICBpZiAob3AuZm9jdXMgJiYgb3AuZm9jdXMgPT0gYWN0aXZlRWx0KCkpIGVuc3VyZUZvY3VzKG9wLmNtKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGVuZE9wZXJhdGlvbl9maW5pc2gob3ApIHtcbiAgICB2YXIgY20gPSBvcC5jbSwgZGlzcGxheSA9IGNtLmRpc3BsYXksIGRvYyA9IGNtLmRvYztcblxuICAgIGlmIChvcC51cGRhdGVkRGlzcGxheSkgcG9zdFVwZGF0ZURpc3BsYXkoY20sIG9wLnVwZGF0ZSk7XG5cbiAgICAvLyBBYm9ydCBtb3VzZSB3aGVlbCBkZWx0YSBtZWFzdXJlbWVudCwgd2hlbiBzY3JvbGxpbmcgZXhwbGljaXRseVxuICAgIGlmIChkaXNwbGF5LndoZWVsU3RhcnRYICE9IG51bGwgJiYgKG9wLnNjcm9sbFRvcCAhPSBudWxsIHx8IG9wLnNjcm9sbExlZnQgIT0gbnVsbCB8fCBvcC5zY3JvbGxUb1BvcykpXG4gICAgICBkaXNwbGF5LndoZWVsU3RhcnRYID0gZGlzcGxheS53aGVlbFN0YXJ0WSA9IG51bGw7XG5cbiAgICAvLyBQcm9wYWdhdGUgdGhlIHNjcm9sbCBwb3NpdGlvbiB0byB0aGUgYWN0dWFsIERPTSBzY3JvbGxlclxuICAgIGlmIChvcC5zY3JvbGxUb3AgIT0gbnVsbCAmJiAoZGlzcGxheS5zY3JvbGxlci5zY3JvbGxUb3AgIT0gb3Auc2Nyb2xsVG9wIHx8IG9wLmZvcmNlU2Nyb2xsKSkge1xuICAgICAgZG9jLnNjcm9sbFRvcCA9IE1hdGgubWF4KDAsIE1hdGgubWluKGRpc3BsYXkuc2Nyb2xsZXIuc2Nyb2xsSGVpZ2h0IC0gZGlzcGxheS5zY3JvbGxlci5jbGllbnRIZWlnaHQsIG9wLnNjcm9sbFRvcCkpO1xuICAgICAgZGlzcGxheS5zY3JvbGxiYXJzLnNldFNjcm9sbFRvcChkb2Muc2Nyb2xsVG9wKTtcbiAgICAgIGRpc3BsYXkuc2Nyb2xsZXIuc2Nyb2xsVG9wID0gZG9jLnNjcm9sbFRvcDtcbiAgICB9XG4gICAgaWYgKG9wLnNjcm9sbExlZnQgIT0gbnVsbCAmJiAoZGlzcGxheS5zY3JvbGxlci5zY3JvbGxMZWZ0ICE9IG9wLnNjcm9sbExlZnQgfHwgb3AuZm9yY2VTY3JvbGwpKSB7XG4gICAgICBkb2Muc2Nyb2xsTGVmdCA9IE1hdGgubWF4KDAsIE1hdGgubWluKGRpc3BsYXkuc2Nyb2xsZXIuc2Nyb2xsV2lkdGggLSBkaXNwbGF5V2lkdGgoY20pLCBvcC5zY3JvbGxMZWZ0KSk7XG4gICAgICBkaXNwbGF5LnNjcm9sbGJhcnMuc2V0U2Nyb2xsTGVmdChkb2Muc2Nyb2xsTGVmdCk7XG4gICAgICBkaXNwbGF5LnNjcm9sbGVyLnNjcm9sbExlZnQgPSBkb2Muc2Nyb2xsTGVmdDtcbiAgICAgIGFsaWduSG9yaXpvbnRhbGx5KGNtKTtcbiAgICB9XG4gICAgLy8gSWYgd2UgbmVlZCB0byBzY3JvbGwgYSBzcGVjaWZpYyBwb3NpdGlvbiBpbnRvIHZpZXcsIGRvIHNvLlxuICAgIGlmIChvcC5zY3JvbGxUb1Bvcykge1xuICAgICAgdmFyIGNvb3JkcyA9IHNjcm9sbFBvc0ludG9WaWV3KGNtLCBjbGlwUG9zKGRvYywgb3Auc2Nyb2xsVG9Qb3MuZnJvbSksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xpcFBvcyhkb2MsIG9wLnNjcm9sbFRvUG9zLnRvKSwgb3Auc2Nyb2xsVG9Qb3MubWFyZ2luKTtcbiAgICAgIGlmIChvcC5zY3JvbGxUb1Bvcy5pc0N1cnNvciAmJiBjbS5zdGF0ZS5mb2N1c2VkKSBtYXliZVNjcm9sbFdpbmRvdyhjbSwgY29vcmRzKTtcbiAgICB9XG5cbiAgICAvLyBGaXJlIGV2ZW50cyBmb3IgbWFya2VycyB0aGF0IGFyZSBoaWRkZW4vdW5pZGRlbiBieSBlZGl0aW5nIG9yXG4gICAgLy8gdW5kb2luZ1xuICAgIHZhciBoaWRkZW4gPSBvcC5tYXliZUhpZGRlbk1hcmtlcnMsIHVuaGlkZGVuID0gb3AubWF5YmVVbmhpZGRlbk1hcmtlcnM7XG4gICAgaWYgKGhpZGRlbikgZm9yICh2YXIgaSA9IDA7IGkgPCBoaWRkZW4ubGVuZ3RoOyArK2kpXG4gICAgICBpZiAoIWhpZGRlbltpXS5saW5lcy5sZW5ndGgpIHNpZ25hbChoaWRkZW5baV0sIFwiaGlkZVwiKTtcbiAgICBpZiAodW5oaWRkZW4pIGZvciAodmFyIGkgPSAwOyBpIDwgdW5oaWRkZW4ubGVuZ3RoOyArK2kpXG4gICAgICBpZiAodW5oaWRkZW5baV0ubGluZXMubGVuZ3RoKSBzaWduYWwodW5oaWRkZW5baV0sIFwidW5oaWRlXCIpO1xuXG4gICAgaWYgKGRpc3BsYXkud3JhcHBlci5vZmZzZXRIZWlnaHQpXG4gICAgICBkb2Muc2Nyb2xsVG9wID0gY20uZGlzcGxheS5zY3JvbGxlci5zY3JvbGxUb3A7XG5cbiAgICAvLyBGaXJlIGNoYW5nZSBldmVudHMsIGFuZCBkZWxheWVkIGV2ZW50IGhhbmRsZXJzXG4gICAgaWYgKG9wLmNoYW5nZU9ianMpXG4gICAgICBzaWduYWwoY20sIFwiY2hhbmdlc1wiLCBjbSwgb3AuY2hhbmdlT2Jqcyk7XG4gICAgaWYgKG9wLnVwZGF0ZSlcbiAgICAgIG9wLnVwZGF0ZS5maW5pc2goKTtcbiAgfVxuXG4gIC8vIFJ1biB0aGUgZ2l2ZW4gZnVuY3Rpb24gaW4gYW4gb3BlcmF0aW9uXG4gIGZ1bmN0aW9uIHJ1bkluT3AoY20sIGYpIHtcbiAgICBpZiAoY20uY3VyT3ApIHJldHVybiBmKCk7XG4gICAgc3RhcnRPcGVyYXRpb24oY20pO1xuICAgIHRyeSB7IHJldHVybiBmKCk7IH1cbiAgICBmaW5hbGx5IHsgZW5kT3BlcmF0aW9uKGNtKTsgfVxuICB9XG4gIC8vIFdyYXBzIGEgZnVuY3Rpb24gaW4gYW4gb3BlcmF0aW9uLiBSZXR1cm5zIHRoZSB3cmFwcGVkIGZ1bmN0aW9uLlxuICBmdW5jdGlvbiBvcGVyYXRpb24oY20sIGYpIHtcbiAgICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgICBpZiAoY20uY3VyT3ApIHJldHVybiBmLmFwcGx5KGNtLCBhcmd1bWVudHMpO1xuICAgICAgc3RhcnRPcGVyYXRpb24oY20pO1xuICAgICAgdHJ5IHsgcmV0dXJuIGYuYXBwbHkoY20sIGFyZ3VtZW50cyk7IH1cbiAgICAgIGZpbmFsbHkgeyBlbmRPcGVyYXRpb24oY20pOyB9XG4gICAgfTtcbiAgfVxuICAvLyBVc2VkIHRvIGFkZCBtZXRob2RzIHRvIGVkaXRvciBhbmQgZG9jIGluc3RhbmNlcywgd3JhcHBpbmcgdGhlbSBpblxuICAvLyBvcGVyYXRpb25zLlxuICBmdW5jdGlvbiBtZXRob2RPcChmKSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgICAgaWYgKHRoaXMuY3VyT3ApIHJldHVybiBmLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgICBzdGFydE9wZXJhdGlvbih0aGlzKTtcbiAgICAgIHRyeSB7IHJldHVybiBmLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH1cbiAgICAgIGZpbmFsbHkgeyBlbmRPcGVyYXRpb24odGhpcyk7IH1cbiAgICB9O1xuICB9XG4gIGZ1bmN0aW9uIGRvY01ldGhvZE9wKGYpIHtcbiAgICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgY20gPSB0aGlzLmNtO1xuICAgICAgaWYgKCFjbSB8fCBjbS5jdXJPcCkgcmV0dXJuIGYuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICAgIHN0YXJ0T3BlcmF0aW9uKGNtKTtcbiAgICAgIHRyeSB7IHJldHVybiBmLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH1cbiAgICAgIGZpbmFsbHkgeyBlbmRPcGVyYXRpb24oY20pOyB9XG4gICAgfTtcbiAgfVxuXG4gIC8vIFZJRVcgVFJBQ0tJTkdcblxuICAvLyBUaGVzZSBvYmplY3RzIGFyZSB1c2VkIHRvIHJlcHJlc2VudCB0aGUgdmlzaWJsZSAoY3VycmVudGx5IGRyYXduKVxuICAvLyBwYXJ0IG9mIHRoZSBkb2N1bWVudC4gQSBMaW5lVmlldyBtYXkgY29ycmVzcG9uZCB0byBtdWx0aXBsZVxuICAvLyBsb2dpY2FsIGxpbmVzLCBpZiB0aG9zZSBhcmUgY29ubmVjdGVkIGJ5IGNvbGxhcHNlZCByYW5nZXMuXG4gIGZ1bmN0aW9uIExpbmVWaWV3KGRvYywgbGluZSwgbGluZU4pIHtcbiAgICAvLyBUaGUgc3RhcnRpbmcgbGluZVxuICAgIHRoaXMubGluZSA9IGxpbmU7XG4gICAgLy8gQ29udGludWluZyBsaW5lcywgaWYgYW55XG4gICAgdGhpcy5yZXN0ID0gdmlzdWFsTGluZUNvbnRpbnVlZChsaW5lKTtcbiAgICAvLyBOdW1iZXIgb2YgbG9naWNhbCBsaW5lcyBpbiB0aGlzIHZpc3VhbCBsaW5lXG4gICAgdGhpcy5zaXplID0gdGhpcy5yZXN0ID8gbGluZU5vKGxzdCh0aGlzLnJlc3QpKSAtIGxpbmVOICsgMSA6IDE7XG4gICAgdGhpcy5ub2RlID0gdGhpcy50ZXh0ID0gbnVsbDtcbiAgICB0aGlzLmhpZGRlbiA9IGxpbmVJc0hpZGRlbihkb2MsIGxpbmUpO1xuICB9XG5cbiAgLy8gQ3JlYXRlIGEgcmFuZ2Ugb2YgTGluZVZpZXcgb2JqZWN0cyBmb3IgdGhlIGdpdmVuIGxpbmVzLlxuICBmdW5jdGlvbiBidWlsZFZpZXdBcnJheShjbSwgZnJvbSwgdG8pIHtcbiAgICB2YXIgYXJyYXkgPSBbXSwgbmV4dFBvcztcbiAgICBmb3IgKHZhciBwb3MgPSBmcm9tOyBwb3MgPCB0bzsgcG9zID0gbmV4dFBvcykge1xuICAgICAgdmFyIHZpZXcgPSBuZXcgTGluZVZpZXcoY20uZG9jLCBnZXRMaW5lKGNtLmRvYywgcG9zKSwgcG9zKTtcbiAgICAgIG5leHRQb3MgPSBwb3MgKyB2aWV3LnNpemU7XG4gICAgICBhcnJheS5wdXNoKHZpZXcpO1xuICAgIH1cbiAgICByZXR1cm4gYXJyYXk7XG4gIH1cblxuICAvLyBVcGRhdGVzIHRoZSBkaXNwbGF5LnZpZXcgZGF0YSBzdHJ1Y3R1cmUgZm9yIGEgZ2l2ZW4gY2hhbmdlIHRvIHRoZVxuICAvLyBkb2N1bWVudC4gRnJvbSBhbmQgdG8gYXJlIGluIHByZS1jaGFuZ2UgY29vcmRpbmF0ZXMuIExlbmRpZmYgaXNcbiAgLy8gdGhlIGFtb3VudCBvZiBsaW5lcyBhZGRlZCBvciBzdWJ0cmFjdGVkIGJ5IHRoZSBjaGFuZ2UuIFRoaXMgaXNcbiAgLy8gdXNlZCBmb3IgY2hhbmdlcyB0aGF0IHNwYW4gbXVsdGlwbGUgbGluZXMsIG9yIGNoYW5nZSB0aGUgd2F5XG4gIC8vIGxpbmVzIGFyZSBkaXZpZGVkIGludG8gdmlzdWFsIGxpbmVzLiByZWdMaW5lQ2hhbmdlIChiZWxvdylcbiAgLy8gcmVnaXN0ZXJzIHNpbmdsZS1saW5lIGNoYW5nZXMuXG4gIGZ1bmN0aW9uIHJlZ0NoYW5nZShjbSwgZnJvbSwgdG8sIGxlbmRpZmYpIHtcbiAgICBpZiAoZnJvbSA9PSBudWxsKSBmcm9tID0gY20uZG9jLmZpcnN0O1xuICAgIGlmICh0byA9PSBudWxsKSB0byA9IGNtLmRvYy5maXJzdCArIGNtLmRvYy5zaXplO1xuICAgIGlmICghbGVuZGlmZikgbGVuZGlmZiA9IDA7XG5cbiAgICB2YXIgZGlzcGxheSA9IGNtLmRpc3BsYXk7XG4gICAgaWYgKGxlbmRpZmYgJiYgdG8gPCBkaXNwbGF5LnZpZXdUbyAmJlxuICAgICAgICAoZGlzcGxheS51cGRhdGVMaW5lTnVtYmVycyA9PSBudWxsIHx8IGRpc3BsYXkudXBkYXRlTGluZU51bWJlcnMgPiBmcm9tKSlcbiAgICAgIGRpc3BsYXkudXBkYXRlTGluZU51bWJlcnMgPSBmcm9tO1xuXG4gICAgY20uY3VyT3Audmlld0NoYW5nZWQgPSB0cnVlO1xuXG4gICAgaWYgKGZyb20gPj0gZGlzcGxheS52aWV3VG8pIHsgLy8gQ2hhbmdlIGFmdGVyXG4gICAgICBpZiAoc2F3Q29sbGFwc2VkU3BhbnMgJiYgdmlzdWFsTGluZU5vKGNtLmRvYywgZnJvbSkgPCBkaXNwbGF5LnZpZXdUbylcbiAgICAgICAgcmVzZXRWaWV3KGNtKTtcbiAgICB9IGVsc2UgaWYgKHRvIDw9IGRpc3BsYXkudmlld0Zyb20pIHsgLy8gQ2hhbmdlIGJlZm9yZVxuICAgICAgaWYgKHNhd0NvbGxhcHNlZFNwYW5zICYmIHZpc3VhbExpbmVFbmRObyhjbS5kb2MsIHRvICsgbGVuZGlmZikgPiBkaXNwbGF5LnZpZXdGcm9tKSB7XG4gICAgICAgIHJlc2V0VmlldyhjbSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBkaXNwbGF5LnZpZXdGcm9tICs9IGxlbmRpZmY7XG4gICAgICAgIGRpc3BsYXkudmlld1RvICs9IGxlbmRpZmY7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChmcm9tIDw9IGRpc3BsYXkudmlld0Zyb20gJiYgdG8gPj0gZGlzcGxheS52aWV3VG8pIHsgLy8gRnVsbCBvdmVybGFwXG4gICAgICByZXNldFZpZXcoY20pO1xuICAgIH0gZWxzZSBpZiAoZnJvbSA8PSBkaXNwbGF5LnZpZXdGcm9tKSB7IC8vIFRvcCBvdmVybGFwXG4gICAgICB2YXIgY3V0ID0gdmlld0N1dHRpbmdQb2ludChjbSwgdG8sIHRvICsgbGVuZGlmZiwgMSk7XG4gICAgICBpZiAoY3V0KSB7XG4gICAgICAgIGRpc3BsYXkudmlldyA9IGRpc3BsYXkudmlldy5zbGljZShjdXQuaW5kZXgpO1xuICAgICAgICBkaXNwbGF5LnZpZXdGcm9tID0gY3V0LmxpbmVOO1xuICAgICAgICBkaXNwbGF5LnZpZXdUbyArPSBsZW5kaWZmO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmVzZXRWaWV3KGNtKTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHRvID49IGRpc3BsYXkudmlld1RvKSB7IC8vIEJvdHRvbSBvdmVybGFwXG4gICAgICB2YXIgY3V0ID0gdmlld0N1dHRpbmdQb2ludChjbSwgZnJvbSwgZnJvbSwgLTEpO1xuICAgICAgaWYgKGN1dCkge1xuICAgICAgICBkaXNwbGF5LnZpZXcgPSBkaXNwbGF5LnZpZXcuc2xpY2UoMCwgY3V0LmluZGV4KTtcbiAgICAgICAgZGlzcGxheS52aWV3VG8gPSBjdXQubGluZU47XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXNldFZpZXcoY20pO1xuICAgICAgfVxuICAgIH0gZWxzZSB7IC8vIEdhcCBpbiB0aGUgbWlkZGxlXG4gICAgICB2YXIgY3V0VG9wID0gdmlld0N1dHRpbmdQb2ludChjbSwgZnJvbSwgZnJvbSwgLTEpO1xuICAgICAgdmFyIGN1dEJvdCA9IHZpZXdDdXR0aW5nUG9pbnQoY20sIHRvLCB0byArIGxlbmRpZmYsIDEpO1xuICAgICAgaWYgKGN1dFRvcCAmJiBjdXRCb3QpIHtcbiAgICAgICAgZGlzcGxheS52aWV3ID0gZGlzcGxheS52aWV3LnNsaWNlKDAsIGN1dFRvcC5pbmRleClcbiAgICAgICAgICAuY29uY2F0KGJ1aWxkVmlld0FycmF5KGNtLCBjdXRUb3AubGluZU4sIGN1dEJvdC5saW5lTikpXG4gICAgICAgICAgLmNvbmNhdChkaXNwbGF5LnZpZXcuc2xpY2UoY3V0Qm90LmluZGV4KSk7XG4gICAgICAgIGRpc3BsYXkudmlld1RvICs9IGxlbmRpZmY7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXNldFZpZXcoY20pO1xuICAgICAgfVxuICAgIH1cblxuICAgIHZhciBleHQgPSBkaXNwbGF5LmV4dGVybmFsTWVhc3VyZWQ7XG4gICAgaWYgKGV4dCkge1xuICAgICAgaWYgKHRvIDwgZXh0LmxpbmVOKVxuICAgICAgICBleHQubGluZU4gKz0gbGVuZGlmZjtcbiAgICAgIGVsc2UgaWYgKGZyb20gPCBleHQubGluZU4gKyBleHQuc2l6ZSlcbiAgICAgICAgZGlzcGxheS5leHRlcm5hbE1lYXN1cmVkID0gbnVsbDtcbiAgICB9XG4gIH1cblxuICAvLyBSZWdpc3RlciBhIGNoYW5nZSB0byBhIHNpbmdsZSBsaW5lLiBUeXBlIG11c3QgYmUgb25lIG9mIFwidGV4dFwiLFxuICAvLyBcImd1dHRlclwiLCBcImNsYXNzXCIsIFwid2lkZ2V0XCJcbiAgZnVuY3Rpb24gcmVnTGluZUNoYW5nZShjbSwgbGluZSwgdHlwZSkge1xuICAgIGNtLmN1ck9wLnZpZXdDaGFuZ2VkID0gdHJ1ZTtcbiAgICB2YXIgZGlzcGxheSA9IGNtLmRpc3BsYXksIGV4dCA9IGNtLmRpc3BsYXkuZXh0ZXJuYWxNZWFzdXJlZDtcbiAgICBpZiAoZXh0ICYmIGxpbmUgPj0gZXh0LmxpbmVOICYmIGxpbmUgPCBleHQubGluZU4gKyBleHQuc2l6ZSlcbiAgICAgIGRpc3BsYXkuZXh0ZXJuYWxNZWFzdXJlZCA9IG51bGw7XG5cbiAgICBpZiAobGluZSA8IGRpc3BsYXkudmlld0Zyb20gfHwgbGluZSA+PSBkaXNwbGF5LnZpZXdUbykgcmV0dXJuO1xuICAgIHZhciBsaW5lVmlldyA9IGRpc3BsYXkudmlld1tmaW5kVmlld0luZGV4KGNtLCBsaW5lKV07XG4gICAgaWYgKGxpbmVWaWV3Lm5vZGUgPT0gbnVsbCkgcmV0dXJuO1xuICAgIHZhciBhcnIgPSBsaW5lVmlldy5jaGFuZ2VzIHx8IChsaW5lVmlldy5jaGFuZ2VzID0gW10pO1xuICAgIGlmIChpbmRleE9mKGFyciwgdHlwZSkgPT0gLTEpIGFyci5wdXNoKHR5cGUpO1xuICB9XG5cbiAgLy8gQ2xlYXIgdGhlIHZpZXcuXG4gIGZ1bmN0aW9uIHJlc2V0VmlldyhjbSkge1xuICAgIGNtLmRpc3BsYXkudmlld0Zyb20gPSBjbS5kaXNwbGF5LnZpZXdUbyA9IGNtLmRvYy5maXJzdDtcbiAgICBjbS5kaXNwbGF5LnZpZXcgPSBbXTtcbiAgICBjbS5kaXNwbGF5LnZpZXdPZmZzZXQgPSAwO1xuICB9XG5cbiAgLy8gRmluZCB0aGUgdmlldyBlbGVtZW50IGNvcnJlc3BvbmRpbmcgdG8gYSBnaXZlbiBsaW5lLiBSZXR1cm4gbnVsbFxuICAvLyB3aGVuIHRoZSBsaW5lIGlzbid0IHZpc2libGUuXG4gIGZ1bmN0aW9uIGZpbmRWaWV3SW5kZXgoY20sIG4pIHtcbiAgICBpZiAobiA+PSBjbS5kaXNwbGF5LnZpZXdUbykgcmV0dXJuIG51bGw7XG4gICAgbiAtPSBjbS5kaXNwbGF5LnZpZXdGcm9tO1xuICAgIGlmIChuIDwgMCkgcmV0dXJuIG51bGw7XG4gICAgdmFyIHZpZXcgPSBjbS5kaXNwbGF5LnZpZXc7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCB2aWV3Lmxlbmd0aDsgaSsrKSB7XG4gICAgICBuIC09IHZpZXdbaV0uc2l6ZTtcbiAgICAgIGlmIChuIDwgMCkgcmV0dXJuIGk7XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gdmlld0N1dHRpbmdQb2ludChjbSwgb2xkTiwgbmV3TiwgZGlyKSB7XG4gICAgdmFyIGluZGV4ID0gZmluZFZpZXdJbmRleChjbSwgb2xkTiksIGRpZmYsIHZpZXcgPSBjbS5kaXNwbGF5LnZpZXc7XG4gICAgaWYgKCFzYXdDb2xsYXBzZWRTcGFucyB8fCBuZXdOID09IGNtLmRvYy5maXJzdCArIGNtLmRvYy5zaXplKVxuICAgICAgcmV0dXJuIHtpbmRleDogaW5kZXgsIGxpbmVOOiBuZXdOfTtcbiAgICBmb3IgKHZhciBpID0gMCwgbiA9IGNtLmRpc3BsYXkudmlld0Zyb207IGkgPCBpbmRleDsgaSsrKVxuICAgICAgbiArPSB2aWV3W2ldLnNpemU7XG4gICAgaWYgKG4gIT0gb2xkTikge1xuICAgICAgaWYgKGRpciA+IDApIHtcbiAgICAgICAgaWYgKGluZGV4ID09IHZpZXcubGVuZ3RoIC0gMSkgcmV0dXJuIG51bGw7XG4gICAgICAgIGRpZmYgPSAobiArIHZpZXdbaW5kZXhdLnNpemUpIC0gb2xkTjtcbiAgICAgICAgaW5kZXgrKztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGRpZmYgPSBuIC0gb2xkTjtcbiAgICAgIH1cbiAgICAgIG9sZE4gKz0gZGlmZjsgbmV3TiArPSBkaWZmO1xuICAgIH1cbiAgICB3aGlsZSAodmlzdWFsTGluZU5vKGNtLmRvYywgbmV3TikgIT0gbmV3Tikge1xuICAgICAgaWYgKGluZGV4ID09IChkaXIgPCAwID8gMCA6IHZpZXcubGVuZ3RoIC0gMSkpIHJldHVybiBudWxsO1xuICAgICAgbmV3TiArPSBkaXIgKiB2aWV3W2luZGV4IC0gKGRpciA8IDAgPyAxIDogMCldLnNpemU7XG4gICAgICBpbmRleCArPSBkaXI7XG4gICAgfVxuICAgIHJldHVybiB7aW5kZXg6IGluZGV4LCBsaW5lTjogbmV3Tn07XG4gIH1cblxuICAvLyBGb3JjZSB0aGUgdmlldyB0byBjb3ZlciBhIGdpdmVuIHJhbmdlLCBhZGRpbmcgZW1wdHkgdmlldyBlbGVtZW50XG4gIC8vIG9yIGNsaXBwaW5nIG9mZiBleGlzdGluZyBvbmVzIGFzIG5lZWRlZC5cbiAgZnVuY3Rpb24gYWRqdXN0VmlldyhjbSwgZnJvbSwgdG8pIHtcbiAgICB2YXIgZGlzcGxheSA9IGNtLmRpc3BsYXksIHZpZXcgPSBkaXNwbGF5LnZpZXc7XG4gICAgaWYgKHZpZXcubGVuZ3RoID09IDAgfHwgZnJvbSA+PSBkaXNwbGF5LnZpZXdUbyB8fCB0byA8PSBkaXNwbGF5LnZpZXdGcm9tKSB7XG4gICAgICBkaXNwbGF5LnZpZXcgPSBidWlsZFZpZXdBcnJheShjbSwgZnJvbSwgdG8pO1xuICAgICAgZGlzcGxheS52aWV3RnJvbSA9IGZyb207XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmIChkaXNwbGF5LnZpZXdGcm9tID4gZnJvbSlcbiAgICAgICAgZGlzcGxheS52aWV3ID0gYnVpbGRWaWV3QXJyYXkoY20sIGZyb20sIGRpc3BsYXkudmlld0Zyb20pLmNvbmNhdChkaXNwbGF5LnZpZXcpO1xuICAgICAgZWxzZSBpZiAoZGlzcGxheS52aWV3RnJvbSA8IGZyb20pXG4gICAgICAgIGRpc3BsYXkudmlldyA9IGRpc3BsYXkudmlldy5zbGljZShmaW5kVmlld0luZGV4KGNtLCBmcm9tKSk7XG4gICAgICBkaXNwbGF5LnZpZXdGcm9tID0gZnJvbTtcbiAgICAgIGlmIChkaXNwbGF5LnZpZXdUbyA8IHRvKVxuICAgICAgICBkaXNwbGF5LnZpZXcgPSBkaXNwbGF5LnZpZXcuY29uY2F0KGJ1aWxkVmlld0FycmF5KGNtLCBkaXNwbGF5LnZpZXdUbywgdG8pKTtcbiAgICAgIGVsc2UgaWYgKGRpc3BsYXkudmlld1RvID4gdG8pXG4gICAgICAgIGRpc3BsYXkudmlldyA9IGRpc3BsYXkudmlldy5zbGljZSgwLCBmaW5kVmlld0luZGV4KGNtLCB0bykpO1xuICAgIH1cbiAgICBkaXNwbGF5LnZpZXdUbyA9IHRvO1xuICB9XG5cbiAgLy8gQ291bnQgdGhlIG51bWJlciBvZiBsaW5lcyBpbiB0aGUgdmlldyB3aG9zZSBET00gcmVwcmVzZW50YXRpb24gaXNcbiAgLy8gb3V0IG9mIGRhdGUgKG9yIG5vbmV4aXN0ZW50KS5cbiAgZnVuY3Rpb24gY291bnREaXJ0eVZpZXcoY20pIHtcbiAgICB2YXIgdmlldyA9IGNtLmRpc3BsYXkudmlldywgZGlydHkgPSAwO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgdmlldy5sZW5ndGg7IGkrKykge1xuICAgICAgdmFyIGxpbmVWaWV3ID0gdmlld1tpXTtcbiAgICAgIGlmICghbGluZVZpZXcuaGlkZGVuICYmICghbGluZVZpZXcubm9kZSB8fCBsaW5lVmlldy5jaGFuZ2VzKSkgKytkaXJ0eTtcbiAgICB9XG4gICAgcmV0dXJuIGRpcnR5O1xuICB9XG5cbiAgLy8gRVZFTlQgSEFORExFUlNcblxuICAvLyBBdHRhY2ggdGhlIG5lY2Vzc2FyeSBldmVudCBoYW5kbGVycyB3aGVuIGluaXRpYWxpemluZyB0aGUgZWRpdG9yXG4gIGZ1bmN0aW9uIHJlZ2lzdGVyRXZlbnRIYW5kbGVycyhjbSkge1xuICAgIHZhciBkID0gY20uZGlzcGxheTtcbiAgICBvbihkLnNjcm9sbGVyLCBcIm1vdXNlZG93blwiLCBvcGVyYXRpb24oY20sIG9uTW91c2VEb3duKSk7XG4gICAgLy8gT2xkZXIgSUUncyB3aWxsIG5vdCBmaXJlIGEgc2Vjb25kIG1vdXNlZG93biBmb3IgYSBkb3VibGUgY2xpY2tcbiAgICBpZiAoaWUgJiYgaWVfdmVyc2lvbiA8IDExKVxuICAgICAgb24oZC5zY3JvbGxlciwgXCJkYmxjbGlja1wiLCBvcGVyYXRpb24oY20sIGZ1bmN0aW9uKGUpIHtcbiAgICAgICAgaWYgKHNpZ25hbERPTUV2ZW50KGNtLCBlKSkgcmV0dXJuO1xuICAgICAgICB2YXIgcG9zID0gcG9zRnJvbU1vdXNlKGNtLCBlKTtcbiAgICAgICAgaWYgKCFwb3MgfHwgY2xpY2tJbkd1dHRlcihjbSwgZSkgfHwgZXZlbnRJbldpZGdldChjbS5kaXNwbGF5LCBlKSkgcmV0dXJuO1xuICAgICAgICBlX3ByZXZlbnREZWZhdWx0KGUpO1xuICAgICAgICB2YXIgd29yZCA9IGNtLmZpbmRXb3JkQXQocG9zKTtcbiAgICAgICAgZXh0ZW5kU2VsZWN0aW9uKGNtLmRvYywgd29yZC5hbmNob3IsIHdvcmQuaGVhZCk7XG4gICAgICB9KSk7XG4gICAgZWxzZVxuICAgICAgb24oZC5zY3JvbGxlciwgXCJkYmxjbGlja1wiLCBmdW5jdGlvbihlKSB7IHNpZ25hbERPTUV2ZW50KGNtLCBlKSB8fCBlX3ByZXZlbnREZWZhdWx0KGUpOyB9KTtcbiAgICAvLyBTb21lIGJyb3dzZXJzIGZpcmUgY29udGV4dG1lbnUgKmFmdGVyKiBvcGVuaW5nIHRoZSBtZW51LCBhdFxuICAgIC8vIHdoaWNoIHBvaW50IHdlIGNhbid0IG1lc3Mgd2l0aCBpdCBhbnltb3JlLiBDb250ZXh0IG1lbnUgaXNcbiAgICAvLyBoYW5kbGVkIGluIG9uTW91c2VEb3duIGZvciB0aGVzZSBicm93c2Vycy5cbiAgICBpZiAoIWNhcHR1cmVSaWdodENsaWNrKSBvbihkLnNjcm9sbGVyLCBcImNvbnRleHRtZW51XCIsIGZ1bmN0aW9uKGUpIHtvbkNvbnRleHRNZW51KGNtLCBlKTt9KTtcblxuICAgIC8vIFVzZWQgdG8gc3VwcHJlc3MgbW91c2UgZXZlbnQgaGFuZGxpbmcgd2hlbiBhIHRvdWNoIGhhcHBlbnNcbiAgICB2YXIgdG91Y2hGaW5pc2hlZCwgcHJldlRvdWNoID0ge2VuZDogMH07XG4gICAgZnVuY3Rpb24gZmluaXNoVG91Y2goKSB7XG4gICAgICBpZiAoZC5hY3RpdmVUb3VjaCkge1xuICAgICAgICB0b3VjaEZpbmlzaGVkID0gc2V0VGltZW91dChmdW5jdGlvbigpIHtkLmFjdGl2ZVRvdWNoID0gbnVsbDt9LCAxMDAwKTtcbiAgICAgICAgcHJldlRvdWNoID0gZC5hY3RpdmVUb3VjaDtcbiAgICAgICAgcHJldlRvdWNoLmVuZCA9ICtuZXcgRGF0ZTtcbiAgICAgIH1cbiAgICB9O1xuICAgIGZ1bmN0aW9uIGlzTW91c2VMaWtlVG91Y2hFdmVudChlKSB7XG4gICAgICBpZiAoZS50b3VjaGVzLmxlbmd0aCAhPSAxKSByZXR1cm4gZmFsc2U7XG4gICAgICB2YXIgdG91Y2ggPSBlLnRvdWNoZXNbMF07XG4gICAgICByZXR1cm4gdG91Y2gucmFkaXVzWCA8PSAxICYmIHRvdWNoLnJhZGl1c1kgPD0gMTtcbiAgICB9XG4gICAgZnVuY3Rpb24gZmFyQXdheSh0b3VjaCwgb3RoZXIpIHtcbiAgICAgIGlmIChvdGhlci5sZWZ0ID09IG51bGwpIHJldHVybiB0cnVlO1xuICAgICAgdmFyIGR4ID0gb3RoZXIubGVmdCAtIHRvdWNoLmxlZnQsIGR5ID0gb3RoZXIudG9wIC0gdG91Y2gudG9wO1xuICAgICAgcmV0dXJuIGR4ICogZHggKyBkeSAqIGR5ID4gMjAgKiAyMDtcbiAgICB9XG4gICAgb24oZC5zY3JvbGxlciwgXCJ0b3VjaHN0YXJ0XCIsIGZ1bmN0aW9uKGUpIHtcbiAgICAgIGlmICghaXNNb3VzZUxpa2VUb3VjaEV2ZW50KGUpKSB7XG4gICAgICAgIGNsZWFyVGltZW91dCh0b3VjaEZpbmlzaGVkKTtcbiAgICAgICAgdmFyIG5vdyA9ICtuZXcgRGF0ZTtcbiAgICAgICAgZC5hY3RpdmVUb3VjaCA9IHtzdGFydDogbm93LCBtb3ZlZDogZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgICAgICAgcHJldjogbm93IC0gcHJldlRvdWNoLmVuZCA8PSAzMDAgPyBwcmV2VG91Y2ggOiBudWxsfTtcbiAgICAgICAgaWYgKGUudG91Y2hlcy5sZW5ndGggPT0gMSkge1xuICAgICAgICAgIGQuYWN0aXZlVG91Y2gubGVmdCA9IGUudG91Y2hlc1swXS5wYWdlWDtcbiAgICAgICAgICBkLmFjdGl2ZVRvdWNoLnRvcCA9IGUudG91Y2hlc1swXS5wYWdlWTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pO1xuICAgIG9uKGQuc2Nyb2xsZXIsIFwidG91Y2htb3ZlXCIsIGZ1bmN0aW9uKCkge1xuICAgICAgaWYgKGQuYWN0aXZlVG91Y2gpIGQuYWN0aXZlVG91Y2gubW92ZWQgPSB0cnVlO1xuICAgIH0pO1xuICAgIG9uKGQuc2Nyb2xsZXIsIFwidG91Y2hlbmRcIiwgZnVuY3Rpb24oZSkge1xuICAgICAgdmFyIHRvdWNoID0gZC5hY3RpdmVUb3VjaDtcbiAgICAgIGlmICh0b3VjaCAmJiAhZXZlbnRJbldpZGdldChkLCBlKSAmJiB0b3VjaC5sZWZ0ICE9IG51bGwgJiZcbiAgICAgICAgICAhdG91Y2gubW92ZWQgJiYgbmV3IERhdGUgLSB0b3VjaC5zdGFydCA8IDMwMCkge1xuICAgICAgICB2YXIgcG9zID0gY20uY29vcmRzQ2hhcihkLmFjdGl2ZVRvdWNoLCBcInBhZ2VcIiksIHJhbmdlO1xuICAgICAgICBpZiAoIXRvdWNoLnByZXYgfHwgZmFyQXdheSh0b3VjaCwgdG91Y2gucHJldikpIC8vIFNpbmdsZSB0YXBcbiAgICAgICAgICByYW5nZSA9IG5ldyBSYW5nZShwb3MsIHBvcyk7XG4gICAgICAgIGVsc2UgaWYgKCF0b3VjaC5wcmV2LnByZXYgfHwgZmFyQXdheSh0b3VjaCwgdG91Y2gucHJldi5wcmV2KSkgLy8gRG91YmxlIHRhcFxuICAgICAgICAgIHJhbmdlID0gY20uZmluZFdvcmRBdChwb3MpO1xuICAgICAgICBlbHNlIC8vIFRyaXBsZSB0YXBcbiAgICAgICAgICByYW5nZSA9IG5ldyBSYW5nZShQb3MocG9zLmxpbmUsIDApLCBjbGlwUG9zKGNtLmRvYywgUG9zKHBvcy5saW5lICsgMSwgMCkpKTtcbiAgICAgICAgY20uc2V0U2VsZWN0aW9uKHJhbmdlLmFuY2hvciwgcmFuZ2UuaGVhZCk7XG4gICAgICAgIGNtLmZvY3VzKCk7XG4gICAgICAgIGVfcHJldmVudERlZmF1bHQoZSk7XG4gICAgICB9XG4gICAgICBmaW5pc2hUb3VjaCgpO1xuICAgIH0pO1xuICAgIG9uKGQuc2Nyb2xsZXIsIFwidG91Y2hjYW5jZWxcIiwgZmluaXNoVG91Y2gpO1xuXG4gICAgLy8gU3luYyBzY3JvbGxpbmcgYmV0d2VlbiBmYWtlIHNjcm9sbGJhcnMgYW5kIHJlYWwgc2Nyb2xsYWJsZVxuICAgIC8vIGFyZWEsIGVuc3VyZSB2aWV3cG9ydCBpcyB1cGRhdGVkIHdoZW4gc2Nyb2xsaW5nLlxuICAgIG9uKGQuc2Nyb2xsZXIsIFwic2Nyb2xsXCIsIGZ1bmN0aW9uKCkge1xuICAgICAgaWYgKGQuc2Nyb2xsZXIuY2xpZW50SGVpZ2h0KSB7XG4gICAgICAgIHNldFNjcm9sbFRvcChjbSwgZC5zY3JvbGxlci5zY3JvbGxUb3ApO1xuICAgICAgICBzZXRTY3JvbGxMZWZ0KGNtLCBkLnNjcm9sbGVyLnNjcm9sbExlZnQsIHRydWUpO1xuICAgICAgICBzaWduYWwoY20sIFwic2Nyb2xsXCIsIGNtKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIExpc3RlbiB0byB3aGVlbCBldmVudHMgaW4gb3JkZXIgdG8gdHJ5IGFuZCB1cGRhdGUgdGhlIHZpZXdwb3J0IG9uIHRpbWUuXG4gICAgb24oZC5zY3JvbGxlciwgXCJtb3VzZXdoZWVsXCIsIGZ1bmN0aW9uKGUpe29uU2Nyb2xsV2hlZWwoY20sIGUpO30pO1xuICAgIG9uKGQuc2Nyb2xsZXIsIFwiRE9NTW91c2VTY3JvbGxcIiwgZnVuY3Rpb24oZSl7b25TY3JvbGxXaGVlbChjbSwgZSk7fSk7XG5cbiAgICAvLyBQcmV2ZW50IHdyYXBwZXIgZnJvbSBldmVyIHNjcm9sbGluZ1xuICAgIG9uKGQud3JhcHBlciwgXCJzY3JvbGxcIiwgZnVuY3Rpb24oKSB7IGQud3JhcHBlci5zY3JvbGxUb3AgPSBkLndyYXBwZXIuc2Nyb2xsTGVmdCA9IDA7IH0pO1xuXG4gICAgZC5kcmFnRnVuY3Rpb25zID0ge1xuICAgICAgc2ltcGxlOiBmdW5jdGlvbihlKSB7aWYgKCFzaWduYWxET01FdmVudChjbSwgZSkpIGVfc3RvcChlKTt9LFxuICAgICAgc3RhcnQ6IGZ1bmN0aW9uKGUpe29uRHJhZ1N0YXJ0KGNtLCBlKTt9LFxuICAgICAgZHJvcDogb3BlcmF0aW9uKGNtLCBvbkRyb3ApXG4gICAgfTtcblxuICAgIHZhciBpbnAgPSBkLmlucHV0LmdldEZpZWxkKCk7XG4gICAgb24oaW5wLCBcImtleXVwXCIsIGZ1bmN0aW9uKGUpIHsgb25LZXlVcC5jYWxsKGNtLCBlKTsgfSk7XG4gICAgb24oaW5wLCBcImtleWRvd25cIiwgb3BlcmF0aW9uKGNtLCBvbktleURvd24pKTtcbiAgICBvbihpbnAsIFwia2V5cHJlc3NcIiwgb3BlcmF0aW9uKGNtLCBvbktleVByZXNzKSk7XG4gICAgb24oaW5wLCBcImZvY3VzXCIsIGJpbmQob25Gb2N1cywgY20pKTtcbiAgICBvbihpbnAsIFwiYmx1clwiLCBiaW5kKG9uQmx1ciwgY20pKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGRyYWdEcm9wQ2hhbmdlZChjbSwgdmFsdWUsIG9sZCkge1xuICAgIHZhciB3YXNPbiA9IG9sZCAmJiBvbGQgIT0gQ29kZU1pcnJvci5Jbml0O1xuICAgIGlmICghdmFsdWUgIT0gIXdhc09uKSB7XG4gICAgICB2YXIgZnVuY3MgPSBjbS5kaXNwbGF5LmRyYWdGdW5jdGlvbnM7XG4gICAgICB2YXIgdG9nZ2xlID0gdmFsdWUgPyBvbiA6IG9mZjtcbiAgICAgIHRvZ2dsZShjbS5kaXNwbGF5LnNjcm9sbGVyLCBcImRyYWdzdGFydFwiLCBmdW5jcy5zdGFydCk7XG4gICAgICB0b2dnbGUoY20uZGlzcGxheS5zY3JvbGxlciwgXCJkcmFnZW50ZXJcIiwgZnVuY3Muc2ltcGxlKTtcbiAgICAgIHRvZ2dsZShjbS5kaXNwbGF5LnNjcm9sbGVyLCBcImRyYWdvdmVyXCIsIGZ1bmNzLnNpbXBsZSk7XG4gICAgICB0b2dnbGUoY20uZGlzcGxheS5zY3JvbGxlciwgXCJkcm9wXCIsIGZ1bmNzLmRyb3ApO1xuICAgIH1cbiAgfVxuXG4gIC8vIENhbGxlZCB3aGVuIHRoZSB3aW5kb3cgcmVzaXplc1xuICBmdW5jdGlvbiBvblJlc2l6ZShjbSkge1xuICAgIHZhciBkID0gY20uZGlzcGxheTtcbiAgICBpZiAoZC5sYXN0V3JhcEhlaWdodCA9PSBkLndyYXBwZXIuY2xpZW50SGVpZ2h0ICYmIGQubGFzdFdyYXBXaWR0aCA9PSBkLndyYXBwZXIuY2xpZW50V2lkdGgpXG4gICAgICByZXR1cm47XG4gICAgLy8gTWlnaHQgYmUgYSB0ZXh0IHNjYWxpbmcgb3BlcmF0aW9uLCBjbGVhciBzaXplIGNhY2hlcy5cbiAgICBkLmNhY2hlZENoYXJXaWR0aCA9IGQuY2FjaGVkVGV4dEhlaWdodCA9IGQuY2FjaGVkUGFkZGluZ0ggPSBudWxsO1xuICAgIGQuc2Nyb2xsYmFyc0NsaXBwZWQgPSBmYWxzZTtcbiAgICBjbS5zZXRTaXplKCk7XG4gIH1cblxuICAvLyBNT1VTRSBFVkVOVFNcblxuICAvLyBSZXR1cm4gdHJ1ZSB3aGVuIHRoZSBnaXZlbiBtb3VzZSBldmVudCBoYXBwZW5lZCBpbiBhIHdpZGdldFxuICBmdW5jdGlvbiBldmVudEluV2lkZ2V0KGRpc3BsYXksIGUpIHtcbiAgICBmb3IgKHZhciBuID0gZV90YXJnZXQoZSk7IG4gIT0gZGlzcGxheS53cmFwcGVyOyBuID0gbi5wYXJlbnROb2RlKSB7XG4gICAgICBpZiAoIW4gfHwgKG4ubm9kZVR5cGUgPT0gMSAmJiBuLmdldEF0dHJpYnV0ZShcImNtLWlnbm9yZS1ldmVudHNcIikgPT0gXCJ0cnVlXCIpIHx8XG4gICAgICAgICAgKG4ucGFyZW50Tm9kZSA9PSBkaXNwbGF5LnNpemVyICYmIG4gIT0gZGlzcGxheS5tb3ZlcikpXG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgfVxuXG4gIC8vIEdpdmVuIGEgbW91c2UgZXZlbnQsIGZpbmQgdGhlIGNvcnJlc3BvbmRpbmcgcG9zaXRpb24uIElmIGxpYmVyYWxcbiAgLy8gaXMgZmFsc2UsIGl0IGNoZWNrcyB3aGV0aGVyIGEgZ3V0dGVyIG9yIHNjcm9sbGJhciB3YXMgY2xpY2tlZCxcbiAgLy8gYW5kIHJldHVybnMgbnVsbCBpZiBpdCB3YXMuIGZvclJlY3QgaXMgdXNlZCBieSByZWN0YW5ndWxhclxuICAvLyBzZWxlY3Rpb25zLCBhbmQgdHJpZXMgdG8gZXN0aW1hdGUgYSBjaGFyYWN0ZXIgcG9zaXRpb24gZXZlbiBmb3JcbiAgLy8gY29vcmRpbmF0ZXMgYmV5b25kIHRoZSByaWdodCBvZiB0aGUgdGV4dC5cbiAgZnVuY3Rpb24gcG9zRnJvbU1vdXNlKGNtLCBlLCBsaWJlcmFsLCBmb3JSZWN0KSB7XG4gICAgdmFyIGRpc3BsYXkgPSBjbS5kaXNwbGF5O1xuICAgIGlmICghbGliZXJhbCAmJiBlX3RhcmdldChlKS5nZXRBdHRyaWJ1dGUoXCJjbS1ub3QtY29udGVudFwiKSA9PSBcInRydWVcIikgcmV0dXJuIG51bGw7XG5cbiAgICB2YXIgeCwgeSwgc3BhY2UgPSBkaXNwbGF5LmxpbmVTcGFjZS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICAvLyBGYWlscyB1bnByZWRpY3RhYmx5IG9uIElFWzY3XSB3aGVuIG1vdXNlIGlzIGRyYWdnZWQgYXJvdW5kIHF1aWNrbHkuXG4gICAgdHJ5IHsgeCA9IGUuY2xpZW50WCAtIHNwYWNlLmxlZnQ7IHkgPSBlLmNsaWVudFkgLSBzcGFjZS50b3A7IH1cbiAgICBjYXRjaCAoZSkgeyByZXR1cm4gbnVsbDsgfVxuICAgIHZhciBjb29yZHMgPSBjb29yZHNDaGFyKGNtLCB4LCB5KSwgbGluZTtcbiAgICBpZiAoZm9yUmVjdCAmJiBjb29yZHMueFJlbCA9PSAxICYmIChsaW5lID0gZ2V0TGluZShjbS5kb2MsIGNvb3Jkcy5saW5lKS50ZXh0KS5sZW5ndGggPT0gY29vcmRzLmNoKSB7XG4gICAgICB2YXIgY29sRGlmZiA9IGNvdW50Q29sdW1uKGxpbmUsIGxpbmUubGVuZ3RoLCBjbS5vcHRpb25zLnRhYlNpemUpIC0gbGluZS5sZW5ndGg7XG4gICAgICBjb29yZHMgPSBQb3MoY29vcmRzLmxpbmUsIE1hdGgubWF4KDAsIE1hdGgucm91bmQoKHggLSBwYWRkaW5nSChjbS5kaXNwbGF5KS5sZWZ0KSAvIGNoYXJXaWR0aChjbS5kaXNwbGF5KSkgLSBjb2xEaWZmKSk7XG4gICAgfVxuICAgIHJldHVybiBjb29yZHM7XG4gIH1cblxuICAvLyBBIG1vdXNlIGRvd24gY2FuIGJlIGEgc2luZ2xlIGNsaWNrLCBkb3VibGUgY2xpY2ssIHRyaXBsZSBjbGljayxcbiAgLy8gc3RhcnQgb2Ygc2VsZWN0aW9uIGRyYWcsIHN0YXJ0IG9mIHRleHQgZHJhZywgbmV3IGN1cnNvclxuICAvLyAoY3RybC1jbGljayksIHJlY3RhbmdsZSBkcmFnIChhbHQtZHJhZyksIG9yIHh3aW5cbiAgLy8gbWlkZGxlLWNsaWNrLXBhc3RlLiBPciBpdCBtaWdodCBiZSBhIGNsaWNrIG9uIHNvbWV0aGluZyB3ZSBzaG91bGRcbiAgLy8gbm90IGludGVyZmVyZSB3aXRoLCBzdWNoIGFzIGEgc2Nyb2xsYmFyIG9yIHdpZGdldC5cbiAgZnVuY3Rpb24gb25Nb3VzZURvd24oZSkge1xuICAgIHZhciBjbSA9IHRoaXMsIGRpc3BsYXkgPSBjbS5kaXNwbGF5O1xuICAgIGlmIChkaXNwbGF5LmFjdGl2ZVRvdWNoICYmIGRpc3BsYXkuaW5wdXQuc3VwcG9ydHNUb3VjaCgpIHx8IHNpZ25hbERPTUV2ZW50KGNtLCBlKSkgcmV0dXJuO1xuICAgIGRpc3BsYXkuc2hpZnQgPSBlLnNoaWZ0S2V5O1xuXG4gICAgaWYgKGV2ZW50SW5XaWRnZXQoZGlzcGxheSwgZSkpIHtcbiAgICAgIGlmICghd2Via2l0KSB7XG4gICAgICAgIC8vIEJyaWVmbHkgdHVybiBvZmYgZHJhZ2dhYmlsaXR5LCB0byBhbGxvdyB3aWRnZXRzIHRvIGRvXG4gICAgICAgIC8vIG5vcm1hbCBkcmFnZ2luZyB0aGluZ3MuXG4gICAgICAgIGRpc3BsYXkuc2Nyb2xsZXIuZHJhZ2dhYmxlID0gZmFsc2U7XG4gICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKXtkaXNwbGF5LnNjcm9sbGVyLmRyYWdnYWJsZSA9IHRydWU7fSwgMTAwKTtcbiAgICAgIH1cbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKGNsaWNrSW5HdXR0ZXIoY20sIGUpKSByZXR1cm47XG4gICAgdmFyIHN0YXJ0ID0gcG9zRnJvbU1vdXNlKGNtLCBlKTtcbiAgICB3aW5kb3cuZm9jdXMoKTtcblxuICAgIHN3aXRjaCAoZV9idXR0b24oZSkpIHtcbiAgICBjYXNlIDE6XG4gICAgICBpZiAoc3RhcnQpXG4gICAgICAgIGxlZnRCdXR0b25Eb3duKGNtLCBlLCBzdGFydCk7XG4gICAgICBlbHNlIGlmIChlX3RhcmdldChlKSA9PSBkaXNwbGF5LnNjcm9sbGVyKVxuICAgICAgICBlX3ByZXZlbnREZWZhdWx0KGUpO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAyOlxuICAgICAgaWYgKHdlYmtpdCkgY20uc3RhdGUubGFzdE1pZGRsZURvd24gPSArbmV3IERhdGU7XG4gICAgICBpZiAoc3RhcnQpIGV4dGVuZFNlbGVjdGlvbihjbS5kb2MsIHN0YXJ0KTtcbiAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7ZGlzcGxheS5pbnB1dC5mb2N1cygpO30sIDIwKTtcbiAgICAgIGVfcHJldmVudERlZmF1bHQoZSk7XG4gICAgICBicmVhaztcbiAgICBjYXNlIDM6XG4gICAgICBpZiAoY2FwdHVyZVJpZ2h0Q2xpY2spIG9uQ29udGV4dE1lbnUoY20sIGUpO1xuICAgICAgZWxzZSBkZWxheUJsdXJFdmVudChjbSk7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cblxuICB2YXIgbGFzdENsaWNrLCBsYXN0RG91YmxlQ2xpY2s7XG4gIGZ1bmN0aW9uIGxlZnRCdXR0b25Eb3duKGNtLCBlLCBzdGFydCkge1xuICAgIGlmIChpZSkgc2V0VGltZW91dChiaW5kKGVuc3VyZUZvY3VzLCBjbSksIDApO1xuICAgIGVsc2UgY20uY3VyT3AuZm9jdXMgPSBhY3RpdmVFbHQoKTtcblxuICAgIHZhciBub3cgPSArbmV3IERhdGUsIHR5cGU7XG4gICAgaWYgKGxhc3REb3VibGVDbGljayAmJiBsYXN0RG91YmxlQ2xpY2sudGltZSA+IG5vdyAtIDQwMCAmJiBjbXAobGFzdERvdWJsZUNsaWNrLnBvcywgc3RhcnQpID09IDApIHtcbiAgICAgIHR5cGUgPSBcInRyaXBsZVwiO1xuICAgIH0gZWxzZSBpZiAobGFzdENsaWNrICYmIGxhc3RDbGljay50aW1lID4gbm93IC0gNDAwICYmIGNtcChsYXN0Q2xpY2sucG9zLCBzdGFydCkgPT0gMCkge1xuICAgICAgdHlwZSA9IFwiZG91YmxlXCI7XG4gICAgICBsYXN0RG91YmxlQ2xpY2sgPSB7dGltZTogbm93LCBwb3M6IHN0YXJ0fTtcbiAgICB9IGVsc2Uge1xuICAgICAgdHlwZSA9IFwic2luZ2xlXCI7XG4gICAgICBsYXN0Q2xpY2sgPSB7dGltZTogbm93LCBwb3M6IHN0YXJ0fTtcbiAgICB9XG5cbiAgICB2YXIgc2VsID0gY20uZG9jLnNlbCwgbW9kaWZpZXIgPSBtYWMgPyBlLm1ldGFLZXkgOiBlLmN0cmxLZXksIGNvbnRhaW5lZDtcbiAgICBpZiAoY20ub3B0aW9ucy5kcmFnRHJvcCAmJiBkcmFnQW5kRHJvcCAmJiAhaXNSZWFkT25seShjbSkgJiZcbiAgICAgICAgdHlwZSA9PSBcInNpbmdsZVwiICYmIChjb250YWluZWQgPSBzZWwuY29udGFpbnMoc3RhcnQpKSA+IC0xICYmXG4gICAgICAgIChjbXAoKGNvbnRhaW5lZCA9IHNlbC5yYW5nZXNbY29udGFpbmVkXSkuZnJvbSgpLCBzdGFydCkgPCAwIHx8IHN0YXJ0LnhSZWwgPiAwKSAmJlxuICAgICAgICAoY21wKGNvbnRhaW5lZC50bygpLCBzdGFydCkgPiAwIHx8IHN0YXJ0LnhSZWwgPCAwKSlcbiAgICAgIGxlZnRCdXR0b25TdGFydERyYWcoY20sIGUsIHN0YXJ0LCBtb2RpZmllcik7XG4gICAgZWxzZVxuICAgICAgbGVmdEJ1dHRvblNlbGVjdChjbSwgZSwgc3RhcnQsIHR5cGUsIG1vZGlmaWVyKTtcbiAgfVxuXG4gIC8vIFN0YXJ0IGEgdGV4dCBkcmFnLiBXaGVuIGl0IGVuZHMsIHNlZSBpZiBhbnkgZHJhZ2dpbmcgYWN0dWFsbHlcbiAgLy8gaGFwcGVuLCBhbmQgdHJlYXQgYXMgYSBjbGljayBpZiBpdCBkaWRuJ3QuXG4gIGZ1bmN0aW9uIGxlZnRCdXR0b25TdGFydERyYWcoY20sIGUsIHN0YXJ0LCBtb2RpZmllcikge1xuICAgIHZhciBkaXNwbGF5ID0gY20uZGlzcGxheSwgc3RhcnRUaW1lID0gK25ldyBEYXRlO1xuICAgIHZhciBkcmFnRW5kID0gb3BlcmF0aW9uKGNtLCBmdW5jdGlvbihlMikge1xuICAgICAgaWYgKHdlYmtpdCkgZGlzcGxheS5zY3JvbGxlci5kcmFnZ2FibGUgPSBmYWxzZTtcbiAgICAgIGNtLnN0YXRlLmRyYWdnaW5nVGV4dCA9IGZhbHNlO1xuICAgICAgb2ZmKGRvY3VtZW50LCBcIm1vdXNldXBcIiwgZHJhZ0VuZCk7XG4gICAgICBvZmYoZGlzcGxheS5zY3JvbGxlciwgXCJkcm9wXCIsIGRyYWdFbmQpO1xuICAgICAgaWYgKE1hdGguYWJzKGUuY2xpZW50WCAtIGUyLmNsaWVudFgpICsgTWF0aC5hYnMoZS5jbGllbnRZIC0gZTIuY2xpZW50WSkgPCAxMCkge1xuICAgICAgICBlX3ByZXZlbnREZWZhdWx0KGUyKTtcbiAgICAgICAgaWYgKCFtb2RpZmllciAmJiArbmV3IERhdGUgLSAyMDAgPCBzdGFydFRpbWUpXG4gICAgICAgICAgZXh0ZW5kU2VsZWN0aW9uKGNtLmRvYywgc3RhcnQpO1xuICAgICAgICAvLyBXb3JrIGFyb3VuZCB1bmV4cGxhaW5hYmxlIGZvY3VzIHByb2JsZW0gaW4gSUU5ICgjMjEyNykgYW5kIENocm9tZSAoIzMwODEpXG4gICAgICAgIGlmICh3ZWJraXQgfHwgaWUgJiYgaWVfdmVyc2lvbiA9PSA5KVxuICAgICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7ZG9jdW1lbnQuYm9keS5mb2N1cygpOyBkaXNwbGF5LmlucHV0LmZvY3VzKCk7fSwgMjApO1xuICAgICAgICBlbHNlXG4gICAgICAgICAgZGlzcGxheS5pbnB1dC5mb2N1cygpO1xuICAgICAgfVxuICAgIH0pO1xuICAgIC8vIExldCB0aGUgZHJhZyBoYW5kbGVyIGhhbmRsZSB0aGlzLlxuICAgIGlmICh3ZWJraXQpIGRpc3BsYXkuc2Nyb2xsZXIuZHJhZ2dhYmxlID0gdHJ1ZTtcbiAgICBjbS5zdGF0ZS5kcmFnZ2luZ1RleHQgPSBkcmFnRW5kO1xuICAgIC8vIElFJ3MgYXBwcm9hY2ggdG8gZHJhZ2dhYmxlXG4gICAgaWYgKGRpc3BsYXkuc2Nyb2xsZXIuZHJhZ0Ryb3ApIGRpc3BsYXkuc2Nyb2xsZXIuZHJhZ0Ryb3AoKTtcbiAgICBvbihkb2N1bWVudCwgXCJtb3VzZXVwXCIsIGRyYWdFbmQpO1xuICAgIG9uKGRpc3BsYXkuc2Nyb2xsZXIsIFwiZHJvcFwiLCBkcmFnRW5kKTtcbiAgfVxuXG4gIC8vIE5vcm1hbCBzZWxlY3Rpb24sIGFzIG9wcG9zZWQgdG8gdGV4dCBkcmFnZ2luZy5cbiAgZnVuY3Rpb24gbGVmdEJ1dHRvblNlbGVjdChjbSwgZSwgc3RhcnQsIHR5cGUsIGFkZE5ldykge1xuICAgIHZhciBkaXNwbGF5ID0gY20uZGlzcGxheSwgZG9jID0gY20uZG9jO1xuICAgIGVfcHJldmVudERlZmF1bHQoZSk7XG5cbiAgICB2YXIgb3VyUmFuZ2UsIG91ckluZGV4LCBzdGFydFNlbCA9IGRvYy5zZWwsIHJhbmdlcyA9IHN0YXJ0U2VsLnJhbmdlcztcbiAgICBpZiAoYWRkTmV3ICYmICFlLnNoaWZ0S2V5KSB7XG4gICAgICBvdXJJbmRleCA9IGRvYy5zZWwuY29udGFpbnMoc3RhcnQpO1xuICAgICAgaWYgKG91ckluZGV4ID4gLTEpXG4gICAgICAgIG91clJhbmdlID0gcmFuZ2VzW291ckluZGV4XTtcbiAgICAgIGVsc2VcbiAgICAgICAgb3VyUmFuZ2UgPSBuZXcgUmFuZ2Uoc3RhcnQsIHN0YXJ0KTtcbiAgICB9IGVsc2Uge1xuICAgICAgb3VyUmFuZ2UgPSBkb2Muc2VsLnByaW1hcnkoKTtcbiAgICAgIG91ckluZGV4ID0gZG9jLnNlbC5wcmltSW5kZXg7XG4gICAgfVxuXG4gICAgaWYgKGUuYWx0S2V5KSB7XG4gICAgICB0eXBlID0gXCJyZWN0XCI7XG4gICAgICBpZiAoIWFkZE5ldykgb3VyUmFuZ2UgPSBuZXcgUmFuZ2Uoc3RhcnQsIHN0YXJ0KTtcbiAgICAgIHN0YXJ0ID0gcG9zRnJvbU1vdXNlKGNtLCBlLCB0cnVlLCB0cnVlKTtcbiAgICAgIG91ckluZGV4ID0gLTE7XG4gICAgfSBlbHNlIGlmICh0eXBlID09IFwiZG91YmxlXCIpIHtcbiAgICAgIHZhciB3b3JkID0gY20uZmluZFdvcmRBdChzdGFydCk7XG4gICAgICBpZiAoY20uZGlzcGxheS5zaGlmdCB8fCBkb2MuZXh0ZW5kKVxuICAgICAgICBvdXJSYW5nZSA9IGV4dGVuZFJhbmdlKGRvYywgb3VyUmFuZ2UsIHdvcmQuYW5jaG9yLCB3b3JkLmhlYWQpO1xuICAgICAgZWxzZVxuICAgICAgICBvdXJSYW5nZSA9IHdvcmQ7XG4gICAgfSBlbHNlIGlmICh0eXBlID09IFwidHJpcGxlXCIpIHtcbiAgICAgIHZhciBsaW5lID0gbmV3IFJhbmdlKFBvcyhzdGFydC5saW5lLCAwKSwgY2xpcFBvcyhkb2MsIFBvcyhzdGFydC5saW5lICsgMSwgMCkpKTtcbiAgICAgIGlmIChjbS5kaXNwbGF5LnNoaWZ0IHx8IGRvYy5leHRlbmQpXG4gICAgICAgIG91clJhbmdlID0gZXh0ZW5kUmFuZ2UoZG9jLCBvdXJSYW5nZSwgbGluZS5hbmNob3IsIGxpbmUuaGVhZCk7XG4gICAgICBlbHNlXG4gICAgICAgIG91clJhbmdlID0gbGluZTtcbiAgICB9IGVsc2Uge1xuICAgICAgb3VyUmFuZ2UgPSBleHRlbmRSYW5nZShkb2MsIG91clJhbmdlLCBzdGFydCk7XG4gICAgfVxuXG4gICAgaWYgKCFhZGROZXcpIHtcbiAgICAgIG91ckluZGV4ID0gMDtcbiAgICAgIHNldFNlbGVjdGlvbihkb2MsIG5ldyBTZWxlY3Rpb24oW291clJhbmdlXSwgMCksIHNlbF9tb3VzZSk7XG4gICAgICBzdGFydFNlbCA9IGRvYy5zZWw7XG4gICAgfSBlbHNlIGlmIChvdXJJbmRleCA9PSAtMSkge1xuICAgICAgb3VySW5kZXggPSByYW5nZXMubGVuZ3RoO1xuICAgICAgc2V0U2VsZWN0aW9uKGRvYywgbm9ybWFsaXplU2VsZWN0aW9uKHJhbmdlcy5jb25jYXQoW291clJhbmdlXSksIG91ckluZGV4KSxcbiAgICAgICAgICAgICAgICAgICB7c2Nyb2xsOiBmYWxzZSwgb3JpZ2luOiBcIiptb3VzZVwifSk7XG4gICAgfSBlbHNlIGlmIChyYW5nZXMubGVuZ3RoID4gMSAmJiByYW5nZXNbb3VySW5kZXhdLmVtcHR5KCkgJiYgdHlwZSA9PSBcInNpbmdsZVwiICYmICFlLnNoaWZ0S2V5KSB7XG4gICAgICBzZXRTZWxlY3Rpb24oZG9jLCBub3JtYWxpemVTZWxlY3Rpb24ocmFuZ2VzLnNsaWNlKDAsIG91ckluZGV4KS5jb25jYXQocmFuZ2VzLnNsaWNlKG91ckluZGV4ICsgMSkpLCAwKSk7XG4gICAgICBzdGFydFNlbCA9IGRvYy5zZWw7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlcGxhY2VPbmVTZWxlY3Rpb24oZG9jLCBvdXJJbmRleCwgb3VyUmFuZ2UsIHNlbF9tb3VzZSk7XG4gICAgfVxuXG4gICAgdmFyIGxhc3RQb3MgPSBzdGFydDtcbiAgICBmdW5jdGlvbiBleHRlbmRUbyhwb3MpIHtcbiAgICAgIGlmIChjbXAobGFzdFBvcywgcG9zKSA9PSAwKSByZXR1cm47XG4gICAgICBsYXN0UG9zID0gcG9zO1xuXG4gICAgICBpZiAodHlwZSA9PSBcInJlY3RcIikge1xuICAgICAgICB2YXIgcmFuZ2VzID0gW10sIHRhYlNpemUgPSBjbS5vcHRpb25zLnRhYlNpemU7XG4gICAgICAgIHZhciBzdGFydENvbCA9IGNvdW50Q29sdW1uKGdldExpbmUoZG9jLCBzdGFydC5saW5lKS50ZXh0LCBzdGFydC5jaCwgdGFiU2l6ZSk7XG4gICAgICAgIHZhciBwb3NDb2wgPSBjb3VudENvbHVtbihnZXRMaW5lKGRvYywgcG9zLmxpbmUpLnRleHQsIHBvcy5jaCwgdGFiU2l6ZSk7XG4gICAgICAgIHZhciBsZWZ0ID0gTWF0aC5taW4oc3RhcnRDb2wsIHBvc0NvbCksIHJpZ2h0ID0gTWF0aC5tYXgoc3RhcnRDb2wsIHBvc0NvbCk7XG4gICAgICAgIGZvciAodmFyIGxpbmUgPSBNYXRoLm1pbihzdGFydC5saW5lLCBwb3MubGluZSksIGVuZCA9IE1hdGgubWluKGNtLmxhc3RMaW5lKCksIE1hdGgubWF4KHN0YXJ0LmxpbmUsIHBvcy5saW5lKSk7XG4gICAgICAgICAgICAgbGluZSA8PSBlbmQ7IGxpbmUrKykge1xuICAgICAgICAgIHZhciB0ZXh0ID0gZ2V0TGluZShkb2MsIGxpbmUpLnRleHQsIGxlZnRQb3MgPSBmaW5kQ29sdW1uKHRleHQsIGxlZnQsIHRhYlNpemUpO1xuICAgICAgICAgIGlmIChsZWZ0ID09IHJpZ2h0KVxuICAgICAgICAgICAgcmFuZ2VzLnB1c2gobmV3IFJhbmdlKFBvcyhsaW5lLCBsZWZ0UG9zKSwgUG9zKGxpbmUsIGxlZnRQb3MpKSk7XG4gICAgICAgICAgZWxzZSBpZiAodGV4dC5sZW5ndGggPiBsZWZ0UG9zKVxuICAgICAgICAgICAgcmFuZ2VzLnB1c2gobmV3IFJhbmdlKFBvcyhsaW5lLCBsZWZ0UG9zKSwgUG9zKGxpbmUsIGZpbmRDb2x1bW4odGV4dCwgcmlnaHQsIHRhYlNpemUpKSkpO1xuICAgICAgICB9XG4gICAgICAgIGlmICghcmFuZ2VzLmxlbmd0aCkgcmFuZ2VzLnB1c2gobmV3IFJhbmdlKHN0YXJ0LCBzdGFydCkpO1xuICAgICAgICBzZXRTZWxlY3Rpb24oZG9jLCBub3JtYWxpemVTZWxlY3Rpb24oc3RhcnRTZWwucmFuZ2VzLnNsaWNlKDAsIG91ckluZGV4KS5jb25jYXQocmFuZ2VzKSwgb3VySW5kZXgpLFxuICAgICAgICAgICAgICAgICAgICAge29yaWdpbjogXCIqbW91c2VcIiwgc2Nyb2xsOiBmYWxzZX0pO1xuICAgICAgICBjbS5zY3JvbGxJbnRvVmlldyhwb3MpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdmFyIG9sZFJhbmdlID0gb3VyUmFuZ2U7XG4gICAgICAgIHZhciBhbmNob3IgPSBvbGRSYW5nZS5hbmNob3IsIGhlYWQgPSBwb3M7XG4gICAgICAgIGlmICh0eXBlICE9IFwic2luZ2xlXCIpIHtcbiAgICAgICAgICBpZiAodHlwZSA9PSBcImRvdWJsZVwiKVxuICAgICAgICAgICAgdmFyIHJhbmdlID0gY20uZmluZFdvcmRBdChwb3MpO1xuICAgICAgICAgIGVsc2VcbiAgICAgICAgICAgIHZhciByYW5nZSA9IG5ldyBSYW5nZShQb3MocG9zLmxpbmUsIDApLCBjbGlwUG9zKGRvYywgUG9zKHBvcy5saW5lICsgMSwgMCkpKTtcbiAgICAgICAgICBpZiAoY21wKHJhbmdlLmFuY2hvciwgYW5jaG9yKSA+IDApIHtcbiAgICAgICAgICAgIGhlYWQgPSByYW5nZS5oZWFkO1xuICAgICAgICAgICAgYW5jaG9yID0gbWluUG9zKG9sZFJhbmdlLmZyb20oKSwgcmFuZ2UuYW5jaG9yKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgaGVhZCA9IHJhbmdlLmFuY2hvcjtcbiAgICAgICAgICAgIGFuY2hvciA9IG1heFBvcyhvbGRSYW5nZS50bygpLCByYW5nZS5oZWFkKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHJhbmdlcyA9IHN0YXJ0U2VsLnJhbmdlcy5zbGljZSgwKTtcbiAgICAgICAgcmFuZ2VzW291ckluZGV4XSA9IG5ldyBSYW5nZShjbGlwUG9zKGRvYywgYW5jaG9yKSwgaGVhZCk7XG4gICAgICAgIHNldFNlbGVjdGlvbihkb2MsIG5vcm1hbGl6ZVNlbGVjdGlvbihyYW5nZXMsIG91ckluZGV4KSwgc2VsX21vdXNlKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICB2YXIgZWRpdG9yU2l6ZSA9IGRpc3BsYXkud3JhcHBlci5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICAvLyBVc2VkIHRvIGVuc3VyZSB0aW1lb3V0IHJlLXRyaWVzIGRvbid0IGZpcmUgd2hlbiBhbm90aGVyIGV4dGVuZFxuICAgIC8vIGhhcHBlbmVkIGluIHRoZSBtZWFudGltZSAoY2xlYXJUaW1lb3V0IGlzbid0IHJlbGlhYmxlIC0tIGF0XG4gICAgLy8gbGVhc3Qgb24gQ2hyb21lLCB0aGUgdGltZW91dHMgc3RpbGwgaGFwcGVuIGV2ZW4gd2hlbiBjbGVhcmVkLFxuICAgIC8vIGlmIHRoZSBjbGVhciBoYXBwZW5zIGFmdGVyIHRoZWlyIHNjaGVkdWxlZCBmaXJpbmcgdGltZSkuXG4gICAgdmFyIGNvdW50ZXIgPSAwO1xuXG4gICAgZnVuY3Rpb24gZXh0ZW5kKGUpIHtcbiAgICAgIHZhciBjdXJDb3VudCA9ICsrY291bnRlcjtcbiAgICAgIHZhciBjdXIgPSBwb3NGcm9tTW91c2UoY20sIGUsIHRydWUsIHR5cGUgPT0gXCJyZWN0XCIpO1xuICAgICAgaWYgKCFjdXIpIHJldHVybjtcbiAgICAgIGlmIChjbXAoY3VyLCBsYXN0UG9zKSAhPSAwKSB7XG4gICAgICAgIGNtLmN1ck9wLmZvY3VzID0gYWN0aXZlRWx0KCk7XG4gICAgICAgIGV4dGVuZFRvKGN1cik7XG4gICAgICAgIHZhciB2aXNpYmxlID0gdmlzaWJsZUxpbmVzKGRpc3BsYXksIGRvYyk7XG4gICAgICAgIGlmIChjdXIubGluZSA+PSB2aXNpYmxlLnRvIHx8IGN1ci5saW5lIDwgdmlzaWJsZS5mcm9tKVxuICAgICAgICAgIHNldFRpbWVvdXQob3BlcmF0aW9uKGNtLCBmdW5jdGlvbigpe2lmIChjb3VudGVyID09IGN1ckNvdW50KSBleHRlbmQoZSk7fSksIDE1MCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB2YXIgb3V0c2lkZSA9IGUuY2xpZW50WSA8IGVkaXRvclNpemUudG9wID8gLTIwIDogZS5jbGllbnRZID4gZWRpdG9yU2l6ZS5ib3R0b20gPyAyMCA6IDA7XG4gICAgICAgIGlmIChvdXRzaWRlKSBzZXRUaW1lb3V0KG9wZXJhdGlvbihjbSwgZnVuY3Rpb24oKSB7XG4gICAgICAgICAgaWYgKGNvdW50ZXIgIT0gY3VyQ291bnQpIHJldHVybjtcbiAgICAgICAgICBkaXNwbGF5LnNjcm9sbGVyLnNjcm9sbFRvcCArPSBvdXRzaWRlO1xuICAgICAgICAgIGV4dGVuZChlKTtcbiAgICAgICAgfSksIDUwKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmdW5jdGlvbiBkb25lKGUpIHtcbiAgICAgIGNvdW50ZXIgPSBJbmZpbml0eTtcbiAgICAgIGVfcHJldmVudERlZmF1bHQoZSk7XG4gICAgICBkaXNwbGF5LmlucHV0LmZvY3VzKCk7XG4gICAgICBvZmYoZG9jdW1lbnQsIFwibW91c2Vtb3ZlXCIsIG1vdmUpO1xuICAgICAgb2ZmKGRvY3VtZW50LCBcIm1vdXNldXBcIiwgdXApO1xuICAgICAgZG9jLmhpc3RvcnkubGFzdFNlbE9yaWdpbiA9IG51bGw7XG4gICAgfVxuXG4gICAgdmFyIG1vdmUgPSBvcGVyYXRpb24oY20sIGZ1bmN0aW9uKGUpIHtcbiAgICAgIGlmICghZV9idXR0b24oZSkpIGRvbmUoZSk7XG4gICAgICBlbHNlIGV4dGVuZChlKTtcbiAgICB9KTtcbiAgICB2YXIgdXAgPSBvcGVyYXRpb24oY20sIGRvbmUpO1xuICAgIG9uKGRvY3VtZW50LCBcIm1vdXNlbW92ZVwiLCBtb3ZlKTtcbiAgICBvbihkb2N1bWVudCwgXCJtb3VzZXVwXCIsIHVwKTtcbiAgfVxuXG4gIC8vIERldGVybWluZXMgd2hldGhlciBhbiBldmVudCBoYXBwZW5lZCBpbiB0aGUgZ3V0dGVyLCBhbmQgZmlyZXMgdGhlXG4gIC8vIGhhbmRsZXJzIGZvciB0aGUgY29ycmVzcG9uZGluZyBldmVudC5cbiAgZnVuY3Rpb24gZ3V0dGVyRXZlbnQoY20sIGUsIHR5cGUsIHByZXZlbnQsIHNpZ25hbGZuKSB7XG4gICAgdHJ5IHsgdmFyIG1YID0gZS5jbGllbnRYLCBtWSA9IGUuY2xpZW50WTsgfVxuICAgIGNhdGNoKGUpIHsgcmV0dXJuIGZhbHNlOyB9XG4gICAgaWYgKG1YID49IE1hdGguZmxvb3IoY20uZGlzcGxheS5ndXR0ZXJzLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpLnJpZ2h0KSkgcmV0dXJuIGZhbHNlO1xuICAgIGlmIChwcmV2ZW50KSBlX3ByZXZlbnREZWZhdWx0KGUpO1xuXG4gICAgdmFyIGRpc3BsYXkgPSBjbS5kaXNwbGF5O1xuICAgIHZhciBsaW5lQm94ID0gZGlzcGxheS5saW5lRGl2LmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuXG4gICAgaWYgKG1ZID4gbGluZUJveC5ib3R0b20gfHwgIWhhc0hhbmRsZXIoY20sIHR5cGUpKSByZXR1cm4gZV9kZWZhdWx0UHJldmVudGVkKGUpO1xuICAgIG1ZIC09IGxpbmVCb3gudG9wIC0gZGlzcGxheS52aWV3T2Zmc2V0O1xuXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBjbS5vcHRpb25zLmd1dHRlcnMubGVuZ3RoOyArK2kpIHtcbiAgICAgIHZhciBnID0gZGlzcGxheS5ndXR0ZXJzLmNoaWxkTm9kZXNbaV07XG4gICAgICBpZiAoZyAmJiBnLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpLnJpZ2h0ID49IG1YKSB7XG4gICAgICAgIHZhciBsaW5lID0gbGluZUF0SGVpZ2h0KGNtLmRvYywgbVkpO1xuICAgICAgICB2YXIgZ3V0dGVyID0gY20ub3B0aW9ucy5ndXR0ZXJzW2ldO1xuICAgICAgICBzaWduYWxmbihjbSwgdHlwZSwgY20sIGxpbmUsIGd1dHRlciwgZSk7XG4gICAgICAgIHJldHVybiBlX2RlZmF1bHRQcmV2ZW50ZWQoZSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gY2xpY2tJbkd1dHRlcihjbSwgZSkge1xuICAgIHJldHVybiBndXR0ZXJFdmVudChjbSwgZSwgXCJndXR0ZXJDbGlja1wiLCB0cnVlLCBzaWduYWxMYXRlcik7XG4gIH1cblxuICAvLyBLbHVkZ2UgdG8gd29yayBhcm91bmQgc3RyYW5nZSBJRSBiZWhhdmlvciB3aGVyZSBpdCdsbCBzb21ldGltZXNcbiAgLy8gcmUtZmlyZSBhIHNlcmllcyBvZiBkcmFnLXJlbGF0ZWQgZXZlbnRzIHJpZ2h0IGFmdGVyIHRoZSBkcm9wICgjMTU1MSlcbiAgdmFyIGxhc3REcm9wID0gMDtcblxuICBmdW5jdGlvbiBvbkRyb3AoZSkge1xuICAgIHZhciBjbSA9IHRoaXM7XG4gICAgaWYgKHNpZ25hbERPTUV2ZW50KGNtLCBlKSB8fCBldmVudEluV2lkZ2V0KGNtLmRpc3BsYXksIGUpKVxuICAgICAgcmV0dXJuO1xuICAgIGVfcHJldmVudERlZmF1bHQoZSk7XG4gICAgaWYgKGllKSBsYXN0RHJvcCA9ICtuZXcgRGF0ZTtcbiAgICB2YXIgcG9zID0gcG9zRnJvbU1vdXNlKGNtLCBlLCB0cnVlKSwgZmlsZXMgPSBlLmRhdGFUcmFuc2Zlci5maWxlcztcbiAgICBpZiAoIXBvcyB8fCBpc1JlYWRPbmx5KGNtKSkgcmV0dXJuO1xuICAgIC8vIE1pZ2h0IGJlIGEgZmlsZSBkcm9wLCBpbiB3aGljaCBjYXNlIHdlIHNpbXBseSBleHRyYWN0IHRoZSB0ZXh0XG4gICAgLy8gYW5kIGluc2VydCBpdC5cbiAgICBpZiAoZmlsZXMgJiYgZmlsZXMubGVuZ3RoICYmIHdpbmRvdy5GaWxlUmVhZGVyICYmIHdpbmRvdy5GaWxlKSB7XG4gICAgICB2YXIgbiA9IGZpbGVzLmxlbmd0aCwgdGV4dCA9IEFycmF5KG4pLCByZWFkID0gMDtcbiAgICAgIHZhciBsb2FkRmlsZSA9IGZ1bmN0aW9uKGZpbGUsIGkpIHtcbiAgICAgICAgdmFyIHJlYWRlciA9IG5ldyBGaWxlUmVhZGVyO1xuICAgICAgICByZWFkZXIub25sb2FkID0gb3BlcmF0aW9uKGNtLCBmdW5jdGlvbigpIHtcbiAgICAgICAgICB0ZXh0W2ldID0gcmVhZGVyLnJlc3VsdDtcbiAgICAgICAgICBpZiAoKytyZWFkID09IG4pIHtcbiAgICAgICAgICAgIHBvcyA9IGNsaXBQb3MoY20uZG9jLCBwb3MpO1xuICAgICAgICAgICAgdmFyIGNoYW5nZSA9IHtmcm9tOiBwb3MsIHRvOiBwb3MsIHRleHQ6IHNwbGl0TGluZXModGV4dC5qb2luKFwiXFxuXCIpKSwgb3JpZ2luOiBcInBhc3RlXCJ9O1xuICAgICAgICAgICAgbWFrZUNoYW5nZShjbS5kb2MsIGNoYW5nZSk7XG4gICAgICAgICAgICBzZXRTZWxlY3Rpb25SZXBsYWNlSGlzdG9yeShjbS5kb2MsIHNpbXBsZVNlbGVjdGlvbihwb3MsIGNoYW5nZUVuZChjaGFuZ2UpKSk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgcmVhZGVyLnJlYWRBc1RleHQoZmlsZSk7XG4gICAgICB9O1xuICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBuOyArK2kpIGxvYWRGaWxlKGZpbGVzW2ldLCBpKTtcbiAgICB9IGVsc2UgeyAvLyBOb3JtYWwgZHJvcFxuICAgICAgLy8gRG9uJ3QgZG8gYSByZXBsYWNlIGlmIHRoZSBkcm9wIGhhcHBlbmVkIGluc2lkZSBvZiB0aGUgc2VsZWN0ZWQgdGV4dC5cbiAgICAgIGlmIChjbS5zdGF0ZS5kcmFnZ2luZ1RleHQgJiYgY20uZG9jLnNlbC5jb250YWlucyhwb3MpID4gLTEpIHtcbiAgICAgICAgY20uc3RhdGUuZHJhZ2dpbmdUZXh0KGUpO1xuICAgICAgICAvLyBFbnN1cmUgdGhlIGVkaXRvciBpcyByZS1mb2N1c2VkXG4gICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7Y20uZGlzcGxheS5pbnB1dC5mb2N1cygpO30sIDIwKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgdHJ5IHtcbiAgICAgICAgdmFyIHRleHQgPSBlLmRhdGFUcmFuc2Zlci5nZXREYXRhKFwiVGV4dFwiKTtcbiAgICAgICAgaWYgKHRleHQpIHtcbiAgICAgICAgICBpZiAoY20uc3RhdGUuZHJhZ2dpbmdUZXh0ICYmICEobWFjID8gZS5hbHRLZXkgOiBlLmN0cmxLZXkpKVxuICAgICAgICAgICAgdmFyIHNlbGVjdGVkID0gY20ubGlzdFNlbGVjdGlvbnMoKTtcbiAgICAgICAgICBzZXRTZWxlY3Rpb25Ob1VuZG8oY20uZG9jLCBzaW1wbGVTZWxlY3Rpb24ocG9zLCBwb3MpKTtcbiAgICAgICAgICBpZiAoc2VsZWN0ZWQpIGZvciAodmFyIGkgPSAwOyBpIDwgc2VsZWN0ZWQubGVuZ3RoOyArK2kpXG4gICAgICAgICAgICByZXBsYWNlUmFuZ2UoY20uZG9jLCBcIlwiLCBzZWxlY3RlZFtpXS5hbmNob3IsIHNlbGVjdGVkW2ldLmhlYWQsIFwiZHJhZ1wiKTtcbiAgICAgICAgICBjbS5yZXBsYWNlU2VsZWN0aW9uKHRleHQsIFwiYXJvdW5kXCIsIFwicGFzdGVcIik7XG4gICAgICAgICAgY20uZGlzcGxheS5pbnB1dC5mb2N1cygpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBjYXRjaChlKXt9XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gb25EcmFnU3RhcnQoY20sIGUpIHtcbiAgICBpZiAoaWUgJiYgKCFjbS5zdGF0ZS5kcmFnZ2luZ1RleHQgfHwgK25ldyBEYXRlIC0gbGFzdERyb3AgPCAxMDApKSB7IGVfc3RvcChlKTsgcmV0dXJuOyB9XG4gICAgaWYgKHNpZ25hbERPTUV2ZW50KGNtLCBlKSB8fCBldmVudEluV2lkZ2V0KGNtLmRpc3BsYXksIGUpKSByZXR1cm47XG5cbiAgICBlLmRhdGFUcmFuc2Zlci5zZXREYXRhKFwiVGV4dFwiLCBjbS5nZXRTZWxlY3Rpb24oKSk7XG5cbiAgICAvLyBVc2UgZHVtbXkgaW1hZ2UgaW5zdGVhZCBvZiBkZWZhdWx0IGJyb3dzZXJzIGltYWdlLlxuICAgIC8vIFJlY2VudCBTYWZhcmkgKH42LjAuMikgaGF2ZSBhIHRlbmRlbmN5IHRvIHNlZ2ZhdWx0IHdoZW4gdGhpcyBoYXBwZW5zLCBzbyB3ZSBkb24ndCBkbyBpdCB0aGVyZS5cbiAgICBpZiAoZS5kYXRhVHJhbnNmZXIuc2V0RHJhZ0ltYWdlICYmICFzYWZhcmkpIHtcbiAgICAgIHZhciBpbWcgPSBlbHQoXCJpbWdcIiwgbnVsbCwgbnVsbCwgXCJwb3NpdGlvbjogZml4ZWQ7IGxlZnQ6IDA7IHRvcDogMDtcIik7XG4gICAgICBpbWcuc3JjID0gXCJkYXRhOmltYWdlL2dpZjtiYXNlNjQsUjBsR09EbGhBUUFCQUFBQUFDSDVCQUVLQUFFQUxBQUFBQUFCQUFFQUFBSUNUQUVBT3c9PVwiO1xuICAgICAgaWYgKHByZXN0bykge1xuICAgICAgICBpbWcud2lkdGggPSBpbWcuaGVpZ2h0ID0gMTtcbiAgICAgICAgY20uZGlzcGxheS53cmFwcGVyLmFwcGVuZENoaWxkKGltZyk7XG4gICAgICAgIC8vIEZvcmNlIGEgcmVsYXlvdXQsIG9yIE9wZXJhIHdvbid0IHVzZSBvdXIgaW1hZ2UgZm9yIHNvbWUgb2JzY3VyZSByZWFzb25cbiAgICAgICAgaW1nLl90b3AgPSBpbWcub2Zmc2V0VG9wO1xuICAgICAgfVxuICAgICAgZS5kYXRhVHJhbnNmZXIuc2V0RHJhZ0ltYWdlKGltZywgMCwgMCk7XG4gICAgICBpZiAocHJlc3RvKSBpbWcucGFyZW50Tm9kZS5yZW1vdmVDaGlsZChpbWcpO1xuICAgIH1cbiAgfVxuXG4gIC8vIFNDUk9MTCBFVkVOVFNcblxuICAvLyBTeW5jIHRoZSBzY3JvbGxhYmxlIGFyZWEgYW5kIHNjcm9sbGJhcnMsIGVuc3VyZSB0aGUgdmlld3BvcnRcbiAgLy8gY292ZXJzIHRoZSB2aXNpYmxlIGFyZWEuXG4gIGZ1bmN0aW9uIHNldFNjcm9sbFRvcChjbSwgdmFsKSB7XG4gICAgaWYgKE1hdGguYWJzKGNtLmRvYy5zY3JvbGxUb3AgLSB2YWwpIDwgMikgcmV0dXJuO1xuICAgIGNtLmRvYy5zY3JvbGxUb3AgPSB2YWw7XG4gICAgaWYgKCFnZWNrbykgdXBkYXRlRGlzcGxheVNpbXBsZShjbSwge3RvcDogdmFsfSk7XG4gICAgaWYgKGNtLmRpc3BsYXkuc2Nyb2xsZXIuc2Nyb2xsVG9wICE9IHZhbCkgY20uZGlzcGxheS5zY3JvbGxlci5zY3JvbGxUb3AgPSB2YWw7XG4gICAgY20uZGlzcGxheS5zY3JvbGxiYXJzLnNldFNjcm9sbFRvcCh2YWwpO1xuICAgIGlmIChnZWNrbykgdXBkYXRlRGlzcGxheVNpbXBsZShjbSk7XG4gICAgc3RhcnRXb3JrZXIoY20sIDEwMCk7XG4gIH1cbiAgLy8gU3luYyBzY3JvbGxlciBhbmQgc2Nyb2xsYmFyLCBlbnN1cmUgdGhlIGd1dHRlciBlbGVtZW50cyBhcmVcbiAgLy8gYWxpZ25lZC5cbiAgZnVuY3Rpb24gc2V0U2Nyb2xsTGVmdChjbSwgdmFsLCBpc1Njcm9sbGVyKSB7XG4gICAgaWYgKGlzU2Nyb2xsZXIgPyB2YWwgPT0gY20uZG9jLnNjcm9sbExlZnQgOiBNYXRoLmFicyhjbS5kb2Muc2Nyb2xsTGVmdCAtIHZhbCkgPCAyKSByZXR1cm47XG4gICAgdmFsID0gTWF0aC5taW4odmFsLCBjbS5kaXNwbGF5LnNjcm9sbGVyLnNjcm9sbFdpZHRoIC0gY20uZGlzcGxheS5zY3JvbGxlci5jbGllbnRXaWR0aCk7XG4gICAgY20uZG9jLnNjcm9sbExlZnQgPSB2YWw7XG4gICAgYWxpZ25Ib3Jpem9udGFsbHkoY20pO1xuICAgIGlmIChjbS5kaXNwbGF5LnNjcm9sbGVyLnNjcm9sbExlZnQgIT0gdmFsKSBjbS5kaXNwbGF5LnNjcm9sbGVyLnNjcm9sbExlZnQgPSB2YWw7XG4gICAgY20uZGlzcGxheS5zY3JvbGxiYXJzLnNldFNjcm9sbExlZnQodmFsKTtcbiAgfVxuXG4gIC8vIFNpbmNlIHRoZSBkZWx0YSB2YWx1ZXMgcmVwb3J0ZWQgb24gbW91c2Ugd2hlZWwgZXZlbnRzIGFyZVxuICAvLyB1bnN0YW5kYXJkaXplZCBiZXR3ZWVuIGJyb3dzZXJzIGFuZCBldmVuIGJyb3dzZXIgdmVyc2lvbnMsIGFuZFxuICAvLyBnZW5lcmFsbHkgaG9ycmlibHkgdW5wcmVkaWN0YWJsZSwgdGhpcyBjb2RlIHN0YXJ0cyBieSBtZWFzdXJpbmdcbiAgLy8gdGhlIHNjcm9sbCBlZmZlY3QgdGhhdCB0aGUgZmlyc3QgZmV3IG1vdXNlIHdoZWVsIGV2ZW50cyBoYXZlLFxuICAvLyBhbmQsIGZyb20gdGhhdCwgZGV0ZWN0cyB0aGUgd2F5IGl0IGNhbiBjb252ZXJ0IGRlbHRhcyB0byBwaXhlbFxuICAvLyBvZmZzZXRzIGFmdGVyd2FyZHMuXG4gIC8vXG4gIC8vIFRoZSByZWFzb24gd2Ugd2FudCB0byBrbm93IHRoZSBhbW91bnQgYSB3aGVlbCBldmVudCB3aWxsIHNjcm9sbFxuICAvLyBpcyB0aGF0IGl0IGdpdmVzIHVzIGEgY2hhbmNlIHRvIHVwZGF0ZSB0aGUgZGlzcGxheSBiZWZvcmUgdGhlXG4gIC8vIGFjdHVhbCBzY3JvbGxpbmcgaGFwcGVucywgcmVkdWNpbmcgZmxpY2tlcmluZy5cblxuICB2YXIgd2hlZWxTYW1wbGVzID0gMCwgd2hlZWxQaXhlbHNQZXJVbml0ID0gbnVsbDtcbiAgLy8gRmlsbCBpbiBhIGJyb3dzZXItZGV0ZWN0ZWQgc3RhcnRpbmcgdmFsdWUgb24gYnJvd3NlcnMgd2hlcmUgd2VcbiAgLy8ga25vdyBvbmUuIFRoZXNlIGRvbid0IGhhdmUgdG8gYmUgYWNjdXJhdGUgLS0gdGhlIHJlc3VsdCBvZiB0aGVtXG4gIC8vIGJlaW5nIHdyb25nIHdvdWxkIGp1c3QgYmUgYSBzbGlnaHQgZmxpY2tlciBvbiB0aGUgZmlyc3Qgd2hlZWxcbiAgLy8gc2Nyb2xsIChpZiBpdCBpcyBsYXJnZSBlbm91Z2gpLlxuICBpZiAoaWUpIHdoZWVsUGl4ZWxzUGVyVW5pdCA9IC0uNTM7XG4gIGVsc2UgaWYgKGdlY2tvKSB3aGVlbFBpeGVsc1BlclVuaXQgPSAxNTtcbiAgZWxzZSBpZiAoY2hyb21lKSB3aGVlbFBpeGVsc1BlclVuaXQgPSAtLjc7XG4gIGVsc2UgaWYgKHNhZmFyaSkgd2hlZWxQaXhlbHNQZXJVbml0ID0gLTEvMztcblxuICB2YXIgd2hlZWxFdmVudERlbHRhID0gZnVuY3Rpb24oZSkge1xuICAgIHZhciBkeCA9IGUud2hlZWxEZWx0YVgsIGR5ID0gZS53aGVlbERlbHRhWTtcbiAgICBpZiAoZHggPT0gbnVsbCAmJiBlLmRldGFpbCAmJiBlLmF4aXMgPT0gZS5IT1JJWk9OVEFMX0FYSVMpIGR4ID0gZS5kZXRhaWw7XG4gICAgaWYgKGR5ID09IG51bGwgJiYgZS5kZXRhaWwgJiYgZS5heGlzID09IGUuVkVSVElDQUxfQVhJUykgZHkgPSBlLmRldGFpbDtcbiAgICBlbHNlIGlmIChkeSA9PSBudWxsKSBkeSA9IGUud2hlZWxEZWx0YTtcbiAgICByZXR1cm4ge3g6IGR4LCB5OiBkeX07XG4gIH07XG4gIENvZGVNaXJyb3Iud2hlZWxFdmVudFBpeGVscyA9IGZ1bmN0aW9uKGUpIHtcbiAgICB2YXIgZGVsdGEgPSB3aGVlbEV2ZW50RGVsdGEoZSk7XG4gICAgZGVsdGEueCAqPSB3aGVlbFBpeGVsc1BlclVuaXQ7XG4gICAgZGVsdGEueSAqPSB3aGVlbFBpeGVsc1BlclVuaXQ7XG4gICAgcmV0dXJuIGRlbHRhO1xuICB9O1xuXG4gIGZ1bmN0aW9uIG9uU2Nyb2xsV2hlZWwoY20sIGUpIHtcbiAgICB2YXIgZGVsdGEgPSB3aGVlbEV2ZW50RGVsdGEoZSksIGR4ID0gZGVsdGEueCwgZHkgPSBkZWx0YS55O1xuXG4gICAgdmFyIGRpc3BsYXkgPSBjbS5kaXNwbGF5LCBzY3JvbGwgPSBkaXNwbGF5LnNjcm9sbGVyO1xuICAgIC8vIFF1aXQgaWYgdGhlcmUncyBub3RoaW5nIHRvIHNjcm9sbCBoZXJlXG4gICAgaWYgKCEoZHggJiYgc2Nyb2xsLnNjcm9sbFdpZHRoID4gc2Nyb2xsLmNsaWVudFdpZHRoIHx8XG4gICAgICAgICAgZHkgJiYgc2Nyb2xsLnNjcm9sbEhlaWdodCA+IHNjcm9sbC5jbGllbnRIZWlnaHQpKSByZXR1cm47XG5cbiAgICAvLyBXZWJraXQgYnJvd3NlcnMgb24gT1MgWCBhYm9ydCBtb21lbnR1bSBzY3JvbGxzIHdoZW4gdGhlIHRhcmdldFxuICAgIC8vIG9mIHRoZSBzY3JvbGwgZXZlbnQgaXMgcmVtb3ZlZCBmcm9tIHRoZSBzY3JvbGxhYmxlIGVsZW1lbnQuXG4gICAgLy8gVGhpcyBoYWNrIChzZWUgcmVsYXRlZCBjb2RlIGluIHBhdGNoRGlzcGxheSkgbWFrZXMgc3VyZSB0aGVcbiAgICAvLyBlbGVtZW50IGlzIGtlcHQgYXJvdW5kLlxuICAgIGlmIChkeSAmJiBtYWMgJiYgd2Via2l0KSB7XG4gICAgICBvdXRlcjogZm9yICh2YXIgY3VyID0gZS50YXJnZXQsIHZpZXcgPSBkaXNwbGF5LnZpZXc7IGN1ciAhPSBzY3JvbGw7IGN1ciA9IGN1ci5wYXJlbnROb2RlKSB7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgdmlldy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgIGlmICh2aWV3W2ldLm5vZGUgPT0gY3VyKSB7XG4gICAgICAgICAgICBjbS5kaXNwbGF5LmN1cnJlbnRXaGVlbFRhcmdldCA9IGN1cjtcbiAgICAgICAgICAgIGJyZWFrIG91dGVyO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIE9uIHNvbWUgYnJvd3NlcnMsIGhvcml6b250YWwgc2Nyb2xsaW5nIHdpbGwgY2F1c2UgcmVkcmF3cyB0b1xuICAgIC8vIGhhcHBlbiBiZWZvcmUgdGhlIGd1dHRlciBoYXMgYmVlbiByZWFsaWduZWQsIGNhdXNpbmcgaXQgdG9cbiAgICAvLyB3cmlnZ2xlIGFyb3VuZCBpbiBhIG1vc3QgdW5zZWVtbHkgd2F5LiBXaGVuIHdlIGhhdmUgYW5cbiAgICAvLyBlc3RpbWF0ZWQgcGl4ZWxzL2RlbHRhIHZhbHVlLCB3ZSBqdXN0IGhhbmRsZSBob3Jpem9udGFsXG4gICAgLy8gc2Nyb2xsaW5nIGVudGlyZWx5IGhlcmUuIEl0J2xsIGJlIHNsaWdodGx5IG9mZiBmcm9tIG5hdGl2ZSwgYnV0XG4gICAgLy8gYmV0dGVyIHRoYW4gZ2xpdGNoaW5nIG91dC5cbiAgICBpZiAoZHggJiYgIWdlY2tvICYmICFwcmVzdG8gJiYgd2hlZWxQaXhlbHNQZXJVbml0ICE9IG51bGwpIHtcbiAgICAgIGlmIChkeSlcbiAgICAgICAgc2V0U2Nyb2xsVG9wKGNtLCBNYXRoLm1heCgwLCBNYXRoLm1pbihzY3JvbGwuc2Nyb2xsVG9wICsgZHkgKiB3aGVlbFBpeGVsc1BlclVuaXQsIHNjcm9sbC5zY3JvbGxIZWlnaHQgLSBzY3JvbGwuY2xpZW50SGVpZ2h0KSkpO1xuICAgICAgc2V0U2Nyb2xsTGVmdChjbSwgTWF0aC5tYXgoMCwgTWF0aC5taW4oc2Nyb2xsLnNjcm9sbExlZnQgKyBkeCAqIHdoZWVsUGl4ZWxzUGVyVW5pdCwgc2Nyb2xsLnNjcm9sbFdpZHRoIC0gc2Nyb2xsLmNsaWVudFdpZHRoKSkpO1xuICAgICAgZV9wcmV2ZW50RGVmYXVsdChlKTtcbiAgICAgIGRpc3BsYXkud2hlZWxTdGFydFggPSBudWxsOyAvLyBBYm9ydCBtZWFzdXJlbWVudCwgaWYgaW4gcHJvZ3Jlc3NcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyAnUHJvamVjdCcgdGhlIHZpc2libGUgdmlld3BvcnQgdG8gY292ZXIgdGhlIGFyZWEgdGhhdCBpcyBiZWluZ1xuICAgIC8vIHNjcm9sbGVkIGludG8gdmlldyAoaWYgd2Uga25vdyBlbm91Z2ggdG8gZXN0aW1hdGUgaXQpLlxuICAgIGlmIChkeSAmJiB3aGVlbFBpeGVsc1BlclVuaXQgIT0gbnVsbCkge1xuICAgICAgdmFyIHBpeGVscyA9IGR5ICogd2hlZWxQaXhlbHNQZXJVbml0O1xuICAgICAgdmFyIHRvcCA9IGNtLmRvYy5zY3JvbGxUb3AsIGJvdCA9IHRvcCArIGRpc3BsYXkud3JhcHBlci5jbGllbnRIZWlnaHQ7XG4gICAgICBpZiAocGl4ZWxzIDwgMCkgdG9wID0gTWF0aC5tYXgoMCwgdG9wICsgcGl4ZWxzIC0gNTApO1xuICAgICAgZWxzZSBib3QgPSBNYXRoLm1pbihjbS5kb2MuaGVpZ2h0LCBib3QgKyBwaXhlbHMgKyA1MCk7XG4gICAgICB1cGRhdGVEaXNwbGF5U2ltcGxlKGNtLCB7dG9wOiB0b3AsIGJvdHRvbTogYm90fSk7XG4gICAgfVxuXG4gICAgaWYgKHdoZWVsU2FtcGxlcyA8IDIwKSB7XG4gICAgICBpZiAoZGlzcGxheS53aGVlbFN0YXJ0WCA9PSBudWxsKSB7XG4gICAgICAgIGRpc3BsYXkud2hlZWxTdGFydFggPSBzY3JvbGwuc2Nyb2xsTGVmdDsgZGlzcGxheS53aGVlbFN0YXJ0WSA9IHNjcm9sbC5zY3JvbGxUb3A7XG4gICAgICAgIGRpc3BsYXkud2hlZWxEWCA9IGR4OyBkaXNwbGF5LndoZWVsRFkgPSBkeTtcbiAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgICAgICBpZiAoZGlzcGxheS53aGVlbFN0YXJ0WCA9PSBudWxsKSByZXR1cm47XG4gICAgICAgICAgdmFyIG1vdmVkWCA9IHNjcm9sbC5zY3JvbGxMZWZ0IC0gZGlzcGxheS53aGVlbFN0YXJ0WDtcbiAgICAgICAgICB2YXIgbW92ZWRZID0gc2Nyb2xsLnNjcm9sbFRvcCAtIGRpc3BsYXkud2hlZWxTdGFydFk7XG4gICAgICAgICAgdmFyIHNhbXBsZSA9IChtb3ZlZFkgJiYgZGlzcGxheS53aGVlbERZICYmIG1vdmVkWSAvIGRpc3BsYXkud2hlZWxEWSkgfHxcbiAgICAgICAgICAgIChtb3ZlZFggJiYgZGlzcGxheS53aGVlbERYICYmIG1vdmVkWCAvIGRpc3BsYXkud2hlZWxEWCk7XG4gICAgICAgICAgZGlzcGxheS53aGVlbFN0YXJ0WCA9IGRpc3BsYXkud2hlZWxTdGFydFkgPSBudWxsO1xuICAgICAgICAgIGlmICghc2FtcGxlKSByZXR1cm47XG4gICAgICAgICAgd2hlZWxQaXhlbHNQZXJVbml0ID0gKHdoZWVsUGl4ZWxzUGVyVW5pdCAqIHdoZWVsU2FtcGxlcyArIHNhbXBsZSkgLyAod2hlZWxTYW1wbGVzICsgMSk7XG4gICAgICAgICAgKyt3aGVlbFNhbXBsZXM7XG4gICAgICAgIH0sIDIwMCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBkaXNwbGF5LndoZWVsRFggKz0gZHg7IGRpc3BsYXkud2hlZWxEWSArPSBkeTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvLyBLRVkgRVZFTlRTXG5cbiAgLy8gUnVuIGEgaGFuZGxlciB0aGF0IHdhcyBib3VuZCB0byBhIGtleS5cbiAgZnVuY3Rpb24gZG9IYW5kbGVCaW5kaW5nKGNtLCBib3VuZCwgZHJvcFNoaWZ0KSB7XG4gICAgaWYgKHR5cGVvZiBib3VuZCA9PSBcInN0cmluZ1wiKSB7XG4gICAgICBib3VuZCA9IGNvbW1hbmRzW2JvdW5kXTtcbiAgICAgIGlmICghYm91bmQpIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgLy8gRW5zdXJlIHByZXZpb3VzIGlucHV0IGhhcyBiZWVuIHJlYWQsIHNvIHRoYXQgdGhlIGhhbmRsZXIgc2VlcyBhXG4gICAgLy8gY29uc2lzdGVudCB2aWV3IG9mIHRoZSBkb2N1bWVudFxuICAgIGNtLmRpc3BsYXkuaW5wdXQuZW5zdXJlUG9sbGVkKCk7XG4gICAgdmFyIHByZXZTaGlmdCA9IGNtLmRpc3BsYXkuc2hpZnQsIGRvbmUgPSBmYWxzZTtcbiAgICB0cnkge1xuICAgICAgaWYgKGlzUmVhZE9ubHkoY20pKSBjbS5zdGF0ZS5zdXBwcmVzc0VkaXRzID0gdHJ1ZTtcbiAgICAgIGlmIChkcm9wU2hpZnQpIGNtLmRpc3BsYXkuc2hpZnQgPSBmYWxzZTtcbiAgICAgIGRvbmUgPSBib3VuZChjbSkgIT0gUGFzcztcbiAgICB9IGZpbmFsbHkge1xuICAgICAgY20uZGlzcGxheS5zaGlmdCA9IHByZXZTaGlmdDtcbiAgICAgIGNtLnN0YXRlLnN1cHByZXNzRWRpdHMgPSBmYWxzZTtcbiAgICB9XG4gICAgcmV0dXJuIGRvbmU7XG4gIH1cblxuICBmdW5jdGlvbiBsb29rdXBLZXlGb3JFZGl0b3IoY20sIG5hbWUsIGhhbmRsZSkge1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgY20uc3RhdGUua2V5TWFwcy5sZW5ndGg7IGkrKykge1xuICAgICAgdmFyIHJlc3VsdCA9IGxvb2t1cEtleShuYW1lLCBjbS5zdGF0ZS5rZXlNYXBzW2ldLCBoYW5kbGUsIGNtKTtcbiAgICAgIGlmIChyZXN1bHQpIHJldHVybiByZXN1bHQ7XG4gICAgfVxuICAgIHJldHVybiAoY20ub3B0aW9ucy5leHRyYUtleXMgJiYgbG9va3VwS2V5KG5hbWUsIGNtLm9wdGlvbnMuZXh0cmFLZXlzLCBoYW5kbGUsIGNtKSlcbiAgICAgIHx8IGxvb2t1cEtleShuYW1lLCBjbS5vcHRpb25zLmtleU1hcCwgaGFuZGxlLCBjbSk7XG4gIH1cblxuICB2YXIgc3RvcFNlcSA9IG5ldyBEZWxheWVkO1xuICBmdW5jdGlvbiBkaXNwYXRjaEtleShjbSwgbmFtZSwgZSwgaGFuZGxlKSB7XG4gICAgdmFyIHNlcSA9IGNtLnN0YXRlLmtleVNlcTtcbiAgICBpZiAoc2VxKSB7XG4gICAgICBpZiAoaXNNb2RpZmllcktleShuYW1lKSkgcmV0dXJuIFwiaGFuZGxlZFwiO1xuICAgICAgc3RvcFNlcS5zZXQoNTAsIGZ1bmN0aW9uKCkge1xuICAgICAgICBpZiAoY20uc3RhdGUua2V5U2VxID09IHNlcSkge1xuICAgICAgICAgIGNtLnN0YXRlLmtleVNlcSA9IG51bGw7XG4gICAgICAgICAgY20uZGlzcGxheS5pbnB1dC5yZXNldCgpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIG5hbWUgPSBzZXEgKyBcIiBcIiArIG5hbWU7XG4gICAgfVxuICAgIHZhciByZXN1bHQgPSBsb29rdXBLZXlGb3JFZGl0b3IoY20sIG5hbWUsIGhhbmRsZSk7XG5cbiAgICBpZiAocmVzdWx0ID09IFwibXVsdGlcIilcbiAgICAgIGNtLnN0YXRlLmtleVNlcSA9IG5hbWU7XG4gICAgaWYgKHJlc3VsdCA9PSBcImhhbmRsZWRcIilcbiAgICAgIHNpZ25hbExhdGVyKGNtLCBcImtleUhhbmRsZWRcIiwgY20sIG5hbWUsIGUpO1xuXG4gICAgaWYgKHJlc3VsdCA9PSBcImhhbmRsZWRcIiB8fCByZXN1bHQgPT0gXCJtdWx0aVwiKSB7XG4gICAgICBlX3ByZXZlbnREZWZhdWx0KGUpO1xuICAgICAgcmVzdGFydEJsaW5rKGNtKTtcbiAgICB9XG5cbiAgICBpZiAoc2VxICYmICFyZXN1bHQgJiYgL1xcJyQvLnRlc3QobmFtZSkpIHtcbiAgICAgIGVfcHJldmVudERlZmF1bHQoZSk7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgcmV0dXJuICEhcmVzdWx0O1xuICB9XG5cbiAgLy8gSGFuZGxlIGEga2V5IGZyb20gdGhlIGtleWRvd24gZXZlbnQuXG4gIGZ1bmN0aW9uIGhhbmRsZUtleUJpbmRpbmcoY20sIGUpIHtcbiAgICB2YXIgbmFtZSA9IGtleU5hbWUoZSwgdHJ1ZSk7XG4gICAgaWYgKCFuYW1lKSByZXR1cm4gZmFsc2U7XG5cbiAgICBpZiAoZS5zaGlmdEtleSAmJiAhY20uc3RhdGUua2V5U2VxKSB7XG4gICAgICAvLyBGaXJzdCB0cnkgdG8gcmVzb2x2ZSBmdWxsIG5hbWUgKGluY2x1ZGluZyAnU2hpZnQtJykuIEZhaWxpbmdcbiAgICAgIC8vIHRoYXQsIHNlZSBpZiB0aGVyZSBpcyBhIGN1cnNvci1tb3Rpb24gY29tbWFuZCAoc3RhcnRpbmcgd2l0aFxuICAgICAgLy8gJ2dvJykgYm91bmQgdG8gdGhlIGtleW5hbWUgd2l0aG91dCAnU2hpZnQtJy5cbiAgICAgIHJldHVybiBkaXNwYXRjaEtleShjbSwgXCJTaGlmdC1cIiArIG5hbWUsIGUsIGZ1bmN0aW9uKGIpIHtyZXR1cm4gZG9IYW5kbGVCaW5kaW5nKGNtLCBiLCB0cnVlKTt9KVxuICAgICAgICAgIHx8IGRpc3BhdGNoS2V5KGNtLCBuYW1lLCBlLCBmdW5jdGlvbihiKSB7XG4gICAgICAgICAgICAgICBpZiAodHlwZW9mIGIgPT0gXCJzdHJpbmdcIiA/IC9eZ29bQS1aXS8udGVzdChiKSA6IGIubW90aW9uKVxuICAgICAgICAgICAgICAgICByZXR1cm4gZG9IYW5kbGVCaW5kaW5nKGNtLCBiKTtcbiAgICAgICAgICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIGRpc3BhdGNoS2V5KGNtLCBuYW1lLCBlLCBmdW5jdGlvbihiKSB7IHJldHVybiBkb0hhbmRsZUJpbmRpbmcoY20sIGIpOyB9KTtcbiAgICB9XG4gIH1cblxuICAvLyBIYW5kbGUgYSBrZXkgZnJvbSB0aGUga2V5cHJlc3MgZXZlbnRcbiAgZnVuY3Rpb24gaGFuZGxlQ2hhckJpbmRpbmcoY20sIGUsIGNoKSB7XG4gICAgcmV0dXJuIGRpc3BhdGNoS2V5KGNtLCBcIidcIiArIGNoICsgXCInXCIsIGUsXG4gICAgICAgICAgICAgICAgICAgICAgIGZ1bmN0aW9uKGIpIHsgcmV0dXJuIGRvSGFuZGxlQmluZGluZyhjbSwgYiwgdHJ1ZSk7IH0pO1xuICB9XG5cbiAgdmFyIGxhc3RTdG9wcGVkS2V5ID0gbnVsbDtcbiAgZnVuY3Rpb24gb25LZXlEb3duKGUpIHtcbiAgICB2YXIgY20gPSB0aGlzO1xuICAgIGNtLmN1ck9wLmZvY3VzID0gYWN0aXZlRWx0KCk7XG4gICAgaWYgKHNpZ25hbERPTUV2ZW50KGNtLCBlKSkgcmV0dXJuO1xuICAgIC8vIElFIGRvZXMgc3RyYW5nZSB0aGluZ3Mgd2l0aCBlc2NhcGUuXG4gICAgaWYgKGllICYmIGllX3ZlcnNpb24gPCAxMSAmJiBlLmtleUNvZGUgPT0gMjcpIGUucmV0dXJuVmFsdWUgPSBmYWxzZTtcbiAgICB2YXIgY29kZSA9IGUua2V5Q29kZTtcbiAgICBjbS5kaXNwbGF5LnNoaWZ0ID0gY29kZSA9PSAxNiB8fCBlLnNoaWZ0S2V5O1xuICAgIHZhciBoYW5kbGVkID0gaGFuZGxlS2V5QmluZGluZyhjbSwgZSk7XG4gICAgaWYgKHByZXN0bykge1xuICAgICAgbGFzdFN0b3BwZWRLZXkgPSBoYW5kbGVkID8gY29kZSA6IG51bGw7XG4gICAgICAvLyBPcGVyYSBoYXMgbm8gY3V0IGV2ZW50Li4uIHdlIHRyeSB0byBhdCBsZWFzdCBjYXRjaCB0aGUga2V5IGNvbWJvXG4gICAgICBpZiAoIWhhbmRsZWQgJiYgY29kZSA9PSA4OCAmJiAhaGFzQ29weUV2ZW50ICYmIChtYWMgPyBlLm1ldGFLZXkgOiBlLmN0cmxLZXkpKVxuICAgICAgICBjbS5yZXBsYWNlU2VsZWN0aW9uKFwiXCIsIG51bGwsIFwiY3V0XCIpO1xuICAgIH1cblxuICAgIC8vIFR1cm4gbW91c2UgaW50byBjcm9zc2hhaXIgd2hlbiBBbHQgaXMgaGVsZCBvbiBNYWMuXG4gICAgaWYgKGNvZGUgPT0gMTggJiYgIS9cXGJDb2RlTWlycm9yLWNyb3NzaGFpclxcYi8udGVzdChjbS5kaXNwbGF5LmxpbmVEaXYuY2xhc3NOYW1lKSlcbiAgICAgIHNob3dDcm9zc0hhaXIoY20pO1xuICB9XG5cbiAgZnVuY3Rpb24gc2hvd0Nyb3NzSGFpcihjbSkge1xuICAgIHZhciBsaW5lRGl2ID0gY20uZGlzcGxheS5saW5lRGl2O1xuICAgIGFkZENsYXNzKGxpbmVEaXYsIFwiQ29kZU1pcnJvci1jcm9zc2hhaXJcIik7XG5cbiAgICBmdW5jdGlvbiB1cChlKSB7XG4gICAgICBpZiAoZS5rZXlDb2RlID09IDE4IHx8ICFlLmFsdEtleSkge1xuICAgICAgICBybUNsYXNzKGxpbmVEaXYsIFwiQ29kZU1pcnJvci1jcm9zc2hhaXJcIik7XG4gICAgICAgIG9mZihkb2N1bWVudCwgXCJrZXl1cFwiLCB1cCk7XG4gICAgICAgIG9mZihkb2N1bWVudCwgXCJtb3VzZW92ZXJcIiwgdXApO1xuICAgICAgfVxuICAgIH1cbiAgICBvbihkb2N1bWVudCwgXCJrZXl1cFwiLCB1cCk7XG4gICAgb24oZG9jdW1lbnQsIFwibW91c2VvdmVyXCIsIHVwKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIG9uS2V5VXAoZSkge1xuICAgIGlmIChlLmtleUNvZGUgPT0gMTYpIHRoaXMuZG9jLnNlbC5zaGlmdCA9IGZhbHNlO1xuICAgIHNpZ25hbERPTUV2ZW50KHRoaXMsIGUpO1xuICB9XG5cbiAgZnVuY3Rpb24gb25LZXlQcmVzcyhlKSB7XG4gICAgdmFyIGNtID0gdGhpcztcbiAgICBpZiAoZXZlbnRJbldpZGdldChjbS5kaXNwbGF5LCBlKSB8fCBzaWduYWxET01FdmVudChjbSwgZSkgfHwgZS5jdHJsS2V5ICYmICFlLmFsdEtleSB8fCBtYWMgJiYgZS5tZXRhS2V5KSByZXR1cm47XG4gICAgdmFyIGtleUNvZGUgPSBlLmtleUNvZGUsIGNoYXJDb2RlID0gZS5jaGFyQ29kZTtcbiAgICBpZiAocHJlc3RvICYmIGtleUNvZGUgPT0gbGFzdFN0b3BwZWRLZXkpIHtsYXN0U3RvcHBlZEtleSA9IG51bGw7IGVfcHJldmVudERlZmF1bHQoZSk7IHJldHVybjt9XG4gICAgaWYgKChwcmVzdG8gJiYgKCFlLndoaWNoIHx8IGUud2hpY2ggPCAxMCkpICYmIGhhbmRsZUtleUJpbmRpbmcoY20sIGUpKSByZXR1cm47XG4gICAgdmFyIGNoID0gU3RyaW5nLmZyb21DaGFyQ29kZShjaGFyQ29kZSA9PSBudWxsID8ga2V5Q29kZSA6IGNoYXJDb2RlKTtcbiAgICBpZiAoaGFuZGxlQ2hhckJpbmRpbmcoY20sIGUsIGNoKSkgcmV0dXJuO1xuICAgIGNtLmRpc3BsYXkuaW5wdXQub25LZXlQcmVzcyhlKTtcbiAgfVxuXG4gIC8vIEZPQ1VTL0JMVVIgRVZFTlRTXG5cbiAgZnVuY3Rpb24gZGVsYXlCbHVyRXZlbnQoY20pIHtcbiAgICBjbS5zdGF0ZS5kZWxheWluZ0JsdXJFdmVudCA9IHRydWU7XG4gICAgc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgIGlmIChjbS5zdGF0ZS5kZWxheWluZ0JsdXJFdmVudCkge1xuICAgICAgICBjbS5zdGF0ZS5kZWxheWluZ0JsdXJFdmVudCA9IGZhbHNlO1xuICAgICAgICBvbkJsdXIoY20pO1xuICAgICAgfVxuICAgIH0sIDEwMCk7XG4gIH1cblxuICBmdW5jdGlvbiBvbkZvY3VzKGNtKSB7XG4gICAgaWYgKGNtLnN0YXRlLmRlbGF5aW5nQmx1ckV2ZW50KSBjbS5zdGF0ZS5kZWxheWluZ0JsdXJFdmVudCA9IGZhbHNlO1xuXG4gICAgaWYgKGNtLm9wdGlvbnMucmVhZE9ubHkgPT0gXCJub2N1cnNvclwiKSByZXR1cm47XG4gICAgaWYgKCFjbS5zdGF0ZS5mb2N1c2VkKSB7XG4gICAgICBzaWduYWwoY20sIFwiZm9jdXNcIiwgY20pO1xuICAgICAgY20uc3RhdGUuZm9jdXNlZCA9IHRydWU7XG4gICAgICBhZGRDbGFzcyhjbS5kaXNwbGF5LndyYXBwZXIsIFwiQ29kZU1pcnJvci1mb2N1c2VkXCIpO1xuICAgICAgLy8gVGhpcyB0ZXN0IHByZXZlbnRzIHRoaXMgZnJvbSBmaXJpbmcgd2hlbiBhIGNvbnRleHRcbiAgICAgIC8vIG1lbnUgaXMgY2xvc2VkIChzaW5jZSB0aGUgaW5wdXQgcmVzZXQgd291bGQga2lsbCB0aGVcbiAgICAgIC8vIHNlbGVjdC1hbGwgZGV0ZWN0aW9uIGhhY2spXG4gICAgICBpZiAoIWNtLmN1ck9wICYmIGNtLmRpc3BsYXkuc2VsRm9yQ29udGV4dE1lbnUgIT0gY20uZG9jLnNlbCkge1xuICAgICAgICBjbS5kaXNwbGF5LmlucHV0LnJlc2V0KCk7XG4gICAgICAgIGlmICh3ZWJraXQpIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7IGNtLmRpc3BsYXkuaW5wdXQucmVzZXQodHJ1ZSk7IH0sIDIwKTsgLy8gSXNzdWUgIzE3MzBcbiAgICAgIH1cbiAgICAgIGNtLmRpc3BsYXkuaW5wdXQucmVjZWl2ZWRGb2N1cygpO1xuICAgIH1cbiAgICByZXN0YXJ0QmxpbmsoY20pO1xuICB9XG4gIGZ1bmN0aW9uIG9uQmx1cihjbSkge1xuICAgIGlmIChjbS5zdGF0ZS5kZWxheWluZ0JsdXJFdmVudCkgcmV0dXJuO1xuXG4gICAgaWYgKGNtLnN0YXRlLmZvY3VzZWQpIHtcbiAgICAgIHNpZ25hbChjbSwgXCJibHVyXCIsIGNtKTtcbiAgICAgIGNtLnN0YXRlLmZvY3VzZWQgPSBmYWxzZTtcbiAgICAgIHJtQ2xhc3MoY20uZGlzcGxheS53cmFwcGVyLCBcIkNvZGVNaXJyb3ItZm9jdXNlZFwiKTtcbiAgICB9XG4gICAgY2xlYXJJbnRlcnZhbChjbS5kaXNwbGF5LmJsaW5rZXIpO1xuICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7aWYgKCFjbS5zdGF0ZS5mb2N1c2VkKSBjbS5kaXNwbGF5LnNoaWZ0ID0gZmFsc2U7fSwgMTUwKTtcbiAgfVxuXG4gIC8vIENPTlRFWFQgTUVOVSBIQU5ETElOR1xuXG4gIC8vIFRvIG1ha2UgdGhlIGNvbnRleHQgbWVudSB3b3JrLCB3ZSBuZWVkIHRvIGJyaWVmbHkgdW5oaWRlIHRoZVxuICAvLyB0ZXh0YXJlYSAobWFraW5nIGl0IGFzIHVub2J0cnVzaXZlIGFzIHBvc3NpYmxlKSB0byBsZXQgdGhlXG4gIC8vIHJpZ2h0LWNsaWNrIHRha2UgZWZmZWN0IG9uIGl0LlxuICBmdW5jdGlvbiBvbkNvbnRleHRNZW51KGNtLCBlKSB7XG4gICAgaWYgKGV2ZW50SW5XaWRnZXQoY20uZGlzcGxheSwgZSkgfHwgY29udGV4dE1lbnVJbkd1dHRlcihjbSwgZSkpIHJldHVybjtcbiAgICBjbS5kaXNwbGF5LmlucHV0Lm9uQ29udGV4dE1lbnUoZSk7XG4gIH1cblxuICBmdW5jdGlvbiBjb250ZXh0TWVudUluR3V0dGVyKGNtLCBlKSB7XG4gICAgaWYgKCFoYXNIYW5kbGVyKGNtLCBcImd1dHRlckNvbnRleHRNZW51XCIpKSByZXR1cm4gZmFsc2U7XG4gICAgcmV0dXJuIGd1dHRlckV2ZW50KGNtLCBlLCBcImd1dHRlckNvbnRleHRNZW51XCIsIGZhbHNlLCBzaWduYWwpO1xuICB9XG5cbiAgLy8gVVBEQVRJTkdcblxuICAvLyBDb21wdXRlIHRoZSBwb3NpdGlvbiBvZiB0aGUgZW5kIG9mIGEgY2hhbmdlIChpdHMgJ3RvJyBwcm9wZXJ0eVxuICAvLyByZWZlcnMgdG8gdGhlIHByZS1jaGFuZ2UgZW5kKS5cbiAgdmFyIGNoYW5nZUVuZCA9IENvZGVNaXJyb3IuY2hhbmdlRW5kID0gZnVuY3Rpb24oY2hhbmdlKSB7XG4gICAgaWYgKCFjaGFuZ2UudGV4dCkgcmV0dXJuIGNoYW5nZS50bztcbiAgICByZXR1cm4gUG9zKGNoYW5nZS5mcm9tLmxpbmUgKyBjaGFuZ2UudGV4dC5sZW5ndGggLSAxLFxuICAgICAgICAgICAgICAgbHN0KGNoYW5nZS50ZXh0KS5sZW5ndGggKyAoY2hhbmdlLnRleHQubGVuZ3RoID09IDEgPyBjaGFuZ2UuZnJvbS5jaCA6IDApKTtcbiAgfTtcblxuICAvLyBBZGp1c3QgYSBwb3NpdGlvbiB0byByZWZlciB0byB0aGUgcG9zdC1jaGFuZ2UgcG9zaXRpb24gb2YgdGhlXG4gIC8vIHNhbWUgdGV4dCwgb3IgdGhlIGVuZCBvZiB0aGUgY2hhbmdlIGlmIHRoZSBjaGFuZ2UgY292ZXJzIGl0LlxuICBmdW5jdGlvbiBhZGp1c3RGb3JDaGFuZ2UocG9zLCBjaGFuZ2UpIHtcbiAgICBpZiAoY21wKHBvcywgY2hhbmdlLmZyb20pIDwgMCkgcmV0dXJuIHBvcztcbiAgICBpZiAoY21wKHBvcywgY2hhbmdlLnRvKSA8PSAwKSByZXR1cm4gY2hhbmdlRW5kKGNoYW5nZSk7XG5cbiAgICB2YXIgbGluZSA9IHBvcy5saW5lICsgY2hhbmdlLnRleHQubGVuZ3RoIC0gKGNoYW5nZS50by5saW5lIC0gY2hhbmdlLmZyb20ubGluZSkgLSAxLCBjaCA9IHBvcy5jaDtcbiAgICBpZiAocG9zLmxpbmUgPT0gY2hhbmdlLnRvLmxpbmUpIGNoICs9IGNoYW5nZUVuZChjaGFuZ2UpLmNoIC0gY2hhbmdlLnRvLmNoO1xuICAgIHJldHVybiBQb3MobGluZSwgY2gpO1xuICB9XG5cbiAgZnVuY3Rpb24gY29tcHV0ZVNlbEFmdGVyQ2hhbmdlKGRvYywgY2hhbmdlKSB7XG4gICAgdmFyIG91dCA9IFtdO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgZG9jLnNlbC5yYW5nZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgIHZhciByYW5nZSA9IGRvYy5zZWwucmFuZ2VzW2ldO1xuICAgICAgb3V0LnB1c2gobmV3IFJhbmdlKGFkanVzdEZvckNoYW5nZShyYW5nZS5hbmNob3IsIGNoYW5nZSksXG4gICAgICAgICAgICAgICAgICAgICAgICAgYWRqdXN0Rm9yQ2hhbmdlKHJhbmdlLmhlYWQsIGNoYW5nZSkpKTtcbiAgICB9XG4gICAgcmV0dXJuIG5vcm1hbGl6ZVNlbGVjdGlvbihvdXQsIGRvYy5zZWwucHJpbUluZGV4KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIG9mZnNldFBvcyhwb3MsIG9sZCwgbncpIHtcbiAgICBpZiAocG9zLmxpbmUgPT0gb2xkLmxpbmUpXG4gICAgICByZXR1cm4gUG9zKG53LmxpbmUsIHBvcy5jaCAtIG9sZC5jaCArIG53LmNoKTtcbiAgICBlbHNlXG4gICAgICByZXR1cm4gUG9zKG53LmxpbmUgKyAocG9zLmxpbmUgLSBvbGQubGluZSksIHBvcy5jaCk7XG4gIH1cblxuICAvLyBVc2VkIGJ5IHJlcGxhY2VTZWxlY3Rpb25zIHRvIGFsbG93IG1vdmluZyB0aGUgc2VsZWN0aW9uIHRvIHRoZVxuICAvLyBzdGFydCBvciBhcm91bmQgdGhlIHJlcGxhY2VkIHRlc3QuIEhpbnQgbWF5IGJlIFwic3RhcnRcIiBvciBcImFyb3VuZFwiLlxuICBmdW5jdGlvbiBjb21wdXRlUmVwbGFjZWRTZWwoZG9jLCBjaGFuZ2VzLCBoaW50KSB7XG4gICAgdmFyIG91dCA9IFtdO1xuICAgIHZhciBvbGRQcmV2ID0gUG9zKGRvYy5maXJzdCwgMCksIG5ld1ByZXYgPSBvbGRQcmV2O1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgY2hhbmdlcy5sZW5ndGg7IGkrKykge1xuICAgICAgdmFyIGNoYW5nZSA9IGNoYW5nZXNbaV07XG4gICAgICB2YXIgZnJvbSA9IG9mZnNldFBvcyhjaGFuZ2UuZnJvbSwgb2xkUHJldiwgbmV3UHJldik7XG4gICAgICB2YXIgdG8gPSBvZmZzZXRQb3MoY2hhbmdlRW5kKGNoYW5nZSksIG9sZFByZXYsIG5ld1ByZXYpO1xuICAgICAgb2xkUHJldiA9IGNoYW5nZS50bztcbiAgICAgIG5ld1ByZXYgPSB0bztcbiAgICAgIGlmIChoaW50ID09IFwiYXJvdW5kXCIpIHtcbiAgICAgICAgdmFyIHJhbmdlID0gZG9jLnNlbC5yYW5nZXNbaV0sIGludiA9IGNtcChyYW5nZS5oZWFkLCByYW5nZS5hbmNob3IpIDwgMDtcbiAgICAgICAgb3V0W2ldID0gbmV3IFJhbmdlKGludiA/IHRvIDogZnJvbSwgaW52ID8gZnJvbSA6IHRvKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG91dFtpXSA9IG5ldyBSYW5nZShmcm9tLCBmcm9tKTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIG5ldyBTZWxlY3Rpb24ob3V0LCBkb2Muc2VsLnByaW1JbmRleCk7XG4gIH1cblxuICAvLyBBbGxvdyBcImJlZm9yZUNoYW5nZVwiIGV2ZW50IGhhbmRsZXJzIHRvIGluZmx1ZW5jZSBhIGNoYW5nZVxuICBmdW5jdGlvbiBmaWx0ZXJDaGFuZ2UoZG9jLCBjaGFuZ2UsIHVwZGF0ZSkge1xuICAgIHZhciBvYmogPSB7XG4gICAgICBjYW5jZWxlZDogZmFsc2UsXG4gICAgICBmcm9tOiBjaGFuZ2UuZnJvbSxcbiAgICAgIHRvOiBjaGFuZ2UudG8sXG4gICAgICB0ZXh0OiBjaGFuZ2UudGV4dCxcbiAgICAgIG9yaWdpbjogY2hhbmdlLm9yaWdpbixcbiAgICAgIGNhbmNlbDogZnVuY3Rpb24oKSB7IHRoaXMuY2FuY2VsZWQgPSB0cnVlOyB9XG4gICAgfTtcbiAgICBpZiAodXBkYXRlKSBvYmoudXBkYXRlID0gZnVuY3Rpb24oZnJvbSwgdG8sIHRleHQsIG9yaWdpbikge1xuICAgICAgaWYgKGZyb20pIHRoaXMuZnJvbSA9IGNsaXBQb3MoZG9jLCBmcm9tKTtcbiAgICAgIGlmICh0bykgdGhpcy50byA9IGNsaXBQb3MoZG9jLCB0byk7XG4gICAgICBpZiAodGV4dCkgdGhpcy50ZXh0ID0gdGV4dDtcbiAgICAgIGlmIChvcmlnaW4gIT09IHVuZGVmaW5lZCkgdGhpcy5vcmlnaW4gPSBvcmlnaW47XG4gICAgfTtcbiAgICBzaWduYWwoZG9jLCBcImJlZm9yZUNoYW5nZVwiLCBkb2MsIG9iaik7XG4gICAgaWYgKGRvYy5jbSkgc2lnbmFsKGRvYy5jbSwgXCJiZWZvcmVDaGFuZ2VcIiwgZG9jLmNtLCBvYmopO1xuXG4gICAgaWYgKG9iai5jYW5jZWxlZCkgcmV0dXJuIG51bGw7XG4gICAgcmV0dXJuIHtmcm9tOiBvYmouZnJvbSwgdG86IG9iai50bywgdGV4dDogb2JqLnRleHQsIG9yaWdpbjogb2JqLm9yaWdpbn07XG4gIH1cblxuICAvLyBBcHBseSBhIGNoYW5nZSB0byBhIGRvY3VtZW50LCBhbmQgYWRkIGl0IHRvIHRoZSBkb2N1bWVudCdzXG4gIC8vIGhpc3RvcnksIGFuZCBwcm9wYWdhdGluZyBpdCB0byBhbGwgbGlua2VkIGRvY3VtZW50cy5cbiAgZnVuY3Rpb24gbWFrZUNoYW5nZShkb2MsIGNoYW5nZSwgaWdub3JlUmVhZE9ubHkpIHtcbiAgICBpZiAoZG9jLmNtKSB7XG4gICAgICBpZiAoIWRvYy5jbS5jdXJPcCkgcmV0dXJuIG9wZXJhdGlvbihkb2MuY20sIG1ha2VDaGFuZ2UpKGRvYywgY2hhbmdlLCBpZ25vcmVSZWFkT25seSk7XG4gICAgICBpZiAoZG9jLmNtLnN0YXRlLnN1cHByZXNzRWRpdHMpIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoaGFzSGFuZGxlcihkb2MsIFwiYmVmb3JlQ2hhbmdlXCIpIHx8IGRvYy5jbSAmJiBoYXNIYW5kbGVyKGRvYy5jbSwgXCJiZWZvcmVDaGFuZ2VcIikpIHtcbiAgICAgIGNoYW5nZSA9IGZpbHRlckNoYW5nZShkb2MsIGNoYW5nZSwgdHJ1ZSk7XG4gICAgICBpZiAoIWNoYW5nZSkgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIFBvc3NpYmx5IHNwbGl0IG9yIHN1cHByZXNzIHRoZSB1cGRhdGUgYmFzZWQgb24gdGhlIHByZXNlbmNlXG4gICAgLy8gb2YgcmVhZC1vbmx5IHNwYW5zIGluIGl0cyByYW5nZS5cbiAgICB2YXIgc3BsaXQgPSBzYXdSZWFkT25seVNwYW5zICYmICFpZ25vcmVSZWFkT25seSAmJiByZW1vdmVSZWFkT25seVJhbmdlcyhkb2MsIGNoYW5nZS5mcm9tLCBjaGFuZ2UudG8pO1xuICAgIGlmIChzcGxpdCkge1xuICAgICAgZm9yICh2YXIgaSA9IHNwbGl0Lmxlbmd0aCAtIDE7IGkgPj0gMDsgLS1pKVxuICAgICAgICBtYWtlQ2hhbmdlSW5uZXIoZG9jLCB7ZnJvbTogc3BsaXRbaV0uZnJvbSwgdG86IHNwbGl0W2ldLnRvLCB0ZXh0OiBpID8gW1wiXCJdIDogY2hhbmdlLnRleHR9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgbWFrZUNoYW5nZUlubmVyKGRvYywgY2hhbmdlKTtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBtYWtlQ2hhbmdlSW5uZXIoZG9jLCBjaGFuZ2UpIHtcbiAgICBpZiAoY2hhbmdlLnRleHQubGVuZ3RoID09IDEgJiYgY2hhbmdlLnRleHRbMF0gPT0gXCJcIiAmJiBjbXAoY2hhbmdlLmZyb20sIGNoYW5nZS50bykgPT0gMCkgcmV0dXJuO1xuICAgIHZhciBzZWxBZnRlciA9IGNvbXB1dGVTZWxBZnRlckNoYW5nZShkb2MsIGNoYW5nZSk7XG4gICAgYWRkQ2hhbmdlVG9IaXN0b3J5KGRvYywgY2hhbmdlLCBzZWxBZnRlciwgZG9jLmNtID8gZG9jLmNtLmN1ck9wLmlkIDogTmFOKTtcblxuICAgIG1ha2VDaGFuZ2VTaW5nbGVEb2MoZG9jLCBjaGFuZ2UsIHNlbEFmdGVyLCBzdHJldGNoU3BhbnNPdmVyQ2hhbmdlKGRvYywgY2hhbmdlKSk7XG4gICAgdmFyIHJlYmFzZWQgPSBbXTtcblxuICAgIGxpbmtlZERvY3MoZG9jLCBmdW5jdGlvbihkb2MsIHNoYXJlZEhpc3QpIHtcbiAgICAgIGlmICghc2hhcmVkSGlzdCAmJiBpbmRleE9mKHJlYmFzZWQsIGRvYy5oaXN0b3J5KSA9PSAtMSkge1xuICAgICAgICByZWJhc2VIaXN0KGRvYy5oaXN0b3J5LCBjaGFuZ2UpO1xuICAgICAgICByZWJhc2VkLnB1c2goZG9jLmhpc3RvcnkpO1xuICAgICAgfVxuICAgICAgbWFrZUNoYW5nZVNpbmdsZURvYyhkb2MsIGNoYW5nZSwgbnVsbCwgc3RyZXRjaFNwYW5zT3ZlckNoYW5nZShkb2MsIGNoYW5nZSkpO1xuICAgIH0pO1xuICB9XG5cbiAgLy8gUmV2ZXJ0IGEgY2hhbmdlIHN0b3JlZCBpbiBhIGRvY3VtZW50J3MgaGlzdG9yeS5cbiAgZnVuY3Rpb24gbWFrZUNoYW5nZUZyb21IaXN0b3J5KGRvYywgdHlwZSwgYWxsb3dTZWxlY3Rpb25Pbmx5KSB7XG4gICAgaWYgKGRvYy5jbSAmJiBkb2MuY20uc3RhdGUuc3VwcHJlc3NFZGl0cykgcmV0dXJuO1xuXG4gICAgdmFyIGhpc3QgPSBkb2MuaGlzdG9yeSwgZXZlbnQsIHNlbEFmdGVyID0gZG9jLnNlbDtcbiAgICB2YXIgc291cmNlID0gdHlwZSA9PSBcInVuZG9cIiA/IGhpc3QuZG9uZSA6IGhpc3QudW5kb25lLCBkZXN0ID0gdHlwZSA9PSBcInVuZG9cIiA/IGhpc3QudW5kb25lIDogaGlzdC5kb25lO1xuXG4gICAgLy8gVmVyaWZ5IHRoYXQgdGhlcmUgaXMgYSB1c2VhYmxlIGV2ZW50IChzbyB0aGF0IGN0cmwteiB3b24ndFxuICAgIC8vIG5lZWRsZXNzbHkgY2xlYXIgc2VsZWN0aW9uIGV2ZW50cylcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHNvdXJjZS5sZW5ndGg7IGkrKykge1xuICAgICAgZXZlbnQgPSBzb3VyY2VbaV07XG4gICAgICBpZiAoYWxsb3dTZWxlY3Rpb25Pbmx5ID8gZXZlbnQucmFuZ2VzICYmICFldmVudC5lcXVhbHMoZG9jLnNlbCkgOiAhZXZlbnQucmFuZ2VzKVxuICAgICAgICBicmVhaztcbiAgICB9XG4gICAgaWYgKGkgPT0gc291cmNlLmxlbmd0aCkgcmV0dXJuO1xuICAgIGhpc3QubGFzdE9yaWdpbiA9IGhpc3QubGFzdFNlbE9yaWdpbiA9IG51bGw7XG5cbiAgICBmb3IgKDs7KSB7XG4gICAgICBldmVudCA9IHNvdXJjZS5wb3AoKTtcbiAgICAgIGlmIChldmVudC5yYW5nZXMpIHtcbiAgICAgICAgcHVzaFNlbGVjdGlvblRvSGlzdG9yeShldmVudCwgZGVzdCk7XG4gICAgICAgIGlmIChhbGxvd1NlbGVjdGlvbk9ubHkgJiYgIWV2ZW50LmVxdWFscyhkb2Muc2VsKSkge1xuICAgICAgICAgIHNldFNlbGVjdGlvbihkb2MsIGV2ZW50LCB7Y2xlYXJSZWRvOiBmYWxzZX0pO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBzZWxBZnRlciA9IGV2ZW50O1xuICAgICAgfVxuICAgICAgZWxzZSBicmVhaztcbiAgICB9XG5cbiAgICAvLyBCdWlsZCB1cCBhIHJldmVyc2UgY2hhbmdlIG9iamVjdCB0byBhZGQgdG8gdGhlIG9wcG9zaXRlIGhpc3RvcnlcbiAgICAvLyBzdGFjayAocmVkbyB3aGVuIHVuZG9pbmcsIGFuZCB2aWNlIHZlcnNhKS5cbiAgICB2YXIgYW50aUNoYW5nZXMgPSBbXTtcbiAgICBwdXNoU2VsZWN0aW9uVG9IaXN0b3J5KHNlbEFmdGVyLCBkZXN0KTtcbiAgICBkZXN0LnB1c2goe2NoYW5nZXM6IGFudGlDaGFuZ2VzLCBnZW5lcmF0aW9uOiBoaXN0LmdlbmVyYXRpb259KTtcbiAgICBoaXN0LmdlbmVyYXRpb24gPSBldmVudC5nZW5lcmF0aW9uIHx8ICsraGlzdC5tYXhHZW5lcmF0aW9uO1xuXG4gICAgdmFyIGZpbHRlciA9IGhhc0hhbmRsZXIoZG9jLCBcImJlZm9yZUNoYW5nZVwiKSB8fCBkb2MuY20gJiYgaGFzSGFuZGxlcihkb2MuY20sIFwiYmVmb3JlQ2hhbmdlXCIpO1xuXG4gICAgZm9yICh2YXIgaSA9IGV2ZW50LmNoYW5nZXMubGVuZ3RoIC0gMTsgaSA+PSAwOyAtLWkpIHtcbiAgICAgIHZhciBjaGFuZ2UgPSBldmVudC5jaGFuZ2VzW2ldO1xuICAgICAgY2hhbmdlLm9yaWdpbiA9IHR5cGU7XG4gICAgICBpZiAoZmlsdGVyICYmICFmaWx0ZXJDaGFuZ2UoZG9jLCBjaGFuZ2UsIGZhbHNlKSkge1xuICAgICAgICBzb3VyY2UubGVuZ3RoID0gMDtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBhbnRpQ2hhbmdlcy5wdXNoKGhpc3RvcnlDaGFuZ2VGcm9tQ2hhbmdlKGRvYywgY2hhbmdlKSk7XG5cbiAgICAgIHZhciBhZnRlciA9IGkgPyBjb21wdXRlU2VsQWZ0ZXJDaGFuZ2UoZG9jLCBjaGFuZ2UpIDogbHN0KHNvdXJjZSk7XG4gICAgICBtYWtlQ2hhbmdlU2luZ2xlRG9jKGRvYywgY2hhbmdlLCBhZnRlciwgbWVyZ2VPbGRTcGFucyhkb2MsIGNoYW5nZSkpO1xuICAgICAgaWYgKCFpICYmIGRvYy5jbSkgZG9jLmNtLnNjcm9sbEludG9WaWV3KHtmcm9tOiBjaGFuZ2UuZnJvbSwgdG86IGNoYW5nZUVuZChjaGFuZ2UpfSk7XG4gICAgICB2YXIgcmViYXNlZCA9IFtdO1xuXG4gICAgICAvLyBQcm9wYWdhdGUgdG8gdGhlIGxpbmtlZCBkb2N1bWVudHNcbiAgICAgIGxpbmtlZERvY3MoZG9jLCBmdW5jdGlvbihkb2MsIHNoYXJlZEhpc3QpIHtcbiAgICAgICAgaWYgKCFzaGFyZWRIaXN0ICYmIGluZGV4T2YocmViYXNlZCwgZG9jLmhpc3RvcnkpID09IC0xKSB7XG4gICAgICAgICAgcmViYXNlSGlzdChkb2MuaGlzdG9yeSwgY2hhbmdlKTtcbiAgICAgICAgICByZWJhc2VkLnB1c2goZG9jLmhpc3RvcnkpO1xuICAgICAgICB9XG4gICAgICAgIG1ha2VDaGFuZ2VTaW5nbGVEb2MoZG9jLCBjaGFuZ2UsIG51bGwsIG1lcmdlT2xkU3BhbnMoZG9jLCBjaGFuZ2UpKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIC8vIFN1Yi12aWV3cyBuZWVkIHRoZWlyIGxpbmUgbnVtYmVycyBzaGlmdGVkIHdoZW4gdGV4dCBpcyBhZGRlZFxuICAvLyBhYm92ZSBvciBiZWxvdyB0aGVtIGluIHRoZSBwYXJlbnQgZG9jdW1lbnQuXG4gIGZ1bmN0aW9uIHNoaWZ0RG9jKGRvYywgZGlzdGFuY2UpIHtcbiAgICBpZiAoZGlzdGFuY2UgPT0gMCkgcmV0dXJuO1xuICAgIGRvYy5maXJzdCArPSBkaXN0YW5jZTtcbiAgICBkb2Muc2VsID0gbmV3IFNlbGVjdGlvbihtYXAoZG9jLnNlbC5yYW5nZXMsIGZ1bmN0aW9uKHJhbmdlKSB7XG4gICAgICByZXR1cm4gbmV3IFJhbmdlKFBvcyhyYW5nZS5hbmNob3IubGluZSArIGRpc3RhbmNlLCByYW5nZS5hbmNob3IuY2gpLFxuICAgICAgICAgICAgICAgICAgICAgICBQb3MocmFuZ2UuaGVhZC5saW5lICsgZGlzdGFuY2UsIHJhbmdlLmhlYWQuY2gpKTtcbiAgICB9KSwgZG9jLnNlbC5wcmltSW5kZXgpO1xuICAgIGlmIChkb2MuY20pIHtcbiAgICAgIHJlZ0NoYW5nZShkb2MuY20sIGRvYy5maXJzdCwgZG9jLmZpcnN0IC0gZGlzdGFuY2UsIGRpc3RhbmNlKTtcbiAgICAgIGZvciAodmFyIGQgPSBkb2MuY20uZGlzcGxheSwgbCA9IGQudmlld0Zyb207IGwgPCBkLnZpZXdUbzsgbCsrKVxuICAgICAgICByZWdMaW5lQ2hhbmdlKGRvYy5jbSwgbCwgXCJndXR0ZXJcIik7XG4gICAgfVxuICB9XG5cbiAgLy8gTW9yZSBsb3dlci1sZXZlbCBjaGFuZ2UgZnVuY3Rpb24sIGhhbmRsaW5nIG9ubHkgYSBzaW5nbGUgZG9jdW1lbnRcbiAgLy8gKG5vdCBsaW5rZWQgb25lcykuXG4gIGZ1bmN0aW9uIG1ha2VDaGFuZ2VTaW5nbGVEb2MoZG9jLCBjaGFuZ2UsIHNlbEFmdGVyLCBzcGFucykge1xuICAgIGlmIChkb2MuY20gJiYgIWRvYy5jbS5jdXJPcClcbiAgICAgIHJldHVybiBvcGVyYXRpb24oZG9jLmNtLCBtYWtlQ2hhbmdlU2luZ2xlRG9jKShkb2MsIGNoYW5nZSwgc2VsQWZ0ZXIsIHNwYW5zKTtcblxuICAgIGlmIChjaGFuZ2UudG8ubGluZSA8IGRvYy5maXJzdCkge1xuICAgICAgc2hpZnREb2MoZG9jLCBjaGFuZ2UudGV4dC5sZW5ndGggLSAxIC0gKGNoYW5nZS50by5saW5lIC0gY2hhbmdlLmZyb20ubGluZSkpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoY2hhbmdlLmZyb20ubGluZSA+IGRvYy5sYXN0TGluZSgpKSByZXR1cm47XG5cbiAgICAvLyBDbGlwIHRoZSBjaGFuZ2UgdG8gdGhlIHNpemUgb2YgdGhpcyBkb2NcbiAgICBpZiAoY2hhbmdlLmZyb20ubGluZSA8IGRvYy5maXJzdCkge1xuICAgICAgdmFyIHNoaWZ0ID0gY2hhbmdlLnRleHQubGVuZ3RoIC0gMSAtIChkb2MuZmlyc3QgLSBjaGFuZ2UuZnJvbS5saW5lKTtcbiAgICAgIHNoaWZ0RG9jKGRvYywgc2hpZnQpO1xuICAgICAgY2hhbmdlID0ge2Zyb206IFBvcyhkb2MuZmlyc3QsIDApLCB0bzogUG9zKGNoYW5nZS50by5saW5lICsgc2hpZnQsIGNoYW5nZS50by5jaCksXG4gICAgICAgICAgICAgICAgdGV4dDogW2xzdChjaGFuZ2UudGV4dCldLCBvcmlnaW46IGNoYW5nZS5vcmlnaW59O1xuICAgIH1cbiAgICB2YXIgbGFzdCA9IGRvYy5sYXN0TGluZSgpO1xuICAgIGlmIChjaGFuZ2UudG8ubGluZSA+IGxhc3QpIHtcbiAgICAgIGNoYW5nZSA9IHtmcm9tOiBjaGFuZ2UuZnJvbSwgdG86IFBvcyhsYXN0LCBnZXRMaW5lKGRvYywgbGFzdCkudGV4dC5sZW5ndGgpLFxuICAgICAgICAgICAgICAgIHRleHQ6IFtjaGFuZ2UudGV4dFswXV0sIG9yaWdpbjogY2hhbmdlLm9yaWdpbn07XG4gICAgfVxuXG4gICAgY2hhbmdlLnJlbW92ZWQgPSBnZXRCZXR3ZWVuKGRvYywgY2hhbmdlLmZyb20sIGNoYW5nZS50byk7XG5cbiAgICBpZiAoIXNlbEFmdGVyKSBzZWxBZnRlciA9IGNvbXB1dGVTZWxBZnRlckNoYW5nZShkb2MsIGNoYW5nZSk7XG4gICAgaWYgKGRvYy5jbSkgbWFrZUNoYW5nZVNpbmdsZURvY0luRWRpdG9yKGRvYy5jbSwgY2hhbmdlLCBzcGFucyk7XG4gICAgZWxzZSB1cGRhdGVEb2MoZG9jLCBjaGFuZ2UsIHNwYW5zKTtcbiAgICBzZXRTZWxlY3Rpb25Ob1VuZG8oZG9jLCBzZWxBZnRlciwgc2VsX2RvbnRTY3JvbGwpO1xuICB9XG5cbiAgLy8gSGFuZGxlIHRoZSBpbnRlcmFjdGlvbiBvZiBhIGNoYW5nZSB0byBhIGRvY3VtZW50IHdpdGggdGhlIGVkaXRvclxuICAvLyB0aGF0IHRoaXMgZG9jdW1lbnQgaXMgcGFydCBvZi5cbiAgZnVuY3Rpb24gbWFrZUNoYW5nZVNpbmdsZURvY0luRWRpdG9yKGNtLCBjaGFuZ2UsIHNwYW5zKSB7XG4gICAgdmFyIGRvYyA9IGNtLmRvYywgZGlzcGxheSA9IGNtLmRpc3BsYXksIGZyb20gPSBjaGFuZ2UuZnJvbSwgdG8gPSBjaGFuZ2UudG87XG5cbiAgICB2YXIgcmVjb21wdXRlTWF4TGVuZ3RoID0gZmFsc2UsIGNoZWNrV2lkdGhTdGFydCA9IGZyb20ubGluZTtcbiAgICBpZiAoIWNtLm9wdGlvbnMubGluZVdyYXBwaW5nKSB7XG4gICAgICBjaGVja1dpZHRoU3RhcnQgPSBsaW5lTm8odmlzdWFsTGluZShnZXRMaW5lKGRvYywgZnJvbS5saW5lKSkpO1xuICAgICAgZG9jLml0ZXIoY2hlY2tXaWR0aFN0YXJ0LCB0by5saW5lICsgMSwgZnVuY3Rpb24obGluZSkge1xuICAgICAgICBpZiAobGluZSA9PSBkaXNwbGF5Lm1heExpbmUpIHtcbiAgICAgICAgICByZWNvbXB1dGVNYXhMZW5ndGggPSB0cnVlO1xuICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBpZiAoZG9jLnNlbC5jb250YWlucyhjaGFuZ2UuZnJvbSwgY2hhbmdlLnRvKSA+IC0xKVxuICAgICAgc2lnbmFsQ3Vyc29yQWN0aXZpdHkoY20pO1xuXG4gICAgdXBkYXRlRG9jKGRvYywgY2hhbmdlLCBzcGFucywgZXN0aW1hdGVIZWlnaHQoY20pKTtcblxuICAgIGlmICghY20ub3B0aW9ucy5saW5lV3JhcHBpbmcpIHtcbiAgICAgIGRvYy5pdGVyKGNoZWNrV2lkdGhTdGFydCwgZnJvbS5saW5lICsgY2hhbmdlLnRleHQubGVuZ3RoLCBmdW5jdGlvbihsaW5lKSB7XG4gICAgICAgIHZhciBsZW4gPSBsaW5lTGVuZ3RoKGxpbmUpO1xuICAgICAgICBpZiAobGVuID4gZGlzcGxheS5tYXhMaW5lTGVuZ3RoKSB7XG4gICAgICAgICAgZGlzcGxheS5tYXhMaW5lID0gbGluZTtcbiAgICAgICAgICBkaXNwbGF5Lm1heExpbmVMZW5ndGggPSBsZW47XG4gICAgICAgICAgZGlzcGxheS5tYXhMaW5lQ2hhbmdlZCA9IHRydWU7XG4gICAgICAgICAgcmVjb21wdXRlTWF4TGVuZ3RoID0gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgaWYgKHJlY29tcHV0ZU1heExlbmd0aCkgY20uY3VyT3AudXBkYXRlTWF4TGluZSA9IHRydWU7XG4gICAgfVxuXG4gICAgLy8gQWRqdXN0IGZyb250aWVyLCBzY2hlZHVsZSB3b3JrZXJcbiAgICBkb2MuZnJvbnRpZXIgPSBNYXRoLm1pbihkb2MuZnJvbnRpZXIsIGZyb20ubGluZSk7XG4gICAgc3RhcnRXb3JrZXIoY20sIDQwMCk7XG5cbiAgICB2YXIgbGVuZGlmZiA9IGNoYW5nZS50ZXh0Lmxlbmd0aCAtICh0by5saW5lIC0gZnJvbS5saW5lKSAtIDE7XG4gICAgLy8gUmVtZW1iZXIgdGhhdCB0aGVzZSBsaW5lcyBjaGFuZ2VkLCBmb3IgdXBkYXRpbmcgdGhlIGRpc3BsYXlcbiAgICBpZiAoY2hhbmdlLmZ1bGwpXG4gICAgICByZWdDaGFuZ2UoY20pO1xuICAgIGVsc2UgaWYgKGZyb20ubGluZSA9PSB0by5saW5lICYmIGNoYW5nZS50ZXh0Lmxlbmd0aCA9PSAxICYmICFpc1dob2xlTGluZVVwZGF0ZShjbS5kb2MsIGNoYW5nZSkpXG4gICAgICByZWdMaW5lQ2hhbmdlKGNtLCBmcm9tLmxpbmUsIFwidGV4dFwiKTtcbiAgICBlbHNlXG4gICAgICByZWdDaGFuZ2UoY20sIGZyb20ubGluZSwgdG8ubGluZSArIDEsIGxlbmRpZmYpO1xuXG4gICAgdmFyIGNoYW5nZXNIYW5kbGVyID0gaGFzSGFuZGxlcihjbSwgXCJjaGFuZ2VzXCIpLCBjaGFuZ2VIYW5kbGVyID0gaGFzSGFuZGxlcihjbSwgXCJjaGFuZ2VcIik7XG4gICAgaWYgKGNoYW5nZUhhbmRsZXIgfHwgY2hhbmdlc0hhbmRsZXIpIHtcbiAgICAgIHZhciBvYmogPSB7XG4gICAgICAgIGZyb206IGZyb20sIHRvOiB0byxcbiAgICAgICAgdGV4dDogY2hhbmdlLnRleHQsXG4gICAgICAgIHJlbW92ZWQ6IGNoYW5nZS5yZW1vdmVkLFxuICAgICAgICBvcmlnaW46IGNoYW5nZS5vcmlnaW5cbiAgICAgIH07XG4gICAgICBpZiAoY2hhbmdlSGFuZGxlcikgc2lnbmFsTGF0ZXIoY20sIFwiY2hhbmdlXCIsIGNtLCBvYmopO1xuICAgICAgaWYgKGNoYW5nZXNIYW5kbGVyKSAoY20uY3VyT3AuY2hhbmdlT2JqcyB8fCAoY20uY3VyT3AuY2hhbmdlT2JqcyA9IFtdKSkucHVzaChvYmopO1xuICAgIH1cbiAgICBjbS5kaXNwbGF5LnNlbEZvckNvbnRleHRNZW51ID0gbnVsbDtcbiAgfVxuXG4gIGZ1bmN0aW9uIHJlcGxhY2VSYW5nZShkb2MsIGNvZGUsIGZyb20sIHRvLCBvcmlnaW4pIHtcbiAgICBpZiAoIXRvKSB0byA9IGZyb207XG4gICAgaWYgKGNtcCh0bywgZnJvbSkgPCAwKSB7IHZhciB0bXAgPSB0bzsgdG8gPSBmcm9tOyBmcm9tID0gdG1wOyB9XG4gICAgaWYgKHR5cGVvZiBjb2RlID09IFwic3RyaW5nXCIpIGNvZGUgPSBzcGxpdExpbmVzKGNvZGUpO1xuICAgIG1ha2VDaGFuZ2UoZG9jLCB7ZnJvbTogZnJvbSwgdG86IHRvLCB0ZXh0OiBjb2RlLCBvcmlnaW46IG9yaWdpbn0pO1xuICB9XG5cbiAgLy8gU0NST0xMSU5HIFRISU5HUyBJTlRPIFZJRVdcblxuICAvLyBJZiBhbiBlZGl0b3Igc2l0cyBvbiB0aGUgdG9wIG9yIGJvdHRvbSBvZiB0aGUgd2luZG93LCBwYXJ0aWFsbHlcbiAgLy8gc2Nyb2xsZWQgb3V0IG9mIHZpZXcsIHRoaXMgZW5zdXJlcyB0aGF0IHRoZSBjdXJzb3IgaXMgdmlzaWJsZS5cbiAgZnVuY3Rpb24gbWF5YmVTY3JvbGxXaW5kb3coY20sIGNvb3Jkcykge1xuICAgIGlmIChzaWduYWxET01FdmVudChjbSwgXCJzY3JvbGxDdXJzb3JJbnRvVmlld1wiKSkgcmV0dXJuO1xuXG4gICAgdmFyIGRpc3BsYXkgPSBjbS5kaXNwbGF5LCBib3ggPSBkaXNwbGF5LnNpemVyLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpLCBkb1Njcm9sbCA9IG51bGw7XG4gICAgaWYgKGNvb3Jkcy50b3AgKyBib3gudG9wIDwgMCkgZG9TY3JvbGwgPSB0cnVlO1xuICAgIGVsc2UgaWYgKGNvb3Jkcy5ib3R0b20gKyBib3gudG9wID4gKHdpbmRvdy5pbm5lckhlaWdodCB8fCBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuY2xpZW50SGVpZ2h0KSkgZG9TY3JvbGwgPSBmYWxzZTtcbiAgICBpZiAoZG9TY3JvbGwgIT0gbnVsbCAmJiAhcGhhbnRvbSkge1xuICAgICAgdmFyIHNjcm9sbE5vZGUgPSBlbHQoXCJkaXZcIiwgXCJcXHUyMDBiXCIsIG51bGwsIFwicG9zaXRpb246IGFic29sdXRlOyB0b3A6IFwiICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgIChjb29yZHMudG9wIC0gZGlzcGxheS52aWV3T2Zmc2V0IC0gcGFkZGluZ1RvcChjbS5kaXNwbGF5KSkgKyBcInB4OyBoZWlnaHQ6IFwiICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgIChjb29yZHMuYm90dG9tIC0gY29vcmRzLnRvcCArIHNjcm9sbEdhcChjbSkgKyBkaXNwbGF5LmJhckhlaWdodCkgKyBcInB4OyBsZWZ0OiBcIiArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICBjb29yZHMubGVmdCArIFwicHg7IHdpZHRoOiAycHg7XCIpO1xuICAgICAgY20uZGlzcGxheS5saW5lU3BhY2UuYXBwZW5kQ2hpbGQoc2Nyb2xsTm9kZSk7XG4gICAgICBzY3JvbGxOb2RlLnNjcm9sbEludG9WaWV3KGRvU2Nyb2xsKTtcbiAgICAgIGNtLmRpc3BsYXkubGluZVNwYWNlLnJlbW92ZUNoaWxkKHNjcm9sbE5vZGUpO1xuICAgIH1cbiAgfVxuXG4gIC8vIFNjcm9sbCBhIGdpdmVuIHBvc2l0aW9uIGludG8gdmlldyAoaW1tZWRpYXRlbHkpLCB2ZXJpZnlpbmcgdGhhdFxuICAvLyBpdCBhY3R1YWxseSBiZWNhbWUgdmlzaWJsZSAoYXMgbGluZSBoZWlnaHRzIGFyZSBhY2N1cmF0ZWx5XG4gIC8vIG1lYXN1cmVkLCB0aGUgcG9zaXRpb24gb2Ygc29tZXRoaW5nIG1heSAnZHJpZnQnIGR1cmluZyBkcmF3aW5nKS5cbiAgZnVuY3Rpb24gc2Nyb2xsUG9zSW50b1ZpZXcoY20sIHBvcywgZW5kLCBtYXJnaW4pIHtcbiAgICBpZiAobWFyZ2luID09IG51bGwpIG1hcmdpbiA9IDA7XG4gICAgZm9yICh2YXIgbGltaXQgPSAwOyBsaW1pdCA8IDU7IGxpbWl0KyspIHtcbiAgICAgIHZhciBjaGFuZ2VkID0gZmFsc2UsIGNvb3JkcyA9IGN1cnNvckNvb3JkcyhjbSwgcG9zKTtcbiAgICAgIHZhciBlbmRDb29yZHMgPSAhZW5kIHx8IGVuZCA9PSBwb3MgPyBjb29yZHMgOiBjdXJzb3JDb29yZHMoY20sIGVuZCk7XG4gICAgICB2YXIgc2Nyb2xsUG9zID0gY2FsY3VsYXRlU2Nyb2xsUG9zKGNtLCBNYXRoLm1pbihjb29yZHMubGVmdCwgZW5kQ29vcmRzLmxlZnQpLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBNYXRoLm1pbihjb29yZHMudG9wLCBlbmRDb29yZHMudG9wKSAtIG1hcmdpbixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgTWF0aC5tYXgoY29vcmRzLmxlZnQsIGVuZENvb3Jkcy5sZWZ0KSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgTWF0aC5tYXgoY29vcmRzLmJvdHRvbSwgZW5kQ29vcmRzLmJvdHRvbSkgKyBtYXJnaW4pO1xuICAgICAgdmFyIHN0YXJ0VG9wID0gY20uZG9jLnNjcm9sbFRvcCwgc3RhcnRMZWZ0ID0gY20uZG9jLnNjcm9sbExlZnQ7XG4gICAgICBpZiAoc2Nyb2xsUG9zLnNjcm9sbFRvcCAhPSBudWxsKSB7XG4gICAgICAgIHNldFNjcm9sbFRvcChjbSwgc2Nyb2xsUG9zLnNjcm9sbFRvcCk7XG4gICAgICAgIGlmIChNYXRoLmFicyhjbS5kb2Muc2Nyb2xsVG9wIC0gc3RhcnRUb3ApID4gMSkgY2hhbmdlZCA9IHRydWU7XG4gICAgICB9XG4gICAgICBpZiAoc2Nyb2xsUG9zLnNjcm9sbExlZnQgIT0gbnVsbCkge1xuICAgICAgICBzZXRTY3JvbGxMZWZ0KGNtLCBzY3JvbGxQb3Muc2Nyb2xsTGVmdCk7XG4gICAgICAgIGlmIChNYXRoLmFicyhjbS5kb2Muc2Nyb2xsTGVmdCAtIHN0YXJ0TGVmdCkgPiAxKSBjaGFuZ2VkID0gdHJ1ZTtcbiAgICAgIH1cbiAgICAgIGlmICghY2hhbmdlZCkgYnJlYWs7XG4gICAgfVxuICAgIHJldHVybiBjb29yZHM7XG4gIH1cblxuICAvLyBTY3JvbGwgYSBnaXZlbiBzZXQgb2YgY29vcmRpbmF0ZXMgaW50byB2aWV3IChpbW1lZGlhdGVseSkuXG4gIGZ1bmN0aW9uIHNjcm9sbEludG9WaWV3KGNtLCB4MSwgeTEsIHgyLCB5Mikge1xuICAgIHZhciBzY3JvbGxQb3MgPSBjYWxjdWxhdGVTY3JvbGxQb3MoY20sIHgxLCB5MSwgeDIsIHkyKTtcbiAgICBpZiAoc2Nyb2xsUG9zLnNjcm9sbFRvcCAhPSBudWxsKSBzZXRTY3JvbGxUb3AoY20sIHNjcm9sbFBvcy5zY3JvbGxUb3ApO1xuICAgIGlmIChzY3JvbGxQb3Muc2Nyb2xsTGVmdCAhPSBudWxsKSBzZXRTY3JvbGxMZWZ0KGNtLCBzY3JvbGxQb3Muc2Nyb2xsTGVmdCk7XG4gIH1cblxuICAvLyBDYWxjdWxhdGUgYSBuZXcgc2Nyb2xsIHBvc2l0aW9uIG5lZWRlZCB0byBzY3JvbGwgdGhlIGdpdmVuXG4gIC8vIHJlY3RhbmdsZSBpbnRvIHZpZXcuIFJldHVybnMgYW4gb2JqZWN0IHdpdGggc2Nyb2xsVG9wIGFuZFxuICAvLyBzY3JvbGxMZWZ0IHByb3BlcnRpZXMuIFdoZW4gdGhlc2UgYXJlIHVuZGVmaW5lZCwgdGhlXG4gIC8vIHZlcnRpY2FsL2hvcml6b250YWwgcG9zaXRpb24gZG9lcyBub3QgbmVlZCB0byBiZSBhZGp1c3RlZC5cbiAgZnVuY3Rpb24gY2FsY3VsYXRlU2Nyb2xsUG9zKGNtLCB4MSwgeTEsIHgyLCB5Mikge1xuICAgIHZhciBkaXNwbGF5ID0gY20uZGlzcGxheSwgc25hcE1hcmdpbiA9IHRleHRIZWlnaHQoY20uZGlzcGxheSk7XG4gICAgaWYgKHkxIDwgMCkgeTEgPSAwO1xuICAgIHZhciBzY3JlZW50b3AgPSBjbS5jdXJPcCAmJiBjbS5jdXJPcC5zY3JvbGxUb3AgIT0gbnVsbCA/IGNtLmN1ck9wLnNjcm9sbFRvcCA6IGRpc3BsYXkuc2Nyb2xsZXIuc2Nyb2xsVG9wO1xuICAgIHZhciBzY3JlZW4gPSBkaXNwbGF5SGVpZ2h0KGNtKSwgcmVzdWx0ID0ge307XG4gICAgaWYgKHkyIC0geTEgPiBzY3JlZW4pIHkyID0geTEgKyBzY3JlZW47XG4gICAgdmFyIGRvY0JvdHRvbSA9IGNtLmRvYy5oZWlnaHQgKyBwYWRkaW5nVmVydChkaXNwbGF5KTtcbiAgICB2YXIgYXRUb3AgPSB5MSA8IHNuYXBNYXJnaW4sIGF0Qm90dG9tID0geTIgPiBkb2NCb3R0b20gLSBzbmFwTWFyZ2luO1xuICAgIGlmICh5MSA8IHNjcmVlbnRvcCkge1xuICAgICAgcmVzdWx0LnNjcm9sbFRvcCA9IGF0VG9wID8gMCA6IHkxO1xuICAgIH0gZWxzZSBpZiAoeTIgPiBzY3JlZW50b3AgKyBzY3JlZW4pIHtcbiAgICAgIHZhciBuZXdUb3AgPSBNYXRoLm1pbih5MSwgKGF0Qm90dG9tID8gZG9jQm90dG9tIDogeTIpIC0gc2NyZWVuKTtcbiAgICAgIGlmIChuZXdUb3AgIT0gc2NyZWVudG9wKSByZXN1bHQuc2Nyb2xsVG9wID0gbmV3VG9wO1xuICAgIH1cblxuICAgIHZhciBzY3JlZW5sZWZ0ID0gY20uY3VyT3AgJiYgY20uY3VyT3Auc2Nyb2xsTGVmdCAhPSBudWxsID8gY20uY3VyT3Auc2Nyb2xsTGVmdCA6IGRpc3BsYXkuc2Nyb2xsZXIuc2Nyb2xsTGVmdDtcbiAgICB2YXIgc2NyZWVudyA9IGRpc3BsYXlXaWR0aChjbSkgLSAoY20ub3B0aW9ucy5maXhlZEd1dHRlciA/IGRpc3BsYXkuZ3V0dGVycy5vZmZzZXRXaWR0aCA6IDApO1xuICAgIHZhciB0b29XaWRlID0geDIgLSB4MSA+IHNjcmVlbnc7XG4gICAgaWYgKHRvb1dpZGUpIHgyID0geDEgKyBzY3JlZW53O1xuICAgIGlmICh4MSA8IDEwKVxuICAgICAgcmVzdWx0LnNjcm9sbExlZnQgPSAwO1xuICAgIGVsc2UgaWYgKHgxIDwgc2NyZWVubGVmdClcbiAgICAgIHJlc3VsdC5zY3JvbGxMZWZ0ID0gTWF0aC5tYXgoMCwgeDEgLSAodG9vV2lkZSA/IDAgOiAxMCkpO1xuICAgIGVsc2UgaWYgKHgyID4gc2NyZWVudyArIHNjcmVlbmxlZnQgLSAzKVxuICAgICAgcmVzdWx0LnNjcm9sbExlZnQgPSB4MiArICh0b29XaWRlID8gMCA6IDEwKSAtIHNjcmVlbnc7XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuXG4gIC8vIFN0b3JlIGEgcmVsYXRpdmUgYWRqdXN0bWVudCB0byB0aGUgc2Nyb2xsIHBvc2l0aW9uIGluIHRoZSBjdXJyZW50XG4gIC8vIG9wZXJhdGlvbiAodG8gYmUgYXBwbGllZCB3aGVuIHRoZSBvcGVyYXRpb24gZmluaXNoZXMpLlxuICBmdW5jdGlvbiBhZGRUb1Njcm9sbFBvcyhjbSwgbGVmdCwgdG9wKSB7XG4gICAgaWYgKGxlZnQgIT0gbnVsbCB8fCB0b3AgIT0gbnVsbCkgcmVzb2x2ZVNjcm9sbFRvUG9zKGNtKTtcbiAgICBpZiAobGVmdCAhPSBudWxsKVxuICAgICAgY20uY3VyT3Auc2Nyb2xsTGVmdCA9IChjbS5jdXJPcC5zY3JvbGxMZWZ0ID09IG51bGwgPyBjbS5kb2Muc2Nyb2xsTGVmdCA6IGNtLmN1ck9wLnNjcm9sbExlZnQpICsgbGVmdDtcbiAgICBpZiAodG9wICE9IG51bGwpXG4gICAgICBjbS5jdXJPcC5zY3JvbGxUb3AgPSAoY20uY3VyT3Auc2Nyb2xsVG9wID09IG51bGwgPyBjbS5kb2Muc2Nyb2xsVG9wIDogY20uY3VyT3Auc2Nyb2xsVG9wKSArIHRvcDtcbiAgfVxuXG4gIC8vIE1ha2Ugc3VyZSB0aGF0IGF0IHRoZSBlbmQgb2YgdGhlIG9wZXJhdGlvbiB0aGUgY3VycmVudCBjdXJzb3IgaXNcbiAgLy8gc2hvd24uXG4gIGZ1bmN0aW9uIGVuc3VyZUN1cnNvclZpc2libGUoY20pIHtcbiAgICByZXNvbHZlU2Nyb2xsVG9Qb3MoY20pO1xuICAgIHZhciBjdXIgPSBjbS5nZXRDdXJzb3IoKSwgZnJvbSA9IGN1ciwgdG8gPSBjdXI7XG4gICAgaWYgKCFjbS5vcHRpb25zLmxpbmVXcmFwcGluZykge1xuICAgICAgZnJvbSA9IGN1ci5jaCA/IFBvcyhjdXIubGluZSwgY3VyLmNoIC0gMSkgOiBjdXI7XG4gICAgICB0byA9IFBvcyhjdXIubGluZSwgY3VyLmNoICsgMSk7XG4gICAgfVxuICAgIGNtLmN1ck9wLnNjcm9sbFRvUG9zID0ge2Zyb206IGZyb20sIHRvOiB0bywgbWFyZ2luOiBjbS5vcHRpb25zLmN1cnNvclNjcm9sbE1hcmdpbiwgaXNDdXJzb3I6IHRydWV9O1xuICB9XG5cbiAgLy8gV2hlbiBhbiBvcGVyYXRpb24gaGFzIGl0cyBzY3JvbGxUb1BvcyBwcm9wZXJ0eSBzZXQsIGFuZCBhbm90aGVyXG4gIC8vIHNjcm9sbCBhY3Rpb24gaXMgYXBwbGllZCBiZWZvcmUgdGhlIGVuZCBvZiB0aGUgb3BlcmF0aW9uLCB0aGlzXG4gIC8vICdzaW11bGF0ZXMnIHNjcm9sbGluZyB0aGF0IHBvc2l0aW9uIGludG8gdmlldyBpbiBhIGNoZWFwIHdheSwgc29cbiAgLy8gdGhhdCB0aGUgZWZmZWN0IG9mIGludGVybWVkaWF0ZSBzY3JvbGwgY29tbWFuZHMgaXMgbm90IGlnbm9yZWQuXG4gIGZ1bmN0aW9uIHJlc29sdmVTY3JvbGxUb1BvcyhjbSkge1xuICAgIHZhciByYW5nZSA9IGNtLmN1ck9wLnNjcm9sbFRvUG9zO1xuICAgIGlmIChyYW5nZSkge1xuICAgICAgY20uY3VyT3Auc2Nyb2xsVG9Qb3MgPSBudWxsO1xuICAgICAgdmFyIGZyb20gPSBlc3RpbWF0ZUNvb3JkcyhjbSwgcmFuZ2UuZnJvbSksIHRvID0gZXN0aW1hdGVDb29yZHMoY20sIHJhbmdlLnRvKTtcbiAgICAgIHZhciBzUG9zID0gY2FsY3VsYXRlU2Nyb2xsUG9zKGNtLCBNYXRoLm1pbihmcm9tLmxlZnQsIHRvLmxlZnQpLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgTWF0aC5taW4oZnJvbS50b3AsIHRvLnRvcCkgLSByYW5nZS5tYXJnaW4sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBNYXRoLm1heChmcm9tLnJpZ2h0LCB0by5yaWdodCksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBNYXRoLm1heChmcm9tLmJvdHRvbSwgdG8uYm90dG9tKSArIHJhbmdlLm1hcmdpbik7XG4gICAgICBjbS5zY3JvbGxUbyhzUG9zLnNjcm9sbExlZnQsIHNQb3Muc2Nyb2xsVG9wKTtcbiAgICB9XG4gIH1cblxuICAvLyBBUEkgVVRJTElUSUVTXG5cbiAgLy8gSW5kZW50IHRoZSBnaXZlbiBsaW5lLiBUaGUgaG93IHBhcmFtZXRlciBjYW4gYmUgXCJzbWFydFwiLFxuICAvLyBcImFkZFwiL251bGwsIFwic3VidHJhY3RcIiwgb3IgXCJwcmV2XCIuIFdoZW4gYWdncmVzc2l2ZSBpcyBmYWxzZVxuICAvLyAodHlwaWNhbGx5IHNldCB0byB0cnVlIGZvciBmb3JjZWQgc2luZ2xlLWxpbmUgaW5kZW50cyksIGVtcHR5XG4gIC8vIGxpbmVzIGFyZSBub3QgaW5kZW50ZWQsIGFuZCBwbGFjZXMgd2hlcmUgdGhlIG1vZGUgcmV0dXJucyBQYXNzXG4gIC8vIGFyZSBsZWZ0IGFsb25lLlxuICBmdW5jdGlvbiBpbmRlbnRMaW5lKGNtLCBuLCBob3csIGFnZ3Jlc3NpdmUpIHtcbiAgICB2YXIgZG9jID0gY20uZG9jLCBzdGF0ZTtcbiAgICBpZiAoaG93ID09IG51bGwpIGhvdyA9IFwiYWRkXCI7XG4gICAgaWYgKGhvdyA9PSBcInNtYXJ0XCIpIHtcbiAgICAgIC8vIEZhbGwgYmFjayB0byBcInByZXZcIiB3aGVuIHRoZSBtb2RlIGRvZXNuJ3QgaGF2ZSBhbiBpbmRlbnRhdGlvblxuICAgICAgLy8gbWV0aG9kLlxuICAgICAgaWYgKCFkb2MubW9kZS5pbmRlbnQpIGhvdyA9IFwicHJldlwiO1xuICAgICAgZWxzZSBzdGF0ZSA9IGdldFN0YXRlQmVmb3JlKGNtLCBuKTtcbiAgICB9XG5cbiAgICB2YXIgdGFiU2l6ZSA9IGNtLm9wdGlvbnMudGFiU2l6ZTtcbiAgICB2YXIgbGluZSA9IGdldExpbmUoZG9jLCBuKSwgY3VyU3BhY2UgPSBjb3VudENvbHVtbihsaW5lLnRleHQsIG51bGwsIHRhYlNpemUpO1xuICAgIGlmIChsaW5lLnN0YXRlQWZ0ZXIpIGxpbmUuc3RhdGVBZnRlciA9IG51bGw7XG4gICAgdmFyIGN1clNwYWNlU3RyaW5nID0gbGluZS50ZXh0Lm1hdGNoKC9eXFxzKi8pWzBdLCBpbmRlbnRhdGlvbjtcbiAgICBpZiAoIWFnZ3Jlc3NpdmUgJiYgIS9cXFMvLnRlc3QobGluZS50ZXh0KSkge1xuICAgICAgaW5kZW50YXRpb24gPSAwO1xuICAgICAgaG93ID0gXCJub3RcIjtcbiAgICB9IGVsc2UgaWYgKGhvdyA9PSBcInNtYXJ0XCIpIHtcbiAgICAgIGluZGVudGF0aW9uID0gZG9jLm1vZGUuaW5kZW50KHN0YXRlLCBsaW5lLnRleHQuc2xpY2UoY3VyU3BhY2VTdHJpbmcubGVuZ3RoKSwgbGluZS50ZXh0KTtcbiAgICAgIGlmIChpbmRlbnRhdGlvbiA9PSBQYXNzIHx8IGluZGVudGF0aW9uID4gMTUwKSB7XG4gICAgICAgIGlmICghYWdncmVzc2l2ZSkgcmV0dXJuO1xuICAgICAgICBob3cgPSBcInByZXZcIjtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKGhvdyA9PSBcInByZXZcIikge1xuICAgICAgaWYgKG4gPiBkb2MuZmlyc3QpIGluZGVudGF0aW9uID0gY291bnRDb2x1bW4oZ2V0TGluZShkb2MsIG4tMSkudGV4dCwgbnVsbCwgdGFiU2l6ZSk7XG4gICAgICBlbHNlIGluZGVudGF0aW9uID0gMDtcbiAgICB9IGVsc2UgaWYgKGhvdyA9PSBcImFkZFwiKSB7XG4gICAgICBpbmRlbnRhdGlvbiA9IGN1clNwYWNlICsgY20ub3B0aW9ucy5pbmRlbnRVbml0O1xuICAgIH0gZWxzZSBpZiAoaG93ID09IFwic3VidHJhY3RcIikge1xuICAgICAgaW5kZW50YXRpb24gPSBjdXJTcGFjZSAtIGNtLm9wdGlvbnMuaW5kZW50VW5pdDtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBob3cgPT0gXCJudW1iZXJcIikge1xuICAgICAgaW5kZW50YXRpb24gPSBjdXJTcGFjZSArIGhvdztcbiAgICB9XG4gICAgaW5kZW50YXRpb24gPSBNYXRoLm1heCgwLCBpbmRlbnRhdGlvbik7XG5cbiAgICB2YXIgaW5kZW50U3RyaW5nID0gXCJcIiwgcG9zID0gMDtcbiAgICBpZiAoY20ub3B0aW9ucy5pbmRlbnRXaXRoVGFicylcbiAgICAgIGZvciAodmFyIGkgPSBNYXRoLmZsb29yKGluZGVudGF0aW9uIC8gdGFiU2l6ZSk7IGk7IC0taSkge3BvcyArPSB0YWJTaXplOyBpbmRlbnRTdHJpbmcgKz0gXCJcXHRcIjt9XG4gICAgaWYgKHBvcyA8IGluZGVudGF0aW9uKSBpbmRlbnRTdHJpbmcgKz0gc3BhY2VTdHIoaW5kZW50YXRpb24gLSBwb3MpO1xuXG4gICAgaWYgKGluZGVudFN0cmluZyAhPSBjdXJTcGFjZVN0cmluZykge1xuICAgICAgcmVwbGFjZVJhbmdlKGRvYywgaW5kZW50U3RyaW5nLCBQb3MobiwgMCksIFBvcyhuLCBjdXJTcGFjZVN0cmluZy5sZW5ndGgpLCBcIitpbnB1dFwiKTtcbiAgICAgIGxpbmUuc3RhdGVBZnRlciA9IG51bGw7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gRW5zdXJlIHRoYXQsIGlmIHRoZSBjdXJzb3Igd2FzIGluIHRoZSB3aGl0ZXNwYWNlIGF0IHRoZSBzdGFydFxuICAgICAgLy8gb2YgdGhlIGxpbmUsIGl0IGlzIG1vdmVkIHRvIHRoZSBlbmQgb2YgdGhhdCBzcGFjZS5cbiAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgZG9jLnNlbC5yYW5nZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgdmFyIHJhbmdlID0gZG9jLnNlbC5yYW5nZXNbaV07XG4gICAgICAgIGlmIChyYW5nZS5oZWFkLmxpbmUgPT0gbiAmJiByYW5nZS5oZWFkLmNoIDwgY3VyU3BhY2VTdHJpbmcubGVuZ3RoKSB7XG4gICAgICAgICAgdmFyIHBvcyA9IFBvcyhuLCBjdXJTcGFjZVN0cmluZy5sZW5ndGgpO1xuICAgICAgICAgIHJlcGxhY2VPbmVTZWxlY3Rpb24oZG9jLCBpLCBuZXcgUmFuZ2UocG9zLCBwb3MpKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIFV0aWxpdHkgZm9yIGFwcGx5aW5nIGEgY2hhbmdlIHRvIGEgbGluZSBieSBoYW5kbGUgb3IgbnVtYmVyLFxuICAvLyByZXR1cm5pbmcgdGhlIG51bWJlciBhbmQgb3B0aW9uYWxseSByZWdpc3RlcmluZyB0aGUgbGluZSBhc1xuICAvLyBjaGFuZ2VkLlxuICBmdW5jdGlvbiBjaGFuZ2VMaW5lKGRvYywgaGFuZGxlLCBjaGFuZ2VUeXBlLCBvcCkge1xuICAgIHZhciBubyA9IGhhbmRsZSwgbGluZSA9IGhhbmRsZTtcbiAgICBpZiAodHlwZW9mIGhhbmRsZSA9PSBcIm51bWJlclwiKSBsaW5lID0gZ2V0TGluZShkb2MsIGNsaXBMaW5lKGRvYywgaGFuZGxlKSk7XG4gICAgZWxzZSBubyA9IGxpbmVObyhoYW5kbGUpO1xuICAgIGlmIChubyA9PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgICBpZiAob3AobGluZSwgbm8pICYmIGRvYy5jbSkgcmVnTGluZUNoYW5nZShkb2MuY20sIG5vLCBjaGFuZ2VUeXBlKTtcbiAgICByZXR1cm4gbGluZTtcbiAgfVxuXG4gIC8vIEhlbHBlciBmb3IgZGVsZXRpbmcgdGV4dCBuZWFyIHRoZSBzZWxlY3Rpb24ocyksIHVzZWQgdG8gaW1wbGVtZW50XG4gIC8vIGJhY2tzcGFjZSwgZGVsZXRlLCBhbmQgc2ltaWxhciBmdW5jdGlvbmFsaXR5LlxuICBmdW5jdGlvbiBkZWxldGVOZWFyU2VsZWN0aW9uKGNtLCBjb21wdXRlKSB7XG4gICAgdmFyIHJhbmdlcyA9IGNtLmRvYy5zZWwucmFuZ2VzLCBraWxsID0gW107XG4gICAgLy8gQnVpbGQgdXAgYSBzZXQgb2YgcmFuZ2VzIHRvIGtpbGwgZmlyc3QsIG1lcmdpbmcgb3ZlcmxhcHBpbmdcbiAgICAvLyByYW5nZXMuXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCByYW5nZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgIHZhciB0b0tpbGwgPSBjb21wdXRlKHJhbmdlc1tpXSk7XG4gICAgICB3aGlsZSAoa2lsbC5sZW5ndGggJiYgY21wKHRvS2lsbC5mcm9tLCBsc3Qoa2lsbCkudG8pIDw9IDApIHtcbiAgICAgICAgdmFyIHJlcGxhY2VkID0ga2lsbC5wb3AoKTtcbiAgICAgICAgaWYgKGNtcChyZXBsYWNlZC5mcm9tLCB0b0tpbGwuZnJvbSkgPCAwKSB7XG4gICAgICAgICAgdG9LaWxsLmZyb20gPSByZXBsYWNlZC5mcm9tO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBraWxsLnB1c2godG9LaWxsKTtcbiAgICB9XG4gICAgLy8gTmV4dCwgcmVtb3ZlIHRob3NlIGFjdHVhbCByYW5nZXMuXG4gICAgcnVuSW5PcChjbSwgZnVuY3Rpb24oKSB7XG4gICAgICBmb3IgKHZhciBpID0ga2lsbC5sZW5ndGggLSAxOyBpID49IDA7IGktLSlcbiAgICAgICAgcmVwbGFjZVJhbmdlKGNtLmRvYywgXCJcIiwga2lsbFtpXS5mcm9tLCBraWxsW2ldLnRvLCBcIitkZWxldGVcIik7XG4gICAgICBlbnN1cmVDdXJzb3JWaXNpYmxlKGNtKTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIFVzZWQgZm9yIGhvcml6b250YWwgcmVsYXRpdmUgbW90aW9uLiBEaXIgaXMgLTEgb3IgMSAobGVmdCBvclxuICAvLyByaWdodCksIHVuaXQgY2FuIGJlIFwiY2hhclwiLCBcImNvbHVtblwiIChsaWtlIGNoYXIsIGJ1dCBkb2Vzbid0XG4gIC8vIGNyb3NzIGxpbmUgYm91bmRhcmllcyksIFwid29yZFwiIChhY3Jvc3MgbmV4dCB3b3JkKSwgb3IgXCJncm91cFwiICh0b1xuICAvLyB0aGUgc3RhcnQgb2YgbmV4dCBncm91cCBvZiB3b3JkIG9yIG5vbi13b3JkLW5vbi13aGl0ZXNwYWNlXG4gIC8vIGNoYXJzKS4gVGhlIHZpc3VhbGx5IHBhcmFtIGNvbnRyb2xzIHdoZXRoZXIsIGluIHJpZ2h0LXRvLWxlZnRcbiAgLy8gdGV4dCwgZGlyZWN0aW9uIDEgbWVhbnMgdG8gbW92ZSB0b3dhcmRzIHRoZSBuZXh0IGluZGV4IGluIHRoZVxuICAvLyBzdHJpbmcsIG9yIHRvd2FyZHMgdGhlIGNoYXJhY3RlciB0byB0aGUgcmlnaHQgb2YgdGhlIGN1cnJlbnRcbiAgLy8gcG9zaXRpb24uIFRoZSByZXN1bHRpbmcgcG9zaXRpb24gd2lsbCBoYXZlIGEgaGl0U2lkZT10cnVlXG4gIC8vIHByb3BlcnR5IGlmIGl0IHJlYWNoZWQgdGhlIGVuZCBvZiB0aGUgZG9jdW1lbnQuXG4gIGZ1bmN0aW9uIGZpbmRQb3NIKGRvYywgcG9zLCBkaXIsIHVuaXQsIHZpc3VhbGx5KSB7XG4gICAgdmFyIGxpbmUgPSBwb3MubGluZSwgY2ggPSBwb3MuY2gsIG9yaWdEaXIgPSBkaXI7XG4gICAgdmFyIGxpbmVPYmogPSBnZXRMaW5lKGRvYywgbGluZSk7XG4gICAgdmFyIHBvc3NpYmxlID0gdHJ1ZTtcbiAgICBmdW5jdGlvbiBmaW5kTmV4dExpbmUoKSB7XG4gICAgICB2YXIgbCA9IGxpbmUgKyBkaXI7XG4gICAgICBpZiAobCA8IGRvYy5maXJzdCB8fCBsID49IGRvYy5maXJzdCArIGRvYy5zaXplKSByZXR1cm4gKHBvc3NpYmxlID0gZmFsc2UpO1xuICAgICAgbGluZSA9IGw7XG4gICAgICByZXR1cm4gbGluZU9iaiA9IGdldExpbmUoZG9jLCBsKTtcbiAgICB9XG4gICAgZnVuY3Rpb24gbW92ZU9uY2UoYm91bmRUb0xpbmUpIHtcbiAgICAgIHZhciBuZXh0ID0gKHZpc3VhbGx5ID8gbW92ZVZpc3VhbGx5IDogbW92ZUxvZ2ljYWxseSkobGluZU9iaiwgY2gsIGRpciwgdHJ1ZSk7XG4gICAgICBpZiAobmV4dCA9PSBudWxsKSB7XG4gICAgICAgIGlmICghYm91bmRUb0xpbmUgJiYgZmluZE5leHRMaW5lKCkpIHtcbiAgICAgICAgICBpZiAodmlzdWFsbHkpIGNoID0gKGRpciA8IDAgPyBsaW5lUmlnaHQgOiBsaW5lTGVmdCkobGluZU9iaik7XG4gICAgICAgICAgZWxzZSBjaCA9IGRpciA8IDAgPyBsaW5lT2JqLnRleHQubGVuZ3RoIDogMDtcbiAgICAgICAgfSBlbHNlIHJldHVybiAocG9zc2libGUgPSBmYWxzZSk7XG4gICAgICB9IGVsc2UgY2ggPSBuZXh0O1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgaWYgKHVuaXQgPT0gXCJjaGFyXCIpIG1vdmVPbmNlKCk7XG4gICAgZWxzZSBpZiAodW5pdCA9PSBcImNvbHVtblwiKSBtb3ZlT25jZSh0cnVlKTtcbiAgICBlbHNlIGlmICh1bml0ID09IFwid29yZFwiIHx8IHVuaXQgPT0gXCJncm91cFwiKSB7XG4gICAgICB2YXIgc2F3VHlwZSA9IG51bGwsIGdyb3VwID0gdW5pdCA9PSBcImdyb3VwXCI7XG4gICAgICB2YXIgaGVscGVyID0gZG9jLmNtICYmIGRvYy5jbS5nZXRIZWxwZXIocG9zLCBcIndvcmRDaGFyc1wiKTtcbiAgICAgIGZvciAodmFyIGZpcnN0ID0gdHJ1ZTs7IGZpcnN0ID0gZmFsc2UpIHtcbiAgICAgICAgaWYgKGRpciA8IDAgJiYgIW1vdmVPbmNlKCFmaXJzdCkpIGJyZWFrO1xuICAgICAgICB2YXIgY3VyID0gbGluZU9iai50ZXh0LmNoYXJBdChjaCkgfHwgXCJcXG5cIjtcbiAgICAgICAgdmFyIHR5cGUgPSBpc1dvcmRDaGFyKGN1ciwgaGVscGVyKSA/IFwid1wiXG4gICAgICAgICAgOiBncm91cCAmJiBjdXIgPT0gXCJcXG5cIiA/IFwiblwiXG4gICAgICAgICAgOiAhZ3JvdXAgfHwgL1xccy8udGVzdChjdXIpID8gbnVsbFxuICAgICAgICAgIDogXCJwXCI7XG4gICAgICAgIGlmIChncm91cCAmJiAhZmlyc3QgJiYgIXR5cGUpIHR5cGUgPSBcInNcIjtcbiAgICAgICAgaWYgKHNhd1R5cGUgJiYgc2F3VHlwZSAhPSB0eXBlKSB7XG4gICAgICAgICAgaWYgKGRpciA8IDApIHtkaXIgPSAxOyBtb3ZlT25jZSgpO31cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0eXBlKSBzYXdUeXBlID0gdHlwZTtcbiAgICAgICAgaWYgKGRpciA+IDAgJiYgIW1vdmVPbmNlKCFmaXJzdCkpIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgICB2YXIgcmVzdWx0ID0gc2tpcEF0b21pYyhkb2MsIFBvcyhsaW5lLCBjaCksIG9yaWdEaXIsIHRydWUpO1xuICAgIGlmICghcG9zc2libGUpIHJlc3VsdC5oaXRTaWRlID0gdHJ1ZTtcbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgLy8gRm9yIHJlbGF0aXZlIHZlcnRpY2FsIG1vdmVtZW50LiBEaXIgbWF5IGJlIC0xIG9yIDEuIFVuaXQgY2FuIGJlXG4gIC8vIFwicGFnZVwiIG9yIFwibGluZVwiLiBUaGUgcmVzdWx0aW5nIHBvc2l0aW9uIHdpbGwgaGF2ZSBhIGhpdFNpZGU9dHJ1ZVxuICAvLyBwcm9wZXJ0eSBpZiBpdCByZWFjaGVkIHRoZSBlbmQgb2YgdGhlIGRvY3VtZW50LlxuICBmdW5jdGlvbiBmaW5kUG9zVihjbSwgcG9zLCBkaXIsIHVuaXQpIHtcbiAgICB2YXIgZG9jID0gY20uZG9jLCB4ID0gcG9zLmxlZnQsIHk7XG4gICAgaWYgKHVuaXQgPT0gXCJwYWdlXCIpIHtcbiAgICAgIHZhciBwYWdlU2l6ZSA9IE1hdGgubWluKGNtLmRpc3BsYXkud3JhcHBlci5jbGllbnRIZWlnaHQsIHdpbmRvdy5pbm5lckhlaWdodCB8fCBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuY2xpZW50SGVpZ2h0KTtcbiAgICAgIHkgPSBwb3MudG9wICsgZGlyICogKHBhZ2VTaXplIC0gKGRpciA8IDAgPyAxLjUgOiAuNSkgKiB0ZXh0SGVpZ2h0KGNtLmRpc3BsYXkpKTtcbiAgICB9IGVsc2UgaWYgKHVuaXQgPT0gXCJsaW5lXCIpIHtcbiAgICAgIHkgPSBkaXIgPiAwID8gcG9zLmJvdHRvbSArIDMgOiBwb3MudG9wIC0gMztcbiAgICB9XG4gICAgZm9yICg7Oykge1xuICAgICAgdmFyIHRhcmdldCA9IGNvb3Jkc0NoYXIoY20sIHgsIHkpO1xuICAgICAgaWYgKCF0YXJnZXQub3V0c2lkZSkgYnJlYWs7XG4gICAgICBpZiAoZGlyIDwgMCA/IHkgPD0gMCA6IHkgPj0gZG9jLmhlaWdodCkgeyB0YXJnZXQuaGl0U2lkZSA9IHRydWU7IGJyZWFrOyB9XG4gICAgICB5ICs9IGRpciAqIDU7XG4gICAgfVxuICAgIHJldHVybiB0YXJnZXQ7XG4gIH1cblxuICAvLyBFRElUT1IgTUVUSE9EU1xuXG4gIC8vIFRoZSBwdWJsaWNseSB2aXNpYmxlIEFQSS4gTm90ZSB0aGF0IG1ldGhvZE9wKGYpIG1lYW5zXG4gIC8vICd3cmFwIGYgaW4gYW4gb3BlcmF0aW9uLCBwZXJmb3JtZWQgb24gaXRzIGB0aGlzYCBwYXJhbWV0ZXInLlxuXG4gIC8vIFRoaXMgaXMgbm90IHRoZSBjb21wbGV0ZSBzZXQgb2YgZWRpdG9yIG1ldGhvZHMuIE1vc3Qgb2YgdGhlXG4gIC8vIG1ldGhvZHMgZGVmaW5lZCBvbiB0aGUgRG9jIHR5cGUgYXJlIGFsc28gaW5qZWN0ZWQgaW50b1xuICAvLyBDb2RlTWlycm9yLnByb3RvdHlwZSwgZm9yIGJhY2t3YXJkcyBjb21wYXRpYmlsaXR5IGFuZFxuICAvLyBjb252ZW5pZW5jZS5cblxuICBDb2RlTWlycm9yLnByb3RvdHlwZSA9IHtcbiAgICBjb25zdHJ1Y3RvcjogQ29kZU1pcnJvcixcbiAgICBmb2N1czogZnVuY3Rpb24oKXt3aW5kb3cuZm9jdXMoKTsgdGhpcy5kaXNwbGF5LmlucHV0LmZvY3VzKCk7fSxcblxuICAgIHNldE9wdGlvbjogZnVuY3Rpb24ob3B0aW9uLCB2YWx1ZSkge1xuICAgICAgdmFyIG9wdGlvbnMgPSB0aGlzLm9wdGlvbnMsIG9sZCA9IG9wdGlvbnNbb3B0aW9uXTtcbiAgICAgIGlmIChvcHRpb25zW29wdGlvbl0gPT0gdmFsdWUgJiYgb3B0aW9uICE9IFwibW9kZVwiKSByZXR1cm47XG4gICAgICBvcHRpb25zW29wdGlvbl0gPSB2YWx1ZTtcbiAgICAgIGlmIChvcHRpb25IYW5kbGVycy5oYXNPd25Qcm9wZXJ0eShvcHRpb24pKVxuICAgICAgICBvcGVyYXRpb24odGhpcywgb3B0aW9uSGFuZGxlcnNbb3B0aW9uXSkodGhpcywgdmFsdWUsIG9sZCk7XG4gICAgfSxcblxuICAgIGdldE9wdGlvbjogZnVuY3Rpb24ob3B0aW9uKSB7cmV0dXJuIHRoaXMub3B0aW9uc1tvcHRpb25dO30sXG4gICAgZ2V0RG9jOiBmdW5jdGlvbigpIHtyZXR1cm4gdGhpcy5kb2M7fSxcblxuICAgIGFkZEtleU1hcDogZnVuY3Rpb24obWFwLCBib3R0b20pIHtcbiAgICAgIHRoaXMuc3RhdGUua2V5TWFwc1tib3R0b20gPyBcInB1c2hcIiA6IFwidW5zaGlmdFwiXShnZXRLZXlNYXAobWFwKSk7XG4gICAgfSxcbiAgICByZW1vdmVLZXlNYXA6IGZ1bmN0aW9uKG1hcCkge1xuICAgICAgdmFyIG1hcHMgPSB0aGlzLnN0YXRlLmtleU1hcHM7XG4gICAgICBmb3IgKHZhciBpID0gMDsgaSA8IG1hcHMubGVuZ3RoOyArK2kpXG4gICAgICAgIGlmIChtYXBzW2ldID09IG1hcCB8fCBtYXBzW2ldLm5hbWUgPT0gbWFwKSB7XG4gICAgICAgICAgbWFwcy5zcGxpY2UoaSwgMSk7XG4gICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cbiAgICB9LFxuXG4gICAgYWRkT3ZlcmxheTogbWV0aG9kT3AoZnVuY3Rpb24oc3BlYywgb3B0aW9ucykge1xuICAgICAgdmFyIG1vZGUgPSBzcGVjLnRva2VuID8gc3BlYyA6IENvZGVNaXJyb3IuZ2V0TW9kZSh0aGlzLm9wdGlvbnMsIHNwZWMpO1xuICAgICAgaWYgKG1vZGUuc3RhcnRTdGF0ZSkgdGhyb3cgbmV3IEVycm9yKFwiT3ZlcmxheXMgbWF5IG5vdCBiZSBzdGF0ZWZ1bC5cIik7XG4gICAgICB0aGlzLnN0YXRlLm92ZXJsYXlzLnB1c2goe21vZGU6IG1vZGUsIG1vZGVTcGVjOiBzcGVjLCBvcGFxdWU6IG9wdGlvbnMgJiYgb3B0aW9ucy5vcGFxdWV9KTtcbiAgICAgIHRoaXMuc3RhdGUubW9kZUdlbisrO1xuICAgICAgcmVnQ2hhbmdlKHRoaXMpO1xuICAgIH0pLFxuICAgIHJlbW92ZU92ZXJsYXk6IG1ldGhvZE9wKGZ1bmN0aW9uKHNwZWMpIHtcbiAgICAgIHZhciBvdmVybGF5cyA9IHRoaXMuc3RhdGUub3ZlcmxheXM7XG4gICAgICBmb3IgKHZhciBpID0gMDsgaSA8IG92ZXJsYXlzLmxlbmd0aDsgKytpKSB7XG4gICAgICAgIHZhciBjdXIgPSBvdmVybGF5c1tpXS5tb2RlU3BlYztcbiAgICAgICAgaWYgKGN1ciA9PSBzcGVjIHx8IHR5cGVvZiBzcGVjID09IFwic3RyaW5nXCIgJiYgY3VyLm5hbWUgPT0gc3BlYykge1xuICAgICAgICAgIG92ZXJsYXlzLnNwbGljZShpLCAxKTtcbiAgICAgICAgICB0aGlzLnN0YXRlLm1vZGVHZW4rKztcbiAgICAgICAgICByZWdDaGFuZ2UodGhpcyk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSksXG5cbiAgICBpbmRlbnRMaW5lOiBtZXRob2RPcChmdW5jdGlvbihuLCBkaXIsIGFnZ3Jlc3NpdmUpIHtcbiAgICAgIGlmICh0eXBlb2YgZGlyICE9IFwic3RyaW5nXCIgJiYgdHlwZW9mIGRpciAhPSBcIm51bWJlclwiKSB7XG4gICAgICAgIGlmIChkaXIgPT0gbnVsbCkgZGlyID0gdGhpcy5vcHRpb25zLnNtYXJ0SW5kZW50ID8gXCJzbWFydFwiIDogXCJwcmV2XCI7XG4gICAgICAgIGVsc2UgZGlyID0gZGlyID8gXCJhZGRcIiA6IFwic3VidHJhY3RcIjtcbiAgICAgIH1cbiAgICAgIGlmIChpc0xpbmUodGhpcy5kb2MsIG4pKSBpbmRlbnRMaW5lKHRoaXMsIG4sIGRpciwgYWdncmVzc2l2ZSk7XG4gICAgfSksXG4gICAgaW5kZW50U2VsZWN0aW9uOiBtZXRob2RPcChmdW5jdGlvbihob3cpIHtcbiAgICAgIHZhciByYW5nZXMgPSB0aGlzLmRvYy5zZWwucmFuZ2VzLCBlbmQgPSAtMTtcbiAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcmFuZ2VzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIHZhciByYW5nZSA9IHJhbmdlc1tpXTtcbiAgICAgICAgaWYgKCFyYW5nZS5lbXB0eSgpKSB7XG4gICAgICAgICAgdmFyIGZyb20gPSByYW5nZS5mcm9tKCksIHRvID0gcmFuZ2UudG8oKTtcbiAgICAgICAgICB2YXIgc3RhcnQgPSBNYXRoLm1heChlbmQsIGZyb20ubGluZSk7XG4gICAgICAgICAgZW5kID0gTWF0aC5taW4odGhpcy5sYXN0TGluZSgpLCB0by5saW5lIC0gKHRvLmNoID8gMCA6IDEpKSArIDE7XG4gICAgICAgICAgZm9yICh2YXIgaiA9IHN0YXJ0OyBqIDwgZW5kOyArK2opXG4gICAgICAgICAgICBpbmRlbnRMaW5lKHRoaXMsIGosIGhvdyk7XG4gICAgICAgICAgdmFyIG5ld1JhbmdlcyA9IHRoaXMuZG9jLnNlbC5yYW5nZXM7XG4gICAgICAgICAgaWYgKGZyb20uY2ggPT0gMCAmJiByYW5nZXMubGVuZ3RoID09IG5ld1Jhbmdlcy5sZW5ndGggJiYgbmV3UmFuZ2VzW2ldLmZyb20oKS5jaCA+IDApXG4gICAgICAgICAgICByZXBsYWNlT25lU2VsZWN0aW9uKHRoaXMuZG9jLCBpLCBuZXcgUmFuZ2UoZnJvbSwgbmV3UmFuZ2VzW2ldLnRvKCkpLCBzZWxfZG9udFNjcm9sbCk7XG4gICAgICAgIH0gZWxzZSBpZiAocmFuZ2UuaGVhZC5saW5lID4gZW5kKSB7XG4gICAgICAgICAgaW5kZW50TGluZSh0aGlzLCByYW5nZS5oZWFkLmxpbmUsIGhvdywgdHJ1ZSk7XG4gICAgICAgICAgZW5kID0gcmFuZ2UuaGVhZC5saW5lO1xuICAgICAgICAgIGlmIChpID09IHRoaXMuZG9jLnNlbC5wcmltSW5kZXgpIGVuc3VyZUN1cnNvclZpc2libGUodGhpcyk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KSxcblxuICAgIC8vIEZldGNoIHRoZSBwYXJzZXIgdG9rZW4gZm9yIGEgZ2l2ZW4gY2hhcmFjdGVyLiBVc2VmdWwgZm9yIGhhY2tzXG4gICAgLy8gdGhhdCB3YW50IHRvIGluc3BlY3QgdGhlIG1vZGUgc3RhdGUgKHNheSwgZm9yIGNvbXBsZXRpb24pLlxuICAgIGdldFRva2VuQXQ6IGZ1bmN0aW9uKHBvcywgcHJlY2lzZSkge1xuICAgICAgcmV0dXJuIHRha2VUb2tlbih0aGlzLCBwb3MsIHByZWNpc2UpO1xuICAgIH0sXG5cbiAgICBnZXRMaW5lVG9rZW5zOiBmdW5jdGlvbihsaW5lLCBwcmVjaXNlKSB7XG4gICAgICByZXR1cm4gdGFrZVRva2VuKHRoaXMsIFBvcyhsaW5lKSwgcHJlY2lzZSwgdHJ1ZSk7XG4gICAgfSxcblxuICAgIGdldFRva2VuVHlwZUF0OiBmdW5jdGlvbihwb3MpIHtcbiAgICAgIHBvcyA9IGNsaXBQb3ModGhpcy5kb2MsIHBvcyk7XG4gICAgICB2YXIgc3R5bGVzID0gZ2V0TGluZVN0eWxlcyh0aGlzLCBnZXRMaW5lKHRoaXMuZG9jLCBwb3MubGluZSkpO1xuICAgICAgdmFyIGJlZm9yZSA9IDAsIGFmdGVyID0gKHN0eWxlcy5sZW5ndGggLSAxKSAvIDIsIGNoID0gcG9zLmNoO1xuICAgICAgdmFyIHR5cGU7XG4gICAgICBpZiAoY2ggPT0gMCkgdHlwZSA9IHN0eWxlc1syXTtcbiAgICAgIGVsc2UgZm9yICg7Oykge1xuICAgICAgICB2YXIgbWlkID0gKGJlZm9yZSArIGFmdGVyKSA+PiAxO1xuICAgICAgICBpZiAoKG1pZCA/IHN0eWxlc1ttaWQgKiAyIC0gMV0gOiAwKSA+PSBjaCkgYWZ0ZXIgPSBtaWQ7XG4gICAgICAgIGVsc2UgaWYgKHN0eWxlc1ttaWQgKiAyICsgMV0gPCBjaCkgYmVmb3JlID0gbWlkICsgMTtcbiAgICAgICAgZWxzZSB7IHR5cGUgPSBzdHlsZXNbbWlkICogMiArIDJdOyBicmVhazsgfVxuICAgICAgfVxuICAgICAgdmFyIGN1dCA9IHR5cGUgPyB0eXBlLmluZGV4T2YoXCJjbS1vdmVybGF5IFwiKSA6IC0xO1xuICAgICAgcmV0dXJuIGN1dCA8IDAgPyB0eXBlIDogY3V0ID09IDAgPyBudWxsIDogdHlwZS5zbGljZSgwLCBjdXQgLSAxKTtcbiAgICB9LFxuXG4gICAgZ2V0TW9kZUF0OiBmdW5jdGlvbihwb3MpIHtcbiAgICAgIHZhciBtb2RlID0gdGhpcy5kb2MubW9kZTtcbiAgICAgIGlmICghbW9kZS5pbm5lck1vZGUpIHJldHVybiBtb2RlO1xuICAgICAgcmV0dXJuIENvZGVNaXJyb3IuaW5uZXJNb2RlKG1vZGUsIHRoaXMuZ2V0VG9rZW5BdChwb3MpLnN0YXRlKS5tb2RlO1xuICAgIH0sXG5cbiAgICBnZXRIZWxwZXI6IGZ1bmN0aW9uKHBvcywgdHlwZSkge1xuICAgICAgcmV0dXJuIHRoaXMuZ2V0SGVscGVycyhwb3MsIHR5cGUpWzBdO1xuICAgIH0sXG5cbiAgICBnZXRIZWxwZXJzOiBmdW5jdGlvbihwb3MsIHR5cGUpIHtcbiAgICAgIHZhciBmb3VuZCA9IFtdO1xuICAgICAgaWYgKCFoZWxwZXJzLmhhc093blByb3BlcnR5KHR5cGUpKSByZXR1cm4gZm91bmQ7XG4gICAgICB2YXIgaGVscCA9IGhlbHBlcnNbdHlwZV0sIG1vZGUgPSB0aGlzLmdldE1vZGVBdChwb3MpO1xuICAgICAgaWYgKHR5cGVvZiBtb2RlW3R5cGVdID09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgaWYgKGhlbHBbbW9kZVt0eXBlXV0pIGZvdW5kLnB1c2goaGVscFttb2RlW3R5cGVdXSk7XG4gICAgICB9IGVsc2UgaWYgKG1vZGVbdHlwZV0pIHtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBtb2RlW3R5cGVdLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgdmFyIHZhbCA9IGhlbHBbbW9kZVt0eXBlXVtpXV07XG4gICAgICAgICAgaWYgKHZhbCkgZm91bmQucHVzaCh2YWwpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKG1vZGUuaGVscGVyVHlwZSAmJiBoZWxwW21vZGUuaGVscGVyVHlwZV0pIHtcbiAgICAgICAgZm91bmQucHVzaChoZWxwW21vZGUuaGVscGVyVHlwZV0pO1xuICAgICAgfSBlbHNlIGlmIChoZWxwW21vZGUubmFtZV0pIHtcbiAgICAgICAgZm91bmQucHVzaChoZWxwW21vZGUubmFtZV0pO1xuICAgICAgfVxuICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBoZWxwLl9nbG9iYWwubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgdmFyIGN1ciA9IGhlbHAuX2dsb2JhbFtpXTtcbiAgICAgICAgaWYgKGN1ci5wcmVkKG1vZGUsIHRoaXMpICYmIGluZGV4T2YoZm91bmQsIGN1ci52YWwpID09IC0xKVxuICAgICAgICAgIGZvdW5kLnB1c2goY3VyLnZhbCk7XG4gICAgICB9XG4gICAgICByZXR1cm4gZm91bmQ7XG4gICAgfSxcblxuICAgIGdldFN0YXRlQWZ0ZXI6IGZ1bmN0aW9uKGxpbmUsIHByZWNpc2UpIHtcbiAgICAgIHZhciBkb2MgPSB0aGlzLmRvYztcbiAgICAgIGxpbmUgPSBjbGlwTGluZShkb2MsIGxpbmUgPT0gbnVsbCA/IGRvYy5maXJzdCArIGRvYy5zaXplIC0gMTogbGluZSk7XG4gICAgICByZXR1cm4gZ2V0U3RhdGVCZWZvcmUodGhpcywgbGluZSArIDEsIHByZWNpc2UpO1xuICAgIH0sXG5cbiAgICBjdXJzb3JDb29yZHM6IGZ1bmN0aW9uKHN0YXJ0LCBtb2RlKSB7XG4gICAgICB2YXIgcG9zLCByYW5nZSA9IHRoaXMuZG9jLnNlbC5wcmltYXJ5KCk7XG4gICAgICBpZiAoc3RhcnQgPT0gbnVsbCkgcG9zID0gcmFuZ2UuaGVhZDtcbiAgICAgIGVsc2UgaWYgKHR5cGVvZiBzdGFydCA9PSBcIm9iamVjdFwiKSBwb3MgPSBjbGlwUG9zKHRoaXMuZG9jLCBzdGFydCk7XG4gICAgICBlbHNlIHBvcyA9IHN0YXJ0ID8gcmFuZ2UuZnJvbSgpIDogcmFuZ2UudG8oKTtcbiAgICAgIHJldHVybiBjdXJzb3JDb29yZHModGhpcywgcG9zLCBtb2RlIHx8IFwicGFnZVwiKTtcbiAgICB9LFxuXG4gICAgY2hhckNvb3JkczogZnVuY3Rpb24ocG9zLCBtb2RlKSB7XG4gICAgICByZXR1cm4gY2hhckNvb3Jkcyh0aGlzLCBjbGlwUG9zKHRoaXMuZG9jLCBwb3MpLCBtb2RlIHx8IFwicGFnZVwiKTtcbiAgICB9LFxuXG4gICAgY29vcmRzQ2hhcjogZnVuY3Rpb24oY29vcmRzLCBtb2RlKSB7XG4gICAgICBjb29yZHMgPSBmcm9tQ29vcmRTeXN0ZW0odGhpcywgY29vcmRzLCBtb2RlIHx8IFwicGFnZVwiKTtcbiAgICAgIHJldHVybiBjb29yZHNDaGFyKHRoaXMsIGNvb3Jkcy5sZWZ0LCBjb29yZHMudG9wKTtcbiAgICB9LFxuXG4gICAgbGluZUF0SGVpZ2h0OiBmdW5jdGlvbihoZWlnaHQsIG1vZGUpIHtcbiAgICAgIGhlaWdodCA9IGZyb21Db29yZFN5c3RlbSh0aGlzLCB7dG9wOiBoZWlnaHQsIGxlZnQ6IDB9LCBtb2RlIHx8IFwicGFnZVwiKS50b3A7XG4gICAgICByZXR1cm4gbGluZUF0SGVpZ2h0KHRoaXMuZG9jLCBoZWlnaHQgKyB0aGlzLmRpc3BsYXkudmlld09mZnNldCk7XG4gICAgfSxcbiAgICBoZWlnaHRBdExpbmU6IGZ1bmN0aW9uKGxpbmUsIG1vZGUpIHtcbiAgICAgIHZhciBlbmQgPSBmYWxzZSwgbGluZU9iajtcbiAgICAgIGlmICh0eXBlb2YgbGluZSA9PSBcIm51bWJlclwiKSB7XG4gICAgICAgIHZhciBsYXN0ID0gdGhpcy5kb2MuZmlyc3QgKyB0aGlzLmRvYy5zaXplIC0gMTtcbiAgICAgICAgaWYgKGxpbmUgPCB0aGlzLmRvYy5maXJzdCkgbGluZSA9IHRoaXMuZG9jLmZpcnN0O1xuICAgICAgICBlbHNlIGlmIChsaW5lID4gbGFzdCkgeyBsaW5lID0gbGFzdDsgZW5kID0gdHJ1ZTsgfVxuICAgICAgICBsaW5lT2JqID0gZ2V0TGluZSh0aGlzLmRvYywgbGluZSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBsaW5lT2JqID0gbGluZTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBpbnRvQ29vcmRTeXN0ZW0odGhpcywgbGluZU9iaiwge3RvcDogMCwgbGVmdDogMH0sIG1vZGUgfHwgXCJwYWdlXCIpLnRvcCArXG4gICAgICAgIChlbmQgPyB0aGlzLmRvYy5oZWlnaHQgLSBoZWlnaHRBdExpbmUobGluZU9iaikgOiAwKTtcbiAgICB9LFxuXG4gICAgZGVmYXVsdFRleHRIZWlnaHQ6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGV4dEhlaWdodCh0aGlzLmRpc3BsYXkpOyB9LFxuICAgIGRlZmF1bHRDaGFyV2lkdGg6IGZ1bmN0aW9uKCkgeyByZXR1cm4gY2hhcldpZHRoKHRoaXMuZGlzcGxheSk7IH0sXG5cbiAgICBzZXRHdXR0ZXJNYXJrZXI6IG1ldGhvZE9wKGZ1bmN0aW9uKGxpbmUsIGd1dHRlcklELCB2YWx1ZSkge1xuICAgICAgcmV0dXJuIGNoYW5nZUxpbmUodGhpcy5kb2MsIGxpbmUsIFwiZ3V0dGVyXCIsIGZ1bmN0aW9uKGxpbmUpIHtcbiAgICAgICAgdmFyIG1hcmtlcnMgPSBsaW5lLmd1dHRlck1hcmtlcnMgfHwgKGxpbmUuZ3V0dGVyTWFya2VycyA9IHt9KTtcbiAgICAgICAgbWFya2Vyc1tndXR0ZXJJRF0gPSB2YWx1ZTtcbiAgICAgICAgaWYgKCF2YWx1ZSAmJiBpc0VtcHR5KG1hcmtlcnMpKSBsaW5lLmd1dHRlck1hcmtlcnMgPSBudWxsO1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH0pO1xuICAgIH0pLFxuXG4gICAgY2xlYXJHdXR0ZXI6IG1ldGhvZE9wKGZ1bmN0aW9uKGd1dHRlcklEKSB7XG4gICAgICB2YXIgY20gPSB0aGlzLCBkb2MgPSBjbS5kb2MsIGkgPSBkb2MuZmlyc3Q7XG4gICAgICBkb2MuaXRlcihmdW5jdGlvbihsaW5lKSB7XG4gICAgICAgIGlmIChsaW5lLmd1dHRlck1hcmtlcnMgJiYgbGluZS5ndXR0ZXJNYXJrZXJzW2d1dHRlcklEXSkge1xuICAgICAgICAgIGxpbmUuZ3V0dGVyTWFya2Vyc1tndXR0ZXJJRF0gPSBudWxsO1xuICAgICAgICAgIHJlZ0xpbmVDaGFuZ2UoY20sIGksIFwiZ3V0dGVyXCIpO1xuICAgICAgICAgIGlmIChpc0VtcHR5KGxpbmUuZ3V0dGVyTWFya2VycykpIGxpbmUuZ3V0dGVyTWFya2VycyA9IG51bGw7XG4gICAgICAgIH1cbiAgICAgICAgKytpO1xuICAgICAgfSk7XG4gICAgfSksXG5cbiAgICBsaW5lSW5mbzogZnVuY3Rpb24obGluZSkge1xuICAgICAgaWYgKHR5cGVvZiBsaW5lID09IFwibnVtYmVyXCIpIHtcbiAgICAgICAgaWYgKCFpc0xpbmUodGhpcy5kb2MsIGxpbmUpKSByZXR1cm4gbnVsbDtcbiAgICAgICAgdmFyIG4gPSBsaW5lO1xuICAgICAgICBsaW5lID0gZ2V0TGluZSh0aGlzLmRvYywgbGluZSk7XG4gICAgICAgIGlmICghbGluZSkgcmV0dXJuIG51bGw7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB2YXIgbiA9IGxpbmVObyhsaW5lKTtcbiAgICAgICAgaWYgKG4gPT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gICAgICB9XG4gICAgICByZXR1cm4ge2xpbmU6IG4sIGhhbmRsZTogbGluZSwgdGV4dDogbGluZS50ZXh0LCBndXR0ZXJNYXJrZXJzOiBsaW5lLmd1dHRlck1hcmtlcnMsXG4gICAgICAgICAgICAgIHRleHRDbGFzczogbGluZS50ZXh0Q2xhc3MsIGJnQ2xhc3M6IGxpbmUuYmdDbGFzcywgd3JhcENsYXNzOiBsaW5lLndyYXBDbGFzcyxcbiAgICAgICAgICAgICAgd2lkZ2V0czogbGluZS53aWRnZXRzfTtcbiAgICB9LFxuXG4gICAgZ2V0Vmlld3BvcnQ6IGZ1bmN0aW9uKCkgeyByZXR1cm4ge2Zyb206IHRoaXMuZGlzcGxheS52aWV3RnJvbSwgdG86IHRoaXMuZGlzcGxheS52aWV3VG99O30sXG5cbiAgICBhZGRXaWRnZXQ6IGZ1bmN0aW9uKHBvcywgbm9kZSwgc2Nyb2xsLCB2ZXJ0LCBob3Jpeikge1xuICAgICAgdmFyIGRpc3BsYXkgPSB0aGlzLmRpc3BsYXk7XG4gICAgICBwb3MgPSBjdXJzb3JDb29yZHModGhpcywgY2xpcFBvcyh0aGlzLmRvYywgcG9zKSk7XG4gICAgICB2YXIgdG9wID0gcG9zLmJvdHRvbSwgbGVmdCA9IHBvcy5sZWZ0O1xuICAgICAgbm9kZS5zdHlsZS5wb3NpdGlvbiA9IFwiYWJzb2x1dGVcIjtcbiAgICAgIG5vZGUuc2V0QXR0cmlidXRlKFwiY20taWdub3JlLWV2ZW50c1wiLCBcInRydWVcIik7XG4gICAgICB0aGlzLmRpc3BsYXkuaW5wdXQuc2V0VW5lZGl0YWJsZShub2RlKTtcbiAgICAgIGRpc3BsYXkuc2l6ZXIuYXBwZW5kQ2hpbGQobm9kZSk7XG4gICAgICBpZiAodmVydCA9PSBcIm92ZXJcIikge1xuICAgICAgICB0b3AgPSBwb3MudG9wO1xuICAgICAgfSBlbHNlIGlmICh2ZXJ0ID09IFwiYWJvdmVcIiB8fCB2ZXJ0ID09IFwibmVhclwiKSB7XG4gICAgICAgIHZhciB2c3BhY2UgPSBNYXRoLm1heChkaXNwbGF5LndyYXBwZXIuY2xpZW50SGVpZ2h0LCB0aGlzLmRvYy5oZWlnaHQpLFxuICAgICAgICBoc3BhY2UgPSBNYXRoLm1heChkaXNwbGF5LnNpemVyLmNsaWVudFdpZHRoLCBkaXNwbGF5LmxpbmVTcGFjZS5jbGllbnRXaWR0aCk7XG4gICAgICAgIC8vIERlZmF1bHQgdG8gcG9zaXRpb25pbmcgYWJvdmUgKGlmIHNwZWNpZmllZCBhbmQgcG9zc2libGUpOyBvdGhlcndpc2UgZGVmYXVsdCB0byBwb3NpdGlvbmluZyBiZWxvd1xuICAgICAgICBpZiAoKHZlcnQgPT0gJ2Fib3ZlJyB8fCBwb3MuYm90dG9tICsgbm9kZS5vZmZzZXRIZWlnaHQgPiB2c3BhY2UpICYmIHBvcy50b3AgPiBub2RlLm9mZnNldEhlaWdodClcbiAgICAgICAgICB0b3AgPSBwb3MudG9wIC0gbm9kZS5vZmZzZXRIZWlnaHQ7XG4gICAgICAgIGVsc2UgaWYgKHBvcy5ib3R0b20gKyBub2RlLm9mZnNldEhlaWdodCA8PSB2c3BhY2UpXG4gICAgICAgICAgdG9wID0gcG9zLmJvdHRvbTtcbiAgICAgICAgaWYgKGxlZnQgKyBub2RlLm9mZnNldFdpZHRoID4gaHNwYWNlKVxuICAgICAgICAgIGxlZnQgPSBoc3BhY2UgLSBub2RlLm9mZnNldFdpZHRoO1xuICAgICAgfVxuICAgICAgbm9kZS5zdHlsZS50b3AgPSB0b3AgKyBcInB4XCI7XG4gICAgICBub2RlLnN0eWxlLmxlZnQgPSBub2RlLnN0eWxlLnJpZ2h0ID0gXCJcIjtcbiAgICAgIGlmIChob3JpeiA9PSBcInJpZ2h0XCIpIHtcbiAgICAgICAgbGVmdCA9IGRpc3BsYXkuc2l6ZXIuY2xpZW50V2lkdGggLSBub2RlLm9mZnNldFdpZHRoO1xuICAgICAgICBub2RlLnN0eWxlLnJpZ2h0ID0gXCIwcHhcIjtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmIChob3JpeiA9PSBcImxlZnRcIikgbGVmdCA9IDA7XG4gICAgICAgIGVsc2UgaWYgKGhvcml6ID09IFwibWlkZGxlXCIpIGxlZnQgPSAoZGlzcGxheS5zaXplci5jbGllbnRXaWR0aCAtIG5vZGUub2Zmc2V0V2lkdGgpIC8gMjtcbiAgICAgICAgbm9kZS5zdHlsZS5sZWZ0ID0gbGVmdCArIFwicHhcIjtcbiAgICAgIH1cbiAgICAgIGlmIChzY3JvbGwpXG4gICAgICAgIHNjcm9sbEludG9WaWV3KHRoaXMsIGxlZnQsIHRvcCwgbGVmdCArIG5vZGUub2Zmc2V0V2lkdGgsIHRvcCArIG5vZGUub2Zmc2V0SGVpZ2h0KTtcbiAgICB9LFxuXG4gICAgdHJpZ2dlck9uS2V5RG93bjogbWV0aG9kT3Aob25LZXlEb3duKSxcbiAgICB0cmlnZ2VyT25LZXlQcmVzczogbWV0aG9kT3Aob25LZXlQcmVzcyksXG4gICAgdHJpZ2dlck9uS2V5VXA6IG9uS2V5VXAsXG5cbiAgICBleGVjQ29tbWFuZDogZnVuY3Rpb24oY21kKSB7XG4gICAgICBpZiAoY29tbWFuZHMuaGFzT3duUHJvcGVydHkoY21kKSlcbiAgICAgICAgcmV0dXJuIGNvbW1hbmRzW2NtZF0odGhpcyk7XG4gICAgfSxcblxuICAgIHRyaWdnZXJFbGVjdHJpYzogbWV0aG9kT3AoZnVuY3Rpb24odGV4dCkgeyB0cmlnZ2VyRWxlY3RyaWModGhpcywgdGV4dCk7IH0pLFxuXG4gICAgZmluZFBvc0g6IGZ1bmN0aW9uKGZyb20sIGFtb3VudCwgdW5pdCwgdmlzdWFsbHkpIHtcbiAgICAgIHZhciBkaXIgPSAxO1xuICAgICAgaWYgKGFtb3VudCA8IDApIHsgZGlyID0gLTE7IGFtb3VudCA9IC1hbW91bnQ7IH1cbiAgICAgIGZvciAodmFyIGkgPSAwLCBjdXIgPSBjbGlwUG9zKHRoaXMuZG9jLCBmcm9tKTsgaSA8IGFtb3VudDsgKytpKSB7XG4gICAgICAgIGN1ciA9IGZpbmRQb3NIKHRoaXMuZG9jLCBjdXIsIGRpciwgdW5pdCwgdmlzdWFsbHkpO1xuICAgICAgICBpZiAoY3VyLmhpdFNpZGUpIGJyZWFrO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGN1cjtcbiAgICB9LFxuXG4gICAgbW92ZUg6IG1ldGhvZE9wKGZ1bmN0aW9uKGRpciwgdW5pdCkge1xuICAgICAgdmFyIGNtID0gdGhpcztcbiAgICAgIGNtLmV4dGVuZFNlbGVjdGlvbnNCeShmdW5jdGlvbihyYW5nZSkge1xuICAgICAgICBpZiAoY20uZGlzcGxheS5zaGlmdCB8fCBjbS5kb2MuZXh0ZW5kIHx8IHJhbmdlLmVtcHR5KCkpXG4gICAgICAgICAgcmV0dXJuIGZpbmRQb3NIKGNtLmRvYywgcmFuZ2UuaGVhZCwgZGlyLCB1bml0LCBjbS5vcHRpb25zLnJ0bE1vdmVWaXN1YWxseSk7XG4gICAgICAgIGVsc2VcbiAgICAgICAgICByZXR1cm4gZGlyIDwgMCA/IHJhbmdlLmZyb20oKSA6IHJhbmdlLnRvKCk7XG4gICAgICB9LCBzZWxfbW92ZSk7XG4gICAgfSksXG5cbiAgICBkZWxldGVIOiBtZXRob2RPcChmdW5jdGlvbihkaXIsIHVuaXQpIHtcbiAgICAgIHZhciBzZWwgPSB0aGlzLmRvYy5zZWwsIGRvYyA9IHRoaXMuZG9jO1xuICAgICAgaWYgKHNlbC5zb21ldGhpbmdTZWxlY3RlZCgpKVxuICAgICAgICBkb2MucmVwbGFjZVNlbGVjdGlvbihcIlwiLCBudWxsLCBcIitkZWxldGVcIik7XG4gICAgICBlbHNlXG4gICAgICAgIGRlbGV0ZU5lYXJTZWxlY3Rpb24odGhpcywgZnVuY3Rpb24ocmFuZ2UpIHtcbiAgICAgICAgICB2YXIgb3RoZXIgPSBmaW5kUG9zSChkb2MsIHJhbmdlLmhlYWQsIGRpciwgdW5pdCwgZmFsc2UpO1xuICAgICAgICAgIHJldHVybiBkaXIgPCAwID8ge2Zyb206IG90aGVyLCB0bzogcmFuZ2UuaGVhZH0gOiB7ZnJvbTogcmFuZ2UuaGVhZCwgdG86IG90aGVyfTtcbiAgICAgICAgfSk7XG4gICAgfSksXG5cbiAgICBmaW5kUG9zVjogZnVuY3Rpb24oZnJvbSwgYW1vdW50LCB1bml0LCBnb2FsQ29sdW1uKSB7XG4gICAgICB2YXIgZGlyID0gMSwgeCA9IGdvYWxDb2x1bW47XG4gICAgICBpZiAoYW1vdW50IDwgMCkgeyBkaXIgPSAtMTsgYW1vdW50ID0gLWFtb3VudDsgfVxuICAgICAgZm9yICh2YXIgaSA9IDAsIGN1ciA9IGNsaXBQb3ModGhpcy5kb2MsIGZyb20pOyBpIDwgYW1vdW50OyArK2kpIHtcbiAgICAgICAgdmFyIGNvb3JkcyA9IGN1cnNvckNvb3Jkcyh0aGlzLCBjdXIsIFwiZGl2XCIpO1xuICAgICAgICBpZiAoeCA9PSBudWxsKSB4ID0gY29vcmRzLmxlZnQ7XG4gICAgICAgIGVsc2UgY29vcmRzLmxlZnQgPSB4O1xuICAgICAgICBjdXIgPSBmaW5kUG9zVih0aGlzLCBjb29yZHMsIGRpciwgdW5pdCk7XG4gICAgICAgIGlmIChjdXIuaGl0U2lkZSkgYnJlYWs7XG4gICAgICB9XG4gICAgICByZXR1cm4gY3VyO1xuICAgIH0sXG5cbiAgICBtb3ZlVjogbWV0aG9kT3AoZnVuY3Rpb24oZGlyLCB1bml0KSB7XG4gICAgICB2YXIgY20gPSB0aGlzLCBkb2MgPSB0aGlzLmRvYywgZ29hbHMgPSBbXTtcbiAgICAgIHZhciBjb2xsYXBzZSA9ICFjbS5kaXNwbGF5LnNoaWZ0ICYmICFkb2MuZXh0ZW5kICYmIGRvYy5zZWwuc29tZXRoaW5nU2VsZWN0ZWQoKTtcbiAgICAgIGRvYy5leHRlbmRTZWxlY3Rpb25zQnkoZnVuY3Rpb24ocmFuZ2UpIHtcbiAgICAgICAgaWYgKGNvbGxhcHNlKVxuICAgICAgICAgIHJldHVybiBkaXIgPCAwID8gcmFuZ2UuZnJvbSgpIDogcmFuZ2UudG8oKTtcbiAgICAgICAgdmFyIGhlYWRQb3MgPSBjdXJzb3JDb29yZHMoY20sIHJhbmdlLmhlYWQsIFwiZGl2XCIpO1xuICAgICAgICBpZiAocmFuZ2UuZ29hbENvbHVtbiAhPSBudWxsKSBoZWFkUG9zLmxlZnQgPSByYW5nZS5nb2FsQ29sdW1uO1xuICAgICAgICBnb2Fscy5wdXNoKGhlYWRQb3MubGVmdCk7XG4gICAgICAgIHZhciBwb3MgPSBmaW5kUG9zVihjbSwgaGVhZFBvcywgZGlyLCB1bml0KTtcbiAgICAgICAgaWYgKHVuaXQgPT0gXCJwYWdlXCIgJiYgcmFuZ2UgPT0gZG9jLnNlbC5wcmltYXJ5KCkpXG4gICAgICAgICAgYWRkVG9TY3JvbGxQb3MoY20sIG51bGwsIGNoYXJDb29yZHMoY20sIHBvcywgXCJkaXZcIikudG9wIC0gaGVhZFBvcy50b3ApO1xuICAgICAgICByZXR1cm4gcG9zO1xuICAgICAgfSwgc2VsX21vdmUpO1xuICAgICAgaWYgKGdvYWxzLmxlbmd0aCkgZm9yICh2YXIgaSA9IDA7IGkgPCBkb2Muc2VsLnJhbmdlcy5sZW5ndGg7IGkrKylcbiAgICAgICAgZG9jLnNlbC5yYW5nZXNbaV0uZ29hbENvbHVtbiA9IGdvYWxzW2ldO1xuICAgIH0pLFxuXG4gICAgLy8gRmluZCB0aGUgd29yZCBhdCB0aGUgZ2l2ZW4gcG9zaXRpb24gKGFzIHJldHVybmVkIGJ5IGNvb3Jkc0NoYXIpLlxuICAgIGZpbmRXb3JkQXQ6IGZ1bmN0aW9uKHBvcykge1xuICAgICAgdmFyIGRvYyA9IHRoaXMuZG9jLCBsaW5lID0gZ2V0TGluZShkb2MsIHBvcy5saW5lKS50ZXh0O1xuICAgICAgdmFyIHN0YXJ0ID0gcG9zLmNoLCBlbmQgPSBwb3MuY2g7XG4gICAgICBpZiAobGluZSkge1xuICAgICAgICB2YXIgaGVscGVyID0gdGhpcy5nZXRIZWxwZXIocG9zLCBcIndvcmRDaGFyc1wiKTtcbiAgICAgICAgaWYgKChwb3MueFJlbCA8IDAgfHwgZW5kID09IGxpbmUubGVuZ3RoKSAmJiBzdGFydCkgLS1zdGFydDsgZWxzZSArK2VuZDtcbiAgICAgICAgdmFyIHN0YXJ0Q2hhciA9IGxpbmUuY2hhckF0KHN0YXJ0KTtcbiAgICAgICAgdmFyIGNoZWNrID0gaXNXb3JkQ2hhcihzdGFydENoYXIsIGhlbHBlcilcbiAgICAgICAgICA/IGZ1bmN0aW9uKGNoKSB7IHJldHVybiBpc1dvcmRDaGFyKGNoLCBoZWxwZXIpOyB9XG4gICAgICAgICAgOiAvXFxzLy50ZXN0KHN0YXJ0Q2hhcikgPyBmdW5jdGlvbihjaCkge3JldHVybiAvXFxzLy50ZXN0KGNoKTt9XG4gICAgICAgICAgOiBmdW5jdGlvbihjaCkge3JldHVybiAhL1xccy8udGVzdChjaCkgJiYgIWlzV29yZENoYXIoY2gpO307XG4gICAgICAgIHdoaWxlIChzdGFydCA+IDAgJiYgY2hlY2sobGluZS5jaGFyQXQoc3RhcnQgLSAxKSkpIC0tc3RhcnQ7XG4gICAgICAgIHdoaWxlIChlbmQgPCBsaW5lLmxlbmd0aCAmJiBjaGVjayhsaW5lLmNoYXJBdChlbmQpKSkgKytlbmQ7XG4gICAgICB9XG4gICAgICByZXR1cm4gbmV3IFJhbmdlKFBvcyhwb3MubGluZSwgc3RhcnQpLCBQb3MocG9zLmxpbmUsIGVuZCkpO1xuICAgIH0sXG5cbiAgICB0b2dnbGVPdmVyd3JpdGU6IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICBpZiAodmFsdWUgIT0gbnVsbCAmJiB2YWx1ZSA9PSB0aGlzLnN0YXRlLm92ZXJ3cml0ZSkgcmV0dXJuO1xuICAgICAgaWYgKHRoaXMuc3RhdGUub3ZlcndyaXRlID0gIXRoaXMuc3RhdGUub3ZlcndyaXRlKVxuICAgICAgICBhZGRDbGFzcyh0aGlzLmRpc3BsYXkuY3Vyc29yRGl2LCBcIkNvZGVNaXJyb3Itb3ZlcndyaXRlXCIpO1xuICAgICAgZWxzZVxuICAgICAgICBybUNsYXNzKHRoaXMuZGlzcGxheS5jdXJzb3JEaXYsIFwiQ29kZU1pcnJvci1vdmVyd3JpdGVcIik7XG5cbiAgICAgIHNpZ25hbCh0aGlzLCBcIm92ZXJ3cml0ZVRvZ2dsZVwiLCB0aGlzLCB0aGlzLnN0YXRlLm92ZXJ3cml0ZSk7XG4gICAgfSxcbiAgICBoYXNGb2N1czogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLmRpc3BsYXkuaW5wdXQuZ2V0RmllbGQoKSA9PSBhY3RpdmVFbHQoKTsgfSxcblxuICAgIHNjcm9sbFRvOiBtZXRob2RPcChmdW5jdGlvbih4LCB5KSB7XG4gICAgICBpZiAoeCAhPSBudWxsIHx8IHkgIT0gbnVsbCkgcmVzb2x2ZVNjcm9sbFRvUG9zKHRoaXMpO1xuICAgICAgaWYgKHggIT0gbnVsbCkgdGhpcy5jdXJPcC5zY3JvbGxMZWZ0ID0geDtcbiAgICAgIGlmICh5ICE9IG51bGwpIHRoaXMuY3VyT3Auc2Nyb2xsVG9wID0geTtcbiAgICB9KSxcbiAgICBnZXRTY3JvbGxJbmZvOiBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBzY3JvbGxlciA9IHRoaXMuZGlzcGxheS5zY3JvbGxlcjtcbiAgICAgIHJldHVybiB7bGVmdDogc2Nyb2xsZXIuc2Nyb2xsTGVmdCwgdG9wOiBzY3JvbGxlci5zY3JvbGxUb3AsXG4gICAgICAgICAgICAgIGhlaWdodDogc2Nyb2xsZXIuc2Nyb2xsSGVpZ2h0IC0gc2Nyb2xsR2FwKHRoaXMpIC0gdGhpcy5kaXNwbGF5LmJhckhlaWdodCxcbiAgICAgICAgICAgICAgd2lkdGg6IHNjcm9sbGVyLnNjcm9sbFdpZHRoIC0gc2Nyb2xsR2FwKHRoaXMpIC0gdGhpcy5kaXNwbGF5LmJhcldpZHRoLFxuICAgICAgICAgICAgICBjbGllbnRIZWlnaHQ6IGRpc3BsYXlIZWlnaHQodGhpcyksIGNsaWVudFdpZHRoOiBkaXNwbGF5V2lkdGgodGhpcyl9O1xuICAgIH0sXG5cbiAgICBzY3JvbGxJbnRvVmlldzogbWV0aG9kT3AoZnVuY3Rpb24ocmFuZ2UsIG1hcmdpbikge1xuICAgICAgaWYgKHJhbmdlID09IG51bGwpIHtcbiAgICAgICAgcmFuZ2UgPSB7ZnJvbTogdGhpcy5kb2Muc2VsLnByaW1hcnkoKS5oZWFkLCB0bzogbnVsbH07XG4gICAgICAgIGlmIChtYXJnaW4gPT0gbnVsbCkgbWFyZ2luID0gdGhpcy5vcHRpb25zLmN1cnNvclNjcm9sbE1hcmdpbjtcbiAgICAgIH0gZWxzZSBpZiAodHlwZW9mIHJhbmdlID09IFwibnVtYmVyXCIpIHtcbiAgICAgICAgcmFuZ2UgPSB7ZnJvbTogUG9zKHJhbmdlLCAwKSwgdG86IG51bGx9O1xuICAgICAgfSBlbHNlIGlmIChyYW5nZS5mcm9tID09IG51bGwpIHtcbiAgICAgICAgcmFuZ2UgPSB7ZnJvbTogcmFuZ2UsIHRvOiBudWxsfTtcbiAgICAgIH1cbiAgICAgIGlmICghcmFuZ2UudG8pIHJhbmdlLnRvID0gcmFuZ2UuZnJvbTtcbiAgICAgIHJhbmdlLm1hcmdpbiA9IG1hcmdpbiB8fCAwO1xuXG4gICAgICBpZiAocmFuZ2UuZnJvbS5saW5lICE9IG51bGwpIHtcbiAgICAgICAgcmVzb2x2ZVNjcm9sbFRvUG9zKHRoaXMpO1xuICAgICAgICB0aGlzLmN1ck9wLnNjcm9sbFRvUG9zID0gcmFuZ2U7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB2YXIgc1BvcyA9IGNhbGN1bGF0ZVNjcm9sbFBvcyh0aGlzLCBNYXRoLm1pbihyYW5nZS5mcm9tLmxlZnQsIHJhbmdlLnRvLmxlZnQpLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBNYXRoLm1pbihyYW5nZS5mcm9tLnRvcCwgcmFuZ2UudG8udG9wKSAtIHJhbmdlLm1hcmdpbixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgTWF0aC5tYXgocmFuZ2UuZnJvbS5yaWdodCwgcmFuZ2UudG8ucmlnaHQpLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBNYXRoLm1heChyYW5nZS5mcm9tLmJvdHRvbSwgcmFuZ2UudG8uYm90dG9tKSArIHJhbmdlLm1hcmdpbik7XG4gICAgICAgIHRoaXMuc2Nyb2xsVG8oc1Bvcy5zY3JvbGxMZWZ0LCBzUG9zLnNjcm9sbFRvcCk7XG4gICAgICB9XG4gICAgfSksXG5cbiAgICBzZXRTaXplOiBtZXRob2RPcChmdW5jdGlvbih3aWR0aCwgaGVpZ2h0KSB7XG4gICAgICB2YXIgY20gPSB0aGlzO1xuICAgICAgZnVuY3Rpb24gaW50ZXJwcmV0KHZhbCkge1xuICAgICAgICByZXR1cm4gdHlwZW9mIHZhbCA9PSBcIm51bWJlclwiIHx8IC9eXFxkKyQvLnRlc3QoU3RyaW5nKHZhbCkpID8gdmFsICsgXCJweFwiIDogdmFsO1xuICAgICAgfVxuICAgICAgaWYgKHdpZHRoICE9IG51bGwpIGNtLmRpc3BsYXkud3JhcHBlci5zdHlsZS53aWR0aCA9IGludGVycHJldCh3aWR0aCk7XG4gICAgICBpZiAoaGVpZ2h0ICE9IG51bGwpIGNtLmRpc3BsYXkud3JhcHBlci5zdHlsZS5oZWlnaHQgPSBpbnRlcnByZXQoaGVpZ2h0KTtcbiAgICAgIGlmIChjbS5vcHRpb25zLmxpbmVXcmFwcGluZykgY2xlYXJMaW5lTWVhc3VyZW1lbnRDYWNoZSh0aGlzKTtcbiAgICAgIHZhciBsaW5lTm8gPSBjbS5kaXNwbGF5LnZpZXdGcm9tO1xuICAgICAgY20uZG9jLml0ZXIobGluZU5vLCBjbS5kaXNwbGF5LnZpZXdUbywgZnVuY3Rpb24obGluZSkge1xuICAgICAgICBpZiAobGluZS53aWRnZXRzKSBmb3IgKHZhciBpID0gMDsgaSA8IGxpbmUud2lkZ2V0cy5sZW5ndGg7IGkrKylcbiAgICAgICAgICBpZiAobGluZS53aWRnZXRzW2ldLm5vSFNjcm9sbCkgeyByZWdMaW5lQ2hhbmdlKGNtLCBsaW5lTm8sIFwid2lkZ2V0XCIpOyBicmVhazsgfVxuICAgICAgICArK2xpbmVObztcbiAgICAgIH0pO1xuICAgICAgY20uY3VyT3AuZm9yY2VVcGRhdGUgPSB0cnVlO1xuICAgICAgc2lnbmFsKGNtLCBcInJlZnJlc2hcIiwgdGhpcyk7XG4gICAgfSksXG5cbiAgICBvcGVyYXRpb246IGZ1bmN0aW9uKGYpe3JldHVybiBydW5Jbk9wKHRoaXMsIGYpO30sXG5cbiAgICByZWZyZXNoOiBtZXRob2RPcChmdW5jdGlvbigpIHtcbiAgICAgIHZhciBvbGRIZWlnaHQgPSB0aGlzLmRpc3BsYXkuY2FjaGVkVGV4dEhlaWdodDtcbiAgICAgIHJlZ0NoYW5nZSh0aGlzKTtcbiAgICAgIHRoaXMuY3VyT3AuZm9yY2VVcGRhdGUgPSB0cnVlO1xuICAgICAgY2xlYXJDYWNoZXModGhpcyk7XG4gICAgICB0aGlzLnNjcm9sbFRvKHRoaXMuZG9jLnNjcm9sbExlZnQsIHRoaXMuZG9jLnNjcm9sbFRvcCk7XG4gICAgICB1cGRhdGVHdXR0ZXJTcGFjZSh0aGlzKTtcbiAgICAgIGlmIChvbGRIZWlnaHQgPT0gbnVsbCB8fCBNYXRoLmFicyhvbGRIZWlnaHQgLSB0ZXh0SGVpZ2h0KHRoaXMuZGlzcGxheSkpID4gLjUpXG4gICAgICAgIGVzdGltYXRlTGluZUhlaWdodHModGhpcyk7XG4gICAgICBzaWduYWwodGhpcywgXCJyZWZyZXNoXCIsIHRoaXMpO1xuICAgIH0pLFxuXG4gICAgc3dhcERvYzogbWV0aG9kT3AoZnVuY3Rpb24oZG9jKSB7XG4gICAgICB2YXIgb2xkID0gdGhpcy5kb2M7XG4gICAgICBvbGQuY20gPSBudWxsO1xuICAgICAgYXR0YWNoRG9jKHRoaXMsIGRvYyk7XG4gICAgICBjbGVhckNhY2hlcyh0aGlzKTtcbiAgICAgIHRoaXMuZGlzcGxheS5pbnB1dC5yZXNldCgpO1xuICAgICAgdGhpcy5zY3JvbGxUbyhkb2Muc2Nyb2xsTGVmdCwgZG9jLnNjcm9sbFRvcCk7XG4gICAgICB0aGlzLmN1ck9wLmZvcmNlU2Nyb2xsID0gdHJ1ZTtcbiAgICAgIHNpZ25hbExhdGVyKHRoaXMsIFwic3dhcERvY1wiLCB0aGlzLCBvbGQpO1xuICAgICAgcmV0dXJuIG9sZDtcbiAgICB9KSxcblxuICAgIGdldElucHV0RmllbGQ6IGZ1bmN0aW9uKCl7cmV0dXJuIHRoaXMuZGlzcGxheS5pbnB1dC5nZXRGaWVsZCgpO30sXG4gICAgZ2V0V3JhcHBlckVsZW1lbnQ6IGZ1bmN0aW9uKCl7cmV0dXJuIHRoaXMuZGlzcGxheS53cmFwcGVyO30sXG4gICAgZ2V0U2Nyb2xsZXJFbGVtZW50OiBmdW5jdGlvbigpe3JldHVybiB0aGlzLmRpc3BsYXkuc2Nyb2xsZXI7fSxcbiAgICBnZXRHdXR0ZXJFbGVtZW50OiBmdW5jdGlvbigpe3JldHVybiB0aGlzLmRpc3BsYXkuZ3V0dGVyczt9XG4gIH07XG4gIGV2ZW50TWl4aW4oQ29kZU1pcnJvcik7XG5cbiAgLy8gT1BUSU9OIERFRkFVTFRTXG5cbiAgLy8gVGhlIGRlZmF1bHQgY29uZmlndXJhdGlvbiBvcHRpb25zLlxuICB2YXIgZGVmYXVsdHMgPSBDb2RlTWlycm9yLmRlZmF1bHRzID0ge307XG4gIC8vIEZ1bmN0aW9ucyB0byBydW4gd2hlbiBvcHRpb25zIGFyZSBjaGFuZ2VkLlxuICB2YXIgb3B0aW9uSGFuZGxlcnMgPSBDb2RlTWlycm9yLm9wdGlvbkhhbmRsZXJzID0ge307XG5cbiAgZnVuY3Rpb24gb3B0aW9uKG5hbWUsIGRlZmx0LCBoYW5kbGUsIG5vdE9uSW5pdCkge1xuICAgIENvZGVNaXJyb3IuZGVmYXVsdHNbbmFtZV0gPSBkZWZsdDtcbiAgICBpZiAoaGFuZGxlKSBvcHRpb25IYW5kbGVyc1tuYW1lXSA9XG4gICAgICBub3RPbkluaXQgPyBmdW5jdGlvbihjbSwgdmFsLCBvbGQpIHtpZiAob2xkICE9IEluaXQpIGhhbmRsZShjbSwgdmFsLCBvbGQpO30gOiBoYW5kbGU7XG4gIH1cblxuICAvLyBQYXNzZWQgdG8gb3B0aW9uIGhhbmRsZXJzIHdoZW4gdGhlcmUgaXMgbm8gb2xkIHZhbHVlLlxuICB2YXIgSW5pdCA9IENvZGVNaXJyb3IuSW5pdCA9IHt0b1N0cmluZzogZnVuY3Rpb24oKXtyZXR1cm4gXCJDb2RlTWlycm9yLkluaXRcIjt9fTtcblxuICAvLyBUaGVzZSB0d28gYXJlLCBvbiBpbml0LCBjYWxsZWQgZnJvbSB0aGUgY29uc3RydWN0b3IgYmVjYXVzZSB0aGV5XG4gIC8vIGhhdmUgdG8gYmUgaW5pdGlhbGl6ZWQgYmVmb3JlIHRoZSBlZGl0b3IgY2FuIHN0YXJ0IGF0IGFsbC5cbiAgb3B0aW9uKFwidmFsdWVcIiwgXCJcIiwgZnVuY3Rpb24oY20sIHZhbCkge1xuICAgIGNtLnNldFZhbHVlKHZhbCk7XG4gIH0sIHRydWUpO1xuICBvcHRpb24oXCJtb2RlXCIsIG51bGwsIGZ1bmN0aW9uKGNtLCB2YWwpIHtcbiAgICBjbS5kb2MubW9kZU9wdGlvbiA9IHZhbDtcbiAgICBsb2FkTW9kZShjbSk7XG4gIH0sIHRydWUpO1xuXG4gIG9wdGlvbihcImluZGVudFVuaXRcIiwgMiwgbG9hZE1vZGUsIHRydWUpO1xuICBvcHRpb24oXCJpbmRlbnRXaXRoVGFic1wiLCBmYWxzZSk7XG4gIG9wdGlvbihcInNtYXJ0SW5kZW50XCIsIHRydWUpO1xuICBvcHRpb24oXCJ0YWJTaXplXCIsIDQsIGZ1bmN0aW9uKGNtKSB7XG4gICAgcmVzZXRNb2RlU3RhdGUoY20pO1xuICAgIGNsZWFyQ2FjaGVzKGNtKTtcbiAgICByZWdDaGFuZ2UoY20pO1xuICB9LCB0cnVlKTtcbiAgb3B0aW9uKFwic3BlY2lhbENoYXJzXCIsIC9bXFx0XFx1MDAwMC1cXHUwMDE5XFx1MDBhZFxcdTIwMGItXFx1MjAwZlxcdTIwMjhcXHUyMDI5XFx1ZmVmZl0vZywgZnVuY3Rpb24oY20sIHZhbCwgb2xkKSB7XG4gICAgY20uc3RhdGUuc3BlY2lhbENoYXJzID0gbmV3IFJlZ0V4cCh2YWwuc291cmNlICsgKHZhbC50ZXN0KFwiXFx0XCIpID8gXCJcIiA6IFwifFxcdFwiKSwgXCJnXCIpO1xuICAgIGlmIChvbGQgIT0gQ29kZU1pcnJvci5Jbml0KSBjbS5yZWZyZXNoKCk7XG4gIH0pO1xuICBvcHRpb24oXCJzcGVjaWFsQ2hhclBsYWNlaG9sZGVyXCIsIGRlZmF1bHRTcGVjaWFsQ2hhclBsYWNlaG9sZGVyLCBmdW5jdGlvbihjbSkge2NtLnJlZnJlc2goKTt9LCB0cnVlKTtcbiAgb3B0aW9uKFwiZWxlY3RyaWNDaGFyc1wiLCB0cnVlKTtcbiAgb3B0aW9uKFwiaW5wdXRTdHlsZVwiLCBtb2JpbGUgPyBcImNvbnRlbnRlZGl0YWJsZVwiIDogXCJ0ZXh0YXJlYVwiLCBmdW5jdGlvbigpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJpbnB1dFN0eWxlIGNhbiBub3QgKHlldCkgYmUgY2hhbmdlZCBpbiBhIHJ1bm5pbmcgZWRpdG9yXCIpOyAvLyBGSVhNRVxuICB9LCB0cnVlKTtcbiAgb3B0aW9uKFwicnRsTW92ZVZpc3VhbGx5XCIsICF3aW5kb3dzKTtcbiAgb3B0aW9uKFwid2hvbGVMaW5lVXBkYXRlQmVmb3JlXCIsIHRydWUpO1xuXG4gIG9wdGlvbihcInRoZW1lXCIsIFwiZGVmYXVsdFwiLCBmdW5jdGlvbihjbSkge1xuICAgIHRoZW1lQ2hhbmdlZChjbSk7XG4gICAgZ3V0dGVyc0NoYW5nZWQoY20pO1xuICB9LCB0cnVlKTtcbiAgb3B0aW9uKFwia2V5TWFwXCIsIFwiZGVmYXVsdFwiLCBmdW5jdGlvbihjbSwgdmFsLCBvbGQpIHtcbiAgICB2YXIgbmV4dCA9IGdldEtleU1hcCh2YWwpO1xuICAgIHZhciBwcmV2ID0gb2xkICE9IENvZGVNaXJyb3IuSW5pdCAmJiBnZXRLZXlNYXAob2xkKTtcbiAgICBpZiAocHJldiAmJiBwcmV2LmRldGFjaCkgcHJldi5kZXRhY2goY20sIG5leHQpO1xuICAgIGlmIChuZXh0LmF0dGFjaCkgbmV4dC5hdHRhY2goY20sIHByZXYgfHwgbnVsbCk7XG4gIH0pO1xuICBvcHRpb24oXCJleHRyYUtleXNcIiwgbnVsbCk7XG5cbiAgb3B0aW9uKFwibGluZVdyYXBwaW5nXCIsIGZhbHNlLCB3cmFwcGluZ0NoYW5nZWQsIHRydWUpO1xuICBvcHRpb24oXCJndXR0ZXJzXCIsIFtdLCBmdW5jdGlvbihjbSkge1xuICAgIHNldEd1dHRlcnNGb3JMaW5lTnVtYmVycyhjbS5vcHRpb25zKTtcbiAgICBndXR0ZXJzQ2hhbmdlZChjbSk7XG4gIH0sIHRydWUpO1xuICBvcHRpb24oXCJmaXhlZEd1dHRlclwiLCB0cnVlLCBmdW5jdGlvbihjbSwgdmFsKSB7XG4gICAgY20uZGlzcGxheS5ndXR0ZXJzLnN0eWxlLmxlZnQgPSB2YWwgPyBjb21wZW5zYXRlRm9ySFNjcm9sbChjbS5kaXNwbGF5KSArIFwicHhcIiA6IFwiMFwiO1xuICAgIGNtLnJlZnJlc2goKTtcbiAgfSwgdHJ1ZSk7XG4gIG9wdGlvbihcImNvdmVyR3V0dGVyTmV4dFRvU2Nyb2xsYmFyXCIsIGZhbHNlLCBmdW5jdGlvbihjbSkge3VwZGF0ZVNjcm9sbGJhcnMoY20pO30sIHRydWUpO1xuICBvcHRpb24oXCJzY3JvbGxiYXJTdHlsZVwiLCBcIm5hdGl2ZVwiLCBmdW5jdGlvbihjbSkge1xuICAgIGluaXRTY3JvbGxiYXJzKGNtKTtcbiAgICB1cGRhdGVTY3JvbGxiYXJzKGNtKTtcbiAgICBjbS5kaXNwbGF5LnNjcm9sbGJhcnMuc2V0U2Nyb2xsVG9wKGNtLmRvYy5zY3JvbGxUb3ApO1xuICAgIGNtLmRpc3BsYXkuc2Nyb2xsYmFycy5zZXRTY3JvbGxMZWZ0KGNtLmRvYy5zY3JvbGxMZWZ0KTtcbiAgfSwgdHJ1ZSk7XG4gIG9wdGlvbihcImxpbmVOdW1iZXJzXCIsIGZhbHNlLCBmdW5jdGlvbihjbSkge1xuICAgIHNldEd1dHRlcnNGb3JMaW5lTnVtYmVycyhjbS5vcHRpb25zKTtcbiAgICBndXR0ZXJzQ2hhbmdlZChjbSk7XG4gIH0sIHRydWUpO1xuICBvcHRpb24oXCJmaXJzdExpbmVOdW1iZXJcIiwgMSwgZ3V0dGVyc0NoYW5nZWQsIHRydWUpO1xuICBvcHRpb24oXCJsaW5lTnVtYmVyRm9ybWF0dGVyXCIsIGZ1bmN0aW9uKGludGVnZXIpIHtyZXR1cm4gaW50ZWdlcjt9LCBndXR0ZXJzQ2hhbmdlZCwgdHJ1ZSk7XG4gIG9wdGlvbihcInNob3dDdXJzb3JXaGVuU2VsZWN0aW5nXCIsIGZhbHNlLCB1cGRhdGVTZWxlY3Rpb24sIHRydWUpO1xuXG4gIG9wdGlvbihcInJlc2V0U2VsZWN0aW9uT25Db250ZXh0TWVudVwiLCB0cnVlKTtcbiAgb3B0aW9uKFwibGluZVdpc2VDb3B5Q3V0XCIsIHRydWUpO1xuXG4gIG9wdGlvbihcInJlYWRPbmx5XCIsIGZhbHNlLCBmdW5jdGlvbihjbSwgdmFsKSB7XG4gICAgaWYgKHZhbCA9PSBcIm5vY3Vyc29yXCIpIHtcbiAgICAgIG9uQmx1cihjbSk7XG4gICAgICBjbS5kaXNwbGF5LmlucHV0LmJsdXIoKTtcbiAgICAgIGNtLmRpc3BsYXkuZGlzYWJsZWQgPSB0cnVlO1xuICAgIH0gZWxzZSB7XG4gICAgICBjbS5kaXNwbGF5LmRpc2FibGVkID0gZmFsc2U7XG4gICAgICBpZiAoIXZhbCkgY20uZGlzcGxheS5pbnB1dC5yZXNldCgpO1xuICAgIH1cbiAgfSk7XG4gIG9wdGlvbihcImRpc2FibGVJbnB1dFwiLCBmYWxzZSwgZnVuY3Rpb24oY20sIHZhbCkge2lmICghdmFsKSBjbS5kaXNwbGF5LmlucHV0LnJlc2V0KCk7fSwgdHJ1ZSk7XG4gIG9wdGlvbihcImRyYWdEcm9wXCIsIHRydWUsIGRyYWdEcm9wQ2hhbmdlZCk7XG5cbiAgb3B0aW9uKFwiY3Vyc29yQmxpbmtSYXRlXCIsIDUzMCk7XG4gIG9wdGlvbihcImN1cnNvclNjcm9sbE1hcmdpblwiLCAwKTtcbiAgb3B0aW9uKFwiY3Vyc29ySGVpZ2h0XCIsIDEsIHVwZGF0ZVNlbGVjdGlvbiwgdHJ1ZSk7XG4gIG9wdGlvbihcInNpbmdsZUN1cnNvckhlaWdodFBlckxpbmVcIiwgdHJ1ZSwgdXBkYXRlU2VsZWN0aW9uLCB0cnVlKTtcbiAgb3B0aW9uKFwid29ya1RpbWVcIiwgMTAwKTtcbiAgb3B0aW9uKFwid29ya0RlbGF5XCIsIDEwMCk7XG4gIG9wdGlvbihcImZsYXR0ZW5TcGFuc1wiLCB0cnVlLCByZXNldE1vZGVTdGF0ZSwgdHJ1ZSk7XG4gIG9wdGlvbihcImFkZE1vZGVDbGFzc1wiLCBmYWxzZSwgcmVzZXRNb2RlU3RhdGUsIHRydWUpO1xuICBvcHRpb24oXCJwb2xsSW50ZXJ2YWxcIiwgMTAwKTtcbiAgb3B0aW9uKFwidW5kb0RlcHRoXCIsIDIwMCwgZnVuY3Rpb24oY20sIHZhbCl7Y20uZG9jLmhpc3RvcnkudW5kb0RlcHRoID0gdmFsO30pO1xuICBvcHRpb24oXCJoaXN0b3J5RXZlbnREZWxheVwiLCAxMjUwKTtcbiAgb3B0aW9uKFwidmlld3BvcnRNYXJnaW5cIiwgMTAsIGZ1bmN0aW9uKGNtKXtjbS5yZWZyZXNoKCk7fSwgdHJ1ZSk7XG4gIG9wdGlvbihcIm1heEhpZ2hsaWdodExlbmd0aFwiLCAxMDAwMCwgcmVzZXRNb2RlU3RhdGUsIHRydWUpO1xuICBvcHRpb24oXCJtb3ZlSW5wdXRXaXRoQ3Vyc29yXCIsIHRydWUsIGZ1bmN0aW9uKGNtLCB2YWwpIHtcbiAgICBpZiAoIXZhbCkgY20uZGlzcGxheS5pbnB1dC5yZXNldFBvc2l0aW9uKCk7XG4gIH0pO1xuXG4gIG9wdGlvbihcInRhYmluZGV4XCIsIG51bGwsIGZ1bmN0aW9uKGNtLCB2YWwpIHtcbiAgICBjbS5kaXNwbGF5LmlucHV0LmdldEZpZWxkKCkudGFiSW5kZXggPSB2YWwgfHwgXCJcIjtcbiAgfSk7XG4gIG9wdGlvbihcImF1dG9mb2N1c1wiLCBudWxsKTtcblxuICAvLyBNT0RFIERFRklOSVRJT04gQU5EIFFVRVJZSU5HXG5cbiAgLy8gS25vd24gbW9kZXMsIGJ5IG5hbWUgYW5kIGJ5IE1JTUVcbiAgdmFyIG1vZGVzID0gQ29kZU1pcnJvci5tb2RlcyA9IHt9LCBtaW1lTW9kZXMgPSBDb2RlTWlycm9yLm1pbWVNb2RlcyA9IHt9O1xuXG4gIC8vIEV4dHJhIGFyZ3VtZW50cyBhcmUgc3RvcmVkIGFzIHRoZSBtb2RlJ3MgZGVwZW5kZW5jaWVzLCB3aGljaCBpc1xuICAvLyB1c2VkIGJ5IChsZWdhY3kpIG1lY2hhbmlzbXMgbGlrZSBsb2FkbW9kZS5qcyB0byBhdXRvbWF0aWNhbGx5XG4gIC8vIGxvYWQgYSBtb2RlLiAoUHJlZmVycmVkIG1lY2hhbmlzbSBpcyB0aGUgcmVxdWlyZS9kZWZpbmUgY2FsbHMuKVxuICBDb2RlTWlycm9yLmRlZmluZU1vZGUgPSBmdW5jdGlvbihuYW1lLCBtb2RlKSB7XG4gICAgaWYgKCFDb2RlTWlycm9yLmRlZmF1bHRzLm1vZGUgJiYgbmFtZSAhPSBcIm51bGxcIikgQ29kZU1pcnJvci5kZWZhdWx0cy5tb2RlID0gbmFtZTtcbiAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA+IDIpXG4gICAgICBtb2RlLmRlcGVuZGVuY2llcyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMik7XG4gICAgbW9kZXNbbmFtZV0gPSBtb2RlO1xuICB9O1xuXG4gIENvZGVNaXJyb3IuZGVmaW5lTUlNRSA9IGZ1bmN0aW9uKG1pbWUsIHNwZWMpIHtcbiAgICBtaW1lTW9kZXNbbWltZV0gPSBzcGVjO1xuICB9O1xuXG4gIC8vIEdpdmVuIGEgTUlNRSB0eXBlLCBhIHtuYW1lLCAuLi5vcHRpb25zfSBjb25maWcgb2JqZWN0LCBvciBhIG5hbWVcbiAgLy8gc3RyaW5nLCByZXR1cm4gYSBtb2RlIGNvbmZpZyBvYmplY3QuXG4gIENvZGVNaXJyb3IucmVzb2x2ZU1vZGUgPSBmdW5jdGlvbihzcGVjKSB7XG4gICAgaWYgKHR5cGVvZiBzcGVjID09IFwic3RyaW5nXCIgJiYgbWltZU1vZGVzLmhhc093blByb3BlcnR5KHNwZWMpKSB7XG4gICAgICBzcGVjID0gbWltZU1vZGVzW3NwZWNdO1xuICAgIH0gZWxzZSBpZiAoc3BlYyAmJiB0eXBlb2Ygc3BlYy5uYW1lID09IFwic3RyaW5nXCIgJiYgbWltZU1vZGVzLmhhc093blByb3BlcnR5KHNwZWMubmFtZSkpIHtcbiAgICAgIHZhciBmb3VuZCA9IG1pbWVNb2Rlc1tzcGVjLm5hbWVdO1xuICAgICAgaWYgKHR5cGVvZiBmb3VuZCA9PSBcInN0cmluZ1wiKSBmb3VuZCA9IHtuYW1lOiBmb3VuZH07XG4gICAgICBzcGVjID0gY3JlYXRlT2JqKGZvdW5kLCBzcGVjKTtcbiAgICAgIHNwZWMubmFtZSA9IGZvdW5kLm5hbWU7XG4gICAgfSBlbHNlIGlmICh0eXBlb2Ygc3BlYyA9PSBcInN0cmluZ1wiICYmIC9eW1xcd1xcLV0rXFwvW1xcd1xcLV0rXFwreG1sJC8udGVzdChzcGVjKSkge1xuICAgICAgcmV0dXJuIENvZGVNaXJyb3IucmVzb2x2ZU1vZGUoXCJhcHBsaWNhdGlvbi94bWxcIik7XG4gICAgfVxuICAgIGlmICh0eXBlb2Ygc3BlYyA9PSBcInN0cmluZ1wiKSByZXR1cm4ge25hbWU6IHNwZWN9O1xuICAgIGVsc2UgcmV0dXJuIHNwZWMgfHwge25hbWU6IFwibnVsbFwifTtcbiAgfTtcblxuICAvLyBHaXZlbiBhIG1vZGUgc3BlYyAoYW55dGhpbmcgdGhhdCByZXNvbHZlTW9kZSBhY2NlcHRzKSwgZmluZCBhbmRcbiAgLy8gaW5pdGlhbGl6ZSBhbiBhY3R1YWwgbW9kZSBvYmplY3QuXG4gIENvZGVNaXJyb3IuZ2V0TW9kZSA9IGZ1bmN0aW9uKG9wdGlvbnMsIHNwZWMpIHtcbiAgICB2YXIgc3BlYyA9IENvZGVNaXJyb3IucmVzb2x2ZU1vZGUoc3BlYyk7XG4gICAgdmFyIG1mYWN0b3J5ID0gbW9kZXNbc3BlYy5uYW1lXTtcbiAgICBpZiAoIW1mYWN0b3J5KSByZXR1cm4gQ29kZU1pcnJvci5nZXRNb2RlKG9wdGlvbnMsIFwidGV4dC9wbGFpblwiKTtcbiAgICB2YXIgbW9kZU9iaiA9IG1mYWN0b3J5KG9wdGlvbnMsIHNwZWMpO1xuICAgIGlmIChtb2RlRXh0ZW5zaW9ucy5oYXNPd25Qcm9wZXJ0eShzcGVjLm5hbWUpKSB7XG4gICAgICB2YXIgZXh0cyA9IG1vZGVFeHRlbnNpb25zW3NwZWMubmFtZV07XG4gICAgICBmb3IgKHZhciBwcm9wIGluIGV4dHMpIHtcbiAgICAgICAgaWYgKCFleHRzLmhhc093blByb3BlcnR5KHByb3ApKSBjb250aW51ZTtcbiAgICAgICAgaWYgKG1vZGVPYmouaGFzT3duUHJvcGVydHkocHJvcCkpIG1vZGVPYmpbXCJfXCIgKyBwcm9wXSA9IG1vZGVPYmpbcHJvcF07XG4gICAgICAgIG1vZGVPYmpbcHJvcF0gPSBleHRzW3Byb3BdO1xuICAgICAgfVxuICAgIH1cbiAgICBtb2RlT2JqLm5hbWUgPSBzcGVjLm5hbWU7XG4gICAgaWYgKHNwZWMuaGVscGVyVHlwZSkgbW9kZU9iai5oZWxwZXJUeXBlID0gc3BlYy5oZWxwZXJUeXBlO1xuICAgIGlmIChzcGVjLm1vZGVQcm9wcykgZm9yICh2YXIgcHJvcCBpbiBzcGVjLm1vZGVQcm9wcylcbiAgICAgIG1vZGVPYmpbcHJvcF0gPSBzcGVjLm1vZGVQcm9wc1twcm9wXTtcblxuICAgIHJldHVybiBtb2RlT2JqO1xuICB9O1xuXG4gIC8vIE1pbmltYWwgZGVmYXVsdCBtb2RlLlxuICBDb2RlTWlycm9yLmRlZmluZU1vZGUoXCJudWxsXCIsIGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB7dG9rZW46IGZ1bmN0aW9uKHN0cmVhbSkge3N0cmVhbS5za2lwVG9FbmQoKTt9fTtcbiAgfSk7XG4gIENvZGVNaXJyb3IuZGVmaW5lTUlNRShcInRleHQvcGxhaW5cIiwgXCJudWxsXCIpO1xuXG4gIC8vIFRoaXMgY2FuIGJlIHVzZWQgdG8gYXR0YWNoIHByb3BlcnRpZXMgdG8gbW9kZSBvYmplY3RzIGZyb21cbiAgLy8gb3V0c2lkZSB0aGUgYWN0dWFsIG1vZGUgZGVmaW5pdGlvbi5cbiAgdmFyIG1vZGVFeHRlbnNpb25zID0gQ29kZU1pcnJvci5tb2RlRXh0ZW5zaW9ucyA9IHt9O1xuICBDb2RlTWlycm9yLmV4dGVuZE1vZGUgPSBmdW5jdGlvbihtb2RlLCBwcm9wZXJ0aWVzKSB7XG4gICAgdmFyIGV4dHMgPSBtb2RlRXh0ZW5zaW9ucy5oYXNPd25Qcm9wZXJ0eShtb2RlKSA/IG1vZGVFeHRlbnNpb25zW21vZGVdIDogKG1vZGVFeHRlbnNpb25zW21vZGVdID0ge30pO1xuICAgIGNvcHlPYmoocHJvcGVydGllcywgZXh0cyk7XG4gIH07XG5cbiAgLy8gRVhURU5TSU9OU1xuXG4gIENvZGVNaXJyb3IuZGVmaW5lRXh0ZW5zaW9uID0gZnVuY3Rpb24obmFtZSwgZnVuYykge1xuICAgIENvZGVNaXJyb3IucHJvdG90eXBlW25hbWVdID0gZnVuYztcbiAgfTtcbiAgQ29kZU1pcnJvci5kZWZpbmVEb2NFeHRlbnNpb24gPSBmdW5jdGlvbihuYW1lLCBmdW5jKSB7XG4gICAgRG9jLnByb3RvdHlwZVtuYW1lXSA9IGZ1bmM7XG4gIH07XG4gIENvZGVNaXJyb3IuZGVmaW5lT3B0aW9uID0gb3B0aW9uO1xuXG4gIHZhciBpbml0SG9va3MgPSBbXTtcbiAgQ29kZU1pcnJvci5kZWZpbmVJbml0SG9vayA9IGZ1bmN0aW9uKGYpIHtpbml0SG9va3MucHVzaChmKTt9O1xuXG4gIHZhciBoZWxwZXJzID0gQ29kZU1pcnJvci5oZWxwZXJzID0ge307XG4gIENvZGVNaXJyb3IucmVnaXN0ZXJIZWxwZXIgPSBmdW5jdGlvbih0eXBlLCBuYW1lLCB2YWx1ZSkge1xuICAgIGlmICghaGVscGVycy5oYXNPd25Qcm9wZXJ0eSh0eXBlKSkgaGVscGVyc1t0eXBlXSA9IENvZGVNaXJyb3JbdHlwZV0gPSB7X2dsb2JhbDogW119O1xuICAgIGhlbHBlcnNbdHlwZV1bbmFtZV0gPSB2YWx1ZTtcbiAgfTtcbiAgQ29kZU1pcnJvci5yZWdpc3Rlckdsb2JhbEhlbHBlciA9IGZ1bmN0aW9uKHR5cGUsIG5hbWUsIHByZWRpY2F0ZSwgdmFsdWUpIHtcbiAgICBDb2RlTWlycm9yLnJlZ2lzdGVySGVscGVyKHR5cGUsIG5hbWUsIHZhbHVlKTtcbiAgICBoZWxwZXJzW3R5cGVdLl9nbG9iYWwucHVzaCh7cHJlZDogcHJlZGljYXRlLCB2YWw6IHZhbHVlfSk7XG4gIH07XG5cbiAgLy8gTU9ERSBTVEFURSBIQU5ETElOR1xuXG4gIC8vIFV0aWxpdHkgZnVuY3Rpb25zIGZvciB3b3JraW5nIHdpdGggc3RhdGUuIEV4cG9ydGVkIGJlY2F1c2UgbmVzdGVkXG4gIC8vIG1vZGVzIG5lZWQgdG8gZG8gdGhpcyBmb3IgdGhlaXIgaW5uZXIgbW9kZXMuXG5cbiAgdmFyIGNvcHlTdGF0ZSA9IENvZGVNaXJyb3IuY29weVN0YXRlID0gZnVuY3Rpb24obW9kZSwgc3RhdGUpIHtcbiAgICBpZiAoc3RhdGUgPT09IHRydWUpIHJldHVybiBzdGF0ZTtcbiAgICBpZiAobW9kZS5jb3B5U3RhdGUpIHJldHVybiBtb2RlLmNvcHlTdGF0ZShzdGF0ZSk7XG4gICAgdmFyIG5zdGF0ZSA9IHt9O1xuICAgIGZvciAodmFyIG4gaW4gc3RhdGUpIHtcbiAgICAgIHZhciB2YWwgPSBzdGF0ZVtuXTtcbiAgICAgIGlmICh2YWwgaW5zdGFuY2VvZiBBcnJheSkgdmFsID0gdmFsLmNvbmNhdChbXSk7XG4gICAgICBuc3RhdGVbbl0gPSB2YWw7XG4gICAgfVxuICAgIHJldHVybiBuc3RhdGU7XG4gIH07XG5cbiAgdmFyIHN0YXJ0U3RhdGUgPSBDb2RlTWlycm9yLnN0YXJ0U3RhdGUgPSBmdW5jdGlvbihtb2RlLCBhMSwgYTIpIHtcbiAgICByZXR1cm4gbW9kZS5zdGFydFN0YXRlID8gbW9kZS5zdGFydFN0YXRlKGExLCBhMikgOiB0cnVlO1xuICB9O1xuXG4gIC8vIEdpdmVuIGEgbW9kZSBhbmQgYSBzdGF0ZSAoZm9yIHRoYXQgbW9kZSksIGZpbmQgdGhlIGlubmVyIG1vZGUgYW5kXG4gIC8vIHN0YXRlIGF0IHRoZSBwb3NpdGlvbiB0aGF0IHRoZSBzdGF0ZSByZWZlcnMgdG8uXG4gIENvZGVNaXJyb3IuaW5uZXJNb2RlID0gZnVuY3Rpb24obW9kZSwgc3RhdGUpIHtcbiAgICB3aGlsZSAobW9kZS5pbm5lck1vZGUpIHtcbiAgICAgIHZhciBpbmZvID0gbW9kZS5pbm5lck1vZGUoc3RhdGUpO1xuICAgICAgaWYgKCFpbmZvIHx8IGluZm8ubW9kZSA9PSBtb2RlKSBicmVhaztcbiAgICAgIHN0YXRlID0gaW5mby5zdGF0ZTtcbiAgICAgIG1vZGUgPSBpbmZvLm1vZGU7XG4gICAgfVxuICAgIHJldHVybiBpbmZvIHx8IHttb2RlOiBtb2RlLCBzdGF0ZTogc3RhdGV9O1xuICB9O1xuXG4gIC8vIFNUQU5EQVJEIENPTU1BTkRTXG5cbiAgLy8gQ29tbWFuZHMgYXJlIHBhcmFtZXRlci1sZXNzIGFjdGlvbnMgdGhhdCBjYW4gYmUgcGVyZm9ybWVkIG9uIGFuXG4gIC8vIGVkaXRvciwgbW9zdGx5IHVzZWQgZm9yIGtleWJpbmRpbmdzLlxuICB2YXIgY29tbWFuZHMgPSBDb2RlTWlycm9yLmNvbW1hbmRzID0ge1xuICAgIHNlbGVjdEFsbDogZnVuY3Rpb24oY20pIHtjbS5zZXRTZWxlY3Rpb24oUG9zKGNtLmZpcnN0TGluZSgpLCAwKSwgUG9zKGNtLmxhc3RMaW5lKCkpLCBzZWxfZG9udFNjcm9sbCk7fSxcbiAgICBzaW5nbGVTZWxlY3Rpb246IGZ1bmN0aW9uKGNtKSB7XG4gICAgICBjbS5zZXRTZWxlY3Rpb24oY20uZ2V0Q3Vyc29yKFwiYW5jaG9yXCIpLCBjbS5nZXRDdXJzb3IoXCJoZWFkXCIpLCBzZWxfZG9udFNjcm9sbCk7XG4gICAgfSxcbiAgICBraWxsTGluZTogZnVuY3Rpb24oY20pIHtcbiAgICAgIGRlbGV0ZU5lYXJTZWxlY3Rpb24oY20sIGZ1bmN0aW9uKHJhbmdlKSB7XG4gICAgICAgIGlmIChyYW5nZS5lbXB0eSgpKSB7XG4gICAgICAgICAgdmFyIGxlbiA9IGdldExpbmUoY20uZG9jLCByYW5nZS5oZWFkLmxpbmUpLnRleHQubGVuZ3RoO1xuICAgICAgICAgIGlmIChyYW5nZS5oZWFkLmNoID09IGxlbiAmJiByYW5nZS5oZWFkLmxpbmUgPCBjbS5sYXN0TGluZSgpKVxuICAgICAgICAgICAgcmV0dXJuIHtmcm9tOiByYW5nZS5oZWFkLCB0bzogUG9zKHJhbmdlLmhlYWQubGluZSArIDEsIDApfTtcbiAgICAgICAgICBlbHNlXG4gICAgICAgICAgICByZXR1cm4ge2Zyb206IHJhbmdlLmhlYWQsIHRvOiBQb3MocmFuZ2UuaGVhZC5saW5lLCBsZW4pfTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXR1cm4ge2Zyb206IHJhbmdlLmZyb20oKSwgdG86IHJhbmdlLnRvKCl9O1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9LFxuICAgIGRlbGV0ZUxpbmU6IGZ1bmN0aW9uKGNtKSB7XG4gICAgICBkZWxldGVOZWFyU2VsZWN0aW9uKGNtLCBmdW5jdGlvbihyYW5nZSkge1xuICAgICAgICByZXR1cm4ge2Zyb206IFBvcyhyYW5nZS5mcm9tKCkubGluZSwgMCksXG4gICAgICAgICAgICAgICAgdG86IGNsaXBQb3MoY20uZG9jLCBQb3MocmFuZ2UudG8oKS5saW5lICsgMSwgMCkpfTtcbiAgICAgIH0pO1xuICAgIH0sXG4gICAgZGVsTGluZUxlZnQ6IGZ1bmN0aW9uKGNtKSB7XG4gICAgICBkZWxldGVOZWFyU2VsZWN0aW9uKGNtLCBmdW5jdGlvbihyYW5nZSkge1xuICAgICAgICByZXR1cm4ge2Zyb206IFBvcyhyYW5nZS5mcm9tKCkubGluZSwgMCksIHRvOiByYW5nZS5mcm9tKCl9O1xuICAgICAgfSk7XG4gICAgfSxcbiAgICBkZWxXcmFwcGVkTGluZUxlZnQ6IGZ1bmN0aW9uKGNtKSB7XG4gICAgICBkZWxldGVOZWFyU2VsZWN0aW9uKGNtLCBmdW5jdGlvbihyYW5nZSkge1xuICAgICAgICB2YXIgdG9wID0gY20uY2hhckNvb3JkcyhyYW5nZS5oZWFkLCBcImRpdlwiKS50b3AgKyA1O1xuICAgICAgICB2YXIgbGVmdFBvcyA9IGNtLmNvb3Jkc0NoYXIoe2xlZnQ6IDAsIHRvcDogdG9wfSwgXCJkaXZcIik7XG4gICAgICAgIHJldHVybiB7ZnJvbTogbGVmdFBvcywgdG86IHJhbmdlLmZyb20oKX07XG4gICAgICB9KTtcbiAgICB9LFxuICAgIGRlbFdyYXBwZWRMaW5lUmlnaHQ6IGZ1bmN0aW9uKGNtKSB7XG4gICAgICBkZWxldGVOZWFyU2VsZWN0aW9uKGNtLCBmdW5jdGlvbihyYW5nZSkge1xuICAgICAgICB2YXIgdG9wID0gY20uY2hhckNvb3JkcyhyYW5nZS5oZWFkLCBcImRpdlwiKS50b3AgKyA1O1xuICAgICAgICB2YXIgcmlnaHRQb3MgPSBjbS5jb29yZHNDaGFyKHtsZWZ0OiBjbS5kaXNwbGF5LmxpbmVEaXYub2Zmc2V0V2lkdGggKyAxMDAsIHRvcDogdG9wfSwgXCJkaXZcIik7XG4gICAgICAgIHJldHVybiB7ZnJvbTogcmFuZ2UuZnJvbSgpLCB0bzogcmlnaHRQb3MgfTtcbiAgICAgIH0pO1xuICAgIH0sXG4gICAgdW5kbzogZnVuY3Rpb24oY20pIHtjbS51bmRvKCk7fSxcbiAgICByZWRvOiBmdW5jdGlvbihjbSkge2NtLnJlZG8oKTt9LFxuICAgIHVuZG9TZWxlY3Rpb246IGZ1bmN0aW9uKGNtKSB7Y20udW5kb1NlbGVjdGlvbigpO30sXG4gICAgcmVkb1NlbGVjdGlvbjogZnVuY3Rpb24oY20pIHtjbS5yZWRvU2VsZWN0aW9uKCk7fSxcbiAgICBnb0RvY1N0YXJ0OiBmdW5jdGlvbihjbSkge2NtLmV4dGVuZFNlbGVjdGlvbihQb3MoY20uZmlyc3RMaW5lKCksIDApKTt9LFxuICAgIGdvRG9jRW5kOiBmdW5jdGlvbihjbSkge2NtLmV4dGVuZFNlbGVjdGlvbihQb3MoY20ubGFzdExpbmUoKSkpO30sXG4gICAgZ29MaW5lU3RhcnQ6IGZ1bmN0aW9uKGNtKSB7XG4gICAgICBjbS5leHRlbmRTZWxlY3Rpb25zQnkoZnVuY3Rpb24ocmFuZ2UpIHsgcmV0dXJuIGxpbmVTdGFydChjbSwgcmFuZ2UuaGVhZC5saW5lKTsgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB7b3JpZ2luOiBcIittb3ZlXCIsIGJpYXM6IDF9KTtcbiAgICB9LFxuICAgIGdvTGluZVN0YXJ0U21hcnQ6IGZ1bmN0aW9uKGNtKSB7XG4gICAgICBjbS5leHRlbmRTZWxlY3Rpb25zQnkoZnVuY3Rpb24ocmFuZ2UpIHtcbiAgICAgICAgcmV0dXJuIGxpbmVTdGFydFNtYXJ0KGNtLCByYW5nZS5oZWFkKTtcbiAgICAgIH0sIHtvcmlnaW46IFwiK21vdmVcIiwgYmlhczogMX0pO1xuICAgIH0sXG4gICAgZ29MaW5lRW5kOiBmdW5jdGlvbihjbSkge1xuICAgICAgY20uZXh0ZW5kU2VsZWN0aW9uc0J5KGZ1bmN0aW9uKHJhbmdlKSB7IHJldHVybiBsaW5lRW5kKGNtLCByYW5nZS5oZWFkLmxpbmUpOyB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHtvcmlnaW46IFwiK21vdmVcIiwgYmlhczogLTF9KTtcbiAgICB9LFxuICAgIGdvTGluZVJpZ2h0OiBmdW5jdGlvbihjbSkge1xuICAgICAgY20uZXh0ZW5kU2VsZWN0aW9uc0J5KGZ1bmN0aW9uKHJhbmdlKSB7XG4gICAgICAgIHZhciB0b3AgPSBjbS5jaGFyQ29vcmRzKHJhbmdlLmhlYWQsIFwiZGl2XCIpLnRvcCArIDU7XG4gICAgICAgIHJldHVybiBjbS5jb29yZHNDaGFyKHtsZWZ0OiBjbS5kaXNwbGF5LmxpbmVEaXYub2Zmc2V0V2lkdGggKyAxMDAsIHRvcDogdG9wfSwgXCJkaXZcIik7XG4gICAgICB9LCBzZWxfbW92ZSk7XG4gICAgfSxcbiAgICBnb0xpbmVMZWZ0OiBmdW5jdGlvbihjbSkge1xuICAgICAgY20uZXh0ZW5kU2VsZWN0aW9uc0J5KGZ1bmN0aW9uKHJhbmdlKSB7XG4gICAgICAgIHZhciB0b3AgPSBjbS5jaGFyQ29vcmRzKHJhbmdlLmhlYWQsIFwiZGl2XCIpLnRvcCArIDU7XG4gICAgICAgIHJldHVybiBjbS5jb29yZHNDaGFyKHtsZWZ0OiAwLCB0b3A6IHRvcH0sIFwiZGl2XCIpO1xuICAgICAgfSwgc2VsX21vdmUpO1xuICAgIH0sXG4gICAgZ29MaW5lTGVmdFNtYXJ0OiBmdW5jdGlvbihjbSkge1xuICAgICAgY20uZXh0ZW5kU2VsZWN0aW9uc0J5KGZ1bmN0aW9uKHJhbmdlKSB7XG4gICAgICAgIHZhciB0b3AgPSBjbS5jaGFyQ29vcmRzKHJhbmdlLmhlYWQsIFwiZGl2XCIpLnRvcCArIDU7XG4gICAgICAgIHZhciBwb3MgPSBjbS5jb29yZHNDaGFyKHtsZWZ0OiAwLCB0b3A6IHRvcH0sIFwiZGl2XCIpO1xuICAgICAgICBpZiAocG9zLmNoIDwgY20uZ2V0TGluZShwb3MubGluZSkuc2VhcmNoKC9cXFMvKSkgcmV0dXJuIGxpbmVTdGFydFNtYXJ0KGNtLCByYW5nZS5oZWFkKTtcbiAgICAgICAgcmV0dXJuIHBvcztcbiAgICAgIH0sIHNlbF9tb3ZlKTtcbiAgICB9LFxuICAgIGdvTGluZVVwOiBmdW5jdGlvbihjbSkge2NtLm1vdmVWKC0xLCBcImxpbmVcIik7fSxcbiAgICBnb0xpbmVEb3duOiBmdW5jdGlvbihjbSkge2NtLm1vdmVWKDEsIFwibGluZVwiKTt9LFxuICAgIGdvUGFnZVVwOiBmdW5jdGlvbihjbSkge2NtLm1vdmVWKC0xLCBcInBhZ2VcIik7fSxcbiAgICBnb1BhZ2VEb3duOiBmdW5jdGlvbihjbSkge2NtLm1vdmVWKDEsIFwicGFnZVwiKTt9LFxuICAgIGdvQ2hhckxlZnQ6IGZ1bmN0aW9uKGNtKSB7Y20ubW92ZUgoLTEsIFwiY2hhclwiKTt9LFxuICAgIGdvQ2hhclJpZ2h0OiBmdW5jdGlvbihjbSkge2NtLm1vdmVIKDEsIFwiY2hhclwiKTt9LFxuICAgIGdvQ29sdW1uTGVmdDogZnVuY3Rpb24oY20pIHtjbS5tb3ZlSCgtMSwgXCJjb2x1bW5cIik7fSxcbiAgICBnb0NvbHVtblJpZ2h0OiBmdW5jdGlvbihjbSkge2NtLm1vdmVIKDEsIFwiY29sdW1uXCIpO30sXG4gICAgZ29Xb3JkTGVmdDogZnVuY3Rpb24oY20pIHtjbS5tb3ZlSCgtMSwgXCJ3b3JkXCIpO30sXG4gICAgZ29Hcm91cFJpZ2h0OiBmdW5jdGlvbihjbSkge2NtLm1vdmVIKDEsIFwiZ3JvdXBcIik7fSxcbiAgICBnb0dyb3VwTGVmdDogZnVuY3Rpb24oY20pIHtjbS5tb3ZlSCgtMSwgXCJncm91cFwiKTt9LFxuICAgIGdvV29yZFJpZ2h0OiBmdW5jdGlvbihjbSkge2NtLm1vdmVIKDEsIFwid29yZFwiKTt9LFxuICAgIGRlbENoYXJCZWZvcmU6IGZ1bmN0aW9uKGNtKSB7Y20uZGVsZXRlSCgtMSwgXCJjaGFyXCIpO30sXG4gICAgZGVsQ2hhckFmdGVyOiBmdW5jdGlvbihjbSkge2NtLmRlbGV0ZUgoMSwgXCJjaGFyXCIpO30sXG4gICAgZGVsV29yZEJlZm9yZTogZnVuY3Rpb24oY20pIHtjbS5kZWxldGVIKC0xLCBcIndvcmRcIik7fSxcbiAgICBkZWxXb3JkQWZ0ZXI6IGZ1bmN0aW9uKGNtKSB7Y20uZGVsZXRlSCgxLCBcIndvcmRcIik7fSxcbiAgICBkZWxHcm91cEJlZm9yZTogZnVuY3Rpb24oY20pIHtjbS5kZWxldGVIKC0xLCBcImdyb3VwXCIpO30sXG4gICAgZGVsR3JvdXBBZnRlcjogZnVuY3Rpb24oY20pIHtjbS5kZWxldGVIKDEsIFwiZ3JvdXBcIik7fSxcbiAgICBpbmRlbnRBdXRvOiBmdW5jdGlvbihjbSkge2NtLmluZGVudFNlbGVjdGlvbihcInNtYXJ0XCIpO30sXG4gICAgaW5kZW50TW9yZTogZnVuY3Rpb24oY20pIHtjbS5pbmRlbnRTZWxlY3Rpb24oXCJhZGRcIik7fSxcbiAgICBpbmRlbnRMZXNzOiBmdW5jdGlvbihjbSkge2NtLmluZGVudFNlbGVjdGlvbihcInN1YnRyYWN0XCIpO30sXG4gICAgaW5zZXJ0VGFiOiBmdW5jdGlvbihjbSkge2NtLnJlcGxhY2VTZWxlY3Rpb24oXCJcXHRcIik7fSxcbiAgICBpbnNlcnRTb2Z0VGFiOiBmdW5jdGlvbihjbSkge1xuICAgICAgdmFyIHNwYWNlcyA9IFtdLCByYW5nZXMgPSBjbS5saXN0U2VsZWN0aW9ucygpLCB0YWJTaXplID0gY20ub3B0aW9ucy50YWJTaXplO1xuICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCByYW5nZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgdmFyIHBvcyA9IHJhbmdlc1tpXS5mcm9tKCk7XG4gICAgICAgIHZhciBjb2wgPSBjb3VudENvbHVtbihjbS5nZXRMaW5lKHBvcy5saW5lKSwgcG9zLmNoLCB0YWJTaXplKTtcbiAgICAgICAgc3BhY2VzLnB1c2gobmV3IEFycmF5KHRhYlNpemUgLSBjb2wgJSB0YWJTaXplICsgMSkuam9pbihcIiBcIikpO1xuICAgICAgfVxuICAgICAgY20ucmVwbGFjZVNlbGVjdGlvbnMoc3BhY2VzKTtcbiAgICB9LFxuICAgIGRlZmF1bHRUYWI6IGZ1bmN0aW9uKGNtKSB7XG4gICAgICBpZiAoY20uc29tZXRoaW5nU2VsZWN0ZWQoKSkgY20uaW5kZW50U2VsZWN0aW9uKFwiYWRkXCIpO1xuICAgICAgZWxzZSBjbS5leGVjQ29tbWFuZChcImluc2VydFRhYlwiKTtcbiAgICB9LFxuICAgIHRyYW5zcG9zZUNoYXJzOiBmdW5jdGlvbihjbSkge1xuICAgICAgcnVuSW5PcChjbSwgZnVuY3Rpb24oKSB7XG4gICAgICAgIHZhciByYW5nZXMgPSBjbS5saXN0U2VsZWN0aW9ucygpLCBuZXdTZWwgPSBbXTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCByYW5nZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICB2YXIgY3VyID0gcmFuZ2VzW2ldLmhlYWQsIGxpbmUgPSBnZXRMaW5lKGNtLmRvYywgY3VyLmxpbmUpLnRleHQ7XG4gICAgICAgICAgaWYgKGxpbmUpIHtcbiAgICAgICAgICAgIGlmIChjdXIuY2ggPT0gbGluZS5sZW5ndGgpIGN1ciA9IG5ldyBQb3MoY3VyLmxpbmUsIGN1ci5jaCAtIDEpO1xuICAgICAgICAgICAgaWYgKGN1ci5jaCA+IDApIHtcbiAgICAgICAgICAgICAgY3VyID0gbmV3IFBvcyhjdXIubGluZSwgY3VyLmNoICsgMSk7XG4gICAgICAgICAgICAgIGNtLnJlcGxhY2VSYW5nZShsaW5lLmNoYXJBdChjdXIuY2ggLSAxKSArIGxpbmUuY2hhckF0KGN1ci5jaCAtIDIpLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgUG9zKGN1ci5saW5lLCBjdXIuY2ggLSAyKSwgY3VyLCBcIit0cmFuc3Bvc2VcIik7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKGN1ci5saW5lID4gY20uZG9jLmZpcnN0KSB7XG4gICAgICAgICAgICAgIHZhciBwcmV2ID0gZ2V0TGluZShjbS5kb2MsIGN1ci5saW5lIC0gMSkudGV4dDtcbiAgICAgICAgICAgICAgaWYgKHByZXYpXG4gICAgICAgICAgICAgICAgY20ucmVwbGFjZVJhbmdlKGxpbmUuY2hhckF0KDApICsgXCJcXG5cIiArIHByZXYuY2hhckF0KHByZXYubGVuZ3RoIC0gMSksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFBvcyhjdXIubGluZSAtIDEsIHByZXYubGVuZ3RoIC0gMSksIFBvcyhjdXIubGluZSwgMSksIFwiK3RyYW5zcG9zZVwiKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgbmV3U2VsLnB1c2gobmV3IFJhbmdlKGN1ciwgY3VyKSk7XG4gICAgICAgIH1cbiAgICAgICAgY20uc2V0U2VsZWN0aW9ucyhuZXdTZWwpO1xuICAgICAgfSk7XG4gICAgfSxcbiAgICBuZXdsaW5lQW5kSW5kZW50OiBmdW5jdGlvbihjbSkge1xuICAgICAgcnVuSW5PcChjbSwgZnVuY3Rpb24oKSB7XG4gICAgICAgIHZhciBsZW4gPSBjbS5saXN0U2VsZWN0aW9ucygpLmxlbmd0aDtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW47IGkrKykge1xuICAgICAgICAgIHZhciByYW5nZSA9IGNtLmxpc3RTZWxlY3Rpb25zKClbaV07XG4gICAgICAgICAgY20ucmVwbGFjZVJhbmdlKFwiXFxuXCIsIHJhbmdlLmFuY2hvciwgcmFuZ2UuaGVhZCwgXCIraW5wdXRcIik7XG4gICAgICAgICAgY20uaW5kZW50TGluZShyYW5nZS5mcm9tKCkubGluZSArIDEsIG51bGwsIHRydWUpO1xuICAgICAgICAgIGVuc3VyZUN1cnNvclZpc2libGUoY20pO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9LFxuICAgIHRvZ2dsZU92ZXJ3cml0ZTogZnVuY3Rpb24oY20pIHtjbS50b2dnbGVPdmVyd3JpdGUoKTt9XG4gIH07XG5cblxuICAvLyBTVEFOREFSRCBLRVlNQVBTXG5cbiAgdmFyIGtleU1hcCA9IENvZGVNaXJyb3Iua2V5TWFwID0ge307XG5cbiAga2V5TWFwLmJhc2ljID0ge1xuICAgIFwiTGVmdFwiOiBcImdvQ2hhckxlZnRcIiwgXCJSaWdodFwiOiBcImdvQ2hhclJpZ2h0XCIsIFwiVXBcIjogXCJnb0xpbmVVcFwiLCBcIkRvd25cIjogXCJnb0xpbmVEb3duXCIsXG4gICAgXCJFbmRcIjogXCJnb0xpbmVFbmRcIiwgXCJIb21lXCI6IFwiZ29MaW5lU3RhcnRTbWFydFwiLCBcIlBhZ2VVcFwiOiBcImdvUGFnZVVwXCIsIFwiUGFnZURvd25cIjogXCJnb1BhZ2VEb3duXCIsXG4gICAgXCJEZWxldGVcIjogXCJkZWxDaGFyQWZ0ZXJcIiwgXCJCYWNrc3BhY2VcIjogXCJkZWxDaGFyQmVmb3JlXCIsIFwiU2hpZnQtQmFja3NwYWNlXCI6IFwiZGVsQ2hhckJlZm9yZVwiLFxuICAgIFwiVGFiXCI6IFwiZGVmYXVsdFRhYlwiLCBcIlNoaWZ0LVRhYlwiOiBcImluZGVudEF1dG9cIixcbiAgICBcIkVudGVyXCI6IFwibmV3bGluZUFuZEluZGVudFwiLCBcIkluc2VydFwiOiBcInRvZ2dsZU92ZXJ3cml0ZVwiLFxuICAgIFwiRXNjXCI6IFwic2luZ2xlU2VsZWN0aW9uXCJcbiAgfTtcbiAgLy8gTm90ZSB0aGF0IHRoZSBzYXZlIGFuZCBmaW5kLXJlbGF0ZWQgY29tbWFuZHMgYXJlbid0IGRlZmluZWQgYnlcbiAgLy8gZGVmYXVsdC4gVXNlciBjb2RlIG9yIGFkZG9ucyBjYW4gZGVmaW5lIHRoZW0uIFVua25vd24gY29tbWFuZHNcbiAgLy8gYXJlIHNpbXBseSBpZ25vcmVkLlxuICBrZXlNYXAucGNEZWZhdWx0ID0ge1xuICAgIFwiQ3RybC1BXCI6IFwic2VsZWN0QWxsXCIsIFwiQ3RybC1EXCI6IFwiZGVsZXRlTGluZVwiLCBcIkN0cmwtWlwiOiBcInVuZG9cIiwgXCJTaGlmdC1DdHJsLVpcIjogXCJyZWRvXCIsIFwiQ3RybC1ZXCI6IFwicmVkb1wiLFxuICAgIFwiQ3RybC1Ib21lXCI6IFwiZ29Eb2NTdGFydFwiLCBcIkN0cmwtRW5kXCI6IFwiZ29Eb2NFbmRcIiwgXCJDdHJsLVVwXCI6IFwiZ29MaW5lVXBcIiwgXCJDdHJsLURvd25cIjogXCJnb0xpbmVEb3duXCIsXG4gICAgXCJDdHJsLUxlZnRcIjogXCJnb0dyb3VwTGVmdFwiLCBcIkN0cmwtUmlnaHRcIjogXCJnb0dyb3VwUmlnaHRcIiwgXCJBbHQtTGVmdFwiOiBcImdvTGluZVN0YXJ0XCIsIFwiQWx0LVJpZ2h0XCI6IFwiZ29MaW5lRW5kXCIsXG4gICAgXCJDdHJsLUJhY2tzcGFjZVwiOiBcImRlbEdyb3VwQmVmb3JlXCIsIFwiQ3RybC1EZWxldGVcIjogXCJkZWxHcm91cEFmdGVyXCIsIFwiQ3RybC1TXCI6IFwic2F2ZVwiLCBcIkN0cmwtRlwiOiBcImZpbmRcIixcbiAgICBcIkN0cmwtR1wiOiBcImZpbmROZXh0XCIsIFwiU2hpZnQtQ3RybC1HXCI6IFwiZmluZFByZXZcIiwgXCJTaGlmdC1DdHJsLUZcIjogXCJyZXBsYWNlXCIsIFwiU2hpZnQtQ3RybC1SXCI6IFwicmVwbGFjZUFsbFwiLFxuICAgIFwiQ3RybC1bXCI6IFwiaW5kZW50TGVzc1wiLCBcIkN0cmwtXVwiOiBcImluZGVudE1vcmVcIixcbiAgICBcIkN0cmwtVVwiOiBcInVuZG9TZWxlY3Rpb25cIiwgXCJTaGlmdC1DdHJsLVVcIjogXCJyZWRvU2VsZWN0aW9uXCIsIFwiQWx0LVVcIjogXCJyZWRvU2VsZWN0aW9uXCIsXG4gICAgZmFsbHRocm91Z2g6IFwiYmFzaWNcIlxuICB9O1xuICAvLyBWZXJ5IGJhc2ljIHJlYWRsaW5lL2VtYWNzLXN0eWxlIGJpbmRpbmdzLCB3aGljaCBhcmUgc3RhbmRhcmQgb24gTWFjLlxuICBrZXlNYXAuZW1hY3N5ID0ge1xuICAgIFwiQ3RybC1GXCI6IFwiZ29DaGFyUmlnaHRcIiwgXCJDdHJsLUJcIjogXCJnb0NoYXJMZWZ0XCIsIFwiQ3RybC1QXCI6IFwiZ29MaW5lVXBcIiwgXCJDdHJsLU5cIjogXCJnb0xpbmVEb3duXCIsXG4gICAgXCJBbHQtRlwiOiBcImdvV29yZFJpZ2h0XCIsIFwiQWx0LUJcIjogXCJnb1dvcmRMZWZ0XCIsIFwiQ3RybC1BXCI6IFwiZ29MaW5lU3RhcnRcIiwgXCJDdHJsLUVcIjogXCJnb0xpbmVFbmRcIixcbiAgICBcIkN0cmwtVlwiOiBcImdvUGFnZURvd25cIiwgXCJTaGlmdC1DdHJsLVZcIjogXCJnb1BhZ2VVcFwiLCBcIkN0cmwtRFwiOiBcImRlbENoYXJBZnRlclwiLCBcIkN0cmwtSFwiOiBcImRlbENoYXJCZWZvcmVcIixcbiAgICBcIkFsdC1EXCI6IFwiZGVsV29yZEFmdGVyXCIsIFwiQWx0LUJhY2tzcGFjZVwiOiBcImRlbFdvcmRCZWZvcmVcIiwgXCJDdHJsLUtcIjogXCJraWxsTGluZVwiLCBcIkN0cmwtVFwiOiBcInRyYW5zcG9zZUNoYXJzXCJcbiAgfTtcbiAga2V5TWFwLm1hY0RlZmF1bHQgPSB7XG4gICAgXCJDbWQtQVwiOiBcInNlbGVjdEFsbFwiLCBcIkNtZC1EXCI6IFwiZGVsZXRlTGluZVwiLCBcIkNtZC1aXCI6IFwidW5kb1wiLCBcIlNoaWZ0LUNtZC1aXCI6IFwicmVkb1wiLCBcIkNtZC1ZXCI6IFwicmVkb1wiLFxuICAgIFwiQ21kLUhvbWVcIjogXCJnb0RvY1N0YXJ0XCIsIFwiQ21kLVVwXCI6IFwiZ29Eb2NTdGFydFwiLCBcIkNtZC1FbmRcIjogXCJnb0RvY0VuZFwiLCBcIkNtZC1Eb3duXCI6IFwiZ29Eb2NFbmRcIiwgXCJBbHQtTGVmdFwiOiBcImdvR3JvdXBMZWZ0XCIsXG4gICAgXCJBbHQtUmlnaHRcIjogXCJnb0dyb3VwUmlnaHRcIiwgXCJDbWQtTGVmdFwiOiBcImdvTGluZUxlZnRcIiwgXCJDbWQtUmlnaHRcIjogXCJnb0xpbmVSaWdodFwiLCBcIkFsdC1CYWNrc3BhY2VcIjogXCJkZWxHcm91cEJlZm9yZVwiLFxuICAgIFwiQ3RybC1BbHQtQmFja3NwYWNlXCI6IFwiZGVsR3JvdXBBZnRlclwiLCBcIkFsdC1EZWxldGVcIjogXCJkZWxHcm91cEFmdGVyXCIsIFwiQ21kLVNcIjogXCJzYXZlXCIsIFwiQ21kLUZcIjogXCJmaW5kXCIsXG4gICAgXCJDbWQtR1wiOiBcImZpbmROZXh0XCIsIFwiU2hpZnQtQ21kLUdcIjogXCJmaW5kUHJldlwiLCBcIkNtZC1BbHQtRlwiOiBcInJlcGxhY2VcIiwgXCJTaGlmdC1DbWQtQWx0LUZcIjogXCJyZXBsYWNlQWxsXCIsXG4gICAgXCJDbWQtW1wiOiBcImluZGVudExlc3NcIiwgXCJDbWQtXVwiOiBcImluZGVudE1vcmVcIiwgXCJDbWQtQmFja3NwYWNlXCI6IFwiZGVsV3JhcHBlZExpbmVMZWZ0XCIsIFwiQ21kLURlbGV0ZVwiOiBcImRlbFdyYXBwZWRMaW5lUmlnaHRcIixcbiAgICBcIkNtZC1VXCI6IFwidW5kb1NlbGVjdGlvblwiLCBcIlNoaWZ0LUNtZC1VXCI6IFwicmVkb1NlbGVjdGlvblwiLCBcIkN0cmwtVXBcIjogXCJnb0RvY1N0YXJ0XCIsIFwiQ3RybC1Eb3duXCI6IFwiZ29Eb2NFbmRcIixcbiAgICBmYWxsdGhyb3VnaDogW1wiYmFzaWNcIiwgXCJlbWFjc3lcIl1cbiAgfTtcbiAga2V5TWFwW1wiZGVmYXVsdFwiXSA9IG1hYyA/IGtleU1hcC5tYWNEZWZhdWx0IDoga2V5TWFwLnBjRGVmYXVsdDtcblxuICAvLyBLRVlNQVAgRElTUEFUQ0hcblxuICBmdW5jdGlvbiBub3JtYWxpemVLZXlOYW1lKG5hbWUpIHtcbiAgICB2YXIgcGFydHMgPSBuYW1lLnNwbGl0KC8tKD8hJCkvKSwgbmFtZSA9IHBhcnRzW3BhcnRzLmxlbmd0aCAtIDFdO1xuICAgIHZhciBhbHQsIGN0cmwsIHNoaWZ0LCBjbWQ7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBwYXJ0cy5sZW5ndGggLSAxOyBpKyspIHtcbiAgICAgIHZhciBtb2QgPSBwYXJ0c1tpXTtcbiAgICAgIGlmICgvXihjbWR8bWV0YXxtKSQvaS50ZXN0KG1vZCkpIGNtZCA9IHRydWU7XG4gICAgICBlbHNlIGlmICgvXmEobHQpPyQvaS50ZXN0KG1vZCkpIGFsdCA9IHRydWU7XG4gICAgICBlbHNlIGlmICgvXihjfGN0cmx8Y29udHJvbCkkL2kudGVzdChtb2QpKSBjdHJsID0gdHJ1ZTtcbiAgICAgIGVsc2UgaWYgKC9ecyhoaWZ0KSQvaS50ZXN0KG1vZCkpIHNoaWZ0ID0gdHJ1ZTtcbiAgICAgIGVsc2UgdGhyb3cgbmV3IEVycm9yKFwiVW5yZWNvZ25pemVkIG1vZGlmaWVyIG5hbWU6IFwiICsgbW9kKTtcbiAgICB9XG4gICAgaWYgKGFsdCkgbmFtZSA9IFwiQWx0LVwiICsgbmFtZTtcbiAgICBpZiAoY3RybCkgbmFtZSA9IFwiQ3RybC1cIiArIG5hbWU7XG4gICAgaWYgKGNtZCkgbmFtZSA9IFwiQ21kLVwiICsgbmFtZTtcbiAgICBpZiAoc2hpZnQpIG5hbWUgPSBcIlNoaWZ0LVwiICsgbmFtZTtcbiAgICByZXR1cm4gbmFtZTtcbiAgfVxuXG4gIC8vIFRoaXMgaXMgYSBrbHVkZ2UgdG8ga2VlcCBrZXltYXBzIG1vc3RseSB3b3JraW5nIGFzIHJhdyBvYmplY3RzXG4gIC8vIChiYWNrd2FyZHMgY29tcGF0aWJpbGl0eSkgd2hpbGUgYXQgdGhlIHNhbWUgdGltZSBzdXBwb3J0IGZlYXR1cmVzXG4gIC8vIGxpa2Ugbm9ybWFsaXphdGlvbiBhbmQgbXVsdGktc3Ryb2tlIGtleSBiaW5kaW5ncy4gSXQgY29tcGlsZXMgYVxuICAvLyBuZXcgbm9ybWFsaXplZCBrZXltYXAsIGFuZCB0aGVuIHVwZGF0ZXMgdGhlIG9sZCBvYmplY3QgdG8gcmVmbGVjdFxuICAvLyB0aGlzLlxuICBDb2RlTWlycm9yLm5vcm1hbGl6ZUtleU1hcCA9IGZ1bmN0aW9uKGtleW1hcCkge1xuICAgIHZhciBjb3B5ID0ge307XG4gICAgZm9yICh2YXIga2V5bmFtZSBpbiBrZXltYXApIGlmIChrZXltYXAuaGFzT3duUHJvcGVydHkoa2V5bmFtZSkpIHtcbiAgICAgIHZhciB2YWx1ZSA9IGtleW1hcFtrZXluYW1lXTtcbiAgICAgIGlmICgvXihuYW1lfGZhbGx0aHJvdWdofChkZXxhdCl0YWNoKSQvLnRlc3Qoa2V5bmFtZSkpIGNvbnRpbnVlO1xuICAgICAgaWYgKHZhbHVlID09IFwiLi4uXCIpIHsgZGVsZXRlIGtleW1hcFtrZXluYW1lXTsgY29udGludWU7IH1cblxuICAgICAgdmFyIGtleXMgPSBtYXAoa2V5bmFtZS5zcGxpdChcIiBcIiksIG5vcm1hbGl6ZUtleU5hbWUpO1xuICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBrZXlzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIHZhciB2YWwsIG5hbWU7XG4gICAgICAgIGlmIChpID09IGtleXMubGVuZ3RoIC0gMSkge1xuICAgICAgICAgIG5hbWUgPSBrZXlzLmpvaW4oXCIgXCIpO1xuICAgICAgICAgIHZhbCA9IHZhbHVlO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIG5hbWUgPSBrZXlzLnNsaWNlKDAsIGkgKyAxKS5qb2luKFwiIFwiKTtcbiAgICAgICAgICB2YWwgPSBcIi4uLlwiO1xuICAgICAgICB9XG4gICAgICAgIHZhciBwcmV2ID0gY29weVtuYW1lXTtcbiAgICAgICAgaWYgKCFwcmV2KSBjb3B5W25hbWVdID0gdmFsO1xuICAgICAgICBlbHNlIGlmIChwcmV2ICE9IHZhbCkgdGhyb3cgbmV3IEVycm9yKFwiSW5jb25zaXN0ZW50IGJpbmRpbmdzIGZvciBcIiArIG5hbWUpO1xuICAgICAgfVxuICAgICAgZGVsZXRlIGtleW1hcFtrZXluYW1lXTtcbiAgICB9XG4gICAgZm9yICh2YXIgcHJvcCBpbiBjb3B5KSBrZXltYXBbcHJvcF0gPSBjb3B5W3Byb3BdO1xuICAgIHJldHVybiBrZXltYXA7XG4gIH07XG5cbiAgdmFyIGxvb2t1cEtleSA9IENvZGVNaXJyb3IubG9va3VwS2V5ID0gZnVuY3Rpb24oa2V5LCBtYXAsIGhhbmRsZSwgY29udGV4dCkge1xuICAgIG1hcCA9IGdldEtleU1hcChtYXApO1xuICAgIHZhciBmb3VuZCA9IG1hcC5jYWxsID8gbWFwLmNhbGwoa2V5LCBjb250ZXh0KSA6IG1hcFtrZXldO1xuICAgIGlmIChmb3VuZCA9PT0gZmFsc2UpIHJldHVybiBcIm5vdGhpbmdcIjtcbiAgICBpZiAoZm91bmQgPT09IFwiLi4uXCIpIHJldHVybiBcIm11bHRpXCI7XG4gICAgaWYgKGZvdW5kICE9IG51bGwgJiYgaGFuZGxlKGZvdW5kKSkgcmV0dXJuIFwiaGFuZGxlZFwiO1xuXG4gICAgaWYgKG1hcC5mYWxsdGhyb3VnaCkge1xuICAgICAgaWYgKE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChtYXAuZmFsbHRocm91Z2gpICE9IFwiW29iamVjdCBBcnJheV1cIilcbiAgICAgICAgcmV0dXJuIGxvb2t1cEtleShrZXksIG1hcC5mYWxsdGhyb3VnaCwgaGFuZGxlLCBjb250ZXh0KTtcbiAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbWFwLmZhbGx0aHJvdWdoLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIHZhciByZXN1bHQgPSBsb29rdXBLZXkoa2V5LCBtYXAuZmFsbHRocm91Z2hbaV0sIGhhbmRsZSwgY29udGV4dCk7XG4gICAgICAgIGlmIChyZXN1bHQpIHJldHVybiByZXN1bHQ7XG4gICAgICB9XG4gICAgfVxuICB9O1xuXG4gIC8vIE1vZGlmaWVyIGtleSBwcmVzc2VzIGRvbid0IGNvdW50IGFzICdyZWFsJyBrZXkgcHJlc3NlcyBmb3IgdGhlXG4gIC8vIHB1cnBvc2Ugb2Yga2V5bWFwIGZhbGx0aHJvdWdoLlxuICB2YXIgaXNNb2RpZmllcktleSA9IENvZGVNaXJyb3IuaXNNb2RpZmllcktleSA9IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgdmFyIG5hbWUgPSB0eXBlb2YgdmFsdWUgPT0gXCJzdHJpbmdcIiA/IHZhbHVlIDoga2V5TmFtZXNbdmFsdWUua2V5Q29kZV07XG4gICAgcmV0dXJuIG5hbWUgPT0gXCJDdHJsXCIgfHwgbmFtZSA9PSBcIkFsdFwiIHx8IG5hbWUgPT0gXCJTaGlmdFwiIHx8IG5hbWUgPT0gXCJNb2RcIjtcbiAgfTtcblxuICAvLyBMb29rIHVwIHRoZSBuYW1lIG9mIGEga2V5IGFzIGluZGljYXRlZCBieSBhbiBldmVudCBvYmplY3QuXG4gIHZhciBrZXlOYW1lID0gQ29kZU1pcnJvci5rZXlOYW1lID0gZnVuY3Rpb24oZXZlbnQsIG5vU2hpZnQpIHtcbiAgICBpZiAocHJlc3RvICYmIGV2ZW50LmtleUNvZGUgPT0gMzQgJiYgZXZlbnRbXCJjaGFyXCJdKSByZXR1cm4gZmFsc2U7XG4gICAgdmFyIGJhc2UgPSBrZXlOYW1lc1tldmVudC5rZXlDb2RlXSwgbmFtZSA9IGJhc2U7XG4gICAgaWYgKG5hbWUgPT0gbnVsbCB8fCBldmVudC5hbHRHcmFwaEtleSkgcmV0dXJuIGZhbHNlO1xuICAgIGlmIChldmVudC5hbHRLZXkgJiYgYmFzZSAhPSBcIkFsdFwiKSBuYW1lID0gXCJBbHQtXCIgKyBuYW1lO1xuICAgIGlmICgoZmxpcEN0cmxDbWQgPyBldmVudC5tZXRhS2V5IDogZXZlbnQuY3RybEtleSkgJiYgYmFzZSAhPSBcIkN0cmxcIikgbmFtZSA9IFwiQ3RybC1cIiArIG5hbWU7XG4gICAgaWYgKChmbGlwQ3RybENtZCA/IGV2ZW50LmN0cmxLZXkgOiBldmVudC5tZXRhS2V5KSAmJiBiYXNlICE9IFwiQ21kXCIpIG5hbWUgPSBcIkNtZC1cIiArIG5hbWU7XG4gICAgaWYgKCFub1NoaWZ0ICYmIGV2ZW50LnNoaWZ0S2V5ICYmIGJhc2UgIT0gXCJTaGlmdFwiKSBuYW1lID0gXCJTaGlmdC1cIiArIG5hbWU7XG4gICAgcmV0dXJuIG5hbWU7XG4gIH07XG5cbiAgZnVuY3Rpb24gZ2V0S2V5TWFwKHZhbCkge1xuICAgIHJldHVybiB0eXBlb2YgdmFsID09IFwic3RyaW5nXCIgPyBrZXlNYXBbdmFsXSA6IHZhbDtcbiAgfVxuXG4gIC8vIEZST01URVhUQVJFQVxuXG4gIENvZGVNaXJyb3IuZnJvbVRleHRBcmVhID0gZnVuY3Rpb24odGV4dGFyZWEsIG9wdGlvbnMpIHtcbiAgICBvcHRpb25zID0gb3B0aW9ucyA/IGNvcHlPYmoob3B0aW9ucykgOiB7fTtcbiAgICBvcHRpb25zLnZhbHVlID0gdGV4dGFyZWEudmFsdWU7XG4gICAgaWYgKCFvcHRpb25zLnRhYmluZGV4ICYmIHRleHRhcmVhLnRhYkluZGV4KVxuICAgICAgb3B0aW9ucy50YWJpbmRleCA9IHRleHRhcmVhLnRhYkluZGV4O1xuICAgIGlmICghb3B0aW9ucy5wbGFjZWhvbGRlciAmJiB0ZXh0YXJlYS5wbGFjZWhvbGRlcilcbiAgICAgIG9wdGlvbnMucGxhY2Vob2xkZXIgPSB0ZXh0YXJlYS5wbGFjZWhvbGRlcjtcbiAgICAvLyBTZXQgYXV0b2ZvY3VzIHRvIHRydWUgaWYgdGhpcyB0ZXh0YXJlYSBpcyBmb2N1c2VkLCBvciBpZiBpdCBoYXNcbiAgICAvLyBhdXRvZm9jdXMgYW5kIG5vIG90aGVyIGVsZW1lbnQgaXMgZm9jdXNlZC5cbiAgICBpZiAob3B0aW9ucy5hdXRvZm9jdXMgPT0gbnVsbCkge1xuICAgICAgdmFyIGhhc0ZvY3VzID0gYWN0aXZlRWx0KCk7XG4gICAgICBvcHRpb25zLmF1dG9mb2N1cyA9IGhhc0ZvY3VzID09IHRleHRhcmVhIHx8XG4gICAgICAgIHRleHRhcmVhLmdldEF0dHJpYnV0ZShcImF1dG9mb2N1c1wiKSAhPSBudWxsICYmIGhhc0ZvY3VzID09IGRvY3VtZW50LmJvZHk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2F2ZSgpIHt0ZXh0YXJlYS52YWx1ZSA9IGNtLmdldFZhbHVlKCk7fVxuICAgIGlmICh0ZXh0YXJlYS5mb3JtKSB7XG4gICAgICBvbih0ZXh0YXJlYS5mb3JtLCBcInN1Ym1pdFwiLCBzYXZlKTtcbiAgICAgIC8vIERlcGxvcmFibGUgaGFjayB0byBtYWtlIHRoZSBzdWJtaXQgbWV0aG9kIGRvIHRoZSByaWdodCB0aGluZy5cbiAgICAgIGlmICghb3B0aW9ucy5sZWF2ZVN1Ym1pdE1ldGhvZEFsb25lKSB7XG4gICAgICAgIHZhciBmb3JtID0gdGV4dGFyZWEuZm9ybSwgcmVhbFN1Ym1pdCA9IGZvcm0uc3VibWl0O1xuICAgICAgICB0cnkge1xuICAgICAgICAgIHZhciB3cmFwcGVkU3VibWl0ID0gZm9ybS5zdWJtaXQgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHNhdmUoKTtcbiAgICAgICAgICAgIGZvcm0uc3VibWl0ID0gcmVhbFN1Ym1pdDtcbiAgICAgICAgICAgIGZvcm0uc3VibWl0KCk7XG4gICAgICAgICAgICBmb3JtLnN1Ym1pdCA9IHdyYXBwZWRTdWJtaXQ7XG4gICAgICAgICAgfTtcbiAgICAgICAgfSBjYXRjaChlKSB7fVxuICAgICAgfVxuICAgIH1cblxuICAgIG9wdGlvbnMuZmluaXNoSW5pdCA9IGZ1bmN0aW9uKGNtKSB7XG4gICAgICBjbS5zYXZlID0gc2F2ZTtcbiAgICAgIGNtLmdldFRleHRBcmVhID0gZnVuY3Rpb24oKSB7IHJldHVybiB0ZXh0YXJlYTsgfTtcbiAgICAgIGNtLnRvVGV4dEFyZWEgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgY20udG9UZXh0QXJlYSA9IGlzTmFOOyAvLyBQcmV2ZW50IHRoaXMgZnJvbSBiZWluZyByYW4gdHdpY2VcbiAgICAgICAgc2F2ZSgpO1xuICAgICAgICB0ZXh0YXJlYS5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKGNtLmdldFdyYXBwZXJFbGVtZW50KCkpO1xuICAgICAgICB0ZXh0YXJlYS5zdHlsZS5kaXNwbGF5ID0gXCJcIjtcbiAgICAgICAgaWYgKHRleHRhcmVhLmZvcm0pIHtcbiAgICAgICAgICBvZmYodGV4dGFyZWEuZm9ybSwgXCJzdWJtaXRcIiwgc2F2ZSk7XG4gICAgICAgICAgaWYgKHR5cGVvZiB0ZXh0YXJlYS5mb3JtLnN1Ym1pdCA9PSBcImZ1bmN0aW9uXCIpXG4gICAgICAgICAgICB0ZXh0YXJlYS5mb3JtLnN1Ym1pdCA9IHJlYWxTdWJtaXQ7XG4gICAgICAgIH1cbiAgICAgIH07XG4gICAgfTtcblxuICAgIHRleHRhcmVhLnN0eWxlLmRpc3BsYXkgPSBcIm5vbmVcIjtcbiAgICB2YXIgY20gPSBDb2RlTWlycm9yKGZ1bmN0aW9uKG5vZGUpIHtcbiAgICAgIHRleHRhcmVhLnBhcmVudE5vZGUuaW5zZXJ0QmVmb3JlKG5vZGUsIHRleHRhcmVhLm5leHRTaWJsaW5nKTtcbiAgICB9LCBvcHRpb25zKTtcbiAgICByZXR1cm4gY207XG4gIH07XG5cbiAgLy8gU1RSSU5HIFNUUkVBTVxuXG4gIC8vIEZlZCB0byB0aGUgbW9kZSBwYXJzZXJzLCBwcm92aWRlcyBoZWxwZXIgZnVuY3Rpb25zIHRvIG1ha2VcbiAgLy8gcGFyc2VycyBtb3JlIHN1Y2NpbmN0LlxuXG4gIHZhciBTdHJpbmdTdHJlYW0gPSBDb2RlTWlycm9yLlN0cmluZ1N0cmVhbSA9IGZ1bmN0aW9uKHN0cmluZywgdGFiU2l6ZSkge1xuICAgIHRoaXMucG9zID0gdGhpcy5zdGFydCA9IDA7XG4gICAgdGhpcy5zdHJpbmcgPSBzdHJpbmc7XG4gICAgdGhpcy50YWJTaXplID0gdGFiU2l6ZSB8fCA4O1xuICAgIHRoaXMubGFzdENvbHVtblBvcyA9IHRoaXMubGFzdENvbHVtblZhbHVlID0gMDtcbiAgICB0aGlzLmxpbmVTdGFydCA9IDA7XG4gIH07XG5cbiAgU3RyaW5nU3RyZWFtLnByb3RvdHlwZSA9IHtcbiAgICBlb2w6IGZ1bmN0aW9uKCkge3JldHVybiB0aGlzLnBvcyA+PSB0aGlzLnN0cmluZy5sZW5ndGg7fSxcbiAgICBzb2w6IGZ1bmN0aW9uKCkge3JldHVybiB0aGlzLnBvcyA9PSB0aGlzLmxpbmVTdGFydDt9LFxuICAgIHBlZWs6IGZ1bmN0aW9uKCkge3JldHVybiB0aGlzLnN0cmluZy5jaGFyQXQodGhpcy5wb3MpIHx8IHVuZGVmaW5lZDt9LFxuICAgIG5leHQ6IGZ1bmN0aW9uKCkge1xuICAgICAgaWYgKHRoaXMucG9zIDwgdGhpcy5zdHJpbmcubGVuZ3RoKVxuICAgICAgICByZXR1cm4gdGhpcy5zdHJpbmcuY2hhckF0KHRoaXMucG9zKyspO1xuICAgIH0sXG4gICAgZWF0OiBmdW5jdGlvbihtYXRjaCkge1xuICAgICAgdmFyIGNoID0gdGhpcy5zdHJpbmcuY2hhckF0KHRoaXMucG9zKTtcbiAgICAgIGlmICh0eXBlb2YgbWF0Y2ggPT0gXCJzdHJpbmdcIikgdmFyIG9rID0gY2ggPT0gbWF0Y2g7XG4gICAgICBlbHNlIHZhciBvayA9IGNoICYmIChtYXRjaC50ZXN0ID8gbWF0Y2gudGVzdChjaCkgOiBtYXRjaChjaCkpO1xuICAgICAgaWYgKG9rKSB7Kyt0aGlzLnBvczsgcmV0dXJuIGNoO31cbiAgICB9LFxuICAgIGVhdFdoaWxlOiBmdW5jdGlvbihtYXRjaCkge1xuICAgICAgdmFyIHN0YXJ0ID0gdGhpcy5wb3M7XG4gICAgICB3aGlsZSAodGhpcy5lYXQobWF0Y2gpKXt9XG4gICAgICByZXR1cm4gdGhpcy5wb3MgPiBzdGFydDtcbiAgICB9LFxuICAgIGVhdFNwYWNlOiBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBzdGFydCA9IHRoaXMucG9zO1xuICAgICAgd2hpbGUgKC9bXFxzXFx1MDBhMF0vLnRlc3QodGhpcy5zdHJpbmcuY2hhckF0KHRoaXMucG9zKSkpICsrdGhpcy5wb3M7XG4gICAgICByZXR1cm4gdGhpcy5wb3MgPiBzdGFydDtcbiAgICB9LFxuICAgIHNraXBUb0VuZDogZnVuY3Rpb24oKSB7dGhpcy5wb3MgPSB0aGlzLnN0cmluZy5sZW5ndGg7fSxcbiAgICBza2lwVG86IGZ1bmN0aW9uKGNoKSB7XG4gICAgICB2YXIgZm91bmQgPSB0aGlzLnN0cmluZy5pbmRleE9mKGNoLCB0aGlzLnBvcyk7XG4gICAgICBpZiAoZm91bmQgPiAtMSkge3RoaXMucG9zID0gZm91bmQ7IHJldHVybiB0cnVlO31cbiAgICB9LFxuICAgIGJhY2tVcDogZnVuY3Rpb24obikge3RoaXMucG9zIC09IG47fSxcbiAgICBjb2x1bW46IGZ1bmN0aW9uKCkge1xuICAgICAgaWYgKHRoaXMubGFzdENvbHVtblBvcyA8IHRoaXMuc3RhcnQpIHtcbiAgICAgICAgdGhpcy5sYXN0Q29sdW1uVmFsdWUgPSBjb3VudENvbHVtbih0aGlzLnN0cmluZywgdGhpcy5zdGFydCwgdGhpcy50YWJTaXplLCB0aGlzLmxhc3RDb2x1bW5Qb3MsIHRoaXMubGFzdENvbHVtblZhbHVlKTtcbiAgICAgICAgdGhpcy5sYXN0Q29sdW1uUG9zID0gdGhpcy5zdGFydDtcbiAgICAgIH1cbiAgICAgIHJldHVybiB0aGlzLmxhc3RDb2x1bW5WYWx1ZSAtICh0aGlzLmxpbmVTdGFydCA/IGNvdW50Q29sdW1uKHRoaXMuc3RyaW5nLCB0aGlzLmxpbmVTdGFydCwgdGhpcy50YWJTaXplKSA6IDApO1xuICAgIH0sXG4gICAgaW5kZW50YXRpb246IGZ1bmN0aW9uKCkge1xuICAgICAgcmV0dXJuIGNvdW50Q29sdW1uKHRoaXMuc3RyaW5nLCBudWxsLCB0aGlzLnRhYlNpemUpIC1cbiAgICAgICAgKHRoaXMubGluZVN0YXJ0ID8gY291bnRDb2x1bW4odGhpcy5zdHJpbmcsIHRoaXMubGluZVN0YXJ0LCB0aGlzLnRhYlNpemUpIDogMCk7XG4gICAgfSxcbiAgICBtYXRjaDogZnVuY3Rpb24ocGF0dGVybiwgY29uc3VtZSwgY2FzZUluc2Vuc2l0aXZlKSB7XG4gICAgICBpZiAodHlwZW9mIHBhdHRlcm4gPT0gXCJzdHJpbmdcIikge1xuICAgICAgICB2YXIgY2FzZWQgPSBmdW5jdGlvbihzdHIpIHtyZXR1cm4gY2FzZUluc2Vuc2l0aXZlID8gc3RyLnRvTG93ZXJDYXNlKCkgOiBzdHI7fTtcbiAgICAgICAgdmFyIHN1YnN0ciA9IHRoaXMuc3RyaW5nLnN1YnN0cih0aGlzLnBvcywgcGF0dGVybi5sZW5ndGgpO1xuICAgICAgICBpZiAoY2FzZWQoc3Vic3RyKSA9PSBjYXNlZChwYXR0ZXJuKSkge1xuICAgICAgICAgIGlmIChjb25zdW1lICE9PSBmYWxzZSkgdGhpcy5wb3MgKz0gcGF0dGVybi5sZW5ndGg7XG4gICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHZhciBtYXRjaCA9IHRoaXMuc3RyaW5nLnNsaWNlKHRoaXMucG9zKS5tYXRjaChwYXR0ZXJuKTtcbiAgICAgICAgaWYgKG1hdGNoICYmIG1hdGNoLmluZGV4ID4gMCkgcmV0dXJuIG51bGw7XG4gICAgICAgIGlmIChtYXRjaCAmJiBjb25zdW1lICE9PSBmYWxzZSkgdGhpcy5wb3MgKz0gbWF0Y2hbMF0ubGVuZ3RoO1xuICAgICAgICByZXR1cm4gbWF0Y2g7XG4gICAgICB9XG4gICAgfSxcbiAgICBjdXJyZW50OiBmdW5jdGlvbigpe3JldHVybiB0aGlzLnN0cmluZy5zbGljZSh0aGlzLnN0YXJ0LCB0aGlzLnBvcyk7fSxcbiAgICBoaWRlRmlyc3RDaGFyczogZnVuY3Rpb24obiwgaW5uZXIpIHtcbiAgICAgIHRoaXMubGluZVN0YXJ0ICs9IG47XG4gICAgICB0cnkgeyByZXR1cm4gaW5uZXIoKTsgfVxuICAgICAgZmluYWxseSB7IHRoaXMubGluZVN0YXJ0IC09IG47IH1cbiAgICB9XG4gIH07XG5cbiAgLy8gVEVYVE1BUktFUlNcblxuICAvLyBDcmVhdGVkIHdpdGggbWFya1RleHQgYW5kIHNldEJvb2ttYXJrIG1ldGhvZHMuIEEgVGV4dE1hcmtlciBpcyBhXG4gIC8vIGhhbmRsZSB0aGF0IGNhbiBiZSB1c2VkIHRvIGNsZWFyIG9yIGZpbmQgYSBtYXJrZWQgcG9zaXRpb24gaW4gdGhlXG4gIC8vIGRvY3VtZW50LiBMaW5lIG9iamVjdHMgaG9sZCBhcnJheXMgKG1hcmtlZFNwYW5zKSBjb250YWluaW5nXG4gIC8vIHtmcm9tLCB0bywgbWFya2VyfSBvYmplY3QgcG9pbnRpbmcgdG8gc3VjaCBtYXJrZXIgb2JqZWN0cywgYW5kXG4gIC8vIGluZGljYXRpbmcgdGhhdCBzdWNoIGEgbWFya2VyIGlzIHByZXNlbnQgb24gdGhhdCBsaW5lLiBNdWx0aXBsZVxuICAvLyBsaW5lcyBtYXkgcG9pbnQgdG8gdGhlIHNhbWUgbWFya2VyIHdoZW4gaXQgc3BhbnMgYWNyb3NzIGxpbmVzLlxuICAvLyBUaGUgc3BhbnMgd2lsbCBoYXZlIG51bGwgZm9yIHRoZWlyIGZyb20vdG8gcHJvcGVydGllcyB3aGVuIHRoZVxuICAvLyBtYXJrZXIgY29udGludWVzIGJleW9uZCB0aGUgc3RhcnQvZW5kIG9mIHRoZSBsaW5lLiBNYXJrZXJzIGhhdmVcbiAgLy8gbGlua3MgYmFjayB0byB0aGUgbGluZXMgdGhleSBjdXJyZW50bHkgdG91Y2guXG5cbiAgdmFyIG5leHRNYXJrZXJJZCA9IDA7XG5cbiAgdmFyIFRleHRNYXJrZXIgPSBDb2RlTWlycm9yLlRleHRNYXJrZXIgPSBmdW5jdGlvbihkb2MsIHR5cGUpIHtcbiAgICB0aGlzLmxpbmVzID0gW107XG4gICAgdGhpcy50eXBlID0gdHlwZTtcbiAgICB0aGlzLmRvYyA9IGRvYztcbiAgICB0aGlzLmlkID0gKytuZXh0TWFya2VySWQ7XG4gIH07XG4gIGV2ZW50TWl4aW4oVGV4dE1hcmtlcik7XG5cbiAgLy8gQ2xlYXIgdGhlIG1hcmtlci5cbiAgVGV4dE1hcmtlci5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbigpIHtcbiAgICBpZiAodGhpcy5leHBsaWNpdGx5Q2xlYXJlZCkgcmV0dXJuO1xuICAgIHZhciBjbSA9IHRoaXMuZG9jLmNtLCB3aXRoT3AgPSBjbSAmJiAhY20uY3VyT3A7XG4gICAgaWYgKHdpdGhPcCkgc3RhcnRPcGVyYXRpb24oY20pO1xuICAgIGlmIChoYXNIYW5kbGVyKHRoaXMsIFwiY2xlYXJcIikpIHtcbiAgICAgIHZhciBmb3VuZCA9IHRoaXMuZmluZCgpO1xuICAgICAgaWYgKGZvdW5kKSBzaWduYWxMYXRlcih0aGlzLCBcImNsZWFyXCIsIGZvdW5kLmZyb20sIGZvdW5kLnRvKTtcbiAgICB9XG4gICAgdmFyIG1pbiA9IG51bGwsIG1heCA9IG51bGw7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLmxpbmVzLmxlbmd0aDsgKytpKSB7XG4gICAgICB2YXIgbGluZSA9IHRoaXMubGluZXNbaV07XG4gICAgICB2YXIgc3BhbiA9IGdldE1hcmtlZFNwYW5Gb3IobGluZS5tYXJrZWRTcGFucywgdGhpcyk7XG4gICAgICBpZiAoY20gJiYgIXRoaXMuY29sbGFwc2VkKSByZWdMaW5lQ2hhbmdlKGNtLCBsaW5lTm8obGluZSksIFwidGV4dFwiKTtcbiAgICAgIGVsc2UgaWYgKGNtKSB7XG4gICAgICAgIGlmIChzcGFuLnRvICE9IG51bGwpIG1heCA9IGxpbmVObyhsaW5lKTtcbiAgICAgICAgaWYgKHNwYW4uZnJvbSAhPSBudWxsKSBtaW4gPSBsaW5lTm8obGluZSk7XG4gICAgICB9XG4gICAgICBsaW5lLm1hcmtlZFNwYW5zID0gcmVtb3ZlTWFya2VkU3BhbihsaW5lLm1hcmtlZFNwYW5zLCBzcGFuKTtcbiAgICAgIGlmIChzcGFuLmZyb20gPT0gbnVsbCAmJiB0aGlzLmNvbGxhcHNlZCAmJiAhbGluZUlzSGlkZGVuKHRoaXMuZG9jLCBsaW5lKSAmJiBjbSlcbiAgICAgICAgdXBkYXRlTGluZUhlaWdodChsaW5lLCB0ZXh0SGVpZ2h0KGNtLmRpc3BsYXkpKTtcbiAgICB9XG4gICAgaWYgKGNtICYmIHRoaXMuY29sbGFwc2VkICYmICFjbS5vcHRpb25zLmxpbmVXcmFwcGluZykgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLmxpbmVzLmxlbmd0aDsgKytpKSB7XG4gICAgICB2YXIgdmlzdWFsID0gdmlzdWFsTGluZSh0aGlzLmxpbmVzW2ldKSwgbGVuID0gbGluZUxlbmd0aCh2aXN1YWwpO1xuICAgICAgaWYgKGxlbiA+IGNtLmRpc3BsYXkubWF4TGluZUxlbmd0aCkge1xuICAgICAgICBjbS5kaXNwbGF5Lm1heExpbmUgPSB2aXN1YWw7XG4gICAgICAgIGNtLmRpc3BsYXkubWF4TGluZUxlbmd0aCA9IGxlbjtcbiAgICAgICAgY20uZGlzcGxheS5tYXhMaW5lQ2hhbmdlZCA9IHRydWU7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKG1pbiAhPSBudWxsICYmIGNtICYmIHRoaXMuY29sbGFwc2VkKSByZWdDaGFuZ2UoY20sIG1pbiwgbWF4ICsgMSk7XG4gICAgdGhpcy5saW5lcy5sZW5ndGggPSAwO1xuICAgIHRoaXMuZXhwbGljaXRseUNsZWFyZWQgPSB0cnVlO1xuICAgIGlmICh0aGlzLmF0b21pYyAmJiB0aGlzLmRvYy5jYW50RWRpdCkge1xuICAgICAgdGhpcy5kb2MuY2FudEVkaXQgPSBmYWxzZTtcbiAgICAgIGlmIChjbSkgcmVDaGVja1NlbGVjdGlvbihjbS5kb2MpO1xuICAgIH1cbiAgICBpZiAoY20pIHNpZ25hbExhdGVyKGNtLCBcIm1hcmtlckNsZWFyZWRcIiwgY20sIHRoaXMpO1xuICAgIGlmICh3aXRoT3ApIGVuZE9wZXJhdGlvbihjbSk7XG4gICAgaWYgKHRoaXMucGFyZW50KSB0aGlzLnBhcmVudC5jbGVhcigpO1xuICB9O1xuXG4gIC8vIEZpbmQgdGhlIHBvc2l0aW9uIG9mIHRoZSBtYXJrZXIgaW4gdGhlIGRvY3VtZW50LiBSZXR1cm5zIGEge2Zyb20sXG4gIC8vIHRvfSBvYmplY3QgYnkgZGVmYXVsdC4gU2lkZSBjYW4gYmUgcGFzc2VkIHRvIGdldCBhIHNwZWNpZmljIHNpZGVcbiAgLy8gLS0gMCAoYm90aCksIC0xIChsZWZ0KSwgb3IgMSAocmlnaHQpLiBXaGVuIGxpbmVPYmogaXMgdHJ1ZSwgdGhlXG4gIC8vIFBvcyBvYmplY3RzIHJldHVybmVkIGNvbnRhaW4gYSBsaW5lIG9iamVjdCwgcmF0aGVyIHRoYW4gYSBsaW5lXG4gIC8vIG51bWJlciAodXNlZCB0byBwcmV2ZW50IGxvb2tpbmcgdXAgdGhlIHNhbWUgbGluZSB0d2ljZSkuXG4gIFRleHRNYXJrZXIucHJvdG90eXBlLmZpbmQgPSBmdW5jdGlvbihzaWRlLCBsaW5lT2JqKSB7XG4gICAgaWYgKHNpZGUgPT0gbnVsbCAmJiB0aGlzLnR5cGUgPT0gXCJib29rbWFya1wiKSBzaWRlID0gMTtcbiAgICB2YXIgZnJvbSwgdG87XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLmxpbmVzLmxlbmd0aDsgKytpKSB7XG4gICAgICB2YXIgbGluZSA9IHRoaXMubGluZXNbaV07XG4gICAgICB2YXIgc3BhbiA9IGdldE1hcmtlZFNwYW5Gb3IobGluZS5tYXJrZWRTcGFucywgdGhpcyk7XG4gICAgICBpZiAoc3Bhbi5mcm9tICE9IG51bGwpIHtcbiAgICAgICAgZnJvbSA9IFBvcyhsaW5lT2JqID8gbGluZSA6IGxpbmVObyhsaW5lKSwgc3Bhbi5mcm9tKTtcbiAgICAgICAgaWYgKHNpZGUgPT0gLTEpIHJldHVybiBmcm9tO1xuICAgICAgfVxuICAgICAgaWYgKHNwYW4udG8gIT0gbnVsbCkge1xuICAgICAgICB0byA9IFBvcyhsaW5lT2JqID8gbGluZSA6IGxpbmVObyhsaW5lKSwgc3Bhbi50byk7XG4gICAgICAgIGlmIChzaWRlID09IDEpIHJldHVybiB0bztcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIGZyb20gJiYge2Zyb206IGZyb20sIHRvOiB0b307XG4gIH07XG5cbiAgLy8gU2lnbmFscyB0aGF0IHRoZSBtYXJrZXIncyB3aWRnZXQgY2hhbmdlZCwgYW5kIHN1cnJvdW5kaW5nIGxheW91dFxuICAvLyBzaG91bGQgYmUgcmVjb21wdXRlZC5cbiAgVGV4dE1hcmtlci5wcm90b3R5cGUuY2hhbmdlZCA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBwb3MgPSB0aGlzLmZpbmQoLTEsIHRydWUpLCB3aWRnZXQgPSB0aGlzLCBjbSA9IHRoaXMuZG9jLmNtO1xuICAgIGlmICghcG9zIHx8ICFjbSkgcmV0dXJuO1xuICAgIHJ1bkluT3AoY20sIGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIGxpbmUgPSBwb3MubGluZSwgbGluZU4gPSBsaW5lTm8ocG9zLmxpbmUpO1xuICAgICAgdmFyIHZpZXcgPSBmaW5kVmlld0ZvckxpbmUoY20sIGxpbmVOKTtcbiAgICAgIGlmICh2aWV3KSB7XG4gICAgICAgIGNsZWFyTGluZU1lYXN1cmVtZW50Q2FjaGVGb3Iodmlldyk7XG4gICAgICAgIGNtLmN1ck9wLnNlbGVjdGlvbkNoYW5nZWQgPSBjbS5jdXJPcC5mb3JjZVVwZGF0ZSA9IHRydWU7XG4gICAgICB9XG4gICAgICBjbS5jdXJPcC51cGRhdGVNYXhMaW5lID0gdHJ1ZTtcbiAgICAgIGlmICghbGluZUlzSGlkZGVuKHdpZGdldC5kb2MsIGxpbmUpICYmIHdpZGdldC5oZWlnaHQgIT0gbnVsbCkge1xuICAgICAgICB2YXIgb2xkSGVpZ2h0ID0gd2lkZ2V0LmhlaWdodDtcbiAgICAgICAgd2lkZ2V0LmhlaWdodCA9IG51bGw7XG4gICAgICAgIHZhciBkSGVpZ2h0ID0gd2lkZ2V0SGVpZ2h0KHdpZGdldCkgLSBvbGRIZWlnaHQ7XG4gICAgICAgIGlmIChkSGVpZ2h0KVxuICAgICAgICAgIHVwZGF0ZUxpbmVIZWlnaHQobGluZSwgbGluZS5oZWlnaHQgKyBkSGVpZ2h0KTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfTtcblxuICBUZXh0TWFya2VyLnByb3RvdHlwZS5hdHRhY2hMaW5lID0gZnVuY3Rpb24obGluZSkge1xuICAgIGlmICghdGhpcy5saW5lcy5sZW5ndGggJiYgdGhpcy5kb2MuY20pIHtcbiAgICAgIHZhciBvcCA9IHRoaXMuZG9jLmNtLmN1ck9wO1xuICAgICAgaWYgKCFvcC5tYXliZUhpZGRlbk1hcmtlcnMgfHwgaW5kZXhPZihvcC5tYXliZUhpZGRlbk1hcmtlcnMsIHRoaXMpID09IC0xKVxuICAgICAgICAob3AubWF5YmVVbmhpZGRlbk1hcmtlcnMgfHwgKG9wLm1heWJlVW5oaWRkZW5NYXJrZXJzID0gW10pKS5wdXNoKHRoaXMpO1xuICAgIH1cbiAgICB0aGlzLmxpbmVzLnB1c2gobGluZSk7XG4gIH07XG4gIFRleHRNYXJrZXIucHJvdG90eXBlLmRldGFjaExpbmUgPSBmdW5jdGlvbihsaW5lKSB7XG4gICAgdGhpcy5saW5lcy5zcGxpY2UoaW5kZXhPZih0aGlzLmxpbmVzLCBsaW5lKSwgMSk7XG4gICAgaWYgKCF0aGlzLmxpbmVzLmxlbmd0aCAmJiB0aGlzLmRvYy5jbSkge1xuICAgICAgdmFyIG9wID0gdGhpcy5kb2MuY20uY3VyT3A7XG4gICAgICAob3AubWF5YmVIaWRkZW5NYXJrZXJzIHx8IChvcC5tYXliZUhpZGRlbk1hcmtlcnMgPSBbXSkpLnB1c2godGhpcyk7XG4gICAgfVxuICB9O1xuXG4gIC8vIENvbGxhcHNlZCBtYXJrZXJzIGhhdmUgdW5pcXVlIGlkcywgaW4gb3JkZXIgdG8gYmUgYWJsZSB0byBvcmRlclxuICAvLyB0aGVtLCB3aGljaCBpcyBuZWVkZWQgZm9yIHVuaXF1ZWx5IGRldGVybWluaW5nIGFuIG91dGVyIG1hcmtlclxuICAvLyB3aGVuIHRoZXkgb3ZlcmxhcCAodGhleSBtYXkgbmVzdCwgYnV0IG5vdCBwYXJ0aWFsbHkgb3ZlcmxhcCkuXG4gIHZhciBuZXh0TWFya2VySWQgPSAwO1xuXG4gIC8vIENyZWF0ZSBhIG1hcmtlciwgd2lyZSBpdCB1cCB0byB0aGUgcmlnaHQgbGluZXMsIGFuZFxuICBmdW5jdGlvbiBtYXJrVGV4dChkb2MsIGZyb20sIHRvLCBvcHRpb25zLCB0eXBlKSB7XG4gICAgLy8gU2hhcmVkIG1hcmtlcnMgKGFjcm9zcyBsaW5rZWQgZG9jdW1lbnRzKSBhcmUgaGFuZGxlZCBzZXBhcmF0ZWx5XG4gICAgLy8gKG1hcmtUZXh0U2hhcmVkIHdpbGwgY2FsbCBvdXQgdG8gdGhpcyBhZ2Fpbiwgb25jZSBwZXJcbiAgICAvLyBkb2N1bWVudCkuXG4gICAgaWYgKG9wdGlvbnMgJiYgb3B0aW9ucy5zaGFyZWQpIHJldHVybiBtYXJrVGV4dFNoYXJlZChkb2MsIGZyb20sIHRvLCBvcHRpb25zLCB0eXBlKTtcbiAgICAvLyBFbnN1cmUgd2UgYXJlIGluIGFuIG9wZXJhdGlvbi5cbiAgICBpZiAoZG9jLmNtICYmICFkb2MuY20uY3VyT3ApIHJldHVybiBvcGVyYXRpb24oZG9jLmNtLCBtYXJrVGV4dCkoZG9jLCBmcm9tLCB0bywgb3B0aW9ucywgdHlwZSk7XG5cbiAgICB2YXIgbWFya2VyID0gbmV3IFRleHRNYXJrZXIoZG9jLCB0eXBlKSwgZGlmZiA9IGNtcChmcm9tLCB0byk7XG4gICAgaWYgKG9wdGlvbnMpIGNvcHlPYmoob3B0aW9ucywgbWFya2VyLCBmYWxzZSk7XG4gICAgLy8gRG9uJ3QgY29ubmVjdCBlbXB0eSBtYXJrZXJzIHVubGVzcyBjbGVhcldoZW5FbXB0eSBpcyBmYWxzZVxuICAgIGlmIChkaWZmID4gMCB8fCBkaWZmID09IDAgJiYgbWFya2VyLmNsZWFyV2hlbkVtcHR5ICE9PSBmYWxzZSlcbiAgICAgIHJldHVybiBtYXJrZXI7XG4gICAgaWYgKG1hcmtlci5yZXBsYWNlZFdpdGgpIHtcbiAgICAgIC8vIFNob3dpbmcgdXAgYXMgYSB3aWRnZXQgaW1wbGllcyBjb2xsYXBzZWQgKHdpZGdldCByZXBsYWNlcyB0ZXh0KVxuICAgICAgbWFya2VyLmNvbGxhcHNlZCA9IHRydWU7XG4gICAgICBtYXJrZXIud2lkZ2V0Tm9kZSA9IGVsdChcInNwYW5cIiwgW21hcmtlci5yZXBsYWNlZFdpdGhdLCBcIkNvZGVNaXJyb3Itd2lkZ2V0XCIpO1xuICAgICAgaWYgKCFvcHRpb25zLmhhbmRsZU1vdXNlRXZlbnRzKSBtYXJrZXIud2lkZ2V0Tm9kZS5zZXRBdHRyaWJ1dGUoXCJjbS1pZ25vcmUtZXZlbnRzXCIsIFwidHJ1ZVwiKTtcbiAgICAgIGlmIChvcHRpb25zLmluc2VydExlZnQpIG1hcmtlci53aWRnZXROb2RlLmluc2VydExlZnQgPSB0cnVlO1xuICAgIH1cbiAgICBpZiAobWFya2VyLmNvbGxhcHNlZCkge1xuICAgICAgaWYgKGNvbmZsaWN0aW5nQ29sbGFwc2VkUmFuZ2UoZG9jLCBmcm9tLmxpbmUsIGZyb20sIHRvLCBtYXJrZXIpIHx8XG4gICAgICAgICAgZnJvbS5saW5lICE9IHRvLmxpbmUgJiYgY29uZmxpY3RpbmdDb2xsYXBzZWRSYW5nZShkb2MsIHRvLmxpbmUsIGZyb20sIHRvLCBtYXJrZXIpKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJJbnNlcnRpbmcgY29sbGFwc2VkIG1hcmtlciBwYXJ0aWFsbHkgb3ZlcmxhcHBpbmcgYW4gZXhpc3Rpbmcgb25lXCIpO1xuICAgICAgc2F3Q29sbGFwc2VkU3BhbnMgPSB0cnVlO1xuICAgIH1cblxuICAgIGlmIChtYXJrZXIuYWRkVG9IaXN0b3J5KVxuICAgICAgYWRkQ2hhbmdlVG9IaXN0b3J5KGRvYywge2Zyb206IGZyb20sIHRvOiB0bywgb3JpZ2luOiBcIm1hcmtUZXh0XCJ9LCBkb2Muc2VsLCBOYU4pO1xuXG4gICAgdmFyIGN1ckxpbmUgPSBmcm9tLmxpbmUsIGNtID0gZG9jLmNtLCB1cGRhdGVNYXhMaW5lO1xuICAgIGRvYy5pdGVyKGN1ckxpbmUsIHRvLmxpbmUgKyAxLCBmdW5jdGlvbihsaW5lKSB7XG4gICAgICBpZiAoY20gJiYgbWFya2VyLmNvbGxhcHNlZCAmJiAhY20ub3B0aW9ucy5saW5lV3JhcHBpbmcgJiYgdmlzdWFsTGluZShsaW5lKSA9PSBjbS5kaXNwbGF5Lm1heExpbmUpXG4gICAgICAgIHVwZGF0ZU1heExpbmUgPSB0cnVlO1xuICAgICAgaWYgKG1hcmtlci5jb2xsYXBzZWQgJiYgY3VyTGluZSAhPSBmcm9tLmxpbmUpIHVwZGF0ZUxpbmVIZWlnaHQobGluZSwgMCk7XG4gICAgICBhZGRNYXJrZWRTcGFuKGxpbmUsIG5ldyBNYXJrZWRTcGFuKG1hcmtlcixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY3VyTGluZSA9PSBmcm9tLmxpbmUgPyBmcm9tLmNoIDogbnVsbCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY3VyTGluZSA9PSB0by5saW5lID8gdG8uY2ggOiBudWxsKSk7XG4gICAgICArK2N1ckxpbmU7XG4gICAgfSk7XG4gICAgLy8gbGluZUlzSGlkZGVuIGRlcGVuZHMgb24gdGhlIHByZXNlbmNlIG9mIHRoZSBzcGFucywgc28gbmVlZHMgYSBzZWNvbmQgcGFzc1xuICAgIGlmIChtYXJrZXIuY29sbGFwc2VkKSBkb2MuaXRlcihmcm9tLmxpbmUsIHRvLmxpbmUgKyAxLCBmdW5jdGlvbihsaW5lKSB7XG4gICAgICBpZiAobGluZUlzSGlkZGVuKGRvYywgbGluZSkpIHVwZGF0ZUxpbmVIZWlnaHQobGluZSwgMCk7XG4gICAgfSk7XG5cbiAgICBpZiAobWFya2VyLmNsZWFyT25FbnRlcikgb24obWFya2VyLCBcImJlZm9yZUN1cnNvckVudGVyXCIsIGZ1bmN0aW9uKCkgeyBtYXJrZXIuY2xlYXIoKTsgfSk7XG5cbiAgICBpZiAobWFya2VyLnJlYWRPbmx5KSB7XG4gICAgICBzYXdSZWFkT25seVNwYW5zID0gdHJ1ZTtcbiAgICAgIGlmIChkb2MuaGlzdG9yeS5kb25lLmxlbmd0aCB8fCBkb2MuaGlzdG9yeS51bmRvbmUubGVuZ3RoKVxuICAgICAgICBkb2MuY2xlYXJIaXN0b3J5KCk7XG4gICAgfVxuICAgIGlmIChtYXJrZXIuY29sbGFwc2VkKSB7XG4gICAgICBtYXJrZXIuaWQgPSArK25leHRNYXJrZXJJZDtcbiAgICAgIG1hcmtlci5hdG9taWMgPSB0cnVlO1xuICAgIH1cbiAgICBpZiAoY20pIHtcbiAgICAgIC8vIFN5bmMgZWRpdG9yIHN0YXRlXG4gICAgICBpZiAodXBkYXRlTWF4TGluZSkgY20uY3VyT3AudXBkYXRlTWF4TGluZSA9IHRydWU7XG4gICAgICBpZiAobWFya2VyLmNvbGxhcHNlZClcbiAgICAgICAgcmVnQ2hhbmdlKGNtLCBmcm9tLmxpbmUsIHRvLmxpbmUgKyAxKTtcbiAgICAgIGVsc2UgaWYgKG1hcmtlci5jbGFzc05hbWUgfHwgbWFya2VyLnRpdGxlIHx8IG1hcmtlci5zdGFydFN0eWxlIHx8IG1hcmtlci5lbmRTdHlsZSB8fCBtYXJrZXIuY3NzKVxuICAgICAgICBmb3IgKHZhciBpID0gZnJvbS5saW5lOyBpIDw9IHRvLmxpbmU7IGkrKykgcmVnTGluZUNoYW5nZShjbSwgaSwgXCJ0ZXh0XCIpO1xuICAgICAgaWYgKG1hcmtlci5hdG9taWMpIHJlQ2hlY2tTZWxlY3Rpb24oY20uZG9jKTtcbiAgICAgIHNpZ25hbExhdGVyKGNtLCBcIm1hcmtlckFkZGVkXCIsIGNtLCBtYXJrZXIpO1xuICAgIH1cbiAgICByZXR1cm4gbWFya2VyO1xuICB9XG5cbiAgLy8gU0hBUkVEIFRFWFRNQVJLRVJTXG5cbiAgLy8gQSBzaGFyZWQgbWFya2VyIHNwYW5zIG11bHRpcGxlIGxpbmtlZCBkb2N1bWVudHMuIEl0IGlzXG4gIC8vIGltcGxlbWVudGVkIGFzIGEgbWV0YS1tYXJrZXItb2JqZWN0IGNvbnRyb2xsaW5nIG11bHRpcGxlIG5vcm1hbFxuICAvLyBtYXJrZXJzLlxuICB2YXIgU2hhcmVkVGV4dE1hcmtlciA9IENvZGVNaXJyb3IuU2hhcmVkVGV4dE1hcmtlciA9IGZ1bmN0aW9uKG1hcmtlcnMsIHByaW1hcnkpIHtcbiAgICB0aGlzLm1hcmtlcnMgPSBtYXJrZXJzO1xuICAgIHRoaXMucHJpbWFyeSA9IHByaW1hcnk7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBtYXJrZXJzLmxlbmd0aDsgKytpKVxuICAgICAgbWFya2Vyc1tpXS5wYXJlbnQgPSB0aGlzO1xuICB9O1xuICBldmVudE1peGluKFNoYXJlZFRleHRNYXJrZXIpO1xuXG4gIFNoYXJlZFRleHRNYXJrZXIucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMuZXhwbGljaXRseUNsZWFyZWQpIHJldHVybjtcbiAgICB0aGlzLmV4cGxpY2l0bHlDbGVhcmVkID0gdHJ1ZTtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMubWFya2Vycy5sZW5ndGg7ICsraSlcbiAgICAgIHRoaXMubWFya2Vyc1tpXS5jbGVhcigpO1xuICAgIHNpZ25hbExhdGVyKHRoaXMsIFwiY2xlYXJcIik7XG4gIH07XG4gIFNoYXJlZFRleHRNYXJrZXIucHJvdG90eXBlLmZpbmQgPSBmdW5jdGlvbihzaWRlLCBsaW5lT2JqKSB7XG4gICAgcmV0dXJuIHRoaXMucHJpbWFyeS5maW5kKHNpZGUsIGxpbmVPYmopO1xuICB9O1xuXG4gIGZ1bmN0aW9uIG1hcmtUZXh0U2hhcmVkKGRvYywgZnJvbSwgdG8sIG9wdGlvbnMsIHR5cGUpIHtcbiAgICBvcHRpb25zID0gY29weU9iaihvcHRpb25zKTtcbiAgICBvcHRpb25zLnNoYXJlZCA9IGZhbHNlO1xuICAgIHZhciBtYXJrZXJzID0gW21hcmtUZXh0KGRvYywgZnJvbSwgdG8sIG9wdGlvbnMsIHR5cGUpXSwgcHJpbWFyeSA9IG1hcmtlcnNbMF07XG4gICAgdmFyIHdpZGdldCA9IG9wdGlvbnMud2lkZ2V0Tm9kZTtcbiAgICBsaW5rZWREb2NzKGRvYywgZnVuY3Rpb24oZG9jKSB7XG4gICAgICBpZiAod2lkZ2V0KSBvcHRpb25zLndpZGdldE5vZGUgPSB3aWRnZXQuY2xvbmVOb2RlKHRydWUpO1xuICAgICAgbWFya2Vycy5wdXNoKG1hcmtUZXh0KGRvYywgY2xpcFBvcyhkb2MsIGZyb20pLCBjbGlwUG9zKGRvYywgdG8pLCBvcHRpb25zLCB0eXBlKSk7XG4gICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGRvYy5saW5rZWQubGVuZ3RoOyArK2kpXG4gICAgICAgIGlmIChkb2MubGlua2VkW2ldLmlzUGFyZW50KSByZXR1cm47XG4gICAgICBwcmltYXJ5ID0gbHN0KG1hcmtlcnMpO1xuICAgIH0pO1xuICAgIHJldHVybiBuZXcgU2hhcmVkVGV4dE1hcmtlcihtYXJrZXJzLCBwcmltYXJ5KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGZpbmRTaGFyZWRNYXJrZXJzKGRvYykge1xuICAgIHJldHVybiBkb2MuZmluZE1hcmtzKFBvcyhkb2MuZmlyc3QsIDApLCBkb2MuY2xpcFBvcyhQb3MoZG9jLmxhc3RMaW5lKCkpKSxcbiAgICAgICAgICAgICAgICAgICAgICAgICBmdW5jdGlvbihtKSB7IHJldHVybiBtLnBhcmVudDsgfSk7XG4gIH1cblxuICBmdW5jdGlvbiBjb3B5U2hhcmVkTWFya2Vycyhkb2MsIG1hcmtlcnMpIHtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IG1hcmtlcnMubGVuZ3RoOyBpKyspIHtcbiAgICAgIHZhciBtYXJrZXIgPSBtYXJrZXJzW2ldLCBwb3MgPSBtYXJrZXIuZmluZCgpO1xuICAgICAgdmFyIG1Gcm9tID0gZG9jLmNsaXBQb3MocG9zLmZyb20pLCBtVG8gPSBkb2MuY2xpcFBvcyhwb3MudG8pO1xuICAgICAgaWYgKGNtcChtRnJvbSwgbVRvKSkge1xuICAgICAgICB2YXIgc3ViTWFyayA9IG1hcmtUZXh0KGRvYywgbUZyb20sIG1UbywgbWFya2VyLnByaW1hcnksIG1hcmtlci5wcmltYXJ5LnR5cGUpO1xuICAgICAgICBtYXJrZXIubWFya2Vycy5wdXNoKHN1Yk1hcmspO1xuICAgICAgICBzdWJNYXJrLnBhcmVudCA9IG1hcmtlcjtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBkZXRhY2hTaGFyZWRNYXJrZXJzKG1hcmtlcnMpIHtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IG1hcmtlcnMubGVuZ3RoOyBpKyspIHtcbiAgICAgIHZhciBtYXJrZXIgPSBtYXJrZXJzW2ldLCBsaW5rZWQgPSBbbWFya2VyLnByaW1hcnkuZG9jXTs7XG4gICAgICBsaW5rZWREb2NzKG1hcmtlci5wcmltYXJ5LmRvYywgZnVuY3Rpb24oZCkgeyBsaW5rZWQucHVzaChkKTsgfSk7XG4gICAgICBmb3IgKHZhciBqID0gMDsgaiA8IG1hcmtlci5tYXJrZXJzLmxlbmd0aDsgaisrKSB7XG4gICAgICAgIHZhciBzdWJNYXJrZXIgPSBtYXJrZXIubWFya2Vyc1tqXTtcbiAgICAgICAgaWYgKGluZGV4T2YobGlua2VkLCBzdWJNYXJrZXIuZG9jKSA9PSAtMSkge1xuICAgICAgICAgIHN1Yk1hcmtlci5wYXJlbnQgPSBudWxsO1xuICAgICAgICAgIG1hcmtlci5tYXJrZXJzLnNwbGljZShqLS0sIDEpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gVEVYVE1BUktFUiBTUEFOU1xuXG4gIGZ1bmN0aW9uIE1hcmtlZFNwYW4obWFya2VyLCBmcm9tLCB0bykge1xuICAgIHRoaXMubWFya2VyID0gbWFya2VyO1xuICAgIHRoaXMuZnJvbSA9IGZyb207IHRoaXMudG8gPSB0bztcbiAgfVxuXG4gIC8vIFNlYXJjaCBhbiBhcnJheSBvZiBzcGFucyBmb3IgYSBzcGFuIG1hdGNoaW5nIHRoZSBnaXZlbiBtYXJrZXIuXG4gIGZ1bmN0aW9uIGdldE1hcmtlZFNwYW5Gb3Ioc3BhbnMsIG1hcmtlcikge1xuICAgIGlmIChzcGFucykgZm9yICh2YXIgaSA9IDA7IGkgPCBzcGFucy5sZW5ndGg7ICsraSkge1xuICAgICAgdmFyIHNwYW4gPSBzcGFuc1tpXTtcbiAgICAgIGlmIChzcGFuLm1hcmtlciA9PSBtYXJrZXIpIHJldHVybiBzcGFuO1xuICAgIH1cbiAgfVxuICAvLyBSZW1vdmUgYSBzcGFuIGZyb20gYW4gYXJyYXksIHJldHVybmluZyB1bmRlZmluZWQgaWYgbm8gc3BhbnMgYXJlXG4gIC8vIGxlZnQgKHdlIGRvbid0IHN0b3JlIGFycmF5cyBmb3IgbGluZXMgd2l0aG91dCBzcGFucykuXG4gIGZ1bmN0aW9uIHJlbW92ZU1hcmtlZFNwYW4oc3BhbnMsIHNwYW4pIHtcbiAgICBmb3IgKHZhciByLCBpID0gMDsgaSA8IHNwYW5zLmxlbmd0aDsgKytpKVxuICAgICAgaWYgKHNwYW5zW2ldICE9IHNwYW4pIChyIHx8IChyID0gW10pKS5wdXNoKHNwYW5zW2ldKTtcbiAgICByZXR1cm4gcjtcbiAgfVxuICAvLyBBZGQgYSBzcGFuIHRvIGEgbGluZS5cbiAgZnVuY3Rpb24gYWRkTWFya2VkU3BhbihsaW5lLCBzcGFuKSB7XG4gICAgbGluZS5tYXJrZWRTcGFucyA9IGxpbmUubWFya2VkU3BhbnMgPyBsaW5lLm1hcmtlZFNwYW5zLmNvbmNhdChbc3Bhbl0pIDogW3NwYW5dO1xuICAgIHNwYW4ubWFya2VyLmF0dGFjaExpbmUobGluZSk7XG4gIH1cblxuICAvLyBVc2VkIGZvciB0aGUgYWxnb3JpdGhtIHRoYXQgYWRqdXN0cyBtYXJrZXJzIGZvciBhIGNoYW5nZSBpbiB0aGVcbiAgLy8gZG9jdW1lbnQuIFRoZXNlIGZ1bmN0aW9ucyBjdXQgYW4gYXJyYXkgb2Ygc3BhbnMgYXQgYSBnaXZlblxuICAvLyBjaGFyYWN0ZXIgcG9zaXRpb24sIHJldHVybmluZyBhbiBhcnJheSBvZiByZW1haW5pbmcgY2h1bmtzIChvclxuICAvLyB1bmRlZmluZWQgaWYgbm90aGluZyByZW1haW5zKS5cbiAgZnVuY3Rpb24gbWFya2VkU3BhbnNCZWZvcmUob2xkLCBzdGFydENoLCBpc0luc2VydCkge1xuICAgIGlmIChvbGQpIGZvciAodmFyIGkgPSAwLCBudzsgaSA8IG9sZC5sZW5ndGg7ICsraSkge1xuICAgICAgdmFyIHNwYW4gPSBvbGRbaV0sIG1hcmtlciA9IHNwYW4ubWFya2VyO1xuICAgICAgdmFyIHN0YXJ0c0JlZm9yZSA9IHNwYW4uZnJvbSA9PSBudWxsIHx8IChtYXJrZXIuaW5jbHVzaXZlTGVmdCA/IHNwYW4uZnJvbSA8PSBzdGFydENoIDogc3Bhbi5mcm9tIDwgc3RhcnRDaCk7XG4gICAgICBpZiAoc3RhcnRzQmVmb3JlIHx8IHNwYW4uZnJvbSA9PSBzdGFydENoICYmIG1hcmtlci50eXBlID09IFwiYm9va21hcmtcIiAmJiAoIWlzSW5zZXJ0IHx8ICFzcGFuLm1hcmtlci5pbnNlcnRMZWZ0KSkge1xuICAgICAgICB2YXIgZW5kc0FmdGVyID0gc3Bhbi50byA9PSBudWxsIHx8IChtYXJrZXIuaW5jbHVzaXZlUmlnaHQgPyBzcGFuLnRvID49IHN0YXJ0Q2ggOiBzcGFuLnRvID4gc3RhcnRDaCk7XG4gICAgICAgIChudyB8fCAobncgPSBbXSkpLnB1c2gobmV3IE1hcmtlZFNwYW4obWFya2VyLCBzcGFuLmZyb20sIGVuZHNBZnRlciA/IG51bGwgOiBzcGFuLnRvKSk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBudztcbiAgfVxuICBmdW5jdGlvbiBtYXJrZWRTcGFuc0FmdGVyKG9sZCwgZW5kQ2gsIGlzSW5zZXJ0KSB7XG4gICAgaWYgKG9sZCkgZm9yICh2YXIgaSA9IDAsIG53OyBpIDwgb2xkLmxlbmd0aDsgKytpKSB7XG4gICAgICB2YXIgc3BhbiA9IG9sZFtpXSwgbWFya2VyID0gc3Bhbi5tYXJrZXI7XG4gICAgICB2YXIgZW5kc0FmdGVyID0gc3Bhbi50byA9PSBudWxsIHx8IChtYXJrZXIuaW5jbHVzaXZlUmlnaHQgPyBzcGFuLnRvID49IGVuZENoIDogc3Bhbi50byA+IGVuZENoKTtcbiAgICAgIGlmIChlbmRzQWZ0ZXIgfHwgc3Bhbi5mcm9tID09IGVuZENoICYmIG1hcmtlci50eXBlID09IFwiYm9va21hcmtcIiAmJiAoIWlzSW5zZXJ0IHx8IHNwYW4ubWFya2VyLmluc2VydExlZnQpKSB7XG4gICAgICAgIHZhciBzdGFydHNCZWZvcmUgPSBzcGFuLmZyb20gPT0gbnVsbCB8fCAobWFya2VyLmluY2x1c2l2ZUxlZnQgPyBzcGFuLmZyb20gPD0gZW5kQ2ggOiBzcGFuLmZyb20gPCBlbmRDaCk7XG4gICAgICAgIChudyB8fCAobncgPSBbXSkpLnB1c2gobmV3IE1hcmtlZFNwYW4obWFya2VyLCBzdGFydHNCZWZvcmUgPyBudWxsIDogc3Bhbi5mcm9tIC0gZW5kQ2gsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc3Bhbi50byA9PSBudWxsID8gbnVsbCA6IHNwYW4udG8gLSBlbmRDaCkpO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gbnc7XG4gIH1cblxuICAvLyBHaXZlbiBhIGNoYW5nZSBvYmplY3QsIGNvbXB1dGUgdGhlIG5ldyBzZXQgb2YgbWFya2VyIHNwYW5zIHRoYXRcbiAgLy8gY292ZXIgdGhlIGxpbmUgaW4gd2hpY2ggdGhlIGNoYW5nZSB0b29rIHBsYWNlLiBSZW1vdmVzIHNwYW5zXG4gIC8vIGVudGlyZWx5IHdpdGhpbiB0aGUgY2hhbmdlLCByZWNvbm5lY3RzIHNwYW5zIGJlbG9uZ2luZyB0byB0aGVcbiAgLy8gc2FtZSBtYXJrZXIgdGhhdCBhcHBlYXIgb24gYm90aCBzaWRlcyBvZiB0aGUgY2hhbmdlLCBhbmQgY3V0cyBvZmZcbiAgLy8gc3BhbnMgcGFydGlhbGx5IHdpdGhpbiB0aGUgY2hhbmdlLiBSZXR1cm5zIGFuIGFycmF5IG9mIHNwYW5cbiAgLy8gYXJyYXlzIHdpdGggb25lIGVsZW1lbnQgZm9yIGVhY2ggbGluZSBpbiAoYWZ0ZXIpIHRoZSBjaGFuZ2UuXG4gIGZ1bmN0aW9uIHN0cmV0Y2hTcGFuc092ZXJDaGFuZ2UoZG9jLCBjaGFuZ2UpIHtcbiAgICBpZiAoY2hhbmdlLmZ1bGwpIHJldHVybiBudWxsO1xuICAgIHZhciBvbGRGaXJzdCA9IGlzTGluZShkb2MsIGNoYW5nZS5mcm9tLmxpbmUpICYmIGdldExpbmUoZG9jLCBjaGFuZ2UuZnJvbS5saW5lKS5tYXJrZWRTcGFucztcbiAgICB2YXIgb2xkTGFzdCA9IGlzTGluZShkb2MsIGNoYW5nZS50by5saW5lKSAmJiBnZXRMaW5lKGRvYywgY2hhbmdlLnRvLmxpbmUpLm1hcmtlZFNwYW5zO1xuICAgIGlmICghb2xkRmlyc3QgJiYgIW9sZExhc3QpIHJldHVybiBudWxsO1xuXG4gICAgdmFyIHN0YXJ0Q2ggPSBjaGFuZ2UuZnJvbS5jaCwgZW5kQ2ggPSBjaGFuZ2UudG8uY2gsIGlzSW5zZXJ0ID0gY21wKGNoYW5nZS5mcm9tLCBjaGFuZ2UudG8pID09IDA7XG4gICAgLy8gR2V0IHRoZSBzcGFucyB0aGF0ICdzdGljayBvdXQnIG9uIGJvdGggc2lkZXNcbiAgICB2YXIgZmlyc3QgPSBtYXJrZWRTcGFuc0JlZm9yZShvbGRGaXJzdCwgc3RhcnRDaCwgaXNJbnNlcnQpO1xuICAgIHZhciBsYXN0ID0gbWFya2VkU3BhbnNBZnRlcihvbGRMYXN0LCBlbmRDaCwgaXNJbnNlcnQpO1xuXG4gICAgLy8gTmV4dCwgbWVyZ2UgdGhvc2UgdHdvIGVuZHNcbiAgICB2YXIgc2FtZUxpbmUgPSBjaGFuZ2UudGV4dC5sZW5ndGggPT0gMSwgb2Zmc2V0ID0gbHN0KGNoYW5nZS50ZXh0KS5sZW5ndGggKyAoc2FtZUxpbmUgPyBzdGFydENoIDogMCk7XG4gICAgaWYgKGZpcnN0KSB7XG4gICAgICAvLyBGaXggdXAgLnRvIHByb3BlcnRpZXMgb2YgZmlyc3RcbiAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgZmlyc3QubGVuZ3RoOyArK2kpIHtcbiAgICAgICAgdmFyIHNwYW4gPSBmaXJzdFtpXTtcbiAgICAgICAgaWYgKHNwYW4udG8gPT0gbnVsbCkge1xuICAgICAgICAgIHZhciBmb3VuZCA9IGdldE1hcmtlZFNwYW5Gb3IobGFzdCwgc3Bhbi5tYXJrZXIpO1xuICAgICAgICAgIGlmICghZm91bmQpIHNwYW4udG8gPSBzdGFydENoO1xuICAgICAgICAgIGVsc2UgaWYgKHNhbWVMaW5lKSBzcGFuLnRvID0gZm91bmQudG8gPT0gbnVsbCA/IG51bGwgOiBmb3VuZC50byArIG9mZnNldDtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICBpZiAobGFzdCkge1xuICAgICAgLy8gRml4IHVwIC5mcm9tIGluIGxhc3QgKG9yIG1vdmUgdGhlbSBpbnRvIGZpcnN0IGluIGNhc2Ugb2Ygc2FtZUxpbmUpXG4gICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxhc3QubGVuZ3RoOyArK2kpIHtcbiAgICAgICAgdmFyIHNwYW4gPSBsYXN0W2ldO1xuICAgICAgICBpZiAoc3Bhbi50byAhPSBudWxsKSBzcGFuLnRvICs9IG9mZnNldDtcbiAgICAgICAgaWYgKHNwYW4uZnJvbSA9PSBudWxsKSB7XG4gICAgICAgICAgdmFyIGZvdW5kID0gZ2V0TWFya2VkU3BhbkZvcihmaXJzdCwgc3Bhbi5tYXJrZXIpO1xuICAgICAgICAgIGlmICghZm91bmQpIHtcbiAgICAgICAgICAgIHNwYW4uZnJvbSA9IG9mZnNldDtcbiAgICAgICAgICAgIGlmIChzYW1lTGluZSkgKGZpcnN0IHx8IChmaXJzdCA9IFtdKSkucHVzaChzcGFuKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgc3Bhbi5mcm9tICs9IG9mZnNldDtcbiAgICAgICAgICBpZiAoc2FtZUxpbmUpIChmaXJzdCB8fCAoZmlyc3QgPSBbXSkpLnB1c2goc3Bhbik7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgLy8gTWFrZSBzdXJlIHdlIGRpZG4ndCBjcmVhdGUgYW55IHplcm8tbGVuZ3RoIHNwYW5zXG4gICAgaWYgKGZpcnN0KSBmaXJzdCA9IGNsZWFyRW1wdHlTcGFucyhmaXJzdCk7XG4gICAgaWYgKGxhc3QgJiYgbGFzdCAhPSBmaXJzdCkgbGFzdCA9IGNsZWFyRW1wdHlTcGFucyhsYXN0KTtcblxuICAgIHZhciBuZXdNYXJrZXJzID0gW2ZpcnN0XTtcbiAgICBpZiAoIXNhbWVMaW5lKSB7XG4gICAgICAvLyBGaWxsIGdhcCB3aXRoIHdob2xlLWxpbmUtc3BhbnNcbiAgICAgIHZhciBnYXAgPSBjaGFuZ2UudGV4dC5sZW5ndGggLSAyLCBnYXBNYXJrZXJzO1xuICAgICAgaWYgKGdhcCA+IDAgJiYgZmlyc3QpXG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgZmlyc3QubGVuZ3RoOyArK2kpXG4gICAgICAgICAgaWYgKGZpcnN0W2ldLnRvID09IG51bGwpXG4gICAgICAgICAgICAoZ2FwTWFya2VycyB8fCAoZ2FwTWFya2VycyA9IFtdKSkucHVzaChuZXcgTWFya2VkU3BhbihmaXJzdFtpXS5tYXJrZXIsIG51bGwsIG51bGwpKTtcbiAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgZ2FwOyArK2kpXG4gICAgICAgIG5ld01hcmtlcnMucHVzaChnYXBNYXJrZXJzKTtcbiAgICAgIG5ld01hcmtlcnMucHVzaChsYXN0KTtcbiAgICB9XG4gICAgcmV0dXJuIG5ld01hcmtlcnM7XG4gIH1cblxuICAvLyBSZW1vdmUgc3BhbnMgdGhhdCBhcmUgZW1wdHkgYW5kIGRvbid0IGhhdmUgYSBjbGVhcldoZW5FbXB0eVxuICAvLyBvcHRpb24gb2YgZmFsc2UuXG4gIGZ1bmN0aW9uIGNsZWFyRW1wdHlTcGFucyhzcGFucykge1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc3BhbnMubGVuZ3RoOyArK2kpIHtcbiAgICAgIHZhciBzcGFuID0gc3BhbnNbaV07XG4gICAgICBpZiAoc3Bhbi5mcm9tICE9IG51bGwgJiYgc3Bhbi5mcm9tID09IHNwYW4udG8gJiYgc3Bhbi5tYXJrZXIuY2xlYXJXaGVuRW1wdHkgIT09IGZhbHNlKVxuICAgICAgICBzcGFucy5zcGxpY2UoaS0tLCAxKTtcbiAgICB9XG4gICAgaWYgKCFzcGFucy5sZW5ndGgpIHJldHVybiBudWxsO1xuICAgIHJldHVybiBzcGFucztcbiAgfVxuXG4gIC8vIFVzZWQgZm9yIHVuL3JlLWRvaW5nIGNoYW5nZXMgZnJvbSB0aGUgaGlzdG9yeS4gQ29tYmluZXMgdGhlXG4gIC8vIHJlc3VsdCBvZiBjb21wdXRpbmcgdGhlIGV4aXN0aW5nIHNwYW5zIHdpdGggdGhlIHNldCBvZiBzcGFucyB0aGF0XG4gIC8vIGV4aXN0ZWQgaW4gdGhlIGhpc3RvcnkgKHNvIHRoYXQgZGVsZXRpbmcgYXJvdW5kIGEgc3BhbiBhbmQgdGhlblxuICAvLyB1bmRvaW5nIGJyaW5ncyBiYWNrIHRoZSBzcGFuKS5cbiAgZnVuY3Rpb24gbWVyZ2VPbGRTcGFucyhkb2MsIGNoYW5nZSkge1xuICAgIHZhciBvbGQgPSBnZXRPbGRTcGFucyhkb2MsIGNoYW5nZSk7XG4gICAgdmFyIHN0cmV0Y2hlZCA9IHN0cmV0Y2hTcGFuc092ZXJDaGFuZ2UoZG9jLCBjaGFuZ2UpO1xuICAgIGlmICghb2xkKSByZXR1cm4gc3RyZXRjaGVkO1xuICAgIGlmICghc3RyZXRjaGVkKSByZXR1cm4gb2xkO1xuXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBvbGQubGVuZ3RoOyArK2kpIHtcbiAgICAgIHZhciBvbGRDdXIgPSBvbGRbaV0sIHN0cmV0Y2hDdXIgPSBzdHJldGNoZWRbaV07XG4gICAgICBpZiAob2xkQ3VyICYmIHN0cmV0Y2hDdXIpIHtcbiAgICAgICAgc3BhbnM6IGZvciAodmFyIGogPSAwOyBqIDwgc3RyZXRjaEN1ci5sZW5ndGg7ICsraikge1xuICAgICAgICAgIHZhciBzcGFuID0gc3RyZXRjaEN1cltqXTtcbiAgICAgICAgICBmb3IgKHZhciBrID0gMDsgayA8IG9sZEN1ci5sZW5ndGg7ICsraylcbiAgICAgICAgICAgIGlmIChvbGRDdXJba10ubWFya2VyID09IHNwYW4ubWFya2VyKSBjb250aW51ZSBzcGFucztcbiAgICAgICAgICBvbGRDdXIucHVzaChzcGFuKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmIChzdHJldGNoQ3VyKSB7XG4gICAgICAgIG9sZFtpXSA9IHN0cmV0Y2hDdXI7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBvbGQ7XG4gIH1cblxuICAvLyBVc2VkIHRvICdjbGlwJyBvdXQgcmVhZE9ubHkgcmFuZ2VzIHdoZW4gbWFraW5nIGEgY2hhbmdlLlxuICBmdW5jdGlvbiByZW1vdmVSZWFkT25seVJhbmdlcyhkb2MsIGZyb20sIHRvKSB7XG4gICAgdmFyIG1hcmtlcnMgPSBudWxsO1xuICAgIGRvYy5pdGVyKGZyb20ubGluZSwgdG8ubGluZSArIDEsIGZ1bmN0aW9uKGxpbmUpIHtcbiAgICAgIGlmIChsaW5lLm1hcmtlZFNwYW5zKSBmb3IgKHZhciBpID0gMDsgaSA8IGxpbmUubWFya2VkU3BhbnMubGVuZ3RoOyArK2kpIHtcbiAgICAgICAgdmFyIG1hcmsgPSBsaW5lLm1hcmtlZFNwYW5zW2ldLm1hcmtlcjtcbiAgICAgICAgaWYgKG1hcmsucmVhZE9ubHkgJiYgKCFtYXJrZXJzIHx8IGluZGV4T2YobWFya2VycywgbWFyaykgPT0gLTEpKVxuICAgICAgICAgIChtYXJrZXJzIHx8IChtYXJrZXJzID0gW10pKS5wdXNoKG1hcmspO1xuICAgICAgfVxuICAgIH0pO1xuICAgIGlmICghbWFya2VycykgcmV0dXJuIG51bGw7XG4gICAgdmFyIHBhcnRzID0gW3tmcm9tOiBmcm9tLCB0bzogdG99XTtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IG1hcmtlcnMubGVuZ3RoOyArK2kpIHtcbiAgICAgIHZhciBtayA9IG1hcmtlcnNbaV0sIG0gPSBtay5maW5kKDApO1xuICAgICAgZm9yICh2YXIgaiA9IDA7IGogPCBwYXJ0cy5sZW5ndGg7ICsraikge1xuICAgICAgICB2YXIgcCA9IHBhcnRzW2pdO1xuICAgICAgICBpZiAoY21wKHAudG8sIG0uZnJvbSkgPCAwIHx8IGNtcChwLmZyb20sIG0udG8pID4gMCkgY29udGludWU7XG4gICAgICAgIHZhciBuZXdQYXJ0cyA9IFtqLCAxXSwgZGZyb20gPSBjbXAocC5mcm9tLCBtLmZyb20pLCBkdG8gPSBjbXAocC50bywgbS50byk7XG4gICAgICAgIGlmIChkZnJvbSA8IDAgfHwgIW1rLmluY2x1c2l2ZUxlZnQgJiYgIWRmcm9tKVxuICAgICAgICAgIG5ld1BhcnRzLnB1c2goe2Zyb206IHAuZnJvbSwgdG86IG0uZnJvbX0pO1xuICAgICAgICBpZiAoZHRvID4gMCB8fCAhbWsuaW5jbHVzaXZlUmlnaHQgJiYgIWR0bylcbiAgICAgICAgICBuZXdQYXJ0cy5wdXNoKHtmcm9tOiBtLnRvLCB0bzogcC50b30pO1xuICAgICAgICBwYXJ0cy5zcGxpY2UuYXBwbHkocGFydHMsIG5ld1BhcnRzKTtcbiAgICAgICAgaiArPSBuZXdQYXJ0cy5sZW5ndGggLSAxO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcGFydHM7XG4gIH1cblxuICAvLyBDb25uZWN0IG9yIGRpc2Nvbm5lY3Qgc3BhbnMgZnJvbSBhIGxpbmUuXG4gIGZ1bmN0aW9uIGRldGFjaE1hcmtlZFNwYW5zKGxpbmUpIHtcbiAgICB2YXIgc3BhbnMgPSBsaW5lLm1hcmtlZFNwYW5zO1xuICAgIGlmICghc3BhbnMpIHJldHVybjtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHNwYW5zLmxlbmd0aDsgKytpKVxuICAgICAgc3BhbnNbaV0ubWFya2VyLmRldGFjaExpbmUobGluZSk7XG4gICAgbGluZS5tYXJrZWRTcGFucyA9IG51bGw7XG4gIH1cbiAgZnVuY3Rpb24gYXR0YWNoTWFya2VkU3BhbnMobGluZSwgc3BhbnMpIHtcbiAgICBpZiAoIXNwYW5zKSByZXR1cm47XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzcGFucy5sZW5ndGg7ICsraSlcbiAgICAgIHNwYW5zW2ldLm1hcmtlci5hdHRhY2hMaW5lKGxpbmUpO1xuICAgIGxpbmUubWFya2VkU3BhbnMgPSBzcGFucztcbiAgfVxuXG4gIC8vIEhlbHBlcnMgdXNlZCB3aGVuIGNvbXB1dGluZyB3aGljaCBvdmVybGFwcGluZyBjb2xsYXBzZWQgc3BhblxuICAvLyBjb3VudHMgYXMgdGhlIGxhcmdlciBvbmUuXG4gIGZ1bmN0aW9uIGV4dHJhTGVmdChtYXJrZXIpIHsgcmV0dXJuIG1hcmtlci5pbmNsdXNpdmVMZWZ0ID8gLTEgOiAwOyB9XG4gIGZ1bmN0aW9uIGV4dHJhUmlnaHQobWFya2VyKSB7IHJldHVybiBtYXJrZXIuaW5jbHVzaXZlUmlnaHQgPyAxIDogMDsgfVxuXG4gIC8vIFJldHVybnMgYSBudW1iZXIgaW5kaWNhdGluZyB3aGljaCBvZiB0d28gb3ZlcmxhcHBpbmcgY29sbGFwc2VkXG4gIC8vIHNwYW5zIGlzIGxhcmdlciAoYW5kIHRodXMgaW5jbHVkZXMgdGhlIG90aGVyKS4gRmFsbHMgYmFjayB0b1xuICAvLyBjb21wYXJpbmcgaWRzIHdoZW4gdGhlIHNwYW5zIGNvdmVyIGV4YWN0bHkgdGhlIHNhbWUgcmFuZ2UuXG4gIGZ1bmN0aW9uIGNvbXBhcmVDb2xsYXBzZWRNYXJrZXJzKGEsIGIpIHtcbiAgICB2YXIgbGVuRGlmZiA9IGEubGluZXMubGVuZ3RoIC0gYi5saW5lcy5sZW5ndGg7XG4gICAgaWYgKGxlbkRpZmYgIT0gMCkgcmV0dXJuIGxlbkRpZmY7XG4gICAgdmFyIGFQb3MgPSBhLmZpbmQoKSwgYlBvcyA9IGIuZmluZCgpO1xuICAgIHZhciBmcm9tQ21wID0gY21wKGFQb3MuZnJvbSwgYlBvcy5mcm9tKSB8fCBleHRyYUxlZnQoYSkgLSBleHRyYUxlZnQoYik7XG4gICAgaWYgKGZyb21DbXApIHJldHVybiAtZnJvbUNtcDtcbiAgICB2YXIgdG9DbXAgPSBjbXAoYVBvcy50bywgYlBvcy50bykgfHwgZXh0cmFSaWdodChhKSAtIGV4dHJhUmlnaHQoYik7XG4gICAgaWYgKHRvQ21wKSByZXR1cm4gdG9DbXA7XG4gICAgcmV0dXJuIGIuaWQgLSBhLmlkO1xuICB9XG5cbiAgLy8gRmluZCBvdXQgd2hldGhlciBhIGxpbmUgZW5kcyBvciBzdGFydHMgaW4gYSBjb2xsYXBzZWQgc3Bhbi4gSWZcbiAgLy8gc28sIHJldHVybiB0aGUgbWFya2VyIGZvciB0aGF0IHNwYW4uXG4gIGZ1bmN0aW9uIGNvbGxhcHNlZFNwYW5BdFNpZGUobGluZSwgc3RhcnQpIHtcbiAgICB2YXIgc3BzID0gc2F3Q29sbGFwc2VkU3BhbnMgJiYgbGluZS5tYXJrZWRTcGFucywgZm91bmQ7XG4gICAgaWYgKHNwcykgZm9yICh2YXIgc3AsIGkgPSAwOyBpIDwgc3BzLmxlbmd0aDsgKytpKSB7XG4gICAgICBzcCA9IHNwc1tpXTtcbiAgICAgIGlmIChzcC5tYXJrZXIuY29sbGFwc2VkICYmIChzdGFydCA/IHNwLmZyb20gOiBzcC50bykgPT0gbnVsbCAmJlxuICAgICAgICAgICghZm91bmQgfHwgY29tcGFyZUNvbGxhcHNlZE1hcmtlcnMoZm91bmQsIHNwLm1hcmtlcikgPCAwKSlcbiAgICAgICAgZm91bmQgPSBzcC5tYXJrZXI7XG4gICAgfVxuICAgIHJldHVybiBmb3VuZDtcbiAgfVxuICBmdW5jdGlvbiBjb2xsYXBzZWRTcGFuQXRTdGFydChsaW5lKSB7IHJldHVybiBjb2xsYXBzZWRTcGFuQXRTaWRlKGxpbmUsIHRydWUpOyB9XG4gIGZ1bmN0aW9uIGNvbGxhcHNlZFNwYW5BdEVuZChsaW5lKSB7IHJldHVybiBjb2xsYXBzZWRTcGFuQXRTaWRlKGxpbmUsIGZhbHNlKTsgfVxuXG4gIC8vIFRlc3Qgd2hldGhlciB0aGVyZSBleGlzdHMgYSBjb2xsYXBzZWQgc3BhbiB0aGF0IHBhcnRpYWxseVxuICAvLyBvdmVybGFwcyAoY292ZXJzIHRoZSBzdGFydCBvciBlbmQsIGJ1dCBub3QgYm90aCkgb2YgYSBuZXcgc3Bhbi5cbiAgLy8gU3VjaCBvdmVybGFwIGlzIG5vdCBhbGxvd2VkLlxuICBmdW5jdGlvbiBjb25mbGljdGluZ0NvbGxhcHNlZFJhbmdlKGRvYywgbGluZU5vLCBmcm9tLCB0bywgbWFya2VyKSB7XG4gICAgdmFyIGxpbmUgPSBnZXRMaW5lKGRvYywgbGluZU5vKTtcbiAgICB2YXIgc3BzID0gc2F3Q29sbGFwc2VkU3BhbnMgJiYgbGluZS5tYXJrZWRTcGFucztcbiAgICBpZiAoc3BzKSBmb3IgKHZhciBpID0gMDsgaSA8IHNwcy5sZW5ndGg7ICsraSkge1xuICAgICAgdmFyIHNwID0gc3BzW2ldO1xuICAgICAgaWYgKCFzcC5tYXJrZXIuY29sbGFwc2VkKSBjb250aW51ZTtcbiAgICAgIHZhciBmb3VuZCA9IHNwLm1hcmtlci5maW5kKDApO1xuICAgICAgdmFyIGZyb21DbXAgPSBjbXAoZm91bmQuZnJvbSwgZnJvbSkgfHwgZXh0cmFMZWZ0KHNwLm1hcmtlcikgLSBleHRyYUxlZnQobWFya2VyKTtcbiAgICAgIHZhciB0b0NtcCA9IGNtcChmb3VuZC50bywgdG8pIHx8IGV4dHJhUmlnaHQoc3AubWFya2VyKSAtIGV4dHJhUmlnaHQobWFya2VyKTtcbiAgICAgIGlmIChmcm9tQ21wID49IDAgJiYgdG9DbXAgPD0gMCB8fCBmcm9tQ21wIDw9IDAgJiYgdG9DbXAgPj0gMCkgY29udGludWU7XG4gICAgICBpZiAoZnJvbUNtcCA8PSAwICYmIChjbXAoZm91bmQudG8sIGZyb20pID4gMCB8fCAoc3AubWFya2VyLmluY2x1c2l2ZVJpZ2h0ICYmIG1hcmtlci5pbmNsdXNpdmVMZWZ0KSkgfHxcbiAgICAgICAgICBmcm9tQ21wID49IDAgJiYgKGNtcChmb3VuZC5mcm9tLCB0bykgPCAwIHx8IChzcC5tYXJrZXIuaW5jbHVzaXZlTGVmdCAmJiBtYXJrZXIuaW5jbHVzaXZlUmlnaHQpKSlcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICB9XG5cbiAgLy8gQSB2aXN1YWwgbGluZSBpcyBhIGxpbmUgYXMgZHJhd24gb24gdGhlIHNjcmVlbi4gRm9sZGluZywgZm9yXG4gIC8vIGV4YW1wbGUsIGNhbiBjYXVzZSBtdWx0aXBsZSBsb2dpY2FsIGxpbmVzIHRvIGFwcGVhciBvbiB0aGUgc2FtZVxuICAvLyB2aXN1YWwgbGluZS4gVGhpcyBmaW5kcyB0aGUgc3RhcnQgb2YgdGhlIHZpc3VhbCBsaW5lIHRoYXQgdGhlXG4gIC8vIGdpdmVuIGxpbmUgaXMgcGFydCBvZiAodXN1YWxseSB0aGF0IGlzIHRoZSBsaW5lIGl0c2VsZikuXG4gIGZ1bmN0aW9uIHZpc3VhbExpbmUobGluZSkge1xuICAgIHZhciBtZXJnZWQ7XG4gICAgd2hpbGUgKG1lcmdlZCA9IGNvbGxhcHNlZFNwYW5BdFN0YXJ0KGxpbmUpKVxuICAgICAgbGluZSA9IG1lcmdlZC5maW5kKC0xLCB0cnVlKS5saW5lO1xuICAgIHJldHVybiBsaW5lO1xuICB9XG5cbiAgLy8gUmV0dXJucyBhbiBhcnJheSBvZiBsb2dpY2FsIGxpbmVzIHRoYXQgY29udGludWUgdGhlIHZpc3VhbCBsaW5lXG4gIC8vIHN0YXJ0ZWQgYnkgdGhlIGFyZ3VtZW50LCBvciB1bmRlZmluZWQgaWYgdGhlcmUgYXJlIG5vIHN1Y2ggbGluZXMuXG4gIGZ1bmN0aW9uIHZpc3VhbExpbmVDb250aW51ZWQobGluZSkge1xuICAgIHZhciBtZXJnZWQsIGxpbmVzO1xuICAgIHdoaWxlIChtZXJnZWQgPSBjb2xsYXBzZWRTcGFuQXRFbmQobGluZSkpIHtcbiAgICAgIGxpbmUgPSBtZXJnZWQuZmluZCgxLCB0cnVlKS5saW5lO1xuICAgICAgKGxpbmVzIHx8IChsaW5lcyA9IFtdKSkucHVzaChsaW5lKTtcbiAgICB9XG4gICAgcmV0dXJuIGxpbmVzO1xuICB9XG5cbiAgLy8gR2V0IHRoZSBsaW5lIG51bWJlciBvZiB0aGUgc3RhcnQgb2YgdGhlIHZpc3VhbCBsaW5lIHRoYXQgdGhlXG4gIC8vIGdpdmVuIGxpbmUgbnVtYmVyIGlzIHBhcnQgb2YuXG4gIGZ1bmN0aW9uIHZpc3VhbExpbmVObyhkb2MsIGxpbmVOKSB7XG4gICAgdmFyIGxpbmUgPSBnZXRMaW5lKGRvYywgbGluZU4pLCB2aXMgPSB2aXN1YWxMaW5lKGxpbmUpO1xuICAgIGlmIChsaW5lID09IHZpcykgcmV0dXJuIGxpbmVOO1xuICAgIHJldHVybiBsaW5lTm8odmlzKTtcbiAgfVxuICAvLyBHZXQgdGhlIGxpbmUgbnVtYmVyIG9mIHRoZSBzdGFydCBvZiB0aGUgbmV4dCB2aXN1YWwgbGluZSBhZnRlclxuICAvLyB0aGUgZ2l2ZW4gbGluZS5cbiAgZnVuY3Rpb24gdmlzdWFsTGluZUVuZE5vKGRvYywgbGluZU4pIHtcbiAgICBpZiAobGluZU4gPiBkb2MubGFzdExpbmUoKSkgcmV0dXJuIGxpbmVOO1xuICAgIHZhciBsaW5lID0gZ2V0TGluZShkb2MsIGxpbmVOKSwgbWVyZ2VkO1xuICAgIGlmICghbGluZUlzSGlkZGVuKGRvYywgbGluZSkpIHJldHVybiBsaW5lTjtcbiAgICB3aGlsZSAobWVyZ2VkID0gY29sbGFwc2VkU3BhbkF0RW5kKGxpbmUpKVxuICAgICAgbGluZSA9IG1lcmdlZC5maW5kKDEsIHRydWUpLmxpbmU7XG4gICAgcmV0dXJuIGxpbmVObyhsaW5lKSArIDE7XG4gIH1cblxuICAvLyBDb21wdXRlIHdoZXRoZXIgYSBsaW5lIGlzIGhpZGRlbi4gTGluZXMgY291bnQgYXMgaGlkZGVuIHdoZW4gdGhleVxuICAvLyBhcmUgcGFydCBvZiBhIHZpc3VhbCBsaW5lIHRoYXQgc3RhcnRzIHdpdGggYW5vdGhlciBsaW5lLCBvciB3aGVuXG4gIC8vIHRoZXkgYXJlIGVudGlyZWx5IGNvdmVyZWQgYnkgY29sbGFwc2VkLCBub24td2lkZ2V0IHNwYW4uXG4gIGZ1bmN0aW9uIGxpbmVJc0hpZGRlbihkb2MsIGxpbmUpIHtcbiAgICB2YXIgc3BzID0gc2F3Q29sbGFwc2VkU3BhbnMgJiYgbGluZS5tYXJrZWRTcGFucztcbiAgICBpZiAoc3BzKSBmb3IgKHZhciBzcCwgaSA9IDA7IGkgPCBzcHMubGVuZ3RoOyArK2kpIHtcbiAgICAgIHNwID0gc3BzW2ldO1xuICAgICAgaWYgKCFzcC5tYXJrZXIuY29sbGFwc2VkKSBjb250aW51ZTtcbiAgICAgIGlmIChzcC5mcm9tID09IG51bGwpIHJldHVybiB0cnVlO1xuICAgICAgaWYgKHNwLm1hcmtlci53aWRnZXROb2RlKSBjb250aW51ZTtcbiAgICAgIGlmIChzcC5mcm9tID09IDAgJiYgc3AubWFya2VyLmluY2x1c2l2ZUxlZnQgJiYgbGluZUlzSGlkZGVuSW5uZXIoZG9jLCBsaW5lLCBzcCkpXG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgfVxuICBmdW5jdGlvbiBsaW5lSXNIaWRkZW5Jbm5lcihkb2MsIGxpbmUsIHNwYW4pIHtcbiAgICBpZiAoc3Bhbi50byA9PSBudWxsKSB7XG4gICAgICB2YXIgZW5kID0gc3Bhbi5tYXJrZXIuZmluZCgxLCB0cnVlKTtcbiAgICAgIHJldHVybiBsaW5lSXNIaWRkZW5Jbm5lcihkb2MsIGVuZC5saW5lLCBnZXRNYXJrZWRTcGFuRm9yKGVuZC5saW5lLm1hcmtlZFNwYW5zLCBzcGFuLm1hcmtlcikpO1xuICAgIH1cbiAgICBpZiAoc3Bhbi5tYXJrZXIuaW5jbHVzaXZlUmlnaHQgJiYgc3Bhbi50byA9PSBsaW5lLnRleHQubGVuZ3RoKVxuICAgICAgcmV0dXJuIHRydWU7XG4gICAgZm9yICh2YXIgc3AsIGkgPSAwOyBpIDwgbGluZS5tYXJrZWRTcGFucy5sZW5ndGg7ICsraSkge1xuICAgICAgc3AgPSBsaW5lLm1hcmtlZFNwYW5zW2ldO1xuICAgICAgaWYgKHNwLm1hcmtlci5jb2xsYXBzZWQgJiYgIXNwLm1hcmtlci53aWRnZXROb2RlICYmIHNwLmZyb20gPT0gc3Bhbi50byAmJlxuICAgICAgICAgIChzcC50byA9PSBudWxsIHx8IHNwLnRvICE9IHNwYW4uZnJvbSkgJiZcbiAgICAgICAgICAoc3AubWFya2VyLmluY2x1c2l2ZUxlZnQgfHwgc3Bhbi5tYXJrZXIuaW5jbHVzaXZlUmlnaHQpICYmXG4gICAgICAgICAgbGluZUlzSGlkZGVuSW5uZXIoZG9jLCBsaW5lLCBzcCkpIHJldHVybiB0cnVlO1xuICAgIH1cbiAgfVxuXG4gIC8vIExJTkUgV0lER0VUU1xuXG4gIC8vIExpbmUgd2lkZ2V0cyBhcmUgYmxvY2sgZWxlbWVudHMgZGlzcGxheWVkIGFib3ZlIG9yIGJlbG93IGEgbGluZS5cblxuICB2YXIgTGluZVdpZGdldCA9IENvZGVNaXJyb3IuTGluZVdpZGdldCA9IGZ1bmN0aW9uKGRvYywgbm9kZSwgb3B0aW9ucykge1xuICAgIGlmIChvcHRpb25zKSBmb3IgKHZhciBvcHQgaW4gb3B0aW9ucykgaWYgKG9wdGlvbnMuaGFzT3duUHJvcGVydHkob3B0KSlcbiAgICAgIHRoaXNbb3B0XSA9IG9wdGlvbnNbb3B0XTtcbiAgICB0aGlzLmRvYyA9IGRvYztcbiAgICB0aGlzLm5vZGUgPSBub2RlO1xuICB9O1xuICBldmVudE1peGluKExpbmVXaWRnZXQpO1xuXG4gIGZ1bmN0aW9uIGFkanVzdFNjcm9sbFdoZW5BYm92ZVZpc2libGUoY20sIGxpbmUsIGRpZmYpIHtcbiAgICBpZiAoaGVpZ2h0QXRMaW5lKGxpbmUpIDwgKChjbS5jdXJPcCAmJiBjbS5jdXJPcC5zY3JvbGxUb3ApIHx8IGNtLmRvYy5zY3JvbGxUb3ApKVxuICAgICAgYWRkVG9TY3JvbGxQb3MoY20sIG51bGwsIGRpZmYpO1xuICB9XG5cbiAgTGluZVdpZGdldC5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgY20gPSB0aGlzLmRvYy5jbSwgd3MgPSB0aGlzLmxpbmUud2lkZ2V0cywgbGluZSA9IHRoaXMubGluZSwgbm8gPSBsaW5lTm8obGluZSk7XG4gICAgaWYgKG5vID09IG51bGwgfHwgIXdzKSByZXR1cm47XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCB3cy5sZW5ndGg7ICsraSkgaWYgKHdzW2ldID09IHRoaXMpIHdzLnNwbGljZShpLS0sIDEpO1xuICAgIGlmICghd3MubGVuZ3RoKSBsaW5lLndpZGdldHMgPSBudWxsO1xuICAgIHZhciBoZWlnaHQgPSB3aWRnZXRIZWlnaHQodGhpcyk7XG4gICAgdXBkYXRlTGluZUhlaWdodChsaW5lLCBNYXRoLm1heCgwLCBsaW5lLmhlaWdodCAtIGhlaWdodCkpO1xuICAgIGlmIChjbSkgcnVuSW5PcChjbSwgZnVuY3Rpb24oKSB7XG4gICAgICBhZGp1c3RTY3JvbGxXaGVuQWJvdmVWaXNpYmxlKGNtLCBsaW5lLCAtaGVpZ2h0KTtcbiAgICAgIHJlZ0xpbmVDaGFuZ2UoY20sIG5vLCBcIndpZGdldFwiKTtcbiAgICB9KTtcbiAgfTtcbiAgTGluZVdpZGdldC5wcm90b3R5cGUuY2hhbmdlZCA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBvbGRIID0gdGhpcy5oZWlnaHQsIGNtID0gdGhpcy5kb2MuY20sIGxpbmUgPSB0aGlzLmxpbmU7XG4gICAgdGhpcy5oZWlnaHQgPSBudWxsO1xuICAgIHZhciBkaWZmID0gd2lkZ2V0SGVpZ2h0KHRoaXMpIC0gb2xkSDtcbiAgICBpZiAoIWRpZmYpIHJldHVybjtcbiAgICB1cGRhdGVMaW5lSGVpZ2h0KGxpbmUsIGxpbmUuaGVpZ2h0ICsgZGlmZik7XG4gICAgaWYgKGNtKSBydW5Jbk9wKGNtLCBmdW5jdGlvbigpIHtcbiAgICAgIGNtLmN1ck9wLmZvcmNlVXBkYXRlID0gdHJ1ZTtcbiAgICAgIGFkanVzdFNjcm9sbFdoZW5BYm92ZVZpc2libGUoY20sIGxpbmUsIGRpZmYpO1xuICAgIH0pO1xuICB9O1xuXG4gIGZ1bmN0aW9uIHdpZGdldEhlaWdodCh3aWRnZXQpIHtcbiAgICBpZiAod2lkZ2V0LmhlaWdodCAhPSBudWxsKSByZXR1cm4gd2lkZ2V0LmhlaWdodDtcbiAgICB2YXIgY20gPSB3aWRnZXQuZG9jLmNtO1xuICAgIGlmICghY20pIHJldHVybiAwO1xuICAgIGlmICghY29udGFpbnMoZG9jdW1lbnQuYm9keSwgd2lkZ2V0Lm5vZGUpKSB7XG4gICAgICB2YXIgcGFyZW50U3R5bGUgPSBcInBvc2l0aW9uOiByZWxhdGl2ZTtcIjtcbiAgICAgIGlmICh3aWRnZXQuY292ZXJHdXR0ZXIpXG4gICAgICAgIHBhcmVudFN0eWxlICs9IFwibWFyZ2luLWxlZnQ6IC1cIiArIGNtLmRpc3BsYXkuZ3V0dGVycy5vZmZzZXRXaWR0aCArIFwicHg7XCI7XG4gICAgICBpZiAod2lkZ2V0Lm5vSFNjcm9sbClcbiAgICAgICAgcGFyZW50U3R5bGUgKz0gXCJ3aWR0aDogXCIgKyBjbS5kaXNwbGF5LndyYXBwZXIuY2xpZW50V2lkdGggKyBcInB4O1wiO1xuICAgICAgcmVtb3ZlQ2hpbGRyZW5BbmRBZGQoY20uZGlzcGxheS5tZWFzdXJlLCBlbHQoXCJkaXZcIiwgW3dpZGdldC5ub2RlXSwgbnVsbCwgcGFyZW50U3R5bGUpKTtcbiAgICB9XG4gICAgcmV0dXJuIHdpZGdldC5oZWlnaHQgPSB3aWRnZXQubm9kZS5vZmZzZXRIZWlnaHQ7XG4gIH1cblxuICBmdW5jdGlvbiBhZGRMaW5lV2lkZ2V0KGRvYywgaGFuZGxlLCBub2RlLCBvcHRpb25zKSB7XG4gICAgdmFyIHdpZGdldCA9IG5ldyBMaW5lV2lkZ2V0KGRvYywgbm9kZSwgb3B0aW9ucyk7XG4gICAgdmFyIGNtID0gZG9jLmNtO1xuICAgIGlmIChjbSAmJiB3aWRnZXQubm9IU2Nyb2xsKSBjbS5kaXNwbGF5LmFsaWduV2lkZ2V0cyA9IHRydWU7XG4gICAgY2hhbmdlTGluZShkb2MsIGhhbmRsZSwgXCJ3aWRnZXRcIiwgZnVuY3Rpb24obGluZSkge1xuICAgICAgdmFyIHdpZGdldHMgPSBsaW5lLndpZGdldHMgfHwgKGxpbmUud2lkZ2V0cyA9IFtdKTtcbiAgICAgIGlmICh3aWRnZXQuaW5zZXJ0QXQgPT0gbnVsbCkgd2lkZ2V0cy5wdXNoKHdpZGdldCk7XG4gICAgICBlbHNlIHdpZGdldHMuc3BsaWNlKE1hdGgubWluKHdpZGdldHMubGVuZ3RoIC0gMSwgTWF0aC5tYXgoMCwgd2lkZ2V0Lmluc2VydEF0KSksIDAsIHdpZGdldCk7XG4gICAgICB3aWRnZXQubGluZSA9IGxpbmU7XG4gICAgICBpZiAoY20gJiYgIWxpbmVJc0hpZGRlbihkb2MsIGxpbmUpKSB7XG4gICAgICAgIHZhciBhYm92ZVZpc2libGUgPSBoZWlnaHRBdExpbmUobGluZSkgPCBkb2Muc2Nyb2xsVG9wO1xuICAgICAgICB1cGRhdGVMaW5lSGVpZ2h0KGxpbmUsIGxpbmUuaGVpZ2h0ICsgd2lkZ2V0SGVpZ2h0KHdpZGdldCkpO1xuICAgICAgICBpZiAoYWJvdmVWaXNpYmxlKSBhZGRUb1Njcm9sbFBvcyhjbSwgbnVsbCwgd2lkZ2V0LmhlaWdodCk7XG4gICAgICAgIGNtLmN1ck9wLmZvcmNlVXBkYXRlID0gdHJ1ZTtcbiAgICAgIH1cbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH0pO1xuICAgIHJldHVybiB3aWRnZXQ7XG4gIH1cblxuICAvLyBMSU5FIERBVEEgU1RSVUNUVVJFXG5cbiAgLy8gTGluZSBvYmplY3RzLiBUaGVzZSBob2xkIHN0YXRlIHJlbGF0ZWQgdG8gYSBsaW5lLCBpbmNsdWRpbmdcbiAgLy8gaGlnaGxpZ2h0aW5nIGluZm8gKHRoZSBzdHlsZXMgYXJyYXkpLlxuICB2YXIgTGluZSA9IENvZGVNaXJyb3IuTGluZSA9IGZ1bmN0aW9uKHRleHQsIG1hcmtlZFNwYW5zLCBlc3RpbWF0ZUhlaWdodCkge1xuICAgIHRoaXMudGV4dCA9IHRleHQ7XG4gICAgYXR0YWNoTWFya2VkU3BhbnModGhpcywgbWFya2VkU3BhbnMpO1xuICAgIHRoaXMuaGVpZ2h0ID0gZXN0aW1hdGVIZWlnaHQgPyBlc3RpbWF0ZUhlaWdodCh0aGlzKSA6IDE7XG4gIH07XG4gIGV2ZW50TWl4aW4oTGluZSk7XG4gIExpbmUucHJvdG90eXBlLmxpbmVObyA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gbGluZU5vKHRoaXMpOyB9O1xuXG4gIC8vIENoYW5nZSB0aGUgY29udGVudCAodGV4dCwgbWFya2Vycykgb2YgYSBsaW5lLiBBdXRvbWF0aWNhbGx5XG4gIC8vIGludmFsaWRhdGVzIGNhY2hlZCBpbmZvcm1hdGlvbiBhbmQgdHJpZXMgdG8gcmUtZXN0aW1hdGUgdGhlXG4gIC8vIGxpbmUncyBoZWlnaHQuXG4gIGZ1bmN0aW9uIHVwZGF0ZUxpbmUobGluZSwgdGV4dCwgbWFya2VkU3BhbnMsIGVzdGltYXRlSGVpZ2h0KSB7XG4gICAgbGluZS50ZXh0ID0gdGV4dDtcbiAgICBpZiAobGluZS5zdGF0ZUFmdGVyKSBsaW5lLnN0YXRlQWZ0ZXIgPSBudWxsO1xuICAgIGlmIChsaW5lLnN0eWxlcykgbGluZS5zdHlsZXMgPSBudWxsO1xuICAgIGlmIChsaW5lLm9yZGVyICE9IG51bGwpIGxpbmUub3JkZXIgPSBudWxsO1xuICAgIGRldGFjaE1hcmtlZFNwYW5zKGxpbmUpO1xuICAgIGF0dGFjaE1hcmtlZFNwYW5zKGxpbmUsIG1hcmtlZFNwYW5zKTtcbiAgICB2YXIgZXN0SGVpZ2h0ID0gZXN0aW1hdGVIZWlnaHQgPyBlc3RpbWF0ZUhlaWdodChsaW5lKSA6IDE7XG4gICAgaWYgKGVzdEhlaWdodCAhPSBsaW5lLmhlaWdodCkgdXBkYXRlTGluZUhlaWdodChsaW5lLCBlc3RIZWlnaHQpO1xuICB9XG5cbiAgLy8gRGV0YWNoIGEgbGluZSBmcm9tIHRoZSBkb2N1bWVudCB0cmVlIGFuZCBpdHMgbWFya2Vycy5cbiAgZnVuY3Rpb24gY2xlYW5VcExpbmUobGluZSkge1xuICAgIGxpbmUucGFyZW50ID0gbnVsbDtcbiAgICBkZXRhY2hNYXJrZWRTcGFucyhsaW5lKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGV4dHJhY3RMaW5lQ2xhc3Nlcyh0eXBlLCBvdXRwdXQpIHtcbiAgICBpZiAodHlwZSkgZm9yICg7Oykge1xuICAgICAgdmFyIGxpbmVDbGFzcyA9IHR5cGUubWF0Y2goLyg/Ol58XFxzKylsaW5lLShiYWNrZ3JvdW5kLSk/KFxcUyspLyk7XG4gICAgICBpZiAoIWxpbmVDbGFzcykgYnJlYWs7XG4gICAgICB0eXBlID0gdHlwZS5zbGljZSgwLCBsaW5lQ2xhc3MuaW5kZXgpICsgdHlwZS5zbGljZShsaW5lQ2xhc3MuaW5kZXggKyBsaW5lQ2xhc3NbMF0ubGVuZ3RoKTtcbiAgICAgIHZhciBwcm9wID0gbGluZUNsYXNzWzFdID8gXCJiZ0NsYXNzXCIgOiBcInRleHRDbGFzc1wiO1xuICAgICAgaWYgKG91dHB1dFtwcm9wXSA9PSBudWxsKVxuICAgICAgICBvdXRwdXRbcHJvcF0gPSBsaW5lQ2xhc3NbMl07XG4gICAgICBlbHNlIGlmICghKG5ldyBSZWdFeHAoXCIoPzpefFxccylcIiArIGxpbmVDbGFzc1syXSArIFwiKD86JHxcXHMpXCIpKS50ZXN0KG91dHB1dFtwcm9wXSkpXG4gICAgICAgIG91dHB1dFtwcm9wXSArPSBcIiBcIiArIGxpbmVDbGFzc1syXTtcbiAgICB9XG4gICAgcmV0dXJuIHR5cGU7XG4gIH1cblxuICBmdW5jdGlvbiBjYWxsQmxhbmtMaW5lKG1vZGUsIHN0YXRlKSB7XG4gICAgaWYgKG1vZGUuYmxhbmtMaW5lKSByZXR1cm4gbW9kZS5ibGFua0xpbmUoc3RhdGUpO1xuICAgIGlmICghbW9kZS5pbm5lck1vZGUpIHJldHVybjtcbiAgICB2YXIgaW5uZXIgPSBDb2RlTWlycm9yLmlubmVyTW9kZShtb2RlLCBzdGF0ZSk7XG4gICAgaWYgKGlubmVyLm1vZGUuYmxhbmtMaW5lKSByZXR1cm4gaW5uZXIubW9kZS5ibGFua0xpbmUoaW5uZXIuc3RhdGUpO1xuICB9XG5cbiAgZnVuY3Rpb24gcmVhZFRva2VuKG1vZGUsIHN0cmVhbSwgc3RhdGUsIGlubmVyKSB7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCAxMDsgaSsrKSB7XG4gICAgICBpZiAoaW5uZXIpIGlubmVyWzBdID0gQ29kZU1pcnJvci5pbm5lck1vZGUobW9kZSwgc3RhdGUpLm1vZGU7XG4gICAgICB2YXIgc3R5bGUgPSBtb2RlLnRva2VuKHN0cmVhbSwgc3RhdGUpO1xuICAgICAgaWYgKHN0cmVhbS5wb3MgPiBzdHJlYW0uc3RhcnQpIHJldHVybiBzdHlsZTtcbiAgICB9XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiTW9kZSBcIiArIG1vZGUubmFtZSArIFwiIGZhaWxlZCB0byBhZHZhbmNlIHN0cmVhbS5cIik7XG4gIH1cblxuICAvLyBVdGlsaXR5IGZvciBnZXRUb2tlbkF0IGFuZCBnZXRMaW5lVG9rZW5zXG4gIGZ1bmN0aW9uIHRha2VUb2tlbihjbSwgcG9zLCBwcmVjaXNlLCBhc0FycmF5KSB7XG4gICAgZnVuY3Rpb24gZ2V0T2JqKGNvcHkpIHtcbiAgICAgIHJldHVybiB7c3RhcnQ6IHN0cmVhbS5zdGFydCwgZW5kOiBzdHJlYW0ucG9zLFxuICAgICAgICAgICAgICBzdHJpbmc6IHN0cmVhbS5jdXJyZW50KCksXG4gICAgICAgICAgICAgIHR5cGU6IHN0eWxlIHx8IG51bGwsXG4gICAgICAgICAgICAgIHN0YXRlOiBjb3B5ID8gY29weVN0YXRlKGRvYy5tb2RlLCBzdGF0ZSkgOiBzdGF0ZX07XG4gICAgfVxuXG4gICAgdmFyIGRvYyA9IGNtLmRvYywgbW9kZSA9IGRvYy5tb2RlLCBzdHlsZTtcbiAgICBwb3MgPSBjbGlwUG9zKGRvYywgcG9zKTtcbiAgICB2YXIgbGluZSA9IGdldExpbmUoZG9jLCBwb3MubGluZSksIHN0YXRlID0gZ2V0U3RhdGVCZWZvcmUoY20sIHBvcy5saW5lLCBwcmVjaXNlKTtcbiAgICB2YXIgc3RyZWFtID0gbmV3IFN0cmluZ1N0cmVhbShsaW5lLnRleHQsIGNtLm9wdGlvbnMudGFiU2l6ZSksIHRva2VucztcbiAgICBpZiAoYXNBcnJheSkgdG9rZW5zID0gW107XG4gICAgd2hpbGUgKChhc0FycmF5IHx8IHN0cmVhbS5wb3MgPCBwb3MuY2gpICYmICFzdHJlYW0uZW9sKCkpIHtcbiAgICAgIHN0cmVhbS5zdGFydCA9IHN0cmVhbS5wb3M7XG4gICAgICBzdHlsZSA9IHJlYWRUb2tlbihtb2RlLCBzdHJlYW0sIHN0YXRlKTtcbiAgICAgIGlmIChhc0FycmF5KSB0b2tlbnMucHVzaChnZXRPYmoodHJ1ZSkpO1xuICAgIH1cbiAgICByZXR1cm4gYXNBcnJheSA/IHRva2VucyA6IGdldE9iaigpO1xuICB9XG5cbiAgLy8gUnVuIHRoZSBnaXZlbiBtb2RlJ3MgcGFyc2VyIG92ZXIgYSBsaW5lLCBjYWxsaW5nIGYgZm9yIGVhY2ggdG9rZW4uXG4gIGZ1bmN0aW9uIHJ1bk1vZGUoY20sIHRleHQsIG1vZGUsIHN0YXRlLCBmLCBsaW5lQ2xhc3NlcywgZm9yY2VUb0VuZCkge1xuICAgIHZhciBmbGF0dGVuU3BhbnMgPSBtb2RlLmZsYXR0ZW5TcGFucztcbiAgICBpZiAoZmxhdHRlblNwYW5zID09IG51bGwpIGZsYXR0ZW5TcGFucyA9IGNtLm9wdGlvbnMuZmxhdHRlblNwYW5zO1xuICAgIHZhciBjdXJTdGFydCA9IDAsIGN1clN0eWxlID0gbnVsbDtcbiAgICB2YXIgc3RyZWFtID0gbmV3IFN0cmluZ1N0cmVhbSh0ZXh0LCBjbS5vcHRpb25zLnRhYlNpemUpLCBzdHlsZTtcbiAgICB2YXIgaW5uZXIgPSBjbS5vcHRpb25zLmFkZE1vZGVDbGFzcyAmJiBbbnVsbF07XG4gICAgaWYgKHRleHQgPT0gXCJcIikgZXh0cmFjdExpbmVDbGFzc2VzKGNhbGxCbGFua0xpbmUobW9kZSwgc3RhdGUpLCBsaW5lQ2xhc3Nlcyk7XG4gICAgd2hpbGUgKCFzdHJlYW0uZW9sKCkpIHtcbiAgICAgIGlmIChzdHJlYW0ucG9zID4gY20ub3B0aW9ucy5tYXhIaWdobGlnaHRMZW5ndGgpIHtcbiAgICAgICAgZmxhdHRlblNwYW5zID0gZmFsc2U7XG4gICAgICAgIGlmIChmb3JjZVRvRW5kKSBwcm9jZXNzTGluZShjbSwgdGV4dCwgc3RhdGUsIHN0cmVhbS5wb3MpO1xuICAgICAgICBzdHJlYW0ucG9zID0gdGV4dC5sZW5ndGg7XG4gICAgICAgIHN0eWxlID0gbnVsbDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHN0eWxlID0gZXh0cmFjdExpbmVDbGFzc2VzKHJlYWRUb2tlbihtb2RlLCBzdHJlYW0sIHN0YXRlLCBpbm5lciksIGxpbmVDbGFzc2VzKTtcbiAgICAgIH1cbiAgICAgIGlmIChpbm5lcikge1xuICAgICAgICB2YXIgbU5hbWUgPSBpbm5lclswXS5uYW1lO1xuICAgICAgICBpZiAobU5hbWUpIHN0eWxlID0gXCJtLVwiICsgKHN0eWxlID8gbU5hbWUgKyBcIiBcIiArIHN0eWxlIDogbU5hbWUpO1xuICAgICAgfVxuICAgICAgaWYgKCFmbGF0dGVuU3BhbnMgfHwgY3VyU3R5bGUgIT0gc3R5bGUpIHtcbiAgICAgICAgd2hpbGUgKGN1clN0YXJ0IDwgc3RyZWFtLnN0YXJ0KSB7XG4gICAgICAgICAgY3VyU3RhcnQgPSBNYXRoLm1pbihzdHJlYW0uc3RhcnQsIGN1clN0YXJ0ICsgNTAwMDApO1xuICAgICAgICAgIGYoY3VyU3RhcnQsIGN1clN0eWxlKTtcbiAgICAgICAgfVxuICAgICAgICBjdXJTdHlsZSA9IHN0eWxlO1xuICAgICAgfVxuICAgICAgc3RyZWFtLnN0YXJ0ID0gc3RyZWFtLnBvcztcbiAgICB9XG4gICAgd2hpbGUgKGN1clN0YXJ0IDwgc3RyZWFtLnBvcykge1xuICAgICAgLy8gV2Via2l0IHNlZW1zIHRvIHJlZnVzZSB0byByZW5kZXIgdGV4dCBub2RlcyBsb25nZXIgdGhhbiA1NzQ0NCBjaGFyYWN0ZXJzXG4gICAgICB2YXIgcG9zID0gTWF0aC5taW4oc3RyZWFtLnBvcywgY3VyU3RhcnQgKyA1MDAwMCk7XG4gICAgICBmKHBvcywgY3VyU3R5bGUpO1xuICAgICAgY3VyU3RhcnQgPSBwb3M7XG4gICAgfVxuICB9XG5cbiAgLy8gQ29tcHV0ZSBhIHN0eWxlIGFycmF5IChhbiBhcnJheSBzdGFydGluZyB3aXRoIGEgbW9kZSBnZW5lcmF0aW9uXG4gIC8vIC0tIGZvciBpbnZhbGlkYXRpb24gLS0gZm9sbG93ZWQgYnkgcGFpcnMgb2YgZW5kIHBvc2l0aW9ucyBhbmRcbiAgLy8gc3R5bGUgc3RyaW5ncyksIHdoaWNoIGlzIHVzZWQgdG8gaGlnaGxpZ2h0IHRoZSB0b2tlbnMgb24gdGhlXG4gIC8vIGxpbmUuXG4gIGZ1bmN0aW9uIGhpZ2hsaWdodExpbmUoY20sIGxpbmUsIHN0YXRlLCBmb3JjZVRvRW5kKSB7XG4gICAgLy8gQSBzdHlsZXMgYXJyYXkgYWx3YXlzIHN0YXJ0cyB3aXRoIGEgbnVtYmVyIGlkZW50aWZ5aW5nIHRoZVxuICAgIC8vIG1vZGUvb3ZlcmxheXMgdGhhdCBpdCBpcyBiYXNlZCBvbiAoZm9yIGVhc3kgaW52YWxpZGF0aW9uKS5cbiAgICB2YXIgc3QgPSBbY20uc3RhdGUubW9kZUdlbl0sIGxpbmVDbGFzc2VzID0ge307XG4gICAgLy8gQ29tcHV0ZSB0aGUgYmFzZSBhcnJheSBvZiBzdHlsZXNcbiAgICBydW5Nb2RlKGNtLCBsaW5lLnRleHQsIGNtLmRvYy5tb2RlLCBzdGF0ZSwgZnVuY3Rpb24oZW5kLCBzdHlsZSkge1xuICAgICAgc3QucHVzaChlbmQsIHN0eWxlKTtcbiAgICB9LCBsaW5lQ2xhc3NlcywgZm9yY2VUb0VuZCk7XG5cbiAgICAvLyBSdW4gb3ZlcmxheXMsIGFkanVzdCBzdHlsZSBhcnJheS5cbiAgICBmb3IgKHZhciBvID0gMDsgbyA8IGNtLnN0YXRlLm92ZXJsYXlzLmxlbmd0aDsgKytvKSB7XG4gICAgICB2YXIgb3ZlcmxheSA9IGNtLnN0YXRlLm92ZXJsYXlzW29dLCBpID0gMSwgYXQgPSAwO1xuICAgICAgcnVuTW9kZShjbSwgbGluZS50ZXh0LCBvdmVybGF5Lm1vZGUsIHRydWUsIGZ1bmN0aW9uKGVuZCwgc3R5bGUpIHtcbiAgICAgICAgdmFyIHN0YXJ0ID0gaTtcbiAgICAgICAgLy8gRW5zdXJlIHRoZXJlJ3MgYSB0b2tlbiBlbmQgYXQgdGhlIGN1cnJlbnQgcG9zaXRpb24sIGFuZCB0aGF0IGkgcG9pbnRzIGF0IGl0XG4gICAgICAgIHdoaWxlIChhdCA8IGVuZCkge1xuICAgICAgICAgIHZhciBpX2VuZCA9IHN0W2ldO1xuICAgICAgICAgIGlmIChpX2VuZCA+IGVuZClcbiAgICAgICAgICAgIHN0LnNwbGljZShpLCAxLCBlbmQsIHN0W2krMV0sIGlfZW5kKTtcbiAgICAgICAgICBpICs9IDI7XG4gICAgICAgICAgYXQgPSBNYXRoLm1pbihlbmQsIGlfZW5kKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIXN0eWxlKSByZXR1cm47XG4gICAgICAgIGlmIChvdmVybGF5Lm9wYXF1ZSkge1xuICAgICAgICAgIHN0LnNwbGljZShzdGFydCwgaSAtIHN0YXJ0LCBlbmQsIFwiY20tb3ZlcmxheSBcIiArIHN0eWxlKTtcbiAgICAgICAgICBpID0gc3RhcnQgKyAyO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGZvciAoOyBzdGFydCA8IGk7IHN0YXJ0ICs9IDIpIHtcbiAgICAgICAgICAgIHZhciBjdXIgPSBzdFtzdGFydCsxXTtcbiAgICAgICAgICAgIHN0W3N0YXJ0KzFdID0gKGN1ciA/IGN1ciArIFwiIFwiIDogXCJcIikgKyBcImNtLW92ZXJsYXkgXCIgKyBzdHlsZTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0sIGxpbmVDbGFzc2VzKTtcbiAgICB9XG5cbiAgICByZXR1cm4ge3N0eWxlczogc3QsIGNsYXNzZXM6IGxpbmVDbGFzc2VzLmJnQ2xhc3MgfHwgbGluZUNsYXNzZXMudGV4dENsYXNzID8gbGluZUNsYXNzZXMgOiBudWxsfTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGdldExpbmVTdHlsZXMoY20sIGxpbmUsIHVwZGF0ZUZyb250aWVyKSB7XG4gICAgaWYgKCFsaW5lLnN0eWxlcyB8fCBsaW5lLnN0eWxlc1swXSAhPSBjbS5zdGF0ZS5tb2RlR2VuKSB7XG4gICAgICB2YXIgcmVzdWx0ID0gaGlnaGxpZ2h0TGluZShjbSwgbGluZSwgbGluZS5zdGF0ZUFmdGVyID0gZ2V0U3RhdGVCZWZvcmUoY20sIGxpbmVObyhsaW5lKSkpO1xuICAgICAgbGluZS5zdHlsZXMgPSByZXN1bHQuc3R5bGVzO1xuICAgICAgaWYgKHJlc3VsdC5jbGFzc2VzKSBsaW5lLnN0eWxlQ2xhc3NlcyA9IHJlc3VsdC5jbGFzc2VzO1xuICAgICAgZWxzZSBpZiAobGluZS5zdHlsZUNsYXNzZXMpIGxpbmUuc3R5bGVDbGFzc2VzID0gbnVsbDtcbiAgICAgIGlmICh1cGRhdGVGcm9udGllciA9PT0gY20uZG9jLmZyb250aWVyKSBjbS5kb2MuZnJvbnRpZXIrKztcbiAgICB9XG4gICAgcmV0dXJuIGxpbmUuc3R5bGVzO1xuICB9XG5cbiAgLy8gTGlnaHR3ZWlnaHQgZm9ybSBvZiBoaWdobGlnaHQgLS0gcHJvY2VlZCBvdmVyIHRoaXMgbGluZSBhbmRcbiAgLy8gdXBkYXRlIHN0YXRlLCBidXQgZG9uJ3Qgc2F2ZSBhIHN0eWxlIGFycmF5LiBVc2VkIGZvciBsaW5lcyB0aGF0XG4gIC8vIGFyZW4ndCBjdXJyZW50bHkgdmlzaWJsZS5cbiAgZnVuY3Rpb24gcHJvY2Vzc0xpbmUoY20sIHRleHQsIHN0YXRlLCBzdGFydEF0KSB7XG4gICAgdmFyIG1vZGUgPSBjbS5kb2MubW9kZTtcbiAgICB2YXIgc3RyZWFtID0gbmV3IFN0cmluZ1N0cmVhbSh0ZXh0LCBjbS5vcHRpb25zLnRhYlNpemUpO1xuICAgIHN0cmVhbS5zdGFydCA9IHN0cmVhbS5wb3MgPSBzdGFydEF0IHx8IDA7XG4gICAgaWYgKHRleHQgPT0gXCJcIikgY2FsbEJsYW5rTGluZShtb2RlLCBzdGF0ZSk7XG4gICAgd2hpbGUgKCFzdHJlYW0uZW9sKCkgJiYgc3RyZWFtLnBvcyA8PSBjbS5vcHRpb25zLm1heEhpZ2hsaWdodExlbmd0aCkge1xuICAgICAgcmVhZFRva2VuKG1vZGUsIHN0cmVhbSwgc3RhdGUpO1xuICAgICAgc3RyZWFtLnN0YXJ0ID0gc3RyZWFtLnBvcztcbiAgICB9XG4gIH1cblxuICAvLyBDb252ZXJ0IGEgc3R5bGUgYXMgcmV0dXJuZWQgYnkgYSBtb2RlIChlaXRoZXIgbnVsbCwgb3IgYSBzdHJpbmdcbiAgLy8gY29udGFpbmluZyBvbmUgb3IgbW9yZSBzdHlsZXMpIHRvIGEgQ1NTIHN0eWxlLiBUaGlzIGlzIGNhY2hlZCxcbiAgLy8gYW5kIGFsc28gbG9va3MgZm9yIGxpbmUtd2lkZSBzdHlsZXMuXG4gIHZhciBzdHlsZVRvQ2xhc3NDYWNoZSA9IHt9LCBzdHlsZVRvQ2xhc3NDYWNoZVdpdGhNb2RlID0ge307XG4gIGZ1bmN0aW9uIGludGVycHJldFRva2VuU3R5bGUoc3R5bGUsIG9wdGlvbnMpIHtcbiAgICBpZiAoIXN0eWxlIHx8IC9eXFxzKiQvLnRlc3Qoc3R5bGUpKSByZXR1cm4gbnVsbDtcbiAgICB2YXIgY2FjaGUgPSBvcHRpb25zLmFkZE1vZGVDbGFzcyA/IHN0eWxlVG9DbGFzc0NhY2hlV2l0aE1vZGUgOiBzdHlsZVRvQ2xhc3NDYWNoZTtcbiAgICByZXR1cm4gY2FjaGVbc3R5bGVdIHx8XG4gICAgICAoY2FjaGVbc3R5bGVdID0gc3R5bGUucmVwbGFjZSgvXFxTKy9nLCBcImNtLSQmXCIpKTtcbiAgfVxuXG4gIC8vIFJlbmRlciB0aGUgRE9NIHJlcHJlc2VudGF0aW9uIG9mIHRoZSB0ZXh0IG9mIGEgbGluZS4gQWxzbyBidWlsZHNcbiAgLy8gdXAgYSAnbGluZSBtYXAnLCB3aGljaCBwb2ludHMgYXQgdGhlIERPTSBub2RlcyB0aGF0IHJlcHJlc2VudFxuICAvLyBzcGVjaWZpYyBzdHJldGNoZXMgb2YgdGV4dCwgYW5kIGlzIHVzZWQgYnkgdGhlIG1lYXN1cmluZyBjb2RlLlxuICAvLyBUaGUgcmV0dXJuZWQgb2JqZWN0IGNvbnRhaW5zIHRoZSBET00gbm9kZSwgdGhpcyBtYXAsIGFuZFxuICAvLyBpbmZvcm1hdGlvbiBhYm91dCBsaW5lLXdpZGUgc3R5bGVzIHRoYXQgd2VyZSBzZXQgYnkgdGhlIG1vZGUuXG4gIGZ1bmN0aW9uIGJ1aWxkTGluZUNvbnRlbnQoY20sIGxpbmVWaWV3KSB7XG4gICAgLy8gVGhlIHBhZGRpbmctcmlnaHQgZm9yY2VzIHRoZSBlbGVtZW50IHRvIGhhdmUgYSAnYm9yZGVyJywgd2hpY2hcbiAgICAvLyBpcyBuZWVkZWQgb24gV2Via2l0IHRvIGJlIGFibGUgdG8gZ2V0IGxpbmUtbGV2ZWwgYm91bmRpbmdcbiAgICAvLyByZWN0YW5nbGVzIGZvciBpdCAoaW4gbWVhc3VyZUNoYXIpLlxuICAgIHZhciBjb250ZW50ID0gZWx0KFwic3BhblwiLCBudWxsLCBudWxsLCB3ZWJraXQgPyBcInBhZGRpbmctcmlnaHQ6IC4xcHhcIiA6IG51bGwpO1xuICAgIHZhciBidWlsZGVyID0ge3ByZTogZWx0KFwicHJlXCIsIFtjb250ZW50XSksIGNvbnRlbnQ6IGNvbnRlbnQsXG4gICAgICAgICAgICAgICAgICAgY29sOiAwLCBwb3M6IDAsIGNtOiBjbSxcbiAgICAgICAgICAgICAgICAgICBzcGxpdFNwYWNlczogKGllIHx8IHdlYmtpdCkgJiYgY20uZ2V0T3B0aW9uKFwibGluZVdyYXBwaW5nXCIpfTtcbiAgICBsaW5lVmlldy5tZWFzdXJlID0ge307XG5cbiAgICAvLyBJdGVyYXRlIG92ZXIgdGhlIGxvZ2ljYWwgbGluZXMgdGhhdCBtYWtlIHVwIHRoaXMgdmlzdWFsIGxpbmUuXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPD0gKGxpbmVWaWV3LnJlc3QgPyBsaW5lVmlldy5yZXN0Lmxlbmd0aCA6IDApOyBpKyspIHtcbiAgICAgIHZhciBsaW5lID0gaSA/IGxpbmVWaWV3LnJlc3RbaSAtIDFdIDogbGluZVZpZXcubGluZSwgb3JkZXI7XG4gICAgICBidWlsZGVyLnBvcyA9IDA7XG4gICAgICBidWlsZGVyLmFkZFRva2VuID0gYnVpbGRUb2tlbjtcbiAgICAgIC8vIE9wdGlvbmFsbHkgd2lyZSBpbiBzb21lIGhhY2tzIGludG8gdGhlIHRva2VuLXJlbmRlcmluZ1xuICAgICAgLy8gYWxnb3JpdGhtLCB0byBkZWFsIHdpdGggYnJvd3NlciBxdWlya3MuXG4gICAgICBpZiAoaGFzQmFkQmlkaVJlY3RzKGNtLmRpc3BsYXkubWVhc3VyZSkgJiYgKG9yZGVyID0gZ2V0T3JkZXIobGluZSkpKVxuICAgICAgICBidWlsZGVyLmFkZFRva2VuID0gYnVpbGRUb2tlbkJhZEJpZGkoYnVpbGRlci5hZGRUb2tlbiwgb3JkZXIpO1xuICAgICAgYnVpbGRlci5tYXAgPSBbXTtcbiAgICAgIHZhciBhbGxvd0Zyb250aWVyVXBkYXRlID0gbGluZVZpZXcgIT0gY20uZGlzcGxheS5leHRlcm5hbE1lYXN1cmVkICYmIGxpbmVObyhsaW5lKTtcbiAgICAgIGluc2VydExpbmVDb250ZW50KGxpbmUsIGJ1aWxkZXIsIGdldExpbmVTdHlsZXMoY20sIGxpbmUsIGFsbG93RnJvbnRpZXJVcGRhdGUpKTtcbiAgICAgIGlmIChsaW5lLnN0eWxlQ2xhc3Nlcykge1xuICAgICAgICBpZiAobGluZS5zdHlsZUNsYXNzZXMuYmdDbGFzcylcbiAgICAgICAgICBidWlsZGVyLmJnQ2xhc3MgPSBqb2luQ2xhc3NlcyhsaW5lLnN0eWxlQ2xhc3Nlcy5iZ0NsYXNzLCBidWlsZGVyLmJnQ2xhc3MgfHwgXCJcIik7XG4gICAgICAgIGlmIChsaW5lLnN0eWxlQ2xhc3Nlcy50ZXh0Q2xhc3MpXG4gICAgICAgICAgYnVpbGRlci50ZXh0Q2xhc3MgPSBqb2luQ2xhc3NlcyhsaW5lLnN0eWxlQ2xhc3Nlcy50ZXh0Q2xhc3MsIGJ1aWxkZXIudGV4dENsYXNzIHx8IFwiXCIpO1xuICAgICAgfVxuXG4gICAgICAvLyBFbnN1cmUgYXQgbGVhc3QgYSBzaW5nbGUgbm9kZSBpcyBwcmVzZW50LCBmb3IgbWVhc3VyaW5nLlxuICAgICAgaWYgKGJ1aWxkZXIubWFwLmxlbmd0aCA9PSAwKVxuICAgICAgICBidWlsZGVyLm1hcC5wdXNoKDAsIDAsIGJ1aWxkZXIuY29udGVudC5hcHBlbmRDaGlsZCh6ZXJvV2lkdGhFbGVtZW50KGNtLmRpc3BsYXkubWVhc3VyZSkpKTtcblxuICAgICAgLy8gU3RvcmUgdGhlIG1hcCBhbmQgYSBjYWNoZSBvYmplY3QgZm9yIHRoZSBjdXJyZW50IGxvZ2ljYWwgbGluZVxuICAgICAgaWYgKGkgPT0gMCkge1xuICAgICAgICBsaW5lVmlldy5tZWFzdXJlLm1hcCA9IGJ1aWxkZXIubWFwO1xuICAgICAgICBsaW5lVmlldy5tZWFzdXJlLmNhY2hlID0ge307XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAobGluZVZpZXcubWVhc3VyZS5tYXBzIHx8IChsaW5lVmlldy5tZWFzdXJlLm1hcHMgPSBbXSkpLnB1c2goYnVpbGRlci5tYXApO1xuICAgICAgICAobGluZVZpZXcubWVhc3VyZS5jYWNoZXMgfHwgKGxpbmVWaWV3Lm1lYXN1cmUuY2FjaGVzID0gW10pKS5wdXNoKHt9KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBTZWUgaXNzdWUgIzI5MDFcbiAgICBpZiAod2Via2l0ICYmIC9cXGJjbS10YWJcXGIvLnRlc3QoYnVpbGRlci5jb250ZW50Lmxhc3RDaGlsZC5jbGFzc05hbWUpKVxuICAgICAgYnVpbGRlci5jb250ZW50LmNsYXNzTmFtZSA9IFwiY20tdGFiLXdyYXAtaGFja1wiO1xuXG4gICAgc2lnbmFsKGNtLCBcInJlbmRlckxpbmVcIiwgY20sIGxpbmVWaWV3LmxpbmUsIGJ1aWxkZXIucHJlKTtcbiAgICBpZiAoYnVpbGRlci5wcmUuY2xhc3NOYW1lKVxuICAgICAgYnVpbGRlci50ZXh0Q2xhc3MgPSBqb2luQ2xhc3NlcyhidWlsZGVyLnByZS5jbGFzc05hbWUsIGJ1aWxkZXIudGV4dENsYXNzIHx8IFwiXCIpO1xuXG4gICAgcmV0dXJuIGJ1aWxkZXI7XG4gIH1cblxuICBmdW5jdGlvbiBkZWZhdWx0U3BlY2lhbENoYXJQbGFjZWhvbGRlcihjaCkge1xuICAgIHZhciB0b2tlbiA9IGVsdChcInNwYW5cIiwgXCJcXHUyMDIyXCIsIFwiY20taW52YWxpZGNoYXJcIik7XG4gICAgdG9rZW4udGl0bGUgPSBcIlxcXFx1XCIgKyBjaC5jaGFyQ29kZUF0KDApLnRvU3RyaW5nKDE2KTtcbiAgICB0b2tlbi5zZXRBdHRyaWJ1dGUoXCJhcmlhLWxhYmVsXCIsIHRva2VuLnRpdGxlKTtcbiAgICByZXR1cm4gdG9rZW47XG4gIH1cblxuICAvLyBCdWlsZCB1cCB0aGUgRE9NIHJlcHJlc2VudGF0aW9uIGZvciBhIHNpbmdsZSB0b2tlbiwgYW5kIGFkZCBpdCB0b1xuICAvLyB0aGUgbGluZSBtYXAuIFRha2VzIGNhcmUgdG8gcmVuZGVyIHNwZWNpYWwgY2hhcmFjdGVycyBzZXBhcmF0ZWx5LlxuICBmdW5jdGlvbiBidWlsZFRva2VuKGJ1aWxkZXIsIHRleHQsIHN0eWxlLCBzdGFydFN0eWxlLCBlbmRTdHlsZSwgdGl0bGUsIGNzcykge1xuICAgIGlmICghdGV4dCkgcmV0dXJuO1xuICAgIHZhciBkaXNwbGF5VGV4dCA9IGJ1aWxkZXIuc3BsaXRTcGFjZXMgPyB0ZXh0LnJlcGxhY2UoLyB7Myx9L2csIHNwbGl0U3BhY2VzKSA6IHRleHQ7XG4gICAgdmFyIHNwZWNpYWwgPSBidWlsZGVyLmNtLnN0YXRlLnNwZWNpYWxDaGFycywgbXVzdFdyYXAgPSBmYWxzZTtcbiAgICBpZiAoIXNwZWNpYWwudGVzdCh0ZXh0KSkge1xuICAgICAgYnVpbGRlci5jb2wgKz0gdGV4dC5sZW5ndGg7XG4gICAgICB2YXIgY29udGVudCA9IGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKGRpc3BsYXlUZXh0KTtcbiAgICAgIGJ1aWxkZXIubWFwLnB1c2goYnVpbGRlci5wb3MsIGJ1aWxkZXIucG9zICsgdGV4dC5sZW5ndGgsIGNvbnRlbnQpO1xuICAgICAgaWYgKGllICYmIGllX3ZlcnNpb24gPCA5KSBtdXN0V3JhcCA9IHRydWU7XG4gICAgICBidWlsZGVyLnBvcyArPSB0ZXh0Lmxlbmd0aDtcbiAgICB9IGVsc2Uge1xuICAgICAgdmFyIGNvbnRlbnQgPSBkb2N1bWVudC5jcmVhdGVEb2N1bWVudEZyYWdtZW50KCksIHBvcyA9IDA7XG4gICAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgICBzcGVjaWFsLmxhc3RJbmRleCA9IHBvcztcbiAgICAgICAgdmFyIG0gPSBzcGVjaWFsLmV4ZWModGV4dCk7XG4gICAgICAgIHZhciBza2lwcGVkID0gbSA/IG0uaW5kZXggLSBwb3MgOiB0ZXh0Lmxlbmd0aCAtIHBvcztcbiAgICAgICAgaWYgKHNraXBwZWQpIHtcbiAgICAgICAgICB2YXIgdHh0ID0gZG9jdW1lbnQuY3JlYXRlVGV4dE5vZGUoZGlzcGxheVRleHQuc2xpY2UocG9zLCBwb3MgKyBza2lwcGVkKSk7XG4gICAgICAgICAgaWYgKGllICYmIGllX3ZlcnNpb24gPCA5KSBjb250ZW50LmFwcGVuZENoaWxkKGVsdChcInNwYW5cIiwgW3R4dF0pKTtcbiAgICAgICAgICBlbHNlIGNvbnRlbnQuYXBwZW5kQ2hpbGQodHh0KTtcbiAgICAgICAgICBidWlsZGVyLm1hcC5wdXNoKGJ1aWxkZXIucG9zLCBidWlsZGVyLnBvcyArIHNraXBwZWQsIHR4dCk7XG4gICAgICAgICAgYnVpbGRlci5jb2wgKz0gc2tpcHBlZDtcbiAgICAgICAgICBidWlsZGVyLnBvcyArPSBza2lwcGVkO1xuICAgICAgICB9XG4gICAgICAgIGlmICghbSkgYnJlYWs7XG4gICAgICAgIHBvcyArPSBza2lwcGVkICsgMTtcbiAgICAgICAgaWYgKG1bMF0gPT0gXCJcXHRcIikge1xuICAgICAgICAgIHZhciB0YWJTaXplID0gYnVpbGRlci5jbS5vcHRpb25zLnRhYlNpemUsIHRhYldpZHRoID0gdGFiU2l6ZSAtIGJ1aWxkZXIuY29sICUgdGFiU2l6ZTtcbiAgICAgICAgICB2YXIgdHh0ID0gY29udGVudC5hcHBlbmRDaGlsZChlbHQoXCJzcGFuXCIsIHNwYWNlU3RyKHRhYldpZHRoKSwgXCJjbS10YWJcIikpO1xuICAgICAgICAgIHR4dC5zZXRBdHRyaWJ1dGUoXCJyb2xlXCIsIFwicHJlc2VudGF0aW9uXCIpO1xuICAgICAgICAgIHR4dC5zZXRBdHRyaWJ1dGUoXCJjbS10ZXh0XCIsIFwiXFx0XCIpO1xuICAgICAgICAgIGJ1aWxkZXIuY29sICs9IHRhYldpZHRoO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHZhciB0eHQgPSBidWlsZGVyLmNtLm9wdGlvbnMuc3BlY2lhbENoYXJQbGFjZWhvbGRlcihtWzBdKTtcbiAgICAgICAgICB0eHQuc2V0QXR0cmlidXRlKFwiY20tdGV4dFwiLCBtWzBdKTtcbiAgICAgICAgICBpZiAoaWUgJiYgaWVfdmVyc2lvbiA8IDkpIGNvbnRlbnQuYXBwZW5kQ2hpbGQoZWx0KFwic3BhblwiLCBbdHh0XSkpO1xuICAgICAgICAgIGVsc2UgY29udGVudC5hcHBlbmRDaGlsZCh0eHQpO1xuICAgICAgICAgIGJ1aWxkZXIuY29sICs9IDE7XG4gICAgICAgIH1cbiAgICAgICAgYnVpbGRlci5tYXAucHVzaChidWlsZGVyLnBvcywgYnVpbGRlci5wb3MgKyAxLCB0eHQpO1xuICAgICAgICBidWlsZGVyLnBvcysrO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAoc3R5bGUgfHwgc3RhcnRTdHlsZSB8fCBlbmRTdHlsZSB8fCBtdXN0V3JhcCB8fCBjc3MpIHtcbiAgICAgIHZhciBmdWxsU3R5bGUgPSBzdHlsZSB8fCBcIlwiO1xuICAgICAgaWYgKHN0YXJ0U3R5bGUpIGZ1bGxTdHlsZSArPSBzdGFydFN0eWxlO1xuICAgICAgaWYgKGVuZFN0eWxlKSBmdWxsU3R5bGUgKz0gZW5kU3R5bGU7XG4gICAgICB2YXIgdG9rZW4gPSBlbHQoXCJzcGFuXCIsIFtjb250ZW50XSwgZnVsbFN0eWxlLCBjc3MpO1xuICAgICAgaWYgKHRpdGxlKSB0b2tlbi50aXRsZSA9IHRpdGxlO1xuICAgICAgcmV0dXJuIGJ1aWxkZXIuY29udGVudC5hcHBlbmRDaGlsZCh0b2tlbik7XG4gICAgfVxuICAgIGJ1aWxkZXIuY29udGVudC5hcHBlbmRDaGlsZChjb250ZW50KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHNwbGl0U3BhY2VzKG9sZCkge1xuICAgIHZhciBvdXQgPSBcIiBcIjtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IG9sZC5sZW5ndGggLSAyOyArK2kpIG91dCArPSBpICUgMiA/IFwiIFwiIDogXCJcXHUwMGEwXCI7XG4gICAgb3V0ICs9IFwiIFwiO1xuICAgIHJldHVybiBvdXQ7XG4gIH1cblxuICAvLyBXb3JrIGFyb3VuZCBub25zZW5zZSBkaW1lbnNpb25zIGJlaW5nIHJlcG9ydGVkIGZvciBzdHJldGNoZXMgb2ZcbiAgLy8gcmlnaHQtdG8tbGVmdCB0ZXh0LlxuICBmdW5jdGlvbiBidWlsZFRva2VuQmFkQmlkaShpbm5lciwgb3JkZXIpIHtcbiAgICByZXR1cm4gZnVuY3Rpb24oYnVpbGRlciwgdGV4dCwgc3R5bGUsIHN0YXJ0U3R5bGUsIGVuZFN0eWxlLCB0aXRsZSwgY3NzKSB7XG4gICAgICBzdHlsZSA9IHN0eWxlID8gc3R5bGUgKyBcIiBjbS1mb3JjZS1ib3JkZXJcIiA6IFwiY20tZm9yY2UtYm9yZGVyXCI7XG4gICAgICB2YXIgc3RhcnQgPSBidWlsZGVyLnBvcywgZW5kID0gc3RhcnQgKyB0ZXh0Lmxlbmd0aDtcbiAgICAgIGZvciAoOzspIHtcbiAgICAgICAgLy8gRmluZCB0aGUgcGFydCB0aGF0IG92ZXJsYXBzIHdpdGggdGhlIHN0YXJ0IG9mIHRoaXMgdGV4dFxuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IG9yZGVyLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgdmFyIHBhcnQgPSBvcmRlcltpXTtcbiAgICAgICAgICBpZiAocGFydC50byA+IHN0YXJ0ICYmIHBhcnQuZnJvbSA8PSBzdGFydCkgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHBhcnQudG8gPj0gZW5kKSByZXR1cm4gaW5uZXIoYnVpbGRlciwgdGV4dCwgc3R5bGUsIHN0YXJ0U3R5bGUsIGVuZFN0eWxlLCB0aXRsZSwgY3NzKTtcbiAgICAgICAgaW5uZXIoYnVpbGRlciwgdGV4dC5zbGljZSgwLCBwYXJ0LnRvIC0gc3RhcnQpLCBzdHlsZSwgc3RhcnRTdHlsZSwgbnVsbCwgdGl0bGUsIGNzcyk7XG4gICAgICAgIHN0YXJ0U3R5bGUgPSBudWxsO1xuICAgICAgICB0ZXh0ID0gdGV4dC5zbGljZShwYXJ0LnRvIC0gc3RhcnQpO1xuICAgICAgICBzdGFydCA9IHBhcnQudG87XG4gICAgICB9XG4gICAgfTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGJ1aWxkQ29sbGFwc2VkU3BhbihidWlsZGVyLCBzaXplLCBtYXJrZXIsIGlnbm9yZVdpZGdldCkge1xuICAgIHZhciB3aWRnZXQgPSAhaWdub3JlV2lkZ2V0ICYmIG1hcmtlci53aWRnZXROb2RlO1xuICAgIGlmICh3aWRnZXQpIGJ1aWxkZXIubWFwLnB1c2goYnVpbGRlci5wb3MsIGJ1aWxkZXIucG9zICsgc2l6ZSwgd2lkZ2V0KTtcbiAgICBpZiAoIWlnbm9yZVdpZGdldCAmJiBidWlsZGVyLmNtLmRpc3BsYXkuaW5wdXQubmVlZHNDb250ZW50QXR0cmlidXRlKSB7XG4gICAgICBpZiAoIXdpZGdldClcbiAgICAgICAgd2lkZ2V0ID0gYnVpbGRlci5jb250ZW50LmFwcGVuZENoaWxkKGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpKTtcbiAgICAgIHdpZGdldC5zZXRBdHRyaWJ1dGUoXCJjbS1tYXJrZXJcIiwgbWFya2VyLmlkKTtcbiAgICB9XG4gICAgaWYgKHdpZGdldCkge1xuICAgICAgYnVpbGRlci5jbS5kaXNwbGF5LmlucHV0LnNldFVuZWRpdGFibGUod2lkZ2V0KTtcbiAgICAgIGJ1aWxkZXIuY29udGVudC5hcHBlbmRDaGlsZCh3aWRnZXQpO1xuICAgIH1cbiAgICBidWlsZGVyLnBvcyArPSBzaXplO1xuICB9XG5cbiAgLy8gT3V0cHV0cyBhIG51bWJlciBvZiBzcGFucyB0byBtYWtlIHVwIGEgbGluZSwgdGFraW5nIGhpZ2hsaWdodGluZ1xuICAvLyBhbmQgbWFya2VkIHRleHQgaW50byBhY2NvdW50LlxuICBmdW5jdGlvbiBpbnNlcnRMaW5lQ29udGVudChsaW5lLCBidWlsZGVyLCBzdHlsZXMpIHtcbiAgICB2YXIgc3BhbnMgPSBsaW5lLm1hcmtlZFNwYW5zLCBhbGxUZXh0ID0gbGluZS50ZXh0LCBhdCA9IDA7XG4gICAgaWYgKCFzcGFucykge1xuICAgICAgZm9yICh2YXIgaSA9IDE7IGkgPCBzdHlsZXMubGVuZ3RoOyBpKz0yKVxuICAgICAgICBidWlsZGVyLmFkZFRva2VuKGJ1aWxkZXIsIGFsbFRleHQuc2xpY2UoYXQsIGF0ID0gc3R5bGVzW2ldKSwgaW50ZXJwcmV0VG9rZW5TdHlsZShzdHlsZXNbaSsxXSwgYnVpbGRlci5jbS5vcHRpb25zKSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIGxlbiA9IGFsbFRleHQubGVuZ3RoLCBwb3MgPSAwLCBpID0gMSwgdGV4dCA9IFwiXCIsIHN0eWxlLCBjc3M7XG4gICAgdmFyIG5leHRDaGFuZ2UgPSAwLCBzcGFuU3R5bGUsIHNwYW5FbmRTdHlsZSwgc3BhblN0YXJ0U3R5bGUsIHRpdGxlLCBjb2xsYXBzZWQ7XG4gICAgZm9yICg7Oykge1xuICAgICAgaWYgKG5leHRDaGFuZ2UgPT0gcG9zKSB7IC8vIFVwZGF0ZSBjdXJyZW50IG1hcmtlciBzZXRcbiAgICAgICAgc3BhblN0eWxlID0gc3BhbkVuZFN0eWxlID0gc3BhblN0YXJ0U3R5bGUgPSB0aXRsZSA9IGNzcyA9IFwiXCI7XG4gICAgICAgIGNvbGxhcHNlZCA9IG51bGw7IG5leHRDaGFuZ2UgPSBJbmZpbml0eTtcbiAgICAgICAgdmFyIGZvdW5kQm9va21hcmtzID0gW107XG4gICAgICAgIGZvciAodmFyIGogPSAwOyBqIDwgc3BhbnMubGVuZ3RoOyArK2opIHtcbiAgICAgICAgICB2YXIgc3AgPSBzcGFuc1tqXSwgbSA9IHNwLm1hcmtlcjtcbiAgICAgICAgICBpZiAobS50eXBlID09IFwiYm9va21hcmtcIiAmJiBzcC5mcm9tID09IHBvcyAmJiBtLndpZGdldE5vZGUpIHtcbiAgICAgICAgICAgIGZvdW5kQm9va21hcmtzLnB1c2gobSk7XG4gICAgICAgICAgfSBlbHNlIGlmIChzcC5mcm9tIDw9IHBvcyAmJiAoc3AudG8gPT0gbnVsbCB8fCBzcC50byA+IHBvcyB8fCBtLmNvbGxhcHNlZCAmJiBzcC50byA9PSBwb3MgJiYgc3AuZnJvbSA9PSBwb3MpKSB7XG4gICAgICAgICAgICBpZiAoc3AudG8gIT0gbnVsbCAmJiBzcC50byAhPSBwb3MgJiYgbmV4dENoYW5nZSA+IHNwLnRvKSB7XG4gICAgICAgICAgICAgIG5leHRDaGFuZ2UgPSBzcC50bztcbiAgICAgICAgICAgICAgc3BhbkVuZFN0eWxlID0gXCJcIjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChtLmNsYXNzTmFtZSkgc3BhblN0eWxlICs9IFwiIFwiICsgbS5jbGFzc05hbWU7XG4gICAgICAgICAgICBpZiAobS5jc3MpIGNzcyA9IG0uY3NzO1xuICAgICAgICAgICAgaWYgKG0uc3RhcnRTdHlsZSAmJiBzcC5mcm9tID09IHBvcykgc3BhblN0YXJ0U3R5bGUgKz0gXCIgXCIgKyBtLnN0YXJ0U3R5bGU7XG4gICAgICAgICAgICBpZiAobS5lbmRTdHlsZSAmJiBzcC50byA9PSBuZXh0Q2hhbmdlKSBzcGFuRW5kU3R5bGUgKz0gXCIgXCIgKyBtLmVuZFN0eWxlO1xuICAgICAgICAgICAgaWYgKG0udGl0bGUgJiYgIXRpdGxlKSB0aXRsZSA9IG0udGl0bGU7XG4gICAgICAgICAgICBpZiAobS5jb2xsYXBzZWQgJiYgKCFjb2xsYXBzZWQgfHwgY29tcGFyZUNvbGxhcHNlZE1hcmtlcnMoY29sbGFwc2VkLm1hcmtlciwgbSkgPCAwKSlcbiAgICAgICAgICAgICAgY29sbGFwc2VkID0gc3A7XG4gICAgICAgICAgfSBlbHNlIGlmIChzcC5mcm9tID4gcG9zICYmIG5leHRDaGFuZ2UgPiBzcC5mcm9tKSB7XG4gICAgICAgICAgICBuZXh0Q2hhbmdlID0gc3AuZnJvbTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGNvbGxhcHNlZCAmJiAoY29sbGFwc2VkLmZyb20gfHwgMCkgPT0gcG9zKSB7XG4gICAgICAgICAgYnVpbGRDb2xsYXBzZWRTcGFuKGJ1aWxkZXIsIChjb2xsYXBzZWQudG8gPT0gbnVsbCA/IGxlbiArIDEgOiBjb2xsYXBzZWQudG8pIC0gcG9zLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb2xsYXBzZWQubWFya2VyLCBjb2xsYXBzZWQuZnJvbSA9PSBudWxsKTtcbiAgICAgICAgICBpZiAoY29sbGFwc2VkLnRvID09IG51bGwpIHJldHVybjtcbiAgICAgICAgICBpZiAoY29sbGFwc2VkLnRvID09IHBvcykgY29sbGFwc2VkID0gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFjb2xsYXBzZWQgJiYgZm91bmRCb29rbWFya3MubGVuZ3RoKSBmb3IgKHZhciBqID0gMDsgaiA8IGZvdW5kQm9va21hcmtzLmxlbmd0aDsgKytqKVxuICAgICAgICAgIGJ1aWxkQ29sbGFwc2VkU3BhbihidWlsZGVyLCAwLCBmb3VuZEJvb2ttYXJrc1tqXSk7XG4gICAgICB9XG4gICAgICBpZiAocG9zID49IGxlbikgYnJlYWs7XG5cbiAgICAgIHZhciB1cHRvID0gTWF0aC5taW4obGVuLCBuZXh0Q2hhbmdlKTtcbiAgICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICAgIGlmICh0ZXh0KSB7XG4gICAgICAgICAgdmFyIGVuZCA9IHBvcyArIHRleHQubGVuZ3RoO1xuICAgICAgICAgIGlmICghY29sbGFwc2VkKSB7XG4gICAgICAgICAgICB2YXIgdG9rZW5UZXh0ID0gZW5kID4gdXB0byA/IHRleHQuc2xpY2UoMCwgdXB0byAtIHBvcykgOiB0ZXh0O1xuICAgICAgICAgICAgYnVpbGRlci5hZGRUb2tlbihidWlsZGVyLCB0b2tlblRleHQsIHN0eWxlID8gc3R5bGUgKyBzcGFuU3R5bGUgOiBzcGFuU3R5bGUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNwYW5TdGFydFN0eWxlLCBwb3MgKyB0b2tlblRleHQubGVuZ3RoID09IG5leHRDaGFuZ2UgPyBzcGFuRW5kU3R5bGUgOiBcIlwiLCB0aXRsZSwgY3NzKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKGVuZCA+PSB1cHRvKSB7dGV4dCA9IHRleHQuc2xpY2UodXB0byAtIHBvcyk7IHBvcyA9IHVwdG87IGJyZWFrO31cbiAgICAgICAgICBwb3MgPSBlbmQ7XG4gICAgICAgICAgc3BhblN0YXJ0U3R5bGUgPSBcIlwiO1xuICAgICAgICB9XG4gICAgICAgIHRleHQgPSBhbGxUZXh0LnNsaWNlKGF0LCBhdCA9IHN0eWxlc1tpKytdKTtcbiAgICAgICAgc3R5bGUgPSBpbnRlcnByZXRUb2tlblN0eWxlKHN0eWxlc1tpKytdLCBidWlsZGVyLmNtLm9wdGlvbnMpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIERPQ1VNRU5UIERBVEEgU1RSVUNUVVJFXG5cbiAgLy8gQnkgZGVmYXVsdCwgdXBkYXRlcyB0aGF0IHN0YXJ0IGFuZCBlbmQgYXQgdGhlIGJlZ2lubmluZyBvZiBhIGxpbmVcbiAgLy8gYXJlIHRyZWF0ZWQgc3BlY2lhbGx5LCBpbiBvcmRlciB0byBtYWtlIHRoZSBhc3NvY2lhdGlvbiBvZiBsaW5lXG4gIC8vIHdpZGdldHMgYW5kIG1hcmtlciBlbGVtZW50cyB3aXRoIHRoZSB0ZXh0IGJlaGF2ZSBtb3JlIGludHVpdGl2ZS5cbiAgZnVuY3Rpb24gaXNXaG9sZUxpbmVVcGRhdGUoZG9jLCBjaGFuZ2UpIHtcbiAgICByZXR1cm4gY2hhbmdlLmZyb20uY2ggPT0gMCAmJiBjaGFuZ2UudG8uY2ggPT0gMCAmJiBsc3QoY2hhbmdlLnRleHQpID09IFwiXCIgJiZcbiAgICAgICghZG9jLmNtIHx8IGRvYy5jbS5vcHRpb25zLndob2xlTGluZVVwZGF0ZUJlZm9yZSk7XG4gIH1cblxuICAvLyBQZXJmb3JtIGEgY2hhbmdlIG9uIHRoZSBkb2N1bWVudCBkYXRhIHN0cnVjdHVyZS5cbiAgZnVuY3Rpb24gdXBkYXRlRG9jKGRvYywgY2hhbmdlLCBtYXJrZWRTcGFucywgZXN0aW1hdGVIZWlnaHQpIHtcbiAgICBmdW5jdGlvbiBzcGFuc0ZvcihuKSB7cmV0dXJuIG1hcmtlZFNwYW5zID8gbWFya2VkU3BhbnNbbl0gOiBudWxsO31cbiAgICBmdW5jdGlvbiB1cGRhdGUobGluZSwgdGV4dCwgc3BhbnMpIHtcbiAgICAgIHVwZGF0ZUxpbmUobGluZSwgdGV4dCwgc3BhbnMsIGVzdGltYXRlSGVpZ2h0KTtcbiAgICAgIHNpZ25hbExhdGVyKGxpbmUsIFwiY2hhbmdlXCIsIGxpbmUsIGNoYW5nZSk7XG4gICAgfVxuICAgIGZ1bmN0aW9uIGxpbmVzRm9yKHN0YXJ0LCBlbmQpIHtcbiAgICAgIGZvciAodmFyIGkgPSBzdGFydCwgcmVzdWx0ID0gW107IGkgPCBlbmQ7ICsraSlcbiAgICAgICAgcmVzdWx0LnB1c2gobmV3IExpbmUodGV4dFtpXSwgc3BhbnNGb3IoaSksIGVzdGltYXRlSGVpZ2h0KSk7XG4gICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cblxuICAgIHZhciBmcm9tID0gY2hhbmdlLmZyb20sIHRvID0gY2hhbmdlLnRvLCB0ZXh0ID0gY2hhbmdlLnRleHQ7XG4gICAgdmFyIGZpcnN0TGluZSA9IGdldExpbmUoZG9jLCBmcm9tLmxpbmUpLCBsYXN0TGluZSA9IGdldExpbmUoZG9jLCB0by5saW5lKTtcbiAgICB2YXIgbGFzdFRleHQgPSBsc3QodGV4dCksIGxhc3RTcGFucyA9IHNwYW5zRm9yKHRleHQubGVuZ3RoIC0gMSksIG5saW5lcyA9IHRvLmxpbmUgLSBmcm9tLmxpbmU7XG5cbiAgICAvLyBBZGp1c3QgdGhlIGxpbmUgc3RydWN0dXJlXG4gICAgaWYgKGNoYW5nZS5mdWxsKSB7XG4gICAgICBkb2MuaW5zZXJ0KDAsIGxpbmVzRm9yKDAsIHRleHQubGVuZ3RoKSk7XG4gICAgICBkb2MucmVtb3ZlKHRleHQubGVuZ3RoLCBkb2Muc2l6ZSAtIHRleHQubGVuZ3RoKTtcbiAgICB9IGVsc2UgaWYgKGlzV2hvbGVMaW5lVXBkYXRlKGRvYywgY2hhbmdlKSkge1xuICAgICAgLy8gVGhpcyBpcyBhIHdob2xlLWxpbmUgcmVwbGFjZS4gVHJlYXRlZCBzcGVjaWFsbHkgdG8gbWFrZVxuICAgICAgLy8gc3VyZSBsaW5lIG9iamVjdHMgbW92ZSB0aGUgd2F5IHRoZXkgYXJlIHN1cHBvc2VkIHRvLlxuICAgICAgdmFyIGFkZGVkID0gbGluZXNGb3IoMCwgdGV4dC5sZW5ndGggLSAxKTtcbiAgICAgIHVwZGF0ZShsYXN0TGluZSwgbGFzdExpbmUudGV4dCwgbGFzdFNwYW5zKTtcbiAgICAgIGlmIChubGluZXMpIGRvYy5yZW1vdmUoZnJvbS5saW5lLCBubGluZXMpO1xuICAgICAgaWYgKGFkZGVkLmxlbmd0aCkgZG9jLmluc2VydChmcm9tLmxpbmUsIGFkZGVkKTtcbiAgICB9IGVsc2UgaWYgKGZpcnN0TGluZSA9PSBsYXN0TGluZSkge1xuICAgICAgaWYgKHRleHQubGVuZ3RoID09IDEpIHtcbiAgICAgICAgdXBkYXRlKGZpcnN0TGluZSwgZmlyc3RMaW5lLnRleHQuc2xpY2UoMCwgZnJvbS5jaCkgKyBsYXN0VGV4dCArIGZpcnN0TGluZS50ZXh0LnNsaWNlKHRvLmNoKSwgbGFzdFNwYW5zKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHZhciBhZGRlZCA9IGxpbmVzRm9yKDEsIHRleHQubGVuZ3RoIC0gMSk7XG4gICAgICAgIGFkZGVkLnB1c2gobmV3IExpbmUobGFzdFRleHQgKyBmaXJzdExpbmUudGV4dC5zbGljZSh0by5jaCksIGxhc3RTcGFucywgZXN0aW1hdGVIZWlnaHQpKTtcbiAgICAgICAgdXBkYXRlKGZpcnN0TGluZSwgZmlyc3RMaW5lLnRleHQuc2xpY2UoMCwgZnJvbS5jaCkgKyB0ZXh0WzBdLCBzcGFuc0ZvcigwKSk7XG4gICAgICAgIGRvYy5pbnNlcnQoZnJvbS5saW5lICsgMSwgYWRkZWQpO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAodGV4dC5sZW5ndGggPT0gMSkge1xuICAgICAgdXBkYXRlKGZpcnN0TGluZSwgZmlyc3RMaW5lLnRleHQuc2xpY2UoMCwgZnJvbS5jaCkgKyB0ZXh0WzBdICsgbGFzdExpbmUudGV4dC5zbGljZSh0by5jaCksIHNwYW5zRm9yKDApKTtcbiAgICAgIGRvYy5yZW1vdmUoZnJvbS5saW5lICsgMSwgbmxpbmVzKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdXBkYXRlKGZpcnN0TGluZSwgZmlyc3RMaW5lLnRleHQuc2xpY2UoMCwgZnJvbS5jaCkgKyB0ZXh0WzBdLCBzcGFuc0ZvcigwKSk7XG4gICAgICB1cGRhdGUobGFzdExpbmUsIGxhc3RUZXh0ICsgbGFzdExpbmUudGV4dC5zbGljZSh0by5jaCksIGxhc3RTcGFucyk7XG4gICAgICB2YXIgYWRkZWQgPSBsaW5lc0ZvcigxLCB0ZXh0Lmxlbmd0aCAtIDEpO1xuICAgICAgaWYgKG5saW5lcyA+IDEpIGRvYy5yZW1vdmUoZnJvbS5saW5lICsgMSwgbmxpbmVzIC0gMSk7XG4gICAgICBkb2MuaW5zZXJ0KGZyb20ubGluZSArIDEsIGFkZGVkKTtcbiAgICB9XG5cbiAgICBzaWduYWxMYXRlcihkb2MsIFwiY2hhbmdlXCIsIGRvYywgY2hhbmdlKTtcbiAgfVxuXG4gIC8vIFRoZSBkb2N1bWVudCBpcyByZXByZXNlbnRlZCBhcyBhIEJUcmVlIGNvbnNpc3Rpbmcgb2YgbGVhdmVzLCB3aXRoXG4gIC8vIGNodW5rIG9mIGxpbmVzIGluIHRoZW0sIGFuZCBicmFuY2hlcywgd2l0aCB1cCB0byB0ZW4gbGVhdmVzIG9yXG4gIC8vIG90aGVyIGJyYW5jaCBub2RlcyBiZWxvdyB0aGVtLiBUaGUgdG9wIG5vZGUgaXMgYWx3YXlzIGEgYnJhbmNoXG4gIC8vIG5vZGUsIGFuZCBpcyB0aGUgZG9jdW1lbnQgb2JqZWN0IGl0c2VsZiAobWVhbmluZyBpdCBoYXNcbiAgLy8gYWRkaXRpb25hbCBtZXRob2RzIGFuZCBwcm9wZXJ0aWVzKS5cbiAgLy9cbiAgLy8gQWxsIG5vZGVzIGhhdmUgcGFyZW50IGxpbmtzLiBUaGUgdHJlZSBpcyB1c2VkIGJvdGggdG8gZ28gZnJvbVxuICAvLyBsaW5lIG51bWJlcnMgdG8gbGluZSBvYmplY3RzLCBhbmQgdG8gZ28gZnJvbSBvYmplY3RzIHRvIG51bWJlcnMuXG4gIC8vIEl0IGFsc28gaW5kZXhlcyBieSBoZWlnaHQsIGFuZCBpcyB1c2VkIHRvIGNvbnZlcnQgYmV0d2VlbiBoZWlnaHRcbiAgLy8gYW5kIGxpbmUgb2JqZWN0LCBhbmQgdG8gZmluZCB0aGUgdG90YWwgaGVpZ2h0IG9mIHRoZSBkb2N1bWVudC5cbiAgLy9cbiAgLy8gU2VlIGFsc28gaHR0cDovL21hcmlqbmhhdmVyYmVrZS5ubC9ibG9nL2NvZGVtaXJyb3ItbGluZS10cmVlLmh0bWxcblxuICBmdW5jdGlvbiBMZWFmQ2h1bmsobGluZXMpIHtcbiAgICB0aGlzLmxpbmVzID0gbGluZXM7XG4gICAgdGhpcy5wYXJlbnQgPSBudWxsO1xuICAgIGZvciAodmFyIGkgPSAwLCBoZWlnaHQgPSAwOyBpIDwgbGluZXMubGVuZ3RoOyArK2kpIHtcbiAgICAgIGxpbmVzW2ldLnBhcmVudCA9IHRoaXM7XG4gICAgICBoZWlnaHQgKz0gbGluZXNbaV0uaGVpZ2h0O1xuICAgIH1cbiAgICB0aGlzLmhlaWdodCA9IGhlaWdodDtcbiAgfVxuXG4gIExlYWZDaHVuay5wcm90b3R5cGUgPSB7XG4gICAgY2h1bmtTaXplOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMubGluZXMubGVuZ3RoOyB9LFxuICAgIC8vIFJlbW92ZSB0aGUgbiBsaW5lcyBhdCBvZmZzZXQgJ2F0Jy5cbiAgICByZW1vdmVJbm5lcjogZnVuY3Rpb24oYXQsIG4pIHtcbiAgICAgIGZvciAodmFyIGkgPSBhdCwgZSA9IGF0ICsgbjsgaSA8IGU7ICsraSkge1xuICAgICAgICB2YXIgbGluZSA9IHRoaXMubGluZXNbaV07XG4gICAgICAgIHRoaXMuaGVpZ2h0IC09IGxpbmUuaGVpZ2h0O1xuICAgICAgICBjbGVhblVwTGluZShsaW5lKTtcbiAgICAgICAgc2lnbmFsTGF0ZXIobGluZSwgXCJkZWxldGVcIik7XG4gICAgICB9XG4gICAgICB0aGlzLmxpbmVzLnNwbGljZShhdCwgbik7XG4gICAgfSxcbiAgICAvLyBIZWxwZXIgdXNlZCB0byBjb2xsYXBzZSBhIHNtYWxsIGJyYW5jaCBpbnRvIGEgc2luZ2xlIGxlYWYuXG4gICAgY29sbGFwc2U6IGZ1bmN0aW9uKGxpbmVzKSB7XG4gICAgICBsaW5lcy5wdXNoLmFwcGx5KGxpbmVzLCB0aGlzLmxpbmVzKTtcbiAgICB9LFxuICAgIC8vIEluc2VydCB0aGUgZ2l2ZW4gYXJyYXkgb2YgbGluZXMgYXQgb2Zmc2V0ICdhdCcsIGNvdW50IHRoZW0gYXNcbiAgICAvLyBoYXZpbmcgdGhlIGdpdmVuIGhlaWdodC5cbiAgICBpbnNlcnRJbm5lcjogZnVuY3Rpb24oYXQsIGxpbmVzLCBoZWlnaHQpIHtcbiAgICAgIHRoaXMuaGVpZ2h0ICs9IGhlaWdodDtcbiAgICAgIHRoaXMubGluZXMgPSB0aGlzLmxpbmVzLnNsaWNlKDAsIGF0KS5jb25jYXQobGluZXMpLmNvbmNhdCh0aGlzLmxpbmVzLnNsaWNlKGF0KSk7XG4gICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxpbmVzLmxlbmd0aDsgKytpKSBsaW5lc1tpXS5wYXJlbnQgPSB0aGlzO1xuICAgIH0sXG4gICAgLy8gVXNlZCB0byBpdGVyYXRlIG92ZXIgYSBwYXJ0IG9mIHRoZSB0cmVlLlxuICAgIGl0ZXJOOiBmdW5jdGlvbihhdCwgbiwgb3ApIHtcbiAgICAgIGZvciAodmFyIGUgPSBhdCArIG47IGF0IDwgZTsgKythdClcbiAgICAgICAgaWYgKG9wKHRoaXMubGluZXNbYXRdKSkgcmV0dXJuIHRydWU7XG4gICAgfVxuICB9O1xuXG4gIGZ1bmN0aW9uIEJyYW5jaENodW5rKGNoaWxkcmVuKSB7XG4gICAgdGhpcy5jaGlsZHJlbiA9IGNoaWxkcmVuO1xuICAgIHZhciBzaXplID0gMCwgaGVpZ2h0ID0gMDtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGNoaWxkcmVuLmxlbmd0aDsgKytpKSB7XG4gICAgICB2YXIgY2ggPSBjaGlsZHJlbltpXTtcbiAgICAgIHNpemUgKz0gY2guY2h1bmtTaXplKCk7IGhlaWdodCArPSBjaC5oZWlnaHQ7XG4gICAgICBjaC5wYXJlbnQgPSB0aGlzO1xuICAgIH1cbiAgICB0aGlzLnNpemUgPSBzaXplO1xuICAgIHRoaXMuaGVpZ2h0ID0gaGVpZ2h0O1xuICAgIHRoaXMucGFyZW50ID0gbnVsbDtcbiAgfVxuXG4gIEJyYW5jaENodW5rLnByb3RvdHlwZSA9IHtcbiAgICBjaHVua1NpemU6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy5zaXplOyB9LFxuICAgIHJlbW92ZUlubmVyOiBmdW5jdGlvbihhdCwgbikge1xuICAgICAgdGhpcy5zaXplIC09IG47XG4gICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMuY2hpbGRyZW4ubGVuZ3RoOyArK2kpIHtcbiAgICAgICAgdmFyIGNoaWxkID0gdGhpcy5jaGlsZHJlbltpXSwgc3ogPSBjaGlsZC5jaHVua1NpemUoKTtcbiAgICAgICAgaWYgKGF0IDwgc3opIHtcbiAgICAgICAgICB2YXIgcm0gPSBNYXRoLm1pbihuLCBzeiAtIGF0KSwgb2xkSGVpZ2h0ID0gY2hpbGQuaGVpZ2h0O1xuICAgICAgICAgIGNoaWxkLnJlbW92ZUlubmVyKGF0LCBybSk7XG4gICAgICAgICAgdGhpcy5oZWlnaHQgLT0gb2xkSGVpZ2h0IC0gY2hpbGQuaGVpZ2h0O1xuICAgICAgICAgIGlmIChzeiA9PSBybSkgeyB0aGlzLmNoaWxkcmVuLnNwbGljZShpLS0sIDEpOyBjaGlsZC5wYXJlbnQgPSBudWxsOyB9XG4gICAgICAgICAgaWYgKChuIC09IHJtKSA9PSAwKSBicmVhaztcbiAgICAgICAgICBhdCA9IDA7XG4gICAgICAgIH0gZWxzZSBhdCAtPSBzejtcbiAgICAgIH1cbiAgICAgIC8vIElmIHRoZSByZXN1bHQgaXMgc21hbGxlciB0aGFuIDI1IGxpbmVzLCBlbnN1cmUgdGhhdCBpdCBpcyBhXG4gICAgICAvLyBzaW5nbGUgbGVhZiBub2RlLlxuICAgICAgaWYgKHRoaXMuc2l6ZSAtIG4gPCAyNSAmJlxuICAgICAgICAgICh0aGlzLmNoaWxkcmVuLmxlbmd0aCA+IDEgfHwgISh0aGlzLmNoaWxkcmVuWzBdIGluc3RhbmNlb2YgTGVhZkNodW5rKSkpIHtcbiAgICAgICAgdmFyIGxpbmVzID0gW107XG4gICAgICAgIHRoaXMuY29sbGFwc2UobGluZXMpO1xuICAgICAgICB0aGlzLmNoaWxkcmVuID0gW25ldyBMZWFmQ2h1bmsobGluZXMpXTtcbiAgICAgICAgdGhpcy5jaGlsZHJlblswXS5wYXJlbnQgPSB0aGlzO1xuICAgICAgfVxuICAgIH0sXG4gICAgY29sbGFwc2U6IGZ1bmN0aW9uKGxpbmVzKSB7XG4gICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMuY2hpbGRyZW4ubGVuZ3RoOyArK2kpIHRoaXMuY2hpbGRyZW5baV0uY29sbGFwc2UobGluZXMpO1xuICAgIH0sXG4gICAgaW5zZXJ0SW5uZXI6IGZ1bmN0aW9uKGF0LCBsaW5lcywgaGVpZ2h0KSB7XG4gICAgICB0aGlzLnNpemUgKz0gbGluZXMubGVuZ3RoO1xuICAgICAgdGhpcy5oZWlnaHQgKz0gaGVpZ2h0O1xuICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLmNoaWxkcmVuLmxlbmd0aDsgKytpKSB7XG4gICAgICAgIHZhciBjaGlsZCA9IHRoaXMuY2hpbGRyZW5baV0sIHN6ID0gY2hpbGQuY2h1bmtTaXplKCk7XG4gICAgICAgIGlmIChhdCA8PSBzeikge1xuICAgICAgICAgIGNoaWxkLmluc2VydElubmVyKGF0LCBsaW5lcywgaGVpZ2h0KTtcbiAgICAgICAgICBpZiAoY2hpbGQubGluZXMgJiYgY2hpbGQubGluZXMubGVuZ3RoID4gNTApIHtcbiAgICAgICAgICAgIHdoaWxlIChjaGlsZC5saW5lcy5sZW5ndGggPiA1MCkge1xuICAgICAgICAgICAgICB2YXIgc3BpbGxlZCA9IGNoaWxkLmxpbmVzLnNwbGljZShjaGlsZC5saW5lcy5sZW5ndGggLSAyNSwgMjUpO1xuICAgICAgICAgICAgICB2YXIgbmV3bGVhZiA9IG5ldyBMZWFmQ2h1bmsoc3BpbGxlZCk7XG4gICAgICAgICAgICAgIGNoaWxkLmhlaWdodCAtPSBuZXdsZWFmLmhlaWdodDtcbiAgICAgICAgICAgICAgdGhpcy5jaGlsZHJlbi5zcGxpY2UoaSArIDEsIDAsIG5ld2xlYWYpO1xuICAgICAgICAgICAgICBuZXdsZWFmLnBhcmVudCA9IHRoaXM7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0aGlzLm1heWJlU3BpbGwoKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgYXQgLT0gc3o7XG4gICAgICB9XG4gICAgfSxcbiAgICAvLyBXaGVuIGEgbm9kZSBoYXMgZ3Jvd24sIGNoZWNrIHdoZXRoZXIgaXQgc2hvdWxkIGJlIHNwbGl0LlxuICAgIG1heWJlU3BpbGw6IGZ1bmN0aW9uKCkge1xuICAgICAgaWYgKHRoaXMuY2hpbGRyZW4ubGVuZ3RoIDw9IDEwKSByZXR1cm47XG4gICAgICB2YXIgbWUgPSB0aGlzO1xuICAgICAgZG8ge1xuICAgICAgICB2YXIgc3BpbGxlZCA9IG1lLmNoaWxkcmVuLnNwbGljZShtZS5jaGlsZHJlbi5sZW5ndGggLSA1LCA1KTtcbiAgICAgICAgdmFyIHNpYmxpbmcgPSBuZXcgQnJhbmNoQ2h1bmsoc3BpbGxlZCk7XG4gICAgICAgIGlmICghbWUucGFyZW50KSB7IC8vIEJlY29tZSB0aGUgcGFyZW50IG5vZGVcbiAgICAgICAgICB2YXIgY29weSA9IG5ldyBCcmFuY2hDaHVuayhtZS5jaGlsZHJlbik7XG4gICAgICAgICAgY29weS5wYXJlbnQgPSBtZTtcbiAgICAgICAgICBtZS5jaGlsZHJlbiA9IFtjb3B5LCBzaWJsaW5nXTtcbiAgICAgICAgICBtZSA9IGNvcHk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgbWUuc2l6ZSAtPSBzaWJsaW5nLnNpemU7XG4gICAgICAgICAgbWUuaGVpZ2h0IC09IHNpYmxpbmcuaGVpZ2h0O1xuICAgICAgICAgIHZhciBteUluZGV4ID0gaW5kZXhPZihtZS5wYXJlbnQuY2hpbGRyZW4sIG1lKTtcbiAgICAgICAgICBtZS5wYXJlbnQuY2hpbGRyZW4uc3BsaWNlKG15SW5kZXggKyAxLCAwLCBzaWJsaW5nKTtcbiAgICAgICAgfVxuICAgICAgICBzaWJsaW5nLnBhcmVudCA9IG1lLnBhcmVudDtcbiAgICAgIH0gd2hpbGUgKG1lLmNoaWxkcmVuLmxlbmd0aCA+IDEwKTtcbiAgICAgIG1lLnBhcmVudC5tYXliZVNwaWxsKCk7XG4gICAgfSxcbiAgICBpdGVyTjogZnVuY3Rpb24oYXQsIG4sIG9wKSB7XG4gICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMuY2hpbGRyZW4ubGVuZ3RoOyArK2kpIHtcbiAgICAgICAgdmFyIGNoaWxkID0gdGhpcy5jaGlsZHJlbltpXSwgc3ogPSBjaGlsZC5jaHVua1NpemUoKTtcbiAgICAgICAgaWYgKGF0IDwgc3opIHtcbiAgICAgICAgICB2YXIgdXNlZCA9IE1hdGgubWluKG4sIHN6IC0gYXQpO1xuICAgICAgICAgIGlmIChjaGlsZC5pdGVyTihhdCwgdXNlZCwgb3ApKSByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICBpZiAoKG4gLT0gdXNlZCkgPT0gMCkgYnJlYWs7XG4gICAgICAgICAgYXQgPSAwO1xuICAgICAgICB9IGVsc2UgYXQgLT0gc3o7XG4gICAgICB9XG4gICAgfVxuICB9O1xuXG4gIHZhciBuZXh0RG9jSWQgPSAwO1xuICB2YXIgRG9jID0gQ29kZU1pcnJvci5Eb2MgPSBmdW5jdGlvbih0ZXh0LCBtb2RlLCBmaXJzdExpbmUpIHtcbiAgICBpZiAoISh0aGlzIGluc3RhbmNlb2YgRG9jKSkgcmV0dXJuIG5ldyBEb2ModGV4dCwgbW9kZSwgZmlyc3RMaW5lKTtcbiAgICBpZiAoZmlyc3RMaW5lID09IG51bGwpIGZpcnN0TGluZSA9IDA7XG5cbiAgICBCcmFuY2hDaHVuay5jYWxsKHRoaXMsIFtuZXcgTGVhZkNodW5rKFtuZXcgTGluZShcIlwiLCBudWxsKV0pXSk7XG4gICAgdGhpcy5maXJzdCA9IGZpcnN0TGluZTtcbiAgICB0aGlzLnNjcm9sbFRvcCA9IHRoaXMuc2Nyb2xsTGVmdCA9IDA7XG4gICAgdGhpcy5jYW50RWRpdCA9IGZhbHNlO1xuICAgIHRoaXMuY2xlYW5HZW5lcmF0aW9uID0gMTtcbiAgICB0aGlzLmZyb250aWVyID0gZmlyc3RMaW5lO1xuICAgIHZhciBzdGFydCA9IFBvcyhmaXJzdExpbmUsIDApO1xuICAgIHRoaXMuc2VsID0gc2ltcGxlU2VsZWN0aW9uKHN0YXJ0KTtcbiAgICB0aGlzLmhpc3RvcnkgPSBuZXcgSGlzdG9yeShudWxsKTtcbiAgICB0aGlzLmlkID0gKytuZXh0RG9jSWQ7XG4gICAgdGhpcy5tb2RlT3B0aW9uID0gbW9kZTtcblxuICAgIGlmICh0eXBlb2YgdGV4dCA9PSBcInN0cmluZ1wiKSB0ZXh0ID0gc3BsaXRMaW5lcyh0ZXh0KTtcbiAgICB1cGRhdGVEb2ModGhpcywge2Zyb206IHN0YXJ0LCB0bzogc3RhcnQsIHRleHQ6IHRleHR9KTtcbiAgICBzZXRTZWxlY3Rpb24odGhpcywgc2ltcGxlU2VsZWN0aW9uKHN0YXJ0KSwgc2VsX2RvbnRTY3JvbGwpO1xuICB9O1xuXG4gIERvYy5wcm90b3R5cGUgPSBjcmVhdGVPYmooQnJhbmNoQ2h1bmsucHJvdG90eXBlLCB7XG4gICAgY29uc3RydWN0b3I6IERvYyxcbiAgICAvLyBJdGVyYXRlIG92ZXIgdGhlIGRvY3VtZW50LiBTdXBwb3J0cyB0d28gZm9ybXMgLS0gd2l0aCBvbmx5IG9uZVxuICAgIC8vIGFyZ3VtZW50LCBpdCBjYWxscyB0aGF0IGZvciBlYWNoIGxpbmUgaW4gdGhlIGRvY3VtZW50LiBXaXRoXG4gICAgLy8gdGhyZWUsIGl0IGl0ZXJhdGVzIG92ZXIgdGhlIHJhbmdlIGdpdmVuIGJ5IHRoZSBmaXJzdCB0d28gKHdpdGhcbiAgICAvLyB0aGUgc2Vjb25kIGJlaW5nIG5vbi1pbmNsdXNpdmUpLlxuICAgIGl0ZXI6IGZ1bmN0aW9uKGZyb20sIHRvLCBvcCkge1xuICAgICAgaWYgKG9wKSB0aGlzLml0ZXJOKGZyb20gLSB0aGlzLmZpcnN0LCB0byAtIGZyb20sIG9wKTtcbiAgICAgIGVsc2UgdGhpcy5pdGVyTih0aGlzLmZpcnN0LCB0aGlzLmZpcnN0ICsgdGhpcy5zaXplLCBmcm9tKTtcbiAgICB9LFxuXG4gICAgLy8gTm9uLXB1YmxpYyBpbnRlcmZhY2UgZm9yIGFkZGluZyBhbmQgcmVtb3ZpbmcgbGluZXMuXG4gICAgaW5zZXJ0OiBmdW5jdGlvbihhdCwgbGluZXMpIHtcbiAgICAgIHZhciBoZWlnaHQgPSAwO1xuICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsaW5lcy5sZW5ndGg7ICsraSkgaGVpZ2h0ICs9IGxpbmVzW2ldLmhlaWdodDtcbiAgICAgIHRoaXMuaW5zZXJ0SW5uZXIoYXQgLSB0aGlzLmZpcnN0LCBsaW5lcywgaGVpZ2h0KTtcbiAgICB9LFxuICAgIHJlbW92ZTogZnVuY3Rpb24oYXQsIG4pIHsgdGhpcy5yZW1vdmVJbm5lcihhdCAtIHRoaXMuZmlyc3QsIG4pOyB9LFxuXG4gICAgLy8gRnJvbSBoZXJlLCB0aGUgbWV0aG9kcyBhcmUgcGFydCBvZiB0aGUgcHVibGljIGludGVyZmFjZS4gTW9zdFxuICAgIC8vIGFyZSBhbHNvIGF2YWlsYWJsZSBmcm9tIENvZGVNaXJyb3IgKGVkaXRvcikgaW5zdGFuY2VzLlxuXG4gICAgZ2V0VmFsdWU6IGZ1bmN0aW9uKGxpbmVTZXApIHtcbiAgICAgIHZhciBsaW5lcyA9IGdldExpbmVzKHRoaXMsIHRoaXMuZmlyc3QsIHRoaXMuZmlyc3QgKyB0aGlzLnNpemUpO1xuICAgICAgaWYgKGxpbmVTZXAgPT09IGZhbHNlKSByZXR1cm4gbGluZXM7XG4gICAgICByZXR1cm4gbGluZXMuam9pbihsaW5lU2VwIHx8IFwiXFxuXCIpO1xuICAgIH0sXG4gICAgc2V0VmFsdWU6IGRvY01ldGhvZE9wKGZ1bmN0aW9uKGNvZGUpIHtcbiAgICAgIHZhciB0b3AgPSBQb3ModGhpcy5maXJzdCwgMCksIGxhc3QgPSB0aGlzLmZpcnN0ICsgdGhpcy5zaXplIC0gMTtcbiAgICAgIG1ha2VDaGFuZ2UodGhpcywge2Zyb206IHRvcCwgdG86IFBvcyhsYXN0LCBnZXRMaW5lKHRoaXMsIGxhc3QpLnRleHQubGVuZ3RoKSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHRleHQ6IHNwbGl0TGluZXMoY29kZSksIG9yaWdpbjogXCJzZXRWYWx1ZVwiLCBmdWxsOiB0cnVlfSwgdHJ1ZSk7XG4gICAgICBzZXRTZWxlY3Rpb24odGhpcywgc2ltcGxlU2VsZWN0aW9uKHRvcCkpO1xuICAgIH0pLFxuICAgIHJlcGxhY2VSYW5nZTogZnVuY3Rpb24oY29kZSwgZnJvbSwgdG8sIG9yaWdpbikge1xuICAgICAgZnJvbSA9IGNsaXBQb3ModGhpcywgZnJvbSk7XG4gICAgICB0byA9IHRvID8gY2xpcFBvcyh0aGlzLCB0bykgOiBmcm9tO1xuICAgICAgcmVwbGFjZVJhbmdlKHRoaXMsIGNvZGUsIGZyb20sIHRvLCBvcmlnaW4pO1xuICAgIH0sXG4gICAgZ2V0UmFuZ2U6IGZ1bmN0aW9uKGZyb20sIHRvLCBsaW5lU2VwKSB7XG4gICAgICB2YXIgbGluZXMgPSBnZXRCZXR3ZWVuKHRoaXMsIGNsaXBQb3ModGhpcywgZnJvbSksIGNsaXBQb3ModGhpcywgdG8pKTtcbiAgICAgIGlmIChsaW5lU2VwID09PSBmYWxzZSkgcmV0dXJuIGxpbmVzO1xuICAgICAgcmV0dXJuIGxpbmVzLmpvaW4obGluZVNlcCB8fCBcIlxcblwiKTtcbiAgICB9LFxuXG4gICAgZ2V0TGluZTogZnVuY3Rpb24obGluZSkge3ZhciBsID0gdGhpcy5nZXRMaW5lSGFuZGxlKGxpbmUpOyByZXR1cm4gbCAmJiBsLnRleHQ7fSxcblxuICAgIGdldExpbmVIYW5kbGU6IGZ1bmN0aW9uKGxpbmUpIHtpZiAoaXNMaW5lKHRoaXMsIGxpbmUpKSByZXR1cm4gZ2V0TGluZSh0aGlzLCBsaW5lKTt9LFxuICAgIGdldExpbmVOdW1iZXI6IGZ1bmN0aW9uKGxpbmUpIHtyZXR1cm4gbGluZU5vKGxpbmUpO30sXG5cbiAgICBnZXRMaW5lSGFuZGxlVmlzdWFsU3RhcnQ6IGZ1bmN0aW9uKGxpbmUpIHtcbiAgICAgIGlmICh0eXBlb2YgbGluZSA9PSBcIm51bWJlclwiKSBsaW5lID0gZ2V0TGluZSh0aGlzLCBsaW5lKTtcbiAgICAgIHJldHVybiB2aXN1YWxMaW5lKGxpbmUpO1xuICAgIH0sXG5cbiAgICBsaW5lQ291bnQ6IGZ1bmN0aW9uKCkge3JldHVybiB0aGlzLnNpemU7fSxcbiAgICBmaXJzdExpbmU6IGZ1bmN0aW9uKCkge3JldHVybiB0aGlzLmZpcnN0O30sXG4gICAgbGFzdExpbmU6IGZ1bmN0aW9uKCkge3JldHVybiB0aGlzLmZpcnN0ICsgdGhpcy5zaXplIC0gMTt9LFxuXG4gICAgY2xpcFBvczogZnVuY3Rpb24ocG9zKSB7cmV0dXJuIGNsaXBQb3ModGhpcywgcG9zKTt9LFxuXG4gICAgZ2V0Q3Vyc29yOiBmdW5jdGlvbihzdGFydCkge1xuICAgICAgdmFyIHJhbmdlID0gdGhpcy5zZWwucHJpbWFyeSgpLCBwb3M7XG4gICAgICBpZiAoc3RhcnQgPT0gbnVsbCB8fCBzdGFydCA9PSBcImhlYWRcIikgcG9zID0gcmFuZ2UuaGVhZDtcbiAgICAgIGVsc2UgaWYgKHN0YXJ0ID09IFwiYW5jaG9yXCIpIHBvcyA9IHJhbmdlLmFuY2hvcjtcbiAgICAgIGVsc2UgaWYgKHN0YXJ0ID09IFwiZW5kXCIgfHwgc3RhcnQgPT0gXCJ0b1wiIHx8IHN0YXJ0ID09PSBmYWxzZSkgcG9zID0gcmFuZ2UudG8oKTtcbiAgICAgIGVsc2UgcG9zID0gcmFuZ2UuZnJvbSgpO1xuICAgICAgcmV0dXJuIHBvcztcbiAgICB9LFxuICAgIGxpc3RTZWxlY3Rpb25zOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMuc2VsLnJhbmdlczsgfSxcbiAgICBzb21ldGhpbmdTZWxlY3RlZDogZnVuY3Rpb24oKSB7cmV0dXJuIHRoaXMuc2VsLnNvbWV0aGluZ1NlbGVjdGVkKCk7fSxcblxuICAgIHNldEN1cnNvcjogZG9jTWV0aG9kT3AoZnVuY3Rpb24obGluZSwgY2gsIG9wdGlvbnMpIHtcbiAgICAgIHNldFNpbXBsZVNlbGVjdGlvbih0aGlzLCBjbGlwUG9zKHRoaXMsIHR5cGVvZiBsaW5lID09IFwibnVtYmVyXCIgPyBQb3MobGluZSwgY2ggfHwgMCkgOiBsaW5lKSwgbnVsbCwgb3B0aW9ucyk7XG4gICAgfSksXG4gICAgc2V0U2VsZWN0aW9uOiBkb2NNZXRob2RPcChmdW5jdGlvbihhbmNob3IsIGhlYWQsIG9wdGlvbnMpIHtcbiAgICAgIHNldFNpbXBsZVNlbGVjdGlvbih0aGlzLCBjbGlwUG9zKHRoaXMsIGFuY2hvciksIGNsaXBQb3ModGhpcywgaGVhZCB8fCBhbmNob3IpLCBvcHRpb25zKTtcbiAgICB9KSxcbiAgICBleHRlbmRTZWxlY3Rpb246IGRvY01ldGhvZE9wKGZ1bmN0aW9uKGhlYWQsIG90aGVyLCBvcHRpb25zKSB7XG4gICAgICBleHRlbmRTZWxlY3Rpb24odGhpcywgY2xpcFBvcyh0aGlzLCBoZWFkKSwgb3RoZXIgJiYgY2xpcFBvcyh0aGlzLCBvdGhlciksIG9wdGlvbnMpO1xuICAgIH0pLFxuICAgIGV4dGVuZFNlbGVjdGlvbnM6IGRvY01ldGhvZE9wKGZ1bmN0aW9uKGhlYWRzLCBvcHRpb25zKSB7XG4gICAgICBleHRlbmRTZWxlY3Rpb25zKHRoaXMsIGNsaXBQb3NBcnJheSh0aGlzLCBoZWFkcywgb3B0aW9ucykpO1xuICAgIH0pLFxuICAgIGV4dGVuZFNlbGVjdGlvbnNCeTogZG9jTWV0aG9kT3AoZnVuY3Rpb24oZiwgb3B0aW9ucykge1xuICAgICAgZXh0ZW5kU2VsZWN0aW9ucyh0aGlzLCBtYXAodGhpcy5zZWwucmFuZ2VzLCBmKSwgb3B0aW9ucyk7XG4gICAgfSksXG4gICAgc2V0U2VsZWN0aW9uczogZG9jTWV0aG9kT3AoZnVuY3Rpb24ocmFuZ2VzLCBwcmltYXJ5LCBvcHRpb25zKSB7XG4gICAgICBpZiAoIXJhbmdlcy5sZW5ndGgpIHJldHVybjtcbiAgICAgIGZvciAodmFyIGkgPSAwLCBvdXQgPSBbXTsgaSA8IHJhbmdlcy5sZW5ndGg7IGkrKylcbiAgICAgICAgb3V0W2ldID0gbmV3IFJhbmdlKGNsaXBQb3ModGhpcywgcmFuZ2VzW2ldLmFuY2hvciksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICBjbGlwUG9zKHRoaXMsIHJhbmdlc1tpXS5oZWFkKSk7XG4gICAgICBpZiAocHJpbWFyeSA9PSBudWxsKSBwcmltYXJ5ID0gTWF0aC5taW4ocmFuZ2VzLmxlbmd0aCAtIDEsIHRoaXMuc2VsLnByaW1JbmRleCk7XG4gICAgICBzZXRTZWxlY3Rpb24odGhpcywgbm9ybWFsaXplU2VsZWN0aW9uKG91dCwgcHJpbWFyeSksIG9wdGlvbnMpO1xuICAgIH0pLFxuICAgIGFkZFNlbGVjdGlvbjogZG9jTWV0aG9kT3AoZnVuY3Rpb24oYW5jaG9yLCBoZWFkLCBvcHRpb25zKSB7XG4gICAgICB2YXIgcmFuZ2VzID0gdGhpcy5zZWwucmFuZ2VzLnNsaWNlKDApO1xuICAgICAgcmFuZ2VzLnB1c2gobmV3IFJhbmdlKGNsaXBQb3ModGhpcywgYW5jaG9yKSwgY2xpcFBvcyh0aGlzLCBoZWFkIHx8IGFuY2hvcikpKTtcbiAgICAgIHNldFNlbGVjdGlvbih0aGlzLCBub3JtYWxpemVTZWxlY3Rpb24ocmFuZ2VzLCByYW5nZXMubGVuZ3RoIC0gMSksIG9wdGlvbnMpO1xuICAgIH0pLFxuXG4gICAgZ2V0U2VsZWN0aW9uOiBmdW5jdGlvbihsaW5lU2VwKSB7XG4gICAgICB2YXIgcmFuZ2VzID0gdGhpcy5zZWwucmFuZ2VzLCBsaW5lcztcbiAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcmFuZ2VzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIHZhciBzZWwgPSBnZXRCZXR3ZWVuKHRoaXMsIHJhbmdlc1tpXS5mcm9tKCksIHJhbmdlc1tpXS50bygpKTtcbiAgICAgICAgbGluZXMgPSBsaW5lcyA/IGxpbmVzLmNvbmNhdChzZWwpIDogc2VsO1xuICAgICAgfVxuICAgICAgaWYgKGxpbmVTZXAgPT09IGZhbHNlKSByZXR1cm4gbGluZXM7XG4gICAgICBlbHNlIHJldHVybiBsaW5lcy5qb2luKGxpbmVTZXAgfHwgXCJcXG5cIik7XG4gICAgfSxcbiAgICBnZXRTZWxlY3Rpb25zOiBmdW5jdGlvbihsaW5lU2VwKSB7XG4gICAgICB2YXIgcGFydHMgPSBbXSwgcmFuZ2VzID0gdGhpcy5zZWwucmFuZ2VzO1xuICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCByYW5nZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgdmFyIHNlbCA9IGdldEJldHdlZW4odGhpcywgcmFuZ2VzW2ldLmZyb20oKSwgcmFuZ2VzW2ldLnRvKCkpO1xuICAgICAgICBpZiAobGluZVNlcCAhPT0gZmFsc2UpIHNlbCA9IHNlbC5qb2luKGxpbmVTZXAgfHwgXCJcXG5cIik7XG4gICAgICAgIHBhcnRzW2ldID0gc2VsO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHBhcnRzO1xuICAgIH0sXG4gICAgcmVwbGFjZVNlbGVjdGlvbjogZnVuY3Rpb24oY29kZSwgY29sbGFwc2UsIG9yaWdpbikge1xuICAgICAgdmFyIGR1cCA9IFtdO1xuICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLnNlbC5yYW5nZXMubGVuZ3RoOyBpKyspXG4gICAgICAgIGR1cFtpXSA9IGNvZGU7XG4gICAgICB0aGlzLnJlcGxhY2VTZWxlY3Rpb25zKGR1cCwgY29sbGFwc2UsIG9yaWdpbiB8fCBcIitpbnB1dFwiKTtcbiAgICB9LFxuICAgIHJlcGxhY2VTZWxlY3Rpb25zOiBkb2NNZXRob2RPcChmdW5jdGlvbihjb2RlLCBjb2xsYXBzZSwgb3JpZ2luKSB7XG4gICAgICB2YXIgY2hhbmdlcyA9IFtdLCBzZWwgPSB0aGlzLnNlbDtcbiAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc2VsLnJhbmdlcy5sZW5ndGg7IGkrKykge1xuICAgICAgICB2YXIgcmFuZ2UgPSBzZWwucmFuZ2VzW2ldO1xuICAgICAgICBjaGFuZ2VzW2ldID0ge2Zyb206IHJhbmdlLmZyb20oKSwgdG86IHJhbmdlLnRvKCksIHRleHQ6IHNwbGl0TGluZXMoY29kZVtpXSksIG9yaWdpbjogb3JpZ2lufTtcbiAgICAgIH1cbiAgICAgIHZhciBuZXdTZWwgPSBjb2xsYXBzZSAmJiBjb2xsYXBzZSAhPSBcImVuZFwiICYmIGNvbXB1dGVSZXBsYWNlZFNlbCh0aGlzLCBjaGFuZ2VzLCBjb2xsYXBzZSk7XG4gICAgICBmb3IgKHZhciBpID0gY2hhbmdlcy5sZW5ndGggLSAxOyBpID49IDA7IGktLSlcbiAgICAgICAgbWFrZUNoYW5nZSh0aGlzLCBjaGFuZ2VzW2ldKTtcbiAgICAgIGlmIChuZXdTZWwpIHNldFNlbGVjdGlvblJlcGxhY2VIaXN0b3J5KHRoaXMsIG5ld1NlbCk7XG4gICAgICBlbHNlIGlmICh0aGlzLmNtKSBlbnN1cmVDdXJzb3JWaXNpYmxlKHRoaXMuY20pO1xuICAgIH0pLFxuICAgIHVuZG86IGRvY01ldGhvZE9wKGZ1bmN0aW9uKCkge21ha2VDaGFuZ2VGcm9tSGlzdG9yeSh0aGlzLCBcInVuZG9cIik7fSksXG4gICAgcmVkbzogZG9jTWV0aG9kT3AoZnVuY3Rpb24oKSB7bWFrZUNoYW5nZUZyb21IaXN0b3J5KHRoaXMsIFwicmVkb1wiKTt9KSxcbiAgICB1bmRvU2VsZWN0aW9uOiBkb2NNZXRob2RPcChmdW5jdGlvbigpIHttYWtlQ2hhbmdlRnJvbUhpc3RvcnkodGhpcywgXCJ1bmRvXCIsIHRydWUpO30pLFxuICAgIHJlZG9TZWxlY3Rpb246IGRvY01ldGhvZE9wKGZ1bmN0aW9uKCkge21ha2VDaGFuZ2VGcm9tSGlzdG9yeSh0aGlzLCBcInJlZG9cIiwgdHJ1ZSk7fSksXG5cbiAgICBzZXRFeHRlbmRpbmc6IGZ1bmN0aW9uKHZhbCkge3RoaXMuZXh0ZW5kID0gdmFsO30sXG4gICAgZ2V0RXh0ZW5kaW5nOiBmdW5jdGlvbigpIHtyZXR1cm4gdGhpcy5leHRlbmQ7fSxcblxuICAgIGhpc3RvcnlTaXplOiBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBoaXN0ID0gdGhpcy5oaXN0b3J5LCBkb25lID0gMCwgdW5kb25lID0gMDtcbiAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgaGlzdC5kb25lLmxlbmd0aDsgaSsrKSBpZiAoIWhpc3QuZG9uZVtpXS5yYW5nZXMpICsrZG9uZTtcbiAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgaGlzdC51bmRvbmUubGVuZ3RoOyBpKyspIGlmICghaGlzdC51bmRvbmVbaV0ucmFuZ2VzKSArK3VuZG9uZTtcbiAgICAgIHJldHVybiB7dW5kbzogZG9uZSwgcmVkbzogdW5kb25lfTtcbiAgICB9LFxuICAgIGNsZWFySGlzdG9yeTogZnVuY3Rpb24oKSB7dGhpcy5oaXN0b3J5ID0gbmV3IEhpc3RvcnkodGhpcy5oaXN0b3J5Lm1heEdlbmVyYXRpb24pO30sXG5cbiAgICBtYXJrQ2xlYW46IGZ1bmN0aW9uKCkge1xuICAgICAgdGhpcy5jbGVhbkdlbmVyYXRpb24gPSB0aGlzLmNoYW5nZUdlbmVyYXRpb24odHJ1ZSk7XG4gICAgfSxcbiAgICBjaGFuZ2VHZW5lcmF0aW9uOiBmdW5jdGlvbihmb3JjZVNwbGl0KSB7XG4gICAgICBpZiAoZm9yY2VTcGxpdClcbiAgICAgICAgdGhpcy5oaXN0b3J5Lmxhc3RPcCA9IHRoaXMuaGlzdG9yeS5sYXN0U2VsT3AgPSB0aGlzLmhpc3RvcnkubGFzdE9yaWdpbiA9IG51bGw7XG4gICAgICByZXR1cm4gdGhpcy5oaXN0b3J5LmdlbmVyYXRpb247XG4gICAgfSxcbiAgICBpc0NsZWFuOiBmdW5jdGlvbiAoZ2VuKSB7XG4gICAgICByZXR1cm4gdGhpcy5oaXN0b3J5LmdlbmVyYXRpb24gPT0gKGdlbiB8fCB0aGlzLmNsZWFuR2VuZXJhdGlvbik7XG4gICAgfSxcblxuICAgIGdldEhpc3Rvcnk6IGZ1bmN0aW9uKCkge1xuICAgICAgcmV0dXJuIHtkb25lOiBjb3B5SGlzdG9yeUFycmF5KHRoaXMuaGlzdG9yeS5kb25lKSxcbiAgICAgICAgICAgICAgdW5kb25lOiBjb3B5SGlzdG9yeUFycmF5KHRoaXMuaGlzdG9yeS51bmRvbmUpfTtcbiAgICB9LFxuICAgIHNldEhpc3Rvcnk6IGZ1bmN0aW9uKGhpc3REYXRhKSB7XG4gICAgICB2YXIgaGlzdCA9IHRoaXMuaGlzdG9yeSA9IG5ldyBIaXN0b3J5KHRoaXMuaGlzdG9yeS5tYXhHZW5lcmF0aW9uKTtcbiAgICAgIGhpc3QuZG9uZSA9IGNvcHlIaXN0b3J5QXJyYXkoaGlzdERhdGEuZG9uZS5zbGljZSgwKSwgbnVsbCwgdHJ1ZSk7XG4gICAgICBoaXN0LnVuZG9uZSA9IGNvcHlIaXN0b3J5QXJyYXkoaGlzdERhdGEudW5kb25lLnNsaWNlKDApLCBudWxsLCB0cnVlKTtcbiAgICB9LFxuXG4gICAgYWRkTGluZUNsYXNzOiBkb2NNZXRob2RPcChmdW5jdGlvbihoYW5kbGUsIHdoZXJlLCBjbHMpIHtcbiAgICAgIHJldHVybiBjaGFuZ2VMaW5lKHRoaXMsIGhhbmRsZSwgd2hlcmUgPT0gXCJndXR0ZXJcIiA/IFwiZ3V0dGVyXCIgOiBcImNsYXNzXCIsIGZ1bmN0aW9uKGxpbmUpIHtcbiAgICAgICAgdmFyIHByb3AgPSB3aGVyZSA9PSBcInRleHRcIiA/IFwidGV4dENsYXNzXCJcbiAgICAgICAgICAgICAgICAgOiB3aGVyZSA9PSBcImJhY2tncm91bmRcIiA/IFwiYmdDbGFzc1wiXG4gICAgICAgICAgICAgICAgIDogd2hlcmUgPT0gXCJndXR0ZXJcIiA/IFwiZ3V0dGVyQ2xhc3NcIiA6IFwid3JhcENsYXNzXCI7XG4gICAgICAgIGlmICghbGluZVtwcm9wXSkgbGluZVtwcm9wXSA9IGNscztcbiAgICAgICAgZWxzZSBpZiAoY2xhc3NUZXN0KGNscykudGVzdChsaW5lW3Byb3BdKSkgcmV0dXJuIGZhbHNlO1xuICAgICAgICBlbHNlIGxpbmVbcHJvcF0gKz0gXCIgXCIgKyBjbHM7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfSk7XG4gICAgfSksXG4gICAgcmVtb3ZlTGluZUNsYXNzOiBkb2NNZXRob2RPcChmdW5jdGlvbihoYW5kbGUsIHdoZXJlLCBjbHMpIHtcbiAgICAgIHJldHVybiBjaGFuZ2VMaW5lKHRoaXMsIGhhbmRsZSwgd2hlcmUgPT0gXCJndXR0ZXJcIiA/IFwiZ3V0dGVyXCIgOiBcImNsYXNzXCIsIGZ1bmN0aW9uKGxpbmUpIHtcbiAgICAgICAgdmFyIHByb3AgPSB3aGVyZSA9PSBcInRleHRcIiA/IFwidGV4dENsYXNzXCJcbiAgICAgICAgICAgICAgICAgOiB3aGVyZSA9PSBcImJhY2tncm91bmRcIiA/IFwiYmdDbGFzc1wiXG4gICAgICAgICAgICAgICAgIDogd2hlcmUgPT0gXCJndXR0ZXJcIiA/IFwiZ3V0dGVyQ2xhc3NcIiA6IFwid3JhcENsYXNzXCI7XG4gICAgICAgIHZhciBjdXIgPSBsaW5lW3Byb3BdO1xuICAgICAgICBpZiAoIWN1cikgcmV0dXJuIGZhbHNlO1xuICAgICAgICBlbHNlIGlmIChjbHMgPT0gbnVsbCkgbGluZVtwcm9wXSA9IG51bGw7XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgIHZhciBmb3VuZCA9IGN1ci5tYXRjaChjbGFzc1Rlc3QoY2xzKSk7XG4gICAgICAgICAgaWYgKCFmb3VuZCkgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgIHZhciBlbmQgPSBmb3VuZC5pbmRleCArIGZvdW5kWzBdLmxlbmd0aDtcbiAgICAgICAgICBsaW5lW3Byb3BdID0gY3VyLnNsaWNlKDAsIGZvdW5kLmluZGV4KSArICghZm91bmQuaW5kZXggfHwgZW5kID09IGN1ci5sZW5ndGggPyBcIlwiIDogXCIgXCIpICsgY3VyLnNsaWNlKGVuZCkgfHwgbnVsbDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH0pO1xuICAgIH0pLFxuXG4gICAgYWRkTGluZVdpZGdldDogZG9jTWV0aG9kT3AoZnVuY3Rpb24oaGFuZGxlLCBub2RlLCBvcHRpb25zKSB7XG4gICAgICByZXR1cm4gYWRkTGluZVdpZGdldCh0aGlzLCBoYW5kbGUsIG5vZGUsIG9wdGlvbnMpO1xuICAgIH0pLFxuICAgIHJlbW92ZUxpbmVXaWRnZXQ6IGZ1bmN0aW9uKHdpZGdldCkgeyB3aWRnZXQuY2xlYXIoKTsgfSxcblxuICAgIG1hcmtUZXh0OiBmdW5jdGlvbihmcm9tLCB0bywgb3B0aW9ucykge1xuICAgICAgcmV0dXJuIG1hcmtUZXh0KHRoaXMsIGNsaXBQb3ModGhpcywgZnJvbSksIGNsaXBQb3ModGhpcywgdG8pLCBvcHRpb25zLCBcInJhbmdlXCIpO1xuICAgIH0sXG4gICAgc2V0Qm9va21hcms6IGZ1bmN0aW9uKHBvcywgb3B0aW9ucykge1xuICAgICAgdmFyIHJlYWxPcHRzID0ge3JlcGxhY2VkV2l0aDogb3B0aW9ucyAmJiAob3B0aW9ucy5ub2RlVHlwZSA9PSBudWxsID8gb3B0aW9ucy53aWRnZXQgOiBvcHRpb25zKSxcbiAgICAgICAgICAgICAgICAgICAgICBpbnNlcnRMZWZ0OiBvcHRpb25zICYmIG9wdGlvbnMuaW5zZXJ0TGVmdCxcbiAgICAgICAgICAgICAgICAgICAgICBjbGVhcldoZW5FbXB0eTogZmFsc2UsIHNoYXJlZDogb3B0aW9ucyAmJiBvcHRpb25zLnNoYXJlZCxcbiAgICAgICAgICAgICAgICAgICAgICBoYW5kbGVNb3VzZUV2ZW50czogb3B0aW9ucyAmJiBvcHRpb25zLmhhbmRsZU1vdXNlRXZlbnRzfTtcbiAgICAgIHBvcyA9IGNsaXBQb3ModGhpcywgcG9zKTtcbiAgICAgIHJldHVybiBtYXJrVGV4dCh0aGlzLCBwb3MsIHBvcywgcmVhbE9wdHMsIFwiYm9va21hcmtcIik7XG4gICAgfSxcbiAgICBmaW5kTWFya3NBdDogZnVuY3Rpb24ocG9zKSB7XG4gICAgICBwb3MgPSBjbGlwUG9zKHRoaXMsIHBvcyk7XG4gICAgICB2YXIgbWFya2VycyA9IFtdLCBzcGFucyA9IGdldExpbmUodGhpcywgcG9zLmxpbmUpLm1hcmtlZFNwYW5zO1xuICAgICAgaWYgKHNwYW5zKSBmb3IgKHZhciBpID0gMDsgaSA8IHNwYW5zLmxlbmd0aDsgKytpKSB7XG4gICAgICAgIHZhciBzcGFuID0gc3BhbnNbaV07XG4gICAgICAgIGlmICgoc3Bhbi5mcm9tID09IG51bGwgfHwgc3Bhbi5mcm9tIDw9IHBvcy5jaCkgJiZcbiAgICAgICAgICAgIChzcGFuLnRvID09IG51bGwgfHwgc3Bhbi50byA+PSBwb3MuY2gpKVxuICAgICAgICAgIG1hcmtlcnMucHVzaChzcGFuLm1hcmtlci5wYXJlbnQgfHwgc3Bhbi5tYXJrZXIpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIG1hcmtlcnM7XG4gICAgfSxcbiAgICBmaW5kTWFya3M6IGZ1bmN0aW9uKGZyb20sIHRvLCBmaWx0ZXIpIHtcbiAgICAgIGZyb20gPSBjbGlwUG9zKHRoaXMsIGZyb20pOyB0byA9IGNsaXBQb3ModGhpcywgdG8pO1xuICAgICAgdmFyIGZvdW5kID0gW10sIGxpbmVObyA9IGZyb20ubGluZTtcbiAgICAgIHRoaXMuaXRlcihmcm9tLmxpbmUsIHRvLmxpbmUgKyAxLCBmdW5jdGlvbihsaW5lKSB7XG4gICAgICAgIHZhciBzcGFucyA9IGxpbmUubWFya2VkU3BhbnM7XG4gICAgICAgIGlmIChzcGFucykgZm9yICh2YXIgaSA9IDA7IGkgPCBzcGFucy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgIHZhciBzcGFuID0gc3BhbnNbaV07XG4gICAgICAgICAgaWYgKCEobGluZU5vID09IGZyb20ubGluZSAmJiBmcm9tLmNoID4gc3Bhbi50byB8fFxuICAgICAgICAgICAgICAgIHNwYW4uZnJvbSA9PSBudWxsICYmIGxpbmVObyAhPSBmcm9tLmxpbmV8fFxuICAgICAgICAgICAgICAgIGxpbmVObyA9PSB0by5saW5lICYmIHNwYW4uZnJvbSA+IHRvLmNoKSAmJlxuICAgICAgICAgICAgICAoIWZpbHRlciB8fCBmaWx0ZXIoc3Bhbi5tYXJrZXIpKSlcbiAgICAgICAgICAgIGZvdW5kLnB1c2goc3Bhbi5tYXJrZXIucGFyZW50IHx8IHNwYW4ubWFya2VyKTtcbiAgICAgICAgfVxuICAgICAgICArK2xpbmVObztcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIGZvdW5kO1xuICAgIH0sXG4gICAgZ2V0QWxsTWFya3M6IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIG1hcmtlcnMgPSBbXTtcbiAgICAgIHRoaXMuaXRlcihmdW5jdGlvbihsaW5lKSB7XG4gICAgICAgIHZhciBzcHMgPSBsaW5lLm1hcmtlZFNwYW5zO1xuICAgICAgICBpZiAoc3BzKSBmb3IgKHZhciBpID0gMDsgaSA8IHNwcy5sZW5ndGg7ICsraSlcbiAgICAgICAgICBpZiAoc3BzW2ldLmZyb20gIT0gbnVsbCkgbWFya2Vycy5wdXNoKHNwc1tpXS5tYXJrZXIpO1xuICAgICAgfSk7XG4gICAgICByZXR1cm4gbWFya2VycztcbiAgICB9LFxuXG4gICAgcG9zRnJvbUluZGV4OiBmdW5jdGlvbihvZmYpIHtcbiAgICAgIHZhciBjaCwgbGluZU5vID0gdGhpcy5maXJzdDtcbiAgICAgIHRoaXMuaXRlcihmdW5jdGlvbihsaW5lKSB7XG4gICAgICAgIHZhciBzeiA9IGxpbmUudGV4dC5sZW5ndGggKyAxO1xuICAgICAgICBpZiAoc3ogPiBvZmYpIHsgY2ggPSBvZmY7IHJldHVybiB0cnVlOyB9XG4gICAgICAgIG9mZiAtPSBzejtcbiAgICAgICAgKytsaW5lTm87XG4gICAgICB9KTtcbiAgICAgIHJldHVybiBjbGlwUG9zKHRoaXMsIFBvcyhsaW5lTm8sIGNoKSk7XG4gICAgfSxcbiAgICBpbmRleEZyb21Qb3M6IGZ1bmN0aW9uIChjb29yZHMpIHtcbiAgICAgIGNvb3JkcyA9IGNsaXBQb3ModGhpcywgY29vcmRzKTtcbiAgICAgIHZhciBpbmRleCA9IGNvb3Jkcy5jaDtcbiAgICAgIGlmIChjb29yZHMubGluZSA8IHRoaXMuZmlyc3QgfHwgY29vcmRzLmNoIDwgMCkgcmV0dXJuIDA7XG4gICAgICB0aGlzLml0ZXIodGhpcy5maXJzdCwgY29vcmRzLmxpbmUsIGZ1bmN0aW9uIChsaW5lKSB7XG4gICAgICAgIGluZGV4ICs9IGxpbmUudGV4dC5sZW5ndGggKyAxO1xuICAgICAgfSk7XG4gICAgICByZXR1cm4gaW5kZXg7XG4gICAgfSxcblxuICAgIGNvcHk6IGZ1bmN0aW9uKGNvcHlIaXN0b3J5KSB7XG4gICAgICB2YXIgZG9jID0gbmV3IERvYyhnZXRMaW5lcyh0aGlzLCB0aGlzLmZpcnN0LCB0aGlzLmZpcnN0ICsgdGhpcy5zaXplKSwgdGhpcy5tb2RlT3B0aW9uLCB0aGlzLmZpcnN0KTtcbiAgICAgIGRvYy5zY3JvbGxUb3AgPSB0aGlzLnNjcm9sbFRvcDsgZG9jLnNjcm9sbExlZnQgPSB0aGlzLnNjcm9sbExlZnQ7XG4gICAgICBkb2Muc2VsID0gdGhpcy5zZWw7XG4gICAgICBkb2MuZXh0ZW5kID0gZmFsc2U7XG4gICAgICBpZiAoY29weUhpc3RvcnkpIHtcbiAgICAgICAgZG9jLmhpc3RvcnkudW5kb0RlcHRoID0gdGhpcy5oaXN0b3J5LnVuZG9EZXB0aDtcbiAgICAgICAgZG9jLnNldEhpc3RvcnkodGhpcy5nZXRIaXN0b3J5KCkpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGRvYztcbiAgICB9LFxuXG4gICAgbGlua2VkRG9jOiBmdW5jdGlvbihvcHRpb25zKSB7XG4gICAgICBpZiAoIW9wdGlvbnMpIG9wdGlvbnMgPSB7fTtcbiAgICAgIHZhciBmcm9tID0gdGhpcy5maXJzdCwgdG8gPSB0aGlzLmZpcnN0ICsgdGhpcy5zaXplO1xuICAgICAgaWYgKG9wdGlvbnMuZnJvbSAhPSBudWxsICYmIG9wdGlvbnMuZnJvbSA+IGZyb20pIGZyb20gPSBvcHRpb25zLmZyb207XG4gICAgICBpZiAob3B0aW9ucy50byAhPSBudWxsICYmIG9wdGlvbnMudG8gPCB0bykgdG8gPSBvcHRpb25zLnRvO1xuICAgICAgdmFyIGNvcHkgPSBuZXcgRG9jKGdldExpbmVzKHRoaXMsIGZyb20sIHRvKSwgb3B0aW9ucy5tb2RlIHx8IHRoaXMubW9kZU9wdGlvbiwgZnJvbSk7XG4gICAgICBpZiAob3B0aW9ucy5zaGFyZWRIaXN0KSBjb3B5Lmhpc3RvcnkgPSB0aGlzLmhpc3Rvcnk7XG4gICAgICAodGhpcy5saW5rZWQgfHwgKHRoaXMubGlua2VkID0gW10pKS5wdXNoKHtkb2M6IGNvcHksIHNoYXJlZEhpc3Q6IG9wdGlvbnMuc2hhcmVkSGlzdH0pO1xuICAgICAgY29weS5saW5rZWQgPSBbe2RvYzogdGhpcywgaXNQYXJlbnQ6IHRydWUsIHNoYXJlZEhpc3Q6IG9wdGlvbnMuc2hhcmVkSGlzdH1dO1xuICAgICAgY29weVNoYXJlZE1hcmtlcnMoY29weSwgZmluZFNoYXJlZE1hcmtlcnModGhpcykpO1xuICAgICAgcmV0dXJuIGNvcHk7XG4gICAgfSxcbiAgICB1bmxpbmtEb2M6IGZ1bmN0aW9uKG90aGVyKSB7XG4gICAgICBpZiAob3RoZXIgaW5zdGFuY2VvZiBDb2RlTWlycm9yKSBvdGhlciA9IG90aGVyLmRvYztcbiAgICAgIGlmICh0aGlzLmxpbmtlZCkgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLmxpbmtlZC5sZW5ndGg7ICsraSkge1xuICAgICAgICB2YXIgbGluayA9IHRoaXMubGlua2VkW2ldO1xuICAgICAgICBpZiAobGluay5kb2MgIT0gb3RoZXIpIGNvbnRpbnVlO1xuICAgICAgICB0aGlzLmxpbmtlZC5zcGxpY2UoaSwgMSk7XG4gICAgICAgIG90aGVyLnVubGlua0RvYyh0aGlzKTtcbiAgICAgICAgZGV0YWNoU2hhcmVkTWFya2VycyhmaW5kU2hhcmVkTWFya2Vycyh0aGlzKSk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgLy8gSWYgdGhlIGhpc3RvcmllcyB3ZXJlIHNoYXJlZCwgc3BsaXQgdGhlbSBhZ2FpblxuICAgICAgaWYgKG90aGVyLmhpc3RvcnkgPT0gdGhpcy5oaXN0b3J5KSB7XG4gICAgICAgIHZhciBzcGxpdElkcyA9IFtvdGhlci5pZF07XG4gICAgICAgIGxpbmtlZERvY3Mob3RoZXIsIGZ1bmN0aW9uKGRvYykge3NwbGl0SWRzLnB1c2goZG9jLmlkKTt9LCB0cnVlKTtcbiAgICAgICAgb3RoZXIuaGlzdG9yeSA9IG5ldyBIaXN0b3J5KG51bGwpO1xuICAgICAgICBvdGhlci5oaXN0b3J5LmRvbmUgPSBjb3B5SGlzdG9yeUFycmF5KHRoaXMuaGlzdG9yeS5kb25lLCBzcGxpdElkcyk7XG4gICAgICAgIG90aGVyLmhpc3RvcnkudW5kb25lID0gY29weUhpc3RvcnlBcnJheSh0aGlzLmhpc3RvcnkudW5kb25lLCBzcGxpdElkcyk7XG4gICAgICB9XG4gICAgfSxcbiAgICBpdGVyTGlua2VkRG9jczogZnVuY3Rpb24oZikge2xpbmtlZERvY3ModGhpcywgZik7fSxcblxuICAgIGdldE1vZGU6IGZ1bmN0aW9uKCkge3JldHVybiB0aGlzLm1vZGU7fSxcbiAgICBnZXRFZGl0b3I6IGZ1bmN0aW9uKCkge3JldHVybiB0aGlzLmNtO31cbiAgfSk7XG5cbiAgLy8gUHVibGljIGFsaWFzLlxuICBEb2MucHJvdG90eXBlLmVhY2hMaW5lID0gRG9jLnByb3RvdHlwZS5pdGVyO1xuXG4gIC8vIFNldCB1cCBtZXRob2RzIG9uIENvZGVNaXJyb3IncyBwcm90b3R5cGUgdG8gcmVkaXJlY3QgdG8gdGhlIGVkaXRvcidzIGRvY3VtZW50LlxuICB2YXIgZG9udERlbGVnYXRlID0gXCJpdGVyIGluc2VydCByZW1vdmUgY29weSBnZXRFZGl0b3IgY29uc3RydWN0b3JcIi5zcGxpdChcIiBcIik7XG4gIGZvciAodmFyIHByb3AgaW4gRG9jLnByb3RvdHlwZSkgaWYgKERvYy5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkocHJvcCkgJiYgaW5kZXhPZihkb250RGVsZWdhdGUsIHByb3ApIDwgMClcbiAgICBDb2RlTWlycm9yLnByb3RvdHlwZVtwcm9wXSA9IChmdW5jdGlvbihtZXRob2QpIHtcbiAgICAgIHJldHVybiBmdW5jdGlvbigpIHtyZXR1cm4gbWV0aG9kLmFwcGx5KHRoaXMuZG9jLCBhcmd1bWVudHMpO307XG4gICAgfSkoRG9jLnByb3RvdHlwZVtwcm9wXSk7XG5cbiAgZXZlbnRNaXhpbihEb2MpO1xuXG4gIC8vIENhbGwgZiBmb3IgYWxsIGxpbmtlZCBkb2N1bWVudHMuXG4gIGZ1bmN0aW9uIGxpbmtlZERvY3MoZG9jLCBmLCBzaGFyZWRIaXN0T25seSkge1xuICAgIGZ1bmN0aW9uIHByb3BhZ2F0ZShkb2MsIHNraXAsIHNoYXJlZEhpc3QpIHtcbiAgICAgIGlmIChkb2MubGlua2VkKSBmb3IgKHZhciBpID0gMDsgaSA8IGRvYy5saW5rZWQubGVuZ3RoOyArK2kpIHtcbiAgICAgICAgdmFyIHJlbCA9IGRvYy5saW5rZWRbaV07XG4gICAgICAgIGlmIChyZWwuZG9jID09IHNraXApIGNvbnRpbnVlO1xuICAgICAgICB2YXIgc2hhcmVkID0gc2hhcmVkSGlzdCAmJiByZWwuc2hhcmVkSGlzdDtcbiAgICAgICAgaWYgKHNoYXJlZEhpc3RPbmx5ICYmICFzaGFyZWQpIGNvbnRpbnVlO1xuICAgICAgICBmKHJlbC5kb2MsIHNoYXJlZCk7XG4gICAgICAgIHByb3BhZ2F0ZShyZWwuZG9jLCBkb2MsIHNoYXJlZCk7XG4gICAgICB9XG4gICAgfVxuICAgIHByb3BhZ2F0ZShkb2MsIG51bGwsIHRydWUpO1xuICB9XG5cbiAgLy8gQXR0YWNoIGEgZG9jdW1lbnQgdG8gYW4gZWRpdG9yLlxuICBmdW5jdGlvbiBhdHRhY2hEb2MoY20sIGRvYykge1xuICAgIGlmIChkb2MuY20pIHRocm93IG5ldyBFcnJvcihcIlRoaXMgZG9jdW1lbnQgaXMgYWxyZWFkeSBpbiB1c2UuXCIpO1xuICAgIGNtLmRvYyA9IGRvYztcbiAgICBkb2MuY20gPSBjbTtcbiAgICBlc3RpbWF0ZUxpbmVIZWlnaHRzKGNtKTtcbiAgICBsb2FkTW9kZShjbSk7XG4gICAgaWYgKCFjbS5vcHRpb25zLmxpbmVXcmFwcGluZykgZmluZE1heExpbmUoY20pO1xuICAgIGNtLm9wdGlvbnMubW9kZSA9IGRvYy5tb2RlT3B0aW9uO1xuICAgIHJlZ0NoYW5nZShjbSk7XG4gIH1cblxuICAvLyBMSU5FIFVUSUxJVElFU1xuXG4gIC8vIEZpbmQgdGhlIGxpbmUgb2JqZWN0IGNvcnJlc3BvbmRpbmcgdG8gdGhlIGdpdmVuIGxpbmUgbnVtYmVyLlxuICBmdW5jdGlvbiBnZXRMaW5lKGRvYywgbikge1xuICAgIG4gLT0gZG9jLmZpcnN0O1xuICAgIGlmIChuIDwgMCB8fCBuID49IGRvYy5zaXplKSB0aHJvdyBuZXcgRXJyb3IoXCJUaGVyZSBpcyBubyBsaW5lIFwiICsgKG4gKyBkb2MuZmlyc3QpICsgXCIgaW4gdGhlIGRvY3VtZW50LlwiKTtcbiAgICBmb3IgKHZhciBjaHVuayA9IGRvYzsgIWNodW5rLmxpbmVzOykge1xuICAgICAgZm9yICh2YXIgaSA9IDA7OyArK2kpIHtcbiAgICAgICAgdmFyIGNoaWxkID0gY2h1bmsuY2hpbGRyZW5baV0sIHN6ID0gY2hpbGQuY2h1bmtTaXplKCk7XG4gICAgICAgIGlmIChuIDwgc3opIHsgY2h1bmsgPSBjaGlsZDsgYnJlYWs7IH1cbiAgICAgICAgbiAtPSBzejtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIGNodW5rLmxpbmVzW25dO1xuICB9XG5cbiAgLy8gR2V0IHRoZSBwYXJ0IG9mIGEgZG9jdW1lbnQgYmV0d2VlbiB0d28gcG9zaXRpb25zLCBhcyBhbiBhcnJheSBvZlxuICAvLyBzdHJpbmdzLlxuICBmdW5jdGlvbiBnZXRCZXR3ZWVuKGRvYywgc3RhcnQsIGVuZCkge1xuICAgIHZhciBvdXQgPSBbXSwgbiA9IHN0YXJ0LmxpbmU7XG4gICAgZG9jLml0ZXIoc3RhcnQubGluZSwgZW5kLmxpbmUgKyAxLCBmdW5jdGlvbihsaW5lKSB7XG4gICAgICB2YXIgdGV4dCA9IGxpbmUudGV4dDtcbiAgICAgIGlmIChuID09IGVuZC5saW5lKSB0ZXh0ID0gdGV4dC5zbGljZSgwLCBlbmQuY2gpO1xuICAgICAgaWYgKG4gPT0gc3RhcnQubGluZSkgdGV4dCA9IHRleHQuc2xpY2Uoc3RhcnQuY2gpO1xuICAgICAgb3V0LnB1c2godGV4dCk7XG4gICAgICArK247XG4gICAgfSk7XG4gICAgcmV0dXJuIG91dDtcbiAgfVxuICAvLyBHZXQgdGhlIGxpbmVzIGJldHdlZW4gZnJvbSBhbmQgdG8sIGFzIGFycmF5IG9mIHN0cmluZ3MuXG4gIGZ1bmN0aW9uIGdldExpbmVzKGRvYywgZnJvbSwgdG8pIHtcbiAgICB2YXIgb3V0ID0gW107XG4gICAgZG9jLml0ZXIoZnJvbSwgdG8sIGZ1bmN0aW9uKGxpbmUpIHsgb3V0LnB1c2gobGluZS50ZXh0KTsgfSk7XG4gICAgcmV0dXJuIG91dDtcbiAgfVxuXG4gIC8vIFVwZGF0ZSB0aGUgaGVpZ2h0IG9mIGEgbGluZSwgcHJvcGFnYXRpbmcgdGhlIGhlaWdodCBjaGFuZ2VcbiAgLy8gdXB3YXJkcyB0byBwYXJlbnQgbm9kZXMuXG4gIGZ1bmN0aW9uIHVwZGF0ZUxpbmVIZWlnaHQobGluZSwgaGVpZ2h0KSB7XG4gICAgdmFyIGRpZmYgPSBoZWlnaHQgLSBsaW5lLmhlaWdodDtcbiAgICBpZiAoZGlmZikgZm9yICh2YXIgbiA9IGxpbmU7IG47IG4gPSBuLnBhcmVudCkgbi5oZWlnaHQgKz0gZGlmZjtcbiAgfVxuXG4gIC8vIEdpdmVuIGEgbGluZSBvYmplY3QsIGZpbmQgaXRzIGxpbmUgbnVtYmVyIGJ5IHdhbGtpbmcgdXAgdGhyb3VnaFxuICAvLyBpdHMgcGFyZW50IGxpbmtzLlxuICBmdW5jdGlvbiBsaW5lTm8obGluZSkge1xuICAgIGlmIChsaW5lLnBhcmVudCA9PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgICB2YXIgY3VyID0gbGluZS5wYXJlbnQsIG5vID0gaW5kZXhPZihjdXIubGluZXMsIGxpbmUpO1xuICAgIGZvciAodmFyIGNodW5rID0gY3VyLnBhcmVudDsgY2h1bms7IGN1ciA9IGNodW5rLCBjaHVuayA9IGNodW5rLnBhcmVudCkge1xuICAgICAgZm9yICh2YXIgaSA9IDA7OyArK2kpIHtcbiAgICAgICAgaWYgKGNodW5rLmNoaWxkcmVuW2ldID09IGN1cikgYnJlYWs7XG4gICAgICAgIG5vICs9IGNodW5rLmNoaWxkcmVuW2ldLmNodW5rU2l6ZSgpO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gbm8gKyBjdXIuZmlyc3Q7XG4gIH1cblxuICAvLyBGaW5kIHRoZSBsaW5lIGF0IHRoZSBnaXZlbiB2ZXJ0aWNhbCBwb3NpdGlvbiwgdXNpbmcgdGhlIGhlaWdodFxuICAvLyBpbmZvcm1hdGlvbiBpbiB0aGUgZG9jdW1lbnQgdHJlZS5cbiAgZnVuY3Rpb24gbGluZUF0SGVpZ2h0KGNodW5rLCBoKSB7XG4gICAgdmFyIG4gPSBjaHVuay5maXJzdDtcbiAgICBvdXRlcjogZG8ge1xuICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBjaHVuay5jaGlsZHJlbi5sZW5ndGg7ICsraSkge1xuICAgICAgICB2YXIgY2hpbGQgPSBjaHVuay5jaGlsZHJlbltpXSwgY2ggPSBjaGlsZC5oZWlnaHQ7XG4gICAgICAgIGlmIChoIDwgY2gpIHsgY2h1bmsgPSBjaGlsZDsgY29udGludWUgb3V0ZXI7IH1cbiAgICAgICAgaCAtPSBjaDtcbiAgICAgICAgbiArPSBjaGlsZC5jaHVua1NpemUoKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBuO1xuICAgIH0gd2hpbGUgKCFjaHVuay5saW5lcyk7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBjaHVuay5saW5lcy5sZW5ndGg7ICsraSkge1xuICAgICAgdmFyIGxpbmUgPSBjaHVuay5saW5lc1tpXSwgbGggPSBsaW5lLmhlaWdodDtcbiAgICAgIGlmIChoIDwgbGgpIGJyZWFrO1xuICAgICAgaCAtPSBsaDtcbiAgICB9XG4gICAgcmV0dXJuIG4gKyBpO1xuICB9XG5cblxuICAvLyBGaW5kIHRoZSBoZWlnaHQgYWJvdmUgdGhlIGdpdmVuIGxpbmUuXG4gIGZ1bmN0aW9uIGhlaWdodEF0TGluZShsaW5lT2JqKSB7XG4gICAgbGluZU9iaiA9IHZpc3VhbExpbmUobGluZU9iaik7XG5cbiAgICB2YXIgaCA9IDAsIGNodW5rID0gbGluZU9iai5wYXJlbnQ7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBjaHVuay5saW5lcy5sZW5ndGg7ICsraSkge1xuICAgICAgdmFyIGxpbmUgPSBjaHVuay5saW5lc1tpXTtcbiAgICAgIGlmIChsaW5lID09IGxpbmVPYmopIGJyZWFrO1xuICAgICAgZWxzZSBoICs9IGxpbmUuaGVpZ2h0O1xuICAgIH1cbiAgICBmb3IgKHZhciBwID0gY2h1bmsucGFyZW50OyBwOyBjaHVuayA9IHAsIHAgPSBjaHVuay5wYXJlbnQpIHtcbiAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcC5jaGlsZHJlbi5sZW5ndGg7ICsraSkge1xuICAgICAgICB2YXIgY3VyID0gcC5jaGlsZHJlbltpXTtcbiAgICAgICAgaWYgKGN1ciA9PSBjaHVuaykgYnJlYWs7XG4gICAgICAgIGVsc2UgaCArPSBjdXIuaGVpZ2h0O1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gaDtcbiAgfVxuXG4gIC8vIEdldCB0aGUgYmlkaSBvcmRlcmluZyBmb3IgdGhlIGdpdmVuIGxpbmUgKGFuZCBjYWNoZSBpdCkuIFJldHVybnNcbiAgLy8gZmFsc2UgZm9yIGxpbmVzIHRoYXQgYXJlIGZ1bGx5IGxlZnQtdG8tcmlnaHQsIGFuZCBhbiBhcnJheSBvZlxuICAvLyBCaWRpU3BhbiBvYmplY3RzIG90aGVyd2lzZS5cbiAgZnVuY3Rpb24gZ2V0T3JkZXIobGluZSkge1xuICAgIHZhciBvcmRlciA9IGxpbmUub3JkZXI7XG4gICAgaWYgKG9yZGVyID09IG51bGwpIG9yZGVyID0gbGluZS5vcmRlciA9IGJpZGlPcmRlcmluZyhsaW5lLnRleHQpO1xuICAgIHJldHVybiBvcmRlcjtcbiAgfVxuXG4gIC8vIEhJU1RPUllcblxuICBmdW5jdGlvbiBIaXN0b3J5KHN0YXJ0R2VuKSB7XG4gICAgLy8gQXJyYXlzIG9mIGNoYW5nZSBldmVudHMgYW5kIHNlbGVjdGlvbnMuIERvaW5nIHNvbWV0aGluZyBhZGRzIGFuXG4gICAgLy8gZXZlbnQgdG8gZG9uZSBhbmQgY2xlYXJzIHVuZG8uIFVuZG9pbmcgbW92ZXMgZXZlbnRzIGZyb20gZG9uZVxuICAgIC8vIHRvIHVuZG9uZSwgcmVkb2luZyBtb3ZlcyB0aGVtIGluIHRoZSBvdGhlciBkaXJlY3Rpb24uXG4gICAgdGhpcy5kb25lID0gW107IHRoaXMudW5kb25lID0gW107XG4gICAgdGhpcy51bmRvRGVwdGggPSBJbmZpbml0eTtcbiAgICAvLyBVc2VkIHRvIHRyYWNrIHdoZW4gY2hhbmdlcyBjYW4gYmUgbWVyZ2VkIGludG8gYSBzaW5nbGUgdW5kb1xuICAgIC8vIGV2ZW50XG4gICAgdGhpcy5sYXN0TW9kVGltZSA9IHRoaXMubGFzdFNlbFRpbWUgPSAwO1xuICAgIHRoaXMubGFzdE9wID0gdGhpcy5sYXN0U2VsT3AgPSBudWxsO1xuICAgIHRoaXMubGFzdE9yaWdpbiA9IHRoaXMubGFzdFNlbE9yaWdpbiA9IG51bGw7XG4gICAgLy8gVXNlZCBieSB0aGUgaXNDbGVhbigpIG1ldGhvZFxuICAgIHRoaXMuZ2VuZXJhdGlvbiA9IHRoaXMubWF4R2VuZXJhdGlvbiA9IHN0YXJ0R2VuIHx8IDE7XG4gIH1cblxuICAvLyBDcmVhdGUgYSBoaXN0b3J5IGNoYW5nZSBldmVudCBmcm9tIGFuIHVwZGF0ZURvYy1zdHlsZSBjaGFuZ2VcbiAgLy8gb2JqZWN0LlxuICBmdW5jdGlvbiBoaXN0b3J5Q2hhbmdlRnJvbUNoYW5nZShkb2MsIGNoYW5nZSkge1xuICAgIHZhciBoaXN0Q2hhbmdlID0ge2Zyb206IGNvcHlQb3MoY2hhbmdlLmZyb20pLCB0bzogY2hhbmdlRW5kKGNoYW5nZSksIHRleHQ6IGdldEJldHdlZW4oZG9jLCBjaGFuZ2UuZnJvbSwgY2hhbmdlLnRvKX07XG4gICAgYXR0YWNoTG9jYWxTcGFucyhkb2MsIGhpc3RDaGFuZ2UsIGNoYW5nZS5mcm9tLmxpbmUsIGNoYW5nZS50by5saW5lICsgMSk7XG4gICAgbGlua2VkRG9jcyhkb2MsIGZ1bmN0aW9uKGRvYykge2F0dGFjaExvY2FsU3BhbnMoZG9jLCBoaXN0Q2hhbmdlLCBjaGFuZ2UuZnJvbS5saW5lLCBjaGFuZ2UudG8ubGluZSArIDEpO30sIHRydWUpO1xuICAgIHJldHVybiBoaXN0Q2hhbmdlO1xuICB9XG5cbiAgLy8gUG9wIGFsbCBzZWxlY3Rpb24gZXZlbnRzIG9mZiB0aGUgZW5kIG9mIGEgaGlzdG9yeSBhcnJheS4gU3RvcCBhdFxuICAvLyBhIGNoYW5nZSBldmVudC5cbiAgZnVuY3Rpb24gY2xlYXJTZWxlY3Rpb25FdmVudHMoYXJyYXkpIHtcbiAgICB3aGlsZSAoYXJyYXkubGVuZ3RoKSB7XG4gICAgICB2YXIgbGFzdCA9IGxzdChhcnJheSk7XG4gICAgICBpZiAobGFzdC5yYW5nZXMpIGFycmF5LnBvcCgpO1xuICAgICAgZWxzZSBicmVhaztcbiAgICB9XG4gIH1cblxuICAvLyBGaW5kIHRoZSB0b3AgY2hhbmdlIGV2ZW50IGluIHRoZSBoaXN0b3J5LiBQb3Agb2ZmIHNlbGVjdGlvblxuICAvLyBldmVudHMgdGhhdCBhcmUgaW4gdGhlIHdheS5cbiAgZnVuY3Rpb24gbGFzdENoYW5nZUV2ZW50KGhpc3QsIGZvcmNlKSB7XG4gICAgaWYgKGZvcmNlKSB7XG4gICAgICBjbGVhclNlbGVjdGlvbkV2ZW50cyhoaXN0LmRvbmUpO1xuICAgICAgcmV0dXJuIGxzdChoaXN0LmRvbmUpO1xuICAgIH0gZWxzZSBpZiAoaGlzdC5kb25lLmxlbmd0aCAmJiAhbHN0KGhpc3QuZG9uZSkucmFuZ2VzKSB7XG4gICAgICByZXR1cm4gbHN0KGhpc3QuZG9uZSk7XG4gICAgfSBlbHNlIGlmIChoaXN0LmRvbmUubGVuZ3RoID4gMSAmJiAhaGlzdC5kb25lW2hpc3QuZG9uZS5sZW5ndGggLSAyXS5yYW5nZXMpIHtcbiAgICAgIGhpc3QuZG9uZS5wb3AoKTtcbiAgICAgIHJldHVybiBsc3QoaGlzdC5kb25lKTtcbiAgICB9XG4gIH1cblxuICAvLyBSZWdpc3RlciBhIGNoYW5nZSBpbiB0aGUgaGlzdG9yeS4gTWVyZ2VzIGNoYW5nZXMgdGhhdCBhcmUgd2l0aGluXG4gIC8vIGEgc2luZ2xlIG9wZXJhdGlvbiwgb3JlIGFyZSBjbG9zZSB0b2dldGhlciB3aXRoIGFuIG9yaWdpbiB0aGF0XG4gIC8vIGFsbG93cyBtZXJnaW5nIChzdGFydGluZyB3aXRoIFwiK1wiKSBpbnRvIGEgc2luZ2xlIGV2ZW50LlxuICBmdW5jdGlvbiBhZGRDaGFuZ2VUb0hpc3RvcnkoZG9jLCBjaGFuZ2UsIHNlbEFmdGVyLCBvcElkKSB7XG4gICAgdmFyIGhpc3QgPSBkb2MuaGlzdG9yeTtcbiAgICBoaXN0LnVuZG9uZS5sZW5ndGggPSAwO1xuICAgIHZhciB0aW1lID0gK25ldyBEYXRlLCBjdXI7XG5cbiAgICBpZiAoKGhpc3QubGFzdE9wID09IG9wSWQgfHxcbiAgICAgICAgIGhpc3QubGFzdE9yaWdpbiA9PSBjaGFuZ2Uub3JpZ2luICYmIGNoYW5nZS5vcmlnaW4gJiZcbiAgICAgICAgICgoY2hhbmdlLm9yaWdpbi5jaGFyQXQoMCkgPT0gXCIrXCIgJiYgZG9jLmNtICYmIGhpc3QubGFzdE1vZFRpbWUgPiB0aW1lIC0gZG9jLmNtLm9wdGlvbnMuaGlzdG9yeUV2ZW50RGVsYXkpIHx8XG4gICAgICAgICAgY2hhbmdlLm9yaWdpbi5jaGFyQXQoMCkgPT0gXCIqXCIpKSAmJlxuICAgICAgICAoY3VyID0gbGFzdENoYW5nZUV2ZW50KGhpc3QsIGhpc3QubGFzdE9wID09IG9wSWQpKSkge1xuICAgICAgLy8gTWVyZ2UgdGhpcyBjaGFuZ2UgaW50byB0aGUgbGFzdCBldmVudFxuICAgICAgdmFyIGxhc3QgPSBsc3QoY3VyLmNoYW5nZXMpO1xuICAgICAgaWYgKGNtcChjaGFuZ2UuZnJvbSwgY2hhbmdlLnRvKSA9PSAwICYmIGNtcChjaGFuZ2UuZnJvbSwgbGFzdC50bykgPT0gMCkge1xuICAgICAgICAvLyBPcHRpbWl6ZWQgY2FzZSBmb3Igc2ltcGxlIGluc2VydGlvbiAtLSBkb24ndCB3YW50IHRvIGFkZFxuICAgICAgICAvLyBuZXcgY2hhbmdlc2V0cyBmb3IgZXZlcnkgY2hhcmFjdGVyIHR5cGVkXG4gICAgICAgIGxhc3QudG8gPSBjaGFuZ2VFbmQoY2hhbmdlKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIEFkZCBuZXcgc3ViLWV2ZW50XG4gICAgICAgIGN1ci5jaGFuZ2VzLnB1c2goaGlzdG9yeUNoYW5nZUZyb21DaGFuZ2UoZG9jLCBjaGFuZ2UpKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgLy8gQ2FuIG5vdCBiZSBtZXJnZWQsIHN0YXJ0IGEgbmV3IGV2ZW50LlxuICAgICAgdmFyIGJlZm9yZSA9IGxzdChoaXN0LmRvbmUpO1xuICAgICAgaWYgKCFiZWZvcmUgfHwgIWJlZm9yZS5yYW5nZXMpXG4gICAgICAgIHB1c2hTZWxlY3Rpb25Ub0hpc3RvcnkoZG9jLnNlbCwgaGlzdC5kb25lKTtcbiAgICAgIGN1ciA9IHtjaGFuZ2VzOiBbaGlzdG9yeUNoYW5nZUZyb21DaGFuZ2UoZG9jLCBjaGFuZ2UpXSxcbiAgICAgICAgICAgICBnZW5lcmF0aW9uOiBoaXN0LmdlbmVyYXRpb259O1xuICAgICAgaGlzdC5kb25lLnB1c2goY3VyKTtcbiAgICAgIHdoaWxlIChoaXN0LmRvbmUubGVuZ3RoID4gaGlzdC51bmRvRGVwdGgpIHtcbiAgICAgICAgaGlzdC5kb25lLnNoaWZ0KCk7XG4gICAgICAgIGlmICghaGlzdC5kb25lWzBdLnJhbmdlcykgaGlzdC5kb25lLnNoaWZ0KCk7XG4gICAgICB9XG4gICAgfVxuICAgIGhpc3QuZG9uZS5wdXNoKHNlbEFmdGVyKTtcbiAgICBoaXN0LmdlbmVyYXRpb24gPSArK2hpc3QubWF4R2VuZXJhdGlvbjtcbiAgICBoaXN0Lmxhc3RNb2RUaW1lID0gaGlzdC5sYXN0U2VsVGltZSA9IHRpbWU7XG4gICAgaGlzdC5sYXN0T3AgPSBoaXN0Lmxhc3RTZWxPcCA9IG9wSWQ7XG4gICAgaGlzdC5sYXN0T3JpZ2luID0gaGlzdC5sYXN0U2VsT3JpZ2luID0gY2hhbmdlLm9yaWdpbjtcblxuICAgIGlmICghbGFzdCkgc2lnbmFsKGRvYywgXCJoaXN0b3J5QWRkZWRcIik7XG4gIH1cblxuICBmdW5jdGlvbiBzZWxlY3Rpb25FdmVudENhbkJlTWVyZ2VkKGRvYywgb3JpZ2luLCBwcmV2LCBzZWwpIHtcbiAgICB2YXIgY2ggPSBvcmlnaW4uY2hhckF0KDApO1xuICAgIHJldHVybiBjaCA9PSBcIipcIiB8fFxuICAgICAgY2ggPT0gXCIrXCIgJiZcbiAgICAgIHByZXYucmFuZ2VzLmxlbmd0aCA9PSBzZWwucmFuZ2VzLmxlbmd0aCAmJlxuICAgICAgcHJldi5zb21ldGhpbmdTZWxlY3RlZCgpID09IHNlbC5zb21ldGhpbmdTZWxlY3RlZCgpICYmXG4gICAgICBuZXcgRGF0ZSAtIGRvYy5oaXN0b3J5Lmxhc3RTZWxUaW1lIDw9IChkb2MuY20gPyBkb2MuY20ub3B0aW9ucy5oaXN0b3J5RXZlbnREZWxheSA6IDUwMCk7XG4gIH1cblxuICAvLyBDYWxsZWQgd2hlbmV2ZXIgdGhlIHNlbGVjdGlvbiBjaGFuZ2VzLCBzZXRzIHRoZSBuZXcgc2VsZWN0aW9uIGFzXG4gIC8vIHRoZSBwZW5kaW5nIHNlbGVjdGlvbiBpbiB0aGUgaGlzdG9yeSwgYW5kIHB1c2hlcyB0aGUgb2xkIHBlbmRpbmdcbiAgLy8gc2VsZWN0aW9uIGludG8gdGhlICdkb25lJyBhcnJheSB3aGVuIGl0IHdhcyBzaWduaWZpY2FudGx5XG4gIC8vIGRpZmZlcmVudCAoaW4gbnVtYmVyIG9mIHNlbGVjdGVkIHJhbmdlcywgZW1wdGluZXNzLCBvciB0aW1lKS5cbiAgZnVuY3Rpb24gYWRkU2VsZWN0aW9uVG9IaXN0b3J5KGRvYywgc2VsLCBvcElkLCBvcHRpb25zKSB7XG4gICAgdmFyIGhpc3QgPSBkb2MuaGlzdG9yeSwgb3JpZ2luID0gb3B0aW9ucyAmJiBvcHRpb25zLm9yaWdpbjtcblxuICAgIC8vIEEgbmV3IGV2ZW50IGlzIHN0YXJ0ZWQgd2hlbiB0aGUgcHJldmlvdXMgb3JpZ2luIGRvZXMgbm90IG1hdGNoXG4gICAgLy8gdGhlIGN1cnJlbnQsIG9yIHRoZSBvcmlnaW5zIGRvbid0IGFsbG93IG1hdGNoaW5nLiBPcmlnaW5zXG4gICAgLy8gc3RhcnRpbmcgd2l0aCAqIGFyZSBhbHdheXMgbWVyZ2VkLCB0aG9zZSBzdGFydGluZyB3aXRoICsgYXJlXG4gICAgLy8gbWVyZ2VkIHdoZW4gc2ltaWxhciBhbmQgY2xvc2UgdG9nZXRoZXIgaW4gdGltZS5cbiAgICBpZiAob3BJZCA9PSBoaXN0Lmxhc3RTZWxPcCB8fFxuICAgICAgICAob3JpZ2luICYmIGhpc3QubGFzdFNlbE9yaWdpbiA9PSBvcmlnaW4gJiZcbiAgICAgICAgIChoaXN0Lmxhc3RNb2RUaW1lID09IGhpc3QubGFzdFNlbFRpbWUgJiYgaGlzdC5sYXN0T3JpZ2luID09IG9yaWdpbiB8fFxuICAgICAgICAgIHNlbGVjdGlvbkV2ZW50Q2FuQmVNZXJnZWQoZG9jLCBvcmlnaW4sIGxzdChoaXN0LmRvbmUpLCBzZWwpKSkpXG4gICAgICBoaXN0LmRvbmVbaGlzdC5kb25lLmxlbmd0aCAtIDFdID0gc2VsO1xuICAgIGVsc2VcbiAgICAgIHB1c2hTZWxlY3Rpb25Ub0hpc3Rvcnkoc2VsLCBoaXN0LmRvbmUpO1xuXG4gICAgaGlzdC5sYXN0U2VsVGltZSA9ICtuZXcgRGF0ZTtcbiAgICBoaXN0Lmxhc3RTZWxPcmlnaW4gPSBvcmlnaW47XG4gICAgaGlzdC5sYXN0U2VsT3AgPSBvcElkO1xuICAgIGlmIChvcHRpb25zICYmIG9wdGlvbnMuY2xlYXJSZWRvICE9PSBmYWxzZSlcbiAgICAgIGNsZWFyU2VsZWN0aW9uRXZlbnRzKGhpc3QudW5kb25lKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHB1c2hTZWxlY3Rpb25Ub0hpc3Rvcnkoc2VsLCBkZXN0KSB7XG4gICAgdmFyIHRvcCA9IGxzdChkZXN0KTtcbiAgICBpZiAoISh0b3AgJiYgdG9wLnJhbmdlcyAmJiB0b3AuZXF1YWxzKHNlbCkpKVxuICAgICAgZGVzdC5wdXNoKHNlbCk7XG4gIH1cblxuICAvLyBVc2VkIHRvIHN0b3JlIG1hcmtlZCBzcGFuIGluZm9ybWF0aW9uIGluIHRoZSBoaXN0b3J5LlxuICBmdW5jdGlvbiBhdHRhY2hMb2NhbFNwYW5zKGRvYywgY2hhbmdlLCBmcm9tLCB0bykge1xuICAgIHZhciBleGlzdGluZyA9IGNoYW5nZVtcInNwYW5zX1wiICsgZG9jLmlkXSwgbiA9IDA7XG4gICAgZG9jLml0ZXIoTWF0aC5tYXgoZG9jLmZpcnN0LCBmcm9tKSwgTWF0aC5taW4oZG9jLmZpcnN0ICsgZG9jLnNpemUsIHRvKSwgZnVuY3Rpb24obGluZSkge1xuICAgICAgaWYgKGxpbmUubWFya2VkU3BhbnMpXG4gICAgICAgIChleGlzdGluZyB8fCAoZXhpc3RpbmcgPSBjaGFuZ2VbXCJzcGFuc19cIiArIGRvYy5pZF0gPSB7fSkpW25dID0gbGluZS5tYXJrZWRTcGFucztcbiAgICAgICsrbjtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIFdoZW4gdW4vcmUtZG9pbmcgcmVzdG9yZXMgdGV4dCBjb250YWluaW5nIG1hcmtlZCBzcGFucywgdGhvc2VcbiAgLy8gdGhhdCBoYXZlIGJlZW4gZXhwbGljaXRseSBjbGVhcmVkIHNob3VsZCBub3QgYmUgcmVzdG9yZWQuXG4gIGZ1bmN0aW9uIHJlbW92ZUNsZWFyZWRTcGFucyhzcGFucykge1xuICAgIGlmICghc3BhbnMpIHJldHVybiBudWxsO1xuICAgIGZvciAodmFyIGkgPSAwLCBvdXQ7IGkgPCBzcGFucy5sZW5ndGg7ICsraSkge1xuICAgICAgaWYgKHNwYW5zW2ldLm1hcmtlci5leHBsaWNpdGx5Q2xlYXJlZCkgeyBpZiAoIW91dCkgb3V0ID0gc3BhbnMuc2xpY2UoMCwgaSk7IH1cbiAgICAgIGVsc2UgaWYgKG91dCkgb3V0LnB1c2goc3BhbnNbaV0pO1xuICAgIH1cbiAgICByZXR1cm4gIW91dCA/IHNwYW5zIDogb3V0Lmxlbmd0aCA/IG91dCA6IG51bGw7XG4gIH1cblxuICAvLyBSZXRyaWV2ZSBhbmQgZmlsdGVyIHRoZSBvbGQgbWFya2VkIHNwYW5zIHN0b3JlZCBpbiBhIGNoYW5nZSBldmVudC5cbiAgZnVuY3Rpb24gZ2V0T2xkU3BhbnMoZG9jLCBjaGFuZ2UpIHtcbiAgICB2YXIgZm91bmQgPSBjaGFuZ2VbXCJzcGFuc19cIiArIGRvYy5pZF07XG4gICAgaWYgKCFmb3VuZCkgcmV0dXJuIG51bGw7XG4gICAgZm9yICh2YXIgaSA9IDAsIG53ID0gW107IGkgPCBjaGFuZ2UudGV4dC5sZW5ndGg7ICsraSlcbiAgICAgIG53LnB1c2gocmVtb3ZlQ2xlYXJlZFNwYW5zKGZvdW5kW2ldKSk7XG4gICAgcmV0dXJuIG53O1xuICB9XG5cbiAgLy8gVXNlZCBib3RoIHRvIHByb3ZpZGUgYSBKU09OLXNhZmUgb2JqZWN0IGluIC5nZXRIaXN0b3J5LCBhbmQsIHdoZW5cbiAgLy8gZGV0YWNoaW5nIGEgZG9jdW1lbnQsIHRvIHNwbGl0IHRoZSBoaXN0b3J5IGluIHR3b1xuICBmdW5jdGlvbiBjb3B5SGlzdG9yeUFycmF5KGV2ZW50cywgbmV3R3JvdXAsIGluc3RhbnRpYXRlU2VsKSB7XG4gICAgZm9yICh2YXIgaSA9IDAsIGNvcHkgPSBbXTsgaSA8IGV2ZW50cy5sZW5ndGg7ICsraSkge1xuICAgICAgdmFyIGV2ZW50ID0gZXZlbnRzW2ldO1xuICAgICAgaWYgKGV2ZW50LnJhbmdlcykge1xuICAgICAgICBjb3B5LnB1c2goaW5zdGFudGlhdGVTZWwgPyBTZWxlY3Rpb24ucHJvdG90eXBlLmRlZXBDb3B5LmNhbGwoZXZlbnQpIDogZXZlbnQpO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIHZhciBjaGFuZ2VzID0gZXZlbnQuY2hhbmdlcywgbmV3Q2hhbmdlcyA9IFtdO1xuICAgICAgY29weS5wdXNoKHtjaGFuZ2VzOiBuZXdDaGFuZ2VzfSk7XG4gICAgICBmb3IgKHZhciBqID0gMDsgaiA8IGNoYW5nZXMubGVuZ3RoOyArK2opIHtcbiAgICAgICAgdmFyIGNoYW5nZSA9IGNoYW5nZXNbal0sIG07XG4gICAgICAgIG5ld0NoYW5nZXMucHVzaCh7ZnJvbTogY2hhbmdlLmZyb20sIHRvOiBjaGFuZ2UudG8sIHRleHQ6IGNoYW5nZS50ZXh0fSk7XG4gICAgICAgIGlmIChuZXdHcm91cCkgZm9yICh2YXIgcHJvcCBpbiBjaGFuZ2UpIGlmIChtID0gcHJvcC5tYXRjaCgvXnNwYW5zXyhcXGQrKSQvKSkge1xuICAgICAgICAgIGlmIChpbmRleE9mKG5ld0dyb3VwLCBOdW1iZXIobVsxXSkpID4gLTEpIHtcbiAgICAgICAgICAgIGxzdChuZXdDaGFuZ2VzKVtwcm9wXSA9IGNoYW5nZVtwcm9wXTtcbiAgICAgICAgICAgIGRlbGV0ZSBjaGFuZ2VbcHJvcF07XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBjb3B5O1xuICB9XG5cbiAgLy8gUmViYXNpbmcvcmVzZXR0aW5nIGhpc3RvcnkgdG8gZGVhbCB3aXRoIGV4dGVybmFsbHktc291cmNlZCBjaGFuZ2VzXG5cbiAgZnVuY3Rpb24gcmViYXNlSGlzdFNlbFNpbmdsZShwb3MsIGZyb20sIHRvLCBkaWZmKSB7XG4gICAgaWYgKHRvIDwgcG9zLmxpbmUpIHtcbiAgICAgIHBvcy5saW5lICs9IGRpZmY7XG4gICAgfSBlbHNlIGlmIChmcm9tIDwgcG9zLmxpbmUpIHtcbiAgICAgIHBvcy5saW5lID0gZnJvbTtcbiAgICAgIHBvcy5jaCA9IDA7XG4gICAgfVxuICB9XG5cbiAgLy8gVHJpZXMgdG8gcmViYXNlIGFuIGFycmF5IG9mIGhpc3RvcnkgZXZlbnRzIGdpdmVuIGEgY2hhbmdlIGluIHRoZVxuICAvLyBkb2N1bWVudC4gSWYgdGhlIGNoYW5nZSB0b3VjaGVzIHRoZSBzYW1lIGxpbmVzIGFzIHRoZSBldmVudCwgdGhlXG4gIC8vIGV2ZW50LCBhbmQgZXZlcnl0aGluZyAnYmVoaW5kJyBpdCwgaXMgZGlzY2FyZGVkLiBJZiB0aGUgY2hhbmdlIGlzXG4gIC8vIGJlZm9yZSB0aGUgZXZlbnQsIHRoZSBldmVudCdzIHBvc2l0aW9ucyBhcmUgdXBkYXRlZC4gVXNlcyBhXG4gIC8vIGNvcHktb24td3JpdGUgc2NoZW1lIGZvciB0aGUgcG9zaXRpb25zLCB0byBhdm9pZCBoYXZpbmcgdG9cbiAgLy8gcmVhbGxvY2F0ZSB0aGVtIGFsbCBvbiBldmVyeSByZWJhc2UsIGJ1dCBhbHNvIGF2b2lkIHByb2JsZW1zIHdpdGhcbiAgLy8gc2hhcmVkIHBvc2l0aW9uIG9iamVjdHMgYmVpbmcgdW5zYWZlbHkgdXBkYXRlZC5cbiAgZnVuY3Rpb24gcmViYXNlSGlzdEFycmF5KGFycmF5LCBmcm9tLCB0bywgZGlmZikge1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYXJyYXkubGVuZ3RoOyArK2kpIHtcbiAgICAgIHZhciBzdWIgPSBhcnJheVtpXSwgb2sgPSB0cnVlO1xuICAgICAgaWYgKHN1Yi5yYW5nZXMpIHtcbiAgICAgICAgaWYgKCFzdWIuY29waWVkKSB7IHN1YiA9IGFycmF5W2ldID0gc3ViLmRlZXBDb3B5KCk7IHN1Yi5jb3BpZWQgPSB0cnVlOyB9XG4gICAgICAgIGZvciAodmFyIGogPSAwOyBqIDwgc3ViLnJhbmdlcy5sZW5ndGg7IGorKykge1xuICAgICAgICAgIHJlYmFzZUhpc3RTZWxTaW5nbGUoc3ViLnJhbmdlc1tqXS5hbmNob3IsIGZyb20sIHRvLCBkaWZmKTtcbiAgICAgICAgICByZWJhc2VIaXN0U2VsU2luZ2xlKHN1Yi5yYW5nZXNbal0uaGVhZCwgZnJvbSwgdG8sIGRpZmYpO1xuICAgICAgICB9XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgZm9yICh2YXIgaiA9IDA7IGogPCBzdWIuY2hhbmdlcy5sZW5ndGg7ICsraikge1xuICAgICAgICB2YXIgY3VyID0gc3ViLmNoYW5nZXNbal07XG4gICAgICAgIGlmICh0byA8IGN1ci5mcm9tLmxpbmUpIHtcbiAgICAgICAgICBjdXIuZnJvbSA9IFBvcyhjdXIuZnJvbS5saW5lICsgZGlmZiwgY3VyLmZyb20uY2gpO1xuICAgICAgICAgIGN1ci50byA9IFBvcyhjdXIudG8ubGluZSArIGRpZmYsIGN1ci50by5jaCk7XG4gICAgICAgIH0gZWxzZSBpZiAoZnJvbSA8PSBjdXIudG8ubGluZSkge1xuICAgICAgICAgIG9rID0gZmFsc2U7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmICghb2spIHtcbiAgICAgICAgYXJyYXkuc3BsaWNlKDAsIGkgKyAxKTtcbiAgICAgICAgaSA9IDA7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gcmViYXNlSGlzdChoaXN0LCBjaGFuZ2UpIHtcbiAgICB2YXIgZnJvbSA9IGNoYW5nZS5mcm9tLmxpbmUsIHRvID0gY2hhbmdlLnRvLmxpbmUsIGRpZmYgPSBjaGFuZ2UudGV4dC5sZW5ndGggLSAodG8gLSBmcm9tKSAtIDE7XG4gICAgcmViYXNlSGlzdEFycmF5KGhpc3QuZG9uZSwgZnJvbSwgdG8sIGRpZmYpO1xuICAgIHJlYmFzZUhpc3RBcnJheShoaXN0LnVuZG9uZSwgZnJvbSwgdG8sIGRpZmYpO1xuICB9XG5cbiAgLy8gRVZFTlQgVVRJTElUSUVTXG5cbiAgLy8gRHVlIHRvIHRoZSBmYWN0IHRoYXQgd2Ugc3RpbGwgc3VwcG9ydCBqdXJhc3NpYyBJRSB2ZXJzaW9ucywgc29tZVxuICAvLyBjb21wYXRpYmlsaXR5IHdyYXBwZXJzIGFyZSBuZWVkZWQuXG5cbiAgdmFyIGVfcHJldmVudERlZmF1bHQgPSBDb2RlTWlycm9yLmVfcHJldmVudERlZmF1bHQgPSBmdW5jdGlvbihlKSB7XG4gICAgaWYgKGUucHJldmVudERlZmF1bHQpIGUucHJldmVudERlZmF1bHQoKTtcbiAgICBlbHNlIGUucmV0dXJuVmFsdWUgPSBmYWxzZTtcbiAgfTtcbiAgdmFyIGVfc3RvcFByb3BhZ2F0aW9uID0gQ29kZU1pcnJvci5lX3N0b3BQcm9wYWdhdGlvbiA9IGZ1bmN0aW9uKGUpIHtcbiAgICBpZiAoZS5zdG9wUHJvcGFnYXRpb24pIGUuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgZWxzZSBlLmNhbmNlbEJ1YmJsZSA9IHRydWU7XG4gIH07XG4gIGZ1bmN0aW9uIGVfZGVmYXVsdFByZXZlbnRlZChlKSB7XG4gICAgcmV0dXJuIGUuZGVmYXVsdFByZXZlbnRlZCAhPSBudWxsID8gZS5kZWZhdWx0UHJldmVudGVkIDogZS5yZXR1cm5WYWx1ZSA9PSBmYWxzZTtcbiAgfVxuICB2YXIgZV9zdG9wID0gQ29kZU1pcnJvci5lX3N0b3AgPSBmdW5jdGlvbihlKSB7ZV9wcmV2ZW50RGVmYXVsdChlKTsgZV9zdG9wUHJvcGFnYXRpb24oZSk7fTtcblxuICBmdW5jdGlvbiBlX3RhcmdldChlKSB7cmV0dXJuIGUudGFyZ2V0IHx8IGUuc3JjRWxlbWVudDt9XG4gIGZ1bmN0aW9uIGVfYnV0dG9uKGUpIHtcbiAgICB2YXIgYiA9IGUud2hpY2g7XG4gICAgaWYgKGIgPT0gbnVsbCkge1xuICAgICAgaWYgKGUuYnV0dG9uICYgMSkgYiA9IDE7XG4gICAgICBlbHNlIGlmIChlLmJ1dHRvbiAmIDIpIGIgPSAzO1xuICAgICAgZWxzZSBpZiAoZS5idXR0b24gJiA0KSBiID0gMjtcbiAgICB9XG4gICAgaWYgKG1hYyAmJiBlLmN0cmxLZXkgJiYgYiA9PSAxKSBiID0gMztcbiAgICByZXR1cm4gYjtcbiAgfVxuXG4gIC8vIEVWRU5UIEhBTkRMSU5HXG5cbiAgLy8gTGlnaHR3ZWlnaHQgZXZlbnQgZnJhbWV3b3JrLiBvbi9vZmYgYWxzbyB3b3JrIG9uIERPTSBub2RlcyxcbiAgLy8gcmVnaXN0ZXJpbmcgbmF0aXZlIERPTSBoYW5kbGVycy5cblxuICB2YXIgb24gPSBDb2RlTWlycm9yLm9uID0gZnVuY3Rpb24oZW1pdHRlciwgdHlwZSwgZikge1xuICAgIGlmIChlbWl0dGVyLmFkZEV2ZW50TGlzdGVuZXIpXG4gICAgICBlbWl0dGVyLmFkZEV2ZW50TGlzdGVuZXIodHlwZSwgZiwgZmFsc2UpO1xuICAgIGVsc2UgaWYgKGVtaXR0ZXIuYXR0YWNoRXZlbnQpXG4gICAgICBlbWl0dGVyLmF0dGFjaEV2ZW50KFwib25cIiArIHR5cGUsIGYpO1xuICAgIGVsc2Uge1xuICAgICAgdmFyIG1hcCA9IGVtaXR0ZXIuX2hhbmRsZXJzIHx8IChlbWl0dGVyLl9oYW5kbGVycyA9IHt9KTtcbiAgICAgIHZhciBhcnIgPSBtYXBbdHlwZV0gfHwgKG1hcFt0eXBlXSA9IFtdKTtcbiAgICAgIGFyci5wdXNoKGYpO1xuICAgIH1cbiAgfTtcblxuICB2YXIgb2ZmID0gQ29kZU1pcnJvci5vZmYgPSBmdW5jdGlvbihlbWl0dGVyLCB0eXBlLCBmKSB7XG4gICAgaWYgKGVtaXR0ZXIucmVtb3ZlRXZlbnRMaXN0ZW5lcilcbiAgICAgIGVtaXR0ZXIucmVtb3ZlRXZlbnRMaXN0ZW5lcih0eXBlLCBmLCBmYWxzZSk7XG4gICAgZWxzZSBpZiAoZW1pdHRlci5kZXRhY2hFdmVudClcbiAgICAgIGVtaXR0ZXIuZGV0YWNoRXZlbnQoXCJvblwiICsgdHlwZSwgZik7XG4gICAgZWxzZSB7XG4gICAgICB2YXIgYXJyID0gZW1pdHRlci5faGFuZGxlcnMgJiYgZW1pdHRlci5faGFuZGxlcnNbdHlwZV07XG4gICAgICBpZiAoIWFycikgcmV0dXJuO1xuICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBhcnIubGVuZ3RoOyArK2kpXG4gICAgICAgIGlmIChhcnJbaV0gPT0gZikgeyBhcnIuc3BsaWNlKGksIDEpOyBicmVhazsgfVxuICAgIH1cbiAgfTtcblxuICB2YXIgc2lnbmFsID0gQ29kZU1pcnJvci5zaWduYWwgPSBmdW5jdGlvbihlbWl0dGVyLCB0eXBlIC8qLCB2YWx1ZXMuLi4qLykge1xuICAgIHZhciBhcnIgPSBlbWl0dGVyLl9oYW5kbGVycyAmJiBlbWl0dGVyLl9oYW5kbGVyc1t0eXBlXTtcbiAgICBpZiAoIWFycikgcmV0dXJuO1xuICAgIHZhciBhcmdzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAyKTtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGFyci5sZW5ndGg7ICsraSkgYXJyW2ldLmFwcGx5KG51bGwsIGFyZ3MpO1xuICB9O1xuXG4gIHZhciBvcnBoYW5EZWxheWVkQ2FsbGJhY2tzID0gbnVsbDtcblxuICAvLyBPZnRlbiwgd2Ugd2FudCB0byBzaWduYWwgZXZlbnRzIGF0IGEgcG9pbnQgd2hlcmUgd2UgYXJlIGluIHRoZVxuICAvLyBtaWRkbGUgb2Ygc29tZSB3b3JrLCBidXQgZG9uJ3Qgd2FudCB0aGUgaGFuZGxlciB0byBzdGFydCBjYWxsaW5nXG4gIC8vIG90aGVyIG1ldGhvZHMgb24gdGhlIGVkaXRvciwgd2hpY2ggbWlnaHQgYmUgaW4gYW4gaW5jb25zaXN0ZW50XG4gIC8vIHN0YXRlIG9yIHNpbXBseSBub3QgZXhwZWN0IGFueSBvdGhlciBldmVudHMgdG8gaGFwcGVuLlxuICAvLyBzaWduYWxMYXRlciBsb29rcyB3aGV0aGVyIHRoZXJlIGFyZSBhbnkgaGFuZGxlcnMsIGFuZCBzY2hlZHVsZXNcbiAgLy8gdGhlbSB0byBiZSBleGVjdXRlZCB3aGVuIHRoZSBsYXN0IG9wZXJhdGlvbiBlbmRzLCBvciwgaWYgbm9cbiAgLy8gb3BlcmF0aW9uIGlzIGFjdGl2ZSwgd2hlbiBhIHRpbWVvdXQgZmlyZXMuXG4gIGZ1bmN0aW9uIHNpZ25hbExhdGVyKGVtaXR0ZXIsIHR5cGUgLyosIHZhbHVlcy4uLiovKSB7XG4gICAgdmFyIGFyciA9IGVtaXR0ZXIuX2hhbmRsZXJzICYmIGVtaXR0ZXIuX2hhbmRsZXJzW3R5cGVdO1xuICAgIGlmICghYXJyKSByZXR1cm47XG4gICAgdmFyIGFyZ3MgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMsIDIpLCBsaXN0O1xuICAgIGlmIChvcGVyYXRpb25Hcm91cCkge1xuICAgICAgbGlzdCA9IG9wZXJhdGlvbkdyb3VwLmRlbGF5ZWRDYWxsYmFja3M7XG4gICAgfSBlbHNlIGlmIChvcnBoYW5EZWxheWVkQ2FsbGJhY2tzKSB7XG4gICAgICBsaXN0ID0gb3JwaGFuRGVsYXllZENhbGxiYWNrcztcbiAgICB9IGVsc2Uge1xuICAgICAgbGlzdCA9IG9ycGhhbkRlbGF5ZWRDYWxsYmFja3MgPSBbXTtcbiAgICAgIHNldFRpbWVvdXQoZmlyZU9ycGhhbkRlbGF5ZWQsIDApO1xuICAgIH1cbiAgICBmdW5jdGlvbiBibmQoZikge3JldHVybiBmdW5jdGlvbigpe2YuYXBwbHkobnVsbCwgYXJncyk7fTt9O1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYXJyLmxlbmd0aDsgKytpKVxuICAgICAgbGlzdC5wdXNoKGJuZChhcnJbaV0pKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGZpcmVPcnBoYW5EZWxheWVkKCkge1xuICAgIHZhciBkZWxheWVkID0gb3JwaGFuRGVsYXllZENhbGxiYWNrcztcbiAgICBvcnBoYW5EZWxheWVkQ2FsbGJhY2tzID0gbnVsbDtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGRlbGF5ZWQubGVuZ3RoOyArK2kpIGRlbGF5ZWRbaV0oKTtcbiAgfVxuXG4gIC8vIFRoZSBET00gZXZlbnRzIHRoYXQgQ29kZU1pcnJvciBoYW5kbGVzIGNhbiBiZSBvdmVycmlkZGVuIGJ5XG4gIC8vIHJlZ2lzdGVyaW5nIGEgKG5vbi1ET00pIGhhbmRsZXIgb24gdGhlIGVkaXRvciBmb3IgdGhlIGV2ZW50IG5hbWUsXG4gIC8vIGFuZCBwcmV2ZW50RGVmYXVsdC1pbmcgdGhlIGV2ZW50IGluIHRoYXQgaGFuZGxlci5cbiAgZnVuY3Rpb24gc2lnbmFsRE9NRXZlbnQoY20sIGUsIG92ZXJyaWRlKSB7XG4gICAgaWYgKHR5cGVvZiBlID09IFwic3RyaW5nXCIpXG4gICAgICBlID0ge3R5cGU6IGUsIHByZXZlbnREZWZhdWx0OiBmdW5jdGlvbigpIHsgdGhpcy5kZWZhdWx0UHJldmVudGVkID0gdHJ1ZTsgfX07XG4gICAgc2lnbmFsKGNtLCBvdmVycmlkZSB8fCBlLnR5cGUsIGNtLCBlKTtcbiAgICByZXR1cm4gZV9kZWZhdWx0UHJldmVudGVkKGUpIHx8IGUuY29kZW1pcnJvcklnbm9yZTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHNpZ25hbEN1cnNvckFjdGl2aXR5KGNtKSB7XG4gICAgdmFyIGFyciA9IGNtLl9oYW5kbGVycyAmJiBjbS5faGFuZGxlcnMuY3Vyc29yQWN0aXZpdHk7XG4gICAgaWYgKCFhcnIpIHJldHVybjtcbiAgICB2YXIgc2V0ID0gY20uY3VyT3AuY3Vyc29yQWN0aXZpdHlIYW5kbGVycyB8fCAoY20uY3VyT3AuY3Vyc29yQWN0aXZpdHlIYW5kbGVycyA9IFtdKTtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGFyci5sZW5ndGg7ICsraSkgaWYgKGluZGV4T2Yoc2V0LCBhcnJbaV0pID09IC0xKVxuICAgICAgc2V0LnB1c2goYXJyW2ldKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGhhc0hhbmRsZXIoZW1pdHRlciwgdHlwZSkge1xuICAgIHZhciBhcnIgPSBlbWl0dGVyLl9oYW5kbGVycyAmJiBlbWl0dGVyLl9oYW5kbGVyc1t0eXBlXTtcbiAgICByZXR1cm4gYXJyICYmIGFyci5sZW5ndGggPiAwO1xuICB9XG5cbiAgLy8gQWRkIG9uIGFuZCBvZmYgbWV0aG9kcyB0byBhIGNvbnN0cnVjdG9yJ3MgcHJvdG90eXBlLCB0byBtYWtlXG4gIC8vIHJlZ2lzdGVyaW5nIGV2ZW50cyBvbiBzdWNoIG9iamVjdHMgbW9yZSBjb252ZW5pZW50LlxuICBmdW5jdGlvbiBldmVudE1peGluKGN0b3IpIHtcbiAgICBjdG9yLnByb3RvdHlwZS5vbiA9IGZ1bmN0aW9uKHR5cGUsIGYpIHtvbih0aGlzLCB0eXBlLCBmKTt9O1xuICAgIGN0b3IucHJvdG90eXBlLm9mZiA9IGZ1bmN0aW9uKHR5cGUsIGYpIHtvZmYodGhpcywgdHlwZSwgZik7fTtcbiAgfVxuXG4gIC8vIE1JU0MgVVRJTElUSUVTXG5cbiAgLy8gTnVtYmVyIG9mIHBpeGVscyBhZGRlZCB0byBzY3JvbGxlciBhbmQgc2l6ZXIgdG8gaGlkZSBzY3JvbGxiYXJcbiAgdmFyIHNjcm9sbGVyR2FwID0gMzA7XG5cbiAgLy8gUmV0dXJuZWQgb3IgdGhyb3duIGJ5IHZhcmlvdXMgcHJvdG9jb2xzIHRvIHNpZ25hbCAnSSdtIG5vdFxuICAvLyBoYW5kbGluZyB0aGlzJy5cbiAgdmFyIFBhc3MgPSBDb2RlTWlycm9yLlBhc3MgPSB7dG9TdHJpbmc6IGZ1bmN0aW9uKCl7cmV0dXJuIFwiQ29kZU1pcnJvci5QYXNzXCI7fX07XG5cbiAgLy8gUmV1c2VkIG9wdGlvbiBvYmplY3RzIGZvciBzZXRTZWxlY3Rpb24gJiBmcmllbmRzXG4gIHZhciBzZWxfZG9udFNjcm9sbCA9IHtzY3JvbGw6IGZhbHNlfSwgc2VsX21vdXNlID0ge29yaWdpbjogXCIqbW91c2VcIn0sIHNlbF9tb3ZlID0ge29yaWdpbjogXCIrbW92ZVwifTtcblxuICBmdW5jdGlvbiBEZWxheWVkKCkge3RoaXMuaWQgPSBudWxsO31cbiAgRGVsYXllZC5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24obXMsIGYpIHtcbiAgICBjbGVhclRpbWVvdXQodGhpcy5pZCk7XG4gICAgdGhpcy5pZCA9IHNldFRpbWVvdXQoZiwgbXMpO1xuICB9O1xuXG4gIC8vIENvdW50cyB0aGUgY29sdW1uIG9mZnNldCBpbiBhIHN0cmluZywgdGFraW5nIHRhYnMgaW50byBhY2NvdW50LlxuICAvLyBVc2VkIG1vc3RseSB0byBmaW5kIGluZGVudGF0aW9uLlxuICB2YXIgY291bnRDb2x1bW4gPSBDb2RlTWlycm9yLmNvdW50Q29sdW1uID0gZnVuY3Rpb24oc3RyaW5nLCBlbmQsIHRhYlNpemUsIHN0YXJ0SW5kZXgsIHN0YXJ0VmFsdWUpIHtcbiAgICBpZiAoZW5kID09IG51bGwpIHtcbiAgICAgIGVuZCA9IHN0cmluZy5zZWFyY2goL1teXFxzXFx1MDBhMF0vKTtcbiAgICAgIGlmIChlbmQgPT0gLTEpIGVuZCA9IHN0cmluZy5sZW5ndGg7XG4gICAgfVxuICAgIGZvciAodmFyIGkgPSBzdGFydEluZGV4IHx8IDAsIG4gPSBzdGFydFZhbHVlIHx8IDA7Oykge1xuICAgICAgdmFyIG5leHRUYWIgPSBzdHJpbmcuaW5kZXhPZihcIlxcdFwiLCBpKTtcbiAgICAgIGlmIChuZXh0VGFiIDwgMCB8fCBuZXh0VGFiID49IGVuZClcbiAgICAgICAgcmV0dXJuIG4gKyAoZW5kIC0gaSk7XG4gICAgICBuICs9IG5leHRUYWIgLSBpO1xuICAgICAgbiArPSB0YWJTaXplIC0gKG4gJSB0YWJTaXplKTtcbiAgICAgIGkgPSBuZXh0VGFiICsgMTtcbiAgICB9XG4gIH07XG5cbiAgLy8gVGhlIGludmVyc2Ugb2YgY291bnRDb2x1bW4gLS0gZmluZCB0aGUgb2Zmc2V0IHRoYXQgY29ycmVzcG9uZHMgdG9cbiAgLy8gYSBwYXJ0aWN1bGFyIGNvbHVtbi5cbiAgZnVuY3Rpb24gZmluZENvbHVtbihzdHJpbmcsIGdvYWwsIHRhYlNpemUpIHtcbiAgICBmb3IgKHZhciBwb3MgPSAwLCBjb2wgPSAwOzspIHtcbiAgICAgIHZhciBuZXh0VGFiID0gc3RyaW5nLmluZGV4T2YoXCJcXHRcIiwgcG9zKTtcbiAgICAgIGlmIChuZXh0VGFiID09IC0xKSBuZXh0VGFiID0gc3RyaW5nLmxlbmd0aDtcbiAgICAgIHZhciBza2lwcGVkID0gbmV4dFRhYiAtIHBvcztcbiAgICAgIGlmIChuZXh0VGFiID09IHN0cmluZy5sZW5ndGggfHwgY29sICsgc2tpcHBlZCA+PSBnb2FsKVxuICAgICAgICByZXR1cm4gcG9zICsgTWF0aC5taW4oc2tpcHBlZCwgZ29hbCAtIGNvbCk7XG4gICAgICBjb2wgKz0gbmV4dFRhYiAtIHBvcztcbiAgICAgIGNvbCArPSB0YWJTaXplIC0gKGNvbCAlIHRhYlNpemUpO1xuICAgICAgcG9zID0gbmV4dFRhYiArIDE7XG4gICAgICBpZiAoY29sID49IGdvYWwpIHJldHVybiBwb3M7XG4gICAgfVxuICB9XG5cbiAgdmFyIHNwYWNlU3RycyA9IFtcIlwiXTtcbiAgZnVuY3Rpb24gc3BhY2VTdHIobikge1xuICAgIHdoaWxlIChzcGFjZVN0cnMubGVuZ3RoIDw9IG4pXG4gICAgICBzcGFjZVN0cnMucHVzaChsc3Qoc3BhY2VTdHJzKSArIFwiIFwiKTtcbiAgICByZXR1cm4gc3BhY2VTdHJzW25dO1xuICB9XG5cbiAgZnVuY3Rpb24gbHN0KGFycikgeyByZXR1cm4gYXJyW2Fyci5sZW5ndGgtMV07IH1cblxuICB2YXIgc2VsZWN0SW5wdXQgPSBmdW5jdGlvbihub2RlKSB7IG5vZGUuc2VsZWN0KCk7IH07XG4gIGlmIChpb3MpIC8vIE1vYmlsZSBTYWZhcmkgYXBwYXJlbnRseSBoYXMgYSBidWcgd2hlcmUgc2VsZWN0KCkgaXMgYnJva2VuLlxuICAgIHNlbGVjdElucHV0ID0gZnVuY3Rpb24obm9kZSkgeyBub2RlLnNlbGVjdGlvblN0YXJ0ID0gMDsgbm9kZS5zZWxlY3Rpb25FbmQgPSBub2RlLnZhbHVlLmxlbmd0aDsgfTtcbiAgZWxzZSBpZiAoaWUpIC8vIFN1cHByZXNzIG15c3RlcmlvdXMgSUUxMCBlcnJvcnNcbiAgICBzZWxlY3RJbnB1dCA9IGZ1bmN0aW9uKG5vZGUpIHsgdHJ5IHsgbm9kZS5zZWxlY3QoKTsgfSBjYXRjaChfZSkge30gfTtcblxuICBmdW5jdGlvbiBpbmRleE9mKGFycmF5LCBlbHQpIHtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGFycmF5Lmxlbmd0aDsgKytpKVxuICAgICAgaWYgKGFycmF5W2ldID09IGVsdCkgcmV0dXJuIGk7XG4gICAgcmV0dXJuIC0xO1xuICB9XG4gIGZ1bmN0aW9uIG1hcChhcnJheSwgZikge1xuICAgIHZhciBvdXQgPSBbXTtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGFycmF5Lmxlbmd0aDsgaSsrKSBvdXRbaV0gPSBmKGFycmF5W2ldLCBpKTtcbiAgICByZXR1cm4gb3V0O1xuICB9XG5cbiAgZnVuY3Rpb24gbm90aGluZygpIHt9XG5cbiAgZnVuY3Rpb24gY3JlYXRlT2JqKGJhc2UsIHByb3BzKSB7XG4gICAgdmFyIGluc3Q7XG4gICAgaWYgKE9iamVjdC5jcmVhdGUpIHtcbiAgICAgIGluc3QgPSBPYmplY3QuY3JlYXRlKGJhc2UpO1xuICAgIH0gZWxzZSB7XG4gICAgICBub3RoaW5nLnByb3RvdHlwZSA9IGJhc2U7XG4gICAgICBpbnN0ID0gbmV3IG5vdGhpbmcoKTtcbiAgICB9XG4gICAgaWYgKHByb3BzKSBjb3B5T2JqKHByb3BzLCBpbnN0KTtcbiAgICByZXR1cm4gaW5zdDtcbiAgfTtcblxuICBmdW5jdGlvbiBjb3B5T2JqKG9iaiwgdGFyZ2V0LCBvdmVyd3JpdGUpIHtcbiAgICBpZiAoIXRhcmdldCkgdGFyZ2V0ID0ge307XG4gICAgZm9yICh2YXIgcHJvcCBpbiBvYmopXG4gICAgICBpZiAob2JqLmhhc093blByb3BlcnR5KHByb3ApICYmIChvdmVyd3JpdGUgIT09IGZhbHNlIHx8ICF0YXJnZXQuaGFzT3duUHJvcGVydHkocHJvcCkpKVxuICAgICAgICB0YXJnZXRbcHJvcF0gPSBvYmpbcHJvcF07XG4gICAgcmV0dXJuIHRhcmdldDtcbiAgfVxuXG4gIGZ1bmN0aW9uIGJpbmQoZikge1xuICAgIHZhciBhcmdzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKTtcbiAgICByZXR1cm4gZnVuY3Rpb24oKXtyZXR1cm4gZi5hcHBseShudWxsLCBhcmdzKTt9O1xuICB9XG5cbiAgdmFyIG5vbkFTQ0lJU2luZ2xlQ2FzZVdvcmRDaGFyID0gL1tcXHUwMGRmXFx1MDU4N1xcdTA1OTAtXFx1MDVmNFxcdTA2MDAtXFx1MDZmZlxcdTMwNDAtXFx1MzA5ZlxcdTMwYTAtXFx1MzBmZlxcdTM0MDAtXFx1NGRiNVxcdTRlMDAtXFx1OWZjY1xcdWFjMDAtXFx1ZDdhZl0vO1xuICB2YXIgaXNXb3JkQ2hhckJhc2ljID0gQ29kZU1pcnJvci5pc1dvcmRDaGFyID0gZnVuY3Rpb24oY2gpIHtcbiAgICByZXR1cm4gL1xcdy8udGVzdChjaCkgfHwgY2ggPiBcIlxceDgwXCIgJiZcbiAgICAgIChjaC50b1VwcGVyQ2FzZSgpICE9IGNoLnRvTG93ZXJDYXNlKCkgfHwgbm9uQVNDSUlTaW5nbGVDYXNlV29yZENoYXIudGVzdChjaCkpO1xuICB9O1xuICBmdW5jdGlvbiBpc1dvcmRDaGFyKGNoLCBoZWxwZXIpIHtcbiAgICBpZiAoIWhlbHBlcikgcmV0dXJuIGlzV29yZENoYXJCYXNpYyhjaCk7XG4gICAgaWYgKGhlbHBlci5zb3VyY2UuaW5kZXhPZihcIlxcXFx3XCIpID4gLTEgJiYgaXNXb3JkQ2hhckJhc2ljKGNoKSkgcmV0dXJuIHRydWU7XG4gICAgcmV0dXJuIGhlbHBlci50ZXN0KGNoKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGlzRW1wdHkob2JqKSB7XG4gICAgZm9yICh2YXIgbiBpbiBvYmopIGlmIChvYmouaGFzT3duUHJvcGVydHkobikgJiYgb2JqW25dKSByZXR1cm4gZmFsc2U7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICAvLyBFeHRlbmRpbmcgdW5pY29kZSBjaGFyYWN0ZXJzLiBBIHNlcmllcyBvZiBhIG5vbi1leHRlbmRpbmcgY2hhciArXG4gIC8vIGFueSBudW1iZXIgb2YgZXh0ZW5kaW5nIGNoYXJzIGlzIHRyZWF0ZWQgYXMgYSBzaW5nbGUgdW5pdCBhcyBmYXJcbiAgLy8gYXMgZWRpdGluZyBhbmQgbWVhc3VyaW5nIGlzIGNvbmNlcm5lZC4gVGhpcyBpcyBub3QgZnVsbHkgY29ycmVjdCxcbiAgLy8gc2luY2Ugc29tZSBzY3JpcHRzL2ZvbnRzL2Jyb3dzZXJzIGFsc28gdHJlYXQgb3RoZXIgY29uZmlndXJhdGlvbnNcbiAgLy8gb2YgY29kZSBwb2ludHMgYXMgYSBncm91cC5cbiAgdmFyIGV4dGVuZGluZ0NoYXJzID0gL1tcXHUwMzAwLVxcdTAzNmZcXHUwNDgzLVxcdTA0ODlcXHUwNTkxLVxcdTA1YmRcXHUwNWJmXFx1MDVjMVxcdTA1YzJcXHUwNWM0XFx1MDVjNVxcdTA1YzdcXHUwNjEwLVxcdTA2MWFcXHUwNjRiLVxcdTA2NWVcXHUwNjcwXFx1MDZkNi1cXHUwNmRjXFx1MDZkZS1cXHUwNmU0XFx1MDZlN1xcdTA2ZThcXHUwNmVhLVxcdTA2ZWRcXHUwNzExXFx1MDczMC1cXHUwNzRhXFx1MDdhNi1cXHUwN2IwXFx1MDdlYi1cXHUwN2YzXFx1MDgxNi1cXHUwODE5XFx1MDgxYi1cXHUwODIzXFx1MDgyNS1cXHUwODI3XFx1MDgyOS1cXHUwODJkXFx1MDkwMC1cXHUwOTAyXFx1MDkzY1xcdTA5NDEtXFx1MDk0OFxcdTA5NGRcXHUwOTUxLVxcdTA5NTVcXHUwOTYyXFx1MDk2M1xcdTA5ODFcXHUwOWJjXFx1MDliZVxcdTA5YzEtXFx1MDljNFxcdTA5Y2RcXHUwOWQ3XFx1MDllMlxcdTA5ZTNcXHUwYTAxXFx1MGEwMlxcdTBhM2NcXHUwYTQxXFx1MGE0MlxcdTBhNDdcXHUwYTQ4XFx1MGE0Yi1cXHUwYTRkXFx1MGE1MVxcdTBhNzBcXHUwYTcxXFx1MGE3NVxcdTBhODFcXHUwYTgyXFx1MGFiY1xcdTBhYzEtXFx1MGFjNVxcdTBhYzdcXHUwYWM4XFx1MGFjZFxcdTBhZTJcXHUwYWUzXFx1MGIwMVxcdTBiM2NcXHUwYjNlXFx1MGIzZlxcdTBiNDEtXFx1MGI0NFxcdTBiNGRcXHUwYjU2XFx1MGI1N1xcdTBiNjJcXHUwYjYzXFx1MGI4MlxcdTBiYmVcXHUwYmMwXFx1MGJjZFxcdTBiZDdcXHUwYzNlLVxcdTBjNDBcXHUwYzQ2LVxcdTBjNDhcXHUwYzRhLVxcdTBjNGRcXHUwYzU1XFx1MGM1NlxcdTBjNjJcXHUwYzYzXFx1MGNiY1xcdTBjYmZcXHUwY2MyXFx1MGNjNlxcdTBjY2NcXHUwY2NkXFx1MGNkNVxcdTBjZDZcXHUwY2UyXFx1MGNlM1xcdTBkM2VcXHUwZDQxLVxcdTBkNDRcXHUwZDRkXFx1MGQ1N1xcdTBkNjJcXHUwZDYzXFx1MGRjYVxcdTBkY2ZcXHUwZGQyLVxcdTBkZDRcXHUwZGQ2XFx1MGRkZlxcdTBlMzFcXHUwZTM0LVxcdTBlM2FcXHUwZTQ3LVxcdTBlNGVcXHUwZWIxXFx1MGViNC1cXHUwZWI5XFx1MGViYlxcdTBlYmNcXHUwZWM4LVxcdTBlY2RcXHUwZjE4XFx1MGYxOVxcdTBmMzVcXHUwZjM3XFx1MGYzOVxcdTBmNzEtXFx1MGY3ZVxcdTBmODAtXFx1MGY4NFxcdTBmODZcXHUwZjg3XFx1MGY5MC1cXHUwZjk3XFx1MGY5OS1cXHUwZmJjXFx1MGZjNlxcdTEwMmQtXFx1MTAzMFxcdTEwMzItXFx1MTAzN1xcdTEwMzlcXHUxMDNhXFx1MTAzZFxcdTEwM2VcXHUxMDU4XFx1MTA1OVxcdTEwNWUtXFx1MTA2MFxcdTEwNzEtXFx1MTA3NFxcdTEwODJcXHUxMDg1XFx1MTA4NlxcdTEwOGRcXHUxMDlkXFx1MTM1ZlxcdTE3MTItXFx1MTcxNFxcdTE3MzItXFx1MTczNFxcdTE3NTJcXHUxNzUzXFx1MTc3MlxcdTE3NzNcXHUxN2I3LVxcdTE3YmRcXHUxN2M2XFx1MTdjOS1cXHUxN2QzXFx1MTdkZFxcdTE4MGItXFx1MTgwZFxcdTE4YTlcXHUxOTIwLVxcdTE5MjJcXHUxOTI3XFx1MTkyOFxcdTE5MzJcXHUxOTM5LVxcdTE5M2JcXHUxYTE3XFx1MWExOFxcdTFhNTZcXHUxYTU4LVxcdTFhNWVcXHUxYTYwXFx1MWE2MlxcdTFhNjUtXFx1MWE2Y1xcdTFhNzMtXFx1MWE3Y1xcdTFhN2ZcXHUxYjAwLVxcdTFiMDNcXHUxYjM0XFx1MWIzNi1cXHUxYjNhXFx1MWIzY1xcdTFiNDJcXHUxYjZiLVxcdTFiNzNcXHUxYjgwXFx1MWI4MVxcdTFiYTItXFx1MWJhNVxcdTFiYThcXHUxYmE5XFx1MWMyYy1cXHUxYzMzXFx1MWMzNlxcdTFjMzdcXHUxY2QwLVxcdTFjZDJcXHUxY2Q0LVxcdTFjZTBcXHUxY2UyLVxcdTFjZThcXHUxY2VkXFx1MWRjMC1cXHUxZGU2XFx1MWRmZC1cXHUxZGZmXFx1MjAwY1xcdTIwMGRcXHUyMGQwLVxcdTIwZjBcXHUyY2VmLVxcdTJjZjFcXHUyZGUwLVxcdTJkZmZcXHUzMDJhLVxcdTMwMmZcXHUzMDk5XFx1MzA5YVxcdWE2NmYtXFx1YTY3MlxcdWE2N2NcXHVhNjdkXFx1YTZmMFxcdWE2ZjFcXHVhODAyXFx1YTgwNlxcdWE4MGJcXHVhODI1XFx1YTgyNlxcdWE4YzRcXHVhOGUwLVxcdWE4ZjFcXHVhOTI2LVxcdWE5MmRcXHVhOTQ3LVxcdWE5NTFcXHVhOTgwLVxcdWE5ODJcXHVhOWIzXFx1YTliNi1cXHVhOWI5XFx1YTliY1xcdWFhMjktXFx1YWEyZVxcdWFhMzFcXHVhYTMyXFx1YWEzNVxcdWFhMzZcXHVhYTQzXFx1YWE0Y1xcdWFhYjBcXHVhYWIyLVxcdWFhYjRcXHVhYWI3XFx1YWFiOFxcdWFhYmVcXHVhYWJmXFx1YWFjMVxcdWFiZTVcXHVhYmU4XFx1YWJlZFxcdWRjMDAtXFx1ZGZmZlxcdWZiMWVcXHVmZTAwLVxcdWZlMGZcXHVmZTIwLVxcdWZlMjZcXHVmZjllXFx1ZmY5Zl0vO1xuICBmdW5jdGlvbiBpc0V4dGVuZGluZ0NoYXIoY2gpIHsgcmV0dXJuIGNoLmNoYXJDb2RlQXQoMCkgPj0gNzY4ICYmIGV4dGVuZGluZ0NoYXJzLnRlc3QoY2gpOyB9XG5cbiAgLy8gRE9NIFVUSUxJVElFU1xuXG4gIGZ1bmN0aW9uIGVsdCh0YWcsIGNvbnRlbnQsIGNsYXNzTmFtZSwgc3R5bGUpIHtcbiAgICB2YXIgZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQodGFnKTtcbiAgICBpZiAoY2xhc3NOYW1lKSBlLmNsYXNzTmFtZSA9IGNsYXNzTmFtZTtcbiAgICBpZiAoc3R5bGUpIGUuc3R5bGUuY3NzVGV4dCA9IHN0eWxlO1xuICAgIGlmICh0eXBlb2YgY29udGVudCA9PSBcInN0cmluZ1wiKSBlLmFwcGVuZENoaWxkKGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKGNvbnRlbnQpKTtcbiAgICBlbHNlIGlmIChjb250ZW50KSBmb3IgKHZhciBpID0gMDsgaSA8IGNvbnRlbnQubGVuZ3RoOyArK2kpIGUuYXBwZW5kQ2hpbGQoY29udGVudFtpXSk7XG4gICAgcmV0dXJuIGU7XG4gIH1cblxuICB2YXIgcmFuZ2U7XG4gIGlmIChkb2N1bWVudC5jcmVhdGVSYW5nZSkgcmFuZ2UgPSBmdW5jdGlvbihub2RlLCBzdGFydCwgZW5kLCBlbmROb2RlKSB7XG4gICAgdmFyIHIgPSBkb2N1bWVudC5jcmVhdGVSYW5nZSgpO1xuICAgIHIuc2V0RW5kKGVuZE5vZGUgfHwgbm9kZSwgZW5kKTtcbiAgICByLnNldFN0YXJ0KG5vZGUsIHN0YXJ0KTtcbiAgICByZXR1cm4gcjtcbiAgfTtcbiAgZWxzZSByYW5nZSA9IGZ1bmN0aW9uKG5vZGUsIHN0YXJ0LCBlbmQpIHtcbiAgICB2YXIgciA9IGRvY3VtZW50LmJvZHkuY3JlYXRlVGV4dFJhbmdlKCk7XG4gICAgdHJ5IHsgci5tb3ZlVG9FbGVtZW50VGV4dChub2RlLnBhcmVudE5vZGUpOyB9XG4gICAgY2F0Y2goZSkgeyByZXR1cm4gcjsgfVxuICAgIHIuY29sbGFwc2UodHJ1ZSk7XG4gICAgci5tb3ZlRW5kKFwiY2hhcmFjdGVyXCIsIGVuZCk7XG4gICAgci5tb3ZlU3RhcnQoXCJjaGFyYWN0ZXJcIiwgc3RhcnQpO1xuICAgIHJldHVybiByO1xuICB9O1xuXG4gIGZ1bmN0aW9uIHJlbW92ZUNoaWxkcmVuKGUpIHtcbiAgICBmb3IgKHZhciBjb3VudCA9IGUuY2hpbGROb2Rlcy5sZW5ndGg7IGNvdW50ID4gMDsgLS1jb3VudClcbiAgICAgIGUucmVtb3ZlQ2hpbGQoZS5maXJzdENoaWxkKTtcbiAgICByZXR1cm4gZTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHJlbW92ZUNoaWxkcmVuQW5kQWRkKHBhcmVudCwgZSkge1xuICAgIHJldHVybiByZW1vdmVDaGlsZHJlbihwYXJlbnQpLmFwcGVuZENoaWxkKGUpO1xuICB9XG5cbiAgdmFyIGNvbnRhaW5zID0gQ29kZU1pcnJvci5jb250YWlucyA9IGZ1bmN0aW9uKHBhcmVudCwgY2hpbGQpIHtcbiAgICBpZiAoY2hpbGQubm9kZVR5cGUgPT0gMykgLy8gQW5kcm9pZCBicm93c2VyIGFsd2F5cyByZXR1cm5zIGZhbHNlIHdoZW4gY2hpbGQgaXMgYSB0ZXh0bm9kZVxuICAgICAgY2hpbGQgPSBjaGlsZC5wYXJlbnROb2RlO1xuICAgIGlmIChwYXJlbnQuY29udGFpbnMpXG4gICAgICByZXR1cm4gcGFyZW50LmNvbnRhaW5zKGNoaWxkKTtcbiAgICBkbyB7XG4gICAgICBpZiAoY2hpbGQubm9kZVR5cGUgPT0gMTEpIGNoaWxkID0gY2hpbGQuaG9zdDtcbiAgICAgIGlmIChjaGlsZCA9PSBwYXJlbnQpIHJldHVybiB0cnVlO1xuICAgIH0gd2hpbGUgKGNoaWxkID0gY2hpbGQucGFyZW50Tm9kZSk7XG4gIH07XG5cbiAgZnVuY3Rpb24gYWN0aXZlRWx0KCkgeyByZXR1cm4gZG9jdW1lbnQuYWN0aXZlRWxlbWVudDsgfVxuICAvLyBPbGRlciB2ZXJzaW9ucyBvZiBJRSB0aHJvd3MgdW5zcGVjaWZpZWQgZXJyb3Igd2hlbiB0b3VjaGluZ1xuICAvLyBkb2N1bWVudC5hY3RpdmVFbGVtZW50IGluIHNvbWUgY2FzZXMgKGR1cmluZyBsb2FkaW5nLCBpbiBpZnJhbWUpXG4gIGlmIChpZSAmJiBpZV92ZXJzaW9uIDwgMTEpIGFjdGl2ZUVsdCA9IGZ1bmN0aW9uKCkge1xuICAgIHRyeSB7IHJldHVybiBkb2N1bWVudC5hY3RpdmVFbGVtZW50OyB9XG4gICAgY2F0Y2goZSkgeyByZXR1cm4gZG9jdW1lbnQuYm9keTsgfVxuICB9O1xuXG4gIGZ1bmN0aW9uIGNsYXNzVGVzdChjbHMpIHsgcmV0dXJuIG5ldyBSZWdFeHAoXCIoXnxcXFxccylcIiArIGNscyArIFwiKD86JHxcXFxccylcXFxccypcIik7IH1cbiAgdmFyIHJtQ2xhc3MgPSBDb2RlTWlycm9yLnJtQ2xhc3MgPSBmdW5jdGlvbihub2RlLCBjbHMpIHtcbiAgICB2YXIgY3VycmVudCA9IG5vZGUuY2xhc3NOYW1lO1xuICAgIHZhciBtYXRjaCA9IGNsYXNzVGVzdChjbHMpLmV4ZWMoY3VycmVudCk7XG4gICAgaWYgKG1hdGNoKSB7XG4gICAgICB2YXIgYWZ0ZXIgPSBjdXJyZW50LnNsaWNlKG1hdGNoLmluZGV4ICsgbWF0Y2hbMF0ubGVuZ3RoKTtcbiAgICAgIG5vZGUuY2xhc3NOYW1lID0gY3VycmVudC5zbGljZSgwLCBtYXRjaC5pbmRleCkgKyAoYWZ0ZXIgPyBtYXRjaFsxXSArIGFmdGVyIDogXCJcIik7XG4gICAgfVxuICB9O1xuICB2YXIgYWRkQ2xhc3MgPSBDb2RlTWlycm9yLmFkZENsYXNzID0gZnVuY3Rpb24obm9kZSwgY2xzKSB7XG4gICAgdmFyIGN1cnJlbnQgPSBub2RlLmNsYXNzTmFtZTtcbiAgICBpZiAoIWNsYXNzVGVzdChjbHMpLnRlc3QoY3VycmVudCkpIG5vZGUuY2xhc3NOYW1lICs9IChjdXJyZW50ID8gXCIgXCIgOiBcIlwiKSArIGNscztcbiAgfTtcbiAgZnVuY3Rpb24gam9pbkNsYXNzZXMoYSwgYikge1xuICAgIHZhciBhcyA9IGEuc3BsaXQoXCIgXCIpO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYXMubGVuZ3RoOyBpKyspXG4gICAgICBpZiAoYXNbaV0gJiYgIWNsYXNzVGVzdChhc1tpXSkudGVzdChiKSkgYiArPSBcIiBcIiArIGFzW2ldO1xuICAgIHJldHVybiBiO1xuICB9XG5cbiAgLy8gV0lORE9XLVdJREUgRVZFTlRTXG5cbiAgLy8gVGhlc2UgbXVzdCBiZSBoYW5kbGVkIGNhcmVmdWxseSwgYmVjYXVzZSBuYWl2ZWx5IHJlZ2lzdGVyaW5nIGFcbiAgLy8gaGFuZGxlciBmb3IgZWFjaCBlZGl0b3Igd2lsbCBjYXVzZSB0aGUgZWRpdG9ycyB0byBuZXZlciBiZVxuICAvLyBnYXJiYWdlIGNvbGxlY3RlZC5cblxuICBmdW5jdGlvbiBmb3JFYWNoQ29kZU1pcnJvcihmKSB7XG4gICAgaWYgKCFkb2N1bWVudC5ib2R5LmdldEVsZW1lbnRzQnlDbGFzc05hbWUpIHJldHVybjtcbiAgICB2YXIgYnlDbGFzcyA9IGRvY3VtZW50LmJvZHkuZ2V0RWxlbWVudHNCeUNsYXNzTmFtZShcIkNvZGVNaXJyb3JcIik7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBieUNsYXNzLmxlbmd0aDsgaSsrKSB7XG4gICAgICB2YXIgY20gPSBieUNsYXNzW2ldLkNvZGVNaXJyb3I7XG4gICAgICBpZiAoY20pIGYoY20pO1xuICAgIH1cbiAgfVxuXG4gIHZhciBnbG9iYWxzUmVnaXN0ZXJlZCA9IGZhbHNlO1xuICBmdW5jdGlvbiBlbnN1cmVHbG9iYWxIYW5kbGVycygpIHtcbiAgICBpZiAoZ2xvYmFsc1JlZ2lzdGVyZWQpIHJldHVybjtcbiAgICByZWdpc3Rlckdsb2JhbEhhbmRsZXJzKCk7XG4gICAgZ2xvYmFsc1JlZ2lzdGVyZWQgPSB0cnVlO1xuICB9XG4gIGZ1bmN0aW9uIHJlZ2lzdGVyR2xvYmFsSGFuZGxlcnMoKSB7XG4gICAgLy8gV2hlbiB0aGUgd2luZG93IHJlc2l6ZXMsIHdlIG5lZWQgdG8gcmVmcmVzaCBhY3RpdmUgZWRpdG9ycy5cbiAgICB2YXIgcmVzaXplVGltZXI7XG4gICAgb24od2luZG93LCBcInJlc2l6ZVwiLCBmdW5jdGlvbigpIHtcbiAgICAgIGlmIChyZXNpemVUaW1lciA9PSBudWxsKSByZXNpemVUaW1lciA9IHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAgIHJlc2l6ZVRpbWVyID0gbnVsbDtcbiAgICAgICAgZm9yRWFjaENvZGVNaXJyb3Iob25SZXNpemUpO1xuICAgICAgfSwgMTAwKTtcbiAgICB9KTtcbiAgICAvLyBXaGVuIHRoZSB3aW5kb3cgbG9zZXMgZm9jdXMsIHdlIHdhbnQgdG8gc2hvdyB0aGUgZWRpdG9yIGFzIGJsdXJyZWRcbiAgICBvbih3aW5kb3csIFwiYmx1clwiLCBmdW5jdGlvbigpIHtcbiAgICAgIGZvckVhY2hDb2RlTWlycm9yKG9uQmx1cik7XG4gICAgfSk7XG4gIH1cblxuICAvLyBGRUFUVVJFIERFVEVDVElPTlxuXG4gIC8vIERldGVjdCBkcmFnLWFuZC1kcm9wXG4gIHZhciBkcmFnQW5kRHJvcCA9IGZ1bmN0aW9uKCkge1xuICAgIC8vIFRoZXJlIGlzICpzb21lKiBraW5kIG9mIGRyYWctYW5kLWRyb3Agc3VwcG9ydCBpbiBJRTYtOCwgYnV0IElcbiAgICAvLyBjb3VsZG4ndCBnZXQgaXQgdG8gd29yayB5ZXQuXG4gICAgaWYgKGllICYmIGllX3ZlcnNpb24gPCA5KSByZXR1cm4gZmFsc2U7XG4gICAgdmFyIGRpdiA9IGVsdCgnZGl2Jyk7XG4gICAgcmV0dXJuIFwiZHJhZ2dhYmxlXCIgaW4gZGl2IHx8IFwiZHJhZ0Ryb3BcIiBpbiBkaXY7XG4gIH0oKTtcblxuICB2YXIgendzcFN1cHBvcnRlZDtcbiAgZnVuY3Rpb24gemVyb1dpZHRoRWxlbWVudChtZWFzdXJlKSB7XG4gICAgaWYgKHp3c3BTdXBwb3J0ZWQgPT0gbnVsbCkge1xuICAgICAgdmFyIHRlc3QgPSBlbHQoXCJzcGFuXCIsIFwiXFx1MjAwYlwiKTtcbiAgICAgIHJlbW92ZUNoaWxkcmVuQW5kQWRkKG1lYXN1cmUsIGVsdChcInNwYW5cIiwgW3Rlc3QsIGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKFwieFwiKV0pKTtcbiAgICAgIGlmIChtZWFzdXJlLmZpcnN0Q2hpbGQub2Zmc2V0SGVpZ2h0ICE9IDApXG4gICAgICAgIHp3c3BTdXBwb3J0ZWQgPSB0ZXN0Lm9mZnNldFdpZHRoIDw9IDEgJiYgdGVzdC5vZmZzZXRIZWlnaHQgPiAyICYmICEoaWUgJiYgaWVfdmVyc2lvbiA8IDgpO1xuICAgIH1cbiAgICB2YXIgbm9kZSA9IHp3c3BTdXBwb3J0ZWQgPyBlbHQoXCJzcGFuXCIsIFwiXFx1MjAwYlwiKSA6XG4gICAgICBlbHQoXCJzcGFuXCIsIFwiXFx1MDBhMFwiLCBudWxsLCBcImRpc3BsYXk6IGlubGluZS1ibG9jazsgd2lkdGg6IDFweDsgbWFyZ2luLXJpZ2h0OiAtMXB4XCIpO1xuICAgIG5vZGUuc2V0QXR0cmlidXRlKFwiY20tdGV4dFwiLCBcIlwiKTtcbiAgICByZXR1cm4gbm9kZTtcbiAgfVxuXG4gIC8vIEZlYXR1cmUtZGV0ZWN0IElFJ3MgY3J1bW15IGNsaWVudCByZWN0IHJlcG9ydGluZyBmb3IgYmlkaSB0ZXh0XG4gIHZhciBiYWRCaWRpUmVjdHM7XG4gIGZ1bmN0aW9uIGhhc0JhZEJpZGlSZWN0cyhtZWFzdXJlKSB7XG4gICAgaWYgKGJhZEJpZGlSZWN0cyAhPSBudWxsKSByZXR1cm4gYmFkQmlkaVJlY3RzO1xuICAgIHZhciB0eHQgPSByZW1vdmVDaGlsZHJlbkFuZEFkZChtZWFzdXJlLCBkb2N1bWVudC5jcmVhdGVUZXh0Tm9kZShcIkFcXHUwNjJlQVwiKSk7XG4gICAgdmFyIHIwID0gcmFuZ2UodHh0LCAwLCAxKS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICBpZiAoIXIwIHx8IHIwLmxlZnQgPT0gcjAucmlnaHQpIHJldHVybiBmYWxzZTsgLy8gU2FmYXJpIHJldHVybnMgbnVsbCBpbiBzb21lIGNhc2VzICgjMjc4MClcbiAgICB2YXIgcjEgPSByYW5nZSh0eHQsIDEsIDIpLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgIHJldHVybiBiYWRCaWRpUmVjdHMgPSAocjEucmlnaHQgLSByMC5yaWdodCA8IDMpO1xuICB9XG5cbiAgLy8gU2VlIGlmIFwiXCIuc3BsaXQgaXMgdGhlIGJyb2tlbiBJRSB2ZXJzaW9uLCBpZiBzbywgcHJvdmlkZSBhblxuICAvLyBhbHRlcm5hdGl2ZSB3YXkgdG8gc3BsaXQgbGluZXMuXG4gIHZhciBzcGxpdExpbmVzID0gQ29kZU1pcnJvci5zcGxpdExpbmVzID0gXCJcXG5cXG5iXCIuc3BsaXQoL1xcbi8pLmxlbmd0aCAhPSAzID8gZnVuY3Rpb24oc3RyaW5nKSB7XG4gICAgdmFyIHBvcyA9IDAsIHJlc3VsdCA9IFtdLCBsID0gc3RyaW5nLmxlbmd0aDtcbiAgICB3aGlsZSAocG9zIDw9IGwpIHtcbiAgICAgIHZhciBubCA9IHN0cmluZy5pbmRleE9mKFwiXFxuXCIsIHBvcyk7XG4gICAgICBpZiAobmwgPT0gLTEpIG5sID0gc3RyaW5nLmxlbmd0aDtcbiAgICAgIHZhciBsaW5lID0gc3RyaW5nLnNsaWNlKHBvcywgc3RyaW5nLmNoYXJBdChubCAtIDEpID09IFwiXFxyXCIgPyBubCAtIDEgOiBubCk7XG4gICAgICB2YXIgcnQgPSBsaW5lLmluZGV4T2YoXCJcXHJcIik7XG4gICAgICBpZiAocnQgIT0gLTEpIHtcbiAgICAgICAgcmVzdWx0LnB1c2gobGluZS5zbGljZSgwLCBydCkpO1xuICAgICAgICBwb3MgKz0gcnQgKyAxO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmVzdWx0LnB1c2gobGluZSk7XG4gICAgICAgIHBvcyA9IG5sICsgMTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfSA6IGZ1bmN0aW9uKHN0cmluZyl7cmV0dXJuIHN0cmluZy5zcGxpdCgvXFxyXFxuP3xcXG4vKTt9O1xuXG4gIHZhciBoYXNTZWxlY3Rpb24gPSB3aW5kb3cuZ2V0U2VsZWN0aW9uID8gZnVuY3Rpb24odGUpIHtcbiAgICB0cnkgeyByZXR1cm4gdGUuc2VsZWN0aW9uU3RhcnQgIT0gdGUuc2VsZWN0aW9uRW5kOyB9XG4gICAgY2F0Y2goZSkgeyByZXR1cm4gZmFsc2U7IH1cbiAgfSA6IGZ1bmN0aW9uKHRlKSB7XG4gICAgdHJ5IHt2YXIgcmFuZ2UgPSB0ZS5vd25lckRvY3VtZW50LnNlbGVjdGlvbi5jcmVhdGVSYW5nZSgpO31cbiAgICBjYXRjaChlKSB7fVxuICAgIGlmICghcmFuZ2UgfHwgcmFuZ2UucGFyZW50RWxlbWVudCgpICE9IHRlKSByZXR1cm4gZmFsc2U7XG4gICAgcmV0dXJuIHJhbmdlLmNvbXBhcmVFbmRQb2ludHMoXCJTdGFydFRvRW5kXCIsIHJhbmdlKSAhPSAwO1xuICB9O1xuXG4gIHZhciBoYXNDb3B5RXZlbnQgPSAoZnVuY3Rpb24oKSB7XG4gICAgdmFyIGUgPSBlbHQoXCJkaXZcIik7XG4gICAgaWYgKFwib25jb3B5XCIgaW4gZSkgcmV0dXJuIHRydWU7XG4gICAgZS5zZXRBdHRyaWJ1dGUoXCJvbmNvcHlcIiwgXCJyZXR1cm47XCIpO1xuICAgIHJldHVybiB0eXBlb2YgZS5vbmNvcHkgPT0gXCJmdW5jdGlvblwiO1xuICB9KSgpO1xuXG4gIHZhciBiYWRab29tZWRSZWN0cyA9IG51bGw7XG4gIGZ1bmN0aW9uIGhhc0JhZFpvb21lZFJlY3RzKG1lYXN1cmUpIHtcbiAgICBpZiAoYmFkWm9vbWVkUmVjdHMgIT0gbnVsbCkgcmV0dXJuIGJhZFpvb21lZFJlY3RzO1xuICAgIHZhciBub2RlID0gcmVtb3ZlQ2hpbGRyZW5BbmRBZGQobWVhc3VyZSwgZWx0KFwic3BhblwiLCBcInhcIikpO1xuICAgIHZhciBub3JtYWwgPSBub2RlLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgIHZhciBmcm9tUmFuZ2UgPSByYW5nZShub2RlLCAwLCAxKS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICByZXR1cm4gYmFkWm9vbWVkUmVjdHMgPSBNYXRoLmFicyhub3JtYWwubGVmdCAtIGZyb21SYW5nZS5sZWZ0KSA+IDE7XG4gIH1cblxuICAvLyBLRVkgTkFNRVNcblxuICB2YXIga2V5TmFtZXMgPSB7MzogXCJFbnRlclwiLCA4OiBcIkJhY2tzcGFjZVwiLCA5OiBcIlRhYlwiLCAxMzogXCJFbnRlclwiLCAxNjogXCJTaGlmdFwiLCAxNzogXCJDdHJsXCIsIDE4OiBcIkFsdFwiLFxuICAgICAgICAgICAgICAgICAgMTk6IFwiUGF1c2VcIiwgMjA6IFwiQ2Fwc0xvY2tcIiwgMjc6IFwiRXNjXCIsIDMyOiBcIlNwYWNlXCIsIDMzOiBcIlBhZ2VVcFwiLCAzNDogXCJQYWdlRG93blwiLCAzNTogXCJFbmRcIixcbiAgICAgICAgICAgICAgICAgIDM2OiBcIkhvbWVcIiwgMzc6IFwiTGVmdFwiLCAzODogXCJVcFwiLCAzOTogXCJSaWdodFwiLCA0MDogXCJEb3duXCIsIDQ0OiBcIlByaW50U2NyblwiLCA0NTogXCJJbnNlcnRcIixcbiAgICAgICAgICAgICAgICAgIDQ2OiBcIkRlbGV0ZVwiLCA1OTogXCI7XCIsIDYxOiBcIj1cIiwgOTE6IFwiTW9kXCIsIDkyOiBcIk1vZFwiLCA5MzogXCJNb2RcIiwgMTA3OiBcIj1cIiwgMTA5OiBcIi1cIiwgMTI3OiBcIkRlbGV0ZVwiLFxuICAgICAgICAgICAgICAgICAgMTczOiBcIi1cIiwgMTg2OiBcIjtcIiwgMTg3OiBcIj1cIiwgMTg4OiBcIixcIiwgMTg5OiBcIi1cIiwgMTkwOiBcIi5cIiwgMTkxOiBcIi9cIiwgMTkyOiBcImBcIiwgMjE5OiBcIltcIiwgMjIwOiBcIlxcXFxcIixcbiAgICAgICAgICAgICAgICAgIDIyMTogXCJdXCIsIDIyMjogXCInXCIsIDYzMjMyOiBcIlVwXCIsIDYzMjMzOiBcIkRvd25cIiwgNjMyMzQ6IFwiTGVmdFwiLCA2MzIzNTogXCJSaWdodFwiLCA2MzI3MjogXCJEZWxldGVcIixcbiAgICAgICAgICAgICAgICAgIDYzMjczOiBcIkhvbWVcIiwgNjMyNzU6IFwiRW5kXCIsIDYzMjc2OiBcIlBhZ2VVcFwiLCA2MzI3NzogXCJQYWdlRG93blwiLCA2MzMwMjogXCJJbnNlcnRcIn07XG4gIENvZGVNaXJyb3Iua2V5TmFtZXMgPSBrZXlOYW1lcztcbiAgKGZ1bmN0aW9uKCkge1xuICAgIC8vIE51bWJlciBrZXlzXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCAxMDsgaSsrKSBrZXlOYW1lc1tpICsgNDhdID0ga2V5TmFtZXNbaSArIDk2XSA9IFN0cmluZyhpKTtcbiAgICAvLyBBbHBoYWJldGljIGtleXNcbiAgICBmb3IgKHZhciBpID0gNjU7IGkgPD0gOTA7IGkrKykga2V5TmFtZXNbaV0gPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGkpO1xuICAgIC8vIEZ1bmN0aW9uIGtleXNcbiAgICBmb3IgKHZhciBpID0gMTsgaSA8PSAxMjsgaSsrKSBrZXlOYW1lc1tpICsgMTExXSA9IGtleU5hbWVzW2kgKyA2MzIzNV0gPSBcIkZcIiArIGk7XG4gIH0pKCk7XG5cbiAgLy8gQklESSBIRUxQRVJTXG5cbiAgZnVuY3Rpb24gaXRlcmF0ZUJpZGlTZWN0aW9ucyhvcmRlciwgZnJvbSwgdG8sIGYpIHtcbiAgICBpZiAoIW9yZGVyKSByZXR1cm4gZihmcm9tLCB0bywgXCJsdHJcIik7XG4gICAgdmFyIGZvdW5kID0gZmFsc2U7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBvcmRlci5sZW5ndGg7ICsraSkge1xuICAgICAgdmFyIHBhcnQgPSBvcmRlcltpXTtcbiAgICAgIGlmIChwYXJ0LmZyb20gPCB0byAmJiBwYXJ0LnRvID4gZnJvbSB8fCBmcm9tID09IHRvICYmIHBhcnQudG8gPT0gZnJvbSkge1xuICAgICAgICBmKE1hdGgubWF4KHBhcnQuZnJvbSwgZnJvbSksIE1hdGgubWluKHBhcnQudG8sIHRvKSwgcGFydC5sZXZlbCA9PSAxID8gXCJydGxcIiA6IFwibHRyXCIpO1xuICAgICAgICBmb3VuZCA9IHRydWU7XG4gICAgICB9XG4gICAgfVxuICAgIGlmICghZm91bmQpIGYoZnJvbSwgdG8sIFwibHRyXCIpO1xuICB9XG5cbiAgZnVuY3Rpb24gYmlkaUxlZnQocGFydCkgeyByZXR1cm4gcGFydC5sZXZlbCAlIDIgPyBwYXJ0LnRvIDogcGFydC5mcm9tOyB9XG4gIGZ1bmN0aW9uIGJpZGlSaWdodChwYXJ0KSB7IHJldHVybiBwYXJ0LmxldmVsICUgMiA/IHBhcnQuZnJvbSA6IHBhcnQudG87IH1cblxuICBmdW5jdGlvbiBsaW5lTGVmdChsaW5lKSB7IHZhciBvcmRlciA9IGdldE9yZGVyKGxpbmUpOyByZXR1cm4gb3JkZXIgPyBiaWRpTGVmdChvcmRlclswXSkgOiAwOyB9XG4gIGZ1bmN0aW9uIGxpbmVSaWdodChsaW5lKSB7XG4gICAgdmFyIG9yZGVyID0gZ2V0T3JkZXIobGluZSk7XG4gICAgaWYgKCFvcmRlcikgcmV0dXJuIGxpbmUudGV4dC5sZW5ndGg7XG4gICAgcmV0dXJuIGJpZGlSaWdodChsc3Qob3JkZXIpKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGxpbmVTdGFydChjbSwgbGluZU4pIHtcbiAgICB2YXIgbGluZSA9IGdldExpbmUoY20uZG9jLCBsaW5lTik7XG4gICAgdmFyIHZpc3VhbCA9IHZpc3VhbExpbmUobGluZSk7XG4gICAgaWYgKHZpc3VhbCAhPSBsaW5lKSBsaW5lTiA9IGxpbmVObyh2aXN1YWwpO1xuICAgIHZhciBvcmRlciA9IGdldE9yZGVyKHZpc3VhbCk7XG4gICAgdmFyIGNoID0gIW9yZGVyID8gMCA6IG9yZGVyWzBdLmxldmVsICUgMiA/IGxpbmVSaWdodCh2aXN1YWwpIDogbGluZUxlZnQodmlzdWFsKTtcbiAgICByZXR1cm4gUG9zKGxpbmVOLCBjaCk7XG4gIH1cbiAgZnVuY3Rpb24gbGluZUVuZChjbSwgbGluZU4pIHtcbiAgICB2YXIgbWVyZ2VkLCBsaW5lID0gZ2V0TGluZShjbS5kb2MsIGxpbmVOKTtcbiAgICB3aGlsZSAobWVyZ2VkID0gY29sbGFwc2VkU3BhbkF0RW5kKGxpbmUpKSB7XG4gICAgICBsaW5lID0gbWVyZ2VkLmZpbmQoMSwgdHJ1ZSkubGluZTtcbiAgICAgIGxpbmVOID0gbnVsbDtcbiAgICB9XG4gICAgdmFyIG9yZGVyID0gZ2V0T3JkZXIobGluZSk7XG4gICAgdmFyIGNoID0gIW9yZGVyID8gbGluZS50ZXh0Lmxlbmd0aCA6IG9yZGVyWzBdLmxldmVsICUgMiA/IGxpbmVMZWZ0KGxpbmUpIDogbGluZVJpZ2h0KGxpbmUpO1xuICAgIHJldHVybiBQb3MobGluZU4gPT0gbnVsbCA/IGxpbmVObyhsaW5lKSA6IGxpbmVOLCBjaCk7XG4gIH1cbiAgZnVuY3Rpb24gbGluZVN0YXJ0U21hcnQoY20sIHBvcykge1xuICAgIHZhciBzdGFydCA9IGxpbmVTdGFydChjbSwgcG9zLmxpbmUpO1xuICAgIHZhciBsaW5lID0gZ2V0TGluZShjbS5kb2MsIHN0YXJ0LmxpbmUpO1xuICAgIHZhciBvcmRlciA9IGdldE9yZGVyKGxpbmUpO1xuICAgIGlmICghb3JkZXIgfHwgb3JkZXJbMF0ubGV2ZWwgPT0gMCkge1xuICAgICAgdmFyIGZpcnN0Tm9uV1MgPSBNYXRoLm1heCgwLCBsaW5lLnRleHQuc2VhcmNoKC9cXFMvKSk7XG4gICAgICB2YXIgaW5XUyA9IHBvcy5saW5lID09IHN0YXJ0LmxpbmUgJiYgcG9zLmNoIDw9IGZpcnN0Tm9uV1MgJiYgcG9zLmNoO1xuICAgICAgcmV0dXJuIFBvcyhzdGFydC5saW5lLCBpbldTID8gMCA6IGZpcnN0Tm9uV1MpO1xuICAgIH1cbiAgICByZXR1cm4gc3RhcnQ7XG4gIH1cblxuICBmdW5jdGlvbiBjb21wYXJlQmlkaUxldmVsKG9yZGVyLCBhLCBiKSB7XG4gICAgdmFyIGxpbmVkaXIgPSBvcmRlclswXS5sZXZlbDtcbiAgICBpZiAoYSA9PSBsaW5lZGlyKSByZXR1cm4gdHJ1ZTtcbiAgICBpZiAoYiA9PSBsaW5lZGlyKSByZXR1cm4gZmFsc2U7XG4gICAgcmV0dXJuIGEgPCBiO1xuICB9XG4gIHZhciBiaWRpT3RoZXI7XG4gIGZ1bmN0aW9uIGdldEJpZGlQYXJ0QXQob3JkZXIsIHBvcykge1xuICAgIGJpZGlPdGhlciA9IG51bGw7XG4gICAgZm9yICh2YXIgaSA9IDAsIGZvdW5kOyBpIDwgb3JkZXIubGVuZ3RoOyArK2kpIHtcbiAgICAgIHZhciBjdXIgPSBvcmRlcltpXTtcbiAgICAgIGlmIChjdXIuZnJvbSA8IHBvcyAmJiBjdXIudG8gPiBwb3MpIHJldHVybiBpO1xuICAgICAgaWYgKChjdXIuZnJvbSA9PSBwb3MgfHwgY3VyLnRvID09IHBvcykpIHtcbiAgICAgICAgaWYgKGZvdW5kID09IG51bGwpIHtcbiAgICAgICAgICBmb3VuZCA9IGk7XG4gICAgICAgIH0gZWxzZSBpZiAoY29tcGFyZUJpZGlMZXZlbChvcmRlciwgY3VyLmxldmVsLCBvcmRlcltmb3VuZF0ubGV2ZWwpKSB7XG4gICAgICAgICAgaWYgKGN1ci5mcm9tICE9IGN1ci50bykgYmlkaU90aGVyID0gZm91bmQ7XG4gICAgICAgICAgcmV0dXJuIGk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgaWYgKGN1ci5mcm9tICE9IGN1ci50bykgYmlkaU90aGVyID0gaTtcbiAgICAgICAgICByZXR1cm4gZm91bmQ7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIGZvdW5kO1xuICB9XG5cbiAgZnVuY3Rpb24gbW92ZUluTGluZShsaW5lLCBwb3MsIGRpciwgYnlVbml0KSB7XG4gICAgaWYgKCFieVVuaXQpIHJldHVybiBwb3MgKyBkaXI7XG4gICAgZG8gcG9zICs9IGRpcjtcbiAgICB3aGlsZSAocG9zID4gMCAmJiBpc0V4dGVuZGluZ0NoYXIobGluZS50ZXh0LmNoYXJBdChwb3MpKSk7XG4gICAgcmV0dXJuIHBvcztcbiAgfVxuXG4gIC8vIFRoaXMgaXMgbmVlZGVkIGluIG9yZGVyIHRvIG1vdmUgJ3Zpc3VhbGx5JyB0aHJvdWdoIGJpLWRpcmVjdGlvbmFsXG4gIC8vIHRleHQgLS0gaS5lLiwgcHJlc3NpbmcgbGVmdCBzaG91bGQgbWFrZSB0aGUgY3Vyc29yIGdvIGxlZnQsIGV2ZW5cbiAgLy8gd2hlbiBpbiBSVEwgdGV4dC4gVGhlIHRyaWNreSBwYXJ0IGlzIHRoZSAnanVtcHMnLCB3aGVyZSBSVEwgYW5kXG4gIC8vIExUUiB0ZXh0IHRvdWNoIGVhY2ggb3RoZXIuIFRoaXMgb2Z0ZW4gcmVxdWlyZXMgdGhlIGN1cnNvciBvZmZzZXRcbiAgLy8gdG8gbW92ZSBtb3JlIHRoYW4gb25lIHVuaXQsIGluIG9yZGVyIHRvIHZpc3VhbGx5IG1vdmUgb25lIHVuaXQuXG4gIGZ1bmN0aW9uIG1vdmVWaXN1YWxseShsaW5lLCBzdGFydCwgZGlyLCBieVVuaXQpIHtcbiAgICB2YXIgYmlkaSA9IGdldE9yZGVyKGxpbmUpO1xuICAgIGlmICghYmlkaSkgcmV0dXJuIG1vdmVMb2dpY2FsbHkobGluZSwgc3RhcnQsIGRpciwgYnlVbml0KTtcbiAgICB2YXIgcG9zID0gZ2V0QmlkaVBhcnRBdChiaWRpLCBzdGFydCksIHBhcnQgPSBiaWRpW3Bvc107XG4gICAgdmFyIHRhcmdldCA9IG1vdmVJbkxpbmUobGluZSwgc3RhcnQsIHBhcnQubGV2ZWwgJSAyID8gLWRpciA6IGRpciwgYnlVbml0KTtcblxuICAgIGZvciAoOzspIHtcbiAgICAgIGlmICh0YXJnZXQgPiBwYXJ0LmZyb20gJiYgdGFyZ2V0IDwgcGFydC50bykgcmV0dXJuIHRhcmdldDtcbiAgICAgIGlmICh0YXJnZXQgPT0gcGFydC5mcm9tIHx8IHRhcmdldCA9PSBwYXJ0LnRvKSB7XG4gICAgICAgIGlmIChnZXRCaWRpUGFydEF0KGJpZGksIHRhcmdldCkgPT0gcG9zKSByZXR1cm4gdGFyZ2V0O1xuICAgICAgICBwYXJ0ID0gYmlkaVtwb3MgKz0gZGlyXTtcbiAgICAgICAgcmV0dXJuIChkaXIgPiAwKSA9PSBwYXJ0LmxldmVsICUgMiA/IHBhcnQudG8gOiBwYXJ0LmZyb207XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBwYXJ0ID0gYmlkaVtwb3MgKz0gZGlyXTtcbiAgICAgICAgaWYgKCFwYXJ0KSByZXR1cm4gbnVsbDtcbiAgICAgICAgaWYgKChkaXIgPiAwKSA9PSBwYXJ0LmxldmVsICUgMilcbiAgICAgICAgICB0YXJnZXQgPSBtb3ZlSW5MaW5lKGxpbmUsIHBhcnQudG8sIC0xLCBieVVuaXQpO1xuICAgICAgICBlbHNlXG4gICAgICAgICAgdGFyZ2V0ID0gbW92ZUluTGluZShsaW5lLCBwYXJ0LmZyb20sIDEsIGJ5VW5pdCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gbW92ZUxvZ2ljYWxseShsaW5lLCBzdGFydCwgZGlyLCBieVVuaXQpIHtcbiAgICB2YXIgdGFyZ2V0ID0gc3RhcnQgKyBkaXI7XG4gICAgaWYgKGJ5VW5pdCkgd2hpbGUgKHRhcmdldCA+IDAgJiYgaXNFeHRlbmRpbmdDaGFyKGxpbmUudGV4dC5jaGFyQXQodGFyZ2V0KSkpIHRhcmdldCArPSBkaXI7XG4gICAgcmV0dXJuIHRhcmdldCA8IDAgfHwgdGFyZ2V0ID4gbGluZS50ZXh0Lmxlbmd0aCA/IG51bGwgOiB0YXJnZXQ7XG4gIH1cblxuICAvLyBCaWRpcmVjdGlvbmFsIG9yZGVyaW5nIGFsZ29yaXRobVxuICAvLyBTZWUgaHR0cDovL3VuaWNvZGUub3JnL3JlcG9ydHMvdHI5L3RyOS0xMy5odG1sIGZvciB0aGUgYWxnb3JpdGhtXG4gIC8vIHRoYXQgdGhpcyAocGFydGlhbGx5KSBpbXBsZW1lbnRzLlxuXG4gIC8vIE9uZS1jaGFyIGNvZGVzIHVzZWQgZm9yIGNoYXJhY3RlciB0eXBlczpcbiAgLy8gTCAoTCk6ICAgTGVmdC10by1SaWdodFxuICAvLyBSIChSKTogICBSaWdodC10by1MZWZ0XG4gIC8vIHIgKEFMKTogIFJpZ2h0LXRvLUxlZnQgQXJhYmljXG4gIC8vIDEgKEVOKTogIEV1cm9wZWFuIE51bWJlclxuICAvLyArIChFUyk6ICBFdXJvcGVhbiBOdW1iZXIgU2VwYXJhdG9yXG4gIC8vICUgKEVUKTogIEV1cm9wZWFuIE51bWJlciBUZXJtaW5hdG9yXG4gIC8vIG4gKEFOKTogIEFyYWJpYyBOdW1iZXJcbiAgLy8gLCAoQ1MpOiAgQ29tbW9uIE51bWJlciBTZXBhcmF0b3JcbiAgLy8gbSAoTlNNKTogTm9uLVNwYWNpbmcgTWFya1xuICAvLyBiIChCTik6ICBCb3VuZGFyeSBOZXV0cmFsXG4gIC8vIHMgKEIpOiAgIFBhcmFncmFwaCBTZXBhcmF0b3JcbiAgLy8gdCAoUyk6ICAgU2VnbWVudCBTZXBhcmF0b3JcbiAgLy8gdyAoV1MpOiAgV2hpdGVzcGFjZVxuICAvLyBOIChPTik6ICBPdGhlciBOZXV0cmFsc1xuXG4gIC8vIFJldHVybnMgbnVsbCBpZiBjaGFyYWN0ZXJzIGFyZSBvcmRlcmVkIGFzIHRoZXkgYXBwZWFyXG4gIC8vIChsZWZ0LXRvLXJpZ2h0KSwgb3IgYW4gYXJyYXkgb2Ygc2VjdGlvbnMgKHtmcm9tLCB0bywgbGV2ZWx9XG4gIC8vIG9iamVjdHMpIGluIHRoZSBvcmRlciBpbiB3aGljaCB0aGV5IG9jY3VyIHZpc3VhbGx5LlxuICB2YXIgYmlkaU9yZGVyaW5nID0gKGZ1bmN0aW9uKCkge1xuICAgIC8vIENoYXJhY3RlciB0eXBlcyBmb3IgY29kZXBvaW50cyAwIHRvIDB4ZmZcbiAgICB2YXIgbG93VHlwZXMgPSBcImJiYmJiYmJiYnRzdHdzYmJiYmJiYmJiYmJiYmJzc3N0d05OJSUlTk5OTk5OLE4sTjExMTExMTExMTFOTk5OTk5OTExMTExMTExMTExMTExMTExMTExMTExMTExOTk5OTk5MTExMTExMTExMTExMTExMTExMTExMTExMTE5OTk5iYmJiYmJzYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmIsTiUlJSVOTk5OTE5OTk5OJSUxMU5MTk5OMUxOTk5OTkxMTExMTExMTExMTExMTExMTExMTExMTkxMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExOXCI7XG4gICAgLy8gQ2hhcmFjdGVyIHR5cGVzIGZvciBjb2RlcG9pbnRzIDB4NjAwIHRvIDB4NmZmXG4gICAgdmFyIGFyYWJpY1R5cGVzID0gXCJycnJycnJycnJycnIsck5ObW1tbW1tcnJycnJycnJycnJycnJycnJycnJycnJycnJycnJycnJycnJycnJycnJycnJycnJycnJycnJtbW1tbW1tbW1tbW1tbXJycnJycnJubm5ubm5ubm5uJW5ucnJybXJycnJycnJycnJycnJycnJycnJycnJycnJycnJycnJycnJycnJycnJycnJycnJycnJycnJycnJycnJycnJycnJycnJycnJycnJycnJycnJycnJycnJycnJycnJycnJycnJycnJybW1tbW1tbW1tbW1tbW1tbW1tbU5tbW1tXCI7XG4gICAgZnVuY3Rpb24gY2hhclR5cGUoY29kZSkge1xuICAgICAgaWYgKGNvZGUgPD0gMHhmNykgcmV0dXJuIGxvd1R5cGVzLmNoYXJBdChjb2RlKTtcbiAgICAgIGVsc2UgaWYgKDB4NTkwIDw9IGNvZGUgJiYgY29kZSA8PSAweDVmNCkgcmV0dXJuIFwiUlwiO1xuICAgICAgZWxzZSBpZiAoMHg2MDAgPD0gY29kZSAmJiBjb2RlIDw9IDB4NmVkKSByZXR1cm4gYXJhYmljVHlwZXMuY2hhckF0KGNvZGUgLSAweDYwMCk7XG4gICAgICBlbHNlIGlmICgweDZlZSA8PSBjb2RlICYmIGNvZGUgPD0gMHg4YWMpIHJldHVybiBcInJcIjtcbiAgICAgIGVsc2UgaWYgKDB4MjAwMCA8PSBjb2RlICYmIGNvZGUgPD0gMHgyMDBiKSByZXR1cm4gXCJ3XCI7XG4gICAgICBlbHNlIGlmIChjb2RlID09IDB4MjAwYykgcmV0dXJuIFwiYlwiO1xuICAgICAgZWxzZSByZXR1cm4gXCJMXCI7XG4gICAgfVxuXG4gICAgdmFyIGJpZGlSRSA9IC9bXFx1MDU5MC1cXHUwNWY0XFx1MDYwMC1cXHUwNmZmXFx1MDcwMC1cXHUwOGFjXS87XG4gICAgdmFyIGlzTmV1dHJhbCA9IC9bc3R3Tl0vLCBpc1N0cm9uZyA9IC9bTFJyXS8sIGNvdW50c0FzTGVmdCA9IC9bTGIxbl0vLCBjb3VudHNBc051bSA9IC9bMW5dLztcbiAgICAvLyBCcm93c2VycyBzZWVtIHRvIGFsd2F5cyB0cmVhdCB0aGUgYm91bmRhcmllcyBvZiBibG9jayBlbGVtZW50cyBhcyBiZWluZyBMLlxuICAgIHZhciBvdXRlclR5cGUgPSBcIkxcIjtcblxuICAgIGZ1bmN0aW9uIEJpZGlTcGFuKGxldmVsLCBmcm9tLCB0bykge1xuICAgICAgdGhpcy5sZXZlbCA9IGxldmVsO1xuICAgICAgdGhpcy5mcm9tID0gZnJvbTsgdGhpcy50byA9IHRvO1xuICAgIH1cblxuICAgIHJldHVybiBmdW5jdGlvbihzdHIpIHtcbiAgICAgIGlmICghYmlkaVJFLnRlc3Qoc3RyKSkgcmV0dXJuIGZhbHNlO1xuICAgICAgdmFyIGxlbiA9IHN0ci5sZW5ndGgsIHR5cGVzID0gW107XG4gICAgICBmb3IgKHZhciBpID0gMCwgdHlwZTsgaSA8IGxlbjsgKytpKVxuICAgICAgICB0eXBlcy5wdXNoKHR5cGUgPSBjaGFyVHlwZShzdHIuY2hhckNvZGVBdChpKSkpO1xuXG4gICAgICAvLyBXMS4gRXhhbWluZSBlYWNoIG5vbi1zcGFjaW5nIG1hcmsgKE5TTSkgaW4gdGhlIGxldmVsIHJ1biwgYW5kXG4gICAgICAvLyBjaGFuZ2UgdGhlIHR5cGUgb2YgdGhlIE5TTSB0byB0aGUgdHlwZSBvZiB0aGUgcHJldmlvdXNcbiAgICAgIC8vIGNoYXJhY3Rlci4gSWYgdGhlIE5TTSBpcyBhdCB0aGUgc3RhcnQgb2YgdGhlIGxldmVsIHJ1biwgaXQgd2lsbFxuICAgICAgLy8gZ2V0IHRoZSB0eXBlIG9mIHNvci5cbiAgICAgIGZvciAodmFyIGkgPSAwLCBwcmV2ID0gb3V0ZXJUeXBlOyBpIDwgbGVuOyArK2kpIHtcbiAgICAgICAgdmFyIHR5cGUgPSB0eXBlc1tpXTtcbiAgICAgICAgaWYgKHR5cGUgPT0gXCJtXCIpIHR5cGVzW2ldID0gcHJldjtcbiAgICAgICAgZWxzZSBwcmV2ID0gdHlwZTtcbiAgICAgIH1cblxuICAgICAgLy8gVzIuIFNlYXJjaCBiYWNrd2FyZHMgZnJvbSBlYWNoIGluc3RhbmNlIG9mIGEgRXVyb3BlYW4gbnVtYmVyXG4gICAgICAvLyB1bnRpbCB0aGUgZmlyc3Qgc3Ryb25nIHR5cGUgKFIsIEwsIEFMLCBvciBzb3IpIGlzIGZvdW5kLiBJZiBhblxuICAgICAgLy8gQUwgaXMgZm91bmQsIGNoYW5nZSB0aGUgdHlwZSBvZiB0aGUgRXVyb3BlYW4gbnVtYmVyIHRvIEFyYWJpY1xuICAgICAgLy8gbnVtYmVyLlxuICAgICAgLy8gVzMuIENoYW5nZSBhbGwgQUxzIHRvIFIuXG4gICAgICBmb3IgKHZhciBpID0gMCwgY3VyID0gb3V0ZXJUeXBlOyBpIDwgbGVuOyArK2kpIHtcbiAgICAgICAgdmFyIHR5cGUgPSB0eXBlc1tpXTtcbiAgICAgICAgaWYgKHR5cGUgPT0gXCIxXCIgJiYgY3VyID09IFwiclwiKSB0eXBlc1tpXSA9IFwiblwiO1xuICAgICAgICBlbHNlIGlmIChpc1N0cm9uZy50ZXN0KHR5cGUpKSB7IGN1ciA9IHR5cGU7IGlmICh0eXBlID09IFwiclwiKSB0eXBlc1tpXSA9IFwiUlwiOyB9XG4gICAgICB9XG5cbiAgICAgIC8vIFc0LiBBIHNpbmdsZSBFdXJvcGVhbiBzZXBhcmF0b3IgYmV0d2VlbiB0d28gRXVyb3BlYW4gbnVtYmVyc1xuICAgICAgLy8gY2hhbmdlcyB0byBhIEV1cm9wZWFuIG51bWJlci4gQSBzaW5nbGUgY29tbW9uIHNlcGFyYXRvciBiZXR3ZWVuXG4gICAgICAvLyB0d28gbnVtYmVycyBvZiB0aGUgc2FtZSB0eXBlIGNoYW5nZXMgdG8gdGhhdCB0eXBlLlxuICAgICAgZm9yICh2YXIgaSA9IDEsIHByZXYgPSB0eXBlc1swXTsgaSA8IGxlbiAtIDE7ICsraSkge1xuICAgICAgICB2YXIgdHlwZSA9IHR5cGVzW2ldO1xuICAgICAgICBpZiAodHlwZSA9PSBcIitcIiAmJiBwcmV2ID09IFwiMVwiICYmIHR5cGVzW2krMV0gPT0gXCIxXCIpIHR5cGVzW2ldID0gXCIxXCI7XG4gICAgICAgIGVsc2UgaWYgKHR5cGUgPT0gXCIsXCIgJiYgcHJldiA9PSB0eXBlc1tpKzFdICYmXG4gICAgICAgICAgICAgICAgIChwcmV2ID09IFwiMVwiIHx8IHByZXYgPT0gXCJuXCIpKSB0eXBlc1tpXSA9IHByZXY7XG4gICAgICAgIHByZXYgPSB0eXBlO1xuICAgICAgfVxuXG4gICAgICAvLyBXNS4gQSBzZXF1ZW5jZSBvZiBFdXJvcGVhbiB0ZXJtaW5hdG9ycyBhZGphY2VudCB0byBFdXJvcGVhblxuICAgICAgLy8gbnVtYmVycyBjaGFuZ2VzIHRvIGFsbCBFdXJvcGVhbiBudW1iZXJzLlxuICAgICAgLy8gVzYuIE90aGVyd2lzZSwgc2VwYXJhdG9ycyBhbmQgdGVybWluYXRvcnMgY2hhbmdlIHRvIE90aGVyXG4gICAgICAvLyBOZXV0cmFsLlxuICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW47ICsraSkge1xuICAgICAgICB2YXIgdHlwZSA9IHR5cGVzW2ldO1xuICAgICAgICBpZiAodHlwZSA9PSBcIixcIikgdHlwZXNbaV0gPSBcIk5cIjtcbiAgICAgICAgZWxzZSBpZiAodHlwZSA9PSBcIiVcIikge1xuICAgICAgICAgIGZvciAodmFyIGVuZCA9IGkgKyAxOyBlbmQgPCBsZW4gJiYgdHlwZXNbZW5kXSA9PSBcIiVcIjsgKytlbmQpIHt9XG4gICAgICAgICAgdmFyIHJlcGxhY2UgPSAoaSAmJiB0eXBlc1tpLTFdID09IFwiIVwiKSB8fCAoZW5kIDwgbGVuICYmIHR5cGVzW2VuZF0gPT0gXCIxXCIpID8gXCIxXCIgOiBcIk5cIjtcbiAgICAgICAgICBmb3IgKHZhciBqID0gaTsgaiA8IGVuZDsgKytqKSB0eXBlc1tqXSA9IHJlcGxhY2U7XG4gICAgICAgICAgaSA9IGVuZCAtIDE7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gVzcuIFNlYXJjaCBiYWNrd2FyZHMgZnJvbSBlYWNoIGluc3RhbmNlIG9mIGEgRXVyb3BlYW4gbnVtYmVyXG4gICAgICAvLyB1bnRpbCB0aGUgZmlyc3Qgc3Ryb25nIHR5cGUgKFIsIEwsIG9yIHNvcikgaXMgZm91bmQuIElmIGFuIEwgaXNcbiAgICAgIC8vIGZvdW5kLCB0aGVuIGNoYW5nZSB0aGUgdHlwZSBvZiB0aGUgRXVyb3BlYW4gbnVtYmVyIHRvIEwuXG4gICAgICBmb3IgKHZhciBpID0gMCwgY3VyID0gb3V0ZXJUeXBlOyBpIDwgbGVuOyArK2kpIHtcbiAgICAgICAgdmFyIHR5cGUgPSB0eXBlc1tpXTtcbiAgICAgICAgaWYgKGN1ciA9PSBcIkxcIiAmJiB0eXBlID09IFwiMVwiKSB0eXBlc1tpXSA9IFwiTFwiO1xuICAgICAgICBlbHNlIGlmIChpc1N0cm9uZy50ZXN0KHR5cGUpKSBjdXIgPSB0eXBlO1xuICAgICAgfVxuXG4gICAgICAvLyBOMS4gQSBzZXF1ZW5jZSBvZiBuZXV0cmFscyB0YWtlcyB0aGUgZGlyZWN0aW9uIG9mIHRoZVxuICAgICAgLy8gc3Vycm91bmRpbmcgc3Ryb25nIHRleHQgaWYgdGhlIHRleHQgb24gYm90aCBzaWRlcyBoYXMgdGhlIHNhbWVcbiAgICAgIC8vIGRpcmVjdGlvbi4gRXVyb3BlYW4gYW5kIEFyYWJpYyBudW1iZXJzIGFjdCBhcyBpZiB0aGV5IHdlcmUgUiBpblxuICAgICAgLy8gdGVybXMgb2YgdGhlaXIgaW5mbHVlbmNlIG9uIG5ldXRyYWxzLiBTdGFydC1vZi1sZXZlbC1ydW4gKHNvcilcbiAgICAgIC8vIGFuZCBlbmQtb2YtbGV2ZWwtcnVuIChlb3IpIGFyZSB1c2VkIGF0IGxldmVsIHJ1biBib3VuZGFyaWVzLlxuICAgICAgLy8gTjIuIEFueSByZW1haW5pbmcgbmV1dHJhbHMgdGFrZSB0aGUgZW1iZWRkaW5nIGRpcmVjdGlvbi5cbiAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuOyArK2kpIHtcbiAgICAgICAgaWYgKGlzTmV1dHJhbC50ZXN0KHR5cGVzW2ldKSkge1xuICAgICAgICAgIGZvciAodmFyIGVuZCA9IGkgKyAxOyBlbmQgPCBsZW4gJiYgaXNOZXV0cmFsLnRlc3QodHlwZXNbZW5kXSk7ICsrZW5kKSB7fVxuICAgICAgICAgIHZhciBiZWZvcmUgPSAoaSA/IHR5cGVzW2ktMV0gOiBvdXRlclR5cGUpID09IFwiTFwiO1xuICAgICAgICAgIHZhciBhZnRlciA9IChlbmQgPCBsZW4gPyB0eXBlc1tlbmRdIDogb3V0ZXJUeXBlKSA9PSBcIkxcIjtcbiAgICAgICAgICB2YXIgcmVwbGFjZSA9IGJlZm9yZSB8fCBhZnRlciA/IFwiTFwiIDogXCJSXCI7XG4gICAgICAgICAgZm9yICh2YXIgaiA9IGk7IGogPCBlbmQ7ICsraikgdHlwZXNbal0gPSByZXBsYWNlO1xuICAgICAgICAgIGkgPSBlbmQgLSAxO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIC8vIEhlcmUgd2UgZGVwYXJ0IGZyb20gdGhlIGRvY3VtZW50ZWQgYWxnb3JpdGhtLCBpbiBvcmRlciB0byBhdm9pZFxuICAgICAgLy8gYnVpbGRpbmcgdXAgYW4gYWN0dWFsIGxldmVscyBhcnJheS4gU2luY2UgdGhlcmUgYXJlIG9ubHkgdGhyZWVcbiAgICAgIC8vIGxldmVscyAoMCwgMSwgMikgaW4gYW4gaW1wbGVtZW50YXRpb24gdGhhdCBkb2Vzbid0IHRha2VcbiAgICAgIC8vIGV4cGxpY2l0IGVtYmVkZGluZyBpbnRvIGFjY291bnQsIHdlIGNhbiBidWlsZCB1cCB0aGUgb3JkZXIgb25cbiAgICAgIC8vIHRoZSBmbHksIHdpdGhvdXQgZm9sbG93aW5nIHRoZSBsZXZlbC1iYXNlZCBhbGdvcml0aG0uXG4gICAgICB2YXIgb3JkZXIgPSBbXSwgbTtcbiAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuOykge1xuICAgICAgICBpZiAoY291bnRzQXNMZWZ0LnRlc3QodHlwZXNbaV0pKSB7XG4gICAgICAgICAgdmFyIHN0YXJ0ID0gaTtcbiAgICAgICAgICBmb3IgKCsraTsgaSA8IGxlbiAmJiBjb3VudHNBc0xlZnQudGVzdCh0eXBlc1tpXSk7ICsraSkge31cbiAgICAgICAgICBvcmRlci5wdXNoKG5ldyBCaWRpU3BhbigwLCBzdGFydCwgaSkpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHZhciBwb3MgPSBpLCBhdCA9IG9yZGVyLmxlbmd0aDtcbiAgICAgICAgICBmb3IgKCsraTsgaSA8IGxlbiAmJiB0eXBlc1tpXSAhPSBcIkxcIjsgKytpKSB7fVxuICAgICAgICAgIGZvciAodmFyIGogPSBwb3M7IGogPCBpOykge1xuICAgICAgICAgICAgaWYgKGNvdW50c0FzTnVtLnRlc3QodHlwZXNbal0pKSB7XG4gICAgICAgICAgICAgIGlmIChwb3MgPCBqKSBvcmRlci5zcGxpY2UoYXQsIDAsIG5ldyBCaWRpU3BhbigxLCBwb3MsIGopKTtcbiAgICAgICAgICAgICAgdmFyIG5zdGFydCA9IGo7XG4gICAgICAgICAgICAgIGZvciAoKytqOyBqIDwgaSAmJiBjb3VudHNBc051bS50ZXN0KHR5cGVzW2pdKTsgKytqKSB7fVxuICAgICAgICAgICAgICBvcmRlci5zcGxpY2UoYXQsIDAsIG5ldyBCaWRpU3BhbigyLCBuc3RhcnQsIGopKTtcbiAgICAgICAgICAgICAgcG9zID0gajtcbiAgICAgICAgICAgIH0gZWxzZSArK2o7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChwb3MgPCBpKSBvcmRlci5zcGxpY2UoYXQsIDAsIG5ldyBCaWRpU3BhbigxLCBwb3MsIGkpKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKG9yZGVyWzBdLmxldmVsID09IDEgJiYgKG0gPSBzdHIubWF0Y2goL15cXHMrLykpKSB7XG4gICAgICAgIG9yZGVyWzBdLmZyb20gPSBtWzBdLmxlbmd0aDtcbiAgICAgICAgb3JkZXIudW5zaGlmdChuZXcgQmlkaVNwYW4oMCwgMCwgbVswXS5sZW5ndGgpKTtcbiAgICAgIH1cbiAgICAgIGlmIChsc3Qob3JkZXIpLmxldmVsID09IDEgJiYgKG0gPSBzdHIubWF0Y2goL1xccyskLykpKSB7XG4gICAgICAgIGxzdChvcmRlcikudG8gLT0gbVswXS5sZW5ndGg7XG4gICAgICAgIG9yZGVyLnB1c2gobmV3IEJpZGlTcGFuKDAsIGxlbiAtIG1bMF0ubGVuZ3RoLCBsZW4pKTtcbiAgICAgIH1cbiAgICAgIGlmIChvcmRlclswXS5sZXZlbCA9PSAyKVxuICAgICAgICBvcmRlci51bnNoaWZ0KG5ldyBCaWRpU3BhbigxLCBvcmRlclswXS50bywgb3JkZXJbMF0udG8pKTtcbiAgICAgIGlmIChvcmRlclswXS5sZXZlbCAhPSBsc3Qob3JkZXIpLmxldmVsKVxuICAgICAgICBvcmRlci5wdXNoKG5ldyBCaWRpU3BhbihvcmRlclswXS5sZXZlbCwgbGVuLCBsZW4pKTtcblxuICAgICAgcmV0dXJuIG9yZGVyO1xuICAgIH07XG4gIH0pKCk7XG5cbiAgLy8gVEhFIEVORFxuXG4gIENvZGVNaXJyb3IudmVyc2lvbiA9IFwiNS40LjBcIjtcblxuICByZXR1cm4gQ29kZU1pcnJvcjtcbn0pO1xuIl19