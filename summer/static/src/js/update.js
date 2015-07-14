var Editor = require('editor')

$(document).ready(function () {

	var editor = new Editor($('.editor'))
	var $doc = $(document)

	$doc.on('click', '.btn-publish', function (e) {
		e.preventDefault()

		var title = $.trim($('.title').val())
		var content = editor.getMarkdown()
		var id = $('.post-id').val()

		var data =  {
			title: title,
			content: content
		}

		$.post('/posts/' + id + '/update', data)
			.done(function (res) {
				console.log(res)
			})

		return false
	})

})