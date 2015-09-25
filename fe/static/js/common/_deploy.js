var $doc = $(document)

$doc.on('click', '.btn-deploy', function (e) {
	e.preventDefault()

	$.post('/deploy')
		.done(function (res) {
			console.log(res)
		})

	return false
})
