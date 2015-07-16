var Editor = require('editor')

$(document).ready(function () {

	var editor = new Editor($('.editor'))
	var $doc = $(document)

	$doc.on('click', '.btn-publish', function (e) {
		e.preventDefault()

		var $this = $(this)
		var id = $('.post-id').val()

		$.post('/publish', {
			id: id
		})
				.done(function (res) {
					console.log(res)
					$this.removeClass('btn-publish').addClass('btn-unpublish').html('unpublish')
				})

		return false
	})

	$doc.on('click', '.btn-unpublish', function (e) {
		e.preventDefault()

		$this = $(this)
		var id = $('.post-id').val()

		$.post('/unpublish', {
			id: id
		})
				.done(function (res) {
					console.log(res)
					$this.addClass('btn-publish').removeClass('btn-unpublish').html('publish')
				})

		return false
	})

	$doc.on('click', '.btn-save', function (e) {
		e.preventDefault()

		var title = $.trim($('.title').val())
		var id = $('.post-id').val()
		var content = editor.getMarkdown()

		$.post('/save', {
			id: id,
			title: title,
			content: content
		})
				.done(function (res) {
					console.log(res)
					$('.post-id').val(res.id)
				})

		return false
	})

})