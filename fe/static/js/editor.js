var CodeMirror = require('./lib/codemirror')
var Showdown = require('./lib/showdown')
var Dropzone = require('dropzone')

function Editor(element) {
	return this.init(element)
}

Editor.prototype = {
	editor: null,
	markdown: null,
	html: null,
	converter: null,
	init: function (element) {
		this.element = element;
		this.converter = new Showdown.Converter();
		this.editor = CodeMirror.fromTextArea(this.element.find('textarea')[0], {
			mode: 'markdown',
			tabMode: 'indent',
			lineWrapping: true
		});

		this.editor.on("change", $.proxy(function () {
			this._updatePreview();
		}, this));

		$('.entry-markdown header, .entry-preview header', this.element).click(function (e) {
			$('.entry-markdown, .entry-preview', this.element).removeClass('active');
			$(e.target, this.element).closest('section').addClass('active');
		});

		$('.CodeMirror-scroll', this.element).on('scroll', $.proxy(function (e) {
			this._syncScroll(e);
		}, this));

		// Shadow on Markdown if scrolled
		$('.CodeMirror-scroll', this.element).scroll(function (e) {
			if ($(e.target).scrollTop() > 10) {
				$('.entry-markdown', this.element).addClass('scrolling');
			} else {
				$('.entry-markdown', this.element).removeClass('scrolling');
			}
		});
		// Shadow on Preview if scrolled
		$('.entry-preview-content', this.element).scroll(function (e) {
			if ($('.entry-preview-content', $(e.target).scrollTop()).scrollTop() > 10) {
				$('.entry-preview', this.element).addClass('scrolling');
			} else {
				$('.entry-preview', this.element).removeClass('scrolling');
			}
		});

		this._updatePreview();

		return this;
	},
	_updateImagePlaceholders: function (content) {
		// filter placeholder
		var that = this
		var imgPlaceholders = $(document.getElementsByClassName('rendered-markdown')[0]).find('p').filter(function () {
			return (/^!\[([a-zA-Z0-9]+.)?\]$/gim).test($(this).text())
		});

		$(imgPlaceholders).each(function (index) {
			var $this = $(this)

			$this
				.addClass('dropzone')
				.dropzone({
					url: '/upload',
					success: function (file, res) {
						var $holder = $(file.previewElement).parents('p')
						var editorOrigVal = that.editor.getValue()
						var nth = 0
						var newMarkdown = editorOrigVal.replace(/^!\[([a-zA-Z0-9]+.)?\]$/gim, function (match, i, original) {
							nth++;
							return (nth === (index + 1)) ? (match + '(' + res.path + ')') : match;
						})

						that.editor.setValue(newMarkdown)
						$holder.removeClass('dropzone').html('<img src="' + res.path + '"/>')
					}
				})
		})
	},
	_updatePreview: function () {
		var preview = this.element.find('.rendered-markdown');
		this.markdown = this.editor.getValue();
		this.html = this.converter.makeHtml(this.markdown);
		preview.html(this.html);
		this._updateImagePlaceholders(this.html);
		this._updateWordCount();
	},
	getHtml: function () {
		return this.html;
	},
	getMarkdown: function () {
		return this.markdown;
	},
	_syncScroll: function (e) {
		var $codeViewport = $(e.target),
				$previewViewport = $('.entry-preview-content'),
				$codeContent = $('.CodeMirror-sizer'),
				$previewContent = $('.rendered-markdown'),
				codeHeight = $codeContent.height() - $codeViewport.height(),
				previewHeight = $previewContent.height() - $previewViewport.height(),
				ratio = previewHeight / codeHeight,
				previewPosition = $codeViewport.scrollTop() * ratio;

		$previewViewport.scrollTop(previewPosition);
	},
	_updateWordCount: function () {
		var wordCount = this.element.find('.entry-word-count')
		var editorValue = this.markdown

		if (editorValue.length) {
			wordCount.html(editorValue.match(/\S+/g).length + ' words')
		}
	}
}

module.exports = Editor;

