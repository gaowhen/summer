var Editor = require('./editor')

$(document).ready(function () {

	var editor = new Editor($('.editor'))
	var $doc = $(document)

	$doc.on('click', '.btn-save-draft', function (e) {
		e.preventDefault()

		var $this = $(this)
		var title = $.trim($('.title').val())
		var content = editor.getMarkdown()
		var date = new Date()

		var data = {
			title: title,
			content: content,
			date: date
		}

		$.post('/posts/save_draft', data)
			.done(function (res) {
				console.log(res)
				$this.removeClass('btn-save-draft').addClass('btn-save')
				$('.post-id').val(res.id)
			})

		return false
	})

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

})
