var Editor = require('editor')

$(document).ready(function () {

	var editor = new Editor($('.editor'))
	var $doc = $(document)

	$doc.on('click', '.btn-publish', function (e) {
		e.preventDefault()

		var title = $.trim($('.title').val())
		var content = editor.getMarkdown()
		var date = new Date()

		var data =  {
			title: title,
			content: content,
			date: date
		}

		$.post('/add', data)
			.done(function (res) {
				console.log(res)
			})

		return false
	})

})
