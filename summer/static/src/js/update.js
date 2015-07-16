var Editor = require('editor')

$(document).ready(function () {

	var editor = new Editor($('.editor'))
	var $doc = $(document)

	$doc.on('click', '.btn-publish', function (e) {
		e.preventDefault()

		var id = $('.post-id').val()

		$.post('/publish/', {
			id: id
		})
				.done(function (res) {
					console.log(res)
				})

		return false
	})

	$doc.on('click', '.btn-unpublish', function (e) {
		e.preventDefault()
		var id = $('.post-id').val()

		$.post('/unpublish', {
			id: id
		})
				.done(function (res) {
					console.log(res)
				})

		return false
	})

	$doc.on('click', '.btn-save', function (e) {
		e.preventDefault()

		var title = $.trim($('.title').val())
		var content = editor.getMarkdown()

		$.post('/new', {
			title: title,
			content: content
		})
				.done(function (res) {
					console.log(res)
				})

		return false
	})

	$doc.on('click', '.btn-update', function (e) {
		e.preventDefault()
		var id = $('.post-id').val()

		$.post('/post/' + id + '/update')
				.done(function (res) {
					console.log(res)
				})

		return false
	})

})