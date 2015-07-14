(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({"/Users/gaowhen/Lab/flaskr/app/static/src/js/lib/showdown.js":[function(require,module,exports){
;/*! showdown 18-06-2015 */
(function(){
/**
 * Created by Tivie on 06-01-2015.
 */

// Private properties
var showdown = {},
    parsers = {},
    extensions = {},
    defaultOptions = {
      omitExtraWLInCodeBlocks: false,
      prefixHeaderId:          false,
      noHeaderId:              false,
      headerLevelStart:        1,
      parseImgDimensions:      false
    },
    globalOptions = JSON.parse(JSON.stringify(defaultOptions)); //clone default options out of laziness =P

/**
 * helper namespace
 * @type {{}}
 */
showdown.helper = {};

/**
 * TODO LEGACY SUPPORT CODE
 * @type {{}}
 */
showdown.extensions = {};

/**
 * Set a global option
 * @static
 * @param {string} key
 * @param {*} value
 * @returns {showdown}
 */
showdown.setOption = function (key, value) {
  'use strict';
  globalOptions[key] = value;
  return this;
};

/**
 * Get a global option
 * @static
 * @param {string} key
 * @returns {*}
 */
showdown.getOption = function (key) {
  'use strict';
  return globalOptions[key];
};

/**
 * Get the global options
 * @static
 * @returns {{}}
 */
showdown.getOptions = function () {
  'use strict';
  return globalOptions;
};

/**
 * Reset global options to the default values
 * @static
 */
showdown.resetOptions = function () {
  'use strict';
  globalOptions = JSON.parse(JSON.stringify(defaultOptions));
};

/**
 * Get the default options
 * @static
 * @returns {{}}
 */
showdown.getDefaultOptions = function () {
  'use strict';
  return defaultOptions;
};

/**
 * Get or set a subParser
 *
 * subParser(name)       - Get a registered subParser
 * subParser(name, func) - Register a subParser
 * @static
 * @param {string} name
 * @param {function} [func]
 * @returns {*}
 */
showdown.subParser = function (name, func) {
  'use strict';
  if (showdown.helper.isString(name)) {
    if (typeof func !== 'undefined') {
      parsers[name] = func;
    } else {
      if (parsers.hasOwnProperty(name)) {
        return parsers[name];
      } else {
        throw Error('SubParser named ' + name + ' not registered!');
      }
    }
  }
};

/**
 * Gets or registers an extension
 * @static
 * @param {string} name
 * @param {object|function=} ext
 * @returns {*}
 */
showdown.extension = function (name, ext) {
  'use strict';

  if (!showdown.helper.isString(name)) {
    throw Error('Extension \'name\' must be a string');
  }

  name = showdown.helper.stdExtName(name);

  // Getter
  if (showdown.helper.isUndefined(ext)) {
    if (!extensions.hasOwnProperty(name)) {
      throw Error('Extension named ' + name + ' is not registered!');
    }
    return extensions[name];

    // Setter
  } else {
    // Expand extension if it's wrapped in a function
    if (typeof ext === 'function') {
      ext = ext();
    }

    // Ensure extension is an array
    if (!showdown.helper.isArray(ext)) {
      ext = [ext];
    }

    var validExtension = validate(ext, name);

    if (validExtension.valid) {
      extensions[name] = ext;
    } else {
      throw Error(validExtension.error);
    }
  }
};

/**
 * Gets all extensions registered
 * @returns {{}}
 */
showdown.getAllExtensions = function () {
  'use strict';
  return extensions;
};

/**
 * Remove an extension
 * @param {string} name
 */
showdown.removeExtension = function (name) {
  'use strict';
  delete extensions[name];
};

/**
 * Removes all extensions
 */
showdown.resetExtensions = function () {
  'use strict';
  extensions = {};
};

/**
 * Validate extension
 * @param {array} extension
 * @param {string} name
 * @returns {{valid: boolean, error: string}}
 */
function validate(extension, name) {
  'use strict';

  var errMsg = (name) ? 'Error in ' + name + ' extension->' : 'Error in unnamed extension',
    ret = {
      valid: true,
      error: ''
    };

  if (!showdown.helper.isArray(extension)) {
    extension = [extension];
  }

  for (var i = 0; i < extension.length; ++i) {
    var baseMsg = errMsg + 'sub-extension ' + i + ': ',
        ext = extension[i];
    if (typeof ext !== 'object') {
      ret.valid = false;
      ret.error = baseMsg + 'must be an object, but ' + typeof ext + ' given';
      return ret;
    }

    if (!showdown.helper.isString(ext.type)) {
      ret.valid = false;
      ret.error = baseMsg + 'property "type" must be a string, but ' + typeof ext.type + ' given';
      return ret;
    }

    var type = ext.type = ext.type.toLowerCase();

    // normalize extension type
    if (type === 'language') {
      type = ext.type = 'lang';
    }

    if (type === 'html') {
      type = ext.type = 'output';
    }

    if (type !== 'lang' && type !== 'output') {
      ret.valid = false;
      ret.error = baseMsg + 'type ' + type + ' is not recognized. Valid values: "lang" or "output"';
      return ret;
    }

    if (ext.filter) {
      if (typeof ext.filter !== 'function') {
        ret.valid = false;
        ret.error = baseMsg + '"filter" must be a function, but ' + typeof ext.filter + ' given';
        return ret;
      }

    } else if (ext.regex) {
      if (showdown.helper.isString(ext.regex)) {
        ext.regex = new RegExp(ext.regex, 'g');
      }
      if (!ext.regex instanceof RegExp) {
        ret.valid = false;
        ret.error = baseMsg + '"regex" property must either be a string or a RegExp object, but ' +
          typeof ext.regex + ' given';
        return ret;
      }
      if (showdown.helper.isUndefined(ext.replace)) {
        ret.valid = false;
        ret.error = baseMsg + '"regex" extensions must implement a replace string or function';
        return ret;
      }

    } else {
      ret.valid = false;
      ret.error = baseMsg + 'extensions must define either a "regex" property or a "filter" method';
      return ret;
    }

    if (showdown.helper.isUndefined(ext.filter) && showdown.helper.isUndefined(ext.regex)) {
      ret.valid = false;
      ret.error = baseMsg + 'output extensions must define a filter property';
      return ret;
    }
  }
  return ret;
}

/**
 * Validate extension
 * @param {object} ext
 * @returns {boolean}
 */
showdown.validateExtension = function (ext) {
  'use strict';

  var validateExtension = validate(ext, null);
  if (!validateExtension.valid) {
    console.warn(validateExtension.error);
    return false;
  }
  return true;
};

/**
 * showdownjs helper functions
 */

if (!showdown.hasOwnProperty('helper')) {
  showdown.helper = {};
}

/**
 * Check if var is string
 * @static
 * @param {string} a
 * @returns {boolean}
 */
showdown.helper.isString = function isString(a) {
  'use strict';
  return (typeof a === 'string' || a instanceof String);
};

/**
 * ForEach helper function
 * @static
 * @param {*} obj
 * @param {function} callback
 */
showdown.helper.forEach = function forEach(obj, callback) {
  'use strict';
  if (typeof obj.forEach === 'function') {
    obj.forEach(callback);
  } else {
    for (var i = 0; i < obj.length; i++) {
      callback(obj[i], i, obj);
    }
  }
};

/**
 * isArray helper function
 * @static
 * @param {*} a
 * @returns {boolean}
 */
showdown.helper.isArray = function isArray(a) {
  'use strict';
  return a.constructor === Array;
};

/**
 * Check if value is undefined
 * @static
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is `undefined`, else `false`.
 */
showdown.helper.isUndefined = function isUndefined(value) {
  'use strict';
  return typeof value === 'undefined';
};

/**
 * Standardidize extension name
 * @static
 * @param {string} s extension name
 * @returns {string}
 */
showdown.helper.stdExtName = function (s) {
  'use strict';
  return s.replace(/[_-]||\s/g, '').toLowerCase();
};

function escapeCharactersCallback(wholeMatch, m1) {
  'use strict';
  var charCodeToEscape = m1.charCodeAt(0);
  return '~E' + charCodeToEscape + 'E';
}

/**
 * Callback used to escape characters when passing through String.replace
 * @static
 * @param {string} wholeMatch
 * @param {string} m1
 * @returns {string}
 */
showdown.helper.escapeCharactersCallback = escapeCharactersCallback;

/**
 * Escape characters in a string
 * @static
 * @param {string} text
 * @param {string} charsToEscape
 * @param {boolean} afterBackslash
 * @returns {XML|string|void|*}
 */
showdown.helper.escapeCharacters = function escapeCharacters(text, charsToEscape, afterBackslash) {
  'use strict';
  // First we have to escape the escape characters so that
  // we can build a character class out of them
  var regexString = '([' + charsToEscape.replace(/([\[\]\\])/g, '\\$1') + '])';

  if (afterBackslash) {
    regexString = '\\\\' + regexString;
  }

  var regex = new RegExp(regexString, 'g');
  text = text.replace(regex, escapeCharactersCallback);

  return text;
};

/**
 * POLYFILLS
 */
if (showdown.helper.isUndefined(console)) {
  console = {
    warn: function (msg) {
      'use strict';
      alert(msg);
    },
    log: function (msg) {
      'use strict';
      alert(msg);
    }
  };
}

/**
 * Created by Estevao on 31-05-2015.
 */

/**
 * Showdown Converter class
 * @class
 * @param {object} [converterOptions]
 * @returns {
 *  {makeHtml: Function},
 *  {setOption: Function},
 *  {getOption: Function},
 *  {getOptions: Function}
 * }
 */
showdown.Converter = function (converterOptions) {
  'use strict';

  var
      /**
       * Options used by this converter
       * @private
       * @type {{}}
       */
      options = {
        omitExtraWLInCodeBlocks: false,
        prefixHeaderId:          false,
        noHeaderId:              false
      },

      /**
       * Language extensions used by this converter
       * @private
       * @type {Array}
       */
      langExtensions = [],

      /**
       * Output modifiers extensions used by this converter
       * @private
       * @type {Array}
       */
      outputModifiers = [],

      /**
       * The parser Order
       * @private
       * @type {string[]}
       */
      parserOrder = [
        'githubCodeBlocks',
        'hashHTMLBlocks',
        'stripLinkDefinitions',
        'blockGamut',
        'unescapeSpecialChars'
      ];

  _constructor();

  /**
   * Converter constructor
   * @private
   */
  function _constructor() {
    converterOptions = converterOptions || {};

    for (var gOpt in globalOptions) {
      if (globalOptions.hasOwnProperty(gOpt)) {
        options[gOpt] = globalOptions[gOpt];
      }
    }

    // Merge options
    if (typeof converterOptions === 'object') {
      for (var opt in converterOptions) {
        if (converterOptions.hasOwnProperty(opt)) {
          options[opt] = converterOptions[opt];
        }
      }
    } else {
      throw Error('Converter expects the passed parameter to be an object, but ' + typeof converterOptions +
      ' was passed instead.');
    }

    if (options.extensions) {
      showdown.helper.forEach(options.extensions, _parseExtension);
    }
  }

  /**
   * Parse extension
   * @param {*} ext
   * @private
   */
  function _parseExtension(ext) {

    // If it's a string, the extension was previously loaded
    if (showdown.helper.isString(ext)) {
      ext = showdown.helper.stdExtName(ext);

      // LEGACY_SUPPORT CODE
      if (showdown.extensions[ext]) {
        console.warn('DEPRECATION WARNING: ' + ext + ' is an old extension that uses a deprecated loading method.' +
          'Please inform the developer that the extension should be updated!');
        legacyExtensionLoading(showdown.extensions[ext], ext);
        return;
      // END LEGACY SUPPORT CODE

      } else if (!showdown.helper.isUndefined(extensions[ext])) {
        ext = extensions[ext];

      } else {
        throw Error('Extension "' + ext + '" could not be loaded. It was either not found or is not a valid extension.');
      }
    }

    if (typeof ext === 'function') {
      ext = ext();
    }

    if (!showdown.helper.isArray(ext)) {
      ext = [ext];
    }

    if (!showdown.validateExtension(ext)) {
      return;
    }

    for (var i = 0; i < ext.length; ++i) {
      switch (ext[i].type) {
        case 'lang':
          langExtensions.push(ext[i]);
          break;

        case 'output':
          outputModifiers.push(ext[i]);
          break;

        default:
          // should never reach here
          throw Error('Extension loader error: Type unrecognized!!!');
      }
    }
  }

  /**
   * LEGACY_SUPPORT
   * @param {*} ext
   * @param {string} name
   */
  function legacyExtensionLoading(ext, name) {
    if (typeof ext === 'function') {
      ext = ext(new showdown.Converter());
    }
    if (!showdown.helper.isArray(ext)) {
      ext = [ext];
    }
    var valid = validate(ext, name);

    if (!valid.valid) {
      throw Error(valid.error);
    }

    for (var i = 0; i < ext.length; ++i) {
      switch (ext[i].type) {
        case 'lang':
          langExtensions.push(ext[i]);
          break;
        case 'output':
          outputModifiers.push(ext[i]);
          break;
        default:// should never reach here
          throw Error('Extension loader error: Type unrecognized!!!');
      }
    }
  }

  /**
   * Converts a markdown string into HTML
   * @param {string} text
   * @returns {*}
   */
  this.makeHtml = function (text) {
    //check if text is not falsy
    if (!text) {
      return text;
    }

    var globals = {
      gHtmlBlocks:     [],
      gUrls:           {},
      gTitles:         {},
      gDimensions:     {},
      gListLevel:      0,
      hashLinkCounts:  {},
      langExtensions:  langExtensions,
      outputModifiers: outputModifiers,
      converter:       this
    };

    // attacklab: Replace ~ with ~T
    // This lets us use tilde as an escape char to avoid md5 hashes
    // The choice of character is arbitrary; anything that isn't
    // magic in Markdown will work.
    text = text.replace(/~/g, '~T');

    // attacklab: Replace $ with ~D
    // RegExp interprets $ as a special character
    // when it's in a replacement string
    text = text.replace(/\$/g, '~D');

    // Standardize line endings
    text = text.replace(/\r\n/g, '\n'); // DOS to Unix
    text = text.replace(/\r/g, '\n'); // Mac to Unix

    // Make sure text begins and ends with a couple of newlines:
    text = '\n\n' + text + '\n\n';

    // detab
    text = showdown.subParser('detab')(text, options, globals);

    // stripBlankLines
    text = showdown.subParser('stripBlankLines')(text, options, globals);

    //run languageExtensions
    showdown.helper.forEach(langExtensions, function (ext) {
      text = showdown.subParser('runExtension')(ext, text, options, globals);
    });

    // Run all registered parsers
    for (var i = 0; i < parserOrder.length; ++i) {
      var name = parserOrder[i];
      text = parsers[name](text, options, globals);
    }

    // attacklab: Restore dollar signs
    text = text.replace(/~D/g, '$$');

    // attacklab: Restore tildes
    text = text.replace(/~T/g, '~');

    // Run output modifiers
    showdown.helper.forEach(outputModifiers, function (ext) {
      text = showdown.subParser('runExtension')(ext, text, options, globals);
    });

    return text;
  };

  /**
   * Set an option of this Converter instance
   * @param {string} key
   * @param {*} value
   */
  this.setOption = function (key, value) {
    options[key] = value;
  };

  /**
   * Get the option of this Converter instance
   * @param {string} key
   * @returns {*}
   */
  this.getOption = function (key) {
    return options[key];
  };

  /**
   * Get the options of this Converter instance
   * @returns {{}}
   */
  this.getOptions = function () {
    return options;
  };

  /**
   * Add extension to THIS converter
   * @param {{}} extension
   */
  this.addExtension = function (extension) {
    _parseExtension(extension);
  };

  /**
   * Use a global registered extension with THIS converter
   * @param {string} extensionName Name of the previously registered extension
   */
  this.useExtension = function (extensionName) {
    _parseExtension(extensionName);
  };

  /**
   * Remove an extension from THIS converter.
   * Note: This is a costly operation. It's better to initialize a new converter
   * and specify the extensions you wish to use
   * @param {Array} extension
   */
  this.removeExtension = function (extension) {
    if (!showdown.helper.isArray(extension)) {
      extension = [extension];
    }
    for (var a = 0; a < extension.length; ++a) {
      var ext = extension[a];
      for (var i = 0; i < langExtensions.length; ++i) {
        if (langExtensions[i] === ext) {
          langExtensions[i].splice(i, 1);
        }
      }
      for (var ii = 0; ii < outputModifiers.length; ++i) {
        if (outputModifiers[ii] === ext) {
          outputModifiers[ii].splice(i, 1);
        }
      }
    }
  };

  /**
   * Get all extension of THIS converter
   * @returns {{language: Array, output: Array}}
   */
  this.getAllExtensions = function () {
    return {
      language: langExtensions,
      output: outputModifiers
    };
  };
};

/**
 * Turn Markdown link shortcuts into XHTML <a> tags.
 */
showdown.subParser('anchors', function (text, config, globals) {
  'use strict';

  var writeAnchorTag = function (wholeMatch, m1, m2, m3, m4, m5, m6, m7) {
    if (showdown.helper.isUndefined(m7)) {
      m7 = '';
    }
    wholeMatch = m1;
    var linkText = m2,
        linkId = m3.toLowerCase(),
        url = m4,
        title = m7;

    if (!url) {
      if (!linkId) {
        // lower-case and turn embedded newlines into spaces
        linkId = linkText.toLowerCase().replace(/ ?\n/g, ' ');
      }
      url = '#' + linkId;

      if (!showdown.helper.isUndefined(globals.gUrls[linkId])) {
        url = globals.gUrls[linkId];
        if (!showdown.helper.isUndefined(globals.gTitles[linkId])) {
          title = globals.gTitles[linkId];
        }
      } else {
        if (wholeMatch.search(/\(\s*\)$/m) > -1) {
          // Special case for explicit empty url
          url = '';
        } else {
          return wholeMatch;
        }
      }
    }

    url = showdown.helper.escapeCharacters(url, '*_', false);
    var result = '<a href="' + url + '"';

    if (title !== '' && title !== null) {
      title = title.replace(/"/g, '&quot;');
      title = showdown.helper.escapeCharacters(title, '*_', false);
      result += ' title="' + title + '"';
    }

    result += '>' + linkText + '</a>';

    return result;
  };

  // First, handle reference-style links: [link text] [id]
  /*
   text = text.replace(/
   (							// wrap whole match in $1
   \[
   (
   (?:
   \[[^\]]*\]		// allow brackets nested one level
   |
   [^\[]			// or anything else
   )*
   )
   \]

   [ ]?					// one optional space
   (?:\n[ ]*)?				// one optional newline followed by spaces

   \[
   (.*?)					// id = $3
   \]
   )()()()()					// pad remaining backreferences
   /g,_DoAnchors_callback);
   */
  text = text.replace(/(\[((?:\[[^\]]*\]|[^\[\]])*)\][ ]?(?:\n[ ]*)?\[(.*?)\])()()()()/g, writeAnchorTag);

  //
  // Next, inline-style links: [link text](url "optional title")
  //

  /*
   text = text.replace(/
   (						// wrap whole match in $1
   \[
   (
   (?:
   \[[^\]]*\]	// allow brackets nested one level
   |
   [^\[\]]			// or anything else
   )
   )
   \]
   \(						// literal paren
   [ \t]*
   ()						// no id, so leave $3 empty
   <?(.*?)>?				// href = $4
   [ \t]*
   (						// $5
   (['"])				// quote char = $6
   (.*?)				// Title = $7
   \6					// matching quote
   [ \t]*				// ignore any spaces/tabs between closing quote and )
   )?						// title is optional
   \)
   )
   /g,writeAnchorTag);
   */
  text = text.replace(/(\[((?:\[[^\]]*\]|[^\[\]])*)\]\([ \t]*()<?(.*?(?:\(.*?\).*?)?)>?[ \t]*((['"])(.*?)\6[ \t]*)?\))/g,
                      writeAnchorTag);

  //
  // Last, handle reference-style shortcuts: [link text]
  // These must come last in case you've also got [link test][1]
  // or [link test](/foo)
  //

  /*
   text = text.replace(/
   (                // wrap whole match in $1
   \[
   ([^\[\]]+)       // link text = $2; can't contain '[' or ']'
   \]
   )()()()()()      // pad rest of backreferences
   /g, writeAnchorTag);
   */
  text = text.replace(/(\[([^\[\]]+)\])()()()()()/g, writeAnchorTag);

  return text;

});

showdown.subParser('autoLinks', function (text) {
  'use strict';

  text = text.replace(/<((https?|ftp|dict):[^'">\s]+)>/gi, '<a href=\"$1\">$1</a>');

  // Email addresses: <address@domain.foo>

  /*
   text = text.replace(/
   <
   (?:mailto:)?
   (
   [-.\w]+
   \@
   [-a-z0-9]+(\.[-a-z0-9]+)*\.[a-z]+
   )
   >
   /gi);
   */
  var pattern = /<(?:mailto:)?([-.\w]+\@[-a-z0-9]+(\.[-a-z0-9]+)*\.[a-z]+)>/gi;
  text = text.replace(pattern, function (wholeMatch, m1) {
    var unescapedStr = showdown.subParser('unescapeSpecialChars')(m1);
    return showdown.subParser('encodeEmailAddress')(unescapedStr);
  });

  return text;

});

/**
 * These are all the transformations that form block-level
 * tags like paragraphs, headers, and list items.
 */
showdown.subParser('blockGamut', function (text, options, globals) {
  'use strict';

  text = showdown.subParser('headers')(text, options, globals);

  // Do Horizontal Rules:
  var key = showdown.subParser('hashBlock')('<hr />', options, globals);
  text = text.replace(/^[ ]{0,2}([ ]?\*[ ]?){3,}[ \t]*$/gm, key);
  text = text.replace(/^[ ]{0,2}([ ]?\-[ ]?){3,}[ \t]*$/gm, key);
  text = text.replace(/^[ ]{0,2}([ ]?\_[ ]?){3,}[ \t]*$/gm, key);

  text = showdown.subParser('lists')(text, options, globals);
  text = showdown.subParser('codeBlocks')(text, options, globals);
  text = showdown.subParser('blockQuotes')(text, options, globals);

  // We already ran _HashHTMLBlocks() before, in Markdown(), but that
  // was to escape raw HTML in the original Markdown source. This time,
  // we're escaping the markup we've just created, so that we don't wrap
  // <p> tags around block-level tags.
  text = showdown.subParser('hashHTMLBlocks')(text, options, globals);
  text = showdown.subParser('paragraphs')(text, options, globals);

  return text;

});

showdown.subParser('blockQuotes', function (text, options, globals) {
  'use strict';

  /*
   text = text.replace(/
   (								// Wrap whole match in $1
   (
   ^[ \t]*>[ \t]?			// '>' at the start of a line
   .+\n					// rest of the first line
   (.+\n)*					// subsequent consecutive lines
   \n*						// blanks
   )+
   )
   /gm, function(){...});
   */

  text = text.replace(/((^[ \t]*>[ \t]?.+\n(.+\n)*\n*)+)/gm, function (wholeMatch, m1) {
    var bq = m1;

    // attacklab: hack around Konqueror 3.5.4 bug:
    // "----------bug".replace(/^-/g,"") == "bug"
    bq = bq.replace(/^[ \t]*>[ \t]?/gm, '~0'); // trim one level of quoting

    // attacklab: clean up hack
    bq = bq.replace(/~0/g, '');

    bq = bq.replace(/^[ \t]+$/gm, ''); // trim whitespace-only lines
    bq = showdown.subParser('blockGamut')(bq, options, globals); // recurse

    bq = bq.replace(/(^|\n)/g, '$1  ');
    // These leading spaces screw with <pre> content, so we need to fix that:
    bq = bq.replace(/(\s*<pre>[^\r]+?<\/pre>)/gm, function (wholeMatch, m1) {
      var pre = m1;
      // attacklab: hack around Konqueror 3.5.4 bug:
      pre = pre.replace(/^  /mg, '~0');
      pre = pre.replace(/~0/g, '');
      return pre;
    });

    return showdown.subParser('hashBlock')('<blockquote>\n' + bq + '\n</blockquote>', options, globals);
  });
  return text;
});

/**
 * Process Markdown `<pre><code>` blocks.
 */
showdown.subParser('codeBlocks', function (text, options, globals) {
  'use strict';

  /*
   text = text.replace(text,
   /(?:\n\n|^)
   (								// $1 = the code block -- one or more lines, starting with a space/tab
   (?:
   (?:[ ]{4}|\t)			// Lines must start with a tab or a tab-width of spaces - attacklab: g_tab_width
   .*\n+
   )+
   )
   (\n*[ ]{0,3}[^ \t\n]|(?=~0))	// attacklab: g_tab_width
   /g,function(){...});
   */

  // attacklab: sentinel workarounds for lack of \A and \Z, safari\khtml bug
  text += '~0';

  var pattern = /(?:\n\n|^)((?:(?:[ ]{4}|\t).*\n+)+)(\n*[ ]{0,3}[^ \t\n]|(?=~0))/g;
  text = text.replace(pattern, function (wholeMatch, m1, m2) {
    var codeblock = m1,
        nextChar = m2,
        end = '\n';

    codeblock = showdown.subParser('outdent')(codeblock);
    codeblock = showdown.subParser('encodeCode')(codeblock);
    codeblock = showdown.subParser('detab')(codeblock);
    codeblock = codeblock.replace(/^\n+/g, ''); // trim leading newlines
    codeblock = codeblock.replace(/\n+$/g, ''); // trim trailing newlines

    if (options.omitExtraWLInCodeBlocks) {
      end = '';
    }

    codeblock = '<pre><code>' + codeblock + end + '</code></pre>';

    return showdown.subParser('hashBlock')(codeblock, options, globals) + nextChar;
  });

  // attacklab: strip sentinel
  text = text.replace(/~0/, '');

  return text;
});

/**
 *
 *   *  Backtick quotes are used for <code></code> spans.
 *
 *   *  You can use multiple backticks as the delimiters if you want to
 *     include literal backticks in the code span. So, this input:
 *
 *         Just type ``foo `bar` baz`` at the prompt.
 *
 *       Will translate to:
 *
 *         <p>Just type <code>foo `bar` baz</code> at the prompt.</p>
 *
 *    There's no arbitrary limit to the number of backticks you
 *    can use as delimters. If you need three consecutive backticks
 *    in your code, use four for delimiters, etc.
 *
 *  *  You can use spaces to get literal backticks at the edges:
 *
 *         ... type `` `bar` `` ...
 *
 *       Turns to:
 *
 *         ... type <code>`bar`</code> ...
 */
showdown.subParser('codeSpans', function (text) {
  'use strict';

  /*
   text = text.replace(/
   (^|[^\\])					// Character before opening ` can't be a backslash
   (`+)						// $2 = Opening run of `
   (							// $3 = The code block
   [^\r]*?
   [^`]					// attacklab: work around lack of lookbehind
   )
   \2							// Matching closer
   (?!`)
   /gm, function(){...});
   */

  text = text.replace(/(^|[^\\])(`+)([^\r]*?[^`])\2(?!`)/gm, function (wholeMatch, m1, m2, m3) {
    var c = m3;
    c = c.replace(/^([ \t]*)/g, '');	// leading whitespace
    c = c.replace(/[ \t]*$/g, '');	// trailing whitespace
    c = showdown.subParser('encodeCode')(c);
    return m1 + '<code>' + c + '</code>';
  });

  return text;

});

/**
 * Convert all tabs to spaces
 */
showdown.subParser('detab', function (text) {
  'use strict';

  // expand first n-1 tabs
  text = text.replace(/\t(?=\t)/g, '    '); // g_tab_width

  // replace the nth with two sentinels
  text = text.replace(/\t/g, '~A~B');

  // use the sentinel to anchor our regex so it doesn't explode
  text = text.replace(/~B(.+?)~A/g, function (wholeMatch, m1) {
    var leadingText = m1,
        numSpaces = 4 - leadingText.length % 4;  // g_tab_width

    // there *must* be a better way to do this:
    for (var i = 0; i < numSpaces; i++) {
      leadingText += ' ';
    }

    return leadingText;
  });

  // clean up sentinels
  text = text.replace(/~A/g, '    ');  // g_tab_width
  text = text.replace(/~B/g, '');

  return text;

});

/**
 * Smart processing for ampersands and angle brackets that need to be encoded.
 */
showdown.subParser('encodeAmpsAndAngles', function (text) {
  'use strict';
  // Ampersand-encoding based entirely on Nat Irons's Amputator MT plugin:
  // http://bumppo.net/projects/amputator/
  text = text.replace(/&(?!#?[xX]?(?:[0-9a-fA-F]+|\w+);)/g, '&amp;');

  // Encode naked <'s
  text = text.replace(/<(?![a-z\/?\$!])/gi, '&lt;');

  return text;
});

/**
 * Returns the string, with after processing the following backslash escape sequences.
 *
 * attacklab: The polite way to do this is with the new escapeCharacters() function:
 *
 *    text = escapeCharacters(text,"\\",true);
 *    text = escapeCharacters(text,"`*_{}[]()>#+-.!",true);
 *
 * ...but we're sidestepping its use of the (slow) RegExp constructor
 * as an optimization for Firefox.  This function gets called a LOT.
 */
showdown.subParser('encodeBackslashEscapes', function (text) {
  'use strict';
  text = text.replace(/\\(\\)/g, showdown.helper.escapeCharactersCallback);
  text = text.replace(/\\([`*_{}\[\]()>#+-.!])/g, showdown.helper.escapeCharactersCallback);
  return text;
});

/**
 * Encode/escape certain characters inside Markdown code runs.
 * The point is that in code, these characters are literals,
 * and lose their special Markdown meanings.
 */
showdown.subParser('encodeCode', function (text) {
  'use strict';

  // Encode all ampersands; HTML entities are not
  // entities within a Markdown code span.
  text = text.replace(/&/g, '&amp;');

  // Do the angle bracket song and dance:
  text = text.replace(/</g, '&lt;');
  text = text.replace(/>/g, '&gt;');

  // Now, escape characters that are magic in Markdown:
  text = showdown.helper.escapeCharacters(text, '*_{}[]\\', false);

  // jj the line above breaks this:
  //---
  //* Item
  //   1. Subitem
  //            special char: *
  // ---

  return text;
});

/**
 *  Input: an email address, e.g. "foo@example.com"
 *
 *  Output: the email address as a mailto link, with each character
 *    of the address encoded as either a decimal or hex entity, in
 *    the hopes of foiling most address harvesting spam bots. E.g.:
 *
 *    <a href="&#x6D;&#97;&#105;&#108;&#x74;&#111;:&#102;&#111;&#111;&#64;&#101;
 *       x&#x61;&#109;&#x70;&#108;&#x65;&#x2E;&#99;&#111;&#109;">&#102;&#111;&#111;
 *       &#64;&#101;x&#x61;&#109;&#x70;&#108;&#x65;&#x2E;&#99;&#111;&#109;</a>
 *
 *  Based on a filter by Matthew Wickline, posted to the BBEdit-Talk
 *  mailing list: <http://tinyurl.com/yu7ue>
 *
 */
showdown.subParser('encodeEmailAddress', function (addr) {
  'use strict';

  var encode = [
    function (ch) {
      return '&#' + ch.charCodeAt(0) + ';';
    },
    function (ch) {
      return '&#x' + ch.charCodeAt(0).toString(16) + ';';
    },
    function (ch) {
      return ch;
    }
  ];

  addr = 'mailto:' + addr;

  addr = addr.replace(/./g, function (ch) {
    if (ch === '@') {
      // this *must* be encoded. I insist.
      ch = encode[Math.floor(Math.random() * 2)](ch);
    } else if (ch !== ':') {
      // leave ':' alone (to spot mailto: later)
      var r = Math.random();
      // roughly 10% raw, 45% hex, 45% dec
      ch = (
        r > 0.9 ? encode[2](ch) : r > 0.45 ? encode[1](ch) : encode[0](ch)
      );
    }
    return ch;
  });

  addr = '<a href="' + addr + '">' + addr + '</a>';
  addr = addr.replace(/">.+:/g, '">'); // strip the mailto: from the visible part

  return addr;
});

/**
 * Within tags -- meaning between < and > -- encode [\ ` * _] so they
 * don't conflict with their use in Markdown for code, italics and strong.
 */
showdown.subParser('escapeSpecialCharsWithinTagAttributes', function (text) {
  'use strict';

  // Build a regex to find HTML tags and comments.  See Friedl's
  // "Mastering Regular Expressions", 2nd Ed., pp. 200-201.
  var regex = /(<[a-z\/!$]("[^"]*"|'[^']*'|[^'">])*>|<!(--.*?--\s*)+>)/gi;

  text = text.replace(regex, function (wholeMatch) {
    var tag = wholeMatch.replace(/(.)<\/?code>(?=.)/g, '$1`');
    tag = showdown.helper.escapeCharacters(tag, '\\`*_', false);
    return tag;
  });

  return text;
});

/**
 * Handle github codeblocks prior to running HashHTML so that
 * HTML contained within the codeblock gets escaped properly
 * Example:
 * ```ruby
 *     def hello_world(x)
 *       puts "Hello, #{x}"
 *     end
 * ```
 */
showdown.subParser('githubCodeBlocks', function (text, options, globals) {
  'use strict';

  text += '~0';

  text = text.replace(/(?:^|\n)```(.*)\n([\s\S]*?)\n```/g, function (wholeMatch, m1, m2) {
    var language = m1,
        codeblock = m2,
        end = '\n';

    if (options.omitExtraWLInCodeBlocks) {
      end = '';
    }

    codeblock = showdown.subParser('encodeCode')(codeblock);
    codeblock = showdown.subParser('detab')(codeblock);
    codeblock = codeblock.replace(/^\n+/g, ''); // trim leading newlines
    codeblock = codeblock.replace(/\n+$/g, ''); // trim trailing whitespace

    codeblock = '<pre><code' + (language ? ' class="' + language + '"' : '') + '>' + codeblock + end + '</code></pre>';

    return showdown.subParser('hashBlock')(codeblock, options, globals);
  });

  // attacklab: strip sentinel
  text = text.replace(/~0/, '');

  return text;

});

showdown.subParser('hashBlock', function (text, options, globals) {
  'use strict';
  text = text.replace(/(^\n+|\n+$)/g, '');
  return '\n\n~K' + (globals.gHtmlBlocks.push(text) - 1) + 'K\n\n';
});

showdown.subParser('hashElement', function (text, options, globals) {
  'use strict';

  return function (wholeMatch, m1) {
    var blockText = m1;

    // Undo double lines
    blockText = blockText.replace(/\n\n/g, '\n');
    blockText = blockText.replace(/^\n/, '');

    // strip trailing blank lines
    blockText = blockText.replace(/\n+$/g, '');

    // Replace the element text with a marker ("~KxK" where x is its key)
    blockText = '\n\n~K' + (globals.gHtmlBlocks.push(blockText) - 1) + 'K\n\n';

    return blockText;
  };
});

showdown.subParser('hashHTMLBlocks', function (text, options, globals) {
  'use strict';

  // attacklab: Double up blank lines to reduce lookaround
  text = text.replace(/\n/g, '\n\n');

  // Hashify HTML blocks:
  // We only want to do this for block-level HTML tags, such as headers,
  // lists, and tables. That's because we still want to wrap <p>s around
  // "paragraphs" that are wrapped in non-block-level tags, such as anchors,
  // phrase emphasis, and spans. The list of tags we're looking for is
  // hard-coded:
  //var block_tags_a =
  // 'p|div|h[1-6]|blockquote|pre|table|dl|ol|ul|script|noscript|form|fieldset|iframe|math|ins|del|style|section|header|footer|nav|article|aside';
  // var block_tags_b =
  // 'p|div|h[1-6]|blockquote|pre|table|dl|ol|ul|script|noscript|form|fieldset|iframe|math|style|section|header|footer|nav|article|aside';

  // First, look for nested blocks, e.g.:
  //   <div>
  //     <div>
  //     tags for inner block must be indented.
  //     </div>
  //   </div>
  //
  // The outermost tags must start at the left margin for this to match, and
  // the inner nested divs must be indented.
  // We need to do this before the next, more liberal match, because the next
  // match will start at the first `<div>` and stop at the first `</div>`.

  // attacklab: This regex can be expensive when it fails.
  /*
   var text = text.replace(/
   (						// save in $1
   ^					// start of line  (with /m)
   <($block_tags_a)	// start tag = $2
   \b					// word break
   // attacklab: hack around khtml/pcre bug...
   [^\r]*?\n			// any number of lines, minimally matching
   </\2>				// the matching end tag
   [ \t]*				// trailing spaces/tabs
   (?=\n+)				// followed by a newline
   )						// attacklab: there are sentinel newlines at end of document
   /gm,function(){...}};
   */
  text = text.replace(/^(<(p|div|h[1-6]|blockquote|pre|table|dl|ol|ul|script|noscript|form|fieldset|iframe|math|ins|del)\b[^\r]*?\n<\/\2>[ \t]*(?=\n+))/gm,
                      showdown.subParser('hashElement')(text, options, globals));

  //
  // Now match more liberally, simply from `\n<tag>` to `</tag>\n`
  //

  /*
   var text = text.replace(/
   (						// save in $1
   ^					// start of line  (with /m)
   <($block_tags_b)	// start tag = $2
   \b					// word break
   // attacklab: hack around khtml/pcre bug...
   [^\r]*?				// any number of lines, minimally matching
   </\2>				// the matching end tag
   [ \t]*				// trailing spaces/tabs
   (?=\n+)				// followed by a newline
   )						// attacklab: there are sentinel newlines at end of document
   /gm,function(){...}};
   */
  text = text.replace(/^(<(p|div|h[1-6]|blockquote|pre|table|dl|ol|ul|script|noscript|form|fieldset|iframe|math|style|section|header|footer|nav|article|aside|address|audio|canvas|figure|hgroup|output|video)\b[^\r]*?<\/\2>[ \t]*(?=\n+)\n)/gm,
                      showdown.subParser('hashElement')(text, options, globals));

  // Special case just for <hr />. It was easier to make a special case than
  // to make the other regex more complicated.

  /*
   text = text.replace(/
   (						// save in $1
   \n\n				// Starting after a blank line
   [ ]{0,3}
   (<(hr)				// start tag = $2
   \b					// word break
   ([^<>])*?			//
   \/?>)				// the matching end tag
   [ \t]*
   (?=\n{2,})			// followed by a blank line
   )
   /g,showdown.subParser('hashElement')(text, options, globals));
   */
  text = text.replace(/(\n[ ]{0,3}(<(hr)\b([^<>])*?\/?>)[ \t]*(?=\n{2,}))/g,
                      showdown.subParser('hashElement')(text, options, globals));

  // Special case for standalone HTML comments:

  /*
   text = text.replace(/
   (						// save in $1
   \n\n				// Starting after a blank line
   [ ]{0,3}			// attacklab: g_tab_width - 1
   <!
   (--[^\r]*?--\s*)+
   >
   [ \t]*
   (?=\n{2,})			// followed by a blank line
   )
   /g,showdown.subParser('hashElement')(text, options, globals));
   */
  text = text.replace(/(\n\n[ ]{0,3}<!(--[^\r]*?--\s*)+>[ \t]*(?=\n{2,}))/g,
                      showdown.subParser('hashElement')(text, options, globals));

  // PHP and ASP-style processor instructions (<?...?> and <%...%>)

  /*
   text = text.replace(/
   (?:
   \n\n				// Starting after a blank line
   )
   (						// save in $1
   [ ]{0,3}			// attacklab: g_tab_width - 1
   (?:
   <([?%])			// $2
   [^\r]*?
   \2>
   )
   [ \t]*
   (?=\n{2,})			// followed by a blank line
   )
   /g,showdown.subParser('hashElement')(text, options, globals));
   */
  text = text.replace(/(?:\n\n)([ ]{0,3}(?:<([?%])[^\r]*?\2>)[ \t]*(?=\n{2,}))/g,
                      showdown.subParser('hashElement')(text, options, globals));

  // attacklab: Undo double lines (see comment at top of this function)
  text = text.replace(/\n\n/g, '\n');
  return text;

});

showdown.subParser('headers', function (text, options, globals) {
  'use strict';

  var prefixHeader = options.prefixHeaderId;

  // Set text-style headers:
  //	Header 1
  //	========
  //
  //	Header 2
  //	--------
  //
  text = text.replace(/^(.+)[ \t]*\n=+[ \t]*\n+/gm, function (wholeMatch, m1) {

    var spanGamut = showdown.subParser('spanGamut')(m1, options, globals),
        hID = (options.noHeaderId) ? '' : ' id="' + headerId(m1) + '"',
        hLevel = parseInt(options.headerLevelStart),
        hashBlock = '<h' + hLevel + hID + '>' + spanGamut + '</h' + hLevel + '>';
    return showdown.subParser('hashBlock')(hashBlock, options, globals);
  });

  text = text.replace(/^(.+)[ \t]*\n-+[ \t]*\n+/gm, function (matchFound, m1) {
    var spanGamut = showdown.subParser('spanGamut')(m1, options, globals),
        hID = (options.noHeaderId) ? '' : ' id="' + headerId(m1) + '"',
        hLevel = parseInt(options.headerLevelStart) + 1,
      hashBlock = '<h' + hLevel + hID + '>' + spanGamut + '</h' + hLevel + '>';
    return showdown.subParser('hashBlock')(hashBlock, options, globals);
  });

  // atx-style headers:
  //  # Header 1
  //  ## Header 2
  //  ## Header 2 with closing hashes ##
  //  ...
  //  ###### Header 6
  //

  /*
   text = text.replace(/
   ^(\#{1,6})				// $1 = string of #'s
   [ \t]*
   (.+?)					// $2 = Header text
   [ \t]*
   \#*						// optional closing #'s (not counted)
   \n+
   /gm, function() {...});
   */

  text = text.replace(/^(#{1,6})[ \t]*(.+?)[ \t]*#*\n+/gm, function (wholeMatch, m1, m2) {
    var span = showdown.subParser('spanGamut')(m2, options, globals),
        hID = (options.noHeaderId) ? '' : ' id="' + headerId(m2) + '"',
        hLevel = parseInt(options.headerLevelStart) - 1 + m1.length,
        header = '<h' + hLevel + hID + '>' + span + '</h' + hLevel + '>';

    return showdown.subParser('hashBlock')(header, options, globals);
  });

  function headerId(m) {
    var title, escapedId = m.replace(/[^\w]/g, '').toLowerCase();

    if (globals.hashLinkCounts[escapedId]) {
      title = escapedId + '-' + (globals.hashLinkCounts[escapedId]++);
    } else {
      title = escapedId;
      globals.hashLinkCounts[escapedId] = 1;
    }

    // Prefix id to prevent causing inadvertent pre-existing style matches.
    if (prefixHeader === true) {
      prefixHeader = 'section';
    }

    if (showdown.helper.isString(prefixHeader)) {
      return prefixHeader + title;
    }
    return title;
  }

  return text;
});

/**
 * Turn Markdown image shortcuts into <img> tags.
 */
showdown.subParser('images', function (text, options, globals) {
  'use strict';

  var inlineRegExp    = /!\[(.*?)]\s?\([ \t]*()<?(\S+?)>?(?: =([*\d]+[A-Za-z%]{0,4})x([*\d]+[A-Za-z%]{0,4}))?[ \t]*(?:(['"])(.*?)\6[ \t]*)?\)/g,
      referenceRegExp = /!\[(.*?)][ ]?(?:\n[ ]*)?\[(.*?)]()()()()()/g;

  function writeImageTag (wholeMatch, altText, linkId, url, width, height, m5, title) {

    var gUrls   = globals.gUrls,
        gTitles = globals.gTitles,
        gDims   = globals.gDimensions;

    linkId = linkId.toLowerCase();

    if (!title) {
      title = '';
    }

    if (url === '' || url === null) {
      if (linkId === '' || linkId === null) {
        // lower-case and turn embedded newlines into spaces
        linkId = altText.toLowerCase().replace(/ ?\n/g, ' ');
      }
      url = '#' + linkId;

      if (!showdown.helper.isUndefined(gUrls[linkId])) {
        url = gUrls[linkId];
        if (!showdown.helper.isUndefined(gTitles[linkId])) {
          title = gTitles[linkId];
        }
        if (!showdown.helper.isUndefined(gDims[linkId])) {
          width = gDims[linkId].width;
          height = gDims[linkId].height;
        }
      } else {
        return wholeMatch;
      }
    }

    altText = altText.replace(/"/g, '&quot;');
    url = showdown.helper.escapeCharacters(url, '*_', false);
    var result = '<img src="' + url + '" alt="' + altText + '"';

    if (title) {
      title = title.replace(/"/g, '&quot;');
      title = showdown.helper.escapeCharacters(title, '*_', false);
      result += ' title="' + title + '"';
    }

    if (width && height) {
      width  = (width === '*') ? 'auto' : width;
      height = (height === '*') ? 'auto' : height;

      result += ' width="' + width + '"';
      result += ' height="' + height + '"';
    }

    result += ' />';

    return result;
  }

  // First, handle reference-style labeled images: ![alt text][id]
  text = text.replace(referenceRegExp, writeImageTag);

  // Next, handle inline images:  ![alt text](url =<width>x<height> "optional title")
  text = text.replace(inlineRegExp, writeImageTag);

  return text;
});

showdown.subParser('italicsAndBold', function (text) {
  'use strict';
  // <strong> must go first:
  text = text.replace(/(\*\*|__)(?=\S)([^\r]*?\S[*_]*)\1/g, '<strong>$2</strong>');

  text = text.replace(/(\*|_)(?=\S)([^\r]*?\S)\1/g, '<em>$2</em>');

  return text;
});

/**
 * Form HTML ordered (numbered) and unordered (bulleted) lists.
 */
showdown.subParser('lists', function (text, options, globals) {
  'use strict';

  var spl = '~1';

  /**
   * Process the contents of a single ordered or unordered list, splitting it
   * into individual list items.
   * @param {string} listStr
   * @returns {string}
   */
  function processListItems (listStr) {
    // The $g_list_level global keeps track of when we're inside a list.
    // Each time we enter a list, we increment it; when we leave a list,
    // we decrement. If it's zero, we're not in a list anymore.
    //
    // We do this because when we're not inside a list, we want to treat
    // something like this:
    //
    //    I recommend upgrading to version
    //    8. Oops, now this line is treated
    //    as a sub-list.
    //
    // As a single paragraph, despite the fact that the second line starts
    // with a digit-period-space sequence.
    //
    // Whereas when we're inside a list (or sub-list), that line will be
    // treated as the start of a sub-list. What a kludge, huh? This is
    // an aspect of Markdown's syntax that's hard to parse perfectly
    // without resorting to mind-reading. Perhaps the solution is to
    // change the syntax rules such that sub-lists must start with a
    // starting cardinal number; e.g. "1." or "a.".

    globals.gListLevel++;

    // trim trailing blank lines:
    listStr = listStr.replace(/\n{2,}$/, '\n');

    // attacklab: add sentinel to emulate \z
    listStr += '~0';

    /*
     list_str = list_str.replace(/
     (\n)?							// leading line = $1
     (^[ \t]*)						// leading whitespace = $2
     ([*+-]|\d+[.]) [ \t]+			// list marker = $3
     ([^\r]+?						// list item text   = $4
     (\n{1,2}))
     (?= \n* (~0 | \2 ([*+-]|\d+[.]) [ \t]+))
     /gm, function(){...});
     */
    var rgx = /(\n)?(^[ \t]*)([*+-]|\d+[.])[ \t]+([^\r]+?(\n{1,2}))(?=\n*(~0|\2([*+-]|\d+[.])[ \t]+))/gm;

    listStr = listStr.replace(rgx, function (wholeMatch, m1, m2, m3, m4) {
      var item = showdown.subParser('outdent')(m4, options, globals);
      //m1 - LeadingLine

      if (m1 || (item.search(/\n{2,}/) > -1)) {
        item = showdown.subParser('blockGamut')(item, options, globals);
      } else {
        // Recursion for sub-lists:
        item = showdown.subParser('lists')(item, options, globals);
        item = item.replace(/\n$/, ''); // chomp(item)
        item = showdown.subParser('spanGamut')(item, options, globals);
      }

      // this is a "hack" to differentiate between ordered and unordered lists
      // related to issue #142
      var tp = (m3.search(/[*+-]/g) > -1) ? 'ul' : 'ol';
      return spl + tp + '<li>' + item + '</li>\n';
    });

    // attacklab: strip sentinel
    listStr = listStr.replace(/~0/g, '');

    globals.gListLevel--;
    return listStr;
  }

  /**
   * Slit consecutive ol/ul lists (related to issue 142)
   * @param {Array} results
   * @param {string} listType
   * @returns {string|*}
   */
  function splitConsecutiveLists (results, listType) {
    var cthulhu = /(<p[^>]+?>|<p>|<\/p>)/img,
        holder = [[]],
        res = '',
        y = 0;

    // Initialize first sublist
    holder[0].type = listType;

    for (var i = 0; i < results.length; ++i) {
      var txt = results[i].slice(2),
          nListType = results[i].slice(0, 2);

      if (listType !== nListType) {
        y++;
        holder[y] = [];
        holder[y].type = nListType;
        listType = nListType;
      }
      holder[y].push(txt);
    }
    for (i = 0; i < holder.length; ++i) {
      res += '<' + holder[i].type + '>\n';
      for (var ii = 0; ii < holder[i].length; ++ii) {
        if (holder[i].length > 1 && ii === holder[i].length - 1 && !cthulhu.test(holder[i][ii - 1])) {
          //holder[i][ii] = holder[i][ii].replace(cthulhu, '');
        }
        res += holder[i][ii];
      }
      res += '</' + holder[i].type + '>\n';
    }
    return res;
  }

  // attacklab: add sentinel to hack around khtml/safari bug:
  // http://bugs.webkit.org/show_bug.cgi?id=11231
  text += '~0';

  // Re-usable pattern to match any entire ul or ol list:

  /*
   var whole_list = /
   (									// $1 = whole list
   (								// $2
   [ ]{0,3}					// attacklab: g_tab_width - 1
   ([*+-]|\d+[.])				// $3 = first list item marker
   [ \t]+
   )
   [^\r]+?
   (								// $4
   ~0							// sentinel for workaround; should be $
   |
   \n{2,}
   (?=\S)
   (?!							// Negative lookahead for another list item marker
   [ \t]*
   (?:[*+-]|\d+[.])[ \t]+
   )
   )
   )/g
   */
  var wholeList = /^(([ ]{0,3}([*+-]|\d+[.])[ \t]+)[^\r]+?(~0|\n{2,}(?=\S)(?![ \t]*(?:[*+-]|\d+[.])[ \t]+)))/gm;

  if (globals.gListLevel) {
    text = text.replace(wholeList, function (wholeMatch, m1, m2) {
      var listType = (m2.search(/[*+-]/g) > -1) ? 'ul' : 'ol',
          result = processListItems(m1);

      // Turn double returns into triple returns, so that we can make a
      // paragraph for the last item in a list, if necessary:
      //list = list.replace(/\n{2,}/g, '\n\n\n');
      //result = processListItems(list);

      // Trim any trailing whitespace, to put the closing `</$list_type>`
      // up on the preceding line, to get it past the current stupid
      // HTML block parser. This is a hack to work around the terrible
      // hack that is the HTML block parser.
      result = result.replace(/\s+$/, '');
      var splRes = result.split(spl);
      splRes.shift();
      result = splitConsecutiveLists(splRes, listType);
      return result;
    });
  } else {
    wholeList = /(\n\n|^\n?)(([ ]{0,3}([*+-]|\d+[.])[ \t]+)[^\r]+?(~0|\n{2,}(?=\S)(?![ \t]*(?:[*+-]|\d+[.])[ \t]+)))/g;
    //wholeList = /(\n\n|^\n?)( {0,3}([*+-]|\d+\.)[ \t]+[\s\S]+?)(?=(~0)|(\n\n(?!\t| {2,}| {0,3}([*+-]|\d+\.)[ \t])))/g;

    text = text.replace(wholeList, function (wholeMatch, m1, m2, m3) {

      // Turn double returns into triple returns, so that we can make a
      // paragraph for the last item in a list, if necessary:
      var list = m2.replace(/\n{2,}/g, '\n\n\n'),
      //var list = (m2.slice(-2) !== '~0') ? m2 + '\n' : m2, //add a newline after the list
          listType = (m3.search(/[*+-]/g) > -1) ? 'ul' : 'ol',
          result = processListItems(list),
          splRes = result.split(spl);

      splRes.shift();
      return m1 + splitConsecutiveLists(splRes, listType) + '\n';
    });
  }

  // attacklab: strip sentinel
  text = text.replace(/~0/, '');

  return text;
});

/**
 * Remove one level of line-leading tabs or spaces
 */
showdown.subParser('outdent', function (text) {
  'use strict';

  // attacklab: hack around Konqueror 3.5.4 bug:
  // "----------bug".replace(/^-/g,"") == "bug"
  text = text.replace(/^(\t|[ ]{1,4})/gm, '~0'); // attacklab: g_tab_width

  // attacklab: clean up hack
  text = text.replace(/~0/g, '');

  return text;
});

/**
 *
 */
showdown.subParser('paragraphs', function (text, options, globals) {
  'use strict';

  // Strip leading and trailing lines:
  text = text.replace(/^\n+/g, '');
  text = text.replace(/\n+$/g, '');

  var grafs = text.split(/\n{2,}/g),
      grafsOut = [],
      end = grafs.length; // Wrap <p> tags

  for (var i = 0; i < end; i++) {
    var str = grafs[i];

    // if this is an HTML marker, copy it
    if (str.search(/~K(\d+)K/g) >= 0) {
      grafsOut.push(str);
    } else if (str.search(/\S/) >= 0) {
      str = showdown.subParser('spanGamut')(str, options, globals);
      str = str.replace(/^([ \t]*)/g, '<p>');
      str += '</p>';
      grafsOut.push(str);
    }
  }

  /** Unhashify HTML blocks */
  end = grafsOut.length;
  for (i = 0; i < end; i++) {
    // if this is a marker for an html block...
    while (grafsOut[i].search(/~K(\d+)K/) >= 0) {
      var blockText = globals.gHtmlBlocks[RegExp.$1];
      blockText = blockText.replace(/\$/g, '$$$$'); // Escape any dollar signs
      grafsOut[i] = grafsOut[i].replace(/~K\d+K/, blockText);
    }
  }

  return grafsOut.join('\n\n');
});

/**
 * Run extension
 */
showdown.subParser('runExtension', function (ext, text, options, globals) {
  'use strict';

  if (ext.filter) {
    text = ext.filter(text, globals.converter, options);

  } else if (ext.regex) {
    // TODO remove this when old extension loading mechanism is deprecated
    var re = ext.regex;
    if (!re instanceof RegExp) {
      re = new RegExp(re, 'g');
    }
    text = text.replace(re, ext.replace);
  }

  return text;
});

/**
 * These are all the transformations that occur *within* block-level
 * tags like paragraphs, headers, and list items.
 */
showdown.subParser('spanGamut', function (text, options, globals) {
  'use strict';

  text = showdown.subParser('codeSpans')(text, options, globals);
  text = showdown.subParser('escapeSpecialCharsWithinTagAttributes')(text, options, globals);
  text = showdown.subParser('encodeBackslashEscapes')(text, options, globals);

  // Process anchor and image tags. Images must come first,
  // because ![foo][f] looks like an anchor.
  text = showdown.subParser('images')(text, options, globals);
  text = showdown.subParser('anchors')(text, options, globals);

  // Make links out of things like `<http://example.com/>`
  // Must come after _DoAnchors(), because you can use < and >
  // delimiters in inline links like [this](<url>).
  text = showdown.subParser('autoLinks')(text, options, globals);
  text = showdown.subParser('encodeAmpsAndAngles')(text, options, globals);
  text = showdown.subParser('italicsAndBold')(text, options, globals);

  // Do hard breaks:
  text = text.replace(/  +\n/g, ' <br />\n');

  return text;

});

/**
 * Strip any lines consisting only of spaces and tabs.
 * This makes subsequent regexs easier to write, because we can
 * match consecutive blank lines with /\n+/ instead of something
 * contorted like /[ \t]*\n+/
 */
showdown.subParser('stripBlankLines', function (text) {
  'use strict';
  return text.replace(/^[ \t]+$/mg, '');
});

/**
 * Strips link definitions from text, stores the URLs and titles in
 * hash references.
 * Link defs are in the form: ^[id]: url "optional title"
 *
 * ^[ ]{0,3}\[(.+)\]: // id = $1  attacklab: g_tab_width - 1
 * [ \t]*
 * \n?                  // maybe *one* newline
 * [ \t]*
 * <?(\S+?)>?          // url = $2
 * [ \t]*
 * \n?                // maybe one newline
 * [ \t]*
 * (?:
 * (\n*)              // any lines skipped = $3 attacklab: lookbehind removed
 * ["(]
 * (.+?)              // title = $4
 * [")]
 * [ \t]*
 * )?                 // title is optional
 * (?:\n+|$)
 * /gm,
 * function(){...});
 *
 */
showdown.subParser('stripLinkDefinitions', function (text, options, globals) {
  'use strict';

  var regex = /^ {0,3}\[(.+)]:[ \t]*\n?[ \t]*<?(\S+?)>?(?: =([*\d]+[A-Za-z%]{0,4})x([*\d]+[A-Za-z%]{0,4}))?[ \t]*\n?[ \t]*(?:(\n*)["|'(](.+?)["|')][ \t]*)?(?:\n+|(?=~0))/gm;

  // attacklab: sentinel workarounds for lack of \A and \Z, safari\khtml bug
  text += '~0';

  text = text.replace(regex, function (wholeMatch, linkId, url, width, height, blankLines, title) {
    linkId = linkId.toLowerCase();
    globals.gUrls[linkId] = showdown.subParser('encodeAmpsAndAngles')(url);  // Link IDs are case-insensitive

    if (blankLines) {
      // Oops, found blank lines, so it's not a title.
      // Put back the parenthetical statement we stole.
      return blankLines + title;

    } else {
      if (title) {
        globals.gTitles[linkId] = title.replace(/"|'/g, '&quot;');
      }
      if (options.parseImgDimensions && width && height) {
        globals.gDimensions[linkId] = {
          width:  width,
          height: height
        };
      }
    }
    // Completely remove the definition from the text
    return '';
  });

  // attacklab: strip sentinel
  text = text.replace(/~0/, '');

  return text;
});

/**
 * Swap back in all the special characters we've hidden.
 */
showdown.subParser('unescapeSpecialChars', function (text) {
  'use strict';

  text = text.replace(/~E(\d+)E/g, function (wholeMatch, m1) {
    var charCodeToReplace = parseInt(m1);
    return String.fromCharCode(charCodeToReplace);
  });
  return text;
});

var root = this;

// CommonJS/nodeJS Loader
if (typeof module !== 'undefined' && module.exports) {
  module.exports = showdown;

// AMD Loader
} else if (typeof define === 'function' && define.amd) {
  define('showdown', function () {
    'use strict';
    return showdown;
  });

// Regular Browser loader
} else {
  root.showdown = showdown;
}
}).call(this);
//# sourceMappingURL=showdown.js.map
},{}]},{},["/Users/gaowhen/Lab/flaskr/app/static/src/js/lib/showdown.js"])
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzdGF0aWMvc3JjL2pzL2xpYi9zaG93ZG93bi5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCI7LyohIHNob3dkb3duIDE4LTA2LTIwMTUgKi9cbihmdW5jdGlvbigpe1xuLyoqXG4gKiBDcmVhdGVkIGJ5IFRpdmllIG9uIDA2LTAxLTIwMTUuXG4gKi9cblxuLy8gUHJpdmF0ZSBwcm9wZXJ0aWVzXG52YXIgc2hvd2Rvd24gPSB7fSxcbiAgICBwYXJzZXJzID0ge30sXG4gICAgZXh0ZW5zaW9ucyA9IHt9LFxuICAgIGRlZmF1bHRPcHRpb25zID0ge1xuICAgICAgb21pdEV4dHJhV0xJbkNvZGVCbG9ja3M6IGZhbHNlLFxuICAgICAgcHJlZml4SGVhZGVySWQ6ICAgICAgICAgIGZhbHNlLFxuICAgICAgbm9IZWFkZXJJZDogICAgICAgICAgICAgIGZhbHNlLFxuICAgICAgaGVhZGVyTGV2ZWxTdGFydDogICAgICAgIDEsXG4gICAgICBwYXJzZUltZ0RpbWVuc2lvbnM6ICAgICAgZmFsc2VcbiAgICB9LFxuICAgIGdsb2JhbE9wdGlvbnMgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KGRlZmF1bHRPcHRpb25zKSk7IC8vY2xvbmUgZGVmYXVsdCBvcHRpb25zIG91dCBvZiBsYXppbmVzcyA9UFxuXG4vKipcbiAqIGhlbHBlciBuYW1lc3BhY2VcbiAqIEB0eXBlIHt7fX1cbiAqL1xuc2hvd2Rvd24uaGVscGVyID0ge307XG5cbi8qKlxuICogVE9ETyBMRUdBQ1kgU1VQUE9SVCBDT0RFXG4gKiBAdHlwZSB7e319XG4gKi9cbnNob3dkb3duLmV4dGVuc2lvbnMgPSB7fTtcblxuLyoqXG4gKiBTZXQgYSBnbG9iYWwgb3B0aW9uXG4gKiBAc3RhdGljXG4gKiBAcGFyYW0ge3N0cmluZ30ga2V5XG4gKiBAcGFyYW0geyp9IHZhbHVlXG4gKiBAcmV0dXJucyB7c2hvd2Rvd259XG4gKi9cbnNob3dkb3duLnNldE9wdGlvbiA9IGZ1bmN0aW9uIChrZXksIHZhbHVlKSB7XG4gICd1c2Ugc3RyaWN0JztcbiAgZ2xvYmFsT3B0aW9uc1trZXldID0gdmFsdWU7XG4gIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBHZXQgYSBnbG9iYWwgb3B0aW9uXG4gKiBAc3RhdGljXG4gKiBAcGFyYW0ge3N0cmluZ30ga2V5XG4gKiBAcmV0dXJucyB7Kn1cbiAqL1xuc2hvd2Rvd24uZ2V0T3B0aW9uID0gZnVuY3Rpb24gKGtleSkge1xuICAndXNlIHN0cmljdCc7XG4gIHJldHVybiBnbG9iYWxPcHRpb25zW2tleV07XG59O1xuXG4vKipcbiAqIEdldCB0aGUgZ2xvYmFsIG9wdGlvbnNcbiAqIEBzdGF0aWNcbiAqIEByZXR1cm5zIHt7fX1cbiAqL1xuc2hvd2Rvd24uZ2V0T3B0aW9ucyA9IGZ1bmN0aW9uICgpIHtcbiAgJ3VzZSBzdHJpY3QnO1xuICByZXR1cm4gZ2xvYmFsT3B0aW9ucztcbn07XG5cbi8qKlxuICogUmVzZXQgZ2xvYmFsIG9wdGlvbnMgdG8gdGhlIGRlZmF1bHQgdmFsdWVzXG4gKiBAc3RhdGljXG4gKi9cbnNob3dkb3duLnJlc2V0T3B0aW9ucyA9IGZ1bmN0aW9uICgpIHtcbiAgJ3VzZSBzdHJpY3QnO1xuICBnbG9iYWxPcHRpb25zID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShkZWZhdWx0T3B0aW9ucykpO1xufTtcblxuLyoqXG4gKiBHZXQgdGhlIGRlZmF1bHQgb3B0aW9uc1xuICogQHN0YXRpY1xuICogQHJldHVybnMge3t9fVxuICovXG5zaG93ZG93bi5nZXREZWZhdWx0T3B0aW9ucyA9IGZ1bmN0aW9uICgpIHtcbiAgJ3VzZSBzdHJpY3QnO1xuICByZXR1cm4gZGVmYXVsdE9wdGlvbnM7XG59O1xuXG4vKipcbiAqIEdldCBvciBzZXQgYSBzdWJQYXJzZXJcbiAqXG4gKiBzdWJQYXJzZXIobmFtZSkgICAgICAgLSBHZXQgYSByZWdpc3RlcmVkIHN1YlBhcnNlclxuICogc3ViUGFyc2VyKG5hbWUsIGZ1bmMpIC0gUmVnaXN0ZXIgYSBzdWJQYXJzZXJcbiAqIEBzdGF0aWNcbiAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lXG4gKiBAcGFyYW0ge2Z1bmN0aW9ufSBbZnVuY11cbiAqIEByZXR1cm5zIHsqfVxuICovXG5zaG93ZG93bi5zdWJQYXJzZXIgPSBmdW5jdGlvbiAobmFtZSwgZnVuYykge1xuICAndXNlIHN0cmljdCc7XG4gIGlmIChzaG93ZG93bi5oZWxwZXIuaXNTdHJpbmcobmFtZSkpIHtcbiAgICBpZiAodHlwZW9mIGZ1bmMgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICBwYXJzZXJzW25hbWVdID0gZnVuYztcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKHBhcnNlcnMuaGFzT3duUHJvcGVydHkobmFtZSkpIHtcbiAgICAgICAgcmV0dXJuIHBhcnNlcnNbbmFtZV07XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBFcnJvcignU3ViUGFyc2VyIG5hbWVkICcgKyBuYW1lICsgJyBub3QgcmVnaXN0ZXJlZCEnKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn07XG5cbi8qKlxuICogR2V0cyBvciByZWdpc3RlcnMgYW4gZXh0ZW5zaW9uXG4gKiBAc3RhdGljXG4gKiBAcGFyYW0ge3N0cmluZ30gbmFtZVxuICogQHBhcmFtIHtvYmplY3R8ZnVuY3Rpb249fSBleHRcbiAqIEByZXR1cm5zIHsqfVxuICovXG5zaG93ZG93bi5leHRlbnNpb24gPSBmdW5jdGlvbiAobmFtZSwgZXh0KSB7XG4gICd1c2Ugc3RyaWN0JztcblxuICBpZiAoIXNob3dkb3duLmhlbHBlci5pc1N0cmluZyhuYW1lKSkge1xuICAgIHRocm93IEVycm9yKCdFeHRlbnNpb24gXFwnbmFtZVxcJyBtdXN0IGJlIGEgc3RyaW5nJyk7XG4gIH1cblxuICBuYW1lID0gc2hvd2Rvd24uaGVscGVyLnN0ZEV4dE5hbWUobmFtZSk7XG5cbiAgLy8gR2V0dGVyXG4gIGlmIChzaG93ZG93bi5oZWxwZXIuaXNVbmRlZmluZWQoZXh0KSkge1xuICAgIGlmICghZXh0ZW5zaW9ucy5oYXNPd25Qcm9wZXJ0eShuYW1lKSkge1xuICAgICAgdGhyb3cgRXJyb3IoJ0V4dGVuc2lvbiBuYW1lZCAnICsgbmFtZSArICcgaXMgbm90IHJlZ2lzdGVyZWQhJyk7XG4gICAgfVxuICAgIHJldHVybiBleHRlbnNpb25zW25hbWVdO1xuXG4gICAgLy8gU2V0dGVyXG4gIH0gZWxzZSB7XG4gICAgLy8gRXhwYW5kIGV4dGVuc2lvbiBpZiBpdCdzIHdyYXBwZWQgaW4gYSBmdW5jdGlvblxuICAgIGlmICh0eXBlb2YgZXh0ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICBleHQgPSBleHQoKTtcbiAgICB9XG5cbiAgICAvLyBFbnN1cmUgZXh0ZW5zaW9uIGlzIGFuIGFycmF5XG4gICAgaWYgKCFzaG93ZG93bi5oZWxwZXIuaXNBcnJheShleHQpKSB7XG4gICAgICBleHQgPSBbZXh0XTtcbiAgICB9XG5cbiAgICB2YXIgdmFsaWRFeHRlbnNpb24gPSB2YWxpZGF0ZShleHQsIG5hbWUpO1xuXG4gICAgaWYgKHZhbGlkRXh0ZW5zaW9uLnZhbGlkKSB7XG4gICAgICBleHRlbnNpb25zW25hbWVdID0gZXh0O1xuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBFcnJvcih2YWxpZEV4dGVuc2lvbi5lcnJvcik7XG4gICAgfVxuICB9XG59O1xuXG4vKipcbiAqIEdldHMgYWxsIGV4dGVuc2lvbnMgcmVnaXN0ZXJlZFxuICogQHJldHVybnMge3t9fVxuICovXG5zaG93ZG93bi5nZXRBbGxFeHRlbnNpb25zID0gZnVuY3Rpb24gKCkge1xuICAndXNlIHN0cmljdCc7XG4gIHJldHVybiBleHRlbnNpb25zO1xufTtcblxuLyoqXG4gKiBSZW1vdmUgYW4gZXh0ZW5zaW9uXG4gKiBAcGFyYW0ge3N0cmluZ30gbmFtZVxuICovXG5zaG93ZG93bi5yZW1vdmVFeHRlbnNpb24gPSBmdW5jdGlvbiAobmFtZSkge1xuICAndXNlIHN0cmljdCc7XG4gIGRlbGV0ZSBleHRlbnNpb25zW25hbWVdO1xufTtcblxuLyoqXG4gKiBSZW1vdmVzIGFsbCBleHRlbnNpb25zXG4gKi9cbnNob3dkb3duLnJlc2V0RXh0ZW5zaW9ucyA9IGZ1bmN0aW9uICgpIHtcbiAgJ3VzZSBzdHJpY3QnO1xuICBleHRlbnNpb25zID0ge307XG59O1xuXG4vKipcbiAqIFZhbGlkYXRlIGV4dGVuc2lvblxuICogQHBhcmFtIHthcnJheX0gZXh0ZW5zaW9uXG4gKiBAcGFyYW0ge3N0cmluZ30gbmFtZVxuICogQHJldHVybnMge3t2YWxpZDogYm9vbGVhbiwgZXJyb3I6IHN0cmluZ319XG4gKi9cbmZ1bmN0aW9uIHZhbGlkYXRlKGV4dGVuc2lvbiwgbmFtZSkge1xuICAndXNlIHN0cmljdCc7XG5cbiAgdmFyIGVyck1zZyA9IChuYW1lKSA/ICdFcnJvciBpbiAnICsgbmFtZSArICcgZXh0ZW5zaW9uLT4nIDogJ0Vycm9yIGluIHVubmFtZWQgZXh0ZW5zaW9uJyxcbiAgICByZXQgPSB7XG4gICAgICB2YWxpZDogdHJ1ZSxcbiAgICAgIGVycm9yOiAnJ1xuICAgIH07XG5cbiAgaWYgKCFzaG93ZG93bi5oZWxwZXIuaXNBcnJheShleHRlbnNpb24pKSB7XG4gICAgZXh0ZW5zaW9uID0gW2V4dGVuc2lvbl07XG4gIH1cblxuICBmb3IgKHZhciBpID0gMDsgaSA8IGV4dGVuc2lvbi5sZW5ndGg7ICsraSkge1xuICAgIHZhciBiYXNlTXNnID0gZXJyTXNnICsgJ3N1Yi1leHRlbnNpb24gJyArIGkgKyAnOiAnLFxuICAgICAgICBleHQgPSBleHRlbnNpb25baV07XG4gICAgaWYgKHR5cGVvZiBleHQgIT09ICdvYmplY3QnKSB7XG4gICAgICByZXQudmFsaWQgPSBmYWxzZTtcbiAgICAgIHJldC5lcnJvciA9IGJhc2VNc2cgKyAnbXVzdCBiZSBhbiBvYmplY3QsIGJ1dCAnICsgdHlwZW9mIGV4dCArICcgZ2l2ZW4nO1xuICAgICAgcmV0dXJuIHJldDtcbiAgICB9XG5cbiAgICBpZiAoIXNob3dkb3duLmhlbHBlci5pc1N0cmluZyhleHQudHlwZSkpIHtcbiAgICAgIHJldC52YWxpZCA9IGZhbHNlO1xuICAgICAgcmV0LmVycm9yID0gYmFzZU1zZyArICdwcm9wZXJ0eSBcInR5cGVcIiBtdXN0IGJlIGEgc3RyaW5nLCBidXQgJyArIHR5cGVvZiBleHQudHlwZSArICcgZ2l2ZW4nO1xuICAgICAgcmV0dXJuIHJldDtcbiAgICB9XG5cbiAgICB2YXIgdHlwZSA9IGV4dC50eXBlID0gZXh0LnR5cGUudG9Mb3dlckNhc2UoKTtcblxuICAgIC8vIG5vcm1hbGl6ZSBleHRlbnNpb24gdHlwZVxuICAgIGlmICh0eXBlID09PSAnbGFuZ3VhZ2UnKSB7XG4gICAgICB0eXBlID0gZXh0LnR5cGUgPSAnbGFuZyc7XG4gICAgfVxuXG4gICAgaWYgKHR5cGUgPT09ICdodG1sJykge1xuICAgICAgdHlwZSA9IGV4dC50eXBlID0gJ291dHB1dCc7XG4gICAgfVxuXG4gICAgaWYgKHR5cGUgIT09ICdsYW5nJyAmJiB0eXBlICE9PSAnb3V0cHV0Jykge1xuICAgICAgcmV0LnZhbGlkID0gZmFsc2U7XG4gICAgICByZXQuZXJyb3IgPSBiYXNlTXNnICsgJ3R5cGUgJyArIHR5cGUgKyAnIGlzIG5vdCByZWNvZ25pemVkLiBWYWxpZCB2YWx1ZXM6IFwibGFuZ1wiIG9yIFwib3V0cHV0XCInO1xuICAgICAgcmV0dXJuIHJldDtcbiAgICB9XG5cbiAgICBpZiAoZXh0LmZpbHRlcikge1xuICAgICAgaWYgKHR5cGVvZiBleHQuZmlsdGVyICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIHJldC52YWxpZCA9IGZhbHNlO1xuICAgICAgICByZXQuZXJyb3IgPSBiYXNlTXNnICsgJ1wiZmlsdGVyXCIgbXVzdCBiZSBhIGZ1bmN0aW9uLCBidXQgJyArIHR5cGVvZiBleHQuZmlsdGVyICsgJyBnaXZlbic7XG4gICAgICAgIHJldHVybiByZXQ7XG4gICAgICB9XG5cbiAgICB9IGVsc2UgaWYgKGV4dC5yZWdleCkge1xuICAgICAgaWYgKHNob3dkb3duLmhlbHBlci5pc1N0cmluZyhleHQucmVnZXgpKSB7XG4gICAgICAgIGV4dC5yZWdleCA9IG5ldyBSZWdFeHAoZXh0LnJlZ2V4LCAnZycpO1xuICAgICAgfVxuICAgICAgaWYgKCFleHQucmVnZXggaW5zdGFuY2VvZiBSZWdFeHApIHtcbiAgICAgICAgcmV0LnZhbGlkID0gZmFsc2U7XG4gICAgICAgIHJldC5lcnJvciA9IGJhc2VNc2cgKyAnXCJyZWdleFwiIHByb3BlcnR5IG11c3QgZWl0aGVyIGJlIGEgc3RyaW5nIG9yIGEgUmVnRXhwIG9iamVjdCwgYnV0ICcgK1xuICAgICAgICAgIHR5cGVvZiBleHQucmVnZXggKyAnIGdpdmVuJztcbiAgICAgICAgcmV0dXJuIHJldDtcbiAgICAgIH1cbiAgICAgIGlmIChzaG93ZG93bi5oZWxwZXIuaXNVbmRlZmluZWQoZXh0LnJlcGxhY2UpKSB7XG4gICAgICAgIHJldC52YWxpZCA9IGZhbHNlO1xuICAgICAgICByZXQuZXJyb3IgPSBiYXNlTXNnICsgJ1wicmVnZXhcIiBleHRlbnNpb25zIG11c3QgaW1wbGVtZW50IGEgcmVwbGFjZSBzdHJpbmcgb3IgZnVuY3Rpb24nO1xuICAgICAgICByZXR1cm4gcmV0O1xuICAgICAgfVxuXG4gICAgfSBlbHNlIHtcbiAgICAgIHJldC52YWxpZCA9IGZhbHNlO1xuICAgICAgcmV0LmVycm9yID0gYmFzZU1zZyArICdleHRlbnNpb25zIG11c3QgZGVmaW5lIGVpdGhlciBhIFwicmVnZXhcIiBwcm9wZXJ0eSBvciBhIFwiZmlsdGVyXCIgbWV0aG9kJztcbiAgICAgIHJldHVybiByZXQ7XG4gICAgfVxuXG4gICAgaWYgKHNob3dkb3duLmhlbHBlci5pc1VuZGVmaW5lZChleHQuZmlsdGVyKSAmJiBzaG93ZG93bi5oZWxwZXIuaXNVbmRlZmluZWQoZXh0LnJlZ2V4KSkge1xuICAgICAgcmV0LnZhbGlkID0gZmFsc2U7XG4gICAgICByZXQuZXJyb3IgPSBiYXNlTXNnICsgJ291dHB1dCBleHRlbnNpb25zIG11c3QgZGVmaW5lIGEgZmlsdGVyIHByb3BlcnR5JztcbiAgICAgIHJldHVybiByZXQ7XG4gICAgfVxuICB9XG4gIHJldHVybiByZXQ7XG59XG5cbi8qKlxuICogVmFsaWRhdGUgZXh0ZW5zaW9uXG4gKiBAcGFyYW0ge29iamVjdH0gZXh0XG4gKiBAcmV0dXJucyB7Ym9vbGVhbn1cbiAqL1xuc2hvd2Rvd24udmFsaWRhdGVFeHRlbnNpb24gPSBmdW5jdGlvbiAoZXh0KSB7XG4gICd1c2Ugc3RyaWN0JztcblxuICB2YXIgdmFsaWRhdGVFeHRlbnNpb24gPSB2YWxpZGF0ZShleHQsIG51bGwpO1xuICBpZiAoIXZhbGlkYXRlRXh0ZW5zaW9uLnZhbGlkKSB7XG4gICAgY29uc29sZS53YXJuKHZhbGlkYXRlRXh0ZW5zaW9uLmVycm9yKTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgcmV0dXJuIHRydWU7XG59O1xuXG4vKipcbiAqIHNob3dkb3duanMgaGVscGVyIGZ1bmN0aW9uc1xuICovXG5cbmlmICghc2hvd2Rvd24uaGFzT3duUHJvcGVydHkoJ2hlbHBlcicpKSB7XG4gIHNob3dkb3duLmhlbHBlciA9IHt9O1xufVxuXG4vKipcbiAqIENoZWNrIGlmIHZhciBpcyBzdHJpbmdcbiAqIEBzdGF0aWNcbiAqIEBwYXJhbSB7c3RyaW5nfSBhXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn1cbiAqL1xuc2hvd2Rvd24uaGVscGVyLmlzU3RyaW5nID0gZnVuY3Rpb24gaXNTdHJpbmcoYSkge1xuICAndXNlIHN0cmljdCc7XG4gIHJldHVybiAodHlwZW9mIGEgPT09ICdzdHJpbmcnIHx8IGEgaW5zdGFuY2VvZiBTdHJpbmcpO1xufTtcblxuLyoqXG4gKiBGb3JFYWNoIGhlbHBlciBmdW5jdGlvblxuICogQHN0YXRpY1xuICogQHBhcmFtIHsqfSBvYmpcbiAqIEBwYXJhbSB7ZnVuY3Rpb259IGNhbGxiYWNrXG4gKi9cbnNob3dkb3duLmhlbHBlci5mb3JFYWNoID0gZnVuY3Rpb24gZm9yRWFjaChvYmosIGNhbGxiYWNrKSB7XG4gICd1c2Ugc3RyaWN0JztcbiAgaWYgKHR5cGVvZiBvYmouZm9yRWFjaCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIG9iai5mb3JFYWNoKGNhbGxiYWNrKTtcbiAgfSBlbHNlIHtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IG9iai5sZW5ndGg7IGkrKykge1xuICAgICAgY2FsbGJhY2sob2JqW2ldLCBpLCBvYmopO1xuICAgIH1cbiAgfVxufTtcblxuLyoqXG4gKiBpc0FycmF5IGhlbHBlciBmdW5jdGlvblxuICogQHN0YXRpY1xuICogQHBhcmFtIHsqfSBhXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn1cbiAqL1xuc2hvd2Rvd24uaGVscGVyLmlzQXJyYXkgPSBmdW5jdGlvbiBpc0FycmF5KGEpIHtcbiAgJ3VzZSBzdHJpY3QnO1xuICByZXR1cm4gYS5jb25zdHJ1Y3RvciA9PT0gQXJyYXk7XG59O1xuXG4vKipcbiAqIENoZWNrIGlmIHZhbHVlIGlzIHVuZGVmaW5lZFxuICogQHN0YXRpY1xuICogQHBhcmFtIHsqfSB2YWx1ZSBUaGUgdmFsdWUgdG8gY2hlY2suXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gUmV0dXJucyBgdHJ1ZWAgaWYgYHZhbHVlYCBpcyBgdW5kZWZpbmVkYCwgZWxzZSBgZmFsc2VgLlxuICovXG5zaG93ZG93bi5oZWxwZXIuaXNVbmRlZmluZWQgPSBmdW5jdGlvbiBpc1VuZGVmaW5lZCh2YWx1ZSkge1xuICAndXNlIHN0cmljdCc7XG4gIHJldHVybiB0eXBlb2YgdmFsdWUgPT09ICd1bmRlZmluZWQnO1xufTtcblxuLyoqXG4gKiBTdGFuZGFyZGlkaXplIGV4dGVuc2lvbiBuYW1lXG4gKiBAc3RhdGljXG4gKiBAcGFyYW0ge3N0cmluZ30gcyBleHRlbnNpb24gbmFtZVxuICogQHJldHVybnMge3N0cmluZ31cbiAqL1xuc2hvd2Rvd24uaGVscGVyLnN0ZEV4dE5hbWUgPSBmdW5jdGlvbiAocykge1xuICAndXNlIHN0cmljdCc7XG4gIHJldHVybiBzLnJlcGxhY2UoL1tfLV18fFxccy9nLCAnJykudG9Mb3dlckNhc2UoKTtcbn07XG5cbmZ1bmN0aW9uIGVzY2FwZUNoYXJhY3RlcnNDYWxsYmFjayh3aG9sZU1hdGNoLCBtMSkge1xuICAndXNlIHN0cmljdCc7XG4gIHZhciBjaGFyQ29kZVRvRXNjYXBlID0gbTEuY2hhckNvZGVBdCgwKTtcbiAgcmV0dXJuICd+RScgKyBjaGFyQ29kZVRvRXNjYXBlICsgJ0UnO1xufVxuXG4vKipcbiAqIENhbGxiYWNrIHVzZWQgdG8gZXNjYXBlIGNoYXJhY3RlcnMgd2hlbiBwYXNzaW5nIHRocm91Z2ggU3RyaW5nLnJlcGxhY2VcbiAqIEBzdGF0aWNcbiAqIEBwYXJhbSB7c3RyaW5nfSB3aG9sZU1hdGNoXG4gKiBAcGFyYW0ge3N0cmluZ30gbTFcbiAqIEByZXR1cm5zIHtzdHJpbmd9XG4gKi9cbnNob3dkb3duLmhlbHBlci5lc2NhcGVDaGFyYWN0ZXJzQ2FsbGJhY2sgPSBlc2NhcGVDaGFyYWN0ZXJzQ2FsbGJhY2s7XG5cbi8qKlxuICogRXNjYXBlIGNoYXJhY3RlcnMgaW4gYSBzdHJpbmdcbiAqIEBzdGF0aWNcbiAqIEBwYXJhbSB7c3RyaW5nfSB0ZXh0XG4gKiBAcGFyYW0ge3N0cmluZ30gY2hhcnNUb0VzY2FwZVxuICogQHBhcmFtIHtib29sZWFufSBhZnRlckJhY2tzbGFzaFxuICogQHJldHVybnMge1hNTHxzdHJpbmd8dm9pZHwqfVxuICovXG5zaG93ZG93bi5oZWxwZXIuZXNjYXBlQ2hhcmFjdGVycyA9IGZ1bmN0aW9uIGVzY2FwZUNoYXJhY3RlcnModGV4dCwgY2hhcnNUb0VzY2FwZSwgYWZ0ZXJCYWNrc2xhc2gpIHtcbiAgJ3VzZSBzdHJpY3QnO1xuICAvLyBGaXJzdCB3ZSBoYXZlIHRvIGVzY2FwZSB0aGUgZXNjYXBlIGNoYXJhY3RlcnMgc28gdGhhdFxuICAvLyB3ZSBjYW4gYnVpbGQgYSBjaGFyYWN0ZXIgY2xhc3Mgb3V0IG9mIHRoZW1cbiAgdmFyIHJlZ2V4U3RyaW5nID0gJyhbJyArIGNoYXJzVG9Fc2NhcGUucmVwbGFjZSgvKFtcXFtcXF1cXFxcXSkvZywgJ1xcXFwkMScpICsgJ10pJztcblxuICBpZiAoYWZ0ZXJCYWNrc2xhc2gpIHtcbiAgICByZWdleFN0cmluZyA9ICdcXFxcXFxcXCcgKyByZWdleFN0cmluZztcbiAgfVxuXG4gIHZhciByZWdleCA9IG5ldyBSZWdFeHAocmVnZXhTdHJpbmcsICdnJyk7XG4gIHRleHQgPSB0ZXh0LnJlcGxhY2UocmVnZXgsIGVzY2FwZUNoYXJhY3RlcnNDYWxsYmFjayk7XG5cbiAgcmV0dXJuIHRleHQ7XG59O1xuXG4vKipcbiAqIFBPTFlGSUxMU1xuICovXG5pZiAoc2hvd2Rvd24uaGVscGVyLmlzVW5kZWZpbmVkKGNvbnNvbGUpKSB7XG4gIGNvbnNvbGUgPSB7XG4gICAgd2FybjogZnVuY3Rpb24gKG1zZykge1xuICAgICAgJ3VzZSBzdHJpY3QnO1xuICAgICAgYWxlcnQobXNnKTtcbiAgICB9LFxuICAgIGxvZzogZnVuY3Rpb24gKG1zZykge1xuICAgICAgJ3VzZSBzdHJpY3QnO1xuICAgICAgYWxlcnQobXNnKTtcbiAgICB9XG4gIH07XG59XG5cbi8qKlxuICogQ3JlYXRlZCBieSBFc3RldmFvIG9uIDMxLTA1LTIwMTUuXG4gKi9cblxuLyoqXG4gKiBTaG93ZG93biBDb252ZXJ0ZXIgY2xhc3NcbiAqIEBjbGFzc1xuICogQHBhcmFtIHtvYmplY3R9IFtjb252ZXJ0ZXJPcHRpb25zXVxuICogQHJldHVybnMge1xuICogIHttYWtlSHRtbDogRnVuY3Rpb259LFxuICogIHtzZXRPcHRpb246IEZ1bmN0aW9ufSxcbiAqICB7Z2V0T3B0aW9uOiBGdW5jdGlvbn0sXG4gKiAge2dldE9wdGlvbnM6IEZ1bmN0aW9ufVxuICogfVxuICovXG5zaG93ZG93bi5Db252ZXJ0ZXIgPSBmdW5jdGlvbiAoY29udmVydGVyT3B0aW9ucykge1xuICAndXNlIHN0cmljdCc7XG5cbiAgdmFyXG4gICAgICAvKipcbiAgICAgICAqIE9wdGlvbnMgdXNlZCBieSB0aGlzIGNvbnZlcnRlclxuICAgICAgICogQHByaXZhdGVcbiAgICAgICAqIEB0eXBlIHt7fX1cbiAgICAgICAqL1xuICAgICAgb3B0aW9ucyA9IHtcbiAgICAgICAgb21pdEV4dHJhV0xJbkNvZGVCbG9ja3M6IGZhbHNlLFxuICAgICAgICBwcmVmaXhIZWFkZXJJZDogICAgICAgICAgZmFsc2UsXG4gICAgICAgIG5vSGVhZGVySWQ6ICAgICAgICAgICAgICBmYWxzZVxuICAgICAgfSxcblxuICAgICAgLyoqXG4gICAgICAgKiBMYW5ndWFnZSBleHRlbnNpb25zIHVzZWQgYnkgdGhpcyBjb252ZXJ0ZXJcbiAgICAgICAqIEBwcml2YXRlXG4gICAgICAgKiBAdHlwZSB7QXJyYXl9XG4gICAgICAgKi9cbiAgICAgIGxhbmdFeHRlbnNpb25zID0gW10sXG5cbiAgICAgIC8qKlxuICAgICAgICogT3V0cHV0IG1vZGlmaWVycyBleHRlbnNpb25zIHVzZWQgYnkgdGhpcyBjb252ZXJ0ZXJcbiAgICAgICAqIEBwcml2YXRlXG4gICAgICAgKiBAdHlwZSB7QXJyYXl9XG4gICAgICAgKi9cbiAgICAgIG91dHB1dE1vZGlmaWVycyA9IFtdLFxuXG4gICAgICAvKipcbiAgICAgICAqIFRoZSBwYXJzZXIgT3JkZXJcbiAgICAgICAqIEBwcml2YXRlXG4gICAgICAgKiBAdHlwZSB7c3RyaW5nW119XG4gICAgICAgKi9cbiAgICAgIHBhcnNlck9yZGVyID0gW1xuICAgICAgICAnZ2l0aHViQ29kZUJsb2NrcycsXG4gICAgICAgICdoYXNoSFRNTEJsb2NrcycsXG4gICAgICAgICdzdHJpcExpbmtEZWZpbml0aW9ucycsXG4gICAgICAgICdibG9ja0dhbXV0JyxcbiAgICAgICAgJ3VuZXNjYXBlU3BlY2lhbENoYXJzJ1xuICAgICAgXTtcblxuICBfY29uc3RydWN0b3IoKTtcblxuICAvKipcbiAgICogQ29udmVydGVyIGNvbnN0cnVjdG9yXG4gICAqIEBwcml2YXRlXG4gICAqL1xuICBmdW5jdGlvbiBfY29uc3RydWN0b3IoKSB7XG4gICAgY29udmVydGVyT3B0aW9ucyA9IGNvbnZlcnRlck9wdGlvbnMgfHwge307XG5cbiAgICBmb3IgKHZhciBnT3B0IGluIGdsb2JhbE9wdGlvbnMpIHtcbiAgICAgIGlmIChnbG9iYWxPcHRpb25zLmhhc093blByb3BlcnR5KGdPcHQpKSB7XG4gICAgICAgIG9wdGlvbnNbZ09wdF0gPSBnbG9iYWxPcHRpb25zW2dPcHRdO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIE1lcmdlIG9wdGlvbnNcbiAgICBpZiAodHlwZW9mIGNvbnZlcnRlck9wdGlvbnMgPT09ICdvYmplY3QnKSB7XG4gICAgICBmb3IgKHZhciBvcHQgaW4gY29udmVydGVyT3B0aW9ucykge1xuICAgICAgICBpZiAoY29udmVydGVyT3B0aW9ucy5oYXNPd25Qcm9wZXJ0eShvcHQpKSB7XG4gICAgICAgICAgb3B0aW9uc1tvcHRdID0gY29udmVydGVyT3B0aW9uc1tvcHRdO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IEVycm9yKCdDb252ZXJ0ZXIgZXhwZWN0cyB0aGUgcGFzc2VkIHBhcmFtZXRlciB0byBiZSBhbiBvYmplY3QsIGJ1dCAnICsgdHlwZW9mIGNvbnZlcnRlck9wdGlvbnMgK1xuICAgICAgJyB3YXMgcGFzc2VkIGluc3RlYWQuJyk7XG4gICAgfVxuXG4gICAgaWYgKG9wdGlvbnMuZXh0ZW5zaW9ucykge1xuICAgICAgc2hvd2Rvd24uaGVscGVyLmZvckVhY2gob3B0aW9ucy5leHRlbnNpb25zLCBfcGFyc2VFeHRlbnNpb24pO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQYXJzZSBleHRlbnNpb25cbiAgICogQHBhcmFtIHsqfSBleHRcbiAgICogQHByaXZhdGVcbiAgICovXG4gIGZ1bmN0aW9uIF9wYXJzZUV4dGVuc2lvbihleHQpIHtcblxuICAgIC8vIElmIGl0J3MgYSBzdHJpbmcsIHRoZSBleHRlbnNpb24gd2FzIHByZXZpb3VzbHkgbG9hZGVkXG4gICAgaWYgKHNob3dkb3duLmhlbHBlci5pc1N0cmluZyhleHQpKSB7XG4gICAgICBleHQgPSBzaG93ZG93bi5oZWxwZXIuc3RkRXh0TmFtZShleHQpO1xuXG4gICAgICAvLyBMRUdBQ1lfU1VQUE9SVCBDT0RFXG4gICAgICBpZiAoc2hvd2Rvd24uZXh0ZW5zaW9uc1tleHRdKSB7XG4gICAgICAgIGNvbnNvbGUud2FybignREVQUkVDQVRJT04gV0FSTklORzogJyArIGV4dCArICcgaXMgYW4gb2xkIGV4dGVuc2lvbiB0aGF0IHVzZXMgYSBkZXByZWNhdGVkIGxvYWRpbmcgbWV0aG9kLicgK1xuICAgICAgICAgICdQbGVhc2UgaW5mb3JtIHRoZSBkZXZlbG9wZXIgdGhhdCB0aGUgZXh0ZW5zaW9uIHNob3VsZCBiZSB1cGRhdGVkIScpO1xuICAgICAgICBsZWdhY3lFeHRlbnNpb25Mb2FkaW5nKHNob3dkb3duLmV4dGVuc2lvbnNbZXh0XSwgZXh0KTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgLy8gRU5EIExFR0FDWSBTVVBQT1JUIENPREVcblxuICAgICAgfSBlbHNlIGlmICghc2hvd2Rvd24uaGVscGVyLmlzVW5kZWZpbmVkKGV4dGVuc2lvbnNbZXh0XSkpIHtcbiAgICAgICAgZXh0ID0gZXh0ZW5zaW9uc1tleHRdO1xuXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBFcnJvcignRXh0ZW5zaW9uIFwiJyArIGV4dCArICdcIiBjb3VsZCBub3QgYmUgbG9hZGVkLiBJdCB3YXMgZWl0aGVyIG5vdCBmb3VuZCBvciBpcyBub3QgYSB2YWxpZCBleHRlbnNpb24uJyk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBleHQgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIGV4dCA9IGV4dCgpO1xuICAgIH1cblxuICAgIGlmICghc2hvd2Rvd24uaGVscGVyLmlzQXJyYXkoZXh0KSkge1xuICAgICAgZXh0ID0gW2V4dF07XG4gICAgfVxuXG4gICAgaWYgKCFzaG93ZG93bi52YWxpZGF0ZUV4dGVuc2lvbihleHQpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBleHQubGVuZ3RoOyArK2kpIHtcbiAgICAgIHN3aXRjaCAoZXh0W2ldLnR5cGUpIHtcbiAgICAgICAgY2FzZSAnbGFuZyc6XG4gICAgICAgICAgbGFuZ0V4dGVuc2lvbnMucHVzaChleHRbaV0pO1xuICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgIGNhc2UgJ291dHB1dCc6XG4gICAgICAgICAgb3V0cHV0TW9kaWZpZXJzLnB1c2goZXh0W2ldKTtcbiAgICAgICAgICBicmVhaztcblxuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIC8vIHNob3VsZCBuZXZlciByZWFjaCBoZXJlXG4gICAgICAgICAgdGhyb3cgRXJyb3IoJ0V4dGVuc2lvbiBsb2FkZXIgZXJyb3I6IFR5cGUgdW5yZWNvZ25pemVkISEhJyk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIExFR0FDWV9TVVBQT1JUXG4gICAqIEBwYXJhbSB7Kn0gZXh0XG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lXG4gICAqL1xuICBmdW5jdGlvbiBsZWdhY3lFeHRlbnNpb25Mb2FkaW5nKGV4dCwgbmFtZSkge1xuICAgIGlmICh0eXBlb2YgZXh0ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICBleHQgPSBleHQobmV3IHNob3dkb3duLkNvbnZlcnRlcigpKTtcbiAgICB9XG4gICAgaWYgKCFzaG93ZG93bi5oZWxwZXIuaXNBcnJheShleHQpKSB7XG4gICAgICBleHQgPSBbZXh0XTtcbiAgICB9XG4gICAgdmFyIHZhbGlkID0gdmFsaWRhdGUoZXh0LCBuYW1lKTtcblxuICAgIGlmICghdmFsaWQudmFsaWQpIHtcbiAgICAgIHRocm93IEVycm9yKHZhbGlkLmVycm9yKTtcbiAgICB9XG5cbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGV4dC5sZW5ndGg7ICsraSkge1xuICAgICAgc3dpdGNoIChleHRbaV0udHlwZSkge1xuICAgICAgICBjYXNlICdsYW5nJzpcbiAgICAgICAgICBsYW5nRXh0ZW5zaW9ucy5wdXNoKGV4dFtpXSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgJ291dHB1dCc6XG4gICAgICAgICAgb3V0cHV0TW9kaWZpZXJzLnB1c2goZXh0W2ldKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgZGVmYXVsdDovLyBzaG91bGQgbmV2ZXIgcmVhY2ggaGVyZVxuICAgICAgICAgIHRocm93IEVycm9yKCdFeHRlbnNpb24gbG9hZGVyIGVycm9yOiBUeXBlIHVucmVjb2duaXplZCEhIScpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDb252ZXJ0cyBhIG1hcmtkb3duIHN0cmluZyBpbnRvIEhUTUxcbiAgICogQHBhcmFtIHtzdHJpbmd9IHRleHRcbiAgICogQHJldHVybnMgeyp9XG4gICAqL1xuICB0aGlzLm1ha2VIdG1sID0gZnVuY3Rpb24gKHRleHQpIHtcbiAgICAvL2NoZWNrIGlmIHRleHQgaXMgbm90IGZhbHN5XG4gICAgaWYgKCF0ZXh0KSB7XG4gICAgICByZXR1cm4gdGV4dDtcbiAgICB9XG5cbiAgICB2YXIgZ2xvYmFscyA9IHtcbiAgICAgIGdIdG1sQmxvY2tzOiAgICAgW10sXG4gICAgICBnVXJsczogICAgICAgICAgIHt9LFxuICAgICAgZ1RpdGxlczogICAgICAgICB7fSxcbiAgICAgIGdEaW1lbnNpb25zOiAgICAge30sXG4gICAgICBnTGlzdExldmVsOiAgICAgIDAsXG4gICAgICBoYXNoTGlua0NvdW50czogIHt9LFxuICAgICAgbGFuZ0V4dGVuc2lvbnM6ICBsYW5nRXh0ZW5zaW9ucyxcbiAgICAgIG91dHB1dE1vZGlmaWVyczogb3V0cHV0TW9kaWZpZXJzLFxuICAgICAgY29udmVydGVyOiAgICAgICB0aGlzXG4gICAgfTtcblxuICAgIC8vIGF0dGFja2xhYjogUmVwbGFjZSB+IHdpdGggflRcbiAgICAvLyBUaGlzIGxldHMgdXMgdXNlIHRpbGRlIGFzIGFuIGVzY2FwZSBjaGFyIHRvIGF2b2lkIG1kNSBoYXNoZXNcbiAgICAvLyBUaGUgY2hvaWNlIG9mIGNoYXJhY3RlciBpcyBhcmJpdHJhcnk7IGFueXRoaW5nIHRoYXQgaXNuJ3RcbiAgICAvLyBtYWdpYyBpbiBNYXJrZG93biB3aWxsIHdvcmsuXG4gICAgdGV4dCA9IHRleHQucmVwbGFjZSgvfi9nLCAnflQnKTtcblxuICAgIC8vIGF0dGFja2xhYjogUmVwbGFjZSAkIHdpdGggfkRcbiAgICAvLyBSZWdFeHAgaW50ZXJwcmV0cyAkIGFzIGEgc3BlY2lhbCBjaGFyYWN0ZXJcbiAgICAvLyB3aGVuIGl0J3MgaW4gYSByZXBsYWNlbWVudCBzdHJpbmdcbiAgICB0ZXh0ID0gdGV4dC5yZXBsYWNlKC9cXCQvZywgJ35EJyk7XG5cbiAgICAvLyBTdGFuZGFyZGl6ZSBsaW5lIGVuZGluZ3NcbiAgICB0ZXh0ID0gdGV4dC5yZXBsYWNlKC9cXHJcXG4vZywgJ1xcbicpOyAvLyBET1MgdG8gVW5peFxuICAgIHRleHQgPSB0ZXh0LnJlcGxhY2UoL1xcci9nLCAnXFxuJyk7IC8vIE1hYyB0byBVbml4XG5cbiAgICAvLyBNYWtlIHN1cmUgdGV4dCBiZWdpbnMgYW5kIGVuZHMgd2l0aCBhIGNvdXBsZSBvZiBuZXdsaW5lczpcbiAgICB0ZXh0ID0gJ1xcblxcbicgKyB0ZXh0ICsgJ1xcblxcbic7XG5cbiAgICAvLyBkZXRhYlxuICAgIHRleHQgPSBzaG93ZG93bi5zdWJQYXJzZXIoJ2RldGFiJykodGV4dCwgb3B0aW9ucywgZ2xvYmFscyk7XG5cbiAgICAvLyBzdHJpcEJsYW5rTGluZXNcbiAgICB0ZXh0ID0gc2hvd2Rvd24uc3ViUGFyc2VyKCdzdHJpcEJsYW5rTGluZXMnKSh0ZXh0LCBvcHRpb25zLCBnbG9iYWxzKTtcblxuICAgIC8vcnVuIGxhbmd1YWdlRXh0ZW5zaW9uc1xuICAgIHNob3dkb3duLmhlbHBlci5mb3JFYWNoKGxhbmdFeHRlbnNpb25zLCBmdW5jdGlvbiAoZXh0KSB7XG4gICAgICB0ZXh0ID0gc2hvd2Rvd24uc3ViUGFyc2VyKCdydW5FeHRlbnNpb24nKShleHQsIHRleHQsIG9wdGlvbnMsIGdsb2JhbHMpO1xuICAgIH0pO1xuXG4gICAgLy8gUnVuIGFsbCByZWdpc3RlcmVkIHBhcnNlcnNcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHBhcnNlck9yZGVyLmxlbmd0aDsgKytpKSB7XG4gICAgICB2YXIgbmFtZSA9IHBhcnNlck9yZGVyW2ldO1xuICAgICAgdGV4dCA9IHBhcnNlcnNbbmFtZV0odGV4dCwgb3B0aW9ucywgZ2xvYmFscyk7XG4gICAgfVxuXG4gICAgLy8gYXR0YWNrbGFiOiBSZXN0b3JlIGRvbGxhciBzaWduc1xuICAgIHRleHQgPSB0ZXh0LnJlcGxhY2UoL35EL2csICckJCcpO1xuXG4gICAgLy8gYXR0YWNrbGFiOiBSZXN0b3JlIHRpbGRlc1xuICAgIHRleHQgPSB0ZXh0LnJlcGxhY2UoL35UL2csICd+Jyk7XG5cbiAgICAvLyBSdW4gb3V0cHV0IG1vZGlmaWVyc1xuICAgIHNob3dkb3duLmhlbHBlci5mb3JFYWNoKG91dHB1dE1vZGlmaWVycywgZnVuY3Rpb24gKGV4dCkge1xuICAgICAgdGV4dCA9IHNob3dkb3duLnN1YlBhcnNlcigncnVuRXh0ZW5zaW9uJykoZXh0LCB0ZXh0LCBvcHRpb25zLCBnbG9iYWxzKTtcbiAgICB9KTtcblxuICAgIHJldHVybiB0ZXh0O1xuICB9O1xuXG4gIC8qKlxuICAgKiBTZXQgYW4gb3B0aW9uIG9mIHRoaXMgQ29udmVydGVyIGluc3RhbmNlXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBrZXlcbiAgICogQHBhcmFtIHsqfSB2YWx1ZVxuICAgKi9cbiAgdGhpcy5zZXRPcHRpb24gPSBmdW5jdGlvbiAoa2V5LCB2YWx1ZSkge1xuICAgIG9wdGlvbnNba2V5XSA9IHZhbHVlO1xuICB9O1xuXG4gIC8qKlxuICAgKiBHZXQgdGhlIG9wdGlvbiBvZiB0aGlzIENvbnZlcnRlciBpbnN0YW5jZVxuICAgKiBAcGFyYW0ge3N0cmluZ30ga2V5XG4gICAqIEByZXR1cm5zIHsqfVxuICAgKi9cbiAgdGhpcy5nZXRPcHRpb24gPSBmdW5jdGlvbiAoa2V5KSB7XG4gICAgcmV0dXJuIG9wdGlvbnNba2V5XTtcbiAgfTtcblxuICAvKipcbiAgICogR2V0IHRoZSBvcHRpb25zIG9mIHRoaXMgQ29udmVydGVyIGluc3RhbmNlXG4gICAqIEByZXR1cm5zIHt7fX1cbiAgICovXG4gIHRoaXMuZ2V0T3B0aW9ucyA9IGZ1bmN0aW9uICgpIHtcbiAgICByZXR1cm4gb3B0aW9ucztcbiAgfTtcblxuICAvKipcbiAgICogQWRkIGV4dGVuc2lvbiB0byBUSElTIGNvbnZlcnRlclxuICAgKiBAcGFyYW0ge3t9fSBleHRlbnNpb25cbiAgICovXG4gIHRoaXMuYWRkRXh0ZW5zaW9uID0gZnVuY3Rpb24gKGV4dGVuc2lvbikge1xuICAgIF9wYXJzZUV4dGVuc2lvbihleHRlbnNpb24pO1xuICB9O1xuXG4gIC8qKlxuICAgKiBVc2UgYSBnbG9iYWwgcmVnaXN0ZXJlZCBleHRlbnNpb24gd2l0aCBUSElTIGNvbnZlcnRlclxuICAgKiBAcGFyYW0ge3N0cmluZ30gZXh0ZW5zaW9uTmFtZSBOYW1lIG9mIHRoZSBwcmV2aW91c2x5IHJlZ2lzdGVyZWQgZXh0ZW5zaW9uXG4gICAqL1xuICB0aGlzLnVzZUV4dGVuc2lvbiA9IGZ1bmN0aW9uIChleHRlbnNpb25OYW1lKSB7XG4gICAgX3BhcnNlRXh0ZW5zaW9uKGV4dGVuc2lvbk5hbWUpO1xuICB9O1xuXG4gIC8qKlxuICAgKiBSZW1vdmUgYW4gZXh0ZW5zaW9uIGZyb20gVEhJUyBjb252ZXJ0ZXIuXG4gICAqIE5vdGU6IFRoaXMgaXMgYSBjb3N0bHkgb3BlcmF0aW9uLiBJdCdzIGJldHRlciB0byBpbml0aWFsaXplIGEgbmV3IGNvbnZlcnRlclxuICAgKiBhbmQgc3BlY2lmeSB0aGUgZXh0ZW5zaW9ucyB5b3Ugd2lzaCB0byB1c2VcbiAgICogQHBhcmFtIHtBcnJheX0gZXh0ZW5zaW9uXG4gICAqL1xuICB0aGlzLnJlbW92ZUV4dGVuc2lvbiA9IGZ1bmN0aW9uIChleHRlbnNpb24pIHtcbiAgICBpZiAoIXNob3dkb3duLmhlbHBlci5pc0FycmF5KGV4dGVuc2lvbikpIHtcbiAgICAgIGV4dGVuc2lvbiA9IFtleHRlbnNpb25dO1xuICAgIH1cbiAgICBmb3IgKHZhciBhID0gMDsgYSA8IGV4dGVuc2lvbi5sZW5ndGg7ICsrYSkge1xuICAgICAgdmFyIGV4dCA9IGV4dGVuc2lvblthXTtcbiAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGFuZ0V4dGVuc2lvbnMubGVuZ3RoOyArK2kpIHtcbiAgICAgICAgaWYgKGxhbmdFeHRlbnNpb25zW2ldID09PSBleHQpIHtcbiAgICAgICAgICBsYW5nRXh0ZW5zaW9uc1tpXS5zcGxpY2UoaSwgMSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGZvciAodmFyIGlpID0gMDsgaWkgPCBvdXRwdXRNb2RpZmllcnMubGVuZ3RoOyArK2kpIHtcbiAgICAgICAgaWYgKG91dHB1dE1vZGlmaWVyc1tpaV0gPT09IGV4dCkge1xuICAgICAgICAgIG91dHB1dE1vZGlmaWVyc1tpaV0uc3BsaWNlKGksIDEpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9O1xuXG4gIC8qKlxuICAgKiBHZXQgYWxsIGV4dGVuc2lvbiBvZiBUSElTIGNvbnZlcnRlclxuICAgKiBAcmV0dXJucyB7e2xhbmd1YWdlOiBBcnJheSwgb3V0cHV0OiBBcnJheX19XG4gICAqL1xuICB0aGlzLmdldEFsbEV4dGVuc2lvbnMgPSBmdW5jdGlvbiAoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGxhbmd1YWdlOiBsYW5nRXh0ZW5zaW9ucyxcbiAgICAgIG91dHB1dDogb3V0cHV0TW9kaWZpZXJzXG4gICAgfTtcbiAgfTtcbn07XG5cbi8qKlxuICogVHVybiBNYXJrZG93biBsaW5rIHNob3J0Y3V0cyBpbnRvIFhIVE1MIDxhPiB0YWdzLlxuICovXG5zaG93ZG93bi5zdWJQYXJzZXIoJ2FuY2hvcnMnLCBmdW5jdGlvbiAodGV4dCwgY29uZmlnLCBnbG9iYWxzKSB7XG4gICd1c2Ugc3RyaWN0JztcblxuICB2YXIgd3JpdGVBbmNob3JUYWcgPSBmdW5jdGlvbiAod2hvbGVNYXRjaCwgbTEsIG0yLCBtMywgbTQsIG01LCBtNiwgbTcpIHtcbiAgICBpZiAoc2hvd2Rvd24uaGVscGVyLmlzVW5kZWZpbmVkKG03KSkge1xuICAgICAgbTcgPSAnJztcbiAgICB9XG4gICAgd2hvbGVNYXRjaCA9IG0xO1xuICAgIHZhciBsaW5rVGV4dCA9IG0yLFxuICAgICAgICBsaW5rSWQgPSBtMy50b0xvd2VyQ2FzZSgpLFxuICAgICAgICB1cmwgPSBtNCxcbiAgICAgICAgdGl0bGUgPSBtNztcblxuICAgIGlmICghdXJsKSB7XG4gICAgICBpZiAoIWxpbmtJZCkge1xuICAgICAgICAvLyBsb3dlci1jYXNlIGFuZCB0dXJuIGVtYmVkZGVkIG5ld2xpbmVzIGludG8gc3BhY2VzXG4gICAgICAgIGxpbmtJZCA9IGxpbmtUZXh0LnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvID9cXG4vZywgJyAnKTtcbiAgICAgIH1cbiAgICAgIHVybCA9ICcjJyArIGxpbmtJZDtcblxuICAgICAgaWYgKCFzaG93ZG93bi5oZWxwZXIuaXNVbmRlZmluZWQoZ2xvYmFscy5nVXJsc1tsaW5rSWRdKSkge1xuICAgICAgICB1cmwgPSBnbG9iYWxzLmdVcmxzW2xpbmtJZF07XG4gICAgICAgIGlmICghc2hvd2Rvd24uaGVscGVyLmlzVW5kZWZpbmVkKGdsb2JhbHMuZ1RpdGxlc1tsaW5rSWRdKSkge1xuICAgICAgICAgIHRpdGxlID0gZ2xvYmFscy5nVGl0bGVzW2xpbmtJZF07XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmICh3aG9sZU1hdGNoLnNlYXJjaCgvXFwoXFxzKlxcKSQvbSkgPiAtMSkge1xuICAgICAgICAgIC8vIFNwZWNpYWwgY2FzZSBmb3IgZXhwbGljaXQgZW1wdHkgdXJsXG4gICAgICAgICAgdXJsID0gJyc7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmV0dXJuIHdob2xlTWF0Y2g7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICB1cmwgPSBzaG93ZG93bi5oZWxwZXIuZXNjYXBlQ2hhcmFjdGVycyh1cmwsICcqXycsIGZhbHNlKTtcbiAgICB2YXIgcmVzdWx0ID0gJzxhIGhyZWY9XCInICsgdXJsICsgJ1wiJztcblxuICAgIGlmICh0aXRsZSAhPT0gJycgJiYgdGl0bGUgIT09IG51bGwpIHtcbiAgICAgIHRpdGxlID0gdGl0bGUucmVwbGFjZSgvXCIvZywgJyZxdW90OycpO1xuICAgICAgdGl0bGUgPSBzaG93ZG93bi5oZWxwZXIuZXNjYXBlQ2hhcmFjdGVycyh0aXRsZSwgJypfJywgZmFsc2UpO1xuICAgICAgcmVzdWx0ICs9ICcgdGl0bGU9XCInICsgdGl0bGUgKyAnXCInO1xuICAgIH1cblxuICAgIHJlc3VsdCArPSAnPicgKyBsaW5rVGV4dCArICc8L2E+JztcblxuICAgIHJldHVybiByZXN1bHQ7XG4gIH07XG5cbiAgLy8gRmlyc3QsIGhhbmRsZSByZWZlcmVuY2Utc3R5bGUgbGlua3M6IFtsaW5rIHRleHRdIFtpZF1cbiAgLypcbiAgIHRleHQgPSB0ZXh0LnJlcGxhY2UoL1xuICAgKFx0XHRcdFx0XHRcdFx0Ly8gd3JhcCB3aG9sZSBtYXRjaCBpbiAkMVxuICAgXFxbXG4gICAoXG4gICAoPzpcbiAgIFxcW1teXFxdXSpcXF1cdFx0Ly8gYWxsb3cgYnJhY2tldHMgbmVzdGVkIG9uZSBsZXZlbFxuICAgfFxuICAgW15cXFtdXHRcdFx0Ly8gb3IgYW55dGhpbmcgZWxzZVxuICAgKSpcbiAgIClcbiAgIFxcXVxuXG4gICBbIF0/XHRcdFx0XHRcdC8vIG9uZSBvcHRpb25hbCBzcGFjZVxuICAgKD86XFxuWyBdKik/XHRcdFx0XHQvLyBvbmUgb3B0aW9uYWwgbmV3bGluZSBmb2xsb3dlZCBieSBzcGFjZXNcblxuICAgXFxbXG4gICAoLio/KVx0XHRcdFx0XHQvLyBpZCA9ICQzXG4gICBcXF1cbiAgICkoKSgpKCkoKVx0XHRcdFx0XHQvLyBwYWQgcmVtYWluaW5nIGJhY2tyZWZlcmVuY2VzXG4gICAvZyxfRG9BbmNob3JzX2NhbGxiYWNrKTtcbiAgICovXG4gIHRleHQgPSB0ZXh0LnJlcGxhY2UoLyhcXFsoKD86XFxbW15cXF1dKlxcXXxbXlxcW1xcXV0pKilcXF1bIF0/KD86XFxuWyBdKik/XFxbKC4qPylcXF0pKCkoKSgpKCkvZywgd3JpdGVBbmNob3JUYWcpO1xuXG4gIC8vXG4gIC8vIE5leHQsIGlubGluZS1zdHlsZSBsaW5rczogW2xpbmsgdGV4dF0odXJsIFwib3B0aW9uYWwgdGl0bGVcIilcbiAgLy9cblxuICAvKlxuICAgdGV4dCA9IHRleHQucmVwbGFjZSgvXG4gICAoXHRcdFx0XHRcdFx0Ly8gd3JhcCB3aG9sZSBtYXRjaCBpbiAkMVxuICAgXFxbXG4gICAoXG4gICAoPzpcbiAgIFxcW1teXFxdXSpcXF1cdC8vIGFsbG93IGJyYWNrZXRzIG5lc3RlZCBvbmUgbGV2ZWxcbiAgIHxcbiAgIFteXFxbXFxdXVx0XHRcdC8vIG9yIGFueXRoaW5nIGVsc2VcbiAgIClcbiAgIClcbiAgIFxcXVxuICAgXFwoXHRcdFx0XHRcdFx0Ly8gbGl0ZXJhbCBwYXJlblxuICAgWyBcXHRdKlxuICAgKClcdFx0XHRcdFx0XHQvLyBubyBpZCwgc28gbGVhdmUgJDMgZW1wdHlcbiAgIDw/KC4qPyk+P1x0XHRcdFx0Ly8gaHJlZiA9ICQ0XG4gICBbIFxcdF0qXG4gICAoXHRcdFx0XHRcdFx0Ly8gJDVcbiAgIChbJ1wiXSlcdFx0XHRcdC8vIHF1b3RlIGNoYXIgPSAkNlxuICAgKC4qPylcdFx0XHRcdC8vIFRpdGxlID0gJDdcbiAgIFxcNlx0XHRcdFx0XHQvLyBtYXRjaGluZyBxdW90ZVxuICAgWyBcXHRdKlx0XHRcdFx0Ly8gaWdub3JlIGFueSBzcGFjZXMvdGFicyBiZXR3ZWVuIGNsb3NpbmcgcXVvdGUgYW5kIClcbiAgICk/XHRcdFx0XHRcdFx0Ly8gdGl0bGUgaXMgb3B0aW9uYWxcbiAgIFxcKVxuICAgKVxuICAgL2csd3JpdGVBbmNob3JUYWcpO1xuICAgKi9cbiAgdGV4dCA9IHRleHQucmVwbGFjZSgvKFxcWygoPzpcXFtbXlxcXV0qXFxdfFteXFxbXFxdXSkqKVxcXVxcKFsgXFx0XSooKTw/KC4qPyg/OlxcKC4qP1xcKS4qPyk/KT4/WyBcXHRdKigoWydcIl0pKC4qPylcXDZbIFxcdF0qKT9cXCkpL2csXG4gICAgICAgICAgICAgICAgICAgICAgd3JpdGVBbmNob3JUYWcpO1xuXG4gIC8vXG4gIC8vIExhc3QsIGhhbmRsZSByZWZlcmVuY2Utc3R5bGUgc2hvcnRjdXRzOiBbbGluayB0ZXh0XVxuICAvLyBUaGVzZSBtdXN0IGNvbWUgbGFzdCBpbiBjYXNlIHlvdSd2ZSBhbHNvIGdvdCBbbGluayB0ZXN0XVsxXVxuICAvLyBvciBbbGluayB0ZXN0XSgvZm9vKVxuICAvL1xuXG4gIC8qXG4gICB0ZXh0ID0gdGV4dC5yZXBsYWNlKC9cbiAgICggICAgICAgICAgICAgICAgLy8gd3JhcCB3aG9sZSBtYXRjaCBpbiAkMVxuICAgXFxbXG4gICAoW15cXFtcXF1dKykgICAgICAgLy8gbGluayB0ZXh0ID0gJDI7IGNhbid0IGNvbnRhaW4gJ1snIG9yICddJ1xuICAgXFxdXG4gICApKCkoKSgpKCkoKSAgICAgIC8vIHBhZCByZXN0IG9mIGJhY2tyZWZlcmVuY2VzXG4gICAvZywgd3JpdGVBbmNob3JUYWcpO1xuICAgKi9cbiAgdGV4dCA9IHRleHQucmVwbGFjZSgvKFxcWyhbXlxcW1xcXV0rKVxcXSkoKSgpKCkoKSgpL2csIHdyaXRlQW5jaG9yVGFnKTtcblxuICByZXR1cm4gdGV4dDtcblxufSk7XG5cbnNob3dkb3duLnN1YlBhcnNlcignYXV0b0xpbmtzJywgZnVuY3Rpb24gKHRleHQpIHtcbiAgJ3VzZSBzdHJpY3QnO1xuXG4gIHRleHQgPSB0ZXh0LnJlcGxhY2UoLzwoKGh0dHBzP3xmdHB8ZGljdCk6W14nXCI+XFxzXSspPi9naSwgJzxhIGhyZWY9XFxcIiQxXFxcIj4kMTwvYT4nKTtcblxuICAvLyBFbWFpbCBhZGRyZXNzZXM6IDxhZGRyZXNzQGRvbWFpbi5mb28+XG5cbiAgLypcbiAgIHRleHQgPSB0ZXh0LnJlcGxhY2UoL1xuICAgPFxuICAgKD86bWFpbHRvOik/XG4gICAoXG4gICBbLS5cXHddK1xuICAgXFxAXG4gICBbLWEtejAtOV0rKFxcLlstYS16MC05XSspKlxcLlthLXpdK1xuICAgKVxuICAgPlxuICAgL2dpKTtcbiAgICovXG4gIHZhciBwYXR0ZXJuID0gLzwoPzptYWlsdG86KT8oWy0uXFx3XStcXEBbLWEtejAtOV0rKFxcLlstYS16MC05XSspKlxcLlthLXpdKyk+L2dpO1xuICB0ZXh0ID0gdGV4dC5yZXBsYWNlKHBhdHRlcm4sIGZ1bmN0aW9uICh3aG9sZU1hdGNoLCBtMSkge1xuICAgIHZhciB1bmVzY2FwZWRTdHIgPSBzaG93ZG93bi5zdWJQYXJzZXIoJ3VuZXNjYXBlU3BlY2lhbENoYXJzJykobTEpO1xuICAgIHJldHVybiBzaG93ZG93bi5zdWJQYXJzZXIoJ2VuY29kZUVtYWlsQWRkcmVzcycpKHVuZXNjYXBlZFN0cik7XG4gIH0pO1xuXG4gIHJldHVybiB0ZXh0O1xuXG59KTtcblxuLyoqXG4gKiBUaGVzZSBhcmUgYWxsIHRoZSB0cmFuc2Zvcm1hdGlvbnMgdGhhdCBmb3JtIGJsb2NrLWxldmVsXG4gKiB0YWdzIGxpa2UgcGFyYWdyYXBocywgaGVhZGVycywgYW5kIGxpc3QgaXRlbXMuXG4gKi9cbnNob3dkb3duLnN1YlBhcnNlcignYmxvY2tHYW11dCcsIGZ1bmN0aW9uICh0ZXh0LCBvcHRpb25zLCBnbG9iYWxzKSB7XG4gICd1c2Ugc3RyaWN0JztcblxuICB0ZXh0ID0gc2hvd2Rvd24uc3ViUGFyc2VyKCdoZWFkZXJzJykodGV4dCwgb3B0aW9ucywgZ2xvYmFscyk7XG5cbiAgLy8gRG8gSG9yaXpvbnRhbCBSdWxlczpcbiAgdmFyIGtleSA9IHNob3dkb3duLnN1YlBhcnNlcignaGFzaEJsb2NrJykoJzxociAvPicsIG9wdGlvbnMsIGdsb2JhbHMpO1xuICB0ZXh0ID0gdGV4dC5yZXBsYWNlKC9eWyBdezAsMn0oWyBdP1xcKlsgXT8pezMsfVsgXFx0XSokL2dtLCBrZXkpO1xuICB0ZXh0ID0gdGV4dC5yZXBsYWNlKC9eWyBdezAsMn0oWyBdP1xcLVsgXT8pezMsfVsgXFx0XSokL2dtLCBrZXkpO1xuICB0ZXh0ID0gdGV4dC5yZXBsYWNlKC9eWyBdezAsMn0oWyBdP1xcX1sgXT8pezMsfVsgXFx0XSokL2dtLCBrZXkpO1xuXG4gIHRleHQgPSBzaG93ZG93bi5zdWJQYXJzZXIoJ2xpc3RzJykodGV4dCwgb3B0aW9ucywgZ2xvYmFscyk7XG4gIHRleHQgPSBzaG93ZG93bi5zdWJQYXJzZXIoJ2NvZGVCbG9ja3MnKSh0ZXh0LCBvcHRpb25zLCBnbG9iYWxzKTtcbiAgdGV4dCA9IHNob3dkb3duLnN1YlBhcnNlcignYmxvY2tRdW90ZXMnKSh0ZXh0LCBvcHRpb25zLCBnbG9iYWxzKTtcblxuICAvLyBXZSBhbHJlYWR5IHJhbiBfSGFzaEhUTUxCbG9ja3MoKSBiZWZvcmUsIGluIE1hcmtkb3duKCksIGJ1dCB0aGF0XG4gIC8vIHdhcyB0byBlc2NhcGUgcmF3IEhUTUwgaW4gdGhlIG9yaWdpbmFsIE1hcmtkb3duIHNvdXJjZS4gVGhpcyB0aW1lLFxuICAvLyB3ZSdyZSBlc2NhcGluZyB0aGUgbWFya3VwIHdlJ3ZlIGp1c3QgY3JlYXRlZCwgc28gdGhhdCB3ZSBkb24ndCB3cmFwXG4gIC8vIDxwPiB0YWdzIGFyb3VuZCBibG9jay1sZXZlbCB0YWdzLlxuICB0ZXh0ID0gc2hvd2Rvd24uc3ViUGFyc2VyKCdoYXNoSFRNTEJsb2NrcycpKHRleHQsIG9wdGlvbnMsIGdsb2JhbHMpO1xuICB0ZXh0ID0gc2hvd2Rvd24uc3ViUGFyc2VyKCdwYXJhZ3JhcGhzJykodGV4dCwgb3B0aW9ucywgZ2xvYmFscyk7XG5cbiAgcmV0dXJuIHRleHQ7XG5cbn0pO1xuXG5zaG93ZG93bi5zdWJQYXJzZXIoJ2Jsb2NrUXVvdGVzJywgZnVuY3Rpb24gKHRleHQsIG9wdGlvbnMsIGdsb2JhbHMpIHtcbiAgJ3VzZSBzdHJpY3QnO1xuXG4gIC8qXG4gICB0ZXh0ID0gdGV4dC5yZXBsYWNlKC9cbiAgIChcdFx0XHRcdFx0XHRcdFx0Ly8gV3JhcCB3aG9sZSBtYXRjaCBpbiAkMVxuICAgKFxuICAgXlsgXFx0XSo+WyBcXHRdP1x0XHRcdC8vICc+JyBhdCB0aGUgc3RhcnQgb2YgYSBsaW5lXG4gICAuK1xcblx0XHRcdFx0XHQvLyByZXN0IG9mIHRoZSBmaXJzdCBsaW5lXG4gICAoLitcXG4pKlx0XHRcdFx0XHQvLyBzdWJzZXF1ZW50IGNvbnNlY3V0aXZlIGxpbmVzXG4gICBcXG4qXHRcdFx0XHRcdFx0Ly8gYmxhbmtzXG4gICApK1xuICAgKVxuICAgL2dtLCBmdW5jdGlvbigpey4uLn0pO1xuICAgKi9cblxuICB0ZXh0ID0gdGV4dC5yZXBsYWNlKC8oKF5bIFxcdF0qPlsgXFx0XT8uK1xcbiguK1xcbikqXFxuKikrKS9nbSwgZnVuY3Rpb24gKHdob2xlTWF0Y2gsIG0xKSB7XG4gICAgdmFyIGJxID0gbTE7XG5cbiAgICAvLyBhdHRhY2tsYWI6IGhhY2sgYXJvdW5kIEtvbnF1ZXJvciAzLjUuNCBidWc6XG4gICAgLy8gXCItLS0tLS0tLS0tYnVnXCIucmVwbGFjZSgvXi0vZyxcIlwiKSA9PSBcImJ1Z1wiXG4gICAgYnEgPSBicS5yZXBsYWNlKC9eWyBcXHRdKj5bIFxcdF0/L2dtLCAnfjAnKTsgLy8gdHJpbSBvbmUgbGV2ZWwgb2YgcXVvdGluZ1xuXG4gICAgLy8gYXR0YWNrbGFiOiBjbGVhbiB1cCBoYWNrXG4gICAgYnEgPSBicS5yZXBsYWNlKC9+MC9nLCAnJyk7XG5cbiAgICBicSA9IGJxLnJlcGxhY2UoL15bIFxcdF0rJC9nbSwgJycpOyAvLyB0cmltIHdoaXRlc3BhY2Utb25seSBsaW5lc1xuICAgIGJxID0gc2hvd2Rvd24uc3ViUGFyc2VyKCdibG9ja0dhbXV0JykoYnEsIG9wdGlvbnMsIGdsb2JhbHMpOyAvLyByZWN1cnNlXG5cbiAgICBicSA9IGJxLnJlcGxhY2UoLyhefFxcbikvZywgJyQxICAnKTtcbiAgICAvLyBUaGVzZSBsZWFkaW5nIHNwYWNlcyBzY3JldyB3aXRoIDxwcmU+IGNvbnRlbnQsIHNvIHdlIG5lZWQgdG8gZml4IHRoYXQ6XG4gICAgYnEgPSBicS5yZXBsYWNlKC8oXFxzKjxwcmU+W15cXHJdKz88XFwvcHJlPikvZ20sIGZ1bmN0aW9uICh3aG9sZU1hdGNoLCBtMSkge1xuICAgICAgdmFyIHByZSA9IG0xO1xuICAgICAgLy8gYXR0YWNrbGFiOiBoYWNrIGFyb3VuZCBLb25xdWVyb3IgMy41LjQgYnVnOlxuICAgICAgcHJlID0gcHJlLnJlcGxhY2UoL14gIC9tZywgJ34wJyk7XG4gICAgICBwcmUgPSBwcmUucmVwbGFjZSgvfjAvZywgJycpO1xuICAgICAgcmV0dXJuIHByZTtcbiAgICB9KTtcblxuICAgIHJldHVybiBzaG93ZG93bi5zdWJQYXJzZXIoJ2hhc2hCbG9jaycpKCc8YmxvY2txdW90ZT5cXG4nICsgYnEgKyAnXFxuPC9ibG9ja3F1b3RlPicsIG9wdGlvbnMsIGdsb2JhbHMpO1xuICB9KTtcbiAgcmV0dXJuIHRleHQ7XG59KTtcblxuLyoqXG4gKiBQcm9jZXNzIE1hcmtkb3duIGA8cHJlPjxjb2RlPmAgYmxvY2tzLlxuICovXG5zaG93ZG93bi5zdWJQYXJzZXIoJ2NvZGVCbG9ja3MnLCBmdW5jdGlvbiAodGV4dCwgb3B0aW9ucywgZ2xvYmFscykge1xuICAndXNlIHN0cmljdCc7XG5cbiAgLypcbiAgIHRleHQgPSB0ZXh0LnJlcGxhY2UodGV4dCxcbiAgIC8oPzpcXG5cXG58XilcbiAgIChcdFx0XHRcdFx0XHRcdFx0Ly8gJDEgPSB0aGUgY29kZSBibG9jayAtLSBvbmUgb3IgbW9yZSBsaW5lcywgc3RhcnRpbmcgd2l0aCBhIHNwYWNlL3RhYlxuICAgKD86XG4gICAoPzpbIF17NH18XFx0KVx0XHRcdC8vIExpbmVzIG11c3Qgc3RhcnQgd2l0aCBhIHRhYiBvciBhIHRhYi13aWR0aCBvZiBzcGFjZXMgLSBhdHRhY2tsYWI6IGdfdGFiX3dpZHRoXG4gICAuKlxcbitcbiAgICkrXG4gICApXG4gICAoXFxuKlsgXXswLDN9W14gXFx0XFxuXXwoPz1+MCkpXHQvLyBhdHRhY2tsYWI6IGdfdGFiX3dpZHRoXG4gICAvZyxmdW5jdGlvbigpey4uLn0pO1xuICAgKi9cblxuICAvLyBhdHRhY2tsYWI6IHNlbnRpbmVsIHdvcmthcm91bmRzIGZvciBsYWNrIG9mIFxcQSBhbmQgXFxaLCBzYWZhcmlcXGtodG1sIGJ1Z1xuICB0ZXh0ICs9ICd+MCc7XG5cbiAgdmFyIHBhdHRlcm4gPSAvKD86XFxuXFxufF4pKCg/Oig/OlsgXXs0fXxcXHQpLipcXG4rKSspKFxcbipbIF17MCwzfVteIFxcdFxcbl18KD89fjApKS9nO1xuICB0ZXh0ID0gdGV4dC5yZXBsYWNlKHBhdHRlcm4sIGZ1bmN0aW9uICh3aG9sZU1hdGNoLCBtMSwgbTIpIHtcbiAgICB2YXIgY29kZWJsb2NrID0gbTEsXG4gICAgICAgIG5leHRDaGFyID0gbTIsXG4gICAgICAgIGVuZCA9ICdcXG4nO1xuXG4gICAgY29kZWJsb2NrID0gc2hvd2Rvd24uc3ViUGFyc2VyKCdvdXRkZW50JykoY29kZWJsb2NrKTtcbiAgICBjb2RlYmxvY2sgPSBzaG93ZG93bi5zdWJQYXJzZXIoJ2VuY29kZUNvZGUnKShjb2RlYmxvY2spO1xuICAgIGNvZGVibG9jayA9IHNob3dkb3duLnN1YlBhcnNlcignZGV0YWInKShjb2RlYmxvY2spO1xuICAgIGNvZGVibG9jayA9IGNvZGVibG9jay5yZXBsYWNlKC9eXFxuKy9nLCAnJyk7IC8vIHRyaW0gbGVhZGluZyBuZXdsaW5lc1xuICAgIGNvZGVibG9jayA9IGNvZGVibG9jay5yZXBsYWNlKC9cXG4rJC9nLCAnJyk7IC8vIHRyaW0gdHJhaWxpbmcgbmV3bGluZXNcblxuICAgIGlmIChvcHRpb25zLm9taXRFeHRyYVdMSW5Db2RlQmxvY2tzKSB7XG4gICAgICBlbmQgPSAnJztcbiAgICB9XG5cbiAgICBjb2RlYmxvY2sgPSAnPHByZT48Y29kZT4nICsgY29kZWJsb2NrICsgZW5kICsgJzwvY29kZT48L3ByZT4nO1xuXG4gICAgcmV0dXJuIHNob3dkb3duLnN1YlBhcnNlcignaGFzaEJsb2NrJykoY29kZWJsb2NrLCBvcHRpb25zLCBnbG9iYWxzKSArIG5leHRDaGFyO1xuICB9KTtcblxuICAvLyBhdHRhY2tsYWI6IHN0cmlwIHNlbnRpbmVsXG4gIHRleHQgPSB0ZXh0LnJlcGxhY2UoL34wLywgJycpO1xuXG4gIHJldHVybiB0ZXh0O1xufSk7XG5cbi8qKlxuICpcbiAqICAgKiAgQmFja3RpY2sgcXVvdGVzIGFyZSB1c2VkIGZvciA8Y29kZT48L2NvZGU+IHNwYW5zLlxuICpcbiAqICAgKiAgWW91IGNhbiB1c2UgbXVsdGlwbGUgYmFja3RpY2tzIGFzIHRoZSBkZWxpbWl0ZXJzIGlmIHlvdSB3YW50IHRvXG4gKiAgICAgaW5jbHVkZSBsaXRlcmFsIGJhY2t0aWNrcyBpbiB0aGUgY29kZSBzcGFuLiBTbywgdGhpcyBpbnB1dDpcbiAqXG4gKiAgICAgICAgIEp1c3QgdHlwZSBgYGZvbyBgYmFyYCBiYXpgYCBhdCB0aGUgcHJvbXB0LlxuICpcbiAqICAgICAgIFdpbGwgdHJhbnNsYXRlIHRvOlxuICpcbiAqICAgICAgICAgPHA+SnVzdCB0eXBlIDxjb2RlPmZvbyBgYmFyYCBiYXo8L2NvZGU+IGF0IHRoZSBwcm9tcHQuPC9wPlxuICpcbiAqICAgIFRoZXJlJ3Mgbm8gYXJiaXRyYXJ5IGxpbWl0IHRvIHRoZSBudW1iZXIgb2YgYmFja3RpY2tzIHlvdVxuICogICAgY2FuIHVzZSBhcyBkZWxpbXRlcnMuIElmIHlvdSBuZWVkIHRocmVlIGNvbnNlY3V0aXZlIGJhY2t0aWNrc1xuICogICAgaW4geW91ciBjb2RlLCB1c2UgZm91ciBmb3IgZGVsaW1pdGVycywgZXRjLlxuICpcbiAqICAqICBZb3UgY2FuIHVzZSBzcGFjZXMgdG8gZ2V0IGxpdGVyYWwgYmFja3RpY2tzIGF0IHRoZSBlZGdlczpcbiAqXG4gKiAgICAgICAgIC4uLiB0eXBlIGBgIGBiYXJgIGBgIC4uLlxuICpcbiAqICAgICAgIFR1cm5zIHRvOlxuICpcbiAqICAgICAgICAgLi4uIHR5cGUgPGNvZGU+YGJhcmA8L2NvZGU+IC4uLlxuICovXG5zaG93ZG93bi5zdWJQYXJzZXIoJ2NvZGVTcGFucycsIGZ1bmN0aW9uICh0ZXh0KSB7XG4gICd1c2Ugc3RyaWN0JztcblxuICAvKlxuICAgdGV4dCA9IHRleHQucmVwbGFjZSgvXG4gICAoXnxbXlxcXFxdKVx0XHRcdFx0XHQvLyBDaGFyYWN0ZXIgYmVmb3JlIG9wZW5pbmcgYCBjYW4ndCBiZSBhIGJhY2tzbGFzaFxuICAgKGArKVx0XHRcdFx0XHRcdC8vICQyID0gT3BlbmluZyBydW4gb2YgYFxuICAgKFx0XHRcdFx0XHRcdFx0Ly8gJDMgPSBUaGUgY29kZSBibG9ja1xuICAgW15cXHJdKj9cbiAgIFteYF1cdFx0XHRcdFx0Ly8gYXR0YWNrbGFiOiB3b3JrIGFyb3VuZCBsYWNrIG9mIGxvb2tiZWhpbmRcbiAgIClcbiAgIFxcMlx0XHRcdFx0XHRcdFx0Ly8gTWF0Y2hpbmcgY2xvc2VyXG4gICAoPyFgKVxuICAgL2dtLCBmdW5jdGlvbigpey4uLn0pO1xuICAgKi9cblxuICB0ZXh0ID0gdGV4dC5yZXBsYWNlKC8oXnxbXlxcXFxdKShgKykoW15cXHJdKj9bXmBdKVxcMig/IWApL2dtLCBmdW5jdGlvbiAod2hvbGVNYXRjaCwgbTEsIG0yLCBtMykge1xuICAgIHZhciBjID0gbTM7XG4gICAgYyA9IGMucmVwbGFjZSgvXihbIFxcdF0qKS9nLCAnJyk7XHQvLyBsZWFkaW5nIHdoaXRlc3BhY2VcbiAgICBjID0gYy5yZXBsYWNlKC9bIFxcdF0qJC9nLCAnJyk7XHQvLyB0cmFpbGluZyB3aGl0ZXNwYWNlXG4gICAgYyA9IHNob3dkb3duLnN1YlBhcnNlcignZW5jb2RlQ29kZScpKGMpO1xuICAgIHJldHVybiBtMSArICc8Y29kZT4nICsgYyArICc8L2NvZGU+JztcbiAgfSk7XG5cbiAgcmV0dXJuIHRleHQ7XG5cbn0pO1xuXG4vKipcbiAqIENvbnZlcnQgYWxsIHRhYnMgdG8gc3BhY2VzXG4gKi9cbnNob3dkb3duLnN1YlBhcnNlcignZGV0YWInLCBmdW5jdGlvbiAodGV4dCkge1xuICAndXNlIHN0cmljdCc7XG5cbiAgLy8gZXhwYW5kIGZpcnN0IG4tMSB0YWJzXG4gIHRleHQgPSB0ZXh0LnJlcGxhY2UoL1xcdCg/PVxcdCkvZywgJyAgICAnKTsgLy8gZ190YWJfd2lkdGhcblxuICAvLyByZXBsYWNlIHRoZSBudGggd2l0aCB0d28gc2VudGluZWxzXG4gIHRleHQgPSB0ZXh0LnJlcGxhY2UoL1xcdC9nLCAnfkF+QicpO1xuXG4gIC8vIHVzZSB0aGUgc2VudGluZWwgdG8gYW5jaG9yIG91ciByZWdleCBzbyBpdCBkb2Vzbid0IGV4cGxvZGVcbiAgdGV4dCA9IHRleHQucmVwbGFjZSgvfkIoLis/KX5BL2csIGZ1bmN0aW9uICh3aG9sZU1hdGNoLCBtMSkge1xuICAgIHZhciBsZWFkaW5nVGV4dCA9IG0xLFxuICAgICAgICBudW1TcGFjZXMgPSA0IC0gbGVhZGluZ1RleHQubGVuZ3RoICUgNDsgIC8vIGdfdGFiX3dpZHRoXG5cbiAgICAvLyB0aGVyZSAqbXVzdCogYmUgYSBiZXR0ZXIgd2F5IHRvIGRvIHRoaXM6XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBudW1TcGFjZXM7IGkrKykge1xuICAgICAgbGVhZGluZ1RleHQgKz0gJyAnO1xuICAgIH1cblxuICAgIHJldHVybiBsZWFkaW5nVGV4dDtcbiAgfSk7XG5cbiAgLy8gY2xlYW4gdXAgc2VudGluZWxzXG4gIHRleHQgPSB0ZXh0LnJlcGxhY2UoL35BL2csICcgICAgJyk7ICAvLyBnX3RhYl93aWR0aFxuICB0ZXh0ID0gdGV4dC5yZXBsYWNlKC9+Qi9nLCAnJyk7XG5cbiAgcmV0dXJuIHRleHQ7XG5cbn0pO1xuXG4vKipcbiAqIFNtYXJ0IHByb2Nlc3NpbmcgZm9yIGFtcGVyc2FuZHMgYW5kIGFuZ2xlIGJyYWNrZXRzIHRoYXQgbmVlZCB0byBiZSBlbmNvZGVkLlxuICovXG5zaG93ZG93bi5zdWJQYXJzZXIoJ2VuY29kZUFtcHNBbmRBbmdsZXMnLCBmdW5jdGlvbiAodGV4dCkge1xuICAndXNlIHN0cmljdCc7XG4gIC8vIEFtcGVyc2FuZC1lbmNvZGluZyBiYXNlZCBlbnRpcmVseSBvbiBOYXQgSXJvbnMncyBBbXB1dGF0b3IgTVQgcGx1Z2luOlxuICAvLyBodHRwOi8vYnVtcHBvLm5ldC9wcm9qZWN0cy9hbXB1dGF0b3IvXG4gIHRleHQgPSB0ZXh0LnJlcGxhY2UoLyYoPyEjP1t4WF0/KD86WzAtOWEtZkEtRl0rfFxcdyspOykvZywgJyZhbXA7Jyk7XG5cbiAgLy8gRW5jb2RlIG5ha2VkIDwnc1xuICB0ZXh0ID0gdGV4dC5yZXBsYWNlKC88KD8hW2EtelxcLz9cXCQhXSkvZ2ksICcmbHQ7Jyk7XG5cbiAgcmV0dXJuIHRleHQ7XG59KTtcblxuLyoqXG4gKiBSZXR1cm5zIHRoZSBzdHJpbmcsIHdpdGggYWZ0ZXIgcHJvY2Vzc2luZyB0aGUgZm9sbG93aW5nIGJhY2tzbGFzaCBlc2NhcGUgc2VxdWVuY2VzLlxuICpcbiAqIGF0dGFja2xhYjogVGhlIHBvbGl0ZSB3YXkgdG8gZG8gdGhpcyBpcyB3aXRoIHRoZSBuZXcgZXNjYXBlQ2hhcmFjdGVycygpIGZ1bmN0aW9uOlxuICpcbiAqICAgIHRleHQgPSBlc2NhcGVDaGFyYWN0ZXJzKHRleHQsXCJcXFxcXCIsdHJ1ZSk7XG4gKiAgICB0ZXh0ID0gZXNjYXBlQ2hhcmFjdGVycyh0ZXh0LFwiYCpfe31bXSgpPiMrLS4hXCIsdHJ1ZSk7XG4gKlxuICogLi4uYnV0IHdlJ3JlIHNpZGVzdGVwcGluZyBpdHMgdXNlIG9mIHRoZSAoc2xvdykgUmVnRXhwIGNvbnN0cnVjdG9yXG4gKiBhcyBhbiBvcHRpbWl6YXRpb24gZm9yIEZpcmVmb3guICBUaGlzIGZ1bmN0aW9uIGdldHMgY2FsbGVkIGEgTE9ULlxuICovXG5zaG93ZG93bi5zdWJQYXJzZXIoJ2VuY29kZUJhY2tzbGFzaEVzY2FwZXMnLCBmdW5jdGlvbiAodGV4dCkge1xuICAndXNlIHN0cmljdCc7XG4gIHRleHQgPSB0ZXh0LnJlcGxhY2UoL1xcXFwoXFxcXCkvZywgc2hvd2Rvd24uaGVscGVyLmVzY2FwZUNoYXJhY3RlcnNDYWxsYmFjayk7XG4gIHRleHQgPSB0ZXh0LnJlcGxhY2UoL1xcXFwoW2AqX3t9XFxbXFxdKCk+IystLiFdKS9nLCBzaG93ZG93bi5oZWxwZXIuZXNjYXBlQ2hhcmFjdGVyc0NhbGxiYWNrKTtcbiAgcmV0dXJuIHRleHQ7XG59KTtcblxuLyoqXG4gKiBFbmNvZGUvZXNjYXBlIGNlcnRhaW4gY2hhcmFjdGVycyBpbnNpZGUgTWFya2Rvd24gY29kZSBydW5zLlxuICogVGhlIHBvaW50IGlzIHRoYXQgaW4gY29kZSwgdGhlc2UgY2hhcmFjdGVycyBhcmUgbGl0ZXJhbHMsXG4gKiBhbmQgbG9zZSB0aGVpciBzcGVjaWFsIE1hcmtkb3duIG1lYW5pbmdzLlxuICovXG5zaG93ZG93bi5zdWJQYXJzZXIoJ2VuY29kZUNvZGUnLCBmdW5jdGlvbiAodGV4dCkge1xuICAndXNlIHN0cmljdCc7XG5cbiAgLy8gRW5jb2RlIGFsbCBhbXBlcnNhbmRzOyBIVE1MIGVudGl0aWVzIGFyZSBub3RcbiAgLy8gZW50aXRpZXMgd2l0aGluIGEgTWFya2Rvd24gY29kZSBzcGFuLlxuICB0ZXh0ID0gdGV4dC5yZXBsYWNlKC8mL2csICcmYW1wOycpO1xuXG4gIC8vIERvIHRoZSBhbmdsZSBicmFja2V0IHNvbmcgYW5kIGRhbmNlOlxuICB0ZXh0ID0gdGV4dC5yZXBsYWNlKC88L2csICcmbHQ7Jyk7XG4gIHRleHQgPSB0ZXh0LnJlcGxhY2UoLz4vZywgJyZndDsnKTtcblxuICAvLyBOb3csIGVzY2FwZSBjaGFyYWN0ZXJzIHRoYXQgYXJlIG1hZ2ljIGluIE1hcmtkb3duOlxuICB0ZXh0ID0gc2hvd2Rvd24uaGVscGVyLmVzY2FwZUNoYXJhY3RlcnModGV4dCwgJypfe31bXVxcXFwnLCBmYWxzZSk7XG5cbiAgLy8gamogdGhlIGxpbmUgYWJvdmUgYnJlYWtzIHRoaXM6XG4gIC8vLS0tXG4gIC8vKiBJdGVtXG4gIC8vICAgMS4gU3ViaXRlbVxuICAvLyAgICAgICAgICAgIHNwZWNpYWwgY2hhcjogKlxuICAvLyAtLS1cblxuICByZXR1cm4gdGV4dDtcbn0pO1xuXG4vKipcbiAqICBJbnB1dDogYW4gZW1haWwgYWRkcmVzcywgZS5nLiBcImZvb0BleGFtcGxlLmNvbVwiXG4gKlxuICogIE91dHB1dDogdGhlIGVtYWlsIGFkZHJlc3MgYXMgYSBtYWlsdG8gbGluaywgd2l0aCBlYWNoIGNoYXJhY3RlclxuICogICAgb2YgdGhlIGFkZHJlc3MgZW5jb2RlZCBhcyBlaXRoZXIgYSBkZWNpbWFsIG9yIGhleCBlbnRpdHksIGluXG4gKiAgICB0aGUgaG9wZXMgb2YgZm9pbGluZyBtb3N0IGFkZHJlc3MgaGFydmVzdGluZyBzcGFtIGJvdHMuIEUuZy46XG4gKlxuICogICAgPGEgaHJlZj1cIiYjeDZEOyYjOTc7JiMxMDU7JiMxMDg7JiN4NzQ7JiMxMTE7OiYjMTAyOyYjMTExOyYjMTExOyYjNjQ7JiMxMDE7XG4gKiAgICAgICB4JiN4NjE7JiMxMDk7JiN4NzA7JiMxMDg7JiN4NjU7JiN4MkU7JiM5OTsmIzExMTsmIzEwOTtcIj4mIzEwMjsmIzExMTsmIzExMTtcbiAqICAgICAgICYjNjQ7JiMxMDE7eCYjeDYxOyYjMTA5OyYjeDcwOyYjMTA4OyYjeDY1OyYjeDJFOyYjOTk7JiMxMTE7JiMxMDk7PC9hPlxuICpcbiAqICBCYXNlZCBvbiBhIGZpbHRlciBieSBNYXR0aGV3IFdpY2tsaW5lLCBwb3N0ZWQgdG8gdGhlIEJCRWRpdC1UYWxrXG4gKiAgbWFpbGluZyBsaXN0OiA8aHR0cDovL3Rpbnl1cmwuY29tL3l1N3VlPlxuICpcbiAqL1xuc2hvd2Rvd24uc3ViUGFyc2VyKCdlbmNvZGVFbWFpbEFkZHJlc3MnLCBmdW5jdGlvbiAoYWRkcikge1xuICAndXNlIHN0cmljdCc7XG5cbiAgdmFyIGVuY29kZSA9IFtcbiAgICBmdW5jdGlvbiAoY2gpIHtcbiAgICAgIHJldHVybiAnJiMnICsgY2guY2hhckNvZGVBdCgwKSArICc7JztcbiAgICB9LFxuICAgIGZ1bmN0aW9uIChjaCkge1xuICAgICAgcmV0dXJuICcmI3gnICsgY2guY2hhckNvZGVBdCgwKS50b1N0cmluZygxNikgKyAnOyc7XG4gICAgfSxcbiAgICBmdW5jdGlvbiAoY2gpIHtcbiAgICAgIHJldHVybiBjaDtcbiAgICB9XG4gIF07XG5cbiAgYWRkciA9ICdtYWlsdG86JyArIGFkZHI7XG5cbiAgYWRkciA9IGFkZHIucmVwbGFjZSgvLi9nLCBmdW5jdGlvbiAoY2gpIHtcbiAgICBpZiAoY2ggPT09ICdAJykge1xuICAgICAgLy8gdGhpcyAqbXVzdCogYmUgZW5jb2RlZC4gSSBpbnNpc3QuXG4gICAgICBjaCA9IGVuY29kZVtNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiAyKV0oY2gpO1xuICAgIH0gZWxzZSBpZiAoY2ggIT09ICc6Jykge1xuICAgICAgLy8gbGVhdmUgJzonIGFsb25lICh0byBzcG90IG1haWx0bzogbGF0ZXIpXG4gICAgICB2YXIgciA9IE1hdGgucmFuZG9tKCk7XG4gICAgICAvLyByb3VnaGx5IDEwJSByYXcsIDQ1JSBoZXgsIDQ1JSBkZWNcbiAgICAgIGNoID0gKFxuICAgICAgICByID4gMC45ID8gZW5jb2RlWzJdKGNoKSA6IHIgPiAwLjQ1ID8gZW5jb2RlWzFdKGNoKSA6IGVuY29kZVswXShjaClcbiAgICAgICk7XG4gICAgfVxuICAgIHJldHVybiBjaDtcbiAgfSk7XG5cbiAgYWRkciA9ICc8YSBocmVmPVwiJyArIGFkZHIgKyAnXCI+JyArIGFkZHIgKyAnPC9hPic7XG4gIGFkZHIgPSBhZGRyLnJlcGxhY2UoL1wiPi4rOi9nLCAnXCI+Jyk7IC8vIHN0cmlwIHRoZSBtYWlsdG86IGZyb20gdGhlIHZpc2libGUgcGFydFxuXG4gIHJldHVybiBhZGRyO1xufSk7XG5cbi8qKlxuICogV2l0aGluIHRhZ3MgLS0gbWVhbmluZyBiZXR3ZWVuIDwgYW5kID4gLS0gZW5jb2RlIFtcXCBgICogX10gc28gdGhleVxuICogZG9uJ3QgY29uZmxpY3Qgd2l0aCB0aGVpciB1c2UgaW4gTWFya2Rvd24gZm9yIGNvZGUsIGl0YWxpY3MgYW5kIHN0cm9uZy5cbiAqL1xuc2hvd2Rvd24uc3ViUGFyc2VyKCdlc2NhcGVTcGVjaWFsQ2hhcnNXaXRoaW5UYWdBdHRyaWJ1dGVzJywgZnVuY3Rpb24gKHRleHQpIHtcbiAgJ3VzZSBzdHJpY3QnO1xuXG4gIC8vIEJ1aWxkIGEgcmVnZXggdG8gZmluZCBIVE1MIHRhZ3MgYW5kIGNvbW1lbnRzLiAgU2VlIEZyaWVkbCdzXG4gIC8vIFwiTWFzdGVyaW5nIFJlZ3VsYXIgRXhwcmVzc2lvbnNcIiwgMm5kIEVkLiwgcHAuIDIwMC0yMDEuXG4gIHZhciByZWdleCA9IC8oPFthLXpcXC8hJF0oXCJbXlwiXSpcInwnW14nXSonfFteJ1wiPl0pKj58PCEoLS0uKj8tLVxccyopKz4pL2dpO1xuXG4gIHRleHQgPSB0ZXh0LnJlcGxhY2UocmVnZXgsIGZ1bmN0aW9uICh3aG9sZU1hdGNoKSB7XG4gICAgdmFyIHRhZyA9IHdob2xlTWF0Y2gucmVwbGFjZSgvKC4pPFxcLz9jb2RlPig/PS4pL2csICckMWAnKTtcbiAgICB0YWcgPSBzaG93ZG93bi5oZWxwZXIuZXNjYXBlQ2hhcmFjdGVycyh0YWcsICdcXFxcYCpfJywgZmFsc2UpO1xuICAgIHJldHVybiB0YWc7XG4gIH0pO1xuXG4gIHJldHVybiB0ZXh0O1xufSk7XG5cbi8qKlxuICogSGFuZGxlIGdpdGh1YiBjb2RlYmxvY2tzIHByaW9yIHRvIHJ1bm5pbmcgSGFzaEhUTUwgc28gdGhhdFxuICogSFRNTCBjb250YWluZWQgd2l0aGluIHRoZSBjb2RlYmxvY2sgZ2V0cyBlc2NhcGVkIHByb3Blcmx5XG4gKiBFeGFtcGxlOlxuICogYGBgcnVieVxuICogICAgIGRlZiBoZWxsb193b3JsZCh4KVxuICogICAgICAgcHV0cyBcIkhlbGxvLCAje3h9XCJcbiAqICAgICBlbmRcbiAqIGBgYFxuICovXG5zaG93ZG93bi5zdWJQYXJzZXIoJ2dpdGh1YkNvZGVCbG9ja3MnLCBmdW5jdGlvbiAodGV4dCwgb3B0aW9ucywgZ2xvYmFscykge1xuICAndXNlIHN0cmljdCc7XG5cbiAgdGV4dCArPSAnfjAnO1xuXG4gIHRleHQgPSB0ZXh0LnJlcGxhY2UoLyg/Ol58XFxuKWBgYCguKilcXG4oW1xcc1xcU10qPylcXG5gYGAvZywgZnVuY3Rpb24gKHdob2xlTWF0Y2gsIG0xLCBtMikge1xuICAgIHZhciBsYW5ndWFnZSA9IG0xLFxuICAgICAgICBjb2RlYmxvY2sgPSBtMixcbiAgICAgICAgZW5kID0gJ1xcbic7XG5cbiAgICBpZiAob3B0aW9ucy5vbWl0RXh0cmFXTEluQ29kZUJsb2Nrcykge1xuICAgICAgZW5kID0gJyc7XG4gICAgfVxuXG4gICAgY29kZWJsb2NrID0gc2hvd2Rvd24uc3ViUGFyc2VyKCdlbmNvZGVDb2RlJykoY29kZWJsb2NrKTtcbiAgICBjb2RlYmxvY2sgPSBzaG93ZG93bi5zdWJQYXJzZXIoJ2RldGFiJykoY29kZWJsb2NrKTtcbiAgICBjb2RlYmxvY2sgPSBjb2RlYmxvY2sucmVwbGFjZSgvXlxcbisvZywgJycpOyAvLyB0cmltIGxlYWRpbmcgbmV3bGluZXNcbiAgICBjb2RlYmxvY2sgPSBjb2RlYmxvY2sucmVwbGFjZSgvXFxuKyQvZywgJycpOyAvLyB0cmltIHRyYWlsaW5nIHdoaXRlc3BhY2VcblxuICAgIGNvZGVibG9jayA9ICc8cHJlPjxjb2RlJyArIChsYW5ndWFnZSA/ICcgY2xhc3M9XCInICsgbGFuZ3VhZ2UgKyAnXCInIDogJycpICsgJz4nICsgY29kZWJsb2NrICsgZW5kICsgJzwvY29kZT48L3ByZT4nO1xuXG4gICAgcmV0dXJuIHNob3dkb3duLnN1YlBhcnNlcignaGFzaEJsb2NrJykoY29kZWJsb2NrLCBvcHRpb25zLCBnbG9iYWxzKTtcbiAgfSk7XG5cbiAgLy8gYXR0YWNrbGFiOiBzdHJpcCBzZW50aW5lbFxuICB0ZXh0ID0gdGV4dC5yZXBsYWNlKC9+MC8sICcnKTtcblxuICByZXR1cm4gdGV4dDtcblxufSk7XG5cbnNob3dkb3duLnN1YlBhcnNlcignaGFzaEJsb2NrJywgZnVuY3Rpb24gKHRleHQsIG9wdGlvbnMsIGdsb2JhbHMpIHtcbiAgJ3VzZSBzdHJpY3QnO1xuICB0ZXh0ID0gdGV4dC5yZXBsYWNlKC8oXlxcbit8XFxuKyQpL2csICcnKTtcbiAgcmV0dXJuICdcXG5cXG5+SycgKyAoZ2xvYmFscy5nSHRtbEJsb2Nrcy5wdXNoKHRleHQpIC0gMSkgKyAnS1xcblxcbic7XG59KTtcblxuc2hvd2Rvd24uc3ViUGFyc2VyKCdoYXNoRWxlbWVudCcsIGZ1bmN0aW9uICh0ZXh0LCBvcHRpb25zLCBnbG9iYWxzKSB7XG4gICd1c2Ugc3RyaWN0JztcblxuICByZXR1cm4gZnVuY3Rpb24gKHdob2xlTWF0Y2gsIG0xKSB7XG4gICAgdmFyIGJsb2NrVGV4dCA9IG0xO1xuXG4gICAgLy8gVW5kbyBkb3VibGUgbGluZXNcbiAgICBibG9ja1RleHQgPSBibG9ja1RleHQucmVwbGFjZSgvXFxuXFxuL2csICdcXG4nKTtcbiAgICBibG9ja1RleHQgPSBibG9ja1RleHQucmVwbGFjZSgvXlxcbi8sICcnKTtcblxuICAgIC8vIHN0cmlwIHRyYWlsaW5nIGJsYW5rIGxpbmVzXG4gICAgYmxvY2tUZXh0ID0gYmxvY2tUZXh0LnJlcGxhY2UoL1xcbiskL2csICcnKTtcblxuICAgIC8vIFJlcGxhY2UgdGhlIGVsZW1lbnQgdGV4dCB3aXRoIGEgbWFya2VyIChcIn5LeEtcIiB3aGVyZSB4IGlzIGl0cyBrZXkpXG4gICAgYmxvY2tUZXh0ID0gJ1xcblxcbn5LJyArIChnbG9iYWxzLmdIdG1sQmxvY2tzLnB1c2goYmxvY2tUZXh0KSAtIDEpICsgJ0tcXG5cXG4nO1xuXG4gICAgcmV0dXJuIGJsb2NrVGV4dDtcbiAgfTtcbn0pO1xuXG5zaG93ZG93bi5zdWJQYXJzZXIoJ2hhc2hIVE1MQmxvY2tzJywgZnVuY3Rpb24gKHRleHQsIG9wdGlvbnMsIGdsb2JhbHMpIHtcbiAgJ3VzZSBzdHJpY3QnO1xuXG4gIC8vIGF0dGFja2xhYjogRG91YmxlIHVwIGJsYW5rIGxpbmVzIHRvIHJlZHVjZSBsb29rYXJvdW5kXG4gIHRleHQgPSB0ZXh0LnJlcGxhY2UoL1xcbi9nLCAnXFxuXFxuJyk7XG5cbiAgLy8gSGFzaGlmeSBIVE1MIGJsb2NrczpcbiAgLy8gV2Ugb25seSB3YW50IHRvIGRvIHRoaXMgZm9yIGJsb2NrLWxldmVsIEhUTUwgdGFncywgc3VjaCBhcyBoZWFkZXJzLFxuICAvLyBsaXN0cywgYW5kIHRhYmxlcy4gVGhhdCdzIGJlY2F1c2Ugd2Ugc3RpbGwgd2FudCB0byB3cmFwIDxwPnMgYXJvdW5kXG4gIC8vIFwicGFyYWdyYXBoc1wiIHRoYXQgYXJlIHdyYXBwZWQgaW4gbm9uLWJsb2NrLWxldmVsIHRhZ3MsIHN1Y2ggYXMgYW5jaG9ycyxcbiAgLy8gcGhyYXNlIGVtcGhhc2lzLCBhbmQgc3BhbnMuIFRoZSBsaXN0IG9mIHRhZ3Mgd2UncmUgbG9va2luZyBmb3IgaXNcbiAgLy8gaGFyZC1jb2RlZDpcbiAgLy92YXIgYmxvY2tfdGFnc19hID1cbiAgLy8gJ3B8ZGl2fGhbMS02XXxibG9ja3F1b3RlfHByZXx0YWJsZXxkbHxvbHx1bHxzY3JpcHR8bm9zY3JpcHR8Zm9ybXxmaWVsZHNldHxpZnJhbWV8bWF0aHxpbnN8ZGVsfHN0eWxlfHNlY3Rpb258aGVhZGVyfGZvb3RlcnxuYXZ8YXJ0aWNsZXxhc2lkZSc7XG4gIC8vIHZhciBibG9ja190YWdzX2IgPVxuICAvLyAncHxkaXZ8aFsxLTZdfGJsb2NrcXVvdGV8cHJlfHRhYmxlfGRsfG9sfHVsfHNjcmlwdHxub3NjcmlwdHxmb3JtfGZpZWxkc2V0fGlmcmFtZXxtYXRofHN0eWxlfHNlY3Rpb258aGVhZGVyfGZvb3RlcnxuYXZ8YXJ0aWNsZXxhc2lkZSc7XG5cbiAgLy8gRmlyc3QsIGxvb2sgZm9yIG5lc3RlZCBibG9ja3MsIGUuZy46XG4gIC8vICAgPGRpdj5cbiAgLy8gICAgIDxkaXY+XG4gIC8vICAgICB0YWdzIGZvciBpbm5lciBibG9jayBtdXN0IGJlIGluZGVudGVkLlxuICAvLyAgICAgPC9kaXY+XG4gIC8vICAgPC9kaXY+XG4gIC8vXG4gIC8vIFRoZSBvdXRlcm1vc3QgdGFncyBtdXN0IHN0YXJ0IGF0IHRoZSBsZWZ0IG1hcmdpbiBmb3IgdGhpcyB0byBtYXRjaCwgYW5kXG4gIC8vIHRoZSBpbm5lciBuZXN0ZWQgZGl2cyBtdXN0IGJlIGluZGVudGVkLlxuICAvLyBXZSBuZWVkIHRvIGRvIHRoaXMgYmVmb3JlIHRoZSBuZXh0LCBtb3JlIGxpYmVyYWwgbWF0Y2gsIGJlY2F1c2UgdGhlIG5leHRcbiAgLy8gbWF0Y2ggd2lsbCBzdGFydCBhdCB0aGUgZmlyc3QgYDxkaXY+YCBhbmQgc3RvcCBhdCB0aGUgZmlyc3QgYDwvZGl2PmAuXG5cbiAgLy8gYXR0YWNrbGFiOiBUaGlzIHJlZ2V4IGNhbiBiZSBleHBlbnNpdmUgd2hlbiBpdCBmYWlscy5cbiAgLypcbiAgIHZhciB0ZXh0ID0gdGV4dC5yZXBsYWNlKC9cbiAgIChcdFx0XHRcdFx0XHQvLyBzYXZlIGluICQxXG4gICBeXHRcdFx0XHRcdC8vIHN0YXJ0IG9mIGxpbmUgICh3aXRoIC9tKVxuICAgPCgkYmxvY2tfdGFnc19hKVx0Ly8gc3RhcnQgdGFnID0gJDJcbiAgIFxcYlx0XHRcdFx0XHQvLyB3b3JkIGJyZWFrXG4gICAvLyBhdHRhY2tsYWI6IGhhY2sgYXJvdW5kIGtodG1sL3BjcmUgYnVnLi4uXG4gICBbXlxccl0qP1xcblx0XHRcdC8vIGFueSBudW1iZXIgb2YgbGluZXMsIG1pbmltYWxseSBtYXRjaGluZ1xuICAgPC9cXDI+XHRcdFx0XHQvLyB0aGUgbWF0Y2hpbmcgZW5kIHRhZ1xuICAgWyBcXHRdKlx0XHRcdFx0Ly8gdHJhaWxpbmcgc3BhY2VzL3RhYnNcbiAgICg/PVxcbispXHRcdFx0XHQvLyBmb2xsb3dlZCBieSBhIG5ld2xpbmVcbiAgIClcdFx0XHRcdFx0XHQvLyBhdHRhY2tsYWI6IHRoZXJlIGFyZSBzZW50aW5lbCBuZXdsaW5lcyBhdCBlbmQgb2YgZG9jdW1lbnRcbiAgIC9nbSxmdW5jdGlvbigpey4uLn19O1xuICAgKi9cbiAgdGV4dCA9IHRleHQucmVwbGFjZSgvXig8KHB8ZGl2fGhbMS02XXxibG9ja3F1b3RlfHByZXx0YWJsZXxkbHxvbHx1bHxzY3JpcHR8bm9zY3JpcHR8Zm9ybXxmaWVsZHNldHxpZnJhbWV8bWF0aHxpbnN8ZGVsKVxcYlteXFxyXSo/XFxuPFxcL1xcMj5bIFxcdF0qKD89XFxuKykpL2dtLFxuICAgICAgICAgICAgICAgICAgICAgIHNob3dkb3duLnN1YlBhcnNlcignaGFzaEVsZW1lbnQnKSh0ZXh0LCBvcHRpb25zLCBnbG9iYWxzKSk7XG5cbiAgLy9cbiAgLy8gTm93IG1hdGNoIG1vcmUgbGliZXJhbGx5LCBzaW1wbHkgZnJvbSBgXFxuPHRhZz5gIHRvIGA8L3RhZz5cXG5gXG4gIC8vXG5cbiAgLypcbiAgIHZhciB0ZXh0ID0gdGV4dC5yZXBsYWNlKC9cbiAgIChcdFx0XHRcdFx0XHQvLyBzYXZlIGluICQxXG4gICBeXHRcdFx0XHRcdC8vIHN0YXJ0IG9mIGxpbmUgICh3aXRoIC9tKVxuICAgPCgkYmxvY2tfdGFnc19iKVx0Ly8gc3RhcnQgdGFnID0gJDJcbiAgIFxcYlx0XHRcdFx0XHQvLyB3b3JkIGJyZWFrXG4gICAvLyBhdHRhY2tsYWI6IGhhY2sgYXJvdW5kIGtodG1sL3BjcmUgYnVnLi4uXG4gICBbXlxccl0qP1x0XHRcdFx0Ly8gYW55IG51bWJlciBvZiBsaW5lcywgbWluaW1hbGx5IG1hdGNoaW5nXG4gICA8L1xcMj5cdFx0XHRcdC8vIHRoZSBtYXRjaGluZyBlbmQgdGFnXG4gICBbIFxcdF0qXHRcdFx0XHQvLyB0cmFpbGluZyBzcGFjZXMvdGFic1xuICAgKD89XFxuKylcdFx0XHRcdC8vIGZvbGxvd2VkIGJ5IGEgbmV3bGluZVxuICAgKVx0XHRcdFx0XHRcdC8vIGF0dGFja2xhYjogdGhlcmUgYXJlIHNlbnRpbmVsIG5ld2xpbmVzIGF0IGVuZCBvZiBkb2N1bWVudFxuICAgL2dtLGZ1bmN0aW9uKCl7Li4ufX07XG4gICAqL1xuICB0ZXh0ID0gdGV4dC5yZXBsYWNlKC9eKDwocHxkaXZ8aFsxLTZdfGJsb2NrcXVvdGV8cHJlfHRhYmxlfGRsfG9sfHVsfHNjcmlwdHxub3NjcmlwdHxmb3JtfGZpZWxkc2V0fGlmcmFtZXxtYXRofHN0eWxlfHNlY3Rpb258aGVhZGVyfGZvb3RlcnxuYXZ8YXJ0aWNsZXxhc2lkZXxhZGRyZXNzfGF1ZGlvfGNhbnZhc3xmaWd1cmV8aGdyb3VwfG91dHB1dHx2aWRlbylcXGJbXlxccl0qPzxcXC9cXDI+WyBcXHRdKig/PVxcbispXFxuKS9nbSxcbiAgICAgICAgICAgICAgICAgICAgICBzaG93ZG93bi5zdWJQYXJzZXIoJ2hhc2hFbGVtZW50JykodGV4dCwgb3B0aW9ucywgZ2xvYmFscykpO1xuXG4gIC8vIFNwZWNpYWwgY2FzZSBqdXN0IGZvciA8aHIgLz4uIEl0IHdhcyBlYXNpZXIgdG8gbWFrZSBhIHNwZWNpYWwgY2FzZSB0aGFuXG4gIC8vIHRvIG1ha2UgdGhlIG90aGVyIHJlZ2V4IG1vcmUgY29tcGxpY2F0ZWQuXG5cbiAgLypcbiAgIHRleHQgPSB0ZXh0LnJlcGxhY2UoL1xuICAgKFx0XHRcdFx0XHRcdC8vIHNhdmUgaW4gJDFcbiAgIFxcblxcblx0XHRcdFx0Ly8gU3RhcnRpbmcgYWZ0ZXIgYSBibGFuayBsaW5lXG4gICBbIF17MCwzfVxuICAgKDwoaHIpXHRcdFx0XHQvLyBzdGFydCB0YWcgPSAkMlxuICAgXFxiXHRcdFx0XHRcdC8vIHdvcmQgYnJlYWtcbiAgIChbXjw+XSkqP1x0XHRcdC8vXG4gICBcXC8/PilcdFx0XHRcdC8vIHRoZSBtYXRjaGluZyBlbmQgdGFnXG4gICBbIFxcdF0qXG4gICAoPz1cXG57Mix9KVx0XHRcdC8vIGZvbGxvd2VkIGJ5IGEgYmxhbmsgbGluZVxuICAgKVxuICAgL2csc2hvd2Rvd24uc3ViUGFyc2VyKCdoYXNoRWxlbWVudCcpKHRleHQsIG9wdGlvbnMsIGdsb2JhbHMpKTtcbiAgICovXG4gIHRleHQgPSB0ZXh0LnJlcGxhY2UoLyhcXG5bIF17MCwzfSg8KGhyKVxcYihbXjw+XSkqP1xcLz8+KVsgXFx0XSooPz1cXG57Mix9KSkvZyxcbiAgICAgICAgICAgICAgICAgICAgICBzaG93ZG93bi5zdWJQYXJzZXIoJ2hhc2hFbGVtZW50JykodGV4dCwgb3B0aW9ucywgZ2xvYmFscykpO1xuXG4gIC8vIFNwZWNpYWwgY2FzZSBmb3Igc3RhbmRhbG9uZSBIVE1MIGNvbW1lbnRzOlxuXG4gIC8qXG4gICB0ZXh0ID0gdGV4dC5yZXBsYWNlKC9cbiAgIChcdFx0XHRcdFx0XHQvLyBzYXZlIGluICQxXG4gICBcXG5cXG5cdFx0XHRcdC8vIFN0YXJ0aW5nIGFmdGVyIGEgYmxhbmsgbGluZVxuICAgWyBdezAsM31cdFx0XHQvLyBhdHRhY2tsYWI6IGdfdGFiX3dpZHRoIC0gMVxuICAgPCFcbiAgICgtLVteXFxyXSo/LS1cXHMqKStcbiAgID5cbiAgIFsgXFx0XSpcbiAgICg/PVxcbnsyLH0pXHRcdFx0Ly8gZm9sbG93ZWQgYnkgYSBibGFuayBsaW5lXG4gICApXG4gICAvZyxzaG93ZG93bi5zdWJQYXJzZXIoJ2hhc2hFbGVtZW50JykodGV4dCwgb3B0aW9ucywgZ2xvYmFscykpO1xuICAgKi9cbiAgdGV4dCA9IHRleHQucmVwbGFjZSgvKFxcblxcblsgXXswLDN9PCEoLS1bXlxccl0qPy0tXFxzKikrPlsgXFx0XSooPz1cXG57Mix9KSkvZyxcbiAgICAgICAgICAgICAgICAgICAgICBzaG93ZG93bi5zdWJQYXJzZXIoJ2hhc2hFbGVtZW50JykodGV4dCwgb3B0aW9ucywgZ2xvYmFscykpO1xuXG4gIC8vIFBIUCBhbmQgQVNQLXN0eWxlIHByb2Nlc3NvciBpbnN0cnVjdGlvbnMgKDw/Li4uPz4gYW5kIDwlLi4uJT4pXG5cbiAgLypcbiAgIHRleHQgPSB0ZXh0LnJlcGxhY2UoL1xuICAgKD86XG4gICBcXG5cXG5cdFx0XHRcdC8vIFN0YXJ0aW5nIGFmdGVyIGEgYmxhbmsgbGluZVxuICAgKVxuICAgKFx0XHRcdFx0XHRcdC8vIHNhdmUgaW4gJDFcbiAgIFsgXXswLDN9XHRcdFx0Ly8gYXR0YWNrbGFiOiBnX3RhYl93aWR0aCAtIDFcbiAgICg/OlxuICAgPChbPyVdKVx0XHRcdC8vICQyXG4gICBbXlxccl0qP1xuICAgXFwyPlxuICAgKVxuICAgWyBcXHRdKlxuICAgKD89XFxuezIsfSlcdFx0XHQvLyBmb2xsb3dlZCBieSBhIGJsYW5rIGxpbmVcbiAgIClcbiAgIC9nLHNob3dkb3duLnN1YlBhcnNlcignaGFzaEVsZW1lbnQnKSh0ZXh0LCBvcHRpb25zLCBnbG9iYWxzKSk7XG4gICAqL1xuICB0ZXh0ID0gdGV4dC5yZXBsYWNlKC8oPzpcXG5cXG4pKFsgXXswLDN9KD86PChbPyVdKVteXFxyXSo/XFwyPilbIFxcdF0qKD89XFxuezIsfSkpL2csXG4gICAgICAgICAgICAgICAgICAgICAgc2hvd2Rvd24uc3ViUGFyc2VyKCdoYXNoRWxlbWVudCcpKHRleHQsIG9wdGlvbnMsIGdsb2JhbHMpKTtcblxuICAvLyBhdHRhY2tsYWI6IFVuZG8gZG91YmxlIGxpbmVzIChzZWUgY29tbWVudCBhdCB0b3Agb2YgdGhpcyBmdW5jdGlvbilcbiAgdGV4dCA9IHRleHQucmVwbGFjZSgvXFxuXFxuL2csICdcXG4nKTtcbiAgcmV0dXJuIHRleHQ7XG5cbn0pO1xuXG5zaG93ZG93bi5zdWJQYXJzZXIoJ2hlYWRlcnMnLCBmdW5jdGlvbiAodGV4dCwgb3B0aW9ucywgZ2xvYmFscykge1xuICAndXNlIHN0cmljdCc7XG5cbiAgdmFyIHByZWZpeEhlYWRlciA9IG9wdGlvbnMucHJlZml4SGVhZGVySWQ7XG5cbiAgLy8gU2V0IHRleHQtc3R5bGUgaGVhZGVyczpcbiAgLy9cdEhlYWRlciAxXG4gIC8vXHQ9PT09PT09PVxuICAvL1xuICAvL1x0SGVhZGVyIDJcbiAgLy9cdC0tLS0tLS0tXG4gIC8vXG4gIHRleHQgPSB0ZXh0LnJlcGxhY2UoL14oLispWyBcXHRdKlxcbj0rWyBcXHRdKlxcbisvZ20sIGZ1bmN0aW9uICh3aG9sZU1hdGNoLCBtMSkge1xuXG4gICAgdmFyIHNwYW5HYW11dCA9IHNob3dkb3duLnN1YlBhcnNlcignc3BhbkdhbXV0JykobTEsIG9wdGlvbnMsIGdsb2JhbHMpLFxuICAgICAgICBoSUQgPSAob3B0aW9ucy5ub0hlYWRlcklkKSA/ICcnIDogJyBpZD1cIicgKyBoZWFkZXJJZChtMSkgKyAnXCInLFxuICAgICAgICBoTGV2ZWwgPSBwYXJzZUludChvcHRpb25zLmhlYWRlckxldmVsU3RhcnQpLFxuICAgICAgICBoYXNoQmxvY2sgPSAnPGgnICsgaExldmVsICsgaElEICsgJz4nICsgc3BhbkdhbXV0ICsgJzwvaCcgKyBoTGV2ZWwgKyAnPic7XG4gICAgcmV0dXJuIHNob3dkb3duLnN1YlBhcnNlcignaGFzaEJsb2NrJykoaGFzaEJsb2NrLCBvcHRpb25zLCBnbG9iYWxzKTtcbiAgfSk7XG5cbiAgdGV4dCA9IHRleHQucmVwbGFjZSgvXiguKylbIFxcdF0qXFxuLStbIFxcdF0qXFxuKy9nbSwgZnVuY3Rpb24gKG1hdGNoRm91bmQsIG0xKSB7XG4gICAgdmFyIHNwYW5HYW11dCA9IHNob3dkb3duLnN1YlBhcnNlcignc3BhbkdhbXV0JykobTEsIG9wdGlvbnMsIGdsb2JhbHMpLFxuICAgICAgICBoSUQgPSAob3B0aW9ucy5ub0hlYWRlcklkKSA/ICcnIDogJyBpZD1cIicgKyBoZWFkZXJJZChtMSkgKyAnXCInLFxuICAgICAgICBoTGV2ZWwgPSBwYXJzZUludChvcHRpb25zLmhlYWRlckxldmVsU3RhcnQpICsgMSxcbiAgICAgIGhhc2hCbG9jayA9ICc8aCcgKyBoTGV2ZWwgKyBoSUQgKyAnPicgKyBzcGFuR2FtdXQgKyAnPC9oJyArIGhMZXZlbCArICc+JztcbiAgICByZXR1cm4gc2hvd2Rvd24uc3ViUGFyc2VyKCdoYXNoQmxvY2snKShoYXNoQmxvY2ssIG9wdGlvbnMsIGdsb2JhbHMpO1xuICB9KTtcblxuICAvLyBhdHgtc3R5bGUgaGVhZGVyczpcbiAgLy8gICMgSGVhZGVyIDFcbiAgLy8gICMjIEhlYWRlciAyXG4gIC8vICAjIyBIZWFkZXIgMiB3aXRoIGNsb3NpbmcgaGFzaGVzICMjXG4gIC8vICAuLi5cbiAgLy8gICMjIyMjIyBIZWFkZXIgNlxuICAvL1xuXG4gIC8qXG4gICB0ZXh0ID0gdGV4dC5yZXBsYWNlKC9cbiAgIF4oXFwjezEsNn0pXHRcdFx0XHQvLyAkMSA9IHN0cmluZyBvZiAjJ3NcbiAgIFsgXFx0XSpcbiAgICguKz8pXHRcdFx0XHRcdC8vICQyID0gSGVhZGVyIHRleHRcbiAgIFsgXFx0XSpcbiAgIFxcIypcdFx0XHRcdFx0XHQvLyBvcHRpb25hbCBjbG9zaW5nICMncyAobm90IGNvdW50ZWQpXG4gICBcXG4rXG4gICAvZ20sIGZ1bmN0aW9uKCkgey4uLn0pO1xuICAgKi9cblxuICB0ZXh0ID0gdGV4dC5yZXBsYWNlKC9eKCN7MSw2fSlbIFxcdF0qKC4rPylbIFxcdF0qIypcXG4rL2dtLCBmdW5jdGlvbiAod2hvbGVNYXRjaCwgbTEsIG0yKSB7XG4gICAgdmFyIHNwYW4gPSBzaG93ZG93bi5zdWJQYXJzZXIoJ3NwYW5HYW11dCcpKG0yLCBvcHRpb25zLCBnbG9iYWxzKSxcbiAgICAgICAgaElEID0gKG9wdGlvbnMubm9IZWFkZXJJZCkgPyAnJyA6ICcgaWQ9XCInICsgaGVhZGVySWQobTIpICsgJ1wiJyxcbiAgICAgICAgaExldmVsID0gcGFyc2VJbnQob3B0aW9ucy5oZWFkZXJMZXZlbFN0YXJ0KSAtIDEgKyBtMS5sZW5ndGgsXG4gICAgICAgIGhlYWRlciA9ICc8aCcgKyBoTGV2ZWwgKyBoSUQgKyAnPicgKyBzcGFuICsgJzwvaCcgKyBoTGV2ZWwgKyAnPic7XG5cbiAgICByZXR1cm4gc2hvd2Rvd24uc3ViUGFyc2VyKCdoYXNoQmxvY2snKShoZWFkZXIsIG9wdGlvbnMsIGdsb2JhbHMpO1xuICB9KTtcblxuICBmdW5jdGlvbiBoZWFkZXJJZChtKSB7XG4gICAgdmFyIHRpdGxlLCBlc2NhcGVkSWQgPSBtLnJlcGxhY2UoL1teXFx3XS9nLCAnJykudG9Mb3dlckNhc2UoKTtcblxuICAgIGlmIChnbG9iYWxzLmhhc2hMaW5rQ291bnRzW2VzY2FwZWRJZF0pIHtcbiAgICAgIHRpdGxlID0gZXNjYXBlZElkICsgJy0nICsgKGdsb2JhbHMuaGFzaExpbmtDb3VudHNbZXNjYXBlZElkXSsrKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGl0bGUgPSBlc2NhcGVkSWQ7XG4gICAgICBnbG9iYWxzLmhhc2hMaW5rQ291bnRzW2VzY2FwZWRJZF0gPSAxO1xuICAgIH1cblxuICAgIC8vIFByZWZpeCBpZCB0byBwcmV2ZW50IGNhdXNpbmcgaW5hZHZlcnRlbnQgcHJlLWV4aXN0aW5nIHN0eWxlIG1hdGNoZXMuXG4gICAgaWYgKHByZWZpeEhlYWRlciA9PT0gdHJ1ZSkge1xuICAgICAgcHJlZml4SGVhZGVyID0gJ3NlY3Rpb24nO1xuICAgIH1cblxuICAgIGlmIChzaG93ZG93bi5oZWxwZXIuaXNTdHJpbmcocHJlZml4SGVhZGVyKSkge1xuICAgICAgcmV0dXJuIHByZWZpeEhlYWRlciArIHRpdGxlO1xuICAgIH1cbiAgICByZXR1cm4gdGl0bGU7XG4gIH1cblxuICByZXR1cm4gdGV4dDtcbn0pO1xuXG4vKipcbiAqIFR1cm4gTWFya2Rvd24gaW1hZ2Ugc2hvcnRjdXRzIGludG8gPGltZz4gdGFncy5cbiAqL1xuc2hvd2Rvd24uc3ViUGFyc2VyKCdpbWFnZXMnLCBmdW5jdGlvbiAodGV4dCwgb3B0aW9ucywgZ2xvYmFscykge1xuICAndXNlIHN0cmljdCc7XG5cbiAgdmFyIGlubGluZVJlZ0V4cCAgICA9IC8hXFxbKC4qPyldXFxzP1xcKFsgXFx0XSooKTw/KFxcUys/KT4/KD86ID0oWypcXGRdK1tBLVphLXolXXswLDR9KXgoWypcXGRdK1tBLVphLXolXXswLDR9KSk/WyBcXHRdKig/OihbJ1wiXSkoLio/KVxcNlsgXFx0XSopP1xcKS9nLFxuICAgICAgcmVmZXJlbmNlUmVnRXhwID0gLyFcXFsoLio/KV1bIF0/KD86XFxuWyBdKik/XFxbKC4qPyldKCkoKSgpKCkoKS9nO1xuXG4gIGZ1bmN0aW9uIHdyaXRlSW1hZ2VUYWcgKHdob2xlTWF0Y2gsIGFsdFRleHQsIGxpbmtJZCwgdXJsLCB3aWR0aCwgaGVpZ2h0LCBtNSwgdGl0bGUpIHtcblxuICAgIHZhciBnVXJscyAgID0gZ2xvYmFscy5nVXJscyxcbiAgICAgICAgZ1RpdGxlcyA9IGdsb2JhbHMuZ1RpdGxlcyxcbiAgICAgICAgZ0RpbXMgICA9IGdsb2JhbHMuZ0RpbWVuc2lvbnM7XG5cbiAgICBsaW5rSWQgPSBsaW5rSWQudG9Mb3dlckNhc2UoKTtcblxuICAgIGlmICghdGl0bGUpIHtcbiAgICAgIHRpdGxlID0gJyc7XG4gICAgfVxuXG4gICAgaWYgKHVybCA9PT0gJycgfHwgdXJsID09PSBudWxsKSB7XG4gICAgICBpZiAobGlua0lkID09PSAnJyB8fCBsaW5rSWQgPT09IG51bGwpIHtcbiAgICAgICAgLy8gbG93ZXItY2FzZSBhbmQgdHVybiBlbWJlZGRlZCBuZXdsaW5lcyBpbnRvIHNwYWNlc1xuICAgICAgICBsaW5rSWQgPSBhbHRUZXh0LnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvID9cXG4vZywgJyAnKTtcbiAgICAgIH1cbiAgICAgIHVybCA9ICcjJyArIGxpbmtJZDtcblxuICAgICAgaWYgKCFzaG93ZG93bi5oZWxwZXIuaXNVbmRlZmluZWQoZ1VybHNbbGlua0lkXSkpIHtcbiAgICAgICAgdXJsID0gZ1VybHNbbGlua0lkXTtcbiAgICAgICAgaWYgKCFzaG93ZG93bi5oZWxwZXIuaXNVbmRlZmluZWQoZ1RpdGxlc1tsaW5rSWRdKSkge1xuICAgICAgICAgIHRpdGxlID0gZ1RpdGxlc1tsaW5rSWRdO1xuICAgICAgICB9XG4gICAgICAgIGlmICghc2hvd2Rvd24uaGVscGVyLmlzVW5kZWZpbmVkKGdEaW1zW2xpbmtJZF0pKSB7XG4gICAgICAgICAgd2lkdGggPSBnRGltc1tsaW5rSWRdLndpZHRoO1xuICAgICAgICAgIGhlaWdodCA9IGdEaW1zW2xpbmtJZF0uaGVpZ2h0O1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gd2hvbGVNYXRjaDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBhbHRUZXh0ID0gYWx0VGV4dC5yZXBsYWNlKC9cIi9nLCAnJnF1b3Q7Jyk7XG4gICAgdXJsID0gc2hvd2Rvd24uaGVscGVyLmVzY2FwZUNoYXJhY3RlcnModXJsLCAnKl8nLCBmYWxzZSk7XG4gICAgdmFyIHJlc3VsdCA9ICc8aW1nIHNyYz1cIicgKyB1cmwgKyAnXCIgYWx0PVwiJyArIGFsdFRleHQgKyAnXCInO1xuXG4gICAgaWYgKHRpdGxlKSB7XG4gICAgICB0aXRsZSA9IHRpdGxlLnJlcGxhY2UoL1wiL2csICcmcXVvdDsnKTtcbiAgICAgIHRpdGxlID0gc2hvd2Rvd24uaGVscGVyLmVzY2FwZUNoYXJhY3RlcnModGl0bGUsICcqXycsIGZhbHNlKTtcbiAgICAgIHJlc3VsdCArPSAnIHRpdGxlPVwiJyArIHRpdGxlICsgJ1wiJztcbiAgICB9XG5cbiAgICBpZiAod2lkdGggJiYgaGVpZ2h0KSB7XG4gICAgICB3aWR0aCAgPSAod2lkdGggPT09ICcqJykgPyAnYXV0bycgOiB3aWR0aDtcbiAgICAgIGhlaWdodCA9IChoZWlnaHQgPT09ICcqJykgPyAnYXV0bycgOiBoZWlnaHQ7XG5cbiAgICAgIHJlc3VsdCArPSAnIHdpZHRoPVwiJyArIHdpZHRoICsgJ1wiJztcbiAgICAgIHJlc3VsdCArPSAnIGhlaWdodD1cIicgKyBoZWlnaHQgKyAnXCInO1xuICAgIH1cblxuICAgIHJlc3VsdCArPSAnIC8+JztcblxuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cblxuICAvLyBGaXJzdCwgaGFuZGxlIHJlZmVyZW5jZS1zdHlsZSBsYWJlbGVkIGltYWdlczogIVthbHQgdGV4dF1baWRdXG4gIHRleHQgPSB0ZXh0LnJlcGxhY2UocmVmZXJlbmNlUmVnRXhwLCB3cml0ZUltYWdlVGFnKTtcblxuICAvLyBOZXh0LCBoYW5kbGUgaW5saW5lIGltYWdlczogICFbYWx0IHRleHRdKHVybCA9PHdpZHRoPng8aGVpZ2h0PiBcIm9wdGlvbmFsIHRpdGxlXCIpXG4gIHRleHQgPSB0ZXh0LnJlcGxhY2UoaW5saW5lUmVnRXhwLCB3cml0ZUltYWdlVGFnKTtcblxuICByZXR1cm4gdGV4dDtcbn0pO1xuXG5zaG93ZG93bi5zdWJQYXJzZXIoJ2l0YWxpY3NBbmRCb2xkJywgZnVuY3Rpb24gKHRleHQpIHtcbiAgJ3VzZSBzdHJpY3QnO1xuICAvLyA8c3Ryb25nPiBtdXN0IGdvIGZpcnN0OlxuICB0ZXh0ID0gdGV4dC5yZXBsYWNlKC8oXFwqXFwqfF9fKSg/PVxcUykoW15cXHJdKj9cXFNbKl9dKilcXDEvZywgJzxzdHJvbmc+JDI8L3N0cm9uZz4nKTtcblxuICB0ZXh0ID0gdGV4dC5yZXBsYWNlKC8oXFwqfF8pKD89XFxTKShbXlxccl0qP1xcUylcXDEvZywgJzxlbT4kMjwvZW0+Jyk7XG5cbiAgcmV0dXJuIHRleHQ7XG59KTtcblxuLyoqXG4gKiBGb3JtIEhUTUwgb3JkZXJlZCAobnVtYmVyZWQpIGFuZCB1bm9yZGVyZWQgKGJ1bGxldGVkKSBsaXN0cy5cbiAqL1xuc2hvd2Rvd24uc3ViUGFyc2VyKCdsaXN0cycsIGZ1bmN0aW9uICh0ZXh0LCBvcHRpb25zLCBnbG9iYWxzKSB7XG4gICd1c2Ugc3RyaWN0JztcblxuICB2YXIgc3BsID0gJ34xJztcblxuICAvKipcbiAgICogUHJvY2VzcyB0aGUgY29udGVudHMgb2YgYSBzaW5nbGUgb3JkZXJlZCBvciB1bm9yZGVyZWQgbGlzdCwgc3BsaXR0aW5nIGl0XG4gICAqIGludG8gaW5kaXZpZHVhbCBsaXN0IGl0ZW1zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbGlzdFN0clxuICAgKiBAcmV0dXJucyB7c3RyaW5nfVxuICAgKi9cbiAgZnVuY3Rpb24gcHJvY2Vzc0xpc3RJdGVtcyAobGlzdFN0cikge1xuICAgIC8vIFRoZSAkZ19saXN0X2xldmVsIGdsb2JhbCBrZWVwcyB0cmFjayBvZiB3aGVuIHdlJ3JlIGluc2lkZSBhIGxpc3QuXG4gICAgLy8gRWFjaCB0aW1lIHdlIGVudGVyIGEgbGlzdCwgd2UgaW5jcmVtZW50IGl0OyB3aGVuIHdlIGxlYXZlIGEgbGlzdCxcbiAgICAvLyB3ZSBkZWNyZW1lbnQuIElmIGl0J3MgemVybywgd2UncmUgbm90IGluIGEgbGlzdCBhbnltb3JlLlxuICAgIC8vXG4gICAgLy8gV2UgZG8gdGhpcyBiZWNhdXNlIHdoZW4gd2UncmUgbm90IGluc2lkZSBhIGxpc3QsIHdlIHdhbnQgdG8gdHJlYXRcbiAgICAvLyBzb21ldGhpbmcgbGlrZSB0aGlzOlxuICAgIC8vXG4gICAgLy8gICAgSSByZWNvbW1lbmQgdXBncmFkaW5nIHRvIHZlcnNpb25cbiAgICAvLyAgICA4LiBPb3BzLCBub3cgdGhpcyBsaW5lIGlzIHRyZWF0ZWRcbiAgICAvLyAgICBhcyBhIHN1Yi1saXN0LlxuICAgIC8vXG4gICAgLy8gQXMgYSBzaW5nbGUgcGFyYWdyYXBoLCBkZXNwaXRlIHRoZSBmYWN0IHRoYXQgdGhlIHNlY29uZCBsaW5lIHN0YXJ0c1xuICAgIC8vIHdpdGggYSBkaWdpdC1wZXJpb2Qtc3BhY2Ugc2VxdWVuY2UuXG4gICAgLy9cbiAgICAvLyBXaGVyZWFzIHdoZW4gd2UncmUgaW5zaWRlIGEgbGlzdCAob3Igc3ViLWxpc3QpLCB0aGF0IGxpbmUgd2lsbCBiZVxuICAgIC8vIHRyZWF0ZWQgYXMgdGhlIHN0YXJ0IG9mIGEgc3ViLWxpc3QuIFdoYXQgYSBrbHVkZ2UsIGh1aD8gVGhpcyBpc1xuICAgIC8vIGFuIGFzcGVjdCBvZiBNYXJrZG93bidzIHN5bnRheCB0aGF0J3MgaGFyZCB0byBwYXJzZSBwZXJmZWN0bHlcbiAgICAvLyB3aXRob3V0IHJlc29ydGluZyB0byBtaW5kLXJlYWRpbmcuIFBlcmhhcHMgdGhlIHNvbHV0aW9uIGlzIHRvXG4gICAgLy8gY2hhbmdlIHRoZSBzeW50YXggcnVsZXMgc3VjaCB0aGF0IHN1Yi1saXN0cyBtdXN0IHN0YXJ0IHdpdGggYVxuICAgIC8vIHN0YXJ0aW5nIGNhcmRpbmFsIG51bWJlcjsgZS5nLiBcIjEuXCIgb3IgXCJhLlwiLlxuXG4gICAgZ2xvYmFscy5nTGlzdExldmVsKys7XG5cbiAgICAvLyB0cmltIHRyYWlsaW5nIGJsYW5rIGxpbmVzOlxuICAgIGxpc3RTdHIgPSBsaXN0U3RyLnJlcGxhY2UoL1xcbnsyLH0kLywgJ1xcbicpO1xuXG4gICAgLy8gYXR0YWNrbGFiOiBhZGQgc2VudGluZWwgdG8gZW11bGF0ZSBcXHpcbiAgICBsaXN0U3RyICs9ICd+MCc7XG5cbiAgICAvKlxuICAgICBsaXN0X3N0ciA9IGxpc3Rfc3RyLnJlcGxhY2UoL1xuICAgICAoXFxuKT9cdFx0XHRcdFx0XHRcdC8vIGxlYWRpbmcgbGluZSA9ICQxXG4gICAgICheWyBcXHRdKilcdFx0XHRcdFx0XHQvLyBsZWFkaW5nIHdoaXRlc3BhY2UgPSAkMlxuICAgICAoWyorLV18XFxkK1suXSkgWyBcXHRdK1x0XHRcdC8vIGxpc3QgbWFya2VyID0gJDNcbiAgICAgKFteXFxyXSs/XHRcdFx0XHRcdFx0Ly8gbGlzdCBpdGVtIHRleHQgICA9ICQ0XG4gICAgIChcXG57MSwyfSkpXG4gICAgICg/PSBcXG4qICh+MCB8IFxcMiAoWyorLV18XFxkK1suXSkgWyBcXHRdKykpXG4gICAgIC9nbSwgZnVuY3Rpb24oKXsuLi59KTtcbiAgICAgKi9cbiAgICB2YXIgcmd4ID0gLyhcXG4pPyheWyBcXHRdKikoWyorLV18XFxkK1suXSlbIFxcdF0rKFteXFxyXSs/KFxcbnsxLDJ9KSkoPz1cXG4qKH4wfFxcMihbKistXXxcXGQrWy5dKVsgXFx0XSspKS9nbTtcblxuICAgIGxpc3RTdHIgPSBsaXN0U3RyLnJlcGxhY2Uocmd4LCBmdW5jdGlvbiAod2hvbGVNYXRjaCwgbTEsIG0yLCBtMywgbTQpIHtcbiAgICAgIHZhciBpdGVtID0gc2hvd2Rvd24uc3ViUGFyc2VyKCdvdXRkZW50JykobTQsIG9wdGlvbnMsIGdsb2JhbHMpO1xuICAgICAgLy9tMSAtIExlYWRpbmdMaW5lXG5cbiAgICAgIGlmIChtMSB8fCAoaXRlbS5zZWFyY2goL1xcbnsyLH0vKSA+IC0xKSkge1xuICAgICAgICBpdGVtID0gc2hvd2Rvd24uc3ViUGFyc2VyKCdibG9ja0dhbXV0JykoaXRlbSwgb3B0aW9ucywgZ2xvYmFscyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBSZWN1cnNpb24gZm9yIHN1Yi1saXN0czpcbiAgICAgICAgaXRlbSA9IHNob3dkb3duLnN1YlBhcnNlcignbGlzdHMnKShpdGVtLCBvcHRpb25zLCBnbG9iYWxzKTtcbiAgICAgICAgaXRlbSA9IGl0ZW0ucmVwbGFjZSgvXFxuJC8sICcnKTsgLy8gY2hvbXAoaXRlbSlcbiAgICAgICAgaXRlbSA9IHNob3dkb3duLnN1YlBhcnNlcignc3BhbkdhbXV0JykoaXRlbSwgb3B0aW9ucywgZ2xvYmFscyk7XG4gICAgICB9XG5cbiAgICAgIC8vIHRoaXMgaXMgYSBcImhhY2tcIiB0byBkaWZmZXJlbnRpYXRlIGJldHdlZW4gb3JkZXJlZCBhbmQgdW5vcmRlcmVkIGxpc3RzXG4gICAgICAvLyByZWxhdGVkIHRvIGlzc3VlICMxNDJcbiAgICAgIHZhciB0cCA9IChtMy5zZWFyY2goL1sqKy1dL2cpID4gLTEpID8gJ3VsJyA6ICdvbCc7XG4gICAgICByZXR1cm4gc3BsICsgdHAgKyAnPGxpPicgKyBpdGVtICsgJzwvbGk+XFxuJztcbiAgICB9KTtcblxuICAgIC8vIGF0dGFja2xhYjogc3RyaXAgc2VudGluZWxcbiAgICBsaXN0U3RyID0gbGlzdFN0ci5yZXBsYWNlKC9+MC9nLCAnJyk7XG5cbiAgICBnbG9iYWxzLmdMaXN0TGV2ZWwtLTtcbiAgICByZXR1cm4gbGlzdFN0cjtcbiAgfVxuXG4gIC8qKlxuICAgKiBTbGl0IGNvbnNlY3V0aXZlIG9sL3VsIGxpc3RzIChyZWxhdGVkIHRvIGlzc3VlIDE0MilcbiAgICogQHBhcmFtIHtBcnJheX0gcmVzdWx0c1xuICAgKiBAcGFyYW0ge3N0cmluZ30gbGlzdFR5cGVcbiAgICogQHJldHVybnMge3N0cmluZ3wqfVxuICAgKi9cbiAgZnVuY3Rpb24gc3BsaXRDb25zZWN1dGl2ZUxpc3RzIChyZXN1bHRzLCBsaXN0VHlwZSkge1xuICAgIHZhciBjdGh1bGh1ID0gLyg8cFtePl0rPz58PHA+fDxcXC9wPikvaW1nLFxuICAgICAgICBob2xkZXIgPSBbW11dLFxuICAgICAgICByZXMgPSAnJyxcbiAgICAgICAgeSA9IDA7XG5cbiAgICAvLyBJbml0aWFsaXplIGZpcnN0IHN1Ymxpc3RcbiAgICBob2xkZXJbMF0udHlwZSA9IGxpc3RUeXBlO1xuXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCByZXN1bHRzLmxlbmd0aDsgKytpKSB7XG4gICAgICB2YXIgdHh0ID0gcmVzdWx0c1tpXS5zbGljZSgyKSxcbiAgICAgICAgICBuTGlzdFR5cGUgPSByZXN1bHRzW2ldLnNsaWNlKDAsIDIpO1xuXG4gICAgICBpZiAobGlzdFR5cGUgIT09IG5MaXN0VHlwZSkge1xuICAgICAgICB5Kys7XG4gICAgICAgIGhvbGRlclt5XSA9IFtdO1xuICAgICAgICBob2xkZXJbeV0udHlwZSA9IG5MaXN0VHlwZTtcbiAgICAgICAgbGlzdFR5cGUgPSBuTGlzdFR5cGU7XG4gICAgICB9XG4gICAgICBob2xkZXJbeV0ucHVzaCh0eHQpO1xuICAgIH1cbiAgICBmb3IgKGkgPSAwOyBpIDwgaG9sZGVyLmxlbmd0aDsgKytpKSB7XG4gICAgICByZXMgKz0gJzwnICsgaG9sZGVyW2ldLnR5cGUgKyAnPlxcbic7XG4gICAgICBmb3IgKHZhciBpaSA9IDA7IGlpIDwgaG9sZGVyW2ldLmxlbmd0aDsgKytpaSkge1xuICAgICAgICBpZiAoaG9sZGVyW2ldLmxlbmd0aCA+IDEgJiYgaWkgPT09IGhvbGRlcltpXS5sZW5ndGggLSAxICYmICFjdGh1bGh1LnRlc3QoaG9sZGVyW2ldW2lpIC0gMV0pKSB7XG4gICAgICAgICAgLy9ob2xkZXJbaV1baWldID0gaG9sZGVyW2ldW2lpXS5yZXBsYWNlKGN0aHVsaHUsICcnKTtcbiAgICAgICAgfVxuICAgICAgICByZXMgKz0gaG9sZGVyW2ldW2lpXTtcbiAgICAgIH1cbiAgICAgIHJlcyArPSAnPC8nICsgaG9sZGVyW2ldLnR5cGUgKyAnPlxcbic7XG4gICAgfVxuICAgIHJldHVybiByZXM7XG4gIH1cblxuICAvLyBhdHRhY2tsYWI6IGFkZCBzZW50aW5lbCB0byBoYWNrIGFyb3VuZCBraHRtbC9zYWZhcmkgYnVnOlxuICAvLyBodHRwOi8vYnVncy53ZWJraXQub3JnL3Nob3dfYnVnLmNnaT9pZD0xMTIzMVxuICB0ZXh0ICs9ICd+MCc7XG5cbiAgLy8gUmUtdXNhYmxlIHBhdHRlcm4gdG8gbWF0Y2ggYW55IGVudGlyZSB1bCBvciBvbCBsaXN0OlxuXG4gIC8qXG4gICB2YXIgd2hvbGVfbGlzdCA9IC9cbiAgIChcdFx0XHRcdFx0XHRcdFx0XHQvLyAkMSA9IHdob2xlIGxpc3RcbiAgIChcdFx0XHRcdFx0XHRcdFx0Ly8gJDJcbiAgIFsgXXswLDN9XHRcdFx0XHRcdC8vIGF0dGFja2xhYjogZ190YWJfd2lkdGggLSAxXG4gICAoWyorLV18XFxkK1suXSlcdFx0XHRcdC8vICQzID0gZmlyc3QgbGlzdCBpdGVtIG1hcmtlclxuICAgWyBcXHRdK1xuICAgKVxuICAgW15cXHJdKz9cbiAgIChcdFx0XHRcdFx0XHRcdFx0Ly8gJDRcbiAgIH4wXHRcdFx0XHRcdFx0XHQvLyBzZW50aW5lbCBmb3Igd29ya2Fyb3VuZDsgc2hvdWxkIGJlICRcbiAgIHxcbiAgIFxcbnsyLH1cbiAgICg/PVxcUylcbiAgICg/IVx0XHRcdFx0XHRcdFx0Ly8gTmVnYXRpdmUgbG9va2FoZWFkIGZvciBhbm90aGVyIGxpc3QgaXRlbSBtYXJrZXJcbiAgIFsgXFx0XSpcbiAgICg/OlsqKy1dfFxcZCtbLl0pWyBcXHRdK1xuICAgKVxuICAgKVxuICAgKS9nXG4gICAqL1xuICB2YXIgd2hvbGVMaXN0ID0gL14oKFsgXXswLDN9KFsqKy1dfFxcZCtbLl0pWyBcXHRdKylbXlxccl0rPyh+MHxcXG57Mix9KD89XFxTKSg/IVsgXFx0XSooPzpbKistXXxcXGQrWy5dKVsgXFx0XSspKSkvZ207XG5cbiAgaWYgKGdsb2JhbHMuZ0xpc3RMZXZlbCkge1xuICAgIHRleHQgPSB0ZXh0LnJlcGxhY2Uod2hvbGVMaXN0LCBmdW5jdGlvbiAod2hvbGVNYXRjaCwgbTEsIG0yKSB7XG4gICAgICB2YXIgbGlzdFR5cGUgPSAobTIuc2VhcmNoKC9bKistXS9nKSA+IC0xKSA/ICd1bCcgOiAnb2wnLFxuICAgICAgICAgIHJlc3VsdCA9IHByb2Nlc3NMaXN0SXRlbXMobTEpO1xuXG4gICAgICAvLyBUdXJuIGRvdWJsZSByZXR1cm5zIGludG8gdHJpcGxlIHJldHVybnMsIHNvIHRoYXQgd2UgY2FuIG1ha2UgYVxuICAgICAgLy8gcGFyYWdyYXBoIGZvciB0aGUgbGFzdCBpdGVtIGluIGEgbGlzdCwgaWYgbmVjZXNzYXJ5OlxuICAgICAgLy9saXN0ID0gbGlzdC5yZXBsYWNlKC9cXG57Mix9L2csICdcXG5cXG5cXG4nKTtcbiAgICAgIC8vcmVzdWx0ID0gcHJvY2Vzc0xpc3RJdGVtcyhsaXN0KTtcblxuICAgICAgLy8gVHJpbSBhbnkgdHJhaWxpbmcgd2hpdGVzcGFjZSwgdG8gcHV0IHRoZSBjbG9zaW5nIGA8LyRsaXN0X3R5cGU+YFxuICAgICAgLy8gdXAgb24gdGhlIHByZWNlZGluZyBsaW5lLCB0byBnZXQgaXQgcGFzdCB0aGUgY3VycmVudCBzdHVwaWRcbiAgICAgIC8vIEhUTUwgYmxvY2sgcGFyc2VyLiBUaGlzIGlzIGEgaGFjayB0byB3b3JrIGFyb3VuZCB0aGUgdGVycmlibGVcbiAgICAgIC8vIGhhY2sgdGhhdCBpcyB0aGUgSFRNTCBibG9jayBwYXJzZXIuXG4gICAgICByZXN1bHQgPSByZXN1bHQucmVwbGFjZSgvXFxzKyQvLCAnJyk7XG4gICAgICB2YXIgc3BsUmVzID0gcmVzdWx0LnNwbGl0KHNwbCk7XG4gICAgICBzcGxSZXMuc2hpZnQoKTtcbiAgICAgIHJlc3VsdCA9IHNwbGl0Q29uc2VjdXRpdmVMaXN0cyhzcGxSZXMsIGxpc3RUeXBlKTtcbiAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfSk7XG4gIH0gZWxzZSB7XG4gICAgd2hvbGVMaXN0ID0gLyhcXG5cXG58Xlxcbj8pKChbIF17MCwzfShbKistXXxcXGQrWy5dKVsgXFx0XSspW15cXHJdKz8ofjB8XFxuezIsfSg/PVxcUykoPyFbIFxcdF0qKD86WyorLV18XFxkK1suXSlbIFxcdF0rKSkpL2c7XG4gICAgLy93aG9sZUxpc3QgPSAvKFxcblxcbnxeXFxuPykoIHswLDN9KFsqKy1dfFxcZCtcXC4pWyBcXHRdK1tcXHNcXFNdKz8pKD89KH4wKXwoXFxuXFxuKD8hXFx0fCB7Mix9fCB7MCwzfShbKistXXxcXGQrXFwuKVsgXFx0XSkpKS9nO1xuXG4gICAgdGV4dCA9IHRleHQucmVwbGFjZSh3aG9sZUxpc3QsIGZ1bmN0aW9uICh3aG9sZU1hdGNoLCBtMSwgbTIsIG0zKSB7XG5cbiAgICAgIC8vIFR1cm4gZG91YmxlIHJldHVybnMgaW50byB0cmlwbGUgcmV0dXJucywgc28gdGhhdCB3ZSBjYW4gbWFrZSBhXG4gICAgICAvLyBwYXJhZ3JhcGggZm9yIHRoZSBsYXN0IGl0ZW0gaW4gYSBsaXN0LCBpZiBuZWNlc3Nhcnk6XG4gICAgICB2YXIgbGlzdCA9IG0yLnJlcGxhY2UoL1xcbnsyLH0vZywgJ1xcblxcblxcbicpLFxuICAgICAgLy92YXIgbGlzdCA9IChtMi5zbGljZSgtMikgIT09ICd+MCcpID8gbTIgKyAnXFxuJyA6IG0yLCAvL2FkZCBhIG5ld2xpbmUgYWZ0ZXIgdGhlIGxpc3RcbiAgICAgICAgICBsaXN0VHlwZSA9IChtMy5zZWFyY2goL1sqKy1dL2cpID4gLTEpID8gJ3VsJyA6ICdvbCcsXG4gICAgICAgICAgcmVzdWx0ID0gcHJvY2Vzc0xpc3RJdGVtcyhsaXN0KSxcbiAgICAgICAgICBzcGxSZXMgPSByZXN1bHQuc3BsaXQoc3BsKTtcblxuICAgICAgc3BsUmVzLnNoaWZ0KCk7XG4gICAgICByZXR1cm4gbTEgKyBzcGxpdENvbnNlY3V0aXZlTGlzdHMoc3BsUmVzLCBsaXN0VHlwZSkgKyAnXFxuJztcbiAgICB9KTtcbiAgfVxuXG4gIC8vIGF0dGFja2xhYjogc3RyaXAgc2VudGluZWxcbiAgdGV4dCA9IHRleHQucmVwbGFjZSgvfjAvLCAnJyk7XG5cbiAgcmV0dXJuIHRleHQ7XG59KTtcblxuLyoqXG4gKiBSZW1vdmUgb25lIGxldmVsIG9mIGxpbmUtbGVhZGluZyB0YWJzIG9yIHNwYWNlc1xuICovXG5zaG93ZG93bi5zdWJQYXJzZXIoJ291dGRlbnQnLCBmdW5jdGlvbiAodGV4dCkge1xuICAndXNlIHN0cmljdCc7XG5cbiAgLy8gYXR0YWNrbGFiOiBoYWNrIGFyb3VuZCBLb25xdWVyb3IgMy41LjQgYnVnOlxuICAvLyBcIi0tLS0tLS0tLS1idWdcIi5yZXBsYWNlKC9eLS9nLFwiXCIpID09IFwiYnVnXCJcbiAgdGV4dCA9IHRleHQucmVwbGFjZSgvXihcXHR8WyBdezEsNH0pL2dtLCAnfjAnKTsgLy8gYXR0YWNrbGFiOiBnX3RhYl93aWR0aFxuXG4gIC8vIGF0dGFja2xhYjogY2xlYW4gdXAgaGFja1xuICB0ZXh0ID0gdGV4dC5yZXBsYWNlKC9+MC9nLCAnJyk7XG5cbiAgcmV0dXJuIHRleHQ7XG59KTtcblxuLyoqXG4gKlxuICovXG5zaG93ZG93bi5zdWJQYXJzZXIoJ3BhcmFncmFwaHMnLCBmdW5jdGlvbiAodGV4dCwgb3B0aW9ucywgZ2xvYmFscykge1xuICAndXNlIHN0cmljdCc7XG5cbiAgLy8gU3RyaXAgbGVhZGluZyBhbmQgdHJhaWxpbmcgbGluZXM6XG4gIHRleHQgPSB0ZXh0LnJlcGxhY2UoL15cXG4rL2csICcnKTtcbiAgdGV4dCA9IHRleHQucmVwbGFjZSgvXFxuKyQvZywgJycpO1xuXG4gIHZhciBncmFmcyA9IHRleHQuc3BsaXQoL1xcbnsyLH0vZyksXG4gICAgICBncmFmc091dCA9IFtdLFxuICAgICAgZW5kID0gZ3JhZnMubGVuZ3RoOyAvLyBXcmFwIDxwPiB0YWdzXG5cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBlbmQ7IGkrKykge1xuICAgIHZhciBzdHIgPSBncmFmc1tpXTtcblxuICAgIC8vIGlmIHRoaXMgaXMgYW4gSFRNTCBtYXJrZXIsIGNvcHkgaXRcbiAgICBpZiAoc3RyLnNlYXJjaCgvfksoXFxkKylLL2cpID49IDApIHtcbiAgICAgIGdyYWZzT3V0LnB1c2goc3RyKTtcbiAgICB9IGVsc2UgaWYgKHN0ci5zZWFyY2goL1xcUy8pID49IDApIHtcbiAgICAgIHN0ciA9IHNob3dkb3duLnN1YlBhcnNlcignc3BhbkdhbXV0Jykoc3RyLCBvcHRpb25zLCBnbG9iYWxzKTtcbiAgICAgIHN0ciA9IHN0ci5yZXBsYWNlKC9eKFsgXFx0XSopL2csICc8cD4nKTtcbiAgICAgIHN0ciArPSAnPC9wPic7XG4gICAgICBncmFmc091dC5wdXNoKHN0cik7XG4gICAgfVxuICB9XG5cbiAgLyoqIFVuaGFzaGlmeSBIVE1MIGJsb2NrcyAqL1xuICBlbmQgPSBncmFmc091dC5sZW5ndGg7XG4gIGZvciAoaSA9IDA7IGkgPCBlbmQ7IGkrKykge1xuICAgIC8vIGlmIHRoaXMgaXMgYSBtYXJrZXIgZm9yIGFuIGh0bWwgYmxvY2suLi5cbiAgICB3aGlsZSAoZ3JhZnNPdXRbaV0uc2VhcmNoKC9+SyhcXGQrKUsvKSA+PSAwKSB7XG4gICAgICB2YXIgYmxvY2tUZXh0ID0gZ2xvYmFscy5nSHRtbEJsb2Nrc1tSZWdFeHAuJDFdO1xuICAgICAgYmxvY2tUZXh0ID0gYmxvY2tUZXh0LnJlcGxhY2UoL1xcJC9nLCAnJCQkJCcpOyAvLyBFc2NhcGUgYW55IGRvbGxhciBzaWduc1xuICAgICAgZ3JhZnNPdXRbaV0gPSBncmFmc091dFtpXS5yZXBsYWNlKC9+S1xcZCtLLywgYmxvY2tUZXh0KTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gZ3JhZnNPdXQuam9pbignXFxuXFxuJyk7XG59KTtcblxuLyoqXG4gKiBSdW4gZXh0ZW5zaW9uXG4gKi9cbnNob3dkb3duLnN1YlBhcnNlcigncnVuRXh0ZW5zaW9uJywgZnVuY3Rpb24gKGV4dCwgdGV4dCwgb3B0aW9ucywgZ2xvYmFscykge1xuICAndXNlIHN0cmljdCc7XG5cbiAgaWYgKGV4dC5maWx0ZXIpIHtcbiAgICB0ZXh0ID0gZXh0LmZpbHRlcih0ZXh0LCBnbG9iYWxzLmNvbnZlcnRlciwgb3B0aW9ucyk7XG5cbiAgfSBlbHNlIGlmIChleHQucmVnZXgpIHtcbiAgICAvLyBUT0RPIHJlbW92ZSB0aGlzIHdoZW4gb2xkIGV4dGVuc2lvbiBsb2FkaW5nIG1lY2hhbmlzbSBpcyBkZXByZWNhdGVkXG4gICAgdmFyIHJlID0gZXh0LnJlZ2V4O1xuICAgIGlmICghcmUgaW5zdGFuY2VvZiBSZWdFeHApIHtcbiAgICAgIHJlID0gbmV3IFJlZ0V4cChyZSwgJ2cnKTtcbiAgICB9XG4gICAgdGV4dCA9IHRleHQucmVwbGFjZShyZSwgZXh0LnJlcGxhY2UpO1xuICB9XG5cbiAgcmV0dXJuIHRleHQ7XG59KTtcblxuLyoqXG4gKiBUaGVzZSBhcmUgYWxsIHRoZSB0cmFuc2Zvcm1hdGlvbnMgdGhhdCBvY2N1ciAqd2l0aGluKiBibG9jay1sZXZlbFxuICogdGFncyBsaWtlIHBhcmFncmFwaHMsIGhlYWRlcnMsIGFuZCBsaXN0IGl0ZW1zLlxuICovXG5zaG93ZG93bi5zdWJQYXJzZXIoJ3NwYW5HYW11dCcsIGZ1bmN0aW9uICh0ZXh0LCBvcHRpb25zLCBnbG9iYWxzKSB7XG4gICd1c2Ugc3RyaWN0JztcblxuICB0ZXh0ID0gc2hvd2Rvd24uc3ViUGFyc2VyKCdjb2RlU3BhbnMnKSh0ZXh0LCBvcHRpb25zLCBnbG9iYWxzKTtcbiAgdGV4dCA9IHNob3dkb3duLnN1YlBhcnNlcignZXNjYXBlU3BlY2lhbENoYXJzV2l0aGluVGFnQXR0cmlidXRlcycpKHRleHQsIG9wdGlvbnMsIGdsb2JhbHMpO1xuICB0ZXh0ID0gc2hvd2Rvd24uc3ViUGFyc2VyKCdlbmNvZGVCYWNrc2xhc2hFc2NhcGVzJykodGV4dCwgb3B0aW9ucywgZ2xvYmFscyk7XG5cbiAgLy8gUHJvY2VzcyBhbmNob3IgYW5kIGltYWdlIHRhZ3MuIEltYWdlcyBtdXN0IGNvbWUgZmlyc3QsXG4gIC8vIGJlY2F1c2UgIVtmb29dW2ZdIGxvb2tzIGxpa2UgYW4gYW5jaG9yLlxuICB0ZXh0ID0gc2hvd2Rvd24uc3ViUGFyc2VyKCdpbWFnZXMnKSh0ZXh0LCBvcHRpb25zLCBnbG9iYWxzKTtcbiAgdGV4dCA9IHNob3dkb3duLnN1YlBhcnNlcignYW5jaG9ycycpKHRleHQsIG9wdGlvbnMsIGdsb2JhbHMpO1xuXG4gIC8vIE1ha2UgbGlua3Mgb3V0IG9mIHRoaW5ncyBsaWtlIGA8aHR0cDovL2V4YW1wbGUuY29tLz5gXG4gIC8vIE11c3QgY29tZSBhZnRlciBfRG9BbmNob3JzKCksIGJlY2F1c2UgeW91IGNhbiB1c2UgPCBhbmQgPlxuICAvLyBkZWxpbWl0ZXJzIGluIGlubGluZSBsaW5rcyBsaWtlIFt0aGlzXSg8dXJsPikuXG4gIHRleHQgPSBzaG93ZG93bi5zdWJQYXJzZXIoJ2F1dG9MaW5rcycpKHRleHQsIG9wdGlvbnMsIGdsb2JhbHMpO1xuICB0ZXh0ID0gc2hvd2Rvd24uc3ViUGFyc2VyKCdlbmNvZGVBbXBzQW5kQW5nbGVzJykodGV4dCwgb3B0aW9ucywgZ2xvYmFscyk7XG4gIHRleHQgPSBzaG93ZG93bi5zdWJQYXJzZXIoJ2l0YWxpY3NBbmRCb2xkJykodGV4dCwgb3B0aW9ucywgZ2xvYmFscyk7XG5cbiAgLy8gRG8gaGFyZCBicmVha3M6XG4gIHRleHQgPSB0ZXh0LnJlcGxhY2UoLyAgK1xcbi9nLCAnIDxiciAvPlxcbicpO1xuXG4gIHJldHVybiB0ZXh0O1xuXG59KTtcblxuLyoqXG4gKiBTdHJpcCBhbnkgbGluZXMgY29uc2lzdGluZyBvbmx5IG9mIHNwYWNlcyBhbmQgdGFicy5cbiAqIFRoaXMgbWFrZXMgc3Vic2VxdWVudCByZWdleHMgZWFzaWVyIHRvIHdyaXRlLCBiZWNhdXNlIHdlIGNhblxuICogbWF0Y2ggY29uc2VjdXRpdmUgYmxhbmsgbGluZXMgd2l0aCAvXFxuKy8gaW5zdGVhZCBvZiBzb21ldGhpbmdcbiAqIGNvbnRvcnRlZCBsaWtlIC9bIFxcdF0qXFxuKy9cbiAqL1xuc2hvd2Rvd24uc3ViUGFyc2VyKCdzdHJpcEJsYW5rTGluZXMnLCBmdW5jdGlvbiAodGV4dCkge1xuICAndXNlIHN0cmljdCc7XG4gIHJldHVybiB0ZXh0LnJlcGxhY2UoL15bIFxcdF0rJC9tZywgJycpO1xufSk7XG5cbi8qKlxuICogU3RyaXBzIGxpbmsgZGVmaW5pdGlvbnMgZnJvbSB0ZXh0LCBzdG9yZXMgdGhlIFVSTHMgYW5kIHRpdGxlcyBpblxuICogaGFzaCByZWZlcmVuY2VzLlxuICogTGluayBkZWZzIGFyZSBpbiB0aGUgZm9ybTogXltpZF06IHVybCBcIm9wdGlvbmFsIHRpdGxlXCJcbiAqXG4gKiBeWyBdezAsM31cXFsoLispXFxdOiAvLyBpZCA9ICQxICBhdHRhY2tsYWI6IGdfdGFiX3dpZHRoIC0gMVxuICogWyBcXHRdKlxuICogXFxuPyAgICAgICAgICAgICAgICAgIC8vIG1heWJlICpvbmUqIG5ld2xpbmVcbiAqIFsgXFx0XSpcbiAqIDw/KFxcUys/KT4/ICAgICAgICAgIC8vIHVybCA9ICQyXG4gKiBbIFxcdF0qXG4gKiBcXG4/ICAgICAgICAgICAgICAgIC8vIG1heWJlIG9uZSBuZXdsaW5lXG4gKiBbIFxcdF0qXG4gKiAoPzpcbiAqIChcXG4qKSAgICAgICAgICAgICAgLy8gYW55IGxpbmVzIHNraXBwZWQgPSAkMyBhdHRhY2tsYWI6IGxvb2tiZWhpbmQgcmVtb3ZlZFxuICogW1wiKF1cbiAqICguKz8pICAgICAgICAgICAgICAvLyB0aXRsZSA9ICQ0XG4gKiBbXCIpXVxuICogWyBcXHRdKlxuICogKT8gICAgICAgICAgICAgICAgIC8vIHRpdGxlIGlzIG9wdGlvbmFsXG4gKiAoPzpcXG4rfCQpXG4gKiAvZ20sXG4gKiBmdW5jdGlvbigpey4uLn0pO1xuICpcbiAqL1xuc2hvd2Rvd24uc3ViUGFyc2VyKCdzdHJpcExpbmtEZWZpbml0aW9ucycsIGZ1bmN0aW9uICh0ZXh0LCBvcHRpb25zLCBnbG9iYWxzKSB7XG4gICd1c2Ugc3RyaWN0JztcblxuICB2YXIgcmVnZXggPSAvXiB7MCwzfVxcWyguKyldOlsgXFx0XSpcXG4/WyBcXHRdKjw/KFxcUys/KT4/KD86ID0oWypcXGRdK1tBLVphLXolXXswLDR9KXgoWypcXGRdK1tBLVphLXolXXswLDR9KSk/WyBcXHRdKlxcbj9bIFxcdF0qKD86KFxcbiopW1wifCcoXSguKz8pW1wifCcpXVsgXFx0XSopPyg/Olxcbit8KD89fjApKS9nbTtcblxuICAvLyBhdHRhY2tsYWI6IHNlbnRpbmVsIHdvcmthcm91bmRzIGZvciBsYWNrIG9mIFxcQSBhbmQgXFxaLCBzYWZhcmlcXGtodG1sIGJ1Z1xuICB0ZXh0ICs9ICd+MCc7XG5cbiAgdGV4dCA9IHRleHQucmVwbGFjZShyZWdleCwgZnVuY3Rpb24gKHdob2xlTWF0Y2gsIGxpbmtJZCwgdXJsLCB3aWR0aCwgaGVpZ2h0LCBibGFua0xpbmVzLCB0aXRsZSkge1xuICAgIGxpbmtJZCA9IGxpbmtJZC50b0xvd2VyQ2FzZSgpO1xuICAgIGdsb2JhbHMuZ1VybHNbbGlua0lkXSA9IHNob3dkb3duLnN1YlBhcnNlcignZW5jb2RlQW1wc0FuZEFuZ2xlcycpKHVybCk7ICAvLyBMaW5rIElEcyBhcmUgY2FzZS1pbnNlbnNpdGl2ZVxuXG4gICAgaWYgKGJsYW5rTGluZXMpIHtcbiAgICAgIC8vIE9vcHMsIGZvdW5kIGJsYW5rIGxpbmVzLCBzbyBpdCdzIG5vdCBhIHRpdGxlLlxuICAgICAgLy8gUHV0IGJhY2sgdGhlIHBhcmVudGhldGljYWwgc3RhdGVtZW50IHdlIHN0b2xlLlxuICAgICAgcmV0dXJuIGJsYW5rTGluZXMgKyB0aXRsZTtcblxuICAgIH0gZWxzZSB7XG4gICAgICBpZiAodGl0bGUpIHtcbiAgICAgICAgZ2xvYmFscy5nVGl0bGVzW2xpbmtJZF0gPSB0aXRsZS5yZXBsYWNlKC9cInwnL2csICcmcXVvdDsnKTtcbiAgICAgIH1cbiAgICAgIGlmIChvcHRpb25zLnBhcnNlSW1nRGltZW5zaW9ucyAmJiB3aWR0aCAmJiBoZWlnaHQpIHtcbiAgICAgICAgZ2xvYmFscy5nRGltZW5zaW9uc1tsaW5rSWRdID0ge1xuICAgICAgICAgIHdpZHRoOiAgd2lkdGgsXG4gICAgICAgICAgaGVpZ2h0OiBoZWlnaHRcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICB9XG4gICAgLy8gQ29tcGxldGVseSByZW1vdmUgdGhlIGRlZmluaXRpb24gZnJvbSB0aGUgdGV4dFxuICAgIHJldHVybiAnJztcbiAgfSk7XG5cbiAgLy8gYXR0YWNrbGFiOiBzdHJpcCBzZW50aW5lbFxuICB0ZXh0ID0gdGV4dC5yZXBsYWNlKC9+MC8sICcnKTtcblxuICByZXR1cm4gdGV4dDtcbn0pO1xuXG4vKipcbiAqIFN3YXAgYmFjayBpbiBhbGwgdGhlIHNwZWNpYWwgY2hhcmFjdGVycyB3ZSd2ZSBoaWRkZW4uXG4gKi9cbnNob3dkb3duLnN1YlBhcnNlcigndW5lc2NhcGVTcGVjaWFsQ2hhcnMnLCBmdW5jdGlvbiAodGV4dCkge1xuICAndXNlIHN0cmljdCc7XG5cbiAgdGV4dCA9IHRleHQucmVwbGFjZSgvfkUoXFxkKylFL2csIGZ1bmN0aW9uICh3aG9sZU1hdGNoLCBtMSkge1xuICAgIHZhciBjaGFyQ29kZVRvUmVwbGFjZSA9IHBhcnNlSW50KG0xKTtcbiAgICByZXR1cm4gU3RyaW5nLmZyb21DaGFyQ29kZShjaGFyQ29kZVRvUmVwbGFjZSk7XG4gIH0pO1xuICByZXR1cm4gdGV4dDtcbn0pO1xuXG52YXIgcm9vdCA9IHRoaXM7XG5cbi8vIENvbW1vbkpTL25vZGVKUyBMb2FkZXJcbmlmICh0eXBlb2YgbW9kdWxlICE9PSAndW5kZWZpbmVkJyAmJiBtb2R1bGUuZXhwb3J0cykge1xuICBtb2R1bGUuZXhwb3J0cyA9IHNob3dkb3duO1xuXG4vLyBBTUQgTG9hZGVyXG59IGVsc2UgaWYgKHR5cGVvZiBkZWZpbmUgPT09ICdmdW5jdGlvbicgJiYgZGVmaW5lLmFtZCkge1xuICBkZWZpbmUoJ3Nob3dkb3duJywgZnVuY3Rpb24gKCkge1xuICAgICd1c2Ugc3RyaWN0JztcbiAgICByZXR1cm4gc2hvd2Rvd247XG4gIH0pO1xuXG4vLyBSZWd1bGFyIEJyb3dzZXIgbG9hZGVyXG59IGVsc2Uge1xuICByb290LnNob3dkb3duID0gc2hvd2Rvd247XG59XG59KS5jYWxsKHRoaXMpO1xuLy8jIHNvdXJjZU1hcHBpbmdVUkw9c2hvd2Rvd24uanMubWFwIl19
