var $doc = $(document)

$doc.on('click', '.btn-build', function (e) {
  e.preventDefault()

  $.post('/build')
    .done(function (res) {
      console.log(res)
    })

  return false
})


