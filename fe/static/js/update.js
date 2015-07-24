var Editor = require('./editor')

$(document).ready(function () {

	var editor = new Editor($('.editor'))
	var $doc = $(document)

	$doc.on('click', '.btn-publish', function (e) {
		e.preventDefault()

		var $this = $(this)
		var id = $('.post-id').val()

		$.post('/posts/' + id + '/update_status', {
			status: 'publish'
		})
			.done(function (res) {
				console.log(res)
				$this.removeClass('btn-publish').addClass('btn-unpublish').html('unpublish')
			})

		return false
	})

	$doc.on('click', '.btn-unpublish', function (e) {
		e.preventDefault()

		var $this = $(this)
		var id = $('.post-id').val()

		$.post('/posts/' + id + '/update_status', {
			status: 'draft'
		})
			.done(function (res) {
				console.log(res)
				$this.addClass('btn-publish').removeClass('btn-unpublish').html('publish')
			})

		return false
	})

	$doc.on('click', '.btn-save-draft', function (e) {
		e.preventDefault()

		var $this = $(this)
		var title = $.trim($('.title').val())
		var content = editor.getMarkdown()

		$.post('/posts/save_draft', {
			title: title,
			content: content
		})
			.done(function (res) {
				console.log(res)
				$this.removeClass('btn-save-draft').addClass('btn-save')
				$('.post-id').val(res.id)
			})

		return false
	})

	$doc.on('click', '.btn-save', function (e) {
		e.preventDefault()

		var title = $.trim($('.title').val())
		var id = $('.post-id').val()
		var content = editor.getMarkdown()

		$.post('/posts/' + id + '/save', {
			title: title,
			content: content
		})
			.done(function (res) {
				console.log(res)
				$('.post-id').val(res.id)
			})

		return false
	})

	$doc.on('click', '.btn-del', function (e) {
		e.preventDefault()

		var $this = $(this)
		var pid = $this.data('pid')
		var $entry = $this.parents('.entry')

		$.post('/posts/' + pid + '/del')
			.done(function (res) {
				if (res.r) {
					$entry.slideUp()
				}
			})

		return false
	})

})